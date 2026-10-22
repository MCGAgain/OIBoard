"""
后端接收接口: POST /api/v1/submissions/push
包含:
  1. 统一报文 Pydantic 数据校验
  2. 身份 Token 验证
  3. 数据库幂等写入 (初始 OPTIMISTIC 状态)
  4. 异步延迟投递核实 Worker 与状态机流转
"""

import asyncio
import os
import sqlite3
import datetime
import logging
from typing import Optional, Literal
from fastapi import APIRouter, Header, HTTPException, BackgroundTasks, status
from pydantic import BaseModel, Field

from .verification_worker import (
    verification_worker_instance,
    VerificationStatus,
)

logger = logging.getLogger("oj_api_router")
router = APIRouter(prefix="/api/v1/submissions", tags=["OJ Submissions"])

# 数据库路径解析 (优先使用 OIBoard 的 data/oiboard.db)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "data", "oiboard.db")


def get_db_connection() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def ensure_table_exists():
    with get_db_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS oj_submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL DEFAULT 1,
                platform TEXT NOT NULL,
                platform_submission_id TEXT NOT NULL,
                problem_id TEXT NOT NULL,
                problem_title TEXT,
                problem_url TEXT NOT NULL,
                platform_user_handle TEXT,
                verdict TEXT NOT NULL,
                raw_status TEXT,
                score INTEGER DEFAULT 100,
                language TEXT NOT NULL,
                source_code TEXT,
                execution_time_ms INTEGER,
                memory_used_kb INTEGER,
                verify_status TEXT NOT NULL DEFAULT 'OPTIMISTIC',
                verify_retry_count INTEGER NOT NULL DEFAULT 0,
                verify_error_msg TEXT,
                submitted_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                UNIQUE (platform, platform_submission_id)
            );
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_oj_user_verdict ON oj_submissions (user_id, verdict, submitted_at);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_oj_verify_status ON oj_submissions (verify_status, verify_retry_count);")
        conn.commit()


# 初始化表
try:
    ensure_table_exists()
except Exception as e:
    logger.warning(f"Could not auto-create table on import: {e}")


class UnifiedSubmissionPushModel(BaseModel):
    platform: Literal["leetcode_cn", "luogu", "acwing", "codeforces", "atcoder"]
    platformSubmissionId: str = Field(..., description="平台原始提交唯一ID")
    problemId: str = Field(..., description="平台题目唯一编号")
    problemTitle: Optional[str] = None
    problemUrl: str
    platformUserHandle: Optional[str] = None
    verdict: Literal["AC", "WA", "TLE", "MLE", "RE", "CE", "PE", "PA", "OTHER"]
    rawStatus: str
    score: Optional[int] = 100
    language: str
    sourceCode: Optional[str] = None
    executionTimeMs: Optional[int] = None
    memoryUsedKb: Optional[int] = None
    submittedAt: int
    clientVersion: str = "1.0.0"


@router.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "oj-tracker-receiver",
        "timestamp": datetime.datetime.now().isoformat(),
    }


@router.post("/push")
async def push_submission(
    payload: UnifiedSubmissionPushModel,
    background_tasks: BackgroundTasks,
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """
    接收油猴端秒级上报的判题与提交记录
    1. 校验 Token (可选，留空则采信)
    2. 幂等插入/更新数据库 (初始 OPTIMISTIC)
    3. 投递异步核实任务
    """
    logger.info(
        f"[Push API] Received submission from Tampermonkey: {payload.platform}:{payload.platformSubmissionId} "
        f"for {payload.problemId} ({payload.verdict})"
    )

    # 1. Token 校验逻辑（支持配置特定安全 Token，如设置了 OJ_TRACKER_SECRET 环境变量）
    required_token = os.environ.get("OJ_TRACKER_SECRET")
    if required_token:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing Bearer Authorization header",
            )
        token_val = authorization.split("Bearer ", 1)[1].strip()
        if token_val != required_token:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid authorization token",
            )

    # 2. 转换提交时间为标准格式
    try:
        sub_dt = datetime.datetime.fromtimestamp(payload.submittedAt / 1000.0)
        submitted_at_str = sub_dt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        submitted_at_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 3. 幂等入库
    try:
        ensure_table_exists()
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 检查是否已存在
            cursor.execute(
                "SELECT id, verify_status FROM oj_submissions WHERE platform = ? AND platform_submission_id = ?",
                (payload.platform, payload.platformSubmissionId),
            )
            row = cursor.fetchone()

            if row:
                existing_id = row["id"]
                current_verify = row["verify_status"]
                # 若已核实通过，保持 VERIFIED
                target_verify = current_verify if current_verify == VerificationStatus.VERIFIED else VerificationStatus.OPTIMISTIC

                cursor.execute(
                    """
                    UPDATE oj_submissions
                    SET problem_title = COALESCE(?, problem_title),
                        source_code = COALESCE(?, source_code),
                        execution_time_ms = COALESCE(?, execution_time_ms),
                        memory_used_kb = COALESCE(?, memory_used_kb),
                        score = COALESCE(?, score),
                        verify_status = ?,
                        updated_at = datetime('now', 'localtime')
                    WHERE id = ?;
                    """,
                    (
                        payload.problemTitle,
                        payload.sourceCode,
                        payload.executionTimeMs,
                        payload.memoryUsedKb,
                        payload.score,
                        target_verify,
                        existing_id,
                    ),
                )
                conn.commit()
                record_id = existing_id
                action = "updated"
            else:
                cursor.execute(
                    """
                    INSERT INTO oj_submissions (
                        user_id, platform, platform_submission_id, problem_id, problem_title,
                        problem_url, platform_user_handle, verdict, raw_status, score,
                        language, source_code, execution_time_ms, memory_used_kb,
                        verify_status, verify_retry_count, submitted_at
                    ) VALUES (
                        1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPTIMISTIC', 0, ?
                    );
                    """,
                    (
                        payload.platform,
                        payload.platformSubmissionId,
                        payload.problemId,
                        payload.problemTitle,
                        payload.problemUrl,
                        payload.platformUserHandle,
                        payload.verdict,
                        payload.rawStatus,
                        payload.score,
                        payload.language,
                        payload.sourceCode,
                        payload.executionTimeMs,
                        payload.memoryUsedKb,
                        submitted_at_str,
                    ),
                )
                conn.commit()
                record_id = cursor.lastrowid
                action = "inserted"

            # --- 2. 同步写入 OIBoard 前端主表 submissions ---
            import json
            unified_platform = "leetcode" if payload.platform in ("leetcode_cn", "leetcode") else payload.platform
            main_sub_id = f"u1_{unified_platform}_{payload.platformSubmissionId}"
            
            # 计算归属日期 (凌晨 4 点前算作昨日打卡)
            try:
                eff_dt = sub_dt - datetime.timedelta(hours=4)
                sub_date = eff_dt.strftime("%Y-%m-%d")
            except Exception:
                sub_date = datetime.datetime.now().strftime("%Y-%m-%d")

            extra_data = {
                "execution_time_ms": payload.executionTimeMs,
                "memory_used_kb": payload.memoryUsedKb,
                "score": payload.score,
                "source_code": payload.sourceCode,
                "verify_status": target_verify if 'target_verify' in locals() else VerificationStatus.OPTIMISTIC,
            }

            cursor.execute("""
                INSERT INTO submissions (
                    id, user_id, platform, raw_id, problem_id, problem_title, verdict, tags,
                    difficulty, difficulty_score, submitted_at, date, submission_url,
                    code_language, extra_data, account_handle
                ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    problem_title = COALESCE(excluded.problem_title, submissions.problem_title),
                    verdict = excluded.verdict,
                    submitted_at = CASE WHEN excluded.submitted_at != '' THEN excluded.submitted_at ELSE submissions.submitted_at END,
                    date = CASE WHEN excluded.date != '' THEN excluded.date ELSE submissions.date END,
                    submission_url = excluded.submission_url,
                    code_language = excluded.code_language,
                    extra_data = excluded.extra_data,
                    account_handle = CASE WHEN excluded.account_handle != '' THEN excluded.account_handle ELSE submissions.account_handle END;
            """, (
                main_sub_id,
                unified_platform,
                payload.platformSubmissionId,
                payload.problemId,
                payload.problemTitle or payload.problemId,
                payload.verdict,
                json.dumps([], ensure_ascii=False),
                "中等" if unified_platform == "leetcode" else "未知",
                submitted_at_str,
                sub_date,
                payload.problemUrl,
                payload.language,
                json.dumps(extra_data, ensure_ascii=False),
                payload.platformUserHandle or ""
            ))

            # --- 3. 激活更新 platform_status 表 ---
            cursor.execute("""
                INSERT INTO platform_status (user_id, platform, status, message, last_checked_at, item_count, rating, updated_at)
                VALUES (1, ?, 'ok', '油猴实时同步', datetime('now', 'localtime'), 1, '', datetime('now', 'localtime'))
                ON CONFLICT(user_id, platform) DO UPDATE SET
                    status = 'ok',
                    message = '油猴实时同步',
                    last_checked_at = datetime('now', 'localtime'),
                    updated_at = datetime('now', 'localtime');
            """, (unified_platform,))
            conn.commit()

    except Exception as e:
        logger.error(f"[Push API] Database write error: {e}")
        raise HTTPException(status_code=500, detail=f"Database write failure: {str(e)}")

    # 4. 投递后台异步单点核实任务 (延迟 5 秒后执行，留出各大 OJ 服务端状态稳定期)
    background_tasks.add_task(
        run_async_verification,
        record_id=record_id,
        platform=payload.platform,
        platform_submission_id=payload.platformSubmissionId,
        problem_id=payload.problemId,
        verdict=payload.verdict,
        platform_user_handle=payload.platformUserHandle,
        problem_url=payload.problemUrl,
    )

    return {
        "code": 200,
        "message": "Submission optimistically recorded and queued for verification",
        "data": {
            "recordId": record_id,
            "platform": payload.platform,
            "submissionId": payload.platformSubmissionId,
            "action": action,
            "verifyStatus": VerificationStatus.OPTIMISTIC,
        },
    }


async def run_async_verification(
    record_id: int,
    platform: str,
    platform_submission_id: str,
    problem_id: str,
    verdict: str,
    platform_user_handle: Optional[str],
    problem_url: Optional[str],
    current_retry: int = 0,
):
    """
    异步核实调度器（含指数退避与回退更新）
    """
    # 延迟 5 秒等待平台完全固化提交数据
    if current_retry == 0:
        await asyncio.sleep(5)

    new_status, reason = await verification_worker_instance.verify_submission(
        platform=platform,
        platform_submission_id=platform_submission_id,
        problem_id=problem_id,
        verdict=verdict,
        platform_user_handle=platform_user_handle,
        problem_url=problem_url,
        retry_count=current_retry,
    )

    logger.info(
        f"[Async Verification] Result for {platform}:{platform_submission_id} -> {new_status} (Reason: {reason})"
    )

    # 更新数据库状态
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            if new_status == VerificationStatus.OPTIMISTIC and current_retry < 3:
                # 需重试
                cursor.execute(
                    """
                    UPDATE oj_submissions
                    SET verify_retry_count = verify_retry_count + 1,
                        verify_error_msg = ?,
                        updated_at = datetime('now', 'localtime')
                    WHERE id = ?;
                    """,
                    (reason, record_id),
                )
                conn.commit()

                # 指数退避再次投递
                delay_sec = (current_retry + 1) * 15
                await asyncio.sleep(delay_sec)
                await run_async_verification(
                    record_id,
                    platform,
                    platform_submission_id,
                    problem_id,
                    verdict,
                    platform_user_handle,
                    problem_url,
                    current_retry + 1,
                )
                return
            else:
                cursor.execute(
                    """
                    UPDATE oj_submissions
                    SET verify_status = ?,
                        verify_error_msg = ?,
                        updated_at = datetime('now', 'localtime')
                    WHERE id = ?;
                    """,
                    (new_status, reason, record_id),
                )
                unified_platform = "leetcode" if platform in ("leetcode_cn", "leetcode") else platform
                main_sub_id = f"u1_{unified_platform}_{platform_submission_id}"
                if new_status == VerificationStatus.REJECTED:
                    cursor.execute("UPDATE submissions SET verdict = 'REJECTED' WHERE id = ?;", (main_sub_id,))
                conn.commit()
    except Exception as e:
        logger.error(f"[Async Verification] Failed to update DB status for record {record_id}: {e}")

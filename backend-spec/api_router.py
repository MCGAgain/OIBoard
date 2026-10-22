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
import sys
import sqlite3
import datetime
import logging
from typing import Optional, Literal
from fastapi import APIRouter, Header, HTTPException, BackgroundTasks, status
from pydantic import BaseModel, Field

# 确保能正确引入项目根目录的 db 模块
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
import db

from .verification_worker import (
    verification_worker_instance,
    VerificationStatus,
)

logger = logging.getLogger("oj_api_router")
router = APIRouter(prefix="/api/v1/submissions", tags=["OJ Submissions"])

# 数据库路径解析 (优先使用 OIBoard 的 data/oiboard.db)
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


def map_language_name(platform: str, raw_lang: str) -> str:
    if not raw_lang:
        return "Unknown"
    lang_str = str(raw_lang).strip()
    if platform == "luogu":
        luogu_map = {
            "1": "Pascal", "2": "C", "3": "C++98", "4": "C++11",
            "7": "Python 3", "8": "Python 2", "9": "Java 8",
            "11": "C++14", "12": "C++17", "13": "Node.js", "14": "Rust",
            "15": "PHP", "16": "Go", "17": "C#", "18": "Ruby",
            "19": "Kotlin", "20": "Haskell", "21": "Scala", "22": "Perl",
            "27": "C++20", "28": "C++20 (O2)"
        }
        return luogu_map.get(lang_str, lang_str)
    elif platform in ("leetcode_cn", "leetcode"):
        lc_map = {
            "cpp": "C++", "python3": "Python3", "python": "Python",
            "java": "Java", "golang": "Go", "rust": "Rust",
            "javascript": "JavaScript", "typescript": "TypeScript", "c": "C"
        }
        return lc_map.get(lang_str.lower(), lang_str)
    return lang_str


def resolve_user_id(authorization: Optional[str], platform: str, handle: Optional[str]) -> int:
    """
    智能判定多租户 user_id:
    1. 优先校验 Authorization 头部 (Bearer Token / session token / username / user_id)
    2. 匹配 platform_accounts 中绑定的各平台 Handle (如 Luogu UID 或 Handle)
    3. 查询当前最活跃的登录 session (单人部署场景直接匹配)
    4. 回退至首个普通业务用户 (如 user_id=2)，最终兜底 user_id=1
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # 1. 尝试从 Authorization 头部解析
        if authorization and isinstance(authorization, str):
            tok = authorization
            if tok.startswith("Bearer "):
                tok = tok[7:].strip()
            if tok:
                # 检查 sessions
                cursor.execute(
                    "SELECT user_id FROM sessions WHERE token = ? AND expires_at > datetime('now', 'localtime');",
                    (tok,)
                )
                row = cursor.fetchone()
                if row:
                    logger.info(f"[Auth] Matched user_id={row['user_id']} via active session token")
                    return int(row["user_id"])

                # 检查是否直接是 user_id 数字
                if tok.isdigit():
                    cursor.execute("SELECT id FROM users WHERE id = ?;", (int(tok),))
                    row = cursor.fetchone()
                    if row:
                        logger.info(f"[Auth] Matched user_id={row['id']} via explicit user_id")
                        return int(row["id"])

                # 检查是否是 username
                cursor.execute("SELECT id FROM users WHERE username = ?;", (tok,))
                row = cursor.fetchone()
                if row:
                    logger.info(f"[Auth] Matched user_id={row['id']} via username '{tok}'")
                    return int(row["id"])

        # 2. 尝试从 platform_accounts 匹配
        if handle:
            clean_handle = handle.strip()
            search_platforms = [platform]
            if platform in ("leetcode_cn", "leetcode"):
                search_platforms = ["leetcode", "leetcode_cn"]

            for p in search_platforms:
                cursor.execute(
                    "SELECT user_id FROM platform_accounts WHERE platform = ? AND (handle = ? OR alias = ?) ORDER BY is_primary DESC LIMIT 1;",
                    (p, clean_handle, clean_handle)
                )
                row = cursor.fetchone()
                if row:
                    logger.info(f"[Auth] Matched user_id={row['user_id']} via platform_accounts ({p}:{clean_handle})")
                    return int(row["user_id"])

            # 兼容：handle 匹配 users.username
            cursor.execute("SELECT id FROM users WHERE username = ?;", (clean_handle,))
            row = cursor.fetchone()
            if row:
                logger.info(f"[Auth] Matched user_id={row['id']} via username '{clean_handle}'")
                return int(row["id"])

        # 3. 查找最近活跃会话 (单人使用场景下的智能适配)
        cursor.execute(
            "SELECT user_id FROM sessions WHERE expires_at > datetime('now', 'localtime') ORDER BY created_at DESC LIMIT 1;"
        )
        row = cursor.fetchone()
        if row:
            logger.info(f"[Auth] Matched user_id={row['user_id']} via latest active session")
            return int(row["user_id"])

        # 4. 查找首个非 admin 用户 (如用户 2)
        cursor.execute("SELECT id FROM users WHERE is_admin = 0 ORDER BY id ASC LIMIT 1;")
        row = cursor.fetchone()
        if row:
            logger.info(f"[Auth] Fallback to primary non-admin user_id={row['id']}")
            return int(row["id"])

        # 兜底 user 1
        return 1


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
    1. 动态智能解析多租户 user_id (支持 Token、Platform Handle、活跃会话、普通用户智能推断)
    2. 幂等插入/更新数据库 (与 OIBoard 原生数据库设计 100% 保持一致)
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

    # 2. 动态智能解析多租户用户归属
    resolved_user_id = resolve_user_id(authorization, payload.platform, payload.platformUserHandle)
    unified_platform = "leetcode" if payload.platform in ("leetcode_cn", "leetcode") else payload.platform

    # 3. 转换提交时间为标准北京时间格式
    try:
        sub_dt = datetime.datetime.fromtimestamp(payload.submittedAt / 1000.0)
        submitted_at_str = sub_dt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        submitted_at_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 计算符合熬夜机制的归属打卡日期 (凌晨 4 点前算作昨日打卡)
    sub_date = db.parse_beijing_str_to_date(submitted_at_str)
    clean_lang = map_language_name(payload.platform, payload.language)

    # 4. 幂等入库
    try:
        ensure_table_exists()
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 检查 oj_submissions 审计表是否已存在
            cursor.execute(
                "SELECT id, verify_status FROM oj_submissions WHERE platform = ? AND platform_submission_id = ?",
                (payload.platform, payload.platformSubmissionId),
            )
            row = cursor.fetchone()

            if row:
                existing_id = row["id"]
                current_verify = row["verify_status"]
                target_verify = current_verify if current_verify == VerificationStatus.VERIFIED else VerificationStatus.OPTIMISTIC

                cursor.execute(
                    """
                    UPDATE oj_submissions
                    SET user_id = ?,
                        problem_title = COALESCE(?, problem_title),
                        source_code = COALESCE(?, source_code),
                        execution_time_ms = COALESCE(?, execution_time_ms),
                        memory_used_kb = COALESCE(?, memory_used_kb),
                        score = COALESCE(?, score),
                        verify_status = ?,
                        updated_at = datetime('now', 'localtime')
                    WHERE id = ?;
                    """,
                    (
                        resolved_user_id,
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
                target_verify = VerificationStatus.OPTIMISTIC
                cursor.execute(
                    """
                    INSERT INTO oj_submissions (
                        user_id, platform, platform_submission_id, problem_id, problem_title,
                        problem_url, platform_user_handle, verdict, raw_status, score,
                        language, source_code, execution_time_ms, memory_used_kb,
                        verify_status, verify_retry_count, submitted_at
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPTIMISTIC', 0, ?
                    );
                    """,
                    (
                        resolved_user_id,
                        payload.platform,
                        payload.platformSubmissionId,
                        payload.problemId,
                        payload.problemTitle,
                        payload.problemUrl,
                        payload.platformUserHandle,
                        payload.verdict,
                        payload.rawStatus,
                        payload.score,
                        clean_lang,
                        payload.sourceCode,
                        payload.executionTimeMs,
                        payload.memoryUsedKb,
                        submitted_at_str,
                    ),
                )
                conn.commit()
                record_id = cursor.lastrowid
                action = "inserted"

        # --- 2. 使用原生 db.save_submissions 同步写入 OIBoard 前端主表 submissions ---
        extra_data = {
            "execution_time_ms": payload.executionTimeMs,
            "memory_used_kb": payload.memoryUsedKb,
            "score": payload.score,
            "source_code": payload.sourceCode,
            "verify_status": target_verify,
            "raw_status": payload.rawStatus,
            "client_version": payload.clientVersion,
        }

        sub_dict = {
            "platform": unified_platform,
            "raw_id": str(payload.platformSubmissionId),
            "problem_id": str(payload.problemId),
            "problem_title": payload.problemTitle or str(payload.problemId),
            "verdict": payload.verdict,
            "tags": [],
            "difficulty": "简单" if unified_platform == "leetcode" else "未知",
            "difficulty_score": 0,
            "submitted_at": submitted_at_str,
            "date": sub_date,
            "submission_url": payload.problemUrl,
            "code_language": clean_lang,
            "extra_data": extra_data,
            "account_handle": payload.platformUserHandle or "",
        }

        db.save_submissions([sub_dict], user_id=resolved_user_id)

        # --- 3. 激活更新 platform_status 表 ---
        db.update_platform_status(
            user_id=resolved_user_id,
            platform=unified_platform,
            status="ok",
            message="油猴实时秒级同步",
            rating="",
        )

        # --- 4. 触发错题本自动联动推进复习进度 ---
        try:
            db.sync_mistakes_with_submissions(user_id=resolved_user_id)
        except Exception as me:
            logger.warning(f"Error syncing mistakes for user {resolved_user_id}: {me}")

    except Exception as e:
        logger.error(f"[Push API] Database write error: {e}")
        raise HTTPException(status_code=500, detail=f"Database write failure: {str(e)}")

    # 5. 投递后台异步单点核实任务 (附带 resolved_user_id)
    background_tasks.add_task(
        run_async_verification,
        record_id=record_id,
        user_id=resolved_user_id,
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
            "userId": resolved_user_id,
            "platform": payload.platform,
            "submissionId": payload.platformSubmissionId,
            "action": action,
            "verifyStatus": VerificationStatus.OPTIMISTIC,
        },
    }


async def run_async_verification(
    record_id: int,
    user_id: int,
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
                    user_id,
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
                main_sub_id = f"u{user_id}_{unified_platform}_{platform_submission_id}"
                
                # 如果伪造核实失败，置为 REJECTED
                if new_status == VerificationStatus.REJECTED:
                    cursor.execute("UPDATE submissions SET verdict = 'REJECTED' WHERE id = ?;", (main_sub_id,))
                else:
                    # 更新 extra_data 中的 verify_status
                    cursor.execute("SELECT extra_data FROM submissions WHERE id = ?;", (main_sub_id,))
                    sub_row = cursor.fetchone()
                    if sub_row and sub_row["extra_data"]:
                        try:
                            import json
                            ed = json.loads(sub_row["extra_data"])
                            ed["verify_status"] = new_status
                            cursor.execute("UPDATE submissions SET extra_data = ? WHERE id = ?;", (json.dumps(ed, ensure_ascii=False), main_sub_id))
                        except Exception:
                            pass
                conn.commit()
    except Exception as e:
        logger.error(f"[Async Verification] Failed to update DB status for record {record_id}: {e}")

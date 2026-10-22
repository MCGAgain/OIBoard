"""
多平台 OJ 提交异步核实状态机 Worker (Verification Worker)
包含:
  1. Codeforces 官方 user.status API 单点核实
  2. 洛谷 _contentOnly=1 单点核实与新旧架构解析
  3. 力扣中国公开 GraphQL recentACSubmissions 免登核实
  4. AtCoder 提交详情页公开解析核实
  5. AcWing 与反爬风控 (403/Captcha/WAF) 自动回退 FALLBACK_TRUSTED 状态机机制
"""

import asyncio
import logging
import re
from typing import Dict, Any, Optional, Tuple
import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger("oj_verification_worker")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


class VerificationStatus:
    OPTIMISTIC = "OPTIMISTIC"              # 油猴上报，乐观采信入库
    VERIFIED = "VERIFIED"                  # 权威单点对账成功
    FALLBACK_TRUSTED = "FALLBACK_TRUSTED"  # 遭遇 403/WAF/验证码/隐私保护，自动回退采信
    REJECTED = "REJECTED"                  # 明确查无此记录或判题状态与上报不符（伪造）


class VerificationWorker:
    def __init__(self, db_conn_factory=None):
        self.db_conn_factory = db_conn_factory
        self.headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )
        }

    async def verify_submission(
        self,
        platform: str,
        platform_submission_id: str,
        problem_id: str,
        verdict: str,
        platform_user_handle: Optional[str] = None,
        problem_url: Optional[str] = None,
        retry_count: int = 0,
    ) -> Tuple[str, Optional[str]]:
        """
        核心分发入口：返回 (new_verify_status, error_or_reason_msg)
        """
        logger.info(
            f"Verifying {platform}:{platform_submission_id} (Problem: {problem_id}, Verdict: {verdict}, Attempt: {retry_count + 1})"
        )

        try:
            if platform == "codeforces":
                return await self._verify_codeforces(
                    platform_submission_id, problem_id, verdict, platform_user_handle, retry_count
                )
            elif platform == "luogu":
                return await self._verify_luogu(
                    platform_submission_id, problem_id, verdict, platform_user_handle, retry_count
                )
            elif platform == "leetcode_cn":
                return await self._verify_leetcode(
                    platform_submission_id, problem_id, verdict, platform_user_handle, retry_count
                )
            elif platform == "atcoder":
                return await self._verify_atcoder(
                    platform_submission_id, problem_id, verdict, platform_user_handle, problem_url, retry_count
                )
            elif platform == "acwing":
                return await self._verify_acwing(
                    platform_submission_id, problem_id, verdict, platform_user_handle, retry_count
                )
            else:
                return VerificationStatus.FALLBACK_TRUSTED, f"Unknown platform {platform}, fallback trusted."
        except Exception as e:
            logger.error(f"Unexpected error in verification of {platform}:{platform_submission_id}: {e}")
            if retry_count < 3:
                return VerificationStatus.OPTIMISTIC, f"Transient error: {str(e)}"
            return VerificationStatus.FALLBACK_TRUSTED, f"Max retry reached after exception: {str(e)}"

    # -------------------------------------------------------------
    # 1. Codeforces 官方 API 核实
    # -------------------------------------------------------------
    async def _verify_codeforces(
        self,
        submission_id: str,
        problem_id: str,
        verdict: str,
        handle: Optional[str],
        retry_count: int,
    ) -> Tuple[str, Optional[str]]:
        if not handle:
            return VerificationStatus.FALLBACK_TRUSTED, "CF user handle not provided; fallback to trusted."

        url = f"https://codeforces.com/api/user.status?handle={handle}&from=1&count=25"
        async with httpx.AsyncClient(timeout=10.0, headers=self.headers, follow_redirects=True) as client:
            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("status") == "OK":
                        submissions = data.get("result", [])
                        for sub in submissions:
                            if str(sub.get("id")) == str(submission_id):
                                sub_verdict = sub.get("verdict", "")
                                is_ac = sub_verdict == "OK"
                                expected_ac = verdict == "AC"
                                if is_ac == expected_ac:
                                    return VerificationStatus.VERIFIED, f"Verified via CF API (id: {submission_id})"
                                else:
                                    return (
                                        VerificationStatus.REJECTED,
                                        f"Verdict mismatch: API reported {sub_verdict}, expected {verdict}",
                                    )
                        return (
                            VerificationStatus.FALLBACK_TRUSTED,
                            "Submission not found in recent 25 items; fallback trusted.",
                        )
                    else:
                        return VerificationStatus.FALLBACK_TRUSTED, f"CF API error: {data.get('comment')}"
                elif resp.status_code in (403, 429, 503):
                    if retry_count < 3:
                        return VerificationStatus.OPTIMISTIC, f"CF API rate limited/WAF (HTTP {resp.status_code})"
                    return (
                        VerificationStatus.FALLBACK_TRUSTED,
                        f"CF API blocked (HTTP {resp.status_code}); auto fallback trusted.",
                    )
                else:
                    return VerificationStatus.FALLBACK_TRUSTED, f"CF API returned HTTP {resp.status_code}"
            except (httpx.TimeoutException, httpx.NetworkError) as e:
                if retry_count < 3:
                    return VerificationStatus.OPTIMISTIC, f"Network timeout: {e}"
                return VerificationStatus.FALLBACK_TRUSTED, f"CF network failure after retries; fallback trusted."

    # -------------------------------------------------------------
    # 2. 洛谷 _contentOnly=1 单点核实
    # -------------------------------------------------------------
    async def _verify_luogu(
        self,
        rid: str,
        problem_id: str,
        verdict: str,
        handle: Optional[str],
        retry_count: int,
    ) -> Tuple[str, Optional[str]]:
        url = f"https://www.luogu.com.cn/record/{rid}?_contentOnly=1"
        headers = {
            **self.headers,
            "X-Requested-With": "XMLHttpRequest",
            "x-lentille-request": "content-only",
        }

        async with httpx.AsyncClient(timeout=10.0, headers=headers, follow_redirects=True) as client:
            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    text = resp.text
                    record = None
                    try:
                        json_data = resp.json()
                        record = json_data.get("currentData", {}).get("record") or json_data.get("data", {}).get("record") or json_data.get("record")
                    except Exception:
                        match = re.search(r'<script\s+id="lentille-context"\s+type="application\/json">([\s\S]*?)<\/script>', text)
                        if match:
                            import json
                            ctx = json.loads(match.group(1))
                            record = ctx.get("data", {}).get("record") or ctx.get("currentData", {}).get("record")

                    if record:
                        remote_status = record.get("status")
                        remote_pid = record.get("problem", {}).get("pid", "")
                        remote_score = record.get("score", 0)

                        # status 12 = AC
                        is_remote_ac = remote_status == 12
                        if is_remote_ac and verdict == "AC":
                            return VerificationStatus.VERIFIED, f"Luogu rid {rid} verified (AC, score: {remote_score})"
                        elif remote_status == 14 and verdict in ("PA", "WA"):
                            return VerificationStatus.VERIFIED, f"Luogu rid {rid} verified (status: 14, score: {remote_score})"
                        elif is_remote_ac != (verdict == "AC"):
                            return (
                                VerificationStatus.REJECTED,
                                f"Status mismatch: remote status {remote_status}, expected {verdict}",
                            )
                        return VerificationStatus.VERIFIED, f"Luogu record {rid} matched status {remote_status}"
                    elif "您无权查看此评测记录" in text or "隐私保护" in text:
                        return (
                            VerificationStatus.FALLBACK_TRUSTED,
                            "User has code/record privacy protection enabled; fallback trusted.",
                        )
                    else:
                        return VerificationStatus.FALLBACK_TRUSTED, "Could not extract record object from 200 response"
                elif resp.status_code in (403, 429):
                    # 遭遇洛谷反爬或封 IP，触发核心回退机制
                    if retry_count < 3:
                        return VerificationStatus.OPTIMISTIC, f"Luogu WAF/403: retry later ({retry_count + 1}/3)"
                    return (
                        VerificationStatus.FALLBACK_TRUSTED,
                        "Luogu returned 403/WAF; fallback trusted.",
                    )
                elif resp.status_code == 404:
                    return VerificationStatus.REJECTED, f"Record rid {rid} not found on Luogu (404)"
                else:
                    return VerificationStatus.FALLBACK_TRUSTED, f"Luogu returned HTTP {resp.status_code}"
            except (httpx.TimeoutException, httpx.NetworkError) as e:
                if retry_count < 3:
                    return VerificationStatus.OPTIMISTIC, f"Network timeout: {e}"
                return VerificationStatus.FALLBACK_TRUSTED, "Network timeout; fallback trusted."

    # -------------------------------------------------------------
    # 3. 力扣公开 GraphQL recentACSubmissions 免登核实
    # -------------------------------------------------------------
    async def _verify_leetcode(
        self,
        submission_id: str,
        problem_id: str,
        verdict: str,
        handle: Optional[str],
        retry_count: int,
    ) -> Tuple[str, Optional[str]]:
        # 力扣若为非 AC 记录或用户 Handle 未提供，直接采信
        if verdict != "AC" or not handle:
            return (
                VerificationStatus.FALLBACK_TRUSTED,
                "LeetCode non-AC or handle not available; fallback trusted.",
            )

        graphql_url = "https://leetcode.cn/graphql/noj-go/"
        query = {
            "query": """
            query recentAcSubmissions($userSlug: String!) {
              recentACSubmissions(userSlug: $userSlug) {
                submissionId
                submitTime
                question {
                  title
                  translatedTitle
                  titleSlug
                  questionFrontendId
                }
              }
            }
            """,
            "variables": {"userSlug": handle},
            "operationName": "recentAcSubmissions",
        }

        async with httpx.AsyncClient(timeout=10.0, headers=self.headers, follow_redirects=True) as client:
            try:
                resp = await client.post(graphql_url, json=query)
                if resp.status_code == 200:
                    data = resp.json()
                    recent_list = data.get("data", {}).get("recentACSubmissions", [])
                    clean_target = problem_id.replace("leetcode_", "").strip().lower()

                    for item in recent_list:
                        sub_id = str(item.get("submissionId", ""))
                        q = item.get("question", {})
                        title_slug = q.get("titleSlug", "").strip().lower()
                        frontend_id = q.get("questionFrontendId", "").strip().lower()

                        if sub_id == str(submission_id) or title_slug == clean_target or frontend_id == clean_target:
                            return (
                                VerificationStatus.VERIFIED,
                                f"Verified via LeetCode public recentACSubmissions for {handle}",
                            )

                    # 若不在最近 15 条中，可能被顶出或提交稍有延迟，回退采信
                    return (
                        VerificationStatus.FALLBACK_TRUSTED,
                        "Not in public recent 15 AC items; fallback trusted.",
                    )
                elif resp.status_code in (403, 429):
                    if retry_count < 3:
                        return VerificationStatus.OPTIMISTIC, f"LeetCode GraphQL 403 WAF: retry later ({retry_count + 1}/3)"
                    return (
                        VerificationStatus.FALLBACK_TRUSTED,
                        "LeetCode WAF blocked; fallback trusted.",
                    )
                else:
                    return VerificationStatus.FALLBACK_TRUSTED, f"LeetCode returned HTTP {resp.status_code}"
            except Exception as e:
                if retry_count < 3:
                    return VerificationStatus.OPTIMISTIC, f"LeetCode error: {e}"
                return VerificationStatus.FALLBACK_TRUSTED, f"LeetCode verify failed: {e}; fallback trusted."

    # -------------------------------------------------------------
    # 4. AtCoder 单点提交页核实
    # -------------------------------------------------------------
    async def _verify_atcoder(
        self,
        sid: str,
        problem_id: str,
        verdict: str,
        handle: Optional[str],
        problem_url: Optional[str],
        retry_count: int,
    ) -> Tuple[str, Optional[str]]:
        contest_id = "practice"
        if problem_url:
            m = re.search(r"/contests/([^/]+)/", problem_url)
            if m:
                contest_id = m.group(1)

        url = f"https://atcoder.jp/contests/{contest_id}/submissions/{sid}"
        async with httpx.AsyncClient(timeout=10.0, headers=self.headers, follow_redirects=True) as client:
            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    soup = BeautifulSoup(resp.text, "html.parser")
                    status_span = soup.find("span", class_=re.compile(r"label-(success|warning|danger)"))
                    if status_span:
                        status_text = status_span.get_text(strip=True)
                        is_ac = status_text == "AC"
                        if is_ac == (verdict == "AC"):
                            return VerificationStatus.VERIFIED, f"AtCoder submission {sid} verified ({status_text})"
                        else:
                            return (
                                VerificationStatus.REJECTED,
                                f"AtCoder status mismatch: expected {verdict}, got {status_text}",
                            )
                    return VerificationStatus.FALLBACK_TRUSTED, "Could not locate status badge in AtCoder HTML"
                elif resp.status_code in (403, 429):
                    if retry_count < 3:
                        return VerificationStatus.OPTIMISTIC, f"AtCoder rate limit {resp.status_code}"
                    return (
                        VerificationStatus.FALLBACK_TRUSTED,
                        f"AtCoder rate limited ({resp.status_code}); fallback trusted.",
                    )
                elif resp.status_code == 404:
                    return VerificationStatus.REJECTED, f"Submission {sid} not found on AtCoder (404)"
                else:
                    return VerificationStatus.FALLBACK_TRUSTED, f"AtCoder returned HTTP {resp.status_code}"
            except Exception as e:
                if retry_count < 3:
                    return VerificationStatus.OPTIMISTIC, f"AtCoder verify error: {e}"
                return VerificationStatus.FALLBACK_TRUSTED, f"AtCoder verify exception: {e}"

    # -------------------------------------------------------------
    # 5. AcWing 适配与回退策略
    # -------------------------------------------------------------
    async def _verify_acwing(
        self,
        submission_id: str,
        problem_id: str,
        verdict: str,
        handle: Optional[str],
        retry_count: int,
    ) -> Tuple[str, Optional[str]]:
        # AcWing 提交详情强绑定用户个人 Session Cookie，服务端无凭据情况下自动采信油猴拦截的精确报文
        return (
            VerificationStatus.FALLBACK_TRUSTED,
            "AcWing requires authenticated user session; trusted via client-side Tampermonkey push.",
        )


# 单例 Worker 实例
verification_worker_instance = VerificationWorker()

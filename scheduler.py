import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, List, Tuple, Optional

from db import (
    get_all_configs,
    get_config,
    set_config,
    save_submissions,
    save_contests,
    update_platform_status,
    get_all_user_ids,
    cleanup_luogu_placeholder_dates,
    cleanup_acwing_old_problem_rows,
    get_beijing_now,
    get_platform_accounts,
    get_account_by_id,
    update_platform_account,
    sync_mistakes_with_submissions
)
from fetchers import CodeforcesFetcher, LuoguFetcher, AcWingFetcher, AtCoderFetcher, ContestFetcher

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("OIBoardScheduler")

def sanitize_proxy(proxy: Optional[str]) -> Optional[str]:
    """严格净化校验出站代理协议，防止非法格式导致 httpx 抛出 ValueError 崩溃"""
    if not proxy:
        return None
    p = str(proxy).strip()
    if not p:
        return None
    valid_schemes = ("http://", "https://", "socks5://", "socks5h://", "socks4://")
    if any(p.lower().startswith(s) for s in valid_schemes):
        return p
    logger.warning(f"忽略格式非法的出站代理: {p!r}，已自动回退为直连")
    return None

class TaskScheduler:
    def __init__(self):
        self.cf_fetcher = CodeforcesFetcher()
        self.luogu_fetcher = LuoguFetcher()
        self.acwing_fetcher = AcWingFetcher()
        self.atcoder_fetcher = AtCoderFetcher()
        self.contest_fetcher = ContestFetcher()
        self._is_running = False
        self._sync_lock = asyncio.Lock()
        self._last_contest_sync = 0

    async def _sync_account_worker(self, acc: Dict[str, Any], user_id: int, proxy: str = "") -> Tuple[bool, str, int, str]:
        """同步单个账号的数据，返回 (success, message, count, rating)"""
        platform = acc["platform"]
        handle = acc["handle"].strip()
        cookie = acc.get("cookie", "").strip()
        account_id = acc["id"]
        now_str = get_beijing_now().strftime("%Y-%m-%d %H:%M:%S")

        subs = []
        msg = ""
        rating_val = acc.get("rating", "")

        try:
            if platform == "codeforces":
                if not handle:
                    return False, "未填写 Handle", 0, ""
                valid, v_msg, extra = await self.cf_fetcher.verify(handle, proxy=proxy)
                if valid and "rating" in extra:
                    rating_val = str(extra["rating"])

                sub_list, msg = await self.cf_fetcher.fetch_submissions(handle, proxy=proxy)
                subs = sub_list

            elif platform == "luogu":
                if not handle and not cookie:
                    return False, "未配置 UID 或 Cookie", 0, ""
                sub_list, msg = await self.luogu_fetcher.fetch_submissions(handle, cookie, proxy=proxy)
                subs = sub_list
                if subs:
                    cleanup_luogu_placeholder_dates(user_id)

            elif platform == "acwing":
                if not handle and not cookie:
                    return False, "未配置用户ID或Cookie", 0, ""
                sub_list, msg = await self.acwing_fetcher.fetch_submissions(handle, cookie, proxy=proxy)
                subs = sub_list
                if subs:
                    cleanup_acwing_old_problem_rows(user_id)

            elif platform == "atcoder":
                if not handle:
                    return False, "未填写 Handle", 0, ""
                valid, v_msg, extra = await self.atcoder_fetcher.verify(handle, proxy=proxy)
                if valid and "rating" in extra:
                    rating_val = str(extra["rating"])

                sub_list, msg = await self.atcoder_fetcher.fetch_submissions(handle, proxy=proxy)
                subs = sub_list

            if subs:
                sub_dicts = []
                for s in subs:
                    d = s.to_dict()
                    d["account_handle"] = handle
                    sub_dicts.append(d)
                save_submissions(sub_dicts, user_id=user_id)
                try:
                    sync_mistakes_with_submissions(user_id=user_id)
                except Exception as e:
                    logger.exception(f"Error syncing mistakes for user {user_id}: {e}")
                update_platform_account(
                    account_id, user_id,
                    status="ok",
                    status_message=f"同步成功: {len(subs)}条",
                    item_count=len(subs),
                    rating=rating_val,
                    last_synced_at=now_str
                )
                return True, f"成功同步 {len(subs)} 条", len(subs), rating_val
            else:
                if "失败" in msg or "错误" in msg or "异常" in msg or "拦截" in msg or "拒绝" in msg:
                    update_platform_account(
                        account_id, user_id,
                        status="error",
                        status_message=msg,
                        rating=rating_val,
                        last_synced_at=now_str
                    )
                    return False, msg, 0, rating_val
                else:
                    update_platform_account(
                        account_id, user_id,
                        status="ok",
                        status_message="同步成功: 0条",
                        item_count=0,
                        rating=rating_val,
                        last_synced_at=now_str
                    )
                    return True, "同步成功: 0条", 0, rating_val

        except Exception as e:
            err_msg = f"异常: {str(e)}"
            update_platform_account(
                account_id, user_id,
                status="error",
                status_message=err_msg,
                last_synced_at=now_str
            )
            return False, err_msg, 0, rating_val

    async def sync_platform(self, platform: str, user_id: int = 1) -> Dict[str, Any]:
        """单用户单平台多账号同步逻辑"""
        configs = get_all_configs(user_id)
        proxy = sanitize_proxy(configs.get("http_proxy", ""))
        res = {"platform": platform, "success": False, "message": "", "count": 0}

        accounts = get_platform_accounts(user_id, platform)
        if not accounts:
            update_platform_status(user_id, platform, "unconfigured", "未配置账号")
            res["message"] = "未配置账号"
            return res

        total_synced = 0
        success_count = 0
        messages = []
        best_rating = ""

        for acc in accounts:
            ok, msg, cnt, r = await self._sync_account_worker(acc, user_id, proxy=proxy)
            if ok:
                success_count += 1
                total_synced += cnt
            if r and (not best_rating or best_rating == "Unrated"):
                best_rating = r
            messages.append(f"{acc.get('alias') or acc['handle']}: {msg}")

        overall_msg = "; ".join(messages)
        if success_count > 0:
            status = "ok"
            res.update({"success": True, "message": overall_msg, "count": total_synced})
        else:
            status = "error"
            res.update({"success": False, "message": overall_msg, "count": 0})

        update_platform_status(user_id, platform, status, overall_msg, item_count=total_synced, rating=best_rating)
        return res

    async def sync_single_account(self, account_id: int, user_id: int) -> Dict[str, Any]:
        """同步单个指定账号"""
        acc = get_account_by_id(account_id, user_id)
        if not acc:
            return {"success": False, "message": "账号不存在", "count": 0}
        configs = get_all_configs(user_id)
        proxy = sanitize_proxy(configs.get("http_proxy", ""))
        ok, msg, cnt, r = await self._sync_account_worker(acc, user_id, proxy=proxy)

        # 刷新平台整体状态
        accounts = get_platform_accounts(user_id, acc["platform"])
        has_ok = any(a["status"] == "ok" for a in accounts)
        update_platform_status(user_id, acc["platform"], "ok" if has_ok else "error", msg, rating=r)
        return {"success": ok, "message": msg, "count": cnt, "new_submissions": cnt}

    async def sync_contests(self) -> Dict[str, Any]:
        """抓取并保存跨平台比赛列表 (Codeforces, AtCoder, Luogu)"""
        logger.info("开始同步跨平台比赛列表 (Codeforces, AtCoder, Luogu)...")
        try:
            proxy = sanitize_proxy(get_config(1, "http_proxy", default=""))
            contests = await self.contest_fetcher.fetch_all_contests(proxy=proxy)
            inserted = save_contests(contests)
            self._last_contest_sync = int(datetime.now().timestamp())
            logger.info(f"比赛列表同步完成: 共更新 {len(contests)} 场比赛")
            return {"success": True, "count": len(contests), "message": f"成功更新 {len(contests)} 场比赛"}
        except Exception as e:
            logger.exception("同步比赛列表异常")
            return {"success": False, "count": 0, "message": f"同步比赛异常: {str(e)}"}

    async def sync_all(self, user_id: int = 1) -> Dict[str, Any]:
        """全并发同步指定用户的所有平台数据及全局比赛列表"""
        async with self._sync_lock:
            logger.info(f"Starting concurrent full sync for user {user_id}...")
            
            p_tasks = [
                self.sync_platform("codeforces", user_id=user_id),
                self.sync_platform("luogu", user_id=user_id),
                self.sync_platform("acwing", user_id=user_id),
                self.sync_platform("atcoder", user_id=user_id),
                self.sync_contests(),
            ]
            
            p_results = await asyncio.gather(*p_tasks, return_exceptions=True)
            
            results = {}
            for i, p in enumerate(["codeforces", "luogu", "acwing", "atcoder"]):
                res = p_results[i]
                if isinstance(res, Exception):
                    logger.error(f"Sync platform {p} exception: {res}")
                    results[p] = {"platform": p, "success": False, "message": str(res), "count": 0}
                else:
                    results[p] = res

            try:
                sync_mistakes_with_submissions(user_id=user_id)
            except Exception as e:
                logger.exception(f"Sync mistakes in sync_all failed: {e}")

            now_str = get_beijing_now().strftime("%Y-%m-%d %H:%M:%S")
            set_config(user_id, "last_sync_time", now_str)
            logger.info(f"Concurrent full sync finished for user {user_id} at {now_str}")
            return {"results": results, "synced_at": now_str}

    async def run_loop(self):
        """后台轮询主循环 (支持多用户独立调度)"""
        self._is_running = True
        logger.info("Scheduler background loop started.")
        
        while self._is_running:
            try:
                user_ids = get_all_user_ids()
                for uid in user_ids:
                    configs = get_all_configs(uid)
                    sprint = configs.get("sprint_mode", "false") == "true"
                    interval = 5 if sprint else int(configs.get("poll_interval_minutes", "30"))
                    
                    last_sync = configs.get("last_sync_time", "")
                    should_sync = False
                    if not last_sync:
                        should_sync = True
                    else:
                        try:
                            last_dt = datetime.strptime(last_sync, "%Y-%m-%d %H:%M:%S")
                            if (get_beijing_now().replace(tzinfo=None) - last_dt).total_seconds() >= interval * 60:
                                should_sync = True
                        except Exception:
                            should_sync = True

                    if should_sync:
                        logger.info(f"Scheduled sync triggered for user {uid} (interval={interval}m)")
                        await self.sync_all(user_id=uid)
                        
            except Exception as e:
                logger.error(f"Scheduler loop error: {str(e)}")
                
            await asyncio.sleep(60)

scheduler_instance = TaskScheduler()

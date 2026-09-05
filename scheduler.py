import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, List

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
    get_beijing_now
)
from fetchers import CodeforcesFetcher, LuoguFetcher, AcWingFetcher, AtCoderFetcher, ContestFetcher

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("OIBoardScheduler")

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

    async def sync_platform(self, platform: str, user_id: int = 1) -> Dict[str, Any]:
        """单用户单平台同步逻辑 (精简极速版)"""
        configs = get_all_configs(user_id)
        proxy = configs.get("http_proxy", "").strip()
        res = {"platform": platform, "success": False, "message": "", "count": 0}

        try:
            if platform == "codeforces":
                handle = configs.get("cf_handle", "").strip()
                if not handle:
                    update_platform_status(user_id, "codeforces", "unconfigured", "未配置 Handle")
                    res["message"] = "未配置 Handle"
                    return res

                subs, msg = await self.cf_fetcher.fetch_submissions(handle, proxy=proxy)
                if subs:
                    inserted = save_submissions([s.to_dict() for s in subs], user_id=user_id)
                    update_platform_status(user_id, "codeforces", "ok", f"同步成功: {len(subs)}条", item_count=len(subs))
                    res.update({"success": True, "message": f"成功同步 {len(subs)} 条", "count": len(subs)})
                else:
                    if "失败" in msg or "错误" in msg:
                        update_platform_status(user_id, "codeforces", "error", msg)
                        res.update({"success": False, "message": msg})
                    else:
                        update_platform_status(user_id, "codeforces", "ok", "同步成功: 0条", item_count=0)
                        res.update({"success": True, "message": "同步成功: 0条", "count": 0})

            elif platform == "luogu":
                uid = configs.get("luogu_uid", "").strip()
                cookie = configs.get("luogu_cookie", "").strip()
                if not uid:
                    update_platform_status(user_id, "luogu", "unconfigured", "未配置 UID")
                    res["message"] = "未配置 UID"
                    return res

                subs, msg = await self.luogu_fetcher.fetch_submissions(uid, cookie, proxy=proxy)
                if subs:
                    cleanup_luogu_placeholder_dates(user_id)
                    inserted = save_submissions([s.to_dict() for s in subs], user_id=user_id)
                    update_platform_status(user_id, "luogu", "ok", f"同步成功: {len(subs)}条", item_count=len(subs))
                    res.update({"success": True, "message": f"成功同步 {len(subs)} 条", "count": len(subs)})
                else:
                    if "失败" in msg or "异常" in msg:
                        update_platform_status(user_id, "luogu", "error", msg)
                        res.update({"success": False, "message": msg})
                    else:
                        update_platform_status(user_id, "luogu", "ok", "同步成功: 0条", item_count=0)
                        res.update({"success": True, "message": "同步成功: 0条", "count": 0})

            elif platform == "acwing":
                target_uid = configs.get("acwing_user_id", "").strip()
                cookie = configs.get("acwing_cookie", "").strip()
                if not target_uid and not cookie:
                    update_platform_status(user_id, "acwing", "unconfigured", "未配置用户ID或Cookie")
                    res["message"] = "未配置用户ID或Cookie"
                    return res

                subs, msg = await self.acwing_fetcher.fetch_submissions(target_uid, cookie, proxy=proxy)
                if subs:
                    cleanup_acwing_old_problem_rows(user_id)
                    inserted = save_submissions([s.to_dict() for s in subs], user_id=user_id)
                    update_platform_status(user_id, "acwing", "ok", f"同步成功: {len(subs)}条", item_count=len(subs))
                    res.update({"success": True, "message": f"成功同步 {len(subs)} 条", "count": len(subs)})
                else:
                    if "失败" in msg or "异常" in msg:
                        update_platform_status(user_id, "acwing", "error", msg)
                        res.update({"success": False, "message": msg})
                    else:
                        update_platform_status(user_id, "acwing", "ok", "同步成功: 0条", item_count=0)
                        res.update({"success": True, "message": "同步成功: 0条", "count": 0})

            elif platform == "atcoder":
                handle = configs.get("atcoder_handle", "").strip()
                if not handle:
                    update_platform_status(user_id, "atcoder", "unconfigured", "未配置 Handle")
                    res["message"] = "未配置 Handle"
                    return res

                subs, msg = await self.atcoder_fetcher.fetch_submissions(handle, proxy=proxy)
                if subs:
                    inserted = save_submissions([s.to_dict() for s in subs], user_id=user_id)
                    update_platform_status(user_id, "atcoder", "ok", f"同步成功: {len(subs)}条", item_count=len(subs))
                    res.update({"success": True, "message": f"成功同步 {len(subs)} 条", "count": len(subs)})
                else:
                    if "失败" in msg or "错误" in msg:
                        update_platform_status(user_id, "atcoder", "error", msg)
                        res.update({"success": False, "message": msg})
                    else:
                        update_platform_status(user_id, "atcoder", "ok", "同步成功: 0条", item_count=0)
                        res.update({"success": True, "message": "同步成功: 0条", "count": 0})

        except Exception as e:
            logger.error(f"Sync user {user_id} error for {platform}: {str(e)}")
            update_platform_status(user_id, platform, "error", f"异常: {str(e)}")
            res.update({"success": False, "message": f"异常: {str(e)}"})

        return res

    async def sync_contests(self) -> Dict[str, Any]:
        """抓取并保存跨平台比赛列表 (Codeforces, AtCoder, Luogu)"""
        logger.info("开始同步跨平台比赛列表 (Codeforces, AtCoder, Luogu)...")
        try:
            proxy = get_config(1, "http_proxy", default="")
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

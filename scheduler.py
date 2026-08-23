import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, List

from db import (
    get_all_configs,
    get_config,
    set_config,
    save_submissions,
    update_platform_status,
    get_all_user_ids
)
from fetchers import CodeforcesFetcher, LuoguFetcher, AcWingFetcher

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("OIBoardScheduler")

class TaskScheduler:
    def __init__(self):
        self.cf_fetcher = CodeforcesFetcher()
        self.luogu_fetcher = LuoguFetcher()
        self.acwing_fetcher = AcWingFetcher()
        self._is_running = False
        self._sync_lock = asyncio.Lock()

    async def sync_platform(self, platform: str, user_id: int = 1) -> Dict[str, Any]:
        """单用户单平台同步逻辑"""
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
                
                # 先验证/获取 rating
                valid, v_msg, extra = await self.cf_fetcher.verify(handle, proxy=proxy)
                rating_str = extra.get("rating", "") if valid else ""
                
                subs, msg = await self.cf_fetcher.fetch_submissions(handle, proxy=proxy)
                if subs:
                    inserted = save_submissions([s.to_dict() for s in subs], user_id=user_id)
                    update_platform_status(user_id, "codeforces", "ok", f"同步成功: {len(subs)}条", item_count=len(subs), rating=rating_str)
                    res.update({"success": True, "message": f"成功同步 {len(subs)} 条", "count": len(subs)})
                else:
                    status = "warning" if valid else "error"
                    update_platform_status(user_id, "codeforces", status, msg, rating=rating_str)
                    res.update({"success": valid, "message": msg})

            elif platform == "luogu":
                uid = configs.get("luogu_uid", "").strip()
                cookie = configs.get("luogu_cookie", "").strip()
                if not uid:
                    update_platform_status(user_id, "luogu", "unconfigured", "未配置 UID")
                    res["message"] = "未配置 UID"
                    return res

                valid, v_msg, extra = await self.luogu_fetcher.verify(uid, cookie, proxy=proxy)
                rating_str = extra.get("ranking", "") if valid else ""

                subs, msg = await self.luogu_fetcher.fetch_submissions(uid, cookie, proxy=proxy)
                if subs:
                    inserted = save_submissions([s.to_dict() for s in subs], user_id=user_id)
                    update_platform_status(user_id, "luogu", "ok", f"同步成功: {len(subs)}条", item_count=len(subs), rating=rating_str)
                    res.update({"success": True, "message": f"成功同步 {len(subs)} 条", "count": len(subs)})
                else:
                    status = "warning" if valid else "error"
                    update_platform_status(user_id, "luogu", status, msg, rating=rating_str)
                    res.update({"success": valid, "message": msg})

            elif platform == "acwing":
                target_uid = configs.get("acwing_user_id", "").strip()
                cookie = configs.get("acwing_cookie", "").strip()
                if not target_uid and not cookie:
                    update_platform_status(user_id, "acwing", "unconfigured", "未配置用户ID或Cookie")
                    res["message"] = "未配置用户ID或Cookie"
                    return res

                valid, v_msg, extra = await self.acwing_fetcher.verify(target_uid, cookie, proxy=proxy)
                subs, msg = await self.acwing_fetcher.fetch_submissions(target_uid, cookie, proxy=proxy)
                if subs:
                    inserted = save_submissions([s.to_dict() for s in subs], user_id=user_id)
                    update_platform_status(user_id, "acwing", "ok", f"同步成功: {len(subs)}条", item_count=len(subs))
                    res.update({"success": True, "message": f"成功同步 {len(subs)} 条", "count": len(subs)})
                else:
                    status = "warning" if valid else "error"
                    update_platform_status(user_id, "acwing", status, msg)
                    res.update({"success": valid, "message": msg})

        except Exception as e:
            logger.error(f"Sync user {user_id} error for {platform}: {str(e)}")
            update_platform_status(user_id, platform, "error", f"异常: {str(e)}")
            res.update({"success": False, "message": f"异常: {str(e)}"})

        return res

    async def sync_all(self, user_id: int = 1) -> Dict[str, Any]:
        """同步指定用户的所有平台数据"""
        async with self._sync_lock:
            logger.info(f"Starting full sync for user {user_id}...")
            results = {}
            for p in ["codeforces", "luogu", "acwing"]:
                results[p] = await self.sync_platform(p, user_id=user_id)
            
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            set_config(user_id, "last_sync_time", now_str)
            logger.info(f"Full sync finished for user {user_id} at {now_str}")
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
                            if (datetime.now() - last_dt).total_seconds() >= interval * 60:
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

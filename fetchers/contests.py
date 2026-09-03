import re
import json
import httpx
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple
from fetchers.base import BEIJING_TZ, format_beijing_time_and_date, get_beijing_now

logger = logging.getLogger("ContestFetcher")

LUOGU_RULE_TYPES = {
    1: "ACM/ICPC",
    2: "OI",
    3: "乐多",
    4: "IOI",
    5: "Codeforces"
}

def format_duration_seconds(sec: int) -> str:
    if sec <= 0:
        return "未知"
    hours = sec // 3600
    mins = (sec % 3600) // 60
    if hours > 0 and mins > 0:
        return f"{hours}小时{mins}分"
    elif hours > 0:
        return f"{hours}小时"
    else:
        return f"{mins}分钟"

class ContestFetcher:
    def __init__(self):
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        }

    async def fetch_codeforces_contests(self, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
        """抓取 Codeforces 即将举行和正在进行中的比赛"""
        contests = []
        try:
            url = "https://codeforces.com/api/contest.list?gym=false"
            res = await client.get(url, timeout=15.0)
            if res.status_code == 200:
                data = res.json()
                if data.get("status") == "OK":
                    now_ts = int(datetime.now(timezone.utc).timestamp())
                    for c in data.get("result", []):
                        phase_raw = c.get("phase", "")
                        if phase_raw not in ("BEFORE", "CODING"):
                            continue

                        cid = str(c.get("id"))
                        name = c.get("name", "")
                        start_ts = int(c.get("startTimeSeconds", 0))
                        dur_sec = int(c.get("durationSeconds", 7200))
                        end_ts = start_ts + dur_sec

                        if now_ts < start_ts:
                            phase = "BEFORE"
                        elif now_ts < end_ts:
                            phase = "CODING"
                        else:
                            phase = "FINISHED"

                        start_time_str, _ = format_beijing_time_and_date(start_ts)

                        contests.append({
                            "id": f"cf_{cid}",
                            "platform": "codeforces",
                            "raw_id": cid,
                            "name": name,
                            "start_time": start_time_str,
                            "start_timestamp": start_ts,
                            "duration_seconds": dur_sec,
                            "duration_str": format_duration_seconds(dur_sec),
                            "url": f"https://codeforces.com/contest/{cid}",
                            "phase": phase,
                            "rule_type": c.get("type", "CF"),
                            "updated_at": get_beijing_now().strftime("%Y-%m-%d %H:%M:%S")
                        })
        except Exception as e:
            logger.warning(f"抓取 Codeforces 比赛列表异常: {e}")
        return contests

    async def fetch_atcoder_contests(self, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
        """抓取 AtCoder 官方即将举行与进行中的比赛"""
        contests = []
        try:
            url = "https://atcoder.jp/contests/"
            res = await client.get(url, timeout=15.0)
            if res.status_code == 200:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(res.text, "html.parser")
                now_ts = int(datetime.now(timezone.utc).timestamp())

                # 提取正在进行 (#contest-table-action) 与 即将开始 (#contest-table-upcoming)
                for tbl_id in ("#contest-table-action", "#contest-table-upcoming"):
                    table = soup.select_one(tbl_id)
                    if not table:
                        continue
                    
                    for tr in table.select("tbody tr"):
                        tds = tr.select("td")
                        if len(tds) < 2:
                            continue

                        # 1. 解析时间 (如 "2026-09-05 21:00:00+0900")
                        time_elem = tds[0].select_one("a, time")
                        raw_time_str = time_elem.get_text().strip() if time_elem else tds[0].get_text().strip()
                        
                        start_ts = 0
                        start_time_str = ""
                        try:
                            # 替换 "+0900" 为标准 timezone
                            clean_time = raw_time_str.replace("+0900", "+09:00").replace("+09", "+09:00")
                            dt = datetime.fromisoformat(clean_time)
                            dt_beijing = dt.astimezone(BEIJING_TZ)
                            start_time_str = dt_beijing.strftime("%Y-%m-%d %H:%M:%S")
                            start_ts = int(dt.timestamp())
                        except Exception:
                            # 尝试正则
                            m = re.search(r'(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})', raw_time_str)
                            if m:
                                try:
                                    dt_jst = datetime.strptime(m.group(1), "%Y-%m-%d %H:%M").replace(tzinfo=timezone(timedelta(hours=9)))
                                    dt_beijing = dt_jst.astimezone(BEIJING_TZ)
                                    start_time_str = dt_beijing.strftime("%Y-%m-%d %H:%M:%S")
                                    start_ts = int(dt_jst.timestamp())
                                except Exception:
                                    pass

                        # 2. 比赛名称与链接
                        name_elem = tds[1].select_one("a[href*='/contests/']")
                        if not name_elem:
                            continue
                        name = name_elem.get_text().strip()
                        href = name_elem.get("href", "")
                        cid = href.split("/")[-1] if href else name

                        # 3. 比赛时长 (如 "02:00", "01:40")
                        dur_str_raw = tds[2].get_text().strip() if len(tds) >= 3 else "02:00"
                        dur_sec = 7200
                        if ":" in dur_str_raw:
                            try:
                                h, m = dur_str_raw.split(":")[:2]
                                dur_sec = int(h) * 3600 + int(m) * 60
                            except Exception:
                                pass

                        # 4. Rated 规则
                        rated_str = tds[3].get_text().strip() if len(tds) >= 4 else "Rated"

                        end_ts = start_ts + dur_sec
                        if now_ts < start_ts:
                            phase = "BEFORE"
                        elif now_ts < end_ts:
                            phase = "CODING"
                        else:
                            phase = "FINISHED"

                        contests.append({
                            "id": f"atcoder_{cid}",
                            "platform": "atcoder",
                            "raw_id": cid,
                            "name": name,
                            "start_time": start_time_str,
                            "start_timestamp": start_ts,
                            "duration_seconds": dur_sec,
                            "duration_str": format_duration_seconds(dur_sec),
                            "url": f"https://atcoder.jp{href}" if href.startswith("/") else href,
                            "phase": phase,
                            "rule_type": f"Rated ({rated_str})" if rated_str and rated_str != "-" else "Unrated",
                            "updated_at": get_beijing_now().strftime("%Y-%m-%d %H:%M:%S")
                        })
        except Exception as e:
            logger.warning(f"抓取 AtCoder 比赛列表异常: {e}")
        return contests

    async def fetch_luogu_contests(self, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
        """抓取洛谷官方即将举行与进行中的比赛"""
        contests = []
        try:
            url = "https://www.luogu.com.cn/contest/list"
            res = await client.get(url, timeout=15.0)
            if res.status_code == 200:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(res.text, "html.parser")
                raw_contests = []

                for script in soup.find_all("script"):
                    text = script.string or script.get_text() or ""
                    if '"template":"contest.list"' in text or '"contests"' in text:
                        try:
                            parsed = json.loads(text)
                            raw_contests = parsed.get("data", {}).get("contests", {}).get("result", []) or parsed.get("currentData", {}).get("contests", {}).get("result", [])
                            if raw_contests:
                                break
                        except Exception:
                            pass

                now_ts = int(datetime.now(timezone.utc).timestamp())
                for c in raw_contests:
                    cid = str(c.get("id"))
                    name = c.get("name", "")
                    start_ts = int(c.get("startTime", 0))
                    end_ts = int(c.get("endTime", 0))
                    dur_sec = max(1800, end_ts - start_ts) if end_ts > start_ts else 7200

                    # 仅保留未结束的比赛
                    if end_ts > 0 and end_ts < now_ts:
                        continue

                    if now_ts < start_ts:
                        phase = "BEFORE"
                    elif now_ts < end_ts:
                        phase = "CODING"
                    else:
                        phase = "FINISHED"

                    start_time_str, _ = format_beijing_time_and_date(start_ts)
                    rule_num = c.get("ruleType", 2)
                    rule_str = LUOGU_RULE_TYPES.get(rule_num, f"规则{rule_num}")

                    contests.append({
                        "id": f"luogu_{cid}",
                        "platform": "luogu",
                        "raw_id": cid,
                        "name": name,
                        "start_time": start_time_str,
                        "start_timestamp": start_ts,
                        "duration_seconds": dur_sec,
                        "duration_str": format_duration_seconds(dur_sec),
                        "url": f"https://www.luogu.com.cn/contest/{cid}",
                        "phase": phase,
                        "rule_type": rule_str,
                        "updated_at": get_beijing_now().strftime("%Y-%m-%d %H:%M:%S")
                    })
        except Exception as e:
            logger.warning(f"抓取洛谷比赛列表异常: {e}")
        return contests

    async def fetch_all_contests(self, proxy: str = "") -> List[Dict[str, Any]]:
        """并发抓取 Codeforces、AtCoder、洛谷三大平台所有未结束比赛"""
        proxy_url = proxy.strip() if proxy else None
        async with httpx.AsyncClient(timeout=20.0, proxy=proxy_url, follow_redirects=True, headers=self.headers) as client:
            cf_task = self.fetch_codeforces_contests(client)
            at_task = self.fetch_atcoder_contests(client)
            lg_task = self.fetch_luogu_contests(client)

            results = await asyncio.gather(cf_task, at_task, lg_task, return_exceptions=True)
            
            all_contests = []
            for res in results:
                if isinstance(res, list):
                    all_contests.extend(res)
                elif isinstance(res, Exception):
                    logger.warning(f"比赛抓取子任务失败: {res}")

            # 按开始时间由近及远升序排序
            all_contests.sort(key=lambda c: c.get("start_timestamp", 0))
            return all_contests

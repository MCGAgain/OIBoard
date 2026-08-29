from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

BEIJING_TZ = timezone(timedelta(hours=8))

import re

def get_beijing_now() -> datetime:
    return datetime.now(BEIJING_TZ)

def format_beijing_time_and_date(ts: int | float) -> Tuple[str, str]:
    """
    将时间戳转换为北京时间 (UTC+8) 格式化字符串，并计算归属统计日期。
    OIer 熬夜打卡机制：凌晨 04:00 前的提交自动归入前一天的统计日期。
    """
    if not ts:
        return "", ""
    dt = datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(BEIJING_TZ)
    submitted_at = dt.strftime("%Y-%m-%d %H:%M:%S")
    effective_dt = dt - timedelta(hours=4)
    date_str = effective_dt.strftime("%Y-%m-%d")
    return submitted_at, date_str

def parse_relative_or_absolute_time(time_str: str) -> Tuple[str, str]:
    """
    将中文相对时间 (如 '25分钟前', '刚刚', '昨天 20:30') 或绝对时间解析为标准北京时间 (YYYY-MM-DD HH:MM:SS) 及统计归属日期 (YYYY-MM-DD)。
    严格支持凌晨 04:00 前归入前一天的熬夜打卡规则。
    """
    if not time_str:
        return "", ""
    t_str = time_str.strip()
    now = get_beijing_now()
    dt = None

    if t_str in ("刚刚", "刚才"):
        dt = now
    elif "秒前" in t_str:
        m = re.search(r'(\d+)\s*秒前', t_str)
        sec = int(m.group(1)) if m else 0
        dt = now - timedelta(seconds=sec)
    elif "分钟前" in t_str:
        m = re.search(r'(\d+)\s*分钟前', t_str)
        mins = int(m.group(1)) if m else 0
        dt = now - timedelta(minutes=mins)
    elif "小时前" in t_str:
        m = re.search(r'(\d+)\s*小时前', t_str)
        hrs = int(m.group(1)) if m else 0
        dt = now - timedelta(hours=hrs)
    elif "天前" in t_str:
        m = re.search(r'(\d+)\s*天前', t_str)
        days = int(m.group(1)) if m else 0
        dt = now - timedelta(days=days)
    elif "昨天" in t_str:
        m = re.search(r'昨天\s*(\d{1,2}):(\d{1,2})', t_str)
        if m:
            h, mi = int(m.group(1)), int(m.group(2))
            dt = (now - timedelta(days=1)).replace(hour=h, minute=mi, second=0)
        else:
            dt = now - timedelta(days=1)
    elif "前天" in t_str:
        m = re.search(r'前天\s*(\d{1,2}):(\d{1,2})', t_str)
        if m:
            h, mi = int(m.group(1)), int(m.group(2))
            dt = (now - timedelta(days=2)).replace(hour=h, minute=mi, second=0)
        else:
            dt = now - timedelta(days=2)
    elif re.match(r'^\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}', t_str):
        try:
            full_str = f"{now.year}-{t_str}"
            dt = datetime.strptime(full_str[:16], "%Y-%m-%d %H:%M").replace(tzinfo=BEIJING_TZ)
        except Exception:
            pass
    elif re.match(r'^\d{4}-\d{1,2}-\d{1,2}', t_str):
        try:
            if len(t_str) == 10:
                dt = datetime.strptime(t_str, "%Y-%m-%d").replace(tzinfo=BEIJING_TZ)
            elif len(t_str) >= 16:
                dt = datetime.strptime(t_str[:16], "%Y-%m-%d %H:%M").replace(tzinfo=BEIJING_TZ)
        except Exception:
            pass

    if dt:
        sub_at = dt.strftime("%Y-%m-%d %H:%M:%S")
        effective_dt = dt - timedelta(hours=4)
        date_str = effective_dt.strftime("%Y-%m-%d")
        return sub_at, date_str

    return t_str, t_str[:10]

def parse_beijing_str_to_date(dt_str: str) -> str:
    """
    将北京时间字符串或相对时间转换为熬夜归属统计日期（凌晨 4 点前算作前一日）
    """
    if not dt_str:
        return ""
    _, date_str = parse_relative_or_absolute_time(dt_str)
    return date_str

@dataclass
class NormalizedSubmission:
    id: str                 # Unique ID, e.g. "cf_123456"
    platform: str           # "codeforces" | "luogu" | "acwing"
    raw_id: str             # Original submission ID
    problem_id: str         # "1900A", "P1001", "844"
    problem_title: str      # "Watermelon", "走迷宫"
    verdict: str            # "AC" | "WA" | "TLE" | "MLE" | "RE" | "CE" | "OTHER"
    tags: List[str] = field(default_factory=list)
    difficulty: str = ""
    difficulty_score: int = 0
    submitted_at: str = ""  # "YYYY-MM-DD HH:MM:SS"
    date: str = ""          # "YYYY-MM-DD"
    submission_url: str = ""
    code_language: str = ""
    extra_data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "platform": self.platform,
            "raw_id": self.raw_id,
            "problem_id": self.problem_id,
            "problem_title": self.problem_title,
            "verdict": self.verdict,
            "tags": self.tags,
            "difficulty": self.difficulty,
            "difficulty_score": self.difficulty_score,
            "submitted_at": self.submitted_at,
            "date": self.date,
            "submission_url": self.submission_url,
            "code_language": self.code_language,
            "extra_data": self.extra_data,
        }

class BaseFetcher(ABC):
    platform_name: str = ""

    @abstractmethod
    async def verify(self, **kwargs) -> Tuple[bool, str, Dict[str, Any]]:
        """
        验证账号/Cookie有效性
        返回: (is_valid, message, extra_info)
        """
        pass

    @abstractmethod
    async def fetch_submissions(self, **kwargs) -> Tuple[List[NormalizedSubmission], str]:
        """
        抓取提交记录
        返回: (submissions_list, error_or_success_message)
        """
        pass

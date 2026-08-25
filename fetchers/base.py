from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

BEIJING_TZ = timezone(timedelta(hours=8))

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

def parse_beijing_str_to_date(dt_str: str) -> str:
    """
    将北京时间字符串转换为熬夜归属统计日期（凌晨 4 点前算作前一日）
    """
    if not dt_str:
        return ""
    try:
        dt = datetime.strptime(dt_str[:19], "%Y-%m-%d %H:%M:%S")
        effective_dt = dt - timedelta(hours=4)
        return effective_dt.strftime("%Y-%m-%d")
    except Exception:
        return dt_str[:10]

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

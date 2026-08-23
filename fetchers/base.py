from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

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

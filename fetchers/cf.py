import httpx
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Tuple
from fetchers.base import BaseFetcher, NormalizedSubmission, format_beijing_time_and_date

CF_TAG_TRANSLATIONS = {
    "dp": "动态规划",
    "greedy": "贪心",
    "math": "数学",
    "implementation": "模拟/实现",
    "constructive algorithms": "构造",
    "brute force": "暴力",
    "data structures": "数据结构",
    "dfs and similar": "深度优先搜索",
    "graphs": "图论",
    "binary search": "二分查找",
    "trees": "树论",
    "strings": "字符串",
    "number theory": "数论",
    "combinatorics": "组合数学",
    "two pointers": "双指针",
    "geometry": "计算几何",
    "bitmasks": "状态压缩/位运算",
    "dsu": "并查集",
    "sortings": "排序",
    "probabilities": "概率与期望",
    "shortest paths": "最短路",
    "divide and conquer": "分治",
    "games": "博弈论",
    "flows": "网络流",
    "interactive": "交互题",
    "matrices": "矩阵",
    "string suffix structures": "后缀结构",
    "fft": "快速傅里叶变换",
    "2-sat": "2-SAT",
    "hashing": "哈希",
    "ternary search": "三分搜索",
    "meet-in-the-middle": "折半搜索",
}

class CodeforcesFetcher(BaseFetcher):
    platform_name = "codeforces"
    BASE_URL = "https://codeforces.com/api"

    def _normalize_verdict(self, raw_verdict: str) -> str:
        if raw_verdict == "OK":
            return "AC"
        elif raw_verdict == "WRONG_ANSWER":
            return "WA"
        elif raw_verdict == "TIME_LIMIT_EXCEEDED":
            return "TLE"
        elif raw_verdict == "MEMORY_LIMIT_EXCEEDED":
            return "MLE"
        elif raw_verdict == "COMPILATION_ERROR":
            return "CE"
        elif raw_verdict == "RUNTIME_ERROR":
            return "RE"
        else:
            return "OTHER"

    async def verify(self, handle: str, proxy: str = "") -> Tuple[bool, str, Dict[str, Any]]:
        if not handle:
            return False, "Handle 未填写", {}
        url = f"{self.BASE_URL}/user.info?handles={handle.strip()}"
        try:
            proxy_url = proxy.strip() if proxy else None
            async with httpx.AsyncClient(timeout=15.0, proxy=proxy_url, trust_env=True) as client:
                res = await client.get(url)
                if res.status_code == 200:
                    data = res.json()
                    if data.get("status") == "OK" and data.get("result"):
                        user_info = data["result"][0]
                        rating = user_info.get("rating", "Unrated")
                        rank = user_info.get("rank", "")
                        return True, f"验证成功 (Rating: {rating}, Rank: {rank})", {
                            "rating": str(rating),
                            "rank": rank,
                            "avatar": user_info.get("titlePhoto", "")
                        }
                    return False, f"用户不存在: {data.get('comment', '未知错误')}", {}
                return False, f"请求失败: HTTP {res.status_code}", {}
        except Exception as e:
            return False, f"网络错误: {str(e)}", {}

    async def fetch_submissions(self, handle: str, count: int = 1500, proxy: str = "") -> Tuple[List[NormalizedSubmission], str]:
        if not handle:
            return [], "未配置 Codeforces Handle"
        url = f"{self.BASE_URL}/user.status?handle={handle.strip()}&from=1&count={count}"
        try:
            proxy_url = proxy.strip() if proxy else None
            async with httpx.AsyncClient(timeout=20.0, proxy=proxy_url, trust_env=True) as client:
                res = await client.get(url)
                if res.status_code != 200:
                    return [], f"API 请求失败: HTTP {res.status_code}"
                data = res.json()
                if data.get("status") != "OK":
                    return [], f"Codeforces 返回错误: {data.get('comment', '')}"

                submissions = []
                for item in data.get("result", []):
                    raw_id = str(item.get("id"))
                    prob = item.get("problem", {})
                    contest_id = prob.get("contestId", "")
                    index = prob.get("index", "")
                    prob_name = prob.get("name", "Unknown Problem")
                    problem_id = f"{contest_id}{index}" if contest_id else index
                    
                    raw_tags = prob.get("tags", [])
                    # 标签中英对照清洗
                    translated_tags = [CF_TAG_TRANSLATIONS.get(t, t) for t in raw_tags]
                    
                    rating = prob.get("rating")
                    difficulty = f"Rating {rating}" if rating else "Unrated"
                    diff_score = rating if rating else 0
                    
                    ts = item.get("creationTimeSeconds", 0)
                    submitted_at, date_str = format_beijing_time_and_date(ts)
                    
                    verdict = self._normalize_verdict(item.get("verdict", ""))
                    code_lang = item.get("programmingLanguage", "")
                    sub_url = f"https://codeforces.com/contest/{contest_id}/submission/{raw_id}" if contest_id else ""

                    submissions.append(NormalizedSubmission(
                        id=f"cf_{raw_id}",
                        platform="codeforces",
                        raw_id=raw_id,
                        problem_id=problem_id,
                        problem_title=prob_name,
                        verdict=verdict,
                        tags=translated_tags,
                        difficulty=difficulty,
                        difficulty_score=diff_score,
                        submitted_at=submitted_at,
                        date=date_str,
                        submission_url=sub_url,
                        code_language=code_lang,
                        extra_data={"contestId": contest_id, "index": index, "raw_tags": raw_tags}
                    ))
                return submissions, "同步成功"
        except Exception as e:
            return [], f"抓取异常: {str(e)}"

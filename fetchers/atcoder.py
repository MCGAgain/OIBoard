import re
import httpx
import logging
from typing import Any, Dict, List, Optional, Tuple
from fetchers.base import BaseFetcher, NormalizedSubmission, format_beijing_time_and_date, parse_beijing_str_to_date

logger = logging.getLogger("AtCoderFetcher")

# AtCoder 题目算法标签推断词表
ATCODER_PROBLEM_TAGS = {
    "动态规划 DP": ["dp", "knapsack", "lis", "lcs", "tree dp", "digit dp", "bit dp", "matrix", "interval"],
    "图论与树论": ["tree", "graph", "bfs", "dfs", "shortest path", "dijkstra", "spanning tree", "flow", "bipartite", "cycle", "euler", "topological"],
    "数学与数论": ["math", "prime", "gcd", "lcm", "mod", "combinatorics", "permutation", "matrix", "geometry", "probability", "expected", "fft"],
    "数据结构": ["segment tree", "fenwick", "bit", "segtree", "union find", "dsu", "heap", "priority queue", "trie", "stack", "queue", "sparse table"],
    "贪心与构造": ["greedy", "constructive", "sorting", "two pointers", "binary search", "ternary search", "sliding window"],
    "字符串": ["string", "kmp", "trie", "suffix", "rolling hash", "palindrome", "manacher"],
    "基础算法与模拟": ["brute force", "implementation", "simulation", "bitmask", "xor", "adhoc"]
}

def infer_atcoder_tags(title: str, problem_id: str) -> List[str]:
    s = f"{title} {problem_id}".lower()
    matched = []
    for tag_name, keywords in ATCODER_PROBLEM_TAGS.items():
        if any(kw in s for kw in keywords):
            matched.append(tag_name)
    if not matched:
        idx = problem_id.split("_")[-1].upper() if "_" in problem_id else ""
        if idx in ("A", "B"):
            matched.append("基础算法与模拟")
        elif idx == "C":
            matched.append("贪心与构造")
        elif idx in ("D", "E"):
            matched.append("动态规划 DP")
        else:
            matched.append("综合算法")
    return matched

class AtCoderFetcher(BaseFetcher):
    platform_name = "atcoder"
    BASE_URL = "https://atcoder.jp"
    KENKOOOO_API_URL = "https://kenkoooo.com/atcoder/atcoder-api/v3"
    KENKOOOO_RESOURCE_URL = "https://kenkoooo.com/atcoder/resources"

    def __init__(self):
        self._problems_cache: Dict[str, Dict[str, Any]] = {}
        self._models_cache: Dict[str, Dict[str, Any]] = {}

    def _normalize_verdict(self, raw_verdict: str) -> str:
        v = (raw_verdict or "").strip().upper()
        if v == "AC":
            return "AC"
        elif v == "WA":
            return "WA"
        elif v == "TLE":
            return "TLE"
        elif v == "MLE":
            return "MLE"
        elif v == "RE":
            return "RE"
        elif v == "CE":
            return "CE"
        elif v in ("Q", "WJ", "WR"):
            return "PENDING"
        else:
            return "OTHER"

    async def _load_problem_resources(self, client: httpx.AsyncClient):
        """预加载 Kenkoooo 题库与难度元数据"""
        if self._problems_cache and self._models_cache:
            return

        try:
            r_probs = await client.get(f"{self.KENKOOOO_RESOURCE_URL}/problems.json", timeout=15.0)
            if r_probs.status_code == 200:
                for p in r_probs.json():
                    self._problems_cache[p.get("id")] = p
        except Exception as e:
            logger.warning(f"加载 AtCoder 题库元数据失败: {e}")

        try:
            r_models = await client.get(f"{self.KENKOOOO_RESOURCE_URL}/problem-models.json", timeout=15.0)
            if r_models.status_code == 200:
                self._models_cache = r_models.json()
        except Exception as e:
            logger.warning(f"加载 AtCoder 难度元数据失败: {e}")

    async def verify(self, handle: str, proxy: str = "") -> Tuple[bool, str, Dict[str, Any]]:
        if not handle:
            return False, "AtCoder Handle 未填写", {}
        
        handle_clean = handle.strip()
        url = f"{self.BASE_URL}/users/{handle_clean}"
        proxy_url = proxy.strip() if proxy else None
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        }

        try:
            async with httpx.AsyncClient(timeout=15.0, proxy=proxy_url, follow_redirects=True, headers=headers) as client:
                res = await client.get(url)
                if res.status_code == 404:
                    return False, f"用户不存在: {handle_clean}", {}
                if res.status_code != 200:
                    return False, f"AtCoder 请求失败: HTTP {res.status_code}", {}

                from bs4 import BeautifulSoup
                soup = BeautifulSoup(res.text, "html.parser")
                
                # 提取用户 Rating、Rank、国家
                rating = "Unrated"
                rank = ""
                country = ""
                avatar = ""

                # 头像
                avatar_img = soup.select_one("img.avatar")
                if avatar_img and avatar_img.get("src"):
                    avatar = avatar_img.get("src")
                    if avatar.startswith("//"):
                        avatar = "https:" + avatar

                # 表格信息
                for tr in soup.select("table.dl-table tr"):
                    th = tr.select_one("th")
                    td = tr.select_one("td")
                    if th and td:
                        k = th.get_text().strip()
                        v = td.get_text().strip()
                        if "Rating" in k:
                            rating = v
                        elif "Rank" in k:
                            rank = v
                        elif "Country" in k:
                            country = v

                # 备选：从 Kenkoooo 获取聚合信息
                try:
                    r_info = await client.get(f"{self.KENKOOOO_API_URL}/user/info?user={handle_clean}")
                    if r_info.status_code == 200:
                        info_data = r_info.json()
                        if info_data.get("rating") is not None:
                            rating = str(info_data["rating"])
                except Exception:
                    pass

                return True, f"验证成功 (Rating: {rating})", {
                    "rating": rating,
                    "rank": rank,
                    "country": country,
                    "avatar": avatar
                }
        except Exception as e:
            return False, f"网络错误: {str(e)}", {}

    async def fetch_submissions(self, handle: str, proxy: str = "") -> Tuple[List[NormalizedSubmission], str]:
        if not handle:
            return [], "未配置 AtCoder Handle"

        handle_clean = handle.strip()
        proxy_url = proxy.strip() if proxy else None
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        }

        try:
            async with httpx.AsyncClient(timeout=25.0, proxy=proxy_url, follow_redirects=True, headers=headers) as client:
                await self._load_problem_resources(client)

                all_raw_subs: List[Dict[str, Any]] = []
                from_second = 0

                # 循环分页拉取（Kenkoooo API 单次上限 500 条）
                while True:
                    url = f"{self.KENKOOOO_API_URL}/user/submissions?user={handle_clean}&from_second={from_second}"
                    res = await client.get(url)
                    if res.status_code != 200:
                        if not all_raw_subs:
                            return [], f"API 请求失败: HTTP {res.status_code}"
                        break

                    data = res.json()
                    if not isinstance(data, list) or not data:
                        break

                    all_raw_subs.extend(data)
                    if len(data) < 500:
                        break

                    # 下一页起始时间戳为最后一条提交的秒数 + 1
                    last_sec = data[-1].get("epoch_second", from_second)
                    if last_sec <= from_second:
                        break
                    from_second = last_sec + 1

                if not all_raw_subs:
                    return [], "同步成功: 0条"

                # 转换为 NormalizedSubmission
                submissions: List[NormalizedSubmission] = []
                seen_sub_ids = set()

                for item in all_raw_subs:
                    sub_id = str(item.get("id"))
                    if not sub_id or sub_id in seen_sub_ids:
                        continue
                    seen_sub_ids.add(sub_id)

                    prob_id_raw = item.get("problem_id", "")
                    contest_id = item.get("contest_id", "")
                    epoch_sec = item.get("epoch_second", 0)
                    raw_result = item.get("result", "")
                    verdict = self._normalize_verdict(raw_result)
                    lang = item.get("language", "")
                    exec_time = item.get("execution_time")
                    runtime = f"{exec_time} ms" if exec_time is not None else ""

                    # 题目标题与元数据
                    prob_meta = self._problems_cache.get(prob_id_raw, {})
                    title = prob_meta.get("title") or prob_meta.get("name") or prob_id_raw
                    
                    # 难度分计算
                    model_meta = self._models_cache.get(prob_id_raw, {})
                    raw_diff = model_meta.get("difficulty")
                    if raw_diff is not None:
                        diff_score = max(0, int(raw_diff))
                        if diff_score < 400:
                            diff_str = "灰色 (入门)"
                        elif diff_score < 800:
                            diff_str = "棕色 (简单)"
                        elif diff_score < 1200:
                            diff_str = "绿色 (普及)"
                        elif diff_score < 1600:
                            diff_str = "水色 (提高)"
                        elif diff_score < 2000:
                            diff_str = "蓝色 (省选)"
                        elif diff_score < 2400:
                            diff_str = "黄色 (NOI)"
                        elif diff_score < 2800:
                            diff_str = "橙色 (强省选)"
                        else:
                            diff_str = "红色 (CTSC/大师)"
                    else:
                        diff_score = 1000
                        diff_str = "中等"

                    # 统一时间与熬夜归属日期
                    submitted_at, date_str = format_beijing_time_and_date(epoch_sec)

                    # 提交链接
                    sub_url = f"{self.BASE_URL}/contests/{contest_id}/submissions/{sub_id}" if contest_id else f"{self.BASE_URL}/users/{handle_clean}"

                    tags = infer_atcoder_tags(title, prob_id_raw)

                    submissions.append(NormalizedSubmission(
                        id=f"atcoder_{sub_id}",
                        platform="atcoder",
                        raw_id=sub_id,
                        problem_id=f"AtCoder-{prob_id_raw}",
                        problem_title=title,
                        verdict=verdict,
                        tags=tags,
                        difficulty=diff_str,
                        difficulty_score=diff_score,
                        submitted_at=submitted_at,
                        date=date_str,
                        submission_url=sub_url,
                        code_language=lang,
                        extra_data={
                            "contest_id": contest_id,
                            "runtime": runtime,
                            "length": item.get("length", 0),
                            "point": item.get("point", 0.0)
                        }
                    ))

                # 按提交时间降序排列
                submissions.sort(key=lambda s: s.submitted_at, reverse=True)
                return submissions, f"成功同步 {len(submissions)} 条 AtCoder 提交记录"

        except Exception as e:
            logger.exception("抓取 AtCoder 提交记录异常")
            return [], f"抓取 AtCoder 异常: {str(e)}"

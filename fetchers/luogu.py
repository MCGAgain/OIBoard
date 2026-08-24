import re
import json
import httpx
from bs4 import BeautifulSoup
from datetime import datetime
from typing import Any, Dict, List, Tuple
from fetchers.base import BaseFetcher, NormalizedSubmission

LUOGU_DIFFICULTY_MAP = {
    0: ("暂无评定", 0),
    1: ("入门", 800),
    2: ("普及-", 1100),
    3: ("普及/提高-", 1400),
    4: ("普及+/提高", 1700),
    5: ("提高+/省选-", 2000),
    6: ("省选/NOI-", 2300),
    7: ("NOI/NOI+/CTSC", 2600),
}

# 经典题号直接精准映射
EXACT_PID_TAGS = {
    "P1001": ["模拟与暴力"],
    "P1002": ["动态规划 DP", "递推与计数"],
    "P1003": ["模拟与暴力"],
    "P1004": ["动态规划 DP", "多维DP"],
    "P1006": ["动态规划 DP", "多维DP"],
    "P1008": ["模拟与暴力", "枚举"],
    "P1009": ["高精度计算", "数学与数论"],
    "P1014": ["数学与数论", "规律递推"],
    "P1019": ["搜索与回溯 (DFS/BFS)", "字符串算法"],
    "P1020": ["动态规划 DP", "最长上升子序列 LIS", "二分查找"],
    "P1024": ["基础算法与二分", "二分查找"],
    "P1025": ["动态规划 DP", "递推与计数"],
    "P1028": ["动态规划 DP", "递推与计数"],
    "P1030": ["树形结构", "递归分治"],
    "P1035": ["基础算法与二分", "数学与数论"],
    "P1036": ["搜索与回溯 (DFS/BFS)", "数学与数论"],
    "P1042": ["模拟与暴力", "字符串算法"],
    "P1044": ["动态规划 DP", "卡特兰数", "数据结构"],
    "P1046": ["基础算法与二分", "模拟与暴力"],
    "P1047": ["模拟与暴力", "区间与差分"],
    "P1048": ["动态规划 DP", "背包问题"],
    "P1049": ["动态规划 DP", "背包问题"],
    "P1055": ["模拟与暴力", "字符串算法"],
    "P1059": ["基础算法与二分", "排序与去重"],
    "P1060": ["动态规划 DP", "背包问题"],
    "P1067": ["模拟与暴力"],
    "P1068": ["基础算法与二分", "排序与去重"],
    "P1075": ["数学与数论", "素数与筛法"],
    "P1077": ["动态规划 DP", "背包问题"],
    "P1080": ["贪心算法", "高精度计算"],
    "P1085": ["模拟与暴力"],
    "P1089": ["模拟与暴力"],
    "P1090": ["贪心算法", "堆与优先队列", "数据结构"],
    "P1091": ["动态规划 DP", "最长上升子序列 LIS"],
    "P1093": ["基础算法与二分", "排序与去重"],
    "P1095": ["动态规划 DP", "贪心算法"],
    "P1102": ["基础算法与二分", "双指针", "二分查找"],
    "P1104": ["基础算法与二分", "排序与去重"],
    "P1115": ["动态规划 DP", "线性DP", "分治"],
    "P1135": ["搜索与回溯 (DFS/BFS)", "广度优先搜索 BFS"],
    "P1144": ["图论算法", "最短路", "BFS"],
    "P1162": ["搜索与回溯 (DFS/BFS)", "Flood Fill"],
    "P1164": ["动态规划 DP", "背包问题"],
    "P1177": ["基础算法与二分", "排序与去重"],
    "P1216": ["动态规划 DP", "线性DP"],
    "P1219": ["搜索与回溯 (DFS/BFS)", "回溯法"],
    "P1223": ["贪心算法"],
    "P1226": ["数学与数论", "快速幂与逆元"],
    "P1434": ["动态规划 DP", "记忆化搜索"],
    "P1443": ["搜索与回溯 (DFS/BFS)", "广度优先搜索 BFS"],
    "P1605": ["搜索与回溯 (DFS/BFS)", "深度优先搜索 DFS"],
    "P1757": ["动态规划 DP", "背包问题"],
    "P1803": ["贪心算法", "区间选点"],
    "P1880": ["动态规划 DP", "区间DP"],
    "P2014": ["动态规划 DP", "树形DP", "背包问题"],
    "P2240": ["贪心算法"],
    "P2249": ["基础算法与二分", "二分查找"],
    "P2404": ["搜索与回溯 (DFS/BFS)", "回溯法"],
    "P2871": ["动态规划 DP", "背包问题"],
    "P3366": ["图论算法", "最小生成树", "并查集"],
    "P3367": ["数据结构", "并查集"],
    "P3371": ["图论算法", "最短路", "Dijkstra"],
    "P3372": ["数据结构", "线段树"],
    "P3373": ["数据结构", "线段树"],
    "P3374": ["数据结构", "树状数组"],
    "P3375": ["字符串算法", "KMP算法"],
    "P3383": ["数学与数论", "素数与筛法"],
    "P4779": ["图论算法", "最短路", "Dijkstra"],
}

# 细粒度算法特征词库
TAG_KEYWORDS = {
    "动态规划 DP": [
        "背包", "DP", "dp", "子序列", "划分", "最长", "编辑距离", "舞会", "梦想", 
        "数字三角形", "采药", "装箱", "金明", "摆花", "合唱", "逃离", "子段和", 
        "石子合并", "滑雪", "选课", "过河卒", "方格", "传纸条", "旅行商", "股票", 
        "爬楼梯", "找零", "买卖", "打家劫舍", "整数划分", "打卡", "上司", "Hamilton", 
        "硬币", "能量项链", "拦截导弹", "金明的预算方案", "尼克的任务", "机器分配", "友好城市"
    ],
    "背包问题": ["背包", "01背包", "完全背包", "多重背包", "分组背包", "采药", "装箱问题", "开心的金明", "金明的预算方案", "买书", "数字组合"],
    "贪心算法": [
        "贪心", "区间", "合并", "最小", "最优", "排队", "货仓", "游戏", "国王", 
        "果子", "杂技", "均分纸牌", "线段", "覆盖", "选点", "钓鱼", "雷达", "防晒", 
        "种树", "凌乱的yyy", "纪念品分组", "部分背包"
    ],
    "搜索与回溯 (DFS/BFS)": [
        "搜索", "DFS", "dfs", "BFS", "bfs", "迷宫", "八皇后", "八数码", "连通", 
        "路径", "遍历", "马的遍历", "填涂颜色", "小猫爬山", "数独", "单词接龙", 
        "红与黑", "字串变换", "奇怪的电梯", "生化危机", "靶形数独", "烤鸡", "选数"
    ],
    "数学与数论": [
        "数论", "质数", "约数", "同余", "快速幂", "矩阵", "组合", "公约数", "筛", 
        "进制", "高精度", "素数", "欧拉", "分解质因数", "试除法", "gcd", "GCD", 
        "逆元", "中国剩余定理", "卡特兰", "斐波那契", "阶乘", "算术", "余数", "整除"
    ],
    "高精度计算": ["高精度", "大整数", "阶乘之和", "高精", "麦森数", "压位高精"],
    "图论算法": [
        "图论", "最短路", "树", "拓扑", "连通分量", "生成树", "二分图", "网络流", 
        "欧拉回路", "环", "Dijkstra", "dijkstra", "Floyd", "floyd", "SPFA", "spfa", 
        "Kruskal", "kruskal", "Prim", "prim", "村村通", "灾后重建", "网络寻路", "邮递员", "寻宝", "通信网络"
    ],
    "数据结构": [
        "栈", "队列", "并查集", "堆", "线段树", "树状数组", "哈希", "平衡树", 
        "链表", "Trie", "单调栈", "单调队列", "滑动窗口", "直方图", "兔子与兔子", 
        "最大异或对", "优先队列", "ST表", "RMQ"
    ],
    "字符串算法": [
        "字符串", "KMP", "kmp", "回文", "匹配", "后缀", "字典树", "自动机", 
        "Trie", "trie", "模式匹配", "统计单词数", "潜伏者", "笨小猴"
    ],
    "基础算法与二分": [
        "双指针", "二分", "前缀和", "差分", "位运算", "归并", "快速排序", "离散化", 
        "区间合并", "第k个", "逆序对", "一元三次方程", "分巧克力", "木材加工", "进击的奶牛", 
        "烦恼的高考志愿", "二分查找", "跳石头"
    ],
    "模拟与暴力": [
        "模拟", "构造", "输入输出", "进制转换", "排序", "语法", "乒乓球", 
        "扫雷游戏", "多项式输出", "花生采摘", "陶陶摘苹果", "校门外的树", "不高兴的津津", 
        "津津的储蓄计划", "买铅笔", "小玉买文具", "数字反转", "小鱼的游泳时间"
    ]
}

def infer_luogu_tags(title: str, pid: str, diff_num: int) -> List[str]:
    # 1. 优先查经典题库映射
    if pid in EXACT_PID_TAGS:
        return EXACT_PID_TAGS[pid]
    
    # 2. 匹配特征关键词
    tags = []
    for tag_name, keywords in TAG_KEYWORDS.items():
        if any(kw.lower() in title.lower() for kw in keywords):
            tags.append(tag_name)
            
    if tags:
        return tags[:3]

    # 3. 兜底策略（根据题号前缀与难度细分）
    if pid.startswith("B"):
        return ["模拟与暴力", "语法入门"]
    elif diff_num >= 4:
        return ["动态规划 DP", "高级算法"]
    elif diff_num in (2, 3):
        return ["搜索与回溯 (DFS/BFS)", "基础算法与二分"]
    else:
        return ["模拟与暴力", "基础算法与二分"]

LUOGU_STATUS_MAP = {
    12: "AC",  # Accepted
    14: "WA",  # Wrong Answer
    11: "RE",  # Runtime Error
    13: "TLE", # Time Limit Exceeded
    15: "MLE", # Memory Limit Exceeded
    16: "OLE", # Output Limit Exceeded
    21: "CE",  # Compile Error
    22: "UKE", # Unknown Error
}

LUOGU_LANG_MAP = {
    1: "Pascal",
    2: "C",
    3: "C++",
    4: "C++11",
    11: "C++14",
    12: "C++17",
    14: "C++20",
    7: "Python 3",
    8: "Java 8",
    16: "Go",
    17: "Rust",
    18: "Kotlin",
    19: "Node.js"
}

class LuoguFetcher(BaseFetcher):
    platform_name = "luogu"
    BASE_URL = "https://www.luogu.com.cn"

    def _parse_cookie_dict(self, cookie: str, uid: str = "") -> Dict[str, str]:
        cookies_dict = {}
        if uid:
            cookies_dict["_uid"] = str(uid).strip()
        if cookie:
            c = cookie.strip()
            for part in c.split(";"):
                part = part.strip()
                if "=" in part:
                    k, v = part.split("=", 1)
                    cookies_dict[k.strip()] = v.strip()
                elif part:
                    cookies_dict["__client_id"] = part
        return cookies_dict

    def _get_headers(self, uid: str = "") -> Dict[str, str]:
        return {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Referer": f"{self.BASE_URL}/user/{uid}" if uid else f"{self.BASE_URL}/",
            "Accept": "application/json, text/html, */*",
        }

    def _extract_decode_data(self, html_text: str) -> Dict[str, Any]:
        import urllib.parse
        soup = BeautifulSoup(html_text, "html.parser")
        for s in soup.find_all("script"):
            txt = s.get_text().strip()
            if "decodeURIComponent" in txt:
                match = re.search(r'decodeURIComponent\("([^"]+)"\)', txt)
                if match:
                    try:
                        raw_json = urllib.parse.unquote(match.group(1))
                        return json.loads(raw_json)
                    except Exception:
                        pass
        return {}

    def _extract_luogu_data(self, res_text: str, res_json: Any = None) -> Dict[str, Any]:
        if res_json and isinstance(res_json, dict) and "data" in res_json:
            return res_json.get("data", {})
        try:
            soup = BeautifulSoup(res_text, "html.parser")
            for s in soup.find_all("script"):
                txt = s.get_text().strip()
                if txt.startswith("{") and ("template" in txt or "instance" in txt):
                    parsed = json.loads(txt)
                    if "data" in parsed:
                        return parsed["data"]
        except Exception:
            pass
        return {}

    async def verify(self, uid: str, cookie: str = "", proxy: str = "") -> Tuple[bool, str, Dict[str, Any]]:
        if not uid:
            return False, "洛谷 UID 未填写", {}
        url = f"{self.BASE_URL}/user/{uid.strip()}"
        try:
            proxy_url = proxy.strip() if proxy else None
            cookies_dict = self._parse_cookie_dict(cookie, uid)
            async with httpx.AsyncClient(cookies=cookies_dict, timeout=15.0, proxy=proxy_url, trust_env=bool(proxy_url), follow_redirects=True) as client:
                res = await client.get(url, headers=self._get_headers(uid))
                if res.status_code == 200:
                    try:
                        res_json = res.json()
                    except Exception:
                        res_json = None
                    
                    data = self._extract_luogu_data(res.text, res_json)
                    user = data.get("user", {})
                    if user:
                        name = user.get("name", uid)
                        passed = user.get("passedProblemCount", 0)
                        ranking = user.get("ranking", "未上榜")
                        return True, f"验证成功 (昵称: {name}, 已通过: {passed}题)", {
                            "name": name,
                            "passed": passed,
                            "ranking": str(ranking),
                            "avatar": f"https://cdn.luogu.com.cn/upload/usericon/{uid}.png"
                        }
                    return False, "未找到用户数据，请检查 UID 或 Cookie", {}
                elif res.status_code == 403:
                    return False, "洛谷返回 403 拦截，请配置有效的 Cookie (__client_id)", {}
                else:
                    return False, f"请求失败: HTTP {res.status_code}", {}
        except Exception as e:
            return False, f"网络异常: {str(e)}", {}

    async def fetch_submissions(self, uid: str, cookie: str = "", proxy: str = "") -> Tuple[List[NormalizedSubmission], str]:
        if not uid:
            return [], "未配置洛谷 UID"
        
        uid = uid.strip()
        cookies_dict = self._parse_cookie_dict(cookie, uid)
        web_headers = self._get_headers(uid)
        
        submissions: List[NormalizedSubmission] = []
        seen_rec_ids = set()
        seen_ac_pids = set()

        try:
            proxy_url = proxy.strip() if proxy else None
            async with httpx.AsyncClient(cookies=cookies_dict, timeout=20.0, proxy=proxy_url, trust_env=bool(proxy_url), follow_redirects=True) as client:
                # 1. 抓取 /record/list 真实提交流 (前 5 页，包含每条提交的精准秒级时间、真实提交题号如 P1734、真实评测状态)
                max_pages = 5
                for page in range(1, max_pages + 1):
                    rec_url = f"{self.BASE_URL}/record/list?user={uid}&page={page}"
                    res = await client.get(rec_url, headers=web_headers)
                    if res.status_code != 200:
                        break
                    
                    data = self._extract_decode_data(res.text)
                    if not data:
                        try:
                            data = res.json()
                        except Exception:
                            data = {}
                    
                    curr_data = data.get("currentData", {}) if "currentData" in data else data.get("data", {})
                    records_wrap = curr_data.get("records", {})
                    records_list = records_wrap.get("result", []) if isinstance(records_wrap, dict) else []
                    
                    if not records_list:
                        break
                    
                    for r in records_list:
                        rec_id = r.get("id")
                        if not rec_id or rec_id in seen_rec_ids:
                            continue
                        seen_rec_ids.add(rec_id)
                        
                        prob = r.get("problem", {})
                        pid = prob.get("pid", f"P_{rec_id}")
                        title = prob.get("title") or prob.get("name") or pid
                        diff_num = prob.get("difficulty", 0)
                        diff_label, diff_score = LUOGU_DIFFICULTY_MAP.get(diff_num, ("未知", 0))
                        tags = infer_luogu_tags(title, pid, diff_num)
                        
                        status_code = r.get("status", 0)
                        verdict = LUOGU_STATUS_MAP.get(status_code, "AC" if status_code == 12 else "WA")
                        if status_code == 12:
                            seen_ac_pids.add(pid)
                        
                        lang_code = r.get("language", 3)
                        lang_str = LUOGU_LANG_MAP.get(lang_code, "C++")
                        
                        stime = r.get("submitTime", 0)
                        if stime:
                            dt = datetime.fromtimestamp(stime)
                            sub_at = dt.strftime("%Y-%m-%d %H:%M:%S")
                            sub_date = dt.strftime("%Y-%m-%d")
                        else:
                            sub_at = ""
                            sub_date = ""
                        
                        submissions.append(NormalizedSubmission(
                            id=f"luogu_rec_{rec_id}",
                            platform="luogu",
                            raw_id=f"rec_{rec_id}",
                            problem_id=pid,
                            problem_title=title,
                            verdict=verdict,
                            tags=tags,
                            difficulty=diff_label,
                            difficulty_score=diff_score,
                            submitted_at=sub_at,
                            date=sub_date,
                            submission_url=f"{self.BASE_URL}/record/{rec_id}",
                            code_language=lang_str,
                            extra_data={"rec_id": rec_id, "pid": pid, "diff_num": diff_num, "status_code": status_code}
                        ))
                    
                    if len(records_list) < 20:
                        break

                # 2. 抓取 /user/{uid}/practice (获取全量 300 道已通过题目与未解决错题归档)
                practice_url = f"{self.BASE_URL}/user/{uid}/practice"
                p_headers = {
                    "User-Agent": web_headers["User-Agent"],
                    "x-lentille-request": "content-only",
                    "Accept": "application/json, text/html, */*",
                }
                p_res = await client.get(practice_url, headers=p_headers)
                
                passed_list = []
                submitted_list = []
                if p_res.status_code == 200:
                    try:
                        p_json = p_res.json()
                    except Exception:
                        p_json = None
                    p_data = self._extract_luogu_data(p_res.text, p_json)
                    passed_list = p_data.get("passed", [])
                    submitted_list = p_data.get("submitted", [])

                # 补全历史已通过但未在近期 record/list 中的题目 (确保总通过数严格等于官方通过总数)
                for prob in passed_list:
                    pid = prob.get("pid", "")
                    if not pid or pid in seen_ac_pids:
                        continue
                    seen_ac_pids.add(pid)
                    
                    title = prob.get("name", pid)
                    diff_num = prob.get("difficulty", 0)
                    diff_label, diff_score = LUOGU_DIFFICULTY_MAP.get(diff_num, ("未知", 0))
                    tags = infer_luogu_tags(title, pid, diff_num)

                    submissions.append(NormalizedSubmission(
                        id=f"luogu_p_{pid}",
                        platform="luogu",
                        raw_id=f"prob_{pid}",
                        problem_id=pid,
                        problem_title=title,
                        verdict="AC",
                        tags=tags,
                        difficulty=diff_label,
                        difficulty_score=diff_score,
                        submitted_at="",
                        date="",
                        submission_url=f"{self.BASE_URL}/problem/{pid}",
                        code_language="C++",
                        extra_data={"pid": pid, "diff_num": diff_num, "archive": True}
                    ))

                # 补全待攻克错题 (submitted 且未 passed 的题目)
                for prob in submitted_list:
                    pid = prob.get("pid", "")
                    if not pid or pid in seen_ac_pids:
                        continue
                    
                    if any(s.problem_id == pid and s.verdict != "AC" for s in submissions):
                        continue

                    title = prob.get("name", pid)
                    diff_num = prob.get("difficulty", 0)
                    diff_label, diff_score = LUOGU_DIFFICULTY_MAP.get(diff_num, ("未知", 0))
                    tags = infer_luogu_tags(title, pid, diff_num)

                    submissions.append(NormalizedSubmission(
                        id=f"luogu_fail_{pid}",
                        platform="luogu",
                        raw_id=f"fail_{pid}",
                        problem_id=pid,
                        problem_title=title,
                        verdict="WA",
                        tags=tags,
                        difficulty=diff_label,
                        difficulty_score=diff_score,
                        submitted_at="",
                        date="",
                        submission_url=f"{self.BASE_URL}/problem/{pid}",
                        code_language="C++",
                        extra_data={"pid": pid, "is_unresolved": True}
                    ))

                if not submissions:
                    return [], "未获取到洛谷做题记录 (请检查 UID 或主页隐私)"
                
                recent_ac = sum(1 for s in submissions if s.verdict == "AC" and s.submitted_at)
                return submissions, f"成功同步 {len(submissions)} 条洛谷记录 (已通过: {len(seen_ac_pids)} 题, 近期提交流: {len(seen_rec_ids)} 条)"

        except Exception as e:
            return [], f"洛谷抓取异常: {str(e)}"

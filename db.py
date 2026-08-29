import json
import sqlite3
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from auth import hash_password, verify_password, generate_session_token

BEIJING_TZ = timezone(timedelta(hours=8))

def get_beijing_now() -> datetime:
    return datetime.now(BEIJING_TZ)

def get_effective_today() -> str:
    """获取当前生效的统计归属日期（凌晨 4 点前算作昨日打卡）"""
    return (get_beijing_now() - timedelta(hours=4)).strftime("%Y-%m-%d")

def parse_beijing_str_to_date(dt_str: str) -> str:
    """将北京时间字符串转换为熬夜归属统计日期（凌晨 4 点前算作前一日）"""
    if not dt_str:
        return ""
    try:
        dt = datetime.strptime(dt_str[:19], "%Y-%m-%d %H:%M:%S")
        effective_dt = dt - timedelta(hours=4)
        return effective_dt.strftime("%Y-%m-%d")
    except Exception:
        return dt_str[:10]

DB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DB_PATH = os.path.join(DB_DIR, "oiboard.db")

def get_connection() -> sqlite3.Connection:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn

def init_db():
    with get_connection() as conn:
        cursor = conn.cursor()
        
        # 1. 用户表 (Users)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                is_admin INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);")

        # 2. 会话表 (Sessions)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);")

        # 3. 确保默认主管理员账户 (如果用户表为空，先创建 user 1 以满足后续外键约束)
        cursor.execute("SELECT COUNT(*) as cnt FROM users;")
        if cursor.fetchone()["cnt"] == 0:
            pwd_hash, salt = hash_password("admin123")
            cursor.execute("""
                INSERT INTO users (id, username, password_hash, salt, is_admin)
                VALUES (1, 'admin', ?, ?, 1);
            """, (pwd_hash, salt))

        # 4. 提交记录表 (Submissions - 多租户隔离)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS submissions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL DEFAULT 1,
                platform TEXT NOT NULL,
                raw_id TEXT NOT NULL,
                problem_id TEXT NOT NULL,
                problem_title TEXT NOT NULL,
                verdict TEXT NOT NULL,
                tags TEXT,
                difficulty TEXT,
                difficulty_score INTEGER DEFAULT 0,
                submitted_at TEXT NOT NULL,
                date TEXT NOT NULL,
                submission_url TEXT,
                code_language TEXT,
                extra_data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, platform, raw_id),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        
        # 兼容旧表升级：检查 submissions 表是否有旧的非租户约束或缺少 user_id 列
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='submissions';")
        sub_sql_row = cursor.fetchone()
        if sub_sql_row and ("UNIQUE(platform, raw_id)" in sub_sql_row["sql"] or "UNIQUE (platform, raw_id)" in sub_sql_row["sql"]):
            cursor.execute("ALTER TABLE submissions RENAME TO submissions_old;")
            cursor.execute("""
                CREATE TABLE submissions (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL DEFAULT 1,
                    platform TEXT NOT NULL,
                    raw_id TEXT NOT NULL,
                    problem_id TEXT NOT NULL,
                    problem_title TEXT NOT NULL,
                    verdict TEXT NOT NULL,
                    tags TEXT,
                    difficulty TEXT,
                    difficulty_score INTEGER DEFAULT 0,
                    submitted_at TEXT NOT NULL,
                    date TEXT NOT NULL,
                    submission_url TEXT,
                    code_language TEXT,
                    extra_data TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, platform, raw_id),
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
            """)
            cursor.execute("""
                INSERT OR IGNORE INTO submissions (
                    id, user_id, platform, raw_id, problem_id, problem_title, verdict, tags,
                    difficulty, difficulty_score, submitted_at, date, submission_url, code_language, extra_data, created_at
                ) SELECT 
                    'u' || COALESCE(user_id, 1) || '_' || platform || '_' || raw_id,
                    COALESCE(user_id, 1), platform, raw_id, problem_id, problem_title, verdict, tags,
                    difficulty, difficulty_score, submitted_at, date, submission_url, code_language, extra_data, created_at
                FROM submissions_old;
            """)
            cursor.execute("DROP TABLE submissions_old;")
        else:
            cursor.execute("PRAGMA table_info(submissions);")
            sub_cols = [row["name"] for row in cursor.fetchall()]
            if "user_id" not in sub_cols:
                cursor.execute("ALTER TABLE submissions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;")

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_submissions_user_date ON submissions(user_id, date);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_submissions_user_platform ON submissions(user_id, platform);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_submissions_user_verdict ON submissions(user_id, verdict);")

        # 5. 用户配置表 (User Configs - 多租户隔离)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_configs (
                user_id INTEGER NOT NULL DEFAULT 1,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, key),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        
        # 兼容旧表升级：检查 user_configs 是否有 user_id
        cursor.execute("PRAGMA table_info(user_configs);")
        cfg_cols = [row["name"] for row in cursor.fetchall()]
        if "user_id" not in cfg_cols:
            cursor.execute("ALTER TABLE user_configs RENAME TO user_configs_old;")
            cursor.execute("""
                CREATE TABLE user_configs (
                    user_id INTEGER NOT NULL DEFAULT 1,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, key),
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
            """)
            cursor.execute("INSERT OR IGNORE INTO user_configs (user_id, key, value, updated_at) SELECT 1, key, value, updated_at FROM user_configs_old;")
            cursor.execute("DROP TABLE user_configs_old;")

        # 6. 各平台状态表 (Platform Status - 多租户隔离)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS platform_status (
                user_id INTEGER NOT NULL DEFAULT 1,
                platform TEXT NOT NULL,
                status TEXT NOT NULL,
                message TEXT,
                last_checked_at TEXT,
                item_count INTEGER DEFAULT 0,
                rating TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, platform),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        cursor.execute("PRAGMA table_info(platform_status);")
        stat_cols = [row["name"] for row in cursor.fetchall()]
        if "user_id" not in stat_cols:
            cursor.execute("ALTER TABLE platform_status RENAME TO platform_status_old;")
            cursor.execute("""
                CREATE TABLE platform_status (
                    user_id INTEGER NOT NULL DEFAULT 1,
                    platform TEXT NOT NULL,
                    status TEXT NOT NULL,
                    message TEXT,
                    last_checked_at TEXT,
                    item_count INTEGER DEFAULT 0,
                    rating TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, platform),
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
            """)
            cursor.execute("INSERT OR IGNORE INTO platform_status (user_id, platform, status, message, last_checked_at, item_count, rating, updated_at) SELECT 1, platform, status, message, last_checked_at, item_count, rating, updated_at FROM platform_status_old;")
            cursor.execute("DROP TABLE platform_status_old;")

        # 为主账户填充默认配置（如果缺失）
        default_configs = {
            "cf_handle": "",
            "luogu_uid": "",
            "luogu_cookie": "",
            "acwing_user_id": "",
            "acwing_cookie": "",
            "poll_interval_minutes": "30",
            "sprint_mode": "false",
            "last_sync_time": "",
            "http_proxy": "",
        }
        for k, v in default_configs.items():
            cursor.execute("INSERT OR IGNORE INTO user_configs (user_id, key, value) VALUES (1, ?, ?);", (k, v))
            
        platforms = ["codeforces", "luogu", "acwing"]
        for p in platforms:
            cursor.execute("""
                INSERT OR IGNORE INTO platform_status (user_id, platform, status, message, last_checked_at, item_count, rating)
                VALUES (1, ?, 'unconfigured', '未配置账号', '', 0, '');
            """, (p,))

        conn.commit()

# --- User Auth Management ---

def create_user(username: str, password: str, is_admin: bool = False) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    """创建新用户 (加盐哈希密码存储)"""
    username = username.strip()
    if len(username) < 3 or len(username) > 32:
        return False, "用户名长度必须在 3-32 位之间", None
    if len(password) < 6:
        return False, "密码长度不能少于 6 位", None
    
    pwd_hash, salt = hash_password(password)
    with get_connection() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute("""
                INSERT INTO users (username, password_hash, salt, is_admin)
                VALUES (?, ?, ?, ?);
            """, (username, pwd_hash, salt, 1 if is_admin else 0))
            new_id = cursor.lastrowid
            
            # 初始化该用户的默认配置
            default_configs = {
                "cf_handle": "",
                "luogu_uid": "",
                "luogu_cookie": "",
                "acwing_user_id": "",
                "acwing_cookie": "",
                "poll_interval_minutes": "30",
                "sprint_mode": "false",
                "last_sync_time": "",
                "http_proxy": "",
            }
            for k, v in default_configs.items():
                cursor.execute("INSERT OR IGNORE INTO user_configs (user_id, key, value) VALUES (?, ?, ?);", (new_id, k, v))
            for p in ["codeforces", "luogu", "acwing"]:
                cursor.execute("""
                    INSERT OR IGNORE INTO platform_status (user_id, platform, status, message, last_checked_at, item_count, rating)
                    VALUES (?, ?, 'unconfigured', '未配置账号', '', 0, '');
                """, (new_id, p))
            conn.commit()
            
            user_data = {
                "id": new_id,
                "username": username,
                "is_admin": bool(is_admin)
            }
            return True, "注册成功", user_data
        except sqlite3.IntegrityError:
            return False, "该用户名已被注册", None
        except Exception as e:
            return False, f"注册异常: {str(e)}", None

def authenticate_user(username: str, password: str) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    """校验用户登录"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, username, password_hash, salt, is_admin FROM users WHERE username = ?;", (username.strip(),))
        user = cursor.fetchone()
        if not user:
            return False, "用户名或密码错误", None
        
        if not verify_password(password, user["salt"], user["password_hash"]):
            return False, "用户名或密码错误", None
        
        return True, "验证成功", {
            "id": user["id"],
            "username": user["username"],
            "is_admin": bool(user["is_admin"])
        }

def create_session(user_id: int, days: int = 7) -> str:
    """创建并存储会话 Token"""
    token = generate_session_token()
    expires_at = (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO sessions (token, user_id, expires_at)
            VALUES (?, ?, ?);
        """, (token, user_id, expires_at))
        conn.commit()
    return token

def get_user_by_token(token: str) -> Optional[Dict[str, Any]]:
    """根据会话 Token 获取当前登录用户信息 (校验过期时间)"""
    if not token:
        return None
    with get_connection() as conn:
        cursor = conn.cursor()
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute("""
            SELECT u.id, u.username, u.is_admin, u.created_at, s.expires_at
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ? AND s.expires_at > ?;
        """, (token.strip(), now_str))
        user = cursor.fetchone()
        if user:
            return {
                "id": user["id"],
                "username": user["username"],
                "is_admin": bool(user["is_admin"]),
                "created_at": user["created_at"]
            }
        return None

def delete_session(token: str):
    """销毁会话 Token (注销登录)"""
    if not token:
        return
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE token = ?;", (token.strip(),))
        conn.commit()

def change_user_password(user_id: int, old_password: str, new_password: str) -> Tuple[bool, str]:
    """修改用户密码"""
    if len(new_password) < 6:
        return False, "新密码长度不能少于 6 位"
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT password_hash, salt FROM users WHERE id = ?;", (user_id,))
        user = cursor.fetchone()
        if not user:
            return False, "用户不存在"
        
        if not verify_password(old_password, user["salt"], user["password_hash"]):
            return False, "原密码不正确"
        
        new_hash, new_salt = hash_password(new_password)
        cursor.execute("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?;", (new_hash, new_salt, user_id))
        # 注销当前用户所有其他旧会话
        cursor.execute("DELETE FROM sessions WHERE user_id = ?;", (user_id,))
        conn.commit()
        return True, "密码修改成功，请重新登录"

def get_all_user_ids() -> List[int]:
    """获取系统中所有有效用户 ID 供后台调度轮询"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users;")
        return [row["id"] for row in cursor.fetchall()]

# --- User Configs (Per User) ---

def get_config(user_id: int, key: str, default: str = "") -> str:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM user_configs WHERE user_id = ? AND key = ?;", (user_id, key))
        row = cursor.fetchone()
        return row["value"] if row else default

def set_config(user_id: int, key: str, value: str):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO user_configs (user_id, key, value, updated_at) 
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP;
        """, (user_id, key, str(value)))
        conn.commit()

def get_all_configs(user_id: int) -> Dict[str, str]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM user_configs WHERE user_id = ?;", (user_id,))
        return {row["key"]: row["value"] for row in cursor.fetchall()}

# --- Platform Status (Per User) ---

def update_platform_status(user_id: int, platform: str, status: str, message: str = "", item_count: Optional[int] = None, rating: Optional[str] = None):
    with get_connection() as conn:
        cursor = conn.cursor()
        now_str = get_beijing_now().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute("""
            INSERT INTO platform_status (user_id, platform, status, message, last_checked_at, item_count, rating, updated_at)
            VALUES (?, ?, ?, ?, ?, COALESCE(?, 0), COALESCE(?, ''), CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, platform) DO UPDATE SET
                status = excluded.status,
                message = excluded.message,
                last_checked_at = excluded.last_checked_at,
                item_count = CASE WHEN excluded.item_count IS NOT NULL AND excluded.item_count > 0 THEN excluded.item_count ELSE platform_status.item_count END,
                rating = CASE WHEN excluded.rating IS NOT NULL AND excluded.rating != '' THEN excluded.rating ELSE platform_status.rating END,
                updated_at = CURRENT_TIMESTAMP;
        """, (user_id, platform, status, message, now_str, item_count, rating))
        conn.commit()

def get_platform_status(user_id: int, platform: str) -> Optional[Dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM platform_status WHERE user_id = ? AND platform = ?;", (user_id, platform))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_all_platform_status(user_id: int) -> List[Dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM platform_status WHERE user_id = ?;", (user_id,))
        return [dict(r) for r in cursor.fetchall()]

# --- Submissions Management (Per User) ---

def save_submissions(submissions: List[Dict[str, Any]], user_id: int = 1) -> int:
    if not submissions:
        return 0
    with get_connection() as conn:
        cursor = conn.cursor()
        inserted_count = 0
        for s in submissions:
            sub_id = f"u{user_id}_{s['platform']}_{s['raw_id']}"
            tags_json = json.dumps(s.get("tags", []), ensure_ascii=False)
            extra_json = json.dumps(s.get("extra_data", {}), ensure_ascii=False)
            
            sub_at = s.get("submitted_at", "")
            sub_date = s.get("date")
            if sub_at:
                sub_date = parse_beijing_str_to_date(sub_at)
            elif not sub_date:
                sub_date = ""

            cursor.execute("""
                INSERT INTO submissions (
                    id, user_id, platform, raw_id, problem_id, problem_title, verdict, tags,
                    difficulty, difficulty_score, submitted_at, date, submission_url,
                    code_language, extra_data
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    problem_title = excluded.problem_title,
                    verdict = excluded.verdict,
                    tags = excluded.tags,
                    difficulty = excluded.difficulty,
                    difficulty_score = excluded.difficulty_score,
                    submitted_at = CASE WHEN excluded.submitted_at != '' THEN excluded.submitted_at ELSE submissions.submitted_at END,
                    date = CASE WHEN excluded.date != '' THEN excluded.date ELSE submissions.date END,
                    submission_url = excluded.submission_url,
                    code_language = excluded.code_language,
                    extra_data = excluded.extra_data;
            """, (
                sub_id,
                user_id,
                s["platform"],
                s["raw_id"],
                s["problem_id"],
                s["problem_title"],
                s["verdict"],
                tags_json,
                s.get("difficulty", "未知"),
                s.get("difficulty_score", 0),
                s.get("submitted_at", ""),
                sub_date,
                s.get("submission_url", ""),
                s.get("code_language", ""),
                extra_json
            ))
            inserted_count += 1
        conn.commit()
        return inserted_count

def cleanup_luogu_placeholder_dates(user_id: int = 1):
    """清除旧版本中为洛谷历史归档题错误预填的占位日期，确保真实提交流精准显示"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM submissions WHERE user_id = ? AND platform = 'luogu' AND raw_id LIKE 'fail_unpassed_extra_%';", (user_id,))
        cursor.execute("UPDATE submissions SET submitted_at = '', date = '' WHERE user_id = ? AND platform = 'luogu' AND raw_id LIKE 'prob_%';", (user_id,))
        conn.commit()

def cleanup_acwing_old_problem_rows(user_id: int = 1):
    """清除旧版本中为 AcWing 创建的单题 prob_ 占位符，保留真实的提交流"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM submissions WHERE user_id = ? AND platform = 'acwing' AND raw_id LIKE 'prob_%';", (user_id,))
        conn.commit()

def get_submission_stats(user_id: int = 1) -> Dict[str, Any]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                COUNT(*) as total_subs,
                COUNT(DISTINCT CASE WHEN verdict = 'AC' THEN platform || ':' || problem_id END) as total_ac
            FROM submissions WHERE user_id = ?;
        """, (user_id,))
        overall = cursor.fetchone()
        
        today_str = get_effective_today()
        cursor.execute("""
            SELECT 
                COUNT(*) as today_subs,
                COUNT(DISTINCT CASE WHEN verdict = 'AC' THEN platform || ':' || problem_id END) as today_ac
            FROM submissions 
            WHERE user_id = ? AND date = ?;
        """, (user_id, today_str))
        today = cursor.fetchone()

        cursor.execute("""
            SELECT 
                platform,
                COUNT(*) as total,
                COUNT(DISTINCT CASE WHEN verdict = 'AC' THEN problem_id END) as ac
            FROM submissions
            WHERE user_id = ?
            GROUP BY platform;
        """, (user_id,))
        platforms_stats = {r["platform"]: {"ac": r["ac"], "total": r["total"]} for r in cursor.fetchall()}

        cursor.execute("SELECT DISTINCT date FROM submissions WHERE user_id = ? AND date != '' AND verdict = 'AC' ORDER BY date DESC;", (user_id,))
        dates = [r["date"] for r in cursor.fetchall()]
        
        streak = 0
        curr_d = (get_beijing_now() - timedelta(hours=4)).date()
        date_set = set(dates)
        if curr_d.strftime("%Y-%m-%d") not in date_set:
            curr_d = curr_d - timedelta(days=1)
            
        while curr_d.strftime("%Y-%m-%d") in date_set:
            streak += 1
            curr_d = curr_d - timedelta(days=1)

        return {
            "total_ac": overall["total_ac"] or 0,
            "total_subs": overall["total_subs"] or 0,
            "today_ac": today["today_ac"] or 0,
            "today_subs": today["today_subs"] or 0,
            "streak": streak,
            "platforms": platforms_stats
        }

def get_daily_counts(user_id: int = 1, platform: str = "") -> List[Dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        if platform and platform != "all":
            cursor.execute("""
                SELECT date, COUNT(*) as count 
                FROM submissions 
                WHERE user_id = ? AND platform = ? AND date != '' AND date IS NOT NULL
                GROUP BY date 
                ORDER BY date ASC;
            """, (user_id, platform))
        else:
            cursor.execute("""
                SELECT date, COUNT(*) as count 
                FROM submissions 
                WHERE user_id = ? AND date != '' AND date IS NOT NULL
                GROUP BY date 
                ORDER BY date ASC;
            """, (user_id,))
        return [dict(r) for r in cursor.fetchall()]

def get_tag_statistics(user_id: int = 1) -> List[Dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT platform, problem_id, tags, verdict FROM submissions WHERE user_id = ? AND tags IS NOT NULL AND tags != '';", (user_id,))
        rows = cursor.fetchall()
        
        tag_map = {}
        ac_problem_set = set()
        for r in rows:
            try:
                tags = json.loads(r["tags"])
                verdict = r["verdict"]
                plat = r["platform"]
                pid = r["problem_id"]
                for t in tags:
                    t_clean = t.strip()
                    if not t_clean:
                        continue
                    if t_clean not in tag_map:
                        tag_map[t_clean] = {"tag": t_clean, "ac_count": 0, "total_count": 0}
                    tag_map[t_clean]["total_count"] += 1
                    if verdict == "AC":
                        key = (t_clean, plat, pid)
                        if key not in ac_problem_set:
                            ac_problem_set.add(key)
                            tag_map[t_clean]["ac_count"] += 1
            except Exception:
                pass
                
        result = sorted(tag_map.values(), key=lambda x: (x["ac_count"], x["total_count"]), reverse=True)
        return result

def get_mistakes(user_id: int = 1, limit: int = 50) -> List[Dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                s.platform,
                s.problem_id,
                s.problem_title,
                s.difficulty,
                s.verdict,
                s.submission_url,
                s.tags,
                MAX(s.submitted_at) as submitted_at,
                COUNT(*) as fail_times
            FROM submissions s
            WHERE s.user_id = ?
              AND s.verdict != 'AC'
              AND NOT EXISTS (
                  SELECT 1 FROM submissions ac_s 
                  WHERE ac_s.user_id = s.user_id 
                    AND ac_s.platform = s.platform 
                    AND ac_s.problem_id = s.problem_id 
                    AND ac_s.verdict = 'AC'
              )
            GROUP BY s.platform, s.problem_id
            ORDER BY fail_times DESC, submitted_at DESC
            LIMIT ?;
        """, (user_id, limit))
        mistakes = []
        for r in cursor.fetchall():
            item = dict(r)
            item["tags"] = json.loads(item["tags"]) if item["tags"] else []
            mistakes.append(item)
        return mistakes

def get_recent_submissions(user_id: int = 1, limit: int = 2000, platform: str = "") -> List[Dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        if platform and platform != "all":
            cursor.execute("""
                SELECT * FROM submissions 
                WHERE user_id = ? AND platform = ?
                ORDER BY CASE WHEN submitted_at != '' AND submitted_at IS NOT NULL THEN 0 ELSE 1 END, 
                         submitted_at DESC, id DESC 
                LIMIT ?;
            """, (user_id, platform, limit))
        else:
            cursor.execute("""
                SELECT * FROM submissions 
                WHERE user_id = ?
                ORDER BY CASE WHEN submitted_at != '' AND submitted_at IS NOT NULL THEN 0 ELSE 1 END, 
                         submitted_at DESC, id DESC 
                LIMIT ?;
            """, (user_id, limit))
        rows = []
        for r in cursor.fetchall():
            item = dict(r)
            item["tags"] = json.loads(item["tags"]) if item["tags"] else []
            rows.append(item)
        return rows

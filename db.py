import json
import sqlite3
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from auth import hash_password, verify_password, generate_session_token

import re

BEIJING_TZ = timezone(timedelta(hours=8))

def get_beijing_now() -> datetime:
    return datetime.now(BEIJING_TZ)

def get_effective_today() -> str:
    """获取当前生效的统计归属日期（凌晨 4 点前算作昨日打卡）"""
    return (get_beijing_now() - timedelta(hours=4)).strftime("%Y-%m-%d")

def parse_relative_or_absolute_time(time_str: str) -> Tuple[str, str]:
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
    """将北京时间字符串或相对时间转换为熬夜归属统计日期（凌晨 4 点前算作前一日）"""
    if not dt_str:
        return ""
    _, date_str = parse_relative_or_absolute_time(dt_str)
    return date_str

DB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DB_PATH = os.path.join(DB_DIR, "oiboard.db")

def get_connection() -> sqlite3.Connection:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
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
            if "account_handle" not in sub_cols:
                cursor.execute("ALTER TABLE submissions ADD COLUMN account_handle TEXT DEFAULT '';")

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

        # 7. 跨平台比赛表 (Contests)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS contests (
                id TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                raw_id TEXT NOT NULL,
                name TEXT NOT NULL,
                start_time TEXT NOT NULL,
                start_timestamp INTEGER NOT NULL,
                duration_seconds INTEGER NOT NULL,
                duration_str TEXT NOT NULL,
                url TEXT NOT NULL,
                phase TEXT NOT NULL,
                rule_type TEXT DEFAULT '',
                updated_at TEXT NOT NULL
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_contests_start_ts ON contests(start_timestamp);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_contests_platform ON contests(platform);")

        # 8. 多平台账号表 (Platform Accounts - 支持单平台多账号)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS platform_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                platform TEXT NOT NULL,
                handle TEXT NOT NULL,
                cookie TEXT DEFAULT '',
                alias TEXT DEFAULT '',
                is_primary INTEGER DEFAULT 0,
                status TEXT DEFAULT 'unconfigured',
                status_message TEXT DEFAULT '',
                last_synced_at TEXT DEFAULT '',
                item_count INTEGER DEFAULT 0,
                rating TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_platform_accounts_user ON platform_accounts(user_id, platform);")

        # 9. 专属错题集表 (Mistakes Notebook - 手动精选收录 / 艾宾浩斯复习周期 / 原题代码联动)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS mistakes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                platform TEXT NOT NULL,
                problem_id TEXT NOT NULL,
                problem_title TEXT NOT NULL,
                difficulty TEXT DEFAULT '',
                tags TEXT DEFAULT '[]',
                key_point TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                problem_url TEXT DEFAULT '',
                last_submitted_at TEXT DEFAULT '',
                last_submission_id TEXT DEFAULT '',
                first_added_at TEXT DEFAULT CURRENT_TIMESTAMP,
                review_count INTEGER DEFAULT 0,
                max_review_count INTEGER DEFAULT 6,
                next_review_at TEXT DEFAULT '',
                status TEXT DEFAULT 'pending_review',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, platform, problem_id),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_mistakes_user_review ON mistakes(user_id, status, next_review_at);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_mistakes_user_sub_time ON mistakes(user_id, last_submitted_at);")

        # 为主账户填充默认配置（如果缺失）
        default_configs = {
            "cf_handle": "",
            "luogu_uid": "",
            "luogu_cookie": "",
            "acwing_user_id": "",
            "acwing_cookie": "",
            "atcoder_handle": "",
            "poll_interval_minutes": "30",
            "sprint_mode": "false",
            "last_sync_time": "",
            "http_proxy": "",
        }
        for k, v in default_configs.items():
            cursor.execute("INSERT OR IGNORE INTO user_configs (user_id, key, value) VALUES (1, ?, ?);", (k, v))
            
        platforms = ["codeforces", "luogu", "acwing", "atcoder"]
        for p in platforms:
            cursor.execute("""
                INSERT OR IGNORE INTO platform_status (user_id, platform, status, message, last_checked_at, item_count, rating)
                VALUES (1, ?, 'unconfigured', '未配置账号', '', 0, '');
            """, (p,))

        # 兼容存量单账号自动平滑迁移至 platform_accounts
        cursor.execute("SELECT id FROM users;")
        user_rows = cursor.fetchall()
        for u_row in user_rows:
            uid = u_row["id"]
            cursor.execute("SELECT COUNT(*) as cnt FROM platform_accounts WHERE user_id = ?;", (uid,))
            if cursor.fetchone()["cnt"] == 0:
                cursor.execute("SELECT key, value FROM user_configs WHERE user_id = ?;", (uid,))
                cfg_dict = {r["key"]: r["value"] for r in cursor.fetchall()}
                cursor.execute("SELECT platform, status, message, item_count, rating, last_checked_at FROM platform_status WHERE user_id = ?;", (uid,))
                stat_dict = {r["platform"]: dict(r) for r in cursor.fetchall()}

                # Codeforces
                cf_h = cfg_dict.get("cf_handle", "").strip()
                if cf_h:
                    st = stat_dict.get("codeforces", {})
                    cursor.execute("""
                        INSERT INTO platform_accounts (user_id, platform, handle, cookie, alias, is_primary, status, status_message, item_count, rating, last_synced_at)
                        VALUES (?, 'codeforces', ?, '', '主号', 1, ?, ?, ?, ?, ?);
                    """, (uid, cf_h, st.get("status", "ok"), st.get("message", ""), st.get("item_count", 0), st.get("rating", ""), st.get("last_checked_at", "")))

                # Luogu
                lg_u = cfg_dict.get("luogu_uid", "").strip()
                lg_c = cfg_dict.get("luogu_cookie", "").strip()
                if lg_u or lg_c:
                    st = stat_dict.get("luogu", {})
                    cursor.execute("""
                        INSERT INTO platform_accounts (user_id, platform, handle, cookie, alias, is_primary, status, status_message, item_count, rating, last_synced_at)
                        VALUES (?, 'luogu', ?, ?, '主号', 1, ?, ?, ?, ?, ?);
                    """, (uid, lg_u, lg_c, st.get("status", "ok"), st.get("message", ""), st.get("item_count", 0), st.get("rating", ""), st.get("last_checked_at", "")))

                # AcWing
                aw_u = cfg_dict.get("acwing_user_id", "").strip()
                aw_c = cfg_dict.get("acwing_cookie", "").strip()
                if aw_u or aw_c:
                    st = stat_dict.get("acwing", {})
                    cursor.execute("""
                        INSERT INTO platform_accounts (user_id, platform, handle, cookie, alias, is_primary, status, status_message, item_count, rating, last_synced_at)
                        VALUES (?, 'acwing', ?, ?, '主号', 1, ?, ?, ?, ?, ?);
                    """, (uid, aw_u, aw_c, st.get("status", "ok"), st.get("message", ""), st.get("item_count", 0), st.get("rating", ""), st.get("last_checked_at", "")))

                # AtCoder
                at_h = cfg_dict.get("atcoder_handle", "").strip()
                if at_h:
                    st = stat_dict.get("atcoder", {})
                    cursor.execute("""
                        INSERT INTO platform_accounts (user_id, platform, handle, cookie, alias, is_primary, status, status_message, item_count, rating, last_synced_at)
                        VALUES (?, 'atcoder', ?, '', '主号', 1, ?, ?, ?, ?, ?);
                    """, (uid, at_h, st.get("status", "ok"), st.get("message", ""), st.get("item_count", 0), st.get("rating", ""), st.get("last_checked_at", "")))

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
                "atcoder_handle": "",
                "poll_interval_minutes": "30",
                "sprint_mode": "false",
                "last_sync_time": "",
                "http_proxy": "",
            }
            for k, v in default_configs.items():
                cursor.execute("INSERT OR IGNORE INTO user_configs (user_id, key, value) VALUES (?, ?, ?);", (new_id, k, v))
            for p in ["codeforces", "luogu", "acwing", "atcoder"]:
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

# --- Platform Accounts (Multi-Account Support) ---

def _sync_primary_to_configs(cursor: sqlite3.Cursor, user_id: int, platform: str, handle: str, cookie: str):
    """保持向后兼容，将当前主账号同步至 user_configs 表"""
    mapping = {
        "codeforces": [("cf_handle", handle)],
        "luogu": [("luogu_uid", handle), ("luogu_cookie", cookie)],
        "acwing": [("acwing_user_id", handle), ("acwing_cookie", cookie)],
        "atcoder": [("atcoder_handle", handle)]
    }
    for k, v in mapping.get(platform, []):
        cursor.execute("""
            INSERT INTO user_configs (user_id, key, value) VALUES (?, ?, ?)
            ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value;
        """, (user_id, k, v))

def get_platform_accounts(user_id: int, platform: Optional[str] = None) -> List[Dict[str, Any]]:
    """获取用户绑定的平台账号列表"""
    with get_connection() as conn:
        cursor = conn.cursor()
        if platform and platform != "all":
            cursor.execute("""
                SELECT * FROM platform_accounts
                WHERE user_id = ? AND platform = ?
                ORDER BY is_primary DESC, id ASC;
            """, (user_id, platform))
        else:
            cursor.execute("""
                SELECT * FROM platform_accounts
                WHERE user_id = ?
                ORDER BY platform ASC, is_primary DESC, id ASC;
            """, (user_id,))
        return [dict(r) for r in cursor.fetchall()]

def get_account_by_id(account_id: int, user_id: int) -> Optional[Dict[str, Any]]:
    """根据 ID 获取账号详情"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM platform_accounts WHERE id = ? AND user_id = ?;", (account_id, user_id))
        row = cursor.fetchone()
        return dict(row) if row else None

def add_platform_account(user_id: int, platform: str, handle: str, cookie: str = "", alias: str = "", is_primary: bool = False) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    """新增平台账号 (支持多账号)"""
    handle = handle.strip()
    platform = platform.strip().lower()
    if not handle and platform not in ("acwing", "luogu"):
        return False, "请填写用户名或 Handle", None
    if not handle and not cookie:
        return False, "请填写用户名/UID 或 Cookie", None
    if not alias:
        alias = handle if handle else "默认账号"

    with get_connection() as conn:
        cursor = conn.cursor()
        # 检查是否已存在相同 handle 的账号
        cursor.execute("SELECT id FROM platform_accounts WHERE user_id = ? AND platform = ? AND handle = ?;", (user_id, platform, handle))
        if cursor.fetchone():
            return False, f"该平台下已存在账号 {handle}", None

        # 检查当前是否已有账号，若没有则此账号自动成为主账号
        cursor.execute("SELECT COUNT(*) as cnt FROM platform_accounts WHERE user_id = ? AND platform = ?;", (user_id, platform))
        has_existing = cursor.fetchone()["cnt"] > 0
        actual_primary = 1 if (is_primary or not has_existing) else 0

        if actual_primary:
            cursor.execute("UPDATE platform_accounts SET is_primary = 0 WHERE user_id = ? AND platform = ?;", (user_id, platform))

        cursor.execute("""
            INSERT INTO platform_accounts (user_id, platform, handle, cookie, alias, is_primary, status, status_message)
            VALUES (?, ?, ?, ?, ?, ?, 'unconfigured', '未同步');
        """, (user_id, platform, handle, cookie.strip(), alias.strip(), actual_primary))
        new_id = cursor.lastrowid
        
        # 同步回写 user_configs 保持兼容
        if actual_primary:
            _sync_primary_to_configs(cursor, user_id, platform, handle, cookie.strip())

        conn.commit()

        cursor.execute("SELECT * FROM platform_accounts WHERE id = ?;", (new_id,))
        acc = dict(cursor.fetchone())
        return True, "账号添加成功", acc

def update_platform_account(account_id: int, user_id: int, handle: Optional[str] = None, cookie: Optional[str] = None, alias: Optional[str] = None, is_primary: Optional[bool] = None, status: Optional[str] = None, status_message: Optional[str] = None, item_count: Optional[int] = None, rating: Optional[str] = None, last_synced_at: Optional[str] = None) -> Tuple[bool, str]:
    """更新平台账号信息"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM platform_accounts WHERE id = ? AND user_id = ?;", (account_id, user_id))
        existing = cursor.fetchone()
        if not existing:
            return False, "账号不存在"

        existing = dict(existing)
        platform = existing["platform"]

        new_handle = handle.strip() if handle is not None else existing["handle"]
        new_cookie = cookie.strip() if cookie is not None else existing["cookie"]
        new_alias = alias.strip() if alias is not None else existing["alias"]
        new_status = status if status is not None else existing["status"]
        new_msg = status_message if status_message is not None else existing["status_message"]
        new_items = item_count if item_count is not None else existing["item_count"]
        new_rating = rating if rating is not None else existing["rating"]
        new_last_synced = last_synced_at if last_synced_at is not None else existing["last_synced_at"]

        if is_primary:
            cursor.execute("UPDATE platform_accounts SET is_primary = 0 WHERE user_id = ? AND platform = ?;", (user_id, platform))
            new_primary = 1
        elif is_primary is False:
            new_primary = 0
        else:
            new_primary = existing["is_primary"]

        cursor.execute("""
            UPDATE platform_accounts SET
                handle = ?, cookie = ?, alias = ?, is_primary = ?,
                status = ?, status_message = ?, item_count = ?, rating = ?, last_synced_at = ?
            WHERE id = ? AND user_id = ?;
        """, (new_handle, new_cookie, new_alias, new_primary, new_status, new_msg, new_items, new_rating, new_last_synced, account_id, user_id))

        if new_primary:
            _sync_primary_to_configs(cursor, user_id, platform, new_handle, new_cookie)

        conn.commit()
        return True, "账号更新成功"

def delete_platform_account(account_id: int, user_id: int) -> Tuple[bool, str]:
    """删除绑定的账号 (保留其历史已拉取的题目数据，防止题数丢失)"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM platform_accounts WHERE id = ? AND user_id = ?;", (account_id, user_id))
        acc = cursor.fetchone()
        if not acc:
            return False, "账号不存在"
        
        acc = dict(acc)
        was_primary = acc["is_primary"]
        platform = acc["platform"]

        cursor.execute("DELETE FROM platform_accounts WHERE id = ? AND user_id = ?;", (account_id, user_id))
        
        # 若删除的是主账号，自动将剩余的第一个账号设为主账号
        if was_primary:
            cursor.execute("SELECT id, handle, cookie FROM platform_accounts WHERE user_id = ? AND platform = ? ORDER BY id ASC LIMIT 1;", (user_id, platform))
            next_primary = cursor.fetchone()
            if next_primary:
                cursor.execute("UPDATE platform_accounts SET is_primary = 1 WHERE id = ?;", (next_primary["id"],))
                _sync_primary_to_configs(cursor, user_id, platform, next_primary["handle"], next_primary["cookie"])
            else:
                _sync_primary_to_configs(cursor, user_id, platform, "", "")
                now_str = get_beijing_now().strftime("%Y-%m-%d %H:%M:%S")
                cursor.execute("""
                    INSERT INTO platform_status (user_id, platform, status, message, last_checked_at, item_count, rating, updated_at)
                    VALUES (?, ?, 'unconfigured', '未配置账号', ?, 0, '', CURRENT_TIMESTAMP)
                    ON CONFLICT(user_id, platform) DO UPDATE SET
                        status = 'unconfigured',
                        message = '未配置账号',
                        last_checked_at = excluded.last_checked_at,
                        item_count = 0,
                        rating = '',
                        updated_at = CURRENT_TIMESTAMP;
                """, (user_id, platform, now_str))

        conn.commit()
        return True, "账号已移除 (历史提交数据已安全保留)"

def set_primary_account(account_id: int, user_id: int) -> Tuple[bool, str]:
    """设为主账号"""
    return update_platform_account(account_id, user_id, is_primary=True)

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
            acc_handle = s.get("account_handle", "")
            
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
                    code_language, extra_data, account_handle
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    extra_data = excluded.extra_data,
                    account_handle = CASE WHEN excluded.account_handle != '' THEN excluded.account_handle ELSE submissions.account_handle END;
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
                extra_json,
                acc_handle
            ))
        conn.commit()
        return inserted_count

def cleanup_luogu_placeholder_dates(user_id: int = 1):
    """清除旧版本中为洛谷历史归档题错误预填的占位日期，确保真实提交流精准显示"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM submissions WHERE user_id = ? AND platform = 'luogu' AND raw_id LIKE 'fail_unpassed_extra_%';", (user_id,))
        cursor.execute("UPDATE submissions SET submitted_at = '', date = '' WHERE user_id = ? AND platform = 'luogu' AND raw_id LIKE 'prob_%';", (user_id,))
        cursor.execute("""
            DELETE FROM submissions 
            WHERE user_id = ? AND platform = 'luogu' AND raw_id LIKE 'prob_%'
              AND problem_id IN (
                  SELECT problem_id FROM submissions WHERE user_id = ? AND platform = 'luogu' AND raw_id LIKE 'rec_%'
              );
        """, (user_id, user_id))
        conn.commit()

def cleanup_acwing_old_problem_rows(user_id: int = 1):
    """清除旧版本中为 AcWing 创建的临时占位符与脏数据，保留官方唯一评测记录"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM submissions WHERE user_id = ? AND platform = 'acwing' AND (raw_id LIKE 'prob_%' OR raw_id LIKE 'sub_%' OR date LIKE '%前%' OR date LIKE '%刚刚%');", (user_id,))
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
        for p in ("codeforces", "luogu", "acwing", "atcoder"):
            if p not in platforms_stats:
                platforms_stats[p] = {"ac": 0, "total": 0}

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

def get_daily_counts(user_id: int = 1, platform: str = "", year: Optional[int] = None) -> List[Dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        conditions = ["user_id = ?", "date != ''", "date IS NOT NULL"]
        params = [user_id]
        
        if platform and platform != "all":
            conditions.append("platform = ?")
            params.append(platform)
            
        if year:
            conditions.append("strftime('%Y', date) = ?")
            params.append(str(year))
            
        where_clause = " AND ".join(conditions)
        cursor.execute(f"""
            SELECT 
                date, 
                COUNT(*) as count,
                COUNT(CASE WHEN verdict = 'AC' THEN 1 END) as ac_subs,
                COUNT(DISTINCT CASE WHEN verdict = 'AC' THEN platform || ':' || problem_id END) as unique_ac
            FROM submissions 
            WHERE {where_clause}
            GROUP BY date 
            ORDER BY date ASC;
        """, tuple(params))
        return [dict(r) for r in cursor.fetchall()]

def get_climbing_curve(user_id: int = 1, days: int = 365) -> List[Dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        # 1. 查询该用户全平台唯一的 AC 题目总数 (作为终点校准)
        cursor.execute("""
            SELECT COUNT(DISTINCT platform || ':' || problem_id) 
            FROM submissions 
            WHERE user_id = ? AND verdict = 'AC';
        """, (user_id,))
        total_ac = cursor.fetchone()[0] or 0
        if total_ac == 0:
            return []

        today_str = get_effective_today()
        today_dt = datetime.strptime(today_str, "%Y-%m-%d")
        start_date = (today_dt - timedelta(days=days)).strftime("%Y-%m-%d")
            
        # 2. 查询每道 AC 题目的首次解决日期 (最近一年内首次 AC 的题目)
        cursor.execute("""
            WITH first_ac AS (
                SELECT 
                    platform, 
                    problem_id, 
                    MIN(date) as first_ac_date
                FROM submissions
                WHERE user_id = ? AND verdict = 'AC' AND date != '' AND date IS NOT NULL
                GROUP BY platform, problem_id
            )
            SELECT 
                first_ac_date as date, 
                COUNT(*) as daily_new_ac
            FROM first_ac
            WHERE first_ac_date >= ?
            GROUP BY first_ac_date
            ORDER BY first_ac_date ASC;
        """, (user_id, start_date))
        rows = cursor.fetchall()
        
        daily_new_map = {r["date"]: r["daily_new_ac"] for r in rows}
        recent_sum = sum(daily_new_map.values())
        base_ac = max(0, total_ac - recent_sum)
        
        # 填充完整的连续日期序列（最小刻度保证为严格的 1 天，杜绝跳跃非等距）
        points = []
        cum = base_ac
        curr_dt = datetime.strptime(start_date, "%Y-%m-%d")
        while curr_dt <= today_dt:
            curr_str = curr_dt.strftime("%Y-%m-%d")
            new_ac = daily_new_map.get(curr_str, 0)
            cum += new_ac
            points.append({"date": curr_str, "ac": cum, "new_ac": new_ac})
            curr_dt += timedelta(days=1)
            
        if points:
            points[-1]["ac"] = total_ac
            
        return points

def get_recent_daily_effort(user_id: int = 1, days: int = 365) -> List[Dict[str, Any]]:
    today_str = get_effective_today()
    today_dt = datetime.strptime(today_str, "%Y-%m-%d")
    start_date = (today_dt - timedelta(days=days)).strftime("%Y-%m-%d")
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                date, 
                COUNT(*) as total_subs,
                COUNT(DISTINCT CASE WHEN verdict = 'AC' THEN platform || ':' || problem_id END) as unique_ac
            FROM submissions 
            WHERE user_id = ? AND date >= ? AND date != '' AND date IS NOT NULL
            GROUP BY date 
            ORDER BY date ASC;
        """, (user_id, start_date))
        rows = cursor.fetchall()
        return [dict(r) for r in rows]

def get_submission_years(user_id: int = 1) -> List[int]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT strftime('%Y', date) as yr 
            FROM submissions 
            WHERE user_id = ? AND date != '' AND date IS NOT NULL AND yr IS NOT NULL
            ORDER BY yr DESC;
        """, (user_id,))
        years = []
        for r in cursor.fetchall():
            try:
                y = int(r["yr"])
                if 2000 <= y <= 2100:
                    years.append(y)
            except Exception:
                pass
        curr_yr = get_beijing_now().year
        if curr_yr not in years:
            years.append(curr_yr)
        return sorted(list(set(years)), reverse=True)

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

REVIEW_INTERVALS = [7, 14, 21, 28, 42, 60]

def calculate_next_review_date(base_date_str: str, review_count: int) -> str:
    """根据当前复习次数计算下一次复习目标日期 (YYYY-MM-DD)，超过最大轮次返回空字符串"""
    if review_count >= len(REVIEW_INTERVALS):
        return ""
    days = REVIEW_INTERVALS[review_count]
    base_dt = None
    if base_date_str:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                base_dt = datetime.strptime(base_date_str[:19], fmt)
                break
            except Exception:
                pass
    if not base_dt:
        base_dt = datetime.now()
    next_dt = base_dt + timedelta(days=days)
    return next_dt.strftime("%Y-%m-%d")

def build_default_problem_url(platform: str, problem_id: str, raw_sub_url: str = "") -> str:
    """根据题目平台与ID自动生成原题直达链接"""
    plat = (platform or "").lower()
    pid = str(problem_id or "").strip()
    if not pid:
        return raw_sub_url or ""
    if plat == "luogu":
        return f"https://www.luogu.com.cn/problem/{pid}"
    elif plat in ("codeforces", "cf"):
        m = re.match(r"^(\d+)[/_ -]?([A-Za-z0-9]+)$", pid)
        if m:
            return f"https://codeforces.com/problemset/problem/{m.group(1)}/{m.group(2)}"
        return f"https://codeforces.com/problemset/problem/{pid}"
    elif plat == "atcoder":
        m = re.match(r"^([a-zA-Z0-9]+)_[a-zA-Z0-9]+$", pid)
        if m:
            return f"https://atcoder.jp/contests/{m.group(1)}/tasks/{pid}"
        return f"https://atcoder.jp/tasks/{pid}"
    elif plat == "acwing":
        return f"https://www.acwing.com/problem/content/{pid}/"
    return raw_sub_url or ""

def add_mistake(
    user_id: int,
    platform: str,
    problem_id: str,
    problem_title: str,
    difficulty: str = "",
    tags: Any = None,
    key_point: str = "",
    notes: str = "",
    problem_url: str = "",
    last_submitted_at: str = "",
    last_submission_id: str = ""
) -> Dict[str, Any]:
    """用户手动将题目收录到专属错题集"""
    plat = platform.lower()
    pid = str(problem_id).strip()
    
    # 格式化标签
    if isinstance(tags, list):
        tags_json = json.dumps([str(t).strip() for t in tags if str(t).strip()], ensure_ascii=False)
    elif isinstance(tags, str):
        try:
            parsed = json.loads(tags)
            if isinstance(parsed, list):
                tags_json = json.dumps([str(t).strip() for t in parsed if str(t).strip()], ensure_ascii=False)
            else:
                tags_json = json.dumps([tags.strip()], ensure_ascii=False)
        except Exception:
            tags_json = json.dumps([t.strip() for t in tags.split(",") if t.strip()], ensure_ascii=False)
    else:
        tags_json = "[]"

    if not problem_url:
        problem_url = build_default_problem_url(plat, pid)

    with get_connection() as conn:
        cursor = conn.cursor()
        # 如果未传入提交时间，从 submissions 表查询该题最新的提交时间
        if not last_submitted_at:
            cursor.execute("""
                SELECT id, submitted_at FROM submissions
                WHERE user_id = ? AND platform = ? AND problem_id = ?
                ORDER BY submitted_at DESC LIMIT 1
            """, (user_id, plat, pid))
            sub_row = cursor.fetchone()
            if sub_row:
                last_submitted_at = sub_row["submitted_at"]
                if not last_submission_id:
                    last_submission_id = sub_row["id"]
        
        if not last_submitted_at:
            last_submitted_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        next_review = calculate_next_review_date(last_submitted_at, 0)

        cursor.execute("""
            INSERT INTO mistakes (
                user_id, platform, problem_id, problem_title, difficulty, tags,
                key_point, notes, problem_url, last_submitted_at, last_submission_id,
                first_added_at, review_count, max_review_count, next_review_at, status,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 0, 6, ?, 'pending_review', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, platform, problem_id) DO UPDATE SET
                problem_title = excluded.problem_title,
                difficulty = CASE WHEN excluded.difficulty != '' THEN excluded.difficulty ELSE mistakes.difficulty END,
                tags = CASE WHEN excluded.tags != '[]' AND excluded.tags != '' THEN excluded.tags ELSE mistakes.tags END,
                key_point = CASE WHEN excluded.key_point != '' THEN excluded.key_point ELSE mistakes.key_point END,
                notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE mistakes.notes END,
                problem_url = CASE WHEN excluded.problem_url != '' THEN excluded.problem_url ELSE mistakes.problem_url END,
                last_submitted_at = CASE WHEN excluded.last_submitted_at != '' THEN excluded.last_submitted_at ELSE mistakes.last_submitted_at END,
                last_submission_id = CASE WHEN excluded.last_submission_id != '' THEN excluded.last_submission_id ELSE mistakes.last_submission_id END,
                updated_at = CURRENT_TIMESTAMP;
        """, (
            user_id, plat, pid, problem_title, difficulty, tags_json,
            key_point, notes, problem_url, last_submitted_at, last_submission_id,
            next_review
        ))
        conn.commit()

        cursor.execute("SELECT * FROM mistakes WHERE user_id = ? AND platform = ? AND problem_id = ?", (user_id, plat, pid))
        row = cursor.fetchone()
        res = dict(row)
        res["tags"] = json.loads(res["tags"]) if res["tags"] else []
        return res

def get_user_mistakes(
    user_id: int = 1,
    status: str = "all",
    search: str = "",
    tag: str = "",
    platform: str = "",
    sort_by: str = "last_submitted_at",
    page: int = 1,
    page_size: int = 50
) -> Dict[str, Any]:
    """获取用户错题集，严格按最新提交时间排序，并提供智能到期/进度聚合统计"""
    today_str = datetime.now().strftime("%Y-%m-%d")

    with get_connection() as conn:
        cursor = conn.cursor()

        # 1. 获取全局各状态数量
        cursor.execute("""
            SELECT
                COUNT(*) as total_count,
                SUM(CASE WHEN status != 'mastered' AND next_review_at != '' AND next_review_at <= ? THEN 1 ELSE 0 END) as due_count,
                SUM(CASE WHEN status = 'pending_review' AND (next_review_at = '' OR next_review_at > ?) THEN 1 ELSE 0 END) as in_progress_count,
                SUM(CASE WHEN status = 'mastered' THEN 1 ELSE 0 END) as mastered_count
            FROM mistakes
            WHERE user_id = ?
        """, (today_str, today_str, user_id))
        count_row = cursor.fetchone()
        counts = {
            "total": count_row["total_count"] or 0,
            "due": count_row["due_count"] or 0,
            "in_progress": count_row["in_progress_count"] or 0,
            "mastered": count_row["mastered_count"] or 0
        }

        # 2. 构建条件查询
        query_sql = "SELECT * FROM mistakes WHERE user_id = ?"
        params: List[Any] = [user_id]

        if platform and platform != "all":
            query_sql += " AND platform = ?"
            params.append(platform)

        if status == "due":
            query_sql += " AND status != 'mastered' AND next_review_at != '' AND next_review_at <= ?"
            params.append(today_str)
        elif status == "pending_review":
            query_sql += " AND status = 'pending_review' AND (next_review_at = '' OR next_review_at > ?)"
            params.append(today_str)
        elif status == "mastered":
            query_sql += " AND status = 'mastered'"

        if search:
            query_sql += " AND (problem_id LIKE ? OR problem_title LIKE ? OR key_point LIKE ? OR notes LIKE ?)"
            s_param = f"%{search.strip()}%"
            params.extend([s_param, s_param, s_param, s_param])

        if tag:
            query_sql += " AND tags LIKE ?"
            params.append(f"%{tag.strip()}%")

        # 统计筛选后总数
        count_query = query_sql.replace("SELECT *", "SELECT COUNT(*)")
        cursor.execute(count_query, params)
        filtered_total = cursor.fetchone()[0]

        # 排序：默认严格按最新提交时间倒序
        if sort_by == "next_review_at":
            query_sql += " ORDER BY CASE WHEN next_review_at != '' THEN 0 ELSE 1 END, next_review_at ASC, id DESC"
        elif sort_by == "review_count":
            query_sql += " ORDER BY review_count ASC, last_submitted_at DESC"
        else:
            query_sql += " ORDER BY CASE WHEN last_submitted_at != '' AND last_submitted_at IS NOT NULL THEN 0 ELSE 1 END, last_submitted_at DESC, id DESC"

        offset = max(0, (page - 1) * page_size)
        query_sql += " LIMIT ? OFFSET ?"
        params.extend([page_size, offset])

        cursor.execute(query_sql, params)
        rows = cursor.fetchall()
        items = []
        today_date = datetime.now().date()

        for r in rows:
            item = dict(r)
            item["tags"] = json.loads(item["tags"]) if item["tags"] else []
            
            # 计算倒计时与到期状态
            item["is_due"] = False
            item["days_left"] = None
            if item["next_review_at"]:
                try:
                    target_date = datetime.strptime(item["next_review_at"], "%Y-%m-%d").date()
                    days = (target_date - today_date).days
                    item["days_left"] = days
                    if days <= 0 and item["status"] != "mastered":
                        item["is_due"] = True
                except Exception:
                    pass
            items.append(item)

        return {
            "items": items,
            "total": filtered_total,
            "counts": counts,
            "page": page,
            "page_size": page_size
        }

def get_mistake_by_id(mistake_id: int, user_id: int = 1) -> Optional[Dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM mistakes WHERE id = ? AND user_id = ?", (mistake_id, user_id))
        row = cursor.fetchone()
        if not row:
            return None
        res = dict(row)
        res["tags"] = json.loads(res["tags"]) if res["tags"] else []
        return res

def get_user_mistake_keys(user_id: int = 1) -> List[str]:
    """返回用户已收录题目的集合 key (格式: 'platform:problem_id')"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT platform, problem_id FROM mistakes WHERE user_id = ?", (user_id,))
        return [f"{r['platform']}:{r['problem_id']}" for r in cursor.fetchall()]

def update_mistake(
    user_id: int,
    mistake_id: int,
    key_point: Optional[str] = None,
    notes: Optional[str] = None,
    tags: Optional[Any] = None,
    problem_url: Optional[str] = None,
    status: Optional[str] = None
) -> bool:
    """更新错题的卡点、笔记代码、标签或状态"""
    fields = []
    params = []
    if key_point is not None:
        fields.append("key_point = ?")
        params.append(key_point)
    if notes is not None:
        fields.append("notes = ?")
        params.append(notes)
    if tags is not None:
        if isinstance(tags, list):
            tags_json = json.dumps([str(t).strip() for t in tags if str(t).strip()], ensure_ascii=False)
        else:
            tags_json = str(tags)
        fields.append("tags = ?")
        params.append(tags_json)
    if problem_url is not None:
        fields.append("problem_url = ?")
        params.append(problem_url)
    if status is not None:
        fields.append("status = ?")
        params.append(status)

    if not fields:
        return False

    fields.append("updated_at = CURRENT_TIMESTAMP")
    sql = f"UPDATE mistakes SET {', '.join(fields)} WHERE id = ? AND user_id = ?"
    params.extend([mistake_id, user_id])

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(sql, params)
        conn.commit()
        return cursor.rowcount > 0

def delete_mistake(user_id: int, mistake_id: int) -> bool:
    """从错题集中移除题目"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM mistakes WHERE id = ? AND user_id = ?", (mistake_id, user_id))
        conn.commit()
        return cursor.rowcount > 0

def manual_record_review(user_id: int, mistake_id: int, review_time: str = "") -> Optional[Dict[str, Any]]:
    """手动打卡完成一次复习，自动推进轮次并计算下个目标日期"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM mistakes WHERE id = ? AND user_id = ?", (mistake_id, user_id))
        row = cursor.fetchone()
        if not row:
            return None
        
        m = dict(row)
        now_str = review_time or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        new_count = (m["review_count"] or 0) + 1
        max_reviews = m["max_review_count"] or 6

        if new_count >= max_reviews:
            new_status = "mastered"
            next_review = ""
        else:
            new_status = m["status"] if m["status"] != "archived" else "pending_review"
            next_review = calculate_next_review_date(now_str, new_count)

        cursor.execute("""
            UPDATE mistakes
            SET review_count = ?,
                next_review_at = ?,
                status = ?,
                last_submitted_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (new_count, next_review, new_status, now_str, mistake_id))
        conn.commit()
        m["review_count"] = new_count
        m["next_review_at"] = next_review
        m["status"] = new_status
        m["last_submitted_at"] = now_str
        m["tags"] = json.loads(m["tags"]) if m["tags"] else []
        return m

def toggle_mistake_mastered(user_id: int, mistake_id: int, mastered: Optional[bool] = None) -> Optional[Dict[str, Any]]:
    """切换掌握状态（形成肌肉记忆）"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM mistakes WHERE id = ? AND user_id = ?", (mistake_id, user_id))
        row = cursor.fetchone()
        if not row:
            return None
        
        m = dict(row)
        current_status = m["status"]
        if mastered is None:
            new_status = "pending_review" if current_status == "mastered" else "mastered"
        else:
            new_status = "mastered" if mastered else "pending_review"
        
        if new_status == "mastered":
            next_review = ""
        else:
            next_review = calculate_next_review_date(datetime.now().strftime("%Y-%m-%d %H:%M:%S"), m["review_count"] or 0)
        
        cursor.execute("""
            UPDATE mistakes
            SET status = ?, next_review_at = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (new_status, next_review, mistake_id))
        conn.commit()
        m["status"] = new_status
        m["next_review_at"] = next_review
        m["tags"] = json.loads(m["tags"]) if m["tags"] else []
        return m

def sync_mistakes_with_submissions(user_id: int = 1) -> int:
    """
    检查 submissions 表中是否有错题的更新提交记录。
    如果发现用户在添加错题后重新提交（重做），自动更新 last_submitted_at 并推进一步复习进度。
    """
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, platform, problem_id, last_submitted_at, review_count, max_review_count, status
            FROM mistakes
            WHERE user_id = ?
        """, (user_id,))
        mistakes = cursor.fetchall()
        if not mistakes:
            return 0

        updated_count = 0
        for m in mistakes:
            m_id = m["id"]
            plat = m["platform"]
            pid = m["problem_id"]
            last_sub_at = m["last_submitted_at"] or ""
            current_review_count = m["review_count"] or 0
            max_reviews = m["max_review_count"] or 6

            if last_sub_at:
                cursor.execute("""
                    SELECT id, submitted_at
                    FROM submissions
                    WHERE user_id = ? AND platform = ? AND problem_id = ? AND submitted_at > ?
                    ORDER BY submitted_at ASC
                """, (user_id, plat, pid, last_sub_at))
            else:
                cursor.execute("""
                    SELECT id, submitted_at
                    FROM submissions
                    WHERE user_id = ? AND platform = ? AND problem_id = ?
                    ORDER BY submitted_at ASC
                """, (user_id, plat, pid))
            
            newer_subs = cursor.fetchall()
            if not newer_subs:
                continue

            simulated_last_sub = last_sub_at
            simulated_review_count = current_review_count
            latest_sub_id = m.get("last_submission_id", "")

            for sub in newer_subs:
                sub_time_str = sub["submitted_at"]
                sub_id = sub["id"]
                latest_sub_id = sub_id

                is_new_session = False
                if not simulated_last_sub:
                    is_new_session = True
                else:
                    try:
                        t1 = datetime.strptime(simulated_last_sub[:19], "%Y-%m-%d %H:%M:%S")
                        t2 = datetime.strptime(sub_time_str[:19], "%Y-%m-%d %H:%M:%S")
                        if (t2 - t1).total_seconds() >= 21600:
                            is_new_session = True
                    except Exception:
                        if sub_time_str[:10] != simulated_last_sub[:10]:
                            is_new_session = True

                simulated_last_sub = sub_time_str
                if is_new_session and m["status"] != "mastered":
                    simulated_review_count += 1

            new_status = m["status"]
            if simulated_review_count >= max_reviews:
                new_status = "mastered"
                next_review = ""
            else:
                next_review = calculate_next_review_date(simulated_last_sub, simulated_review_count)

            cursor.execute("""
                UPDATE mistakes
                SET last_submitted_at = ?,
                    last_submission_id = ?,
                    review_count = ?,
                    next_review_at = ?,
                    status = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (simulated_last_sub, latest_sub_id, simulated_review_count, next_review, new_status, m_id))
            updated_count += 1

        if updated_count > 0:
            conn.commit()
        return updated_count

def get_mistakes(user_id: int = 1, limit: int = 50) -> List[Dict[str, Any]]:
    """向后兼容接口：获取用户当前专属错题集列表"""
    res = get_user_mistakes(user_id=user_id, page_size=limit)
    return res.get("items", [])

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

def save_contests(contests: List[Dict[str, Any]]) -> int:
    """保存或更新比赛列表"""
    if not contests:
        return 0
    with get_connection() as conn:
        cursor = conn.cursor()
        inserted = 0
        for c in contests:
            cursor.execute("""
                INSERT INTO contests (
                    id, platform, raw_id, name, start_time, start_timestamp,
                    duration_seconds, duration_str, url, phase, rule_type, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    start_time = excluded.start_time,
                    start_timestamp = excluded.start_timestamp,
                    duration_seconds = excluded.duration_seconds,
                    duration_str = excluded.duration_str,
                    url = excluded.url,
                    phase = excluded.phase,
                    rule_type = excluded.rule_type,
                    updated_at = excluded.updated_at;
            """, (
                c["id"], c["platform"], c["raw_id"], c["name"], c["start_time"],
                c["start_timestamp"], c["duration_seconds"], c["duration_str"],
                c["url"], c["phase"], c.get("rule_type", ""), c["updated_at"]
            ))
            inserted += 1
        conn.commit()
        return inserted

def get_upcoming_contests(platform: str = "all", limit: int = 60) -> List[Dict[str, Any]]:
    """获取所有未结束的比赛（含即将开始和进行中），按开始时间升序排列"""
    now_ts = int(datetime.now(timezone.utc).timestamp())
    with get_connection() as conn:
        cursor = conn.cursor()
        if platform and platform != "all":
            cursor.execute("""
                SELECT * FROM contests
                WHERE platform = ? AND (start_timestamp + duration_seconds) > ?
                ORDER BY start_timestamp ASC
                LIMIT ?;
            """, (platform, now_ts, limit))
        else:
            cursor.execute("""
                SELECT * FROM contests
                WHERE (start_timestamp + duration_seconds) > ?
                ORDER BY start_timestamp ASC
                LIMIT ?;
            """, (now_ts, limit))
        
        rows = [dict(r) for r in cursor.fetchall()]
        # 动态计算最新的实时状态与倒计时秒数
        for r in rows:
            st = r["start_timestamp"]
            dur = r["duration_seconds"]
            et = st + dur
            if now_ts < st:
                r["phase"] = "BEFORE"
                r["countdown_seconds"] = st - now_ts
                r["status_text"] = "未开始"
            elif now_ts < et:
                r["phase"] = "CODING"
                r["countdown_seconds"] = et - now_ts
                r["status_text"] = "进行中"
            else:
                r["phase"] = "FINISHED"
                r["countdown_seconds"] = 0
                r["status_text"] = "已结束"
        return rows

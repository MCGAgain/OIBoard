-- ==============================================================
-- 多平台 OJ 提交采集与端云核实系统数据库结构
-- ==============================================================

-- 1. MySQL 规范建表定义 (InnoDB, utf8mb4)
CREATE TABLE IF NOT EXISTS oj_submissions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '系统内部用户ID',
    platform VARCHAR(32) NOT NULL COMMENT 'leetcode_cn | luogu | acwing | codeforces | atcoder',
    platform_submission_id VARCHAR(64) NOT NULL COMMENT 'OJ平台原始提交ID (rid / submission_id)',
    problem_id VARCHAR(64) NOT NULL COMMENT '平台题目编号 (如 P1001, two-sum, 1920A)',
    problem_title VARCHAR(255) DEFAULT NULL COMMENT '题目标题',
    problem_url VARCHAR(512) NOT NULL COMMENT '题目链接',
    platform_user_handle VARCHAR(64) DEFAULT NULL COMMENT 'OJ平台用户名或Handle',
    verdict VARCHAR(16) NOT NULL COMMENT 'AC | WA | TLE | MLE | RE | CE | PA | OTHER',
    raw_status VARCHAR(64) DEFAULT NULL COMMENT '原始状态描述',
    score INT DEFAULT 100 COMMENT '得分',
    language VARCHAR(32) NOT NULL COMMENT '编程语言',
    source_code MEDIUMTEXT DEFAULT NULL COMMENT '油猴端截获的源代码',
    execution_time_ms INT DEFAULT NULL COMMENT '运行耗时(ms)',
    memory_used_kb INT DEFAULT NULL COMMENT '运行内存(KB)',
    
    -- 核心：核实状态机字段
    verify_status VARCHAR(24) NOT NULL DEFAULT 'OPTIMISTIC' 
        COMMENT 'OPTIMISTIC(油猴上报乐观采信) | VERIFIED(爬虫核实通过) | FALLBACK_TRUSTED(爬虫风控失效回退采信) | REJECTED(核实发现伪造)',
    verify_retry_count INT NOT NULL DEFAULT 0 COMMENT '爬虫核实重试次数',
    verify_error_msg VARCHAR(512) DEFAULT NULL COMMENT '最近一次爬虫核实失败原因(如 403/Captcha)',
    
    submitted_at DATETIME NOT NULL COMMENT '提交时间',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- 核心幂等索引：同一个平台的同一个提交ID全局唯一
    UNIQUE KEY uk_platform_submission (platform, platform_submission_id),
    KEY idx_user_verdict (user_id, verdict, submitted_at),
    KEY idx_verify_status (verify_status, verify_retry_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='OJ提交记录与端云核实表';

-- --------------------------------------------------------------
-- 2. SQLite 兼容建表定义 (针对本地开发与 SQLite 嵌入式存储)
-- --------------------------------------------------------------
-- CREATE TABLE IF NOT EXISTS oj_submissions (
--     id INTEGER PRIMARY KEY AUTOINCREMENT,
--     user_id INTEGER NOT NULL DEFAULT 1,
--     platform TEXT NOT NULL,
--     platform_submission_id TEXT NOT NULL,
--     problem_id TEXT NOT NULL,
--     problem_title TEXT,
--     problem_url TEXT NOT NULL,
--     platform_user_handle TEXT,
--     verdict TEXT NOT NULL,
--     raw_status TEXT,
--     score INTEGER DEFAULT 100,
--     language TEXT NOT NULL,
--     source_code TEXT,
--     execution_time_ms INTEGER,
--     memory_used_kb INTEGER,
--     verify_status TEXT NOT NULL DEFAULT 'OPTIMISTIC',
--     verify_retry_count INTEGER NOT NULL DEFAULT 0,
--     verify_error_msg TEXT,
--     submitted_at TEXT NOT NULL,
--     created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
--     updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
--     UNIQUE (platform, platform_submission_id)
-- );
-- CREATE INDEX IF NOT EXISTS idx_user_verdict ON oj_submissions (user_id, verdict, submitted_at);
-- CREATE INDEX IF NOT EXISTS idx_verify_status ON oj_submissions (verify_status, verify_retry_count);

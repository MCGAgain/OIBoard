import hashlib
import secrets
import hmac
from typing import Tuple, Optional

# PBKDF2 安全配置 (260,000 次 SHA256 迭代，抗爆破与彩虹表攻击)
ITERATIONS = 260000
HASH_NAME = "sha256"

def hash_password(password: str, salt: Optional[str] = None) -> Tuple[str, str]:
    """生成带随机 Salt 的安全密码哈希"""
    if not salt:
        salt = secrets.token_hex(16)
    
    pwd_bytes = password.encode("utf-8")
    salt_bytes = salt.encode("utf-8")
    
    hash_bytes = hashlib.pbkdf2_hmac(
        HASH_NAME,
        pwd_bytes,
        salt_bytes,
        ITERATIONS
    )
    return hash_bytes.hex(), salt

def verify_password(password: str, salt: str, expected_hash: str) -> bool:
    """常量时间比对密码哈希 (防止时序侧信道攻击)"""
    computed_hash, _ = hash_password(password, salt=salt)
    return hmac.compare_digest(computed_hash, expected_hash)

def generate_session_token() -> str:
    """生成 256 位高熵加密会话 Token"""
    return secrets.token_hex(32)

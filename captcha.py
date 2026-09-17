import io
import time
import base64
import random
import secrets
import threading
from typing import Tuple, Dict
from PIL import Image, ImageDraw, ImageFont

# 排除易混淆字符 (0, O, 1, I, l)
CAPTCHA_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

# 优雅高对比度深色系字符调色板 (Apple Minimalist 质感)
CHAR_COLORS = [
    (30, 41, 59),    # slate-800
    (29, 78, 216),   # blue-700
    (4, 120, 87),    # emerald-700
    (185, 28, 28),   # red-700
    (107, 33, 168),  # purple-800
    (194, 65, 12),   # orange-700
    (15, 118, 110),  # teal-700
]

# 干扰线颜色库 (柔和对比度)
LINE_COLORS = [
    (148, 163, 184), # slate-400
    (147, 197, 253), # blue-300
    (167, 243, 208), # emerald-200
    (252, 165, 165), # red-300
    (216, 180, 254), # purple-300
    (253, 186, 116), # orange-300
]


def generate_captcha_image(text: str, width: int = 130, height: int = 42) -> str:
    """生成带噪声、旋转与干扰线条的图片验证码，并返回 Base64 Data URL"""
    # 1. 创建微灰质感背景
    bg_r = random.randint(242, 248)
    bg_g = random.randint(242, 248)
    bg_b = random.randint(245, 252)
    img = Image.new("RGB", (width, height), color=(bg_r, bg_g, bg_b))
    draw = ImageDraw.Draw(img)

    # 2. 绘制散落噪点 (60 - 90 个随机颜色噪点)
    for _ in range(random.randint(60, 90)):
        nx = random.randint(0, width - 1)
        ny = random.randint(0, height - 1)
        nr = random.randint(100, 220)
        ng = random.randint(100, 220)
        nb = random.randint(100, 220)
        draw.point((nx, ny), fill=(nr, ng, nb))

    # 3. 绘制干扰线 (3 - 5 条随机贝塞尔/曲折线条)
    for _ in range(random.randint(3, 5)):
        start_x = random.randint(0, int(width * 0.3))
        start_y = random.randint(0, height)
        end_x = random.randint(int(width * 0.7), width)
        end_y = random.randint(0, height)
        mid_x = random.randint(int(width * 0.3), int(width * 0.7))
        mid_y = random.randint(0, height)
        line_color = random.choice(LINE_COLORS)
        draw.line([(start_x, start_y), (mid_x, mid_y), (end_x, end_y)], fill=line_color, width=random.randint(1, 2))

    # 4. 加载字体 (自适应 FreeType 字体大小)
    try:
        font = ImageFont.load_default(size=26)
    except TypeError:
        # 兼容旧版本 Pillow
        font = ImageFont.load_default()

    # 5. 逐个绘制字符 (独立随机倾斜、位移与缩放)
    char_count = len(text)
    slot_width = (width - 20) / char_count

    for i, char in enumerate(text):
        char_color = random.choice(CHAR_COLORS)
        
        # 在独立的 RGBA 图层上渲染字符以便旋转
        char_img = Image.new("RGBA", (36, 36), (0, 0, 0, 0))
        char_draw = ImageDraw.Draw(char_img)
        char_draw.text((8, 2), char, fill=char_color, font=font)

        # 随机旋转 -22 度到 +22 度
        angle = random.randint(-22, 22)
        rotated_char = char_img.rotate(angle, expand=False, resample=Image.BICUBIC)

        # 粘贴回主画布 (带微幅纵向与横向抖动)
        paste_x = int(10 + i * slot_width + random.randint(-2, 2))
        paste_y = int((height - 36) / 2 + random.randint(-3, 3))
        img.paste(rotated_char, (paste_x, paste_y), mask=rotated_char)

    # 6. 转为 Base64 PNG 格式
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    b64_data = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64_data}"


class CaptchaStore:
    """线程安全的验证码缓存与生命周期管理器 (带自动过期与单次防重放机制)"""
    def __init__(self, ttl_seconds: int = 300):
        self._ttl = ttl_seconds
        self._store: Dict[str, Tuple[str, float]] = {}
        self._lock = threading.Lock()

    def generate(self, length: int = 4) -> Tuple[str, str]:
        """生成验证码并返回 (captcha_id, image_data_url)"""
        code = "".join(random.choices(CAPTCHA_CHARS, k=length))
        captcha_id = secrets.token_hex(16)
        expires_at = time.time() + self._ttl
        
        image_data = generate_captcha_image(code)

        with self._lock:
            # 清理历史过期项
            now = time.time()
            self._store = {k: v for k, v in self._store.items() if v[1] > now}
            self._store[captcha_id] = (code, expires_at)

        return captcha_id, image_data

    def verify(self, captcha_id: str, input_code: str) -> Tuple[bool, str]:
        """校验验证码，单次即刻销毁，不区分大小写"""
        if not captcha_id or not input_code:
            return False, "请填写图片验证码"

        with self._lock:
            entry = self._store.pop(captcha_id, None)

        if not entry:
            return False, "验证码已失效，请点击刷新"

        expected_code, expires_at = entry
        if time.time() > expires_at:
            return False, "验证码已过期，请点击刷新"

        if input_code.strip().upper() != expected_code.upper():
            return False, "验证码不正确，请重新输入"

        return True, ""


# 全局单例
captcha_store = CaptchaStore(ttl_seconds=300)

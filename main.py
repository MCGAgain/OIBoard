import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from typing import Dict, Any, Optional, List

import db
from captcha import captcha_store
from scheduler import scheduler_instance, sanitize_proxy
from fetchers import CodeforcesFetcher, LuoguFetcher, AcWingFetcher, AtCoderFetcher

# --- Lifespan ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时初始化数据库与多租户表结构
    db.init_db()
    # 启动后台轮询任务
    bg_task = asyncio.create_task(scheduler_instance.run_loop())
    # 启动时异步预热一次跨平台比赛列表
    asyncio.create_task(scheduler_instance.sync_contests())
    yield
    # 关闭时取消任务
    bg_task.cancel()
    try:
        await bg_task
    except asyncio.CancelledError:
        pass

app = FastAPI(title="OIBoard API", version="2.0.0", lifespan=lifespan)

# 允许跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 强制 API 响应与首页禁止缓存中间件 (杜绝前端同步后读到旧缓存的问题)
@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/") or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# --- Pydantic Models ---
class RegisterPayload(BaseModel):
    username: str
    password: str
    captcha_id: Optional[str] = None
    captcha_code: Optional[str] = None

class LoginPayload(BaseModel):
    username: str
    password: str
    captcha_id: Optional[str] = None
    captcha_code: Optional[str] = None

class ChangePasswordPayload(BaseModel):
    old_password: str
    new_password: str

class SettingsPayload(BaseModel):
    cf_handle: Optional[str] = None
    luogu_uid: Optional[str] = None
    luogu_cookie: Optional[str] = None
    acwing_user_id: Optional[str] = None
    acwing_cookie: Optional[str] = None
    atcoder_handle: Optional[str] = None
    poll_interval_minutes: Optional[str] = None
    sprint_mode: Optional[str] = None
    http_proxy: Optional[str] = None

class AddAccountPayload(BaseModel):
    platform: str
    handle: str
    cookie: Optional[str] = ""
    alias: Optional[str] = ""
    is_primary: Optional[bool] = False

class UpdateAccountPayload(BaseModel):
    handle: Optional[str] = None
    cookie: Optional[str] = None
    alias: Optional[str] = None
    is_primary: Optional[bool] = None

class VerifyAccountDirectPayload(BaseModel):
    platform: str
    handle: str
    cookie: Optional[str] = ""
    http_proxy: Optional[str] = ""

class MistakeCreatePayload(BaseModel):
    platform: str
    problem_id: str
    problem_title: str
    difficulty: Optional[str] = ""
    tags: Optional[List[str]] = []
    key_point: Optional[str] = ""
    notes: Optional[str] = ""
    problem_url: Optional[str] = ""
    last_submitted_at: Optional[str] = ""
    last_submission_id: Optional[str] = ""

class MistakeUpdatePayload(BaseModel):
    key_point: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    problem_url: Optional[str] = None
    status: Optional[str] = None

class MistakeReviewPayload(BaseModel):
    review_time: Optional[str] = ""

class MistakeMasterPayload(BaseModel):
    mastered: Optional[bool] = None

class SyncPayload(BaseModel):
    platform: Optional[str] = "all"

class VerifyPayload(BaseModel):
    platform: str
    cf_handle: Optional[str] = ""
    luogu_uid: Optional[str] = ""
    luogu_cookie: Optional[str] = ""
    acwing_user_id: Optional[str] = ""
    acwing_cookie: Optional[str] = ""
    atcoder_handle: Optional[str] = ""
    http_proxy: Optional[str] = ""

# --- Auth Dependency (安全身份拦截器) ---
async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not authorization:
        raise HTTPException(status_code=401, detail="未授权，请先登录")
    
    token = authorization
    if token.startswith("Bearer "):
        token = token[7:].strip()
    
    user = db.get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="登录会话已过期，请重新登录")
    
    user["token"] = token
    return user

# --- Auth Endpoints ---

@app.get("/api/auth/captcha")
async def get_captcha():
    """获取带噪声的图形验证码"""
    captcha_id, image_data = captcha_store.generate()
    return {
        "captcha_id": captcha_id,
        "captcha_image": image_data
    }

@app.post("/api/auth/register")
async def register(payload: RegisterPayload):
    # 校验图形验证码
    c_ok, c_msg = captcha_store.verify(payload.captcha_id or "", payload.captcha_code or "")
    if not c_ok:
        raise HTTPException(status_code=400, detail=c_msg)

    ok, msg, user = db.create_user(payload.username, payload.password)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    
    token = db.create_session(user["id"])
    return {
        "success": True,
        "message": msg,
        "token": token,
        "user": user
    }

@app.post("/api/auth/login")
async def login(payload: LoginPayload):
    # 校验图形验证码
    c_ok, c_msg = captcha_store.verify(payload.captcha_id or "", payload.captcha_code or "")
    if not c_ok:
        raise HTTPException(status_code=400, detail=c_msg)

    ok, msg, user = db.authenticate_user(payload.username, payload.password)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    
    token = db.create_session(user["id"])
    return {
        "success": True,
        "message": msg,
        "token": token,
        "user": user
    }

@app.get("/api/auth/me")
async def get_me(current_user: Dict[str, Any] = Depends(get_current_user)):
    return {"user": current_user}

@app.post("/api/auth/logout")
async def logout(current_user: Dict[str, Any] = Depends(get_current_user)):
    token = current_user.get("token", "")
    if token:
        db.delete_session(token)
    return {"success": True, "message": "已成功注销登录"}

@app.post("/api/auth/password")
async def change_password(payload: ChangePasswordPayload, current_user: Dict[str, Any] = Depends(get_current_user)):
    ok, msg = db.change_user_password(current_user["id"], payload.old_password, payload.new_password)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"success": True, "message": msg}

# --- Protected Data & Stats Endpoints (绑定当前登录用户隔离) ---

@app.get("/api/stats/overview")
async def get_overview(current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    stats = db.get_submission_stats(user_id=uid)
    status_list = db.get_all_platform_status(user_id=uid)
    last_sync = db.get_config(uid, "last_sync_time", "")
    climbing = db.get_climbing_curve(user_id=uid, days=365)
    daily_effort = db.get_recent_daily_effort(user_id=uid, days=365)
    return {
        "stats": stats,
        "platforms_status": status_list,
        "last_sync_time": last_sync,
        "climbing_curve": climbing,
        "daily_effort": daily_effort
    }

@app.get("/api/stats/heatmap")
async def get_heatmap(platform: str = "all", year: Optional[int] = None, current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    curr_yr = db.get_beijing_now().year
    target_year = year if year else curr_yr
    data = db.get_daily_counts(user_id=uid, platform=platform, year=target_year)
    available_years = db.get_submission_years(user_id=uid)
    return {
        "heatmap": data,
        "year": target_year,
        "available_years": available_years
    }

@app.get("/api/stats/tags")
async def get_tags(current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    tag_data = db.get_tag_statistics(user_id=uid)
    return {"tags": tag_data}

@app.get("/api/mistakes")
async def get_user_mistakes(
    status: str = "all",
    search: str = "",
    tag: str = "",
    platform: str = "",
    sort_by: str = "last_submitted_at",
    page: int = 1,
    page_size: int = 50,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    uid = current_user["id"]
    data = db.get_user_mistakes(
        user_id=uid,
        status=status,
        search=search,
        tag=tag,
        platform=platform,
        sort_by=sort_by,
        page=page,
        page_size=page_size
    )
    return data

@app.get("/api/mistakes/keys")
async def get_mistake_keys(current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    keys = db.get_user_mistake_keys(user_id=uid)
    return {"keys": keys}

@app.post("/api/mistakes")
async def add_mistake(payload: MistakeCreatePayload, current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    item = db.add_mistake(
        user_id=uid,
        platform=payload.platform,
        problem_id=payload.problem_id,
        problem_title=payload.problem_title,
        difficulty=payload.difficulty or "",
        tags=payload.tags or [],
        key_point=payload.key_point or "",
        notes=payload.notes or "",
        problem_url=payload.problem_url or "",
        last_submitted_at=payload.last_submitted_at or "",
        last_submission_id=payload.last_submission_id or ""
    )
    return {"success": True, "mistake": item}

@app.put("/api/mistakes/{mistake_id}")
async def update_mistake(mistake_id: int, payload: MistakeUpdatePayload, current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    ok = db.update_mistake(
        user_id=uid,
        mistake_id=mistake_id,
        key_point=payload.key_point,
        notes=payload.notes,
        tags=payload.tags,
        problem_url=payload.problem_url,
        status=payload.status
    )
    if not ok:
        raise HTTPException(status_code=404, detail="错题未找到或未做任何更改")
    return {"success": True}

@app.delete("/api/mistakes/{mistake_id}")
async def delete_mistake(mistake_id: int, current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    ok = db.delete_mistake(user_id=uid, mistake_id=mistake_id)
    if not ok:
        raise HTTPException(status_code=404, detail="错题不存在")
    return {"success": True}

@app.post("/api/mistakes/{mistake_id}/review")
async def review_mistake(mistake_id: int, payload: Optional[MistakeReviewPayload] = None, current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    r_time = payload.review_time if payload else ""
    res = db.manual_record_review(user_id=uid, mistake_id=mistake_id, review_time=r_time)
    if not res:
        raise HTTPException(status_code=404, detail="错题未找到")
    return {"success": True, "mistake": res}

@app.post("/api/mistakes/{mistake_id}/toggle-master")
async def toggle_master_mistake(mistake_id: int, payload: Optional[MistakeMasterPayload] = None, current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    mastered = payload.mastered if payload else None
    res = db.toggle_mistake_mastered(user_id=uid, mistake_id=mistake_id, mastered=mastered)
    if not res:
        raise HTTPException(status_code=404, detail="错题未找到")
    return {"success": True, "mistake": res}

@app.get("/api/stats/mistakes")
async def get_mistakes(limit: int = 50, current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    res = db.get_user_mistakes(user_id=uid, page_size=limit)
    return {"mistakes": res.get("items", []), "counts": res.get("counts", {})}

@app.get("/api/stats/submissions")
async def get_submissions(limit: int = 2000, platform: str = "all", current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    subs = db.get_recent_submissions(user_id=uid, limit=limit, platform=platform)
    return {"submissions": subs}

@app.get("/api/settings")
async def get_settings(current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    configs = db.get_all_configs(user_id=uid)
    status = db.get_all_platform_status(user_id=uid)
    return {
        "configs": configs,
        "status": {s["platform"]: s for s in status}
    }

@app.post("/api/settings")
async def update_settings(payload: SettingsPayload, current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        if v is not None:
            val_str = str(v).strip()
            if k == "poll_interval_minutes":
                try:
                    m = max(1, min(1440, int(val_str)))
                    val_str = str(m)
                except Exception:
                    val_str = "30"
            elif k == "http_proxy":
                if val_str and not sanitize_proxy(val_str):
                    raise HTTPException(
                        status_code=400,
                        detail="出站代理格式不正确，必须以 http:// 或 socks5:// 开头（例如 http://127.0.0.1:7890）"
                    )
            db.set_config(uid, k, val_str)
    return {"success": True, "message": "配置更新成功"}

@app.get("/api/contests")
async def get_contests(platform: str = "all", limit: int = 60, current_user: Dict[str, Any] = Depends(get_current_user)):
    contests = db.get_upcoming_contests(platform=platform, limit=limit)
    if not contests:
        asyncio.create_task(scheduler_instance.sync_contests())
    return {"contests": contests}

@app.post("/api/contests/sync")
async def sync_contests_api(current_user: Dict[str, Any] = Depends(get_current_user)):
    res = await scheduler_instance.sync_contests()
    return res

# --- Multi-Account Management Endpoints ---

@app.get("/api/accounts")
async def get_accounts(platform: Optional[str] = None, current_user: Dict[str, Any] = Depends(get_current_user)):
    """获取用户绑定的平台账号列表"""
    uid = current_user["id"]
    accs = db.get_platform_accounts(uid, platform)
    return {"accounts": accs}

@app.post("/api/accounts")
async def add_account(payload: AddAccountPayload, current_user: Dict[str, Any] = Depends(get_current_user)):
    """添加平台新账号"""
    uid = current_user["id"]
    ok, msg, acc = db.add_platform_account(
        user_id=uid,
        platform=payload.platform,
        handle=payload.handle,
        cookie=payload.cookie or "",
        alias=payload.alias or "",
        is_primary=bool(payload.is_primary)
    )
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"success": True, "message": msg, "account": acc}

@app.put("/api/accounts/{account_id}")
async def update_account(account_id: int, payload: UpdateAccountPayload, current_user: Dict[str, Any] = Depends(get_current_user)):
    """更新平台账号"""
    uid = current_user["id"]
    ok, msg = db.update_platform_account(
        account_id=account_id,
        user_id=uid,
        handle=payload.handle,
        cookie=payload.cookie,
        alias=payload.alias,
        is_primary=payload.is_primary
    )
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"success": True, "message": msg}

@app.delete("/api/accounts/{account_id}")
async def delete_account(account_id: int, current_user: Dict[str, Any] = Depends(get_current_user)):
    """移除平台账号 (历史提交题目依然安全保留)"""
    uid = current_user["id"]
    ok, msg = db.delete_platform_account(account_id, uid)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"success": True, "message": msg}

@app.post("/api/accounts/{account_id}/primary")
async def set_primary_account_endpoint(account_id: int, current_user: Dict[str, Any] = Depends(get_current_user)):
    """设为主账号"""
    uid = current_user["id"]
    ok, msg = db.set_primary_account(account_id, uid)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"success": True, "message": msg}

@app.post("/api/accounts/{account_id}/sync")
async def sync_single_account_endpoint(account_id: int, current_user: Dict[str, Any] = Depends(get_current_user)):
    """即时同步单个账号"""
    uid = current_user["id"]
    res = await scheduler_instance.sync_single_account(account_id, uid)
    return res

@app.post("/api/accounts/verify")
async def verify_account_direct(payload: VerifyAccountDirectPayload, current_user: Dict[str, Any] = Depends(get_current_user)):
    """独立测试平台账号连通性"""
    uid = current_user["id"]
    p = payload.platform.lower().strip()
    proxy = sanitize_proxy(payload.http_proxy or db.get_config(uid, "http_proxy", ""))

    if p == "codeforces":
        cf = CodeforcesFetcher()
        valid, msg, extra = await cf.verify(payload.handle, proxy=proxy)
        return {"valid": valid, "message": msg, "extra": extra}
    elif p == "luogu":
        lg = LuoguFetcher()
        valid, msg, extra = await lg.verify(payload.handle, payload.cookie or "", proxy=proxy)
        return {"valid": valid, "message": msg, "extra": extra}
    elif p == "acwing":
        aw = AcWingFetcher()
        valid, msg, extra = await aw.verify(payload.handle, payload.cookie or "", proxy=proxy)
        return {"valid": valid, "message": msg, "extra": extra}
    elif p == "atcoder":
        at = AtCoderFetcher()
        valid, msg, extra = await at.verify(payload.handle, proxy=proxy)
        return {"valid": valid, "message": msg, "extra": extra}
    else:
        raise HTTPException(status_code=400, detail="不支持的平台")

@app.post("/api/sync")
async def trigger_sync(payload: SyncPayload, current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    platform = payload.platform or "all"
    if platform == "contests":
        res = await scheduler_instance.sync_contests()
        return res
    elif platform == "all":
        res = await scheduler_instance.sync_all(user_id=uid)
        return {"success": True, "data": res}
    else:
        res = await scheduler_instance.sync_platform(platform, user_id=uid)
        return {"success": res.get("success", False), "data": res}

@app.post("/api/verify")
async def verify_credentials(payload: VerifyPayload, current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    p = payload.platform.lower()
    proxy = sanitize_proxy(payload.http_proxy or db.get_config(uid, "http_proxy", ""))

    if p == "codeforces":
        cf = CodeforcesFetcher()
        valid, msg, extra = await cf.verify(payload.cf_handle or "", proxy=proxy)
        if valid:
            db.update_platform_status(uid, "codeforces", "ok", msg, rating=extra.get("rating", ""))
        else:
            db.update_platform_status(uid, "codeforces", "error", msg)
        return {"valid": valid, "message": msg, "extra": extra}
    elif p == "luogu":
        lg = LuoguFetcher()
        valid, msg, extra = await lg.verify(payload.luogu_uid or "", payload.luogu_cookie or "", proxy=proxy)
        if valid:
            db.update_platform_status(uid, "luogu", "ok", msg, rating=extra.get("ranking", ""))
        else:
            db.update_platform_status(uid, "luogu", "error", msg)
        return {"valid": valid, "message": msg, "extra": extra}
    elif p == "acwing":
        aw = AcWingFetcher()
        valid, msg, extra = await aw.verify(payload.acwing_user_id or "", payload.acwing_cookie or "", proxy=proxy)
        if valid:
            db.update_platform_status(uid, "acwing", "ok", msg)
        else:
            db.update_platform_status(uid, "acwing", "error", msg)
        return {"valid": valid, "message": msg, "extra": extra}
    elif p == "atcoder":
        at = AtCoderFetcher()
        valid, msg, extra = await at.verify(payload.atcoder_handle or "", proxy=proxy)
        if valid:
            db.update_platform_status(uid, "atcoder", "ok", msg, rating=extra.get("rating", ""))
        else:
            db.update_platform_status(uid, "atcoder", "error", msg)
        return {"valid": valid, "message": msg, "extra": extra}
    else:
        raise HTTPException(status_code=400, detail="未知平台")

# --- Static Frontend ---
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

@app.api_route("/", methods=["GET", "HEAD"])
async def serve_index():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "OIBoard API Running. static/index.html not found."}

@app.api_route("/favicon.ico", methods=["GET", "HEAD"])
async def serve_favicon():
    fav_file = os.path.join(STATIC_DIR, "favicon.svg")
    if os.path.exists(fav_file):
        return FileResponse(fav_file, media_type="image/svg+xml")
    return Response(status_code=204)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

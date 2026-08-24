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
from scheduler import scheduler_instance
from fetchers import CodeforcesFetcher, LuoguFetcher, AcWingFetcher

# --- Lifespan ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时初始化数据库与多租户表结构
    db.init_db()
    # 启动后台轮询任务
    bg_task = asyncio.create_task(scheduler_instance.run_loop())
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

# 强制 API 响应禁止缓存中间件 (杜绝前端同步后读到旧缓存的问题)
@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# --- Pydantic Models ---
class RegisterPayload(BaseModel):
    username: str
    password: str

class LoginPayload(BaseModel):
    username: str
    password: str

class ChangePasswordPayload(BaseModel):
    old_password: str
    new_password: str

class SettingsPayload(BaseModel):
    cf_handle: Optional[str] = None
    luogu_uid: Optional[str] = None
    luogu_cookie: Optional[str] = None
    acwing_user_id: Optional[str] = None
    acwing_cookie: Optional[str] = None
    poll_interval_minutes: Optional[str] = None
    sprint_mode: Optional[str] = None
    http_proxy: Optional[str] = None

class SyncPayload(BaseModel):
    platform: Optional[str] = "all"

class VerifyPayload(BaseModel):
    platform: str
    cf_handle: Optional[str] = ""
    luogu_uid: Optional[str] = ""
    luogu_cookie: Optional[str] = ""
    acwing_user_id: Optional[str] = ""
    acwing_cookie: Optional[str] = ""
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

@app.post("/api/auth/register")
async def register(payload: RegisterPayload):
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
    return {
        "stats": stats,
        "platforms_status": status_list,
        "last_sync_time": last_sync
    }

@app.get("/api/stats/heatmap")
async def get_heatmap(platform: str = "all", current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    data = db.get_daily_counts(user_id=uid, platform=platform)
    return {"heatmap": data}

@app.get("/api/stats/tags")
async def get_tags(current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    tag_data = db.get_tag_statistics(user_id=uid)
    return {"tags": tag_data}

@app.get("/api/stats/mistakes")
async def get_mistakes(limit: int = 50, current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    mistakes = db.get_mistakes(user_id=uid, limit=limit)
    return {"mistakes": mistakes}

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
            db.set_config(uid, k, v)
    return {"success": True, "message": "配置更新成功"}

@app.post("/api/sync")
async def trigger_sync(payload: SyncPayload, current_user: Dict[str, Any] = Depends(get_current_user)):
    uid = current_user["id"]
    platform = payload.platform or "all"
    if platform == "all":
        res = await scheduler_instance.sync_all(user_id=uid)
        return {"success": True, "data": res}
    else:
        res = await scheduler_instance.sync_platform(platform, user_id=uid)
        return {"success": res.get("success", False), "data": res}

@app.post("/api/verify")
async def verify_credentials(payload: VerifyPayload, current_user: Dict[str, Any] = Depends(get_current_user)):
    p = payload.platform.lower()
    proxy = payload.http_proxy or ""

    if p == "codeforces":
        cf = CodeforcesFetcher()
        valid, msg, extra = await cf.verify(payload.cf_handle or "", proxy=proxy)
        return {"valid": valid, "message": msg, "extra": extra}
    elif p == "luogu":
        lg = LuoguFetcher()
        valid, msg, extra = await lg.verify(payload.luogu_uid or "", payload.luogu_cookie or "", proxy=proxy)
        return {"valid": valid, "message": msg, "extra": extra}
    elif p == "acwing":
        aw = AcWingFetcher()
        valid, msg, extra = await aw.verify(payload.acwing_user_id or "", payload.acwing_cookie or "", proxy=proxy)
        return {"valid": valid, "message": msg, "extra": extra}
    else:
        raise HTTPException(status_code=400, detail="未知平台")

# --- Static Frontend ---
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

@app.get("/")
async def serve_index():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "OIBoard API Running. static/index.html not found."}

@app.get("/favicon.ico")
async def serve_favicon():
    fav_file = os.path.join(STATIC_DIR, "favicon.svg")
    if os.path.exists(fav_file):
        return FileResponse(fav_file, media_type="image/svg+xml")
    return Response(status_code=204)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# backend/app/main.py
import os
import uuid
from typing import Optional

from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

from sqlmodel import Session, select, SQLModel

from .schemas import (
    RegisterIn, RegisterOut, SignInIn, TokenOut, ActivateIn, MessageIn,
    GoogleSignInIn,
)
from .security import hash_password, verify_password, make_token
from .db import get_session, User, get_engine
from .auth import current_user_sub
from .rate_limit import allow
from .crisis import get_counter
from .connectors.email_sender import send_email
from .connectors.telegram_bot import send_telegram
from .connectors.whatsapp_twilio import send_whatsapp

# Biometrics router + lightweight schema migrations
from .biometrics import router as biometrics_router, ensure_migrations

# QA router (NEW)
from .qa import router as qa_router

# --- Google Sign-In imports ---
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

load_dotenv()  # load backend/.env

OWNER_LAUNCH_PASSKEY = os.getenv("OWNER_LAUNCH_PASSKEY")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")

app = FastAPI(title="ELORA")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------- Startup --------------------

@app.on_event("startup")
def on_startup():
    # Create tables registered on SQLModel metadata (User and any others)
    SQLModel.metadata.create_all(get_engine())
    # Ensure biometrics tables/columns exist (safe no-op if already applied)
    ensure_migrations()

# Mount routers
app.include_router(biometrics_router)
app.include_router(qa_router)

# -------------------- Middleware --------------------

@app.middleware("http")
async def rate_limit_mw(request: Request, call_next):
    ip = request.client.host if request.client else "unknown"
    if not allow(ip):
        return JSONResponse({"detail": "Rate limit"}, status_code=429)
    return await call_next(request)

# -------------------- Auth --------------------

@app.post("/auth/register", response_model=RegisterOut)
def register(data: RegisterIn, s: Session = Depends(get_session)):
    existing = s.exec(select(User).where(User.email == data.email)).first()
    if existing:
        raise HTTPException(400, detail="Email already registered")

    uid = str(uuid.uuid4())
    user = User(
        uid=uid,
        username=data.username,
        full_name=data.full_name,
        email=data.email,
        password_hash=hash_password(data.password),
        agent_name=data.agent_name or "ELORA",
        work_schedule=data.work_schedule,
        crisis_opt_in=bool(data.crisis_opt_in),
        trusted_contact_name=data.trusted_contact_name,
        trusted_contact_phone=data.trusted_contact_phone,
    )
    s.add(user)
    s.commit()
    return {"user": {"uid": uid, "username": user.username, "agent_name": user.agent_name}}

@app.post("/auth/signin", response_model=TokenOut)
def signin(data: SignInIn, s: Session = Depends(get_session)):
    user = s.exec(select(User).where(User.email == data.email)).first()
    if not user or not verify_password(data.password, user.password_hash or ""):
        raise HTTPException(401, detail="Bad credentials")
    return {"access_token": make_token(user.uid)}

# ---- Google Sign-In ----
@app.post("/auth/google", response_model=TokenOut)
def google_signin(data: GoogleSignInIn, s: Session = Depends(get_session)):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(503, detail="GOOGLE_CLIENT_ID not configured")
    try:
        info = google_id_token.verify_oauth2_token(
            data.id_token,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
        email = info.get("email")
        email_verified = info.get("email_verified", False)
        name = info.get("name") or ""
        if not email or not email_verified:
            raise HTTPException(401, detail="Email not verified")
    except Exception:
        raise HTTPException(401, detail="Invalid Google ID token")

    user = s.exec(select(User).where(User.email == email)).first()
    if not user:
        uid = str(uuid.uuid4())
        username = email.split("@", 1)[0]
        user = User(
            uid=uid,
            username=username,
            full_name=name,
            email=email,
            password_hash="",   # OAuth account (no local password)
            agent_name="Asha",  # default; can be edited later
            work_schedule=None,
            crisis_opt_in=False,
            trusted_contact_name=None,
            trusted_contact_phone=None,
        )
        s.add(user)
        s.commit()

    return {"access_token": make_token(user.uid)}

# -------------------- Agent --------------------

@app.post("/agent/activate")
def activate(_: ActivateIn, uid: str = Depends(current_user_sub)):
    counter = get_counter(uid)
    counter.count = 0
    return {"status": "activated"}

@app.post("/agent/message")
async def agent_message(msg: MessageIn, uid: str = Depends(current_user_sub), s: Session = Depends(get_session)):
    user = s.exec(select(User).where(User.uid == uid)).first()
    if user:
        counter = get_counter(uid)
        n = counter.record(msg.text)
        if n >= 3 and user.crisis_opt_in and user.trusted_contact_phone:
            try:
                await send_whatsapp(
                    user.trusted_contact_phone,
                    f"{user.full_name or user.username} may need support. Message: '{msg.text[:160]}'"
                )
            except Exception:
                pass

    if msg.channel == "email":
        await send_email(msg.to, msg.text)
    elif msg.channel == "telegram":
        await send_telegram(msg.to, msg.text)
    elif msg.channel == "whatsapp":
        await send_whatsapp(msg.to, msg.text)
    else:
        raise HTTPException(400, detail="Unknown channel")
    return {"sent": True}

# -------------------- Plans --------------------

@app.get("/plans/protected")
def plans_protected(passkey: str):
    if not OWNER_LAUNCH_PASSKEY:
        raise HTTPException(503, detail="Owner passkey not configured")
    if passkey != OWNER_LAUNCH_PASSKEY:
        raise HTTPException(403, detail="Invalid passkey")
    return {"status": "ok", "plan": "pro_or_promax_access"}

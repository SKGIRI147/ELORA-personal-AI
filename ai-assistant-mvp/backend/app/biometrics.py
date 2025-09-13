# backend/app/biometrics.py
from datetime import datetime
from typing import Optional, List, Tuple
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import SQLModel, Field, Session, select
from .schemas import (
    FacePayload, VoiceEnrollPayload, SessionStartPayload, SessionStartOut,
    VoicePingPayload, VoicePingOut
)
from .db import get_session, get_engine
from .auth import current_user_sub

router = APIRouter(prefix="/biometrics", tags=["biometrics"])

# -------------------- DB Tables --------------------

class BiometricFace(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_uid: str = Field(index=True, unique=True)
    version: str = "v1"
    signature_json: str  # store as JSON string
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class BiometricVoiceProfile(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_uid: str = Field(index=True)
    version: str = "v1"
    avg_pitch_hz: float = 0.0
    avg_rms: float = 0.0
    condition_tag: Optional[str] = None  # NEW
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class VoiceSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_uid: str = Field(index=True)
    origin: Optional[str] = None
    device_label: Optional[str] = None
    started_at: datetime = Field(default_factory=datetime.utcnow)
    ended_at: Optional[datetime] = None

class VoicePing(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(index=True)
    ts: datetime = Field(default_factory=datetime.utcnow)
    pitch_hz: float = 0.0
    rms: float = 0.0
    zcr: Optional[float] = None
    snr_db: Optional[float] = None           # NEW
    emotion: str = "listening"
    similarity: float = 0.0
    is_owner: bool = False
    matched_profile_tag: Optional[str] = None  # NEW
    health_flag: bool = False                  # NEW

# -------------------- Startup: Ensure Tables & Columns --------------------

def ensure_migrations():
    engine = get_engine()
    SQLModel.metadata.create_all(engine)  # create missing tables
    # Add new columns for SQLite if missing (safe no-op if already added)
    with engine.connect() as con:
        def add(col_stmt: str):
            try:
                con.exec_driver_sql(col_stmt)
            except Exception:
                pass  # ignore if exists

        # VoicePing new columns
        add("ALTER TABLE voiceping ADD COLUMN snr_db REAL")
        add("ALTER TABLE voiceping ADD COLUMN matched_profile_tag TEXT")
        add("ALTER TABLE voiceping ADD COLUMN health_flag INTEGER")

        # BiometricVoiceProfile new column
        add("ALTER TABLE biometricvoiceprofile ADD COLUMN condition_tag TEXT")

# -------------------- Helpers --------------------

def _norm_pitch(p: float) -> float:
    # clamp to [60,450], normalize
    p = max(0.0, min(500.0, p or 0.0))
    return min(450.0, max(60.0, p)) / 450.0

def _norm_rms(r: float) -> float:
    # practical cap ~0.2 for near-field; far-field smaller
    r = max(0.0, min(0.25, r or 0.0))
    return r / 0.20

def _sim_from_distance(d: float) -> float:
    # map Euclidean distance [0..sqrt(2)] to similarity [1..0]
    # then clamp to [0..1]
    mx = 1.414213562
    return max(0.0, min(1.0, 1.0 - (d / mx)))

def _owner_similarity(sample: Tuple[float, float], base: Tuple[float, float]) -> float:
    sp, sr = sample
    bp, br = base
    d = ((sp - bp) ** 2 + (sr - br) ** 2) ** 0.5
    return _sim_from_distance(d)

def _choose_best_profile(pitch: float, rms: float, profiles: List[BiometricVoiceProfile]) -> Tuple[Optional[BiometricVoiceProfile], float]:
    if not profiles:
        return None, 0.0
    sp = _norm_pitch(pitch)
    sr = _norm_rms(rms)
    best = None
    best_sim = -1.0
    for pr in profiles:
        bp = _norm_pitch(pr.avg_pitch_hz)
        br = _norm_rms(pr.avg_rms)
        sim = _owner_similarity((sp, sr), (bp, br))
        if sim > best_sim:
            best_sim = sim
            best = pr
    return best, best_sim

def _classify_emotion(pitch: float, rms: float, snr_db: Optional[float]) -> str:
    # Simple, SNR-aware heuristic
    if snr_db is not None and snr_db < 8.0:
        return "noisy/uncertain"
    if rms < 0.025 and pitch < 140:
        return "sad/tired"
    if rms > 0.08 and pitch > 180:
        return "angry/excited"
    if rms > 0.05 and pitch > 170:
        return "happy/bright"
    return "calm"

def _health_flag(pitch: float, rms: float, base_pitch: Optional[float], base_rms: Optional[float], snr_db: Optional[float]) -> bool:
    # Flag likely sick/fever/hoarse/low-energy
    if snr_db is not None and snr_db < 8.0:
        return False  # environment too noisy to judge
    if base_pitch and pitch and pitch < 0.8 * base_pitch and rms < 0.035:
        return True
    if not base_pitch and rms < 0.03 and pitch < 140:
        return True  # low-energy + low pitch without baseline
    return False

# -------------------- Routes --------------------

@router.post("/face")
def save_face(payload: FacePayload, uid: str = Depends(current_user_sub), s: Session = Depends(get_session)):
    import json
    now = datetime.utcnow()
    row = s.exec(select(BiometricFace).where(BiometricFace.user_uid == uid)).first()
    sig_json = json.dumps(payload.signature.dict())
    if row:
        row.signature_json = sig_json
        row.updated_at = now
        s.add(row)
    else:
        s.add(BiometricFace(user_uid=uid, version=payload.version, signature_json=sig_json))
    s.commit()
    return {"ok": True}

@router.post("/voice/enroll")
def enroll_voice(payload: VoiceEnrollPayload, uid: str = Depends(current_user_sub), s: Session = Depends(get_session)):
    now = datetime.utcnow()
    # Allow multiple profiles per condition_tag; upsert simple (same tag)
    existing = None
    if payload.condition_tag:
        existing = s.exec(
            select(BiometricVoiceProfile).where(
                (BiometricVoiceProfile.user_uid == uid) &
                (BiometricVoiceProfile.condition_tag == payload.condition_tag)
            )
        ).first()
    if existing:
        existing.avg_pitch_hz = payload.avg_pitch_hz
        existing.avg_rms = payload.avg_rms
        existing.updated_at = now
        s.add(existing)
    else:
        s.add(BiometricVoiceProfile(
            user_uid=uid, version=payload.version,
            avg_pitch_hz=payload.avg_pitch_hz, avg_rms=payload.avg_rms,
            condition_tag=payload.condition_tag
        ))
    s.commit()
    return {"ok": True}

@router.post("/voice/session/start", response_model=SessionStartOut)
def start_session(payload: SessionStartPayload, uid: str = Depends(current_user_sub), s: Session = Depends(get_session)):
    row = VoiceSession(user_uid=uid, origin=payload.origin, device_label=payload.device_label)
    s.add(row); s.commit(); s.refresh(row)
    return {"session_id": row.id}

@router.post("/voice/ping", response_model=VoicePingOut)
def voice_ping(payload: VoicePingPayload, uid: str = Depends(current_user_sub), s: Session = Depends(get_session)):
    # Validate session belongs to user
    sess = s.get(VoiceSession, payload.session_id)
    if not sess or sess.user_uid != uid:
        raise HTTPException(404, "Session not found")

    # Load all profiles for user
    profiles = s.exec(select(BiometricVoiceProfile).where(BiometricVoiceProfile.user_uid == uid)).all()

    # Pick best profile & similarity
    best, sim = _choose_best_profile(payload.pitch_hz, payload.rms, profiles)
    is_owner = sim >= 0.55  # threshold; tune later

    # Emotion & Health
    emo = _classify_emotion(payload.pitch_hz, payload.rms, payload.snr_db)
    base_pitch = best.avg_pitch_hz if best else None
    base_rms = best.avg_rms if best else None
    health = _health_flag(payload.pitch_hz, payload.rms, base_pitch, base_rms, payload.snr_db)

    # Persist ping
    pr_tag = best.condition_tag if best else None
    ping = VoicePing(
        session_id=payload.session_id,
        pitch_hz=payload.pitch_hz,
        rms=payload.rms,
        zcr=payload.zcr,
        snr_db=payload.snr_db,
        emotion=emo,
        similarity=sim,
        is_owner=is_owner,
        matched_profile_tag=pr_tag,
        health_flag=health,
    )
    s.add(ping); s.commit()

    return VoicePingOut(
        emotion=emo,
        similarity=sim,
        is_owner=is_owner,
        matched_profile_tag=pr_tag,
        health_flag=health,
        snr_db=payload.snr_db,
    )

@router.post("/voice/session/stop")
def stop_session(session_id: int, uid: str = Depends(current_user_sub), s: Session = Depends(get_session)):
    row = s.get(VoiceSession, session_id)
    if not row or row.user_uid != uid:
        raise HTTPException(404, "Session not found")
    if not row.ended_at:
        row.ended_at = datetime.utcnow()
        s.add(row); s.commit()
    return {"ok": True}

# backend/app/models.py
from typing import Optional, Dict, Any
from datetime import datetime
from sqlmodel import select, SQLModel, Field, Column, JSON
from .db import User, get_session

# ---- your existing helpers (kept) ----
def get_user_by_email(email: str):
    with get_session() as s:
        return s.exec(select(User).where(User.email == email)).first()

def get_user_by_uid(uid: str):
    with get_session() as s:
        return s.exec(select(User).where(User.uid == uid)).first()

# ---- APPEND: biometric models ----
class BiometricFace(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    version: str = Field(default="v1")
    signature: Dict[str, Any] = Field(sa_column=Column(JSON))  # {"size":24,"data":[...]}
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class BiometricVoiceProfile(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    version: str = Field(default="v1")
    avg_pitch_hz: float = Field(default=0.0)
    avg_rms: float = Field(default=0.0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class VoiceSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    ended_at: Optional[datetime] = None
    origin: Optional[str] = None
    device_label: Optional[str] = None

class VoicePing(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(index=True, foreign_key="voicesession.id")
    ts: datetime = Field(default_factory=datetime.utcnow)
    pitch_hz: float = 0.0
    rms: float = 0.0
    zcr: Optional[float] = None
    mfcc_summary: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    emotion: Optional[str] = None
    similarity: Optional[float] = None
    is_owner: Optional[bool] = None

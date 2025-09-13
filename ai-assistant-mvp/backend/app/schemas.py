# from pydantic import BaseModel, EmailStr
# from typing import Optional

# class RegisterIn(BaseModel):
#     username: str
#     full_name: Optional[str] = None
#     email: EmailStr
#     password: str
#     agent_name: str
#     work_schedule: Optional[str] = None
#     crisis_opt_in: bool = False
#     trusted_contact_name: Optional[str] = None
#     trusted_contact_phone: Optional[str] = None

# class RegisterOut(BaseModel):
#     user: dict

# class SignInIn(BaseModel):
#     email: EmailStr
#     password: str

# class TokenOut(BaseModel):
#     access_token: str
#     token_type: str = "bearer"

# class ActivateIn(BaseModel):
#     phrase: Optional[str] = None
#     face: Optional[bool] = False

# class MessageIn(BaseModel):
#     channel: str  # email|telegram|whatsapp
#     to: str
#     text: str

# # ---- Google Sign-In ----
# class GoogleSignInIn(BaseModel):
#     id_token: str


# backend/app/schemas.py
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

# ----- Auth / User -----
class RegisterIn(BaseModel):
    username: str
    full_name: Optional[str] = None
    email: str
    password: str
    agent_name: Optional[str] = None
    work_schedule: Optional[str] = None
    crisis_opt_in: bool = False
    trusted_contact_name: Optional[str] = None
    trusted_contact_phone: Optional[str] = None

class RegisterOut(BaseModel):
    user: Dict[str, Any]

class SignInIn(BaseModel):
    email: str
    password: str

class TokenOut(BaseModel):
    access_token: str

class GoogleSignInIn(BaseModel):
    id_token: str

# ----- Agent / Messages -----
class ActivateIn(BaseModel):
    pass

class MessageIn(BaseModel):
    text: str
    channel: str
    to: Optional[str] = None

# ----- Biometrics -----
class FaceSignature(BaseModel):
    size: int = Field(24, description="Width=Height for square downsample")
    data: List[float]  # length = size*size

class FacePayload(BaseModel):
    version: str = "v1"
    signature: FaceSignature

class VoiceEnrollPayload(BaseModel):
    version: str = "v1"
    avg_pitch_hz: float
    avg_rms: float
    condition_tag: Optional[str] = None  # NEW: enroll multiple conditions (neutral/fever/quiet/etc)

class SessionStartPayload(BaseModel):
    origin: Optional[str] = None
    device_label: Optional[str] = None

class SessionStartOut(BaseModel):
    session_id: int

class VoicePingPayload(BaseModel):
    session_id: int
    pitch_hz: float
    rms: float
    zcr: Optional[float] = None
    snr_db: Optional[float] = None  # NEW: far-field robustness

class VoicePingOut(BaseModel):
    emotion: str
    similarity: float
    is_owner: bool
    matched_profile_tag: Optional[str] = None
    health_flag: bool = False          # NEW: likely sick/fever/hoarse/low-energy
    snr_db: Optional[float] = None     # Echo back for UI

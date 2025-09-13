import os, time, jwt
from passlib.context import CryptContext

pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change")
JWT_ISS = "ai-assistant"

def hash_password(p: str) -> str:
    return pwd.hash(p)

def verify_password(p: str, h: str) -> bool:
    return pwd.verify(p, h)

def make_token(sub: str, ttl: int = 3600) -> str:
    now = int(time.time())
    payload = {"iss": JWT_ISS, "sub": sub, "iat": now, "exp": now + ttl}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def decode_token(t: str) -> dict:
    return jwt.decode(t, JWT_SECRET, algorithms=["HS256"], options={"require": ["exp", "sub"]})

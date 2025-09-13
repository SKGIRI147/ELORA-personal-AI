# backend/app/db.py

# --- Core imports ---
import os
from typing import Optional

from sqlmodel import SQLModel, Field, Session, create_engine

# --- Database URL + Engine ---
# Prefer DATABASE_URL, fallback to legacy DB_URL, then default to local SQLite
DATABASE_URL = os.getenv("DATABASE_URL") or os.getenv("DB_URL") or "sqlite:///./ai_assistant.db"

# For SQLite, allow cross-thread access for FastAPI dev server
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)

# --- Engine accessors (imported by app.main) ---
def get_engine():
    return engine

def get_session():
    """
    Dependency generator for FastAPI routes:
      with get_session() as s:
          ...
    or
      def route(s: Session = Depends(get_session)):
          ...
    """
    with Session(engine) as session:
        yield session

# --- User model (kept here so `from .db import User` works everywhere) ---
class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    # app identity
    uid: str = Field(index=True, unique=True)        # UUID string
    username: str = Field(index=True)                # username (can be non-unique if you like)
    full_name: Optional[str] = None

    # auth
    email: str = Field(index=True, unique=True)
    password_hash: str = ""                          # empty for OAuth-only accounts

    # agent / settings
    agent_name: Optional[str] = None
    work_schedule: Optional[str] = None

    # crisis escalation
    crisis_opt_in: bool = False
    trusted_contact_name: Optional[str] = None
    trusted_contact_phone: Optional[str] = None

# NOTE: We DO NOT call SQLModel.metadata.create_all(engine) here,
# because app.main registers an on_startup hook that creates tables.
# This avoids double-creation and keeps initialization in one place.

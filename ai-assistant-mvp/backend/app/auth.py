# backend/app/auth.py
from fastapi import Depends, HTTPException, status, Header
from .security import decode_token  # must exist in security.py (make_token uses same secret/alg)

def bearer_token(auth: str = Header(None, alias="Authorization")) -> str:
    """
    Extracts the Bearer token from the Authorization header.
    Raises 401 if header is missing or not a Bearer token.
    """
    if not auth or not auth.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token"
        )
    return auth.split(" ", 1)[1]

def current_user_sub(token: str = Depends(bearer_token)) -> str:
    """
    Decodes JWT and returns the 'sub' (user UID).
    Raises 401 if token is invalid.
    """
    try:
        payload = decode_token(token)
        sub = payload.get("sub")
        if not sub:
            raise ValueError("No 'sub' in token")
        return sub
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )

"""
JWT authentication: token creation, validation, and FastAPI dependency.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

from app.config import get_settings

bearer_scheme = HTTPBearer(auto_error=False)


def create_access_token(subject: str, expires_delta: Optional[timedelta] = None) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.auth_access_token_expire_minutes))
    payload = {"sub": subject, "exp": expire, "type": "access"}
    return jwt.encode(payload, settings.auth_secret_key, algorithm=settings.auth_algorithm)


def create_refresh_token(subject: str) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.auth_refresh_token_expire_minutes)
    payload = {"sub": subject, "exp": expire, "type": "refresh"}
    return jwt.encode(payload, settings.auth_secret_key, algorithm=settings.auth_algorithm)


def verify_token(token: str, expected_type: str = "access") -> str:
    """Return the subject (username) if valid; raise HTTPException otherwise."""
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.auth_secret_key, algorithms=[settings.auth_algorithm])
        if payload.get("type") != expected_type:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
        sub: str = payload.get("sub", "")
        if not sub:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")
        return sub
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired or invalid")


def verify_credentials(username: str, password: str) -> bool:
    settings = get_settings()
    return username == settings.auth_username and password == settings.auth_password


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> str:
    """FastAPI dependency: extracts and validates the Bearer token.
    Returns the username string. Raises 401 if missing or invalid."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return verify_token(credentials.credentials, expected_type="access")

"""
Auth routes: login, refresh, and token verification.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth import (
    create_access_token,
    create_refresh_token,
    verify_credentials,
    verify_token,
    get_current_user,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    if not verify_credentials(body.username, body.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    return TokenResponse(
        access_token=create_access_token(body.username),
        refresh_token=create_refresh_token(body.username),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest):
    username = verify_token(body.refresh_token, expected_type="refresh")
    return TokenResponse(
        access_token=create_access_token(username),
        refresh_token=create_refresh_token(username),
    )


@router.get("/me")
async def me(current_user: str = Depends(get_current_user)):
    return {"username": current_user}

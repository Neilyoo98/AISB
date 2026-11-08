"""Simple email + password auth. bcrypt hashes, JWT in an httpOnly cookie."""
import time
from collections import defaultdict, deque

import bcrypt
import jwt
from fastapi import HTTPException, Request, Response

import db
from config import COOKIE_SECURE, JWT_SECRET

COOKIE = "ss_token"
TTL = 7 * 24 * 3600


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode()[:72], hashed.encode())
    except ValueError:
        return False


def issue(response: Response, user_id: str):
    token = jwt.encode({"sub": user_id, "exp": int(time.time()) + TTL}, JWT_SECRET, algorithm="HS256")
    response.set_cookie(COOKIE, token, max_age=TTL, httponly=True, samesite="lax", secure=COOKIE_SECURE, path="/")


def clear(response: Response):
    response.delete_cookie(COOKIE, path="/")


def current_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE)
    if not token:
        auth = request.headers.get("authorization", "")
        token = auth[7:] if auth.lower().startswith("bearer ") else None
    if not token:
        raise HTTPException(401, "Not logged in")
    try:
        sub = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])["sub"]
    except jwt.PyJWTError:
        raise HTTPException(401, "Session expired")
    user = db.get_user(sub)
    if not user:
        raise HTTPException(401, "Unknown user")
    return user


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-client-ip") or request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip() or (request.client.host if request.client else "unknown"))[:64]


_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(request: Request, bucket: str, limit: int, window_s: int = 60):
    key = f"{bucket}:{client_ip(request)}"
    now = time.time()
    q = _hits[key]
    while q and q[0] < now - window_s:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, "Too many requests - slow down a little.")
    q.append(now)

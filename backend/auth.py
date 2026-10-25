"""Token authentication + role-based access control."""
import time
from collections import defaultdict
from functools import wraps

from flask import current_app, g, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from db import get_db
from utils import ApiError


def _serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="smartlab-auth")


def make_token(user_id):
    return _serializer().dumps({"uid": user_id})


def load_user_from_request():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise ApiError("Authentication required", 401)
    try:
        payload = _serializer().loads(header[7:], max_age=current_app.config["TOKEN_TTL_SECONDS"])
    except SignatureExpired:
        raise ApiError("Session expired, please sign in again", 401)
    except BadSignature:
        raise ApiError("Invalid session token", 401)
    row = get_db().execute(
        """SELECT u.user_id, u.username, u.role, u.student_id, s.full_name, s.roll_no
           FROM users u LEFT JOIN students s ON s.student_id = u.student_id
           WHERE u.user_id = ?""",
        (payload.get("uid"),),
    ).fetchone()
    if row is None:
        raise ApiError("Account no longer exists", 401)
    return dict(row)


def login_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        g.user = load_user_from_request()
        return fn(*a, **kw)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        g.user = load_user_from_request()
        if g.user["role"] != "admin":
            raise ApiError("Administrator access required", 403)
        return fn(*a, **kw)
    return wrapper


def is_admin():
    return g.user["role"] == "admin"


# ---- tiny in-memory brute-force protection -------------------------------------------------
_failures = defaultdict(list)
WINDOW, LIMIT = 300, 6


def check_rate_limit(key):
    now = time.time()
    _failures[key] = [t for t in _failures[key] if now - t < WINDOW]
    if len(_failures[key]) >= LIMIT:
        raise ApiError("Too many failed attempts. Try again in a few minutes.", 429)


def record_failure(key):
    _failures[key].append(time.time())


def clear_failures(key):
    _failures.pop(key, None)

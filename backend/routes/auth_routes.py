from flask import Blueprint, g, jsonify
from werkzeug.security import check_password_hash, generate_password_hash

from auth import (check_rate_limit, clear_failures, login_required, make_token, record_failure)
from db import get_db, transaction
from utils import (ApiError, USERNAME_RE, body_json, optional_email, optional_phone, text)

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


def _user_payload(row):
    return {k: row[k] for k in ("user_id", "username", "role", "student_id", "full_name", "roll_no")}


def validate_password(pw, field="password"):
    if not isinstance(pw, str) or len(pw) < 8:
        raise ApiError("Password must be at least 8 characters", 422, field)
    if len(pw) > 128:
        raise ApiError("Password is too long", 422, field)
    return pw


def validate_username(name):
    if not name or not USERNAME_RE.match(name):
        raise ApiError("Username must be 3-32 characters: letters, numbers, . _ -", 422, "username")
    return name


@bp.post("/login")
def login():
    data = body_json()
    username = text(data, "username", required=True, max_len=64)
    password = data.get("password") or ""
    key = username.lower()
    check_rate_limit(key)
    db = get_db()
    row = db.execute(
        """SELECT u.*, s.full_name, s.roll_no FROM users u
           LEFT JOIN students s ON s.student_id = u.student_id WHERE u.username = ?""",
        (username,),
    ).fetchone()
    if row is None or not check_password_hash(row["password_hash"], password):
        record_failure(key)
        raise ApiError("Incorrect username or password", 401)
    clear_failures(key)
    return jsonify({"token": make_token(row["user_id"]), "user": _user_payload(row)})


@bp.post("/register")
def register():
    """Self-service student registration: creates a students row + a student login."""
    data = body_json()
    username = validate_username(text(data, "username", required=True, max_len=32))
    password = validate_password(data.get("password"))
    roll_no = text(data, "roll_no", required=True, max_len=30)
    full_name = text(data, "full_name", required=True, max_len=100)
    department = text(data, "department", max_len=80)
    year_sem = text(data, "year_sem", max_len=30)
    phone = optional_phone(text(data, "phone", max_len=20))
    email = optional_email(text(data, "email", max_len=120))
    db = get_db()
    with transaction(db):
        if db.execute("SELECT 1 FROM students WHERE roll_no = ?", (roll_no,)).fetchone():
            raise ApiError("This roll number already exists - ask an administrator to create your login", 409, "roll_no")
        if db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
            raise ApiError("Username is already taken", 409, "username")
        cur = db.execute(
            "INSERT INTO students (roll_no, full_name, department, year_sem, phone, email) VALUES (?,?,?,?,?,?)",
            (roll_no, full_name, department, year_sem, phone, email),
        )
        uid = db.execute(
            "INSERT INTO users (username, password_hash, role, student_id) VALUES (?,?,?,?)",
            (username, generate_password_hash(password), "student", cur.lastrowid),
        ).lastrowid
    row = db.execute(
        "SELECT u.*, s.full_name, s.roll_no FROM users u LEFT JOIN students s ON s.student_id=u.student_id WHERE u.user_id=?",
        (uid,),
    ).fetchone()
    return jsonify({"token": make_token(uid), "user": _user_payload(row)}), 201


@bp.get("/me")
@login_required
def me():
    return jsonify({"user": g.user})


@bp.post("/change-password")
@login_required
def change_password():
    data = body_json()
    db = get_db()
    row = db.execute("SELECT password_hash FROM users WHERE user_id=?", (g.user["user_id"],)).fetchone()
    if not check_password_hash(row["password_hash"], data.get("current_password") or ""):
        raise ApiError("Current password is incorrect", 403, "current_password")
    new = validate_password(data.get("new_password"), "new_password")
    with transaction(db):
        db.execute("UPDATE users SET password_hash=? WHERE user_id=?", (generate_password_hash(new), g.user["user_id"]))
    return jsonify({"ok": True})

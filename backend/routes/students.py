from flask import Blueprint, jsonify, request
from werkzeug.security import generate_password_hash

from auth import admin_required
from db import get_db, transaction
from routes.auth_routes import validate_password, validate_username
from utils import (ApiError, body_json, int_arg, normalize_uid, optional_email, optional_phone, rows, text, today_str)

bp = Blueprint("students", __name__, url_prefix="/api/students")

LIST_SQL = """
SELECT s.*, u.username,
       CASE WHEN u.user_id IS NOT NULL THEN 1 ELSE 0 END AS has_login,
       (SELECT COUNT(*) FROM issues i WHERE i.student_id = s.student_id AND i.returned = 0) AS active_loans,
       (SELECT COUNT(*) FROM issues i WHERE i.student_id = s.student_id AND i.returned = 0
            AND substr(i.expected_return_date,1,10) < :today) AS overdue_loans,
       (SELECT COUNT(*) FROM issues i WHERE i.student_id = s.student_id) AS total_loans
FROM students s LEFT JOIN users u ON u.student_id = s.student_id
"""


def _fields(data):
    return {
        "roll_no": text(data, "roll_no", required=True, max_len=30),
        "full_name": text(data, "full_name", required=True, max_len=100),
        "rfid_uid": normalize_uid(data.get("rfid_uid"), required=False),
        "department": text(data, "department", max_len=80),
        "year_sem": text(data, "year_sem", max_len=30),
        "phone": optional_phone(text(data, "phone", max_len=20)),
        "email": optional_email(text(data, "email", max_len=120)),
    }


def _check_unique(db, f, student_id=None):
    sid = student_id or -1
    if db.execute("SELECT 1 FROM students WHERE roll_no=? AND student_id<>?", (f["roll_no"], sid)).fetchone():
        raise ApiError("A student with this roll number already exists", 409, "roll_no")
    if f["rfid_uid"]:
        if db.execute("SELECT 1 FROM students WHERE UPPER(rfid_uid)=? AND student_id<>?", (f["rfid_uid"], sid)).fetchone():
            raise ApiError("This RFID card is already assigned to another student", 409, "rfid_uid")
        if db.execute("SELECT 1 FROM components WHERE UPPER(rfid_uid)=?", (f["rfid_uid"],)).fetchone():
            raise ApiError("This UID is already used by a component tag", 409, "rfid_uid")


def _one(db, sid):
    r = db.execute(LIST_SQL + " WHERE s.student_id=:sid", {"today": today_str(), "sid": sid}).fetchone()
    return dict(r) if r else None


@bp.get("")
@admin_required
def list_students():
    q = (request.args.get("search") or "").strip()
    dept = (request.args.get("department") or "").strip()
    where, p = [], {"today": today_str()}
    if q:
        where.append("(s.full_name LIKE :q OR s.roll_no LIKE :q OR s.email LIKE :q OR s.rfid_uid LIKE :q)")
        p["q"] = f"%{q}%"
    if dept:
        where.append("s.department = :dept")
        p["dept"] = dept
    sql = LIST_SQL + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY LOWER(s.full_name)"
    db = get_db()
    depts = [r[0] for r in db.execute("SELECT DISTINCT department FROM students WHERE department IS NOT NULL AND department<>'' ORDER BY 1")]
    return jsonify({"students": rows(db.execute(sql, p)), "departments": depts})


@bp.post("")
@admin_required
def create_student():
    data = body_json()
    f = _fields(data)
    username = text(data, "username", max_len=32)
    password = data.get("password")
    if username or password:
        validate_username(username)
        validate_password(password)
    db = get_db()
    with transaction(db):
        _check_unique(db, f)
        if username and db.execute("SELECT 1 FROM users WHERE LOWER(username)=LOWER(?)", (username,)).fetchone():
            raise ApiError("Username is already taken", 409, "username")
        cur = db.execute(
            "INSERT INTO students (rfid_uid, roll_no, full_name, department, year_sem, phone, email) VALUES (?,?,?,?,?,?,?)",
            (f["rfid_uid"], f["roll_no"], f["full_name"], f["department"], f["year_sem"], f["phone"], f["email"]),
        )
        sid = cur.lastrowid
        if username:
            db.execute("INSERT INTO users (username, password_hash, role, student_id) VALUES (?,?,?,?)",
                       (username, generate_password_hash(password), "student", sid))
    return jsonify({"student": _one(db, sid)}), 201


@bp.put("/<int:sid>")
@admin_required
def update_student(sid):
    f = _fields(body_json())
    db = get_db()
    with transaction(db):
        if not db.execute("SELECT 1 FROM students WHERE student_id=?", (sid,)).fetchone():
            raise ApiError("Student not found", 404)
        _check_unique(db, f, sid)
        db.execute(
            "UPDATE students SET rfid_uid=?, roll_no=?, full_name=?, department=?, year_sem=?, phone=?, email=? WHERE student_id=?",
            (f["rfid_uid"], f["roll_no"], f["full_name"], f["department"], f["year_sem"], f["phone"], f["email"], sid),
        )
    return jsonify({"student": _one(db, sid)})


@bp.delete("/<int:sid>")
@admin_required
def delete_student(sid):
    db = get_db()
    with transaction(db):
        if not db.execute("SELECT 1 FROM students WHERE student_id=?", (sid,)).fetchone():
            raise ApiError("Student not found", 404)
        if db.execute("SELECT 1 FROM issues WHERE student_id=? LIMIT 1", (sid,)).fetchone():
            raise ApiError("This student has borrowing history and cannot be deleted", 409)
        db.execute("DELETE FROM users WHERE student_id=?", (sid,))
        db.execute("DELETE FROM students WHERE student_id=?", (sid,))
    return jsonify({"ok": True})


@bp.post("/<int:sid>/account")
@admin_required
def set_account(sid):
    """Create a login for the student, or reset the password of the existing one."""
    data = body_json()
    password = validate_password(data.get("password"))
    db = get_db()
    with transaction(db):
        if not db.execute("SELECT 1 FROM students WHERE student_id=?", (sid,)).fetchone():
            raise ApiError("Student not found", 404)
        existing = db.execute("SELECT user_id FROM users WHERE student_id=?", (sid,)).fetchone()
        if existing:
            db.execute("UPDATE users SET password_hash=? WHERE user_id=?", (generate_password_hash(password), existing["user_id"]))
        else:
            username = validate_username(text(data, "username", required=True, max_len=32))
            if db.execute("SELECT 1 FROM users WHERE LOWER(username)=LOWER(?)", (username,)).fetchone():
                raise ApiError("Username is already taken", 409, "username")
            db.execute("INSERT INTO users (username, password_hash, role, student_id) VALUES (?,?,?,?)",
                       (username, generate_password_hash(password), "student", sid))
    return jsonify({"student": _one(db, sid)})

from datetime import timedelta, date

from flask import Blueprint, current_app, g, jsonify, request

from auth import is_admin, login_required
from db import get_db, transaction
from services import ISSUE_SELECT, fetch_issue, log_activity
from utils import ApiError, body_json, int_arg, normalize_uid, parse_date, text, today_str

bp = Blueprint("issues", __name__, url_prefix="/api/issues")


def _hardware_unlock(data, db):
    """Only called AFTER the database transaction committed. Reports the real outcome."""
    if not data.get("unlock"):
        return {"requested": False, "ok": False, "message": "Cabinet unlock not requested"}
    hw = current_app.extensions["hardware"]
    res = hw.unlock(current_app.config["UNLOCK_SECONDS"])
    if res["ok"]:
        log_activity(db, "opened", "cabinet", None, "RFID Cabinet")
    return {"requested": True, **res}


@bp.get("")
@login_required
def list_issues():
    status = (request.args.get("status") or "all").lower()
    q = (request.args.get("search") or "").strip()
    where, p = [], {"today": today_str()}
    if status == "active":
        where.append("i.returned = 0")
    elif status == "overdue":
        where.append("i.returned = 0 AND substr(i.expected_return_date,1,10) < :today")
    elif status == "returned":
        where.append("i.returned = 1")
    elif status != "all":
        raise ApiError("Unknown status filter", 422, "status")
    if is_admin():
        sid = int_arg(request.args.get("student_id"), "student_id")
        if sid:
            where.append("i.student_id = :sid")
            p["sid"] = sid
    else:
        if not g.user["student_id"]:
            raise ApiError("Your account is not linked to a student record", 403)
        where.append("i.student_id = :sid")
        p["sid"] = g.user["student_id"]
    cid = int_arg(request.args.get("component_id"), "component_id")
    if cid:
        where.append("i.component_id = :cid")
        p["cid"] = cid
    if q:
        where.append("(c.name LIKE :q OR s.full_name LIKE :q OR s.roll_no LIKE :q OR c.rfid_uid LIKE :q OR i.purpose LIKE :q)")
        p["q"] = f"%{q}%"
    for key, col in (("from", "date(i.issue_date,'localtime') >= :dfrom"), ("to", "date(i.issue_date,'localtime') <= :dto")):
        v = request.args.get(key)
        if v:
            p["d" + key] = parse_date(v, key).isoformat()
            where.append(col)
    limit = min(max(int_arg(request.args.get("limit"), "limit", 200), 1), 1000)
    offset = max(int_arg(request.args.get("offset"), "offset", 0), 0)
    w = (" WHERE " + " AND ".join(where)) if where else ""
    db = get_db()
    total = db.execute(f"SELECT COUNT(*) FROM issues i JOIN components c ON c.component_id=i.component_id JOIN students s ON s.student_id=i.student_id{w}", p).fetchone()[0]
    order = "i.expected_return_date ASC" if status in ("active", "overdue") else "i.issue_id DESC"
    data = db.execute(f"{ISSUE_SELECT}{w} ORDER BY {order} LIMIT :limit OFFSET :offset", {**p, "limit": limit, "offset": offset}).fetchall()
    return jsonify({"issues": [dict(r) for r in data], "total": total})


@bp.post("/borrow")
@login_required
def borrow():
    data = body_json()
    # ---- validate input
    cid = int_arg(data.get("component_id"), "component_id")
    uid = normalize_uid(data.get("component_uid"), "component_uid", required=False)
    if not cid and not uid:
        raise ApiError("Select a component or scan its tag", 422, "component_id")
    if is_admin():
        sid = int_arg(data.get("student_id"), "student_id")
        if not sid:
            raise ApiError("Select the student who is borrowing", 422, "student_id")
    else:
        sid = g.user["student_id"]
        if not sid:
            raise ApiError("Your account is not linked to a student record", 403)
    due = parse_date(data.get("expected_return_date"))
    today = date.today()
    if due < today:
        raise ApiError("Expected return date cannot be in the past", 422, "expected_return_date")
    max_days = current_app.config["MAX_LOAN_DAYS"]
    if due > today + timedelta(days=max_days):
        raise ApiError(f"Loans cannot exceed {max_days} days", 422, "expected_return_date")
    purpose = text(data, "purpose", max_len=200)

    db = get_db()
    # ---- atomic check-and-write
    with transaction(db):
        comp = (db.execute("SELECT * FROM components WHERE component_id=?", (cid,)) if cid
                else db.execute("SELECT * FROM components WHERE UPPER(rfid_uid)=?", (uid,))).fetchone()
        if comp is None:
            raise ApiError("Component not found", 404, "component_id")
        student = db.execute("SELECT * FROM students WHERE student_id=?", (sid,)).fetchone()
        if student is None:
            raise ApiError("Student not found", 404, "student_id")
        open_loan = db.execute("SELECT expected_return_date FROM issues WHERE component_id=? AND returned=0", (comp["component_id"],)).fetchone()
        if open_loan or comp["status"] == "ISSUED":
            due_txt = f" (expected back {open_loan['expected_return_date'][:10]})" if open_loan else ""
            raise ApiError(f"{comp['name']} is already issued{due_txt}", 409, "component_id")
        if comp["status"] != "AVAILABLE":
            raise ApiError(f"{comp['name']} is marked {comp['status']} and cannot be issued", 409, "component_id")
        active = db.execute("SELECT COUNT(*) FROM issues WHERE student_id=? AND returned=0", (sid,)).fetchone()[0]
        if active >= current_app.config["MAX_ACTIVE_LOANS"]:
            raise ApiError(f"Limit reached: a student can hold at most {current_app.config['MAX_ACTIVE_LOANS']} components", 409)
        if current_app.config["BLOCK_BORROW_IF_OVERDUE"]:
            overdue = db.execute(
                "SELECT COUNT(*) FROM issues WHERE student_id=? AND returned=0 AND substr(expected_return_date,1,10) < ?",
                (sid, today.isoformat())).fetchone()[0]
            if overdue:
                raise ApiError("This student has overdue components and must return them first", 409)
        cur = db.execute(
            "INSERT INTO issues (component_id, student_id, purpose, expected_return_date, returned) VALUES (?,?,?,?,0)",
            (comp["component_id"], sid, purpose, due.isoformat()),
        )
        upd = db.execute("UPDATE components SET status='ISSUED' WHERE component_id=? AND status='AVAILABLE'", (comp["component_id"],))
        if upd.rowcount != 1:
            raise ApiError("Inventory changed while processing - please retry", 409)
        issue_id = cur.lastrowid
        log_activity(db, "borrowed", "loan", issue_id, f"{comp['name']} -> {student['full_name']}")
    hardware = _hardware_unlock(data, db)
    return jsonify({"issue": fetch_issue(db, issue_id), "hardware": hardware}), 201


@bp.post("/return")
@login_required
def return_component():
    data = body_json()
    iid = int_arg(data.get("issue_id"), "issue_id")
    cid = int_arg(data.get("component_id"), "component_id")
    uid = normalize_uid(data.get("component_uid"), "component_uid", required=False)
    if not (iid or cid or uid):
        raise ApiError("Specify the issue, component or scanned tag to return", 422, "issue_id")
    condition = (data.get("condition") or "OK").upper()
    if condition not in ("OK", "DAMAGED"):
        raise ApiError("Condition must be OK or DAMAGED", 422, "condition")
    remarks = text(data, "remarks", max_len=200)
    db = get_db()
    with transaction(db):
        if iid:
            issue = db.execute("SELECT * FROM issues WHERE issue_id=?", (iid,)).fetchone()
        elif cid:
            issue = db.execute("SELECT * FROM issues WHERE component_id=? AND returned=0", (cid,)).fetchone()
        else:
            issue = db.execute(
                "SELECT i.* FROM issues i JOIN components c ON c.component_id=i.component_id WHERE UPPER(c.rfid_uid)=? AND i.returned=0",
                (uid,)).fetchone()
        if issue is None:
            raise ApiError("No active loan found for this component", 404)
        if issue["returned"]:
            raise ApiError("This component was already returned", 409)
        if not is_admin() and issue["student_id"] != g.user["student_id"]:
            raise ApiError("You can only return components issued to you", 403)
        upd = db.execute(
            "UPDATE issues SET returned=1, actual_return_date=CURRENT_TIMESTAMP, remarks=? WHERE issue_id=? AND returned=0",
            (remarks, issue["issue_id"]))
        if upd.rowcount != 1:
            raise ApiError("This component was already returned", 409)
        db.execute("UPDATE components SET status=? WHERE component_id=?",
                   ("DAMAGED" if condition == "DAMAGED" else "AVAILABLE", issue["component_id"]))
        issue_id = issue["issue_id"]
        component = db.execute("SELECT name FROM components WHERE component_id=?", (issue["component_id"],)).fetchone()
        student = db.execute("SELECT full_name FROM students WHERE student_id=?", (issue["student_id"],)).fetchone()
        log_activity(db, "returned", "loan", issue_id, f"{component['name']} <- {student['full_name']}")
    hardware = _hardware_unlock(data, db)
    return jsonify({"issue": fetch_issue(db, issue_id), "hardware": hardware})

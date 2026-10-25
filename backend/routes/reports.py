import csv
import io
from datetime import date, timedelta

from flask import Blueprint, Response, g, jsonify, request

from auth import admin_required, is_admin, login_required
from db import get_db
from services import ISSUE_SELECT
from utils import ApiError, int_arg, rows, today_str

bp = Blueprint("reports", __name__, url_prefix="/api")


def _daterange(days):
    start = date.today() - timedelta(days=days - 1)
    return [(start + timedelta(days=i)).isoformat() for i in range(days)]


def _daily(db, days, extra="", params=None):
    p = {"since": _daterange(days)[0], **(params or {})}
    issued = dict(db.execute(f"SELECT date(issue_date,'localtime') d, COUNT(*) FROM issues i WHERE date(issue_date,'localtime') >= :since {extra} GROUP BY d", p).fetchall())
    returned = dict(db.execute(f"SELECT date(actual_return_date,'localtime') d, COUNT(*) FROM issues i WHERE returned=1 AND date(actual_return_date,'localtime') >= :since {extra} GROUP BY d", p).fetchall())
    return [{"date": d, "issued": issued.get(d, 0), "returned": returned.get(d, 0)} for d in _daterange(days)]


@bp.get("/dashboard")
@login_required
def dashboard():
    db = get_db()
    today = today_str()
    soon = (date.today() + timedelta(days=3)).isoformat()
    upcoming = rows(db.execute(
        """SELECT c.name, c.category, i.expected_return_date,
                  CASE WHEN substr(i.expected_return_date,1,10) < :today THEN 1 ELSE 0 END AS overdue
           FROM issues i JOIN components c ON c.component_id=i.component_id
           WHERE i.returned=0 ORDER BY i.expected_return_date LIMIT 8""", {"today": today}))
    status_counts = dict(db.execute("SELECT status, COUNT(*) FROM components GROUP BY status").fetchall())
    base = {"status_counts": {k: status_counts.get(k, 0) for k in ("AVAILABLE", "ISSUED", "DAMAGED", "LOST")},
            "components_total": sum(status_counts.values()), "upcoming_returns": upcoming}
    if not is_admin():
        sid = g.user["student_id"]
        mine = rows(db.execute(ISSUE_SELECT + " WHERE i.student_id=:sid AND i.returned=0 ORDER BY i.expected_return_date", {"today": today, "sid": sid}))
        total = db.execute("SELECT COUNT(*) FROM issues WHERE student_id=?", (sid,)).fetchone()[0]
        return jsonify({"role": "student", **base, "my_active": mine, "my_overdue": sum(m["overdue"] for m in mine),
                        "my_total": total, "trend": _daily(db, 14, "AND i.student_id=:sid", {"sid": sid})})
    one = lambda sql, p=None: db.execute(sql, p or {}).fetchone()[0]
    by_cat = rows(db.execute("SELECT COALESCE(NULLIF(category,''),'Uncategorised') AS name, COUNT(*) AS value FROM components GROUP BY 1 ORDER BY 2 DESC LIMIT 8"))
    recent = rows(db.execute(
        """SELECT i.issue_id, c.name AS component_name, s.full_name AS student_name, i.returned,
                  CASE WHEN i.returned=1 THEN i.actual_return_date ELSE i.issue_date END AS at
           FROM issues i JOIN components c ON c.component_id=i.component_id JOIN students s ON s.student_id=i.student_id
           ORDER BY COALESCE(i.actual_return_date, i.issue_date) DESC, i.issue_id DESC LIMIT 8"""))
    return jsonify({
        "role": "admin", **base,
        "students_total": one("SELECT COUNT(*) FROM students"),
        "active_loans": one("SELECT COUNT(*) FROM issues WHERE returned=0"),
        "overdue_loans": one("SELECT COUNT(*) FROM issues WHERE returned=0 AND substr(expected_return_date,1,10) < ?", (today,)),
        "due_soon": one("SELECT COUNT(*) FROM issues WHERE returned=0 AND substr(expected_return_date,1,10) BETWEEN ? AND ?", (today, soon)),
        "issued_today": one("SELECT COUNT(*) FROM issues WHERE date(issue_date,'localtime') = ?", (today,)),
        "returned_today": one("SELECT COUNT(*) FROM issues WHERE returned=1 AND date(actual_return_date,'localtime') = ?", (today,)),
        "trend": _daily(db, 14), "by_category": by_cat, "recent": recent,
    })


@bp.get("/reports/summary")
@admin_required
def summary():
    days = min(max(int_arg(request.args.get("days"), "days", 30), 1), 365)
    db = get_db()
    today = today_str()
    since = _daterange(days)[0]
    p = {"since": since, "today": today}
    one = lambda sql: db.execute(sql, p).fetchone()
    total, = one("SELECT COUNT(*) FROM issues WHERE date(issue_date,'localtime') >= :since")
    ret_n, avg_days, on_time = one(
        """SELECT COUNT(*), AVG(julianday(actual_return_date) - julianday(issue_date)),
                  SUM(CASE WHEN date(actual_return_date,'localtime') <= substr(expected_return_date,1,10) THEN 1 ELSE 0 END)
           FROM issues WHERE returned=1 AND date(actual_return_date,'localtime') >= :since""")
    top_components = rows(db.execute(
        """SELECT c.name, COUNT(*) AS loans FROM issues i JOIN components c ON c.component_id=i.component_id
           WHERE date(i.issue_date,'localtime') >= :since GROUP BY c.component_id ORDER BY loans DESC, c.name LIMIT 8""", p))
    top_students = rows(db.execute(
        """SELECT s.full_name AS name, s.roll_no, COUNT(*) AS loans FROM issues i JOIN students s ON s.student_id=i.student_id
           WHERE date(i.issue_date,'localtime') >= :since GROUP BY s.student_id ORDER BY loans DESC, name LIMIT 8""", p))
    by_dept = rows(db.execute(
        """SELECT COALESCE(NULLIF(s.department,''),'Unspecified') AS name, COUNT(*) AS value FROM issues i
           JOIN students s ON s.student_id=i.student_id WHERE date(i.issue_date,'localtime') >= :since GROUP BY 1 ORDER BY 2 DESC""", p))
    by_cat = rows(db.execute(
        """SELECT COALESCE(NULLIF(c.category,''),'Uncategorised') AS name, COUNT(*) AS value FROM issues i
           JOIN components c ON c.component_id=i.component_id WHERE date(i.issue_date,'localtime') >= :since GROUP BY 1 ORDER BY 2 DESC""", p))
    overdue = rows(db.execute(ISSUE_SELECT + " WHERE i.returned=0 AND substr(i.expected_return_date,1,10) < :today ORDER BY i.expected_return_date", {"today": today}))
    return jsonify({
        "days": days, "total_loans": total, "returned": ret_n,
        "avg_loan_days": round(avg_days, 1) if avg_days is not None else None,
        "on_time_rate": round(100 * on_time / ret_n) if ret_n else None,
        "daily": _daily(db, days), "top_components": top_components, "top_students": top_students,
        "by_department": by_dept, "by_category": by_cat, "overdue": overdue,
    })


def _safe(v):
    """Neutralise spreadsheet formula injection."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


@bp.get("/reports/export")
@admin_required
def export():
    kind = request.args.get("type", "issues")
    db = get_db()
    today = today_str()
    if kind == "issues":
        data = rows(db.execute(ISSUE_SELECT + " ORDER BY i.issue_id DESC", {"today": today}))
        cols = ["issue_id", "component_name", "component_uid", "student_name", "roll_no", "department", "purpose", "issue_date", "expected_return_date", "actual_return_date", "returned", "overdue", "remarks"]
    elif kind == "overdue":
        data = rows(db.execute(ISSUE_SELECT + " WHERE i.returned=0 AND substr(i.expected_return_date,1,10) < :today ORDER BY i.expected_return_date", {"today": today}))
        cols = ["issue_id", "component_name", "student_name", "roll_no", "issue_date", "expected_return_date", "days_overdue"]
    elif kind == "inventory":
        data = rows(db.execute("SELECT component_id, rfid_uid, name, category, shelf_location, status, issued_to, roll_no, expected_return_date FROM current_status ORDER BY name"))
        cols = ["component_id", "rfid_uid", "name", "category", "shelf_location", "status", "issued_to", "roll_no", "expected_return_date"]
        cat = {r[0]: r[1] for r in db.execute("SELECT component_id, category||'|'||COALESCE(shelf_location,'') FROM components")}
        for r in data:
            c, _, s = (cat.get(r["component_id"]) or "|").partition("|")
            r["category"], r["shelf_location"] = c, s
    elif kind == "students":
        data = rows(db.execute("SELECT student_id, roll_no, full_name, department, year_sem, phone, email, created_at FROM students ORDER BY full_name"))
        cols = list(data[0].keys()) if data else ["student_id"]
    else:
        raise ApiError("Unknown export type", 422, "type")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    for r in data:
        w.writerow([_safe(r.get(c)) for c in cols])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=smartlab_{kind}_{today}.csv"})

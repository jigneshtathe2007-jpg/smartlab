"""Shared query helpers."""
from flask import g

from utils import today_str

COMPONENT_SELECT = """
SELECT c.component_id, c.rfid_uid, c.name, c.category, c.description, c.shelf_location, c.status, c.added_at,
       i.issue_id, i.issue_date, i.expected_return_date, i.purpose AS loan_purpose,
       i.student_id AS holder_id, s.full_name AS holder_name, s.roll_no AS holder_roll,
       CASE WHEN i.issue_id IS NOT NULL AND substr(i.expected_return_date,1,10) < :today THEN 1 ELSE 0 END AS overdue
FROM components c
LEFT JOIN issues i ON i.component_id = c.component_id AND i.returned = 0
LEFT JOIN students s ON s.student_id = i.student_id
"""

ISSUE_SELECT = """
SELECT i.issue_id, i.component_id, i.student_id, i.purpose, i.issue_date, i.expected_return_date,
       i.actual_return_date, i.returned, i.remarks,
       c.name AS component_name, c.rfid_uid AS component_uid, c.category,
       s.full_name AS student_name, s.roll_no, s.department,
       CASE WHEN i.returned = 0 AND substr(i.expected_return_date,1,10) < :today THEN 1 ELSE 0 END AS overdue,
       CASE WHEN i.returned = 0 THEN CAST(julianday(:today) - julianday(substr(i.expected_return_date,1,10)) AS INTEGER) END AS days_overdue
FROM issues i
JOIN components c ON c.component_id = i.component_id
JOIN students s ON s.student_id = i.student_id
"""


def mask_component(row, user):
    """Students may see that an item is out and when it returns, but not who has it."""
    d = dict(row)
    d["mine"] = bool(user["student_id"] and d.get("holder_id") == user["student_id"])
    if user["role"] != "admin":
        for k in ("holder_id", "holder_name", "holder_roll", "loan_purpose", "issue_id"):
            d[k] = d[k] if (k == "issue_id" and d["mine"]) else None
    return d


def fetch_components(db, where="", params=None, user=None, order="LOWER(c.name)"):
    user = user or g.user
    p = {"today": today_str()}
    p.update(params or {})
    sql = COMPONENT_SELECT + (f" WHERE {where}" if where else "") + f" ORDER BY {order}"
    return [mask_component(r, user) for r in db.execute(sql, p).fetchall()]


def get_component(db, component_id=None, uid=None):
    if component_id is not None:
        res = fetch_components(db, "c.component_id = :cid", {"cid": component_id})
    else:
        res = fetch_components(db, "UPPER(c.rfid_uid) = :uid", {"uid": uid})
    return res[0] if res else None


def fetch_issue(db, issue_id):
    row = db.execute(ISSUE_SELECT + " WHERE i.issue_id = :iid", {"today": today_str(), "iid": issue_id}).fetchone()
    return dict(row) if row else None

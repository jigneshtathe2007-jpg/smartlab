from flask import Blueprint, g, jsonify, request

from auth import admin_required, login_required
from db import get_db, transaction
from services import fetch_components, get_component
from utils import ApiError, body_json, normalize_uid, text

bp = Blueprint("components", __name__, url_prefix="/api/components")
STATUSES = ("AVAILABLE", "ISSUED", "DAMAGED", "LOST")


def _fields(data):
    return {
        "rfid_uid": normalize_uid(data.get("rfid_uid")),
        "name": text(data, "name", required=True, max_len=100),
        "category": text(data, "category", max_len=60),
        "description": text(data, "description", max_len=300),
        "shelf_location": text(data, "shelf_location", max_len=60),
    }


def _check_uid(db, uid, cid=None):
    if db.execute("SELECT 1 FROM components WHERE UPPER(rfid_uid)=? AND component_id<>?", (uid, cid or -1)).fetchone():
        raise ApiError("This RFID tag is already registered to another component", 409, "rfid_uid")
    if db.execute("SELECT 1 FROM students WHERE UPPER(rfid_uid)=?", (uid,)).fetchone():
        raise ApiError("This UID belongs to a student card", 409, "rfid_uid")


@bp.get("")
@login_required
def list_components():
    q = (request.args.get("search") or "").strip()
    status = (request.args.get("status") or "").upper()
    category = (request.args.get("category") or "").strip()
    where, p = [], {}
    if q:
        where.append("(c.name LIKE :q OR c.rfid_uid LIKE :q OR c.category LIKE :q OR c.shelf_location LIKE :q OR c.description LIKE :q)")
        p["q"] = f"%{q}%"
    if status == "OVERDUE":
        where.append("i.issue_id IS NOT NULL AND substr(i.expected_return_date,1,10) < :today")
    elif status in STATUSES:
        where.append("c.status = :status")
        p["status"] = status
    elif status:
        raise ApiError("Unknown status filter", 422, "status")
    if category:
        where.append("c.category = :category")
        p["category"] = category
    db = get_db()
    cats = [r[0] for r in db.execute("SELECT DISTINCT category FROM components WHERE category IS NOT NULL AND category<>'' ORDER BY 1")]
    return jsonify({"components": fetch_components(db, " AND ".join(where), p), "categories": cats})


@bp.post("")
@admin_required
def create_component():
    f = _fields(body_json())
    db = get_db()
    with transaction(db):
        _check_uid(db, f["rfid_uid"])
        cur = db.execute(
            "INSERT INTO components (rfid_uid, name, category, description, shelf_location, status) VALUES (?,?,?,?,?, 'AVAILABLE')",
            (f["rfid_uid"], f["name"], f["category"], f["description"], f["shelf_location"]),
        )
    return jsonify({"component": get_component(db, cur.lastrowid)}), 201


@bp.put("/<int:cid>")
@admin_required
def update_component(cid):
    data = body_json()
    f = _fields(data)
    new_status = (data.get("status") or "").upper() or None
    db = get_db()
    with transaction(db):
        cur = db.execute("SELECT status FROM components WHERE component_id=?", (cid,)).fetchone()
        if cur is None:
            raise ApiError("Component not found", 404)
        open_loan = db.execute("SELECT 1 FROM issues WHERE component_id=? AND returned=0", (cid,)).fetchone()
        _check_uid(db, f["rfid_uid"], cid)
        status = cur["status"]
        if new_status and new_status != status:
            if new_status not in STATUSES:
                raise ApiError("Invalid status", 422, "status")
            if open_loan:
                raise ApiError("Return the component before changing its status", 409, "status")
            if new_status == "ISSUED":
                raise ApiError("Use the Issue workflow to mark a component as issued", 409, "status")
            status = new_status
        db.execute(
            "UPDATE components SET rfid_uid=?, name=?, category=?, description=?, shelf_location=?, status=? WHERE component_id=?",
            (f["rfid_uid"], f["name"], f["category"], f["description"], f["shelf_location"], status, cid),
        )
    return jsonify({"component": get_component(db, cid)})


@bp.delete("/<int:cid>")
@admin_required
def delete_component(cid):
    db = get_db()
    with transaction(db):
        if not db.execute("SELECT 1 FROM components WHERE component_id=?", (cid,)).fetchone():
            raise ApiError("Component not found", 404)
        if db.execute("SELECT 1 FROM issues WHERE component_id=? LIMIT 1", (cid,)).fetchone():
            raise ApiError("This component has borrowing history and cannot be deleted. Mark it LOST or DAMAGED instead.", 409)
        db.execute("DELETE FROM components WHERE component_id=?", (cid,))
    return jsonify({"ok": True})

from flask import Blueprint, current_app, g, jsonify, request

from auth import admin_required, is_admin, login_required
from db import get_db
from services import get_component, log_activity
from utils import ApiError, body_json, int_arg, normalize_uid

bp = Blueprint("hardware", __name__, url_prefix="/api")


def hw():
    return current_app.extensions["hardware"]


def resolve_uid(db, uid):
    comp = get_component(db, uid=uid)
    if comp:
        return {"type": "component", "component": comp}
    st = db.execute("SELECT student_id, full_name, roll_no, department, year_sem FROM students WHERE UPPER(rfid_uid)=?", (uid,)).fetchone()
    if st:
        st = dict(st)
        if not is_admin() and st["student_id"] != g.user["student_id"]:
            return {"type": "student", "student": None}   # do not leak other students' identity
        st["active_loans"] = db.execute("SELECT COUNT(*) FROM issues WHERE student_id=? AND returned=0", (st["student_id"],)).fetchone()[0]
        return {"type": "student", "student": st}
    return {"type": "unknown"}


@bp.get("/hardware/status")
@login_required
def status():
    return jsonify(hw().status())


@bp.get("/hardware/scans")
@login_required
def scans():
    """Poll for tags read by the physical reader. Without ?after= it only returns the current cursor."""
    after = request.args.get("after")
    manager = hw()
    if after is None:
        return jsonify({"latest_id": manager.latest_scan_id(), "scans": []})
    db = get_db()
    out = []
    for s in manager.scans_after(int_arg(after, "after", 0)):
        out.append({**s, "resolved": resolve_uid(db, s["uid"])})
    return jsonify({"latest_id": manager.latest_scan_id(), "scans": out})


@bp.get("/lookup/<uid>")
@login_required
def lookup(uid):
    """Resolve a typed-in UID (manual entry). This is a database lookup, not a hardware scan."""
    uid = normalize_uid(uid)
    return jsonify({"uid": uid, "resolved": resolve_uid(get_db(), uid)})


@bp.post("/hardware/unlock")
@admin_required
def manual_unlock():
    data = body_json()
    seconds = min(max(int_arg(data.get("seconds"), "seconds", current_app.config["UNLOCK_SECONDS"]), 1), 30)
    res = hw().unlock(seconds)
    if res["ok"]:
        log_activity(get_db(), "opened", "cabinet", None, "RFID Cabinet")
    return jsonify(res), (200 if res["ok"] else 503)


@bp.post("/hardware/reconnect")
@admin_required
def reconnect():
    return jsonify(hw().reconnect())


@bp.post("/hardware/bridge/poll")
@admin_required
def bridge_poll():
    manager = hw()
    publish = getattr(manager, "publish", None)
    if publish is None:
        raise ApiError("Hardware bridge is not enabled on this server", 404)
    try:
        return jsonify(publish(body_json()))
    except ValueError as exc:
        raise ApiError(str(exc), 422)

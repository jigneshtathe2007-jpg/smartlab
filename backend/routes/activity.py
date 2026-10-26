from flask import Blueprint, jsonify, request

from auth import admin_required
from db import get_db
from utils import int_arg

bp = Blueprint("activity", __name__, url_prefix="/api/activity")


@bp.get("")
@admin_required
def list_activity():
    search = (request.args.get("search") or "").strip()
    where = ""
    params = {}
    if search:
        where = """WHERE actor_name LIKE :search OR actor_username LIKE :search
                   OR action LIKE :search OR entity_type LIKE :search OR entity_name LIKE :search"""
        params["search"] = f"%{search}%"
    limit = min(max(int_arg(request.args.get("limit"), "limit", 200), 1), 500)
    offset = max(int_arg(request.args.get("offset"), "offset", 0), 0)
    db = get_db()
    total = db.execute(f"SELECT COUNT(*) FROM activity_logs {where}", params).fetchone()[0]
    events = db.execute(
        f"""SELECT activity_id, actor_user_id, actor_name, actor_username, actor_role,
                   action, entity_type, entity_id, entity_name, created_at
            FROM activity_logs {where}
            ORDER BY created_at DESC, activity_id DESC
            LIMIT :limit OFFSET :offset""",
        {**params, "limit": limit, "offset": offset},
    ).fetchall()
    opened = db.execute("SELECT COUNT(*) FROM activity_logs WHERE action='opened'").fetchone()[0]
    created = db.execute("SELECT COUNT(*) FROM activity_logs WHERE action='created'").fetchone()[0]
    return jsonify({
        "events": [dict(event) for event in events],
        "total": total,
        "opened": opened,
        "created": created,
    })

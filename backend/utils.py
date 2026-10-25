import re
from datetime import date, datetime

from flask import jsonify

UID_RE = re.compile(r"^[0-9A-F]{8,20}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^\+?[0-9 \-]{7,15}$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.\-]{3,32}$")


class ApiError(Exception):
    def __init__(self, message, status=400, field=None):
        super().__init__(message)
        self.message, self.status, self.field = message, status, field


def error_response(message, status=400, field=None):
    body = {"error": message}
    if field:
        body["field"] = field
    return jsonify(body), status


def body_json():
    data = __import__("flask").request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Request body must be a JSON object")
    return data


def text(data, key, *, required=False, max_len=120, default=None):
    val = data.get(key)
    if val is None or (isinstance(val, str) and not val.strip()):
        if required:
            raise ApiError(f"{key.replace('_', ' ').capitalize()} is required", 422, key)
        return default
    if not isinstance(val, str):
        raise ApiError(f"{key} must be text", 422, key)
    val = val.strip()
    if len(val) > max_len:
        raise ApiError(f"{key.replace('_', ' ').capitalize()} must be at most {max_len} characters", 422, key)
    return val


def normalize_uid(raw, field="rfid_uid", required=True):
    if raw is None or str(raw).strip() == "":
        if required:
            raise ApiError("RFID UID is required", 422, field)
        return None
    uid = re.sub(r"[\s:\-]", "", str(raw)).upper()
    if not UID_RE.match(uid):
        raise ApiError("RFID UID must be 8-20 hex characters (e.g. A1B2C3D4)", 422, field)
    return uid


def optional_email(val, field="email"):
    if val and not EMAIL_RE.match(val):
        raise ApiError("Invalid email address", 422, field)
    return val


def optional_phone(val, field="phone"):
    if val and not PHONE_RE.match(val):
        raise ApiError("Phone must be 7-15 digits (spaces, - and leading + allowed)", 422, field)
    return val


def parse_date(val, field="expected_return_date"):
    try:
        return datetime.strptime(str(val)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise ApiError("Date must be in YYYY-MM-DD format", 422, field)


def today_str():
    return date.today().isoformat()


def rows(cursor_rows):
    return [dict(r) for r in cursor_rows]


def int_arg(val, name, default=None):
    if val in (None, ""):
        return default
    try:
        return int(val)
    except (TypeError, ValueError):
        raise ApiError(f"{name} must be a number", 422, name)

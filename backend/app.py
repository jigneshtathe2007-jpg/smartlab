"""SmartLab - RFID Smart Cabinet Management System (Flask backend + static React build)."""
import logging
import os
import sqlite3
import sys
from pathlib import Path

from flask import Flask, jsonify, send_from_directory
import psycopg

import config
from db import close_db, initialize_empty_db, migrate
from hardware import HardwareManager
from utils import ApiError, error_response

log = logging.getLogger("smartlab")


def create_app(db_path=None, start_hardware=True, serial_port=None, hardware_manager=None):
    app = Flask(__name__, static_folder=None)
    app.config.update(
        DB_PATH=str(db_path or config.DB_PATH),
        DATABASE_URL=config.DATABASE_URL,
        SECRET_KEY=config.load_secret_key(),
        TOKEN_TTL_SECONDS=config.TOKEN_TTL_SECONDS,
        MAX_LOAN_DAYS=config.MAX_LOAN_DAYS,
        MAX_ACTIVE_LOANS=config.MAX_ACTIVE_LOANS,
        BLOCK_BORROW_IF_OVERDUE=config.BLOCK_BORROW_IF_OVERDUE,
        UNLOCK_SECONDS=config.UNLOCK_SECONDS,
        JSON_SORT_KEYS=False,
    )
    if app.config["DATABASE_URL"]:
        migrate(app.config["DATABASE_URL"])
    else:
        if not Path(app.config["DB_PATH"]).exists():
            if os.environ.get("SMARTLAB_ALLOW_EMPTY_DB") == "1":
                initialize_empty_db(app.config["DB_PATH"])
            else:
                raise SystemExit(f"Database not found: {app.config['DB_PATH']}\nSet SMARTLAB_DB to your existing SQLite file.")
        migrate(app.config["DB_PATH"])
    app.teardown_appcontext(close_db)

    hw = hardware_manager or HardwareManager(serial_port or config.SERIAL_PORT, config.SERIAL_BAUD, enabled=start_hardware)
    app.extensions["hardware"] = hw
    if start_hardware:
        hw.start()

    from routes import activity, auth_routes, components, hardware as hw_routes, issues, reports, students
    for mod in (auth_routes, students, components, issues, hw_routes, reports, activity):
        app.register_blueprint(mod.bp)

    @app.get("/api/health")
    def health():
        return jsonify({"ok": True})

    @app.errorhandler(ApiError)
    def _api_error(e):
        return error_response(e.message, e.status, e.field)

    @app.errorhandler(sqlite3.IntegrityError)
    def _integrity(e):
        log.warning("Integrity error: %s", e)
        return error_response("That change conflicts with existing data (duplicate or in use)", 409)

    @app.errorhandler(sqlite3.OperationalError)
    def _operational(e):
        log.exception("Database error")
        return error_response("Database is busy or unavailable, please retry", 503)

    @app.errorhandler(psycopg.IntegrityError)
    def _postgres_integrity(e):
        log.warning("Database integrity error: %s", e)
        return error_response("That change conflicts with existing data (duplicate or in use)", 409)

    @app.errorhandler(psycopg.OperationalError)
    def _postgres_operational(e):
        log.exception("Database error")
        return error_response("Database is busy or unavailable, please retry", 503)

    @app.errorhandler(404)
    def _404(_e):
        return error_response("Not found", 404)

    @app.errorhandler(405)
    def _405(_e):
        return error_response("Method not allowed", 405)

    @app.errorhandler(Exception)
    def _500(e):
        log.exception("Unhandled error")
        return error_response("Unexpected server error", 500)

    # ---- serve the built React app (frontend/dist) ----
    dist = config.FRONTEND_DIST

    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def spa(path):
        if path.startswith("api/"):
            return error_response("Not found", 404)
        if not (dist / "index.html").exists():
            return ("Frontend not built. Run `npm install && npm run build` in /frontend, "
                    "or use `npm run dev` (port 5173) during development.", 200)
        target = dist / path
        if path and target.is_file() and dist in target.resolve().parents:
            return send_from_directory(dist, path)
        return send_from_directory(dist, "index.html")

    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    application = create_app()
    print(f"\n  SmartLab running on http://localhost:5000   (database: {application.config['DB_PATH']})\n")
    # use_reloader=False: the reloader would start the serial thread twice and fight over the port
    application.run(
    host="0.0.0.0",
    port=int(os.environ.get("PORT", 5000)),
    debug=False,
    threaded=True,
    use_reloader=False,
)
    sys.exit(0)

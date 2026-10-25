import os

from werkzeug.security import generate_password_hash

from app import create_app
from db import connect
from routes.auth_routes import validate_password, validate_username

application = create_app(start_hardware=False)

conn = connect(application.config["DB_PATH"])
try:
    user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if user_count == 0:
        username = validate_username(os.environ.get("SMARTLAB_ADMIN_USERNAME", ""))
        password = validate_password(os.environ.get("SMARTLAB_ADMIN_PASSWORD"))
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
            (username, generate_password_hash(password)),
        )
finally:
    conn.close()

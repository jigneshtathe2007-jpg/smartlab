"""Create (or reset the password of) an administrator account in your existing database.

    python create_admin.py                # prompts for username + password
    python create_admin.py --username lab_admin
"""
import argparse
import getpass
import sqlite3

from werkzeug.security import generate_password_hash

import config
from db import connect, migrate
from routes.auth_routes import validate_password, validate_username


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--username")
    args = ap.parse_args()
    database = config.DATABASE_URL or config.DB_PATH
    migrate(database)
    username = args.username or input("Admin username: ").strip()
    validate_username(username)
    pw = getpass.getpass("Password (min 8 chars): ")
    if pw != getpass.getpass("Repeat password: "):
        raise SystemExit("Passwords do not match.")
    validate_password(pw)
    conn = connect(database)
    row = conn.execute("SELECT user_id, role FROM users WHERE LOWER(username)=LOWER(?)", (username,)).fetchone()
    if row and row["role"] != "admin":
        raise SystemExit("That username belongs to a student account. Choose another.")
    if row:
        conn.execute("UPDATE users SET password_hash=? WHERE user_id=?", (generate_password_hash(pw), row["user_id"]))
        print(f"Password updated for admin '{username}'.")
    else:
        conn.execute("INSERT INTO users (username, password_hash, role) VALUES (?,?,'admin')", (username, generate_password_hash(pw)))
        print(f"Admin '{username}' created in {config.DB_PATH}")


if __name__ == "__main__":
    main()

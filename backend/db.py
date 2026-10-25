"""SQLite helpers. Works on the existing database; only additive migrations are applied."""
import sqlite3
from contextlib import contextmanager

from flask import current_app, g

REQUIRED_TABLES = {"students", "components", "issues"}


def connect(path):
    # isolation_level=None -> autocommit; transactions are controlled explicitly below.
    conn = sqlite3.connect(str(path), timeout=15, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db():
    if "db" not in g:
        g.db = connect(current_app.config["DB_PATH"])
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


@contextmanager
def transaction(db):
    """BEGIN IMMEDIATE takes the write lock up-front so check-then-write sequences are atomic."""
    db.execute("BEGIN IMMEDIATE")
    try:
        yield db
        db.execute("COMMIT")
    except BaseException:
        db.execute("ROLLBACK")
        raise


def migrate(path):
    """Verify the existing schema and add (never alter) what the app needs:
       - users table for login / roles
       - unique partial index guaranteeing a component has at most one open loan
    """
    conn = connect(path)
    try:
        tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        missing = REQUIRED_TABLES - tables
        if missing:
            raise RuntimeError(f"Database {path} is missing tables: {', '.join(sorted(missing))}")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS users (
                   user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
                   username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
                   password_hash TEXT NOT NULL,
                   role          TEXT NOT NULL CHECK (role IN ('admin','student')),
                   student_id    INTEGER UNIQUE,
                   created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
                   FOREIGN KEY (student_id) REFERENCES students(student_id)
               )"""
        )
        try:
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_issues_one_open_per_component "
                "ON issues(component_id) WHERE returned = 0"
            )
        except sqlite3.IntegrityError:
            current_app_warn = "Existing data has components with several open loans; unique index not created."
            print("WARNING:", current_app_warn)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_issues_returned_due ON issues(returned, expected_return_date)")
    finally:
        conn.close()

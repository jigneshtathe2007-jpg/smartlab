"""SQLite and PostgreSQL helpers for local and persistent cloud databases."""
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from flask import current_app, g
import psycopg
from psycopg.rows import dict_row

REQUIRED_TABLES = {"students", "components", "issues"}
POSTGRES_PRIMARY_KEYS = {
    "students": ("student_id",),
    "components": ("component_id",),
    "issues": ("issue_id",),
    "users": ("user_id",),
}


class _PostgresRow(dict):
    def __getitem__(self, key):
        if isinstance(key, int):
            return tuple(self.values())[key]
        return super().__getitem__(key)


def _postgres_row(cursor):
    make_dict = dict_row(cursor)
    return lambda values: _PostgresRow(make_dict(values))


class _PostgresCursor:
    def __init__(self, cursor, lastrowid=None):
        self._cursor = cursor
        self.lastrowid = lastrowid

    @property
    def rowcount(self):
        return self._cursor.rowcount

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()


class _PostgresConnection:
    _insert = re.compile(r"^\s*INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]+)\)", re.IGNORECASE)
    _named_parameter = re.compile(r"(?<!:):([a-z_][a-z0-9_]*)", re.IGNORECASE)
    _sqlite_date = re.compile(r"\bdate\(([^,()]+),\s*'localtime'\)", re.IGNORECASE)
    _sqlite_julianday = re.compile(r"\bjulianday\(((?:substr\([^()]*\)|[^()])*)\)", re.IGNORECASE)

    def __init__(self, url):
        self._connection = psycopg.connect(
            url,
            autocommit=True,
            row_factory=_postgres_row,
            connect_timeout=15,
        )

    @classmethod
    def _add_generated_key(cls, query):
        insert = cls._insert.match(query)
        if not insert:
            return query, False
        table = insert.group(1).lower()
        primary_key = POSTGRES_PRIMARY_KEYS.get(table)
        columns = {column.strip().strip('"').lower() for column in insert.group(2).split(",")}
        if primary_key and primary_key[0] not in columns and "RETURNING" not in query.upper():
            return query.rstrip().rstrip(";") + f" RETURNING {primary_key[0]}", True
        return query, False

    @classmethod
    def _prepare_query(cls, query, params):
        query = cls._sqlite_date.sub(
            r"to_char((\1)::timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD')",
            query,
        )

        def julianday(match):
            value = match.group(1).strip()
            return f"(EXTRACT(EPOCH FROM (({value})::timestamp AT TIME ZONE 'UTC')) / 86400.0 + 2440587.5)"

        query = cls._sqlite_julianday.sub(julianday, query)
        if isinstance(params, dict):
            return cls._named_parameter.sub(r"%(\1)s", query)
        return query.replace("?", "%s")

    def execute(self, query, params=None):
        query, returns_id = self._add_generated_key(query)
        query = self._prepare_query(query, params)
        cursor = self._connection.cursor()
        cursor.execute(query, params)
        lastrowid = None
        if returns_id:
            row = cursor.fetchone()
            lastrowid = row[0] if row else None
        return _PostgresCursor(cursor, lastrowid)

    def executescript(self, script):
        for statement in script.split(";"):
            if statement.strip():
                self.execute(statement)

    def close(self):
        self._connection.close()


def connect(path):
    if isinstance(path, str) and path.startswith(("postgres://", "postgresql://")):
        return _PostgresConnection(path)
    # isolation_level=None -> autocommit; transactions are controlled explicitly below.
    conn = sqlite3.connect(str(path), timeout=15, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db():
    if "db" not in g:
        g.db = connect(current_app.config["DATABASE_URL"] or current_app.config["DB_PATH"])
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def initialize_empty_db(path):
    """Create the app's empty schema for explicitly opted-in ephemeral deployments."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), isolation_level=None)
    try:
        schema = Path(__file__).with_name("empty_schema.sql").read_text(encoding="utf-8")
        conn.executescript(schema)
    finally:
        conn.close()


@contextmanager
def transaction(db):
    """Run a check-and-write sequence in a database transaction."""
    db.execute("BEGIN" if isinstance(db, _PostgresConnection) else "BEGIN IMMEDIATE")
    try:
        yield db
        db.execute("COMMIT")
    except BaseException:
        db.execute("ROLLBACK")
        raise


def migrate(path):
    """Create or verify the schema and add the app's indexes."""
    if isinstance(path, str) and path.startswith(("postgres://", "postgresql://")):
        conn = connect(path)
        try:
            schema = Path(__file__).with_name("postgres_schema.sql").read_text(encoding="utf-8")
            conn.executescript(schema)
            tables = {
                row["table_name"]
                for row in conn.execute(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
                ).fetchall()
            }
            missing = REQUIRED_TABLES - tables
            if missing:
                raise RuntimeError(f"Database is missing tables: {', '.join(sorted(missing))}")
        finally:
            conn.close()
        return

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

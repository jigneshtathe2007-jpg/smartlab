"""Copy the local SmartLab SQLite tables directly to an empty PostgreSQL database."""
import argparse
import getpass
import sqlite3
import sys
from pathlib import Path

import config
import psycopg
from db import REQUIRED_TABLES, connect, migrate, transaction

TABLE_ORDER = ("students", "components", "users", "issues")
PRIMARY_KEYS = {
    "students": "student_id",
    "components": "component_id",
    "users": "user_id",
    "issues": "issue_id",
}


def migrate_data(source_path, database_url):
    source_path = Path(source_path)
    if not source_path.is_file():
        raise FileNotFoundError(f"SQLite database not found: {source_path}")

    source = sqlite3.connect(str(source_path))
    source.row_factory = sqlite3.Row
    try:
        integrity = source.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite integrity check failed: {integrity}")
        available = {
            row["name"]
            for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        missing = REQUIRED_TABLES - available
        if missing:
            raise RuntimeError(f"SQLite database is missing tables: {', '.join(sorted(missing))}")
        tables = [table for table in TABLE_ORDER if table in available]
        counts = {
            table: source.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            for table in tables
        }

        migrate(database_url)
        destination = connect(database_url)
        try:
            occupied = {
                table: destination.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
                for table in tables
            }
            if any(occupied.values()):
                raise RuntimeError(
                    "Destination database is not empty. Refusing to overwrite existing accounts or records."
                )

            print("Rows to copy:")
            for table in tables:
                print(f"  {table}: {counts[table]}")
            confirmation = input("Type IMPORT to copy this database directly to PostgreSQL: ")
            if confirmation != "IMPORT":
                print("Import cancelled.")
                return

            with transaction(destination):
                for table in tables:
                    columns = [
                        row["name"]
                        for row in source.execute(f'PRAGMA table_info("{table}")')
                    ]
                    quoted_columns = ", ".join(f'"{column}"' for column in columns)
                    placeholders = ", ".join("?" for _ in columns)
                    rows = source.execute(f'SELECT {quoted_columns} FROM "{table}"').fetchall()
                    for row in rows:
                        destination.execute(
                            f'INSERT INTO "{table}" ({quoted_columns}) VALUES ({placeholders})',
                            tuple(row),
                        )

                for table, primary_key in PRIMARY_KEYS.items():
                    if table not in tables:
                        continue
                    destination.execute(
                        f"""SELECT setval(
                                pg_get_serial_sequence('public.{table}', '{primary_key}'),
                                GREATEST(COALESCE(MAX("{primary_key}"), 1), 1),
                                COUNT(*) > 0
                            ) FROM "{table}" """
                    )
            print("Import complete. Keep the source database as a backup.")
        finally:
            destination.close()
    finally:
        source.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=str(config.DB_PATH), help="Local SQLite file (default: backend/cabinet.db)")
    args = parser.parse_args()

    database_url = getpass.getpass("Paste your Neon PostgreSQL connection string (input is hidden): ").strip()
    if not database_url.startswith(("postgres://", "postgresql://")):
        parser.error("Neon connection string must start with postgres:// or postgresql://")
    try:
        migrate_data(args.source, database_url)
    except (OSError, RuntimeError, sqlite3.Error, psycopg.Error) as exc:
        print(f"Migration failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()

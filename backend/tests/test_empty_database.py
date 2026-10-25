import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app
from db import connect


class TestEmptyDatabase(unittest.TestCase):
    def test_opt_in_creates_empty_schema(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {"SMARTLAB_ALLOW_EMPTY_DB": "1"}):
            db_path = Path(tmp) / "fresh" / "cabinet.db"
            app = create_app(db_path=db_path, start_hardware=False)

            with app.test_client() as client:
                self.assertEqual(client.get("/api/health").status_code, 200)
                self.assertEqual(client.get("/api/components").status_code, 401)

            conn = connect(db_path)
            try:
                tables = {
                    row["name"]
                    for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
                }
                self.assertTrue({"students", "components", "issues", "users"}.issubset(tables))
                for table in ("students", "components", "issues", "users"):
                    self.assertEqual(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0)
            finally:
                conn.close()


if __name__ == "__main__":
    unittest.main()

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db import _PostgresConnection, _PostgresRow


class TestPostgresCompatibility(unittest.TestCase):
    def test_named_and_positional_parameters_are_translated(self):
        self.assertEqual(
            _PostgresConnection._prepare_query("SELECT :today, :id", {"today": "date", "id": 1}),
            "SELECT %(today)s, %(id)s",
        )
        self.assertEqual(
            _PostgresConnection._prepare_query("SELECT ? FROM students WHERE student_id=?", (1, 2)),
            "SELECT %s FROM students WHERE student_id=%s",
        )

    def test_sqlite_date_functions_are_translated_for_postgres(self):
        query = "SELECT date(issue_date,'localtime'), julianday(:today) - julianday(substr(expected_return_date,1,10))"
        prepared = _PostgresConnection._prepare_query(query, {"today": "2026-10-26"})
        self.assertIn("to_char((issue_date)::timestamp AT TIME ZONE 'UTC'", prepared)
        self.assertIn("EXTRACT(EPOCH FROM ((substr(expected_return_date,1,10))::timestamp AT TIME ZONE 'UTC'))", prepared)
        self.assertIn("%(today)s", prepared)

    def test_generated_primary_key_is_returned_only_when_needed(self):
        query, returns_id = _PostgresConnection._add_generated_key(
            "INSERT INTO students (roll_no, full_name) VALUES (?, ?)"
        )
        self.assertTrue(returns_id)
        self.assertTrue(query.endswith("RETURNING student_id"))

        query, returns_id = _PostgresConnection._add_generated_key(
            "INSERT INTO students (student_id, roll_no) VALUES (?, ?)"
        )
        self.assertFalse(returns_id)
        self.assertNotIn("RETURNING", query)

    def test_postgres_row_supports_sqlite_style_index_access(self):
        row = _PostgresRow({"student_id": 7, "full_name": "Example"})
        self.assertEqual(row[0], 7)
        self.assertEqual(row["full_name"], "Example")
        self.assertEqual(dict(row), {"student_id": 7, "full_name": "Example"})


if __name__ == "__main__":
    unittest.main(verbosity=2)

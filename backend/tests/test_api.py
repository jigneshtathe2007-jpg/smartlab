"""Run:  python -m unittest discover -s tests -v   (uses a temporary COPY of the database)"""
import shutil
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config
from app import create_app
from db import connect
from werkzeug.security import generate_password_hash


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.db_file = Path(cls.tmp) / "test.db"
        shutil.copy(config.BASE_DIR / "cabinet.db", cls.db_file)
        cls.app = create_app(cls.db_file, start_hardware=False)
        cls.c = cls.app.test_client()
        conn = connect(cls.db_file)
        conn.execute("INSERT OR IGNORE INTO users (username,password_hash,role) VALUES ('admin',?,'admin')", (generate_password_hash("adminpass1"),))
        conn.close()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def login(self, u, p):
        r = self.c.post("/api/auth/login", json={"username": u, "password": p})
        self.assertEqual(r.status_code, 200, r.get_json())
        return {"Authorization": "Bearer " + r.get_json()["token"]}


class TestSmartLab(Base):
    def test_01_auth(self):
        self.assertEqual(self.c.get("/api/components").status_code, 401)
        self.assertEqual(self.c.post("/api/auth/login", json={"username": "admin", "password": "x"}).status_code, 401)
        self.admin = self.login("admin", "adminpass1")

    def test_02_full_flow(self):
        admin = self.login("admin", "adminpass1")
        # register a student
        r = self.c.post("/api/auth/register", json={"username": "stu1", "password": "studentpw1", "roll_no": "CO200", "full_name": "Test Stu", "department": "Computer Engineering"})
        self.assertEqual(r.status_code, 201, r.get_json())
        stu = {"Authorization": "Bearer " + r.get_json()["token"]}
        sid = r.get_json()["user"]["student_id"]
        # student cannot use admin endpoints
        self.assertEqual(self.c.get("/api/students", headers=stu).status_code, 403)
        self.assertEqual(self.c.get("/api/reports/summary", headers=stu).status_code, 403)
        # list components; pick an available one
        comps = self.c.get("/api/components", headers=stu).get_json()["components"]
        avail = next(c for c in comps if c["status"] == "AVAILABLE")
        issued = next(c for c in comps if c["status"] == "ISSUED")
        self.assertIsNone(issued["holder_name"])          # hidden from students
        self.assertIsNotNone(issued["expected_return_date"])
        due = (date.today() + timedelta(days=5)).isoformat()
        # validation
        bad = self.c.post("/api/issues/borrow", headers=stu, json={"component_id": avail["component_id"], "expected_return_date": "2020-01-01"})
        self.assertEqual(bad.status_code, 422)
        # borrow ok (no hardware -> honest failure report)
        r = self.c.post("/api/issues/borrow", headers=stu, json={"component_id": avail["component_id"], "expected_return_date": due, "purpose": "Project", "unlock": True})
        self.assertEqual(r.status_code, 201, r.get_json())
        hw = r.get_json()["hardware"]
        self.assertTrue(hw["requested"]); self.assertFalse(hw["ok"])
        iid = r.get_json()["issue"]["issue_id"]
        # duplicate borrow blocked
        r2 = self.c.post("/api/issues/borrow", headers=admin, json={"component_id": avail["component_id"], "student_id": 1, "expected_return_date": due})
        self.assertEqual(r2.status_code, 409)
        # already-issued sample component blocked
        r3 = self.c.post("/api/issues/borrow", headers=stu, json={"component_uid": issued["rfid_uid"], "expected_return_date": due})
        self.assertEqual(r3.status_code, 409)
        # another student cannot return it
        self.c.post("/api/auth/register", json={"username": "stu2", "password": "studentpw2", "roll_no": "CO201", "full_name": "Other"})
        stu2 = self.login("stu2", "studentpw2")
        self.assertEqual(self.c.post("/api/issues/return", headers=stu2, json={"issue_id": iid}).status_code, 403)
        # student sees only own loans
        mine = self.c.get("/api/issues?status=active", headers=stu).get_json()
        self.assertEqual([i["issue_id"] for i in mine["issues"]], [iid])
        # dashboard for both roles
        self.assertEqual(self.c.get("/api/dashboard", headers=stu).get_json()["my_total"], 1)
        d = self.c.get("/api/dashboard", headers=admin).get_json()
        self.assertEqual(d["active_loans"], 2)
        # return
        r = self.c.post("/api/issues/return", headers=stu, json={"issue_id": iid})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(self.c.post("/api/issues/return", headers=stu, json={"issue_id": iid}).status_code, 409)
        c = self.c.get(f"/api/components?search={avail['name']}", headers=admin).get_json()["components"][0]
        self.assertEqual(c["status"], "AVAILABLE")
        # view stays consistent
        conn = connect(self.db_file)
        n = conn.execute("SELECT COUNT(*) FROM current_status WHERE status='ISSUED' AND issued_to IS NULL").fetchone()[0]
        self.assertEqual(n, 0)

    def test_03_overdue_and_reports(self):
        admin = self.login("admin", "adminpass1")
        conn = connect(self.db_file)
        conn.execute("UPDATE issues SET expected_return_date=? WHERE returned=0", ((date.today() - timedelta(days=3)).isoformat(),))
        conn.close()
        od = self.c.get("/api/issues?status=overdue", headers=admin).get_json()
        self.assertGreaterEqual(od["total"], 1)
        self.assertGreaterEqual(od["issues"][0]["days_overdue"], 3)
        # overdue student blocked from new loans
        comps = self.c.get("/api/components?status=AVAILABLE", headers=admin).get_json()["components"]
        due = (date.today() + timedelta(days=2)).isoformat()
        r = self.c.post("/api/issues/borrow", headers=admin, json={"component_id": comps[0]["component_id"], "student_id": od["issues"][0]["student_id"], "expected_return_date": due})
        self.assertEqual(r.status_code, 409)
        s = self.c.get("/api/reports/summary?days=30", headers=admin).get_json()
        self.assertIn("daily", s); self.assertGreaterEqual(len(s["overdue"]), 1)
        csv = self.c.get("/api/reports/export?type=issues", headers=admin)
        self.assertEqual(csv.status_code, 200); self.assertIn("text/csv", csv.content_type)

    def test_04_crud_and_hardware(self):
        admin = self.login("admin", "adminpass1")
        r = self.c.post("/api/components", headers=admin, json={"rfid_uid": "de:ad:be:ef", "name": "LDR Sensor", "category": "Sensor"})
        self.assertEqual(r.status_code, 201, r.get_json())
        self.assertEqual(r.get_json()["component"]["rfid_uid"], "DEADBEEF")
        self.assertEqual(self.c.post("/api/components", headers=admin, json={"rfid_uid": "DEADBEEF", "name": "dup"}).status_code, 409)
        self.assertEqual(self.c.post("/api/components", headers=admin, json={"rfid_uid": "zz", "name": "bad"}).status_code, 422)
        cid = r.get_json()["component"]["component_id"]
        self.assertEqual(self.c.delete(f"/api/components/{cid}", headers=admin).status_code, 200)
        st = self.c.get("/api/hardware/status", headers=admin).get_json()
        self.assertFalse(st["connected"])
        self.assertEqual(self.c.post("/api/hardware/unlock", headers=admin, json={}).status_code, 503)
        lk = self.c.get("/api/lookup/11AA22BB", headers=admin).get_json()
        self.assertEqual(lk["resolved"]["type"], "component")
        self.assertEqual(self.c.get("/api/lookup/FFFFFFFF", headers=admin).get_json()["resolved"]["type"], "unknown")

    def test_05_activity_audit(self):
        admin = self.login("admin", "adminpass1")
        self.assertEqual(self.c.get("/api/activity").status_code, 401)
        student = self.login("stu1", "studentpw1")
        self.assertEqual(self.c.get("/api/activity", headers=student).status_code, 403)

        created = self.c.post(
            "/api/components",
            headers=admin,
            json={"rfid_uid": "a0d17001", "name": "Audit Test Component", "category": "Test"},
        )
        self.assertEqual(created.status_code, 201, created.get_json())
        with patch.object(self.app.extensions["hardware"], "unlock", return_value={"ok": True, "message": "unlocked"}):
            opened = self.c.post("/api/hardware/unlock", headers=admin, json={})
        self.assertEqual(opened.status_code, 200, opened.get_json())

        events = self.c.get("/api/activity?search=Audit%20Test%20Component", headers=admin).get_json()
        self.assertEqual(events["total"], 1)
        self.assertEqual(events["events"][0]["action"], "created")
        self.assertEqual(events["events"][0]["actor_username"], "admin")
        self.assertEqual(events["opened"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)

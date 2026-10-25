import shutil
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config
from app import create_app
from bridge import HardwareRelay
from db import connect
from werkzeug.security import generate_password_hash


class TestHardwareRelay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.db_path = Path(cls.tmp) / "bridge.db"
        shutil.copy(config.BASE_DIR / "cabinet.db", cls.db_path)
        cls.relay = HardwareRelay()
        cls.app = create_app(cls.db_path, start_hardware=False, hardware_manager=cls.relay)
        cls.app.config["TESTING"] = True
        conn = connect(cls.db_path)
        conn.execute(
            "INSERT OR IGNORE INTO users (username,password_hash,role) VALUES ('bridgeadmin',?,'admin')",
            (generate_password_hash("bridgepass1"),),
        )
        conn.execute(
            "INSERT OR IGNORE INTO components (rfid_uid, name) VALUES ('DEADBEEF', 'Bridge test component')"
        )
        conn.close()
        response = cls.app.test_client().post(
            "/api/auth/login", json={"username": "bridgeadmin", "password": "bridgepass1"}
        )
        cls.admin = {"Authorization": "Bearer " + response.get_json()["token"]}

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_bridge_requires_admin_and_relays_status_and_scans(self):
        client = self.app.test_client()
        payload = {
            "status": {
                "connected": True,
                "port": "COM5",
                "baud": 9600,
                "rfid_reader": True,
                "servo": "LOCKED",
                "pyserial_installed": True,
                "available_ports": ["COM5"],
            },
            "scans": [{"id": 1, "uid": "de:ad:be:ef", "ts": 123.0}],
            "results": [],
        }
        self.assertEqual(client.post("/api/hardware/bridge/poll", json=payload).status_code, 401)
        response = client.post("/api/hardware/bridge/poll", headers=self.admin, json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"commands": []})
        status = client.get("/api/hardware/status", headers=self.admin).get_json()
        self.assertTrue(status["connected"])
        self.assertEqual(status["port"], "COM5")
        scans = client.get("/api/hardware/scans?after=0", headers=self.admin).get_json()
        self.assertEqual(scans["scans"][0]["uid"], "DEADBEEF")
        self.assertEqual(scans["scans"][0]["resolved"]["component"]["rfid_uid"], "DEADBEEF")

    def test_unlock_waits_for_bridge_acknowledgement(self):
        result = {}

        def unlock():
            result.update(self.relay.unlock(5))

        worker = threading.Thread(target=unlock)
        worker.start()
        deadline = time.time() + 2
        command = None
        while time.time() < deadline and command is None:
            response = self.relay.publish({"status": {"connected": True}, "scans": [], "results": []})
            if response["commands"]:
                command = response["commands"][0]
        self.assertIsNotNone(command)
        self.assertEqual(command["type"], "unlock")
        self.relay.publish(
            {
                "status": {"connected": True},
                "scans": [],
                "results": [{"id": command["id"], "result": {"ok": True, "message": "Cabinet unlocked for 5 s"}}],
            }
        )
        worker.join(timeout=2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(result, {"ok": True, "message": "Cabinet unlocked for 5 s"})


if __name__ == "__main__":
    unittest.main(verbosity=2)

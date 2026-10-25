"""Protocol test for hardware.py using a pseudo-terminal that emulates the firmware's replies.
This only verifies the PC-side code (handshake, UID parsing, unlock acknowledgement, disconnect
detection). It does NOT replace testing with the real Arduino. Run:
    python -m unittest tests.test_serial_protocol -v     (Linux/macOS only)
"""
import os
import sys
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import pty
except ImportError:  # Windows
    pty = None

from hardware import HardwareManager


class FakeFirmware(threading.Thread):
    def __init__(self, master, ack_unlock=True):
        super().__init__(daemon=True)
        self.master, self.ack_unlock, self.stop_flag = master, ack_unlock, False
        self.servo = "LOCKED"

    def send(self, line):
        os.write(self.master, (line + "\n").encode())

    def run(self):
        buf = b""
        last_hb = 0
        os.set_blocking(self.master, False)
        while not self.stop_flag:
            try:
                buf += os.read(self.master, 256)
            except (BlockingIOError, OSError):
                pass
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                cmd = line.decode().strip()
                if cmd == "PING":
                    self.send(f"PONG:SMARTLAB:RFID=OK:SERVO={self.servo}")
                elif cmd.startswith("UNLOCK") and self.ack_unlock:
                    self.servo = "UNLOCKED"
                    self.send("ACK:UNLOCKED")
            if time.time() - last_hb > 1:
                last_hb = time.time()
                self.send(f"HB:RFID=OK:SERVO={self.servo}")
            time.sleep(0.02)


@unittest.skipIf(pty is None, "pty not available")
class TestProtocol(unittest.TestCase):
    def setUp(self):
        self.master, slave = pty.openpty()
        self.port = os.ttyname(slave)
        self.slave = slave
        self.fw = FakeFirmware(self.master)
        self.fw.start()
        self.hw = HardwareManager(self.port, 9600)

    def tearDown(self):
        self.hw.stop(); self.fw.stop_flag = True
        os.close(self.slave); os.close(self.master)

    def wait_connected(self, timeout=12):
        end = time.time() + timeout
        while time.time() < end and not self.hw.status()["connected"]:
            time.sleep(0.2)
        return self.hw.status()["connected"]

    def test_handshake_scan_unlock(self):
        self.assertFalse(self.hw.unlock(3)["ok"])            # not started -> honest failure
        self.hw.start()
        self.assertTrue(self.wait_connected(), self.hw.status())
        st = self.hw.status()
        self.assertTrue(st["rfid_reader"]); self.assertEqual(st["servo"], "LOCKED")
        before = self.hw.latest_scan_id()
        self.fw.send("UID:A1B2C3D4")
        time.sleep(0.8)
        scans = self.hw.scans_after(before)
        self.assertEqual([s["uid"] for s in scans], ["A1B2C3D4"])
        res = self.hw.unlock(3)
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.hw.status()["servo"], "UNLOCKED")

    def test_no_ack_is_failure(self):
        self.fw.ack_unlock = False
        self.hw.start()
        self.assertTrue(self.wait_connected())
        res = self.hw.unlock(3)
        self.assertFalse(res["ok"])                          # never report success without an ACK

    def test_wrong_device_not_connected(self):
        self.fw.stop_flag = True; time.sleep(0.3)           # silent device -> handshake must fail
        self.hw.start(); time.sleep(7)
        st = self.hw.status()
        self.assertFalse(st["connected"]); self.assertIn("did not respond", st["last_error"] or "")


if __name__ == "__main__":
    unittest.main(verbosity=2)

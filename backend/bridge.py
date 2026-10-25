import threading
import time
import uuid
from collections import deque

from utils import normalize_uid


BRIDGE_TIMEOUT = 12
COMMAND_TIMEOUT = 10


class HardwareRelay:
    """In-memory hardware state and commands relayed by an authenticated local agent."""

    def __init__(self):
        self._condition = threading.Condition()
        self._state = {
            "connected": False,
            "port": None,
            "baud": None,
            "rfid_reader": None,
            "servo": None,
            "last_seen": None,
            "last_error": "Hardware connector is not running",
            "pyserial_installed": True,
            "available_ports": [],
        }
        self._scans = deque(maxlen=200)
        self._scan_id = 0
        self._commands = deque()
        self._pending = {}

    def status(self):
        with self._condition:
            result = dict(self._state)
            if result["last_seen"] is None or time.time() - result["last_seen"] > BRIDGE_TIMEOUT:
                result.update(
                    connected=False,
                    rfid_reader=None,
                    servo=None,
                    last_error="Hardware connector is offline",
                )
            return result

    def latest_scan_id(self):
        with self._condition:
            return self._scan_id

    def scans_after(self, after_id):
        with self._condition:
            return [dict(scan) for scan in self._scans if scan["id"] > after_id]

    def unlock(self, seconds=5):
        with self._condition:
            if not self._is_online():
                return {"ok": False, "message": "Hardware connector is offline - cabinet was not opened"}
            command_id = uuid.uuid4().hex
            pending = {"event": threading.Event(), "result": None}
            self._pending[command_id] = pending
            self._commands.append(
                {"id": command_id, "type": "unlock", "seconds": int(seconds), "expires_at": time.time() + COMMAND_TIMEOUT}
            )
            self._condition.notify_all()

        completed = pending["event"].wait(COMMAND_TIMEOUT)
        with self._condition:
            self._pending.pop(command_id, None)
            if completed and pending["result"] is not None:
                return pending["result"]
        return {"ok": False, "message": "Hardware connector did not acknowledge the command - cabinet was not opened"}

    def reconnect(self):
        with self._condition:
            if not self._is_online():
                return self.status()
            self._commands.append({"id": uuid.uuid4().hex, "type": "reconnect", "expires_at": time.time() + COMMAND_TIMEOUT})
            self._condition.notify_all()
        return self.status()

    def publish(self, payload):
        """Accept one connector heartbeat, scan batch, and command-result batch."""
        status = payload.get("status")
        scans = payload.get("scans", [])
        results = payload.get("results", [])
        if not isinstance(status, dict) or not isinstance(scans, list) or len(scans) > 100:
            raise ValueError("Invalid hardware connector update")
        if not isinstance(results, list) or len(results) > 20:
            raise ValueError("Invalid hardware connector results")

        with self._condition:
            self._state.update(
                connected=bool(status.get("connected")),
                port=status.get("port"),
                baud=status.get("baud"),
                rfid_reader=status.get("rfid_reader"),
                servo=status.get("servo"),
                last_seen=time.time(),
                last_error=status.get("last_error"),
                pyserial_installed=bool(status.get("pyserial_installed", True)),
                available_ports=status.get("available_ports", []),
            )
            for scan in scans:
                if not isinstance(scan, dict) or not isinstance(scan.get("uid"), str):
                    continue
                self._scan_id += 1
                self._scans.append(
                    {
                        "id": self._scan_id,
                        "uid": normalize_uid(scan["uid"]),
                        "ts": scan.get("ts", time.time()),
                    }
                )
            for result in results:
                if not isinstance(result, dict) or not isinstance(result.get("id"), str):
                    continue
                pending = self._pending.get(result["id"])
                result_body = result.get("result")
                if pending is not None and isinstance(result_body, dict):
                    pending["result"] = {
                        "ok": bool(result_body.get("ok")),
                        "message": str(result_body.get("message", "Hardware command failed")),
                    }
                    pending["event"].set()
            self._condition.notify_all()

            deadline = time.monotonic() + 2
            while not self._commands:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self._condition.wait(remaining)

            now = time.time()
            commands = []
            while self._commands and len(commands) < 10:
                command = self._commands.popleft()
                if command["expires_at"] > now:
                    commands.append({key: value for key, value in command.items() if key != "expires_at"})
            return {"commands": commands}

    def _is_online(self):
        return self._state["last_seen"] is not None and time.time() - self._state["last_seen"] <= BRIDGE_TIMEOUT and self._state["connected"]

"""Real serial link to the Arduino Uno (MFRC522 + servo latch).

Nothing here is simulated: "connected" only becomes true after the firmware answers a
PING handshake, and a servo unlock is only reported successful when the Arduino sends
an ACK:UNLOCKED line back.

Serial protocol (9600 baud, newline terminated)
  Arduino -> PC   READY:SMARTLAB
                  HB:RFID=OK|FAIL:SERVO=LOCKED|UNLOCKED   (every 2 s)
                  PONG:SMARTLAB:RFID=..:SERVO=..          (reply to PING)
                  UID:A1B2C3D4                            (a card was read)
                  ACK:UNLOCKED / ACK:LOCKED / ERR:<reason>
  PC -> Arduino   PING | UNLOCK:<seconds> | LOCK | STATUS
"""
import threading
import time
from collections import deque

try:
    import serial
    from serial.tools import list_ports
except ImportError:  # pragma: no cover
    serial = None
    list_ports = None

HEARTBEAT_TIMEOUT = 7.0   # seconds without any line from the Arduino -> treat as disconnected
HANDSHAKE_TIMEOUT = 4.0


class HardwareManager:
    def __init__(self, port="auto", baud=9600, enabled=True):
        self.port_setting = port
        self.baud = baud
        self.enabled = enabled
        self._ser = None
        self._lock = threading.Lock()          # protects state
        self._cmd_lock = threading.Lock()      # serialises commands
        self._stop = threading.Event()
        self._thread = None
        self._ack = threading.Event()
        self._ack_kind = None
        self._scans = deque(maxlen=50)
        self._scan_counter = 0
        self.state = {
            "connected": False, "port": None, "baud": baud, "rfid_reader": None,
            "servo": None, "last_seen": None, "last_error": None, "pyserial_installed": serial is not None,
        }
        if serial is None:
            self.state["last_error"] = "pyserial is not installed (pip install pyserial)"

    # ---- lifecycle -------------------------------------------------------------------------
    def start(self):
        if not self.enabled or serial is None or self._thread:
            return
        self._thread = threading.Thread(target=self._run, name="hardware", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        self._close()

    def reconnect(self):
        self._close()
        return self.status()

    # ---- public API ------------------------------------------------------------------------
    def status(self):
        with self._lock:
            s = dict(self.state)
        s["available_ports"] = [p.device for p in list_ports.comports()] if list_ports else []
        return s

    def scans_after(self, after_id):
        with self._lock:
            return [s for s in self._scans if s["id"] > after_id]

    def latest_scan_id(self):
        with self._lock:
            return self._scan_counter

    def unlock(self, seconds=5):
        """Open the latch. Returns {ok, message}; ok is True only after the Arduino acknowledged."""
        with self._cmd_lock:
            if not self.state["connected"] or self._ser is None:
                return {"ok": False, "message": "Arduino is not connected - cabinet was not opened"}
            if self.state["servo"] == "UNLOCKED":
                pass  # still send; firmware extends the timer
            self._ack.clear()
            self._ack_kind = None
            try:
                self._write(f"UNLOCK:{int(seconds)}")
            except Exception as exc:  # serial error
                self._mark_disconnected(f"Write failed: {exc}")
                return {"ok": False, "message": "Serial write failed - cabinet was not opened"}
            if self._ack.wait(2.5) and self._ack_kind == "UNLOCKED":
                return {"ok": True, "message": f"Cabinet unlocked for {int(seconds)} s"}
            return {"ok": False, "message": "Arduino did not acknowledge the unlock command"}

    # ---- internals -------------------------------------------------------------------------
    def _write(self, line):
        self._ser.write((line + "\n").encode())
        self._ser.flush()

    def _close(self):
        with self._lock:
            ser, self._ser = self._ser, None
        if ser is not None:
            try:
                ser.close()
            except Exception:
                pass
        with self._lock:
            self.state.update(connected=False, rfid_reader=None, servo=None)

    def _mark_disconnected(self, err=None):
        self._close()
        if err:
            with self._lock:
                self.state["last_error"] = err

    def _candidate_ports(self):
        if self.port_setting and self.port_setting.lower() != "auto":
            return [self.port_setting]
        ports = list(list_ports.comports())
        def score(p):
            d = f"{p.description} {p.manufacturer} {p.hwid}".lower()
            return 0 if any(k in d for k in ("arduino", "ch340", "ch341", "usb serial", "usb-serial", "2341")) else 1
        return [p.device for p in sorted(ports, key=score)]

    def _try_open(self, device):
        ser = serial.Serial(device, self.baud, timeout=0.25, write_timeout=2)
        time.sleep(2.2)  # Uno resets when the port opens
        ser.reset_input_buffer()
        deadline = time.time() + HANDSHAKE_TIMEOUT
        next_ping = 0
        while time.time() < deadline:
            if time.time() >= next_ping:
                ser.write(b"PING\n")
                next_ping = time.time() + 1.0
            line = ser.readline().decode(errors="ignore").strip()
            if line.startswith("PONG:SMARTLAB") or line.startswith("HB:"):
                self._ser = ser
                self._apply_status_line(line)
                with self._lock:
                    self.state.update(connected=True, port=device, last_error=None, last_seen=time.time())
                return True
        ser.close()
        raise RuntimeError(f"{device} did not respond like the SmartLab firmware")

    def _apply_status_line(self, line):
        parts = line.split(":")
        for p in parts:
            if p.startswith("RFID="):
                self.state["rfid_reader"] = p[5:] == "OK"
            elif p.startswith("SERVO="):
                self.state["servo"] = p[6:]

    def _handle_line(self, line):
        now = time.time()
        with self._lock:
            self.state["last_seen"] = now
            if line.startswith("UID:"):
                self._scan_counter += 1
                self._scans.append({"id": self._scan_counter, "uid": line[4:].strip().upper(), "ts": now})
            elif line.startswith(("HB:", "PONG:")):
                self._apply_status_line(line)
            elif line == "ACK:UNLOCKED":
                self.state["servo"] = "UNLOCKED"
                self._ack_kind = "UNLOCKED"
                self._ack.set()
            elif line == "ACK:LOCKED":
                self.state["servo"] = "LOCKED"
                self._ack_kind = "LOCKED"
                self._ack.set()
            elif line.startswith("ERR:"):
                self.state["last_error"] = line[4:]
                self._ack_kind = "ERR"
                self._ack.set()

    def _run(self):
        while not self._stop.is_set():
            if self._ser is None:
                errors = []
                for dev in self._candidate_ports():
                    if self._stop.is_set():
                        return
                    try:
                        if self._try_open(dev):
                            break
                    except Exception as exc:
                        errors.append(str(exc))
                if self._ser is None:
                    with self._lock:
                        self.state["last_error"] = errors[-1] if errors else "No serial ports found - plug in the Arduino"
                    self._stop.wait(3.0)
                continue
            try:
                raw = self._ser.readline()
                if raw:
                    self._handle_line(raw.decode(errors="ignore").strip())
                elif time.time() - (self.state["last_seen"] or 0) > HEARTBEAT_TIMEOUT:
                    self._mark_disconnected("Lost heartbeat from Arduino")
            except Exception as exc:
                self._mark_disconnected(f"Serial error: {exc}")
                self._stop.wait(1.0)

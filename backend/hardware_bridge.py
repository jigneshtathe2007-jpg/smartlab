"""Run on the computer connected to the Arduino to relay hardware to SmartLab."""
import argparse
import getpass
import json
import sys
import time
import urllib.error
import urllib.request

from hardware import HardwareManager


class AuthenticationExpired(Exception):
    pass


def post_json(server, path, payload, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        server.rstrip("/") + path,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=75) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 401 and token:
            raise AuthenticationExpired from exc
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"SmartLab returned HTTP {exc.code}: {detail}") from exc


def login(server, username):
    password = getpass.getpass(f"SmartLab password for {username}: ")
    result = post_json(server, "/api/auth/login", {"username": username, "password": password})
    return result["token"]


def run(server, username, serial_port):
    manager = HardwareManager(port=serial_port)
    manager.start()
    token = login(server, username)
    scan_cursor = 0
    results = []
    print(f"Connected to SmartLab at {server}. Waiting for the Arduino; press Ctrl+C to stop.")

    try:
        while True:
            status = manager.status()
            scans = manager.scans_after(scan_cursor)
            payload = {"status": status, "scans": scans, "results": results}
            try:
                response = post_json(server, "/api/hardware/bridge/poll", payload, token)
                results = []
                if scans:
                    scan_cursor = scans[-1]["id"]
            except AuthenticationExpired:
                print("SmartLab session expired; sign in again to keep the hardware connected.")
                token = login(server, username)
                continue
            except (OSError, RuntimeError, ValueError) as exc:
                print(f"SmartLab connection unavailable: {exc}", file=sys.stderr)
                time.sleep(3)
                continue

            for command in response.get("commands", []):
                if command.get("type") == "unlock":
                    result = manager.unlock(command.get("seconds", 5))
                    results.append({"id": command["id"], "result": result})
                elif command.get("type") == "reconnect":
                    manager.reconnect()
    except KeyboardInterrupt:
        print("\nStopping hardware connector.")
    finally:
        manager.stop()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", required=True, help="SmartLab URL, for example https://smartlab-7387.onrender.com")
    parser.add_argument("--username", default="admin", help="SmartLab administrator username (default: admin)")
    parser.add_argument("--port", default="auto", help="Arduino serial port, or auto (default: auto)")
    args = parser.parse_args()

    if not args.server.startswith("https://") and not args.server.startswith("http://localhost"):
        parser.error("--server must use HTTPS")
    run(args.server, args.username, args.port)


if __name__ == "__main__":
    main()

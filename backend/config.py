"""Central configuration. Everything can be overridden with environment variables."""
import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent

# Local SQLite database; use SMARTLAB_DATABASE_URL for persistent PostgreSQL hosting.
DB_PATH = Path(os.environ.get("SMARTLAB_DB", BASE_DIR / "cabinet.db"))
DATABASE_URL = os.environ.get("SMARTLAB_DATABASE_URL")

# Serial port of the Arduino. "auto" = scan all ports and handshake with the firmware.
SERIAL_PORT = os.environ.get("SMARTLAB_SERIAL_PORT", "auto")
SERIAL_BAUD = int(os.environ.get("SMARTLAB_BAUD", "9600"))
UNLOCK_SECONDS = int(os.environ.get("SMARTLAB_UNLOCK_SECONDS", "5"))

# Borrowing policy
MAX_LOAN_DAYS = int(os.environ.get("SMARTLAB_MAX_LOAN_DAYS", "90"))
MAX_ACTIVE_LOANS = int(os.environ.get("SMARTLAB_MAX_ACTIVE_LOANS", "5"))
BLOCK_BORROW_IF_OVERDUE = os.environ.get("SMARTLAB_BLOCK_IF_OVERDUE", "1") == "1"

TOKEN_TTL_SECONDS = int(os.environ.get("SMARTLAB_TOKEN_TTL", str(12 * 3600)))

FRONTEND_DIST = PROJECT_DIR / "frontend" / "dist"


def load_secret_key() -> str:
    """Use SMARTLAB_SECRET if set, otherwise create and persist a random key (never hard-coded)."""
    env = os.environ.get("SMARTLAB_SECRET")
    if env:
        return env
    key_file = BASE_DIR / ".secret_key"
    if key_file.exists():
        return key_file.read_text().strip()
    key = secrets.token_hex(32)
    key_file.write_text(key)
    try:
        key_file.chmod(0o600)
    except OSError:
        pass
    return key

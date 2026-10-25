# SmartLab - RFID Smart Cabinet Management System

React + TypeScript + Tailwind frontend, Flask REST backend, your existing **SQLite** database, and an
**Arduino Uno + MFRC522 + servo latch** connected over USB serial.

```
smartlab/
├── backend/            Flask API, serial manager, auth, tests
│   ├── app.py          entry point (also serves the built frontend)
│   ├── cabinet.db      YOUR existing database (students / components / issues / current_status)
│   ├── create_admin.py creates the first administrator
│   └── routes/ hardware.py db.py auth.py ...
├── frontend/           React app (src/) + prebuilt dist/
└── firmware/smartlab_cabinet/smartlab_cabinet.ino   Arduino sketch
```

## Deploying on Render

The included `render.yaml` configures a public Render web service, builds the React frontend,
uses Gunicorn for Flask, generates a private `SMARTLAB_SECRET`, and stores SQLite on a persistent
disk. The persistent disk requires a paid Render service. The cloud service deliberately does not
start the serial hardware manager: an Arduino connected to your computer is not reachable from
Render.

1. Push this repository to the GitHub account connected to Render, then create a **Blueprint**
   in Render using this repository and `render.yaml`. This provisions the web service and disk.
2. Transfer your existing `backend/cabinet.db` privately to the service's persistent disk at
   `/var/data/cabinet.db`; do not commit or otherwise publish the database. It may contain student
   records and password hashes. The app will not start successfully until this file is present.
3. Deploy or redeploy the service. Render assigns its public URL; sign in with an existing
   administrator account from the migrated database.

Keep the generated `SMARTLAB_SECRET` private and back up the persistent disk regularly. The
cloud app can manage records and loans, but RFID scans and latch control require the backend to
run on a computer connected to the Arduino.

## 1. Run it (Windows / macOS / Linux)

Requires **Python 3.10+**. Node.js is only needed if you want to change the UI.

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate        macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
python create_admin.py          # asks for an admin username + password
python app.py                   # open http://localhost:5000
```

`frontend/dist` is already built, so nothing else is required. To use another database file:
`SMARTLAB_DB=/path/to/cabinet.db python app.py` (PowerShell: `$env:SMARTLAB_DB="C:\path\cabinet.db"`).

### Developing the UI
```bash
cd frontend && npm install
npm run dev        # http://localhost:5173 (proxies /api to Flask on :5000)
npm run build      # rebuilds frontend/dist
```

## 2. What was changed in your database

The three tables and the view are used **as they are**. On start-up the backend only *adds*:

| Addition | Why |
|---|---|
| `users` table (username, password hash, role, optional `student_id` FK) | logins and admin/student roles; your schema has nowhere to store passwords |
| unique partial index `uq_issues_one_open_per_component` on `issues(component_id) WHERE returned=0` | the database itself refuses two open loans of one component, even under race conditions |
| index `idx_issues_returned_due` | faster overdue queries |

No rows are inserted or modified at start-up. Your sample rows (Sample Student, 4 components, 1 loan) are still there -
delete them from the app once you have real data.

## 3. Roles

| | Admin | Student |
|---|---|---|
| Dashboard | whole lab | own loans |
| Scanner / borrow / return | any student, any component | self only |
| Components | add / edit / delete, see who holds what | view, borrow, return own; sees due dates but **not** who holds an item |
| Students, Reports, CSV export, latch test | yes | no |

Admins create the first account with `create_admin.py`. Students can self-register on the login page
(or an admin can create/reset their login on the Students page).

## 4. Connecting the Arduino

**Wiring** (the RC522 is **3.3 V only** - 5 V will damage it):

| RC522 | Uno | | Servo (SG90) | Uno |
|---|---|---|---|---|
| SDA (SS) | D10 | | Brown | GND |
| SCK | D13 | | Red | 5V |
| MOSI | D11 | | Orange/Yellow (signal) | D6 |
| MISO | D12 | | | |
| RST | D9 | | | |
| 3.3V | 3.3V | | | |
| GND | GND | | | |
| IRQ | not connected | | | |

Solder the header pins to the RC522. If the servo jitters or the Uno resets, power the servo from an
external 5 V supply and join its GND to the Uno's GND.

**Firmware**
1. Arduino IDE -> *Tools -> Manage Libraries* -> install **MFRC522** (by GithubCommunity).
2. Open `firmware/smartlab_cabinet/smartlab_cabinet.ino`, select *Arduino Uno* and your port, **Upload**.
3. Adjust `LOCKED_ANGLE` / `UNLOCKED_ANGLE` at the top if your latch needs different angles.
4. **Close the Arduino Serial Monitor** - only one program can use the port.
5. Start the backend. It scans serial ports, sends `PING` and only treats a device as connected when it answers
   `PONG:SMARTLAB`. To force a port: `SMARTLAB_SERIAL_PORT=COM5` (or `/dev/ttyACM0`).

Linux: `sudo usermod -a -G dialout $USER` then log out/in. Windows: install the CH340 driver if you have a clone board.

**Truthful hardware status** - the header pill, scanner page and dashboard show the real state:
*serial link*, *RC522 detected* (firmware reads the chip's version register), *latch locked/open*, and ports found.
A heartbeat arrives every 2 s; if it stops for 7 s the app marks the Arduino disconnected.

**When the servo moves** - only the backend can command it, and only
1. after a borrow/return transaction has been committed for an authenticated user who is allowed to do it
   (the "Open the cabinet latch" option), or
2. when an admin presses *Test latch*.

The result shown is what the Arduino reported: success requires an `ACK:UNLOCKED` reply. If the Arduino is offline the
loan is still recorded, the UI shows a warning that **the cabinet did not open**, and nothing pretends otherwise.
The firmware re-locks automatically after 5 s (`SMARTLAB_UNLOCK_SECONDS`).

## 5. Typical workflow

1. **Register tags:** Components -> *Add component* -> press **Scan** and tap a tag on the reader (UID fills in).
   Do the same for student ID cards on the Students page (optional).
2. **Issue:** RFID Scanner -> scan the component -> choose student, expected return date, purpose -> *Issue*.
3. **Return:** scan the component again -> *Confirm return* (mark Damaged if needed).
4. Anyone browsing Components sees an issued item's expected return date, so the next student knows when it is free.
5. Overdue items appear on **Overdue**, the dashboard and Reports. Students with overdue items cannot borrow more.

## 6. Policy settings (environment variables)

`SMARTLAB_MAX_LOAN_DAYS` (90), `SMARTLAB_MAX_ACTIVE_LOANS` (5), `SMARTLAB_BLOCK_IF_OVERDUE` (1),
`SMARTLAB_UNLOCK_SECONDS` (5), `SMARTLAB_BAUD` (9600), `SMARTLAB_TOKEN_TTL` (43200 s),
`SMARTLAB_SECRET` (otherwise a random key is generated into `backend/.secret_key` - keep it private).

## 7. API overview

`/api/auth/{login,register,me,change-password}` · `/api/students` · `/api/components` ·
`/api/issues` + `/borrow` + `/return` · `/api/lookup/<uid>` · `/api/hardware/{status,scans,unlock,reconnect}` ·
`/api/dashboard` · `/api/reports/{summary,export}`. All except login/register need `Authorization: Bearer <token>`.

## 8. Tests

```bash
cd backend
python -m unittest tests.test_api -v               # API, auth, duplicate-loan, overdue, reports (temp DB copy)
python -m unittest tests.test_serial_protocol -v   # serial protocol vs an emulated firmware (Linux/macOS)
```
The serial test only checks the PC-side code; confirm the real device with the checklist below.

## 9. Hardware verification checklist
- [ ] Header pill turns green with the port name (RFID reader "Detected" on the Scanner page)
- [ ] Tapping a tag shows its UID in *Recent scans* with source **Reader**
- [ ] Scanner -> *Test latch* (admin) moves the servo; status shows Open then Locked
- [ ] Unplug USB -> pill turns red within ~7 s, issue/return still record but warn the latch did not open

## Troubleshooting
| Symptom | Fix |
|---|---|
| "did not respond like the SmartLab firmware" | upload the sketch; close Serial Monitor; check baud 9600 |
| Connected but "Reader not detected" | recheck RC522 wiring and 3.3 V; SPI pins are fixed on the Uno |
| Tag UID has different length | any 4/7/10-byte UID works (8-20 hex chars) |
| Servo twitches / Uno resets | external 5 V supply for the servo, common GND |
| Port busy / permission denied | close other serial programs; Linux: `dialout` group |

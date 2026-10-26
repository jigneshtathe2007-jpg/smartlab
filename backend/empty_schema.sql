CREATE TABLE students (
    student_id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfid_uid TEXT UNIQUE,
    roll_no TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    department TEXT,
    year_sem TEXT,
    phone TEXT,
    email TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE components (
    component_id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfid_uid TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT,
    description TEXT,
    shelf_location TEXT,
    status TEXT NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'ISSUED', 'DAMAGED', 'LOST')),
    added_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE issues (
    issue_id INTEGER PRIMARY KEY AUTOINCREMENT,
    component_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    purpose TEXT,
    issue_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expected_return_date TEXT NOT NULL,
    actual_return_date TEXT,
    returned INTEGER NOT NULL DEFAULT 0 CHECK (returned IN (0, 1)),
    remarks TEXT,
    FOREIGN KEY (component_id) REFERENCES components(component_id),
    FOREIGN KEY (student_id) REFERENCES students(student_id)
);

CREATE TABLE activity_logs (
    activity_id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER,
    actor_name TEXT NOT NULL,
    actor_username TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    entity_name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE VIEW current_status AS
SELECT c.component_id, c.rfid_uid, c.name, c.status,
       s.full_name AS issued_to, s.roll_no, i.expected_return_date
FROM components c
LEFT JOIN issues i ON i.component_id = c.component_id AND i.returned = 0
LEFT JOIN students s ON s.student_id = i.student_id;

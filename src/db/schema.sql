-- Users table: one row per WhatsApp user
CREATE TABLE IF NOT EXISTS users (
    phone TEXT PRIMARY KEY,
    name TEXT,
    timezone TEXT DEFAULT 'Asia/Kolkata',
    created_at TEXT DEFAULT (datetime('now'))
);

-- Reminders table: each reminder the user sets
CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    message TEXT NOT NULL,
    remind_at TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    call_sid TEXT,
    call_status TEXT,
    follow_up_notes TEXT,
    audio_base64 TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (phone) REFERENCES users(phone)
);

-- Conversation history: stores messages so Claude has context
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (phone) REFERENCES users(phone)
);

-- Index: helps the scheduler quickly find due reminders
CREATE INDEX IF NOT EXISTS idx_reminders_due
    ON reminders(status, remind_at);

-- Index: helps load recent conversation for a user
CREATE INDEX IF NOT EXISTS idx_conversations_phone
    ON conversations(phone, created_at);

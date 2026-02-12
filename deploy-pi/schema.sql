-- StaticFund SQLite Schema
-- Raspberry Pi Zero 2W Deployment

-- Users table (authentication & profile)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT,
    province TEXT,
    city TEXT,
    monthly_spend REAL DEFAULT 0,
    monthly_budget REAL DEFAULT 0,
    household_size INTEGER,
    property_type TEXT,
    has_pool INTEGER DEFAULT 0,
    cooking_fuel TEXT,
    work_from_home INTEGER DEFAULT 0,
    latitude REAL,
    longitude REAL,
    onboarding_completed INTEGER DEFAULT 0
);

-- Devices table (electrical appliances)
CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    watts INTEGER NOT NULL,
    surge_watts INTEGER DEFAULT 0,
    image_url TEXT,
    user_id INTEGER REFERENCES users(id)
);

-- Usage logs (device usage tracking)
CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    hours_per_day REAL NOT NULL,
    days_per_week INTEGER DEFAULT 7,
    date TEXT DEFAULT (DATE('now'))
);

-- Habits table (gamification - daily goals)
CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    title TEXT NOT NULL,
    description TEXT,
    impact_level TEXT DEFAULT 'MEDIUM'
);

-- User habit logs (track habit completion)
CREATE TABLE IF NOT EXISTS user_habit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    habit_id INTEGER REFERENCES habits(id),
    date_completed TEXT DEFAULT (DATE('now'))
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_device_id ON usage_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_habits_user_id ON habits(user_id);
CREATE INDEX IF NOT EXISTS idx_user_habit_logs_user_id ON user_habit_logs(user_id);

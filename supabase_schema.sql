-- StaticFund Energy - Complete Database Schema for Supabase

-- Users table (authentication & profile)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    province VARCHAR(50),
    city VARCHAR(100),
    monthly_budget DECIMAL(10, 2) DEFAULT 0
);

-- Devices table (electrical appliances)
CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    watts INTEGER NOT NULL,
    surge_watts INTEGER DEFAULT 0,
    image_url TEXT,
    user_id INTEGER REFERENCES users(id)
);

-- Usage logs (device usage tracking)
CREATE TABLE IF NOT EXISTS usage_logs (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    hours_per_day NUMERIC(5, 2) NOT NULL,
    days_per_week INTEGER DEFAULT 7,
    date DATE DEFAULT CURRENT_DATE
);

-- Habits table (gamification - daily goals)
CREATE TABLE IF NOT EXISTS habits (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    impact_level VARCHAR(10) DEFAULT 'MEDIUM'
);

-- User habit logs (track habit completion)
CREATE TABLE IF NOT EXISTS user_habit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    habit_id INTEGER REFERENCES habits(id),
    date_completed DATE DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    watts INTEGER NOT NULL,
    image_url TEXT
);

CREATE TABLE IF NOT EXISTS usage_logs (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES devices(id),
    hours_per_day NUMERIC(5, 2) NOT NULL,
    days_per_week INTEGER DEFAULT 7,
    date DATE DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    province VARCHAR(50),
    city VARCHAR(100),
    monthly_budget DECIMAL(10, 2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS habits (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    impact_level VARCHAR(10) DEFAULT 'MEDIUM'
);

CREATE TABLE IF NOT EXISTS user_habit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    habit_id INTEGER REFERENCES habits(id),
    date_completed DATE DEFAULT CURRENT_DATE
);

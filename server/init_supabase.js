// Script to initialize Supabase database tables
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for Supabase
});

async function initSupabase() {
    console.log("Connecting to Supabase...");

    try {
        // Test connection
        const testResult = await pool.query('SELECT NOW()');
        console.log("✅ Connected! Server time:", testResult.rows[0].now);

        // Create tables
        console.log("Creating tables...");

        // Users
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255),
                province VARCHAR(50),
                city VARCHAR(100),
                monthly_budget DECIMAL(10, 2) DEFAULT 0
            );
        `);
        console.log("✅ users table ready");

        // Devices
        await pool.query(`
            CREATE TABLE IF NOT EXISTS devices (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                watts INTEGER NOT NULL,
                surge_watts INTEGER DEFAULT 0,
                image_url TEXT,
                user_id INTEGER REFERENCES users(id)
            );
        `);
        console.log("✅ devices table ready");

        // Usage logs
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usage_logs (
                id SERIAL PRIMARY KEY,
                device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
                hours_per_day NUMERIC(5, 2) NOT NULL,
                days_per_week INTEGER DEFAULT 7,
                date DATE DEFAULT CURRENT_DATE
            );
        `);
        console.log("✅ usage_logs table ready");

        // Habits
        await pool.query(`
            CREATE TABLE IF NOT EXISTS habits (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                title VARCHAR(255) NOT NULL,
                description TEXT,
                impact_level VARCHAR(10) DEFAULT 'MEDIUM'
            );
        `);
        console.log("✅ habits table ready");

        // User habit logs
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_habit_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                habit_id INTEGER REFERENCES habits(id),
                date_completed DATE DEFAULT CURRENT_DATE
            );
        `);
        console.log("✅ user_habit_logs table ready");

        // Quotations
        await pool.query(`
            CREATE TABLE IF NOT EXISTS quotations (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                user_name VARCHAR(100),
                user_email VARCHAR(100),
                user_city VARCHAR(50),
                user_province VARCHAR(50),
                package_tier VARCHAR(20),
                package_details TEXT,
                devices_summary TEXT,
                total_cost VARCHAR(50),
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log("✅ quotations table ready");

        // Add onboarding columns if missing
        const onboardingCols = [
            'monthly_spend DECIMAL(10, 2) DEFAULT 0',
            'household_size VARCHAR(10) DEFAULT NULL',
            'property_type VARCHAR(20) DEFAULT NULL',
            'has_pool BOOLEAN DEFAULT FALSE',
            'cooking_fuel VARCHAR(20) DEFAULT NULL',
            'work_from_home VARCHAR(20) DEFAULT NULL',
            'latitude DECIMAL(10, 7) DEFAULT NULL',
            'longitude DECIMAL(10, 7) DEFAULT NULL',
            'onboarding_completed BOOLEAN DEFAULT FALSE',
            'city VARCHAR(100) DEFAULT NULL',
            'province VARCHAR(50) DEFAULT NULL',
        ];
        for (const col of onboardingCols) {
            const colName = col.split(' ')[0];
            try {
                await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col}`);
            } catch (e) { /* column already exists */ }
        }
        console.log("✅ onboarding columns ready");

        console.log("\n🎉 All tables created successfully!");
        process.exit(0);

    } catch (err) {
        console.error("❌ Error:", err.message);
        process.exit(1);
    }
}

initSupabase();

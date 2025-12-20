const pool = require('./db');

async function updateSchema() {
    try {
        console.log("Updating schema for Gamification...");

        // 1. Add monthly_budget to users
        try {
            await pool.query('ALTER TABLE users ADD COLUMN monthly_budget DECIMAL(10, 2) DEFAULT 0');
            console.log("Scaled users table with monthly_budget.");
        } catch (err) {
            if (err.message.includes('already exists')) {
                console.log("Column monthly_budget already exists.");
            } else {
                throw err;
            }
        }

        // 2. Create habits table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS habits (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                title VARCHAR(255) NOT NULL,
                description TEXT,
                impact_level VARCHAR(10) DEFAULT 'MEDIUM'
            );
        `);
        console.log("Created/Verified habits table.");

        // 3. Create user_habit_logs table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_habit_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                habit_id INTEGER REFERENCES habits(id),
                date_completed DATE DEFAULT CURRENT_DATE
            );
        `);
        console.log("Created/Verified user_habit_logs table.");

        console.log("Schema update complete!");
        process.exit(0);

    } catch (err) {
        console.error("Schema Update Failed:", err);
        process.exit(1);
    }
}

updateSchema();

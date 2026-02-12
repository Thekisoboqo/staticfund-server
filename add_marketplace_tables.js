require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        // Add city and province columns if not exists
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(50) DEFAULT NULL`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS province VARCHAR(50) DEFAULT NULL`);
        console.log('✅ Added city and province columns to users');

        // Create quotations table
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
            )
        `);
        console.log('✅ Created quotations table');

        console.log('🎉 All migrations complete!');
    } catch (err) {
        console.error('Migration error:', err.message);
    } finally {
        pool.end();
    }
}

migrate();

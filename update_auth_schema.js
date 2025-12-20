const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function updateSchema() {
    try {
        // Create users table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255),
                province VARCHAR(100),
                city VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Successfully created users table');

        // Add user_id to devices table
        await pool.query(`
            ALTER TABLE devices 
            ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
        `);
        console.log('Successfully added user_id column to devices table');

    } catch (err) {
        console.error('Error updating schema:', err);
    } finally {
        await pool.end();
    }
}

updateSchema();

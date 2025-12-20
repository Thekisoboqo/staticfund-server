const { Pool } = require('pg');
require('dotenv').config();

// Connect to default 'postgres' database to create 'antigravity'
const pool = new Pool({
    user: 'postgres',
    password: 'TK4ever8ena!',
    host: 'localhost',
    port: 5432,
    database: 'postgres'  // Connect to default db first
});

async function createDatabase() {
    try {
        // Check if database exists
        const check = await pool.query("SELECT 1 FROM pg_database WHERE datname = 'antigravity'");
        if (check.rows.length === 0) {
            await pool.query('CREATE DATABASE antigravity');
            console.log('Database "antigravity" created successfully!');
        } else {
            console.log('Database "antigravity" already exists.');
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

createDatabase();

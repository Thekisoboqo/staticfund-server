const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function viewData() {
    try {
        console.log('--- USERS ---');
        const users = await pool.query('SELECT * FROM users');
        console.table(users.rows);

        console.log('\n--- DEVICES ---');
        const devices = await pool.query('SELECT * FROM devices');
        console.table(devices.rows);

    } catch (err) {
        console.error('Error fetching data:', err);
    } finally {
        await pool.end();
    }
}

viewData();

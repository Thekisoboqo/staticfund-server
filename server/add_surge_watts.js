const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgres://postgres:TK4ever8ena!@localhost:5432/energy_app',
});

async function updateSchema() {
    try {
        await pool.query(`
            ALTER TABLE devices 
            ADD COLUMN IF NOT EXISTS surge_watts INTEGER DEFAULT 0;
        `);
        console.log('Successfully added surge_watts column to devices table');
    } catch (err) {
        console.error('Error updating schema:', err);
    } finally {
        await pool.end();
    }
}

updateSchema();

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initMeshDb() {
    try {
        console.log('Initializing Mesh Network, Water & Agriculture tables...');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS community_intelligence (
                id SERIAL PRIMARY KEY,
                topic VARCHAR(100), -- e.g., 'appliance_efficiency', 'solar_yield', 'grid_stability'
                context_data JSONB, -- The actual learned insights
                confidence REAL,
                discovered_by_home_id INTEGER REFERENCES homes(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ community_intelligence table created or exists');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS water_readings (
                id SERIAL PRIMARY KEY,
                home_id INTEGER REFERENCES homes(id),
                reading_liters INTEGER,
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ water_readings table created or exists');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS garden_plots (
                id SERIAL PRIMARY KEY,
                home_id INTEGER REFERENCES homes(id),
                plot_name VARCHAR(100),
                crop_types JSONB, -- list of crops
                latitude REAL,
                longitude REAL,
                soil_moisture_estimate REAL,
                last_watered TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ garden_plots table created or exists');

        console.log('All Mesh & Agriculture tables initialized successfully!');

    } catch (error) {
        console.error('Error initializing tables:', error);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

initMeshDb();

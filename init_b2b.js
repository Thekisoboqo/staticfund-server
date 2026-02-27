const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initB2B() {
    console.log("💼 Initializing B2B Marketplace Tables...");
    try {
        // 1. Installers Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS installers (
                id SERIAL PRIMARY KEY,
                company_name VARCHAR(255) NOT NULL,
                city VARCHAR(100),
                province VARCHAR(100),
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                service_radius_km INTEGER DEFAULT 50,
                rating REAL DEFAULT 4.5,
                specializations TEXT[], -- ['residential', 'commercial', 'off-grid']
                contact_email VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. Market Leads Table (Qualified Audit Data)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS market_leads (
                id SERIAL PRIMARY KEY,
                home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
                installer_id INTEGER REFERENCES installers(id) ON DELETE SET NULL,
                audit_summary JSONB, -- The "Bankable Report" data
                status VARCHAR(20) DEFAULT 'NEW', -- 'NEW', 'SENT', 'ACCEPTED', 'CLOSED'
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 3. Insert some seed installers in Mangaung/Free State
        const seedInstallers = [
            ['Bloem Solar Tech', 'Bloemfontein', 'Free State', -29.118, 26.223, 100, 4.8, ['residential', 'off-grid'], 'sales@bloemsolar.co.za'],
            ['Mangaung Energy Solutions', 'Bloemfontein', 'Free State', -29.155, 26.199, 50, 4.5, ['commercial', 'residential'], 'info@mangaungenergy.com'],
            ['Willows Power Pro', 'Willows', 'Free State', -29.125, 26.211, 20, 4.2, ['residential'], 'support@willowspr.co.za']
        ];

        for (const inst of seedInstallers) {
            await pool.query(`
                INSERT INTO installers (company_name, city, province, latitude, longitude, service_radius_km, rating, specializations, contact_email)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT DO NOTHING
            `, inst);
        }

        console.log("✅ B2B Marketplace Tables Initialized.");
    } catch (err) {
        console.error("❌ B2B Init Error:", err.message);
    } finally {
        await pool.end();
    }
}

initB2B();

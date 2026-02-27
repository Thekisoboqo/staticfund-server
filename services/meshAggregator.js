const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' }); // Adjusted for services folder
const { callAI, extractJSON } = require('./geminiService');

const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Aggregates raw house data into community "wisdom" chunks for the Mesh DB
async function runMeshAggregator() {
    console.log("🕸️ Starting Mesh Aggregation Worker...");
    try {
        // 1. Appilance Usage Patterns 
        const applianceData = await db.query(`
            SELECT name, category, AVG(watts) as avg_watts, AVG(hours_per_day) as avg_hours, COUNT(*) as count 
            FROM devices 
            GROUP BY name, category 
            HAVING COUNT(*) > 2
        `);

        if (applianceData.rows.length > 0) {
            console.log(`Aggregating insights for ${applianceData.rows.length} common appliances...`);

            // Just picking top 5 for the demo run
            for (let i = 0; i < Math.min(5, applianceData.rows.length); i++) {
                let app = applianceData.rows[i];
                let prompt = `
                You are generating insights for a community mesh network database.
                Analyze this appliance usage data from the community:
                Name: ${app.name} (${app.category})
                Average Watts: ${app.avg_watts.toFixed(0)}W
                Average Daily Hours: ${app.avg_hours.toFixed(1)}h
                Data points: ${app.count} homes
                
                Generate a 1-2 sentence useful insight for the community.
                Return ONLY raw JSON: { "insight": "your insight text", "topic": "appliance_efficiency" }
                `;

                try {
                    // Quick text generation from core model
                    const resText = await callAI(prompt, { maxTokens: 150 });
                    const resJson = extractJSON(resText);

                    if (resJson && resJson.insight) {
                        const { runPrivacyScrubber } = require('./crewService');
                        const scrubbedInsight = await runPrivacyScrubber(resJson.insight);

                        await db.query(`
                            INSERT INTO community_intelligence (topic, context_data, confidence)
                            VALUES ($1, $2, $3)
                        `, [resJson.topic || 'appliance_efficiency', JSON.stringify({ device: app.name, note: scrubbedInsight }), 0.85]);
                    }
                } catch (e) {
                    // Ignore transient AI errors
                }
            }
        }

        // 2. Solar & Inverter Patterns
        const solarData = await db.query(`
            SELECT 
                AVG(battery_soc) as avg_soc,
                AVG(daily_pv_kwh) as avg_pv,
                AVG(daily_grid_import_kwh) as avg_import,
                COUNT(DISTINCT home_id) as total_solar_homes
            FROM inverter_readings
            WHERE recorded_at > NOW() - INTERVAL '24 hours'
        `);

        if (solarData.rows.length > 0 && solarData.rows[0].total_solar_homes > 0) {
            const sum = solarData.rows[0];
            let insight = `In the last 24h, community solar homes averaged ${parseFloat(sum.avg_pv).toFixed(1)}kWh PV generation, maintaining an average SoC of ${parseFloat(sum.avg_soc).toFixed(0)}%. Average grid dependency was ${parseFloat(sum.avg_import).toFixed(1)}kWh.`;

            await db.query(`
                INSERT INTO community_intelligence (topic, context_data, confidence)
                VALUES ($1, $2, $3)
            `, ['solar_yield', JSON.stringify({ timeframe: 'last_24h', note: insight }), 0.90]);

            console.log("☀️ Added daily solar aggregation insight.");
        }

        console.log("🕸️ Mesh Aggregation complete.");
    } catch (err) {
        console.error("Mesh Aggregation Error:", err.message);
    }
}

// Export for manual or cron invocation
module.exports = { runMeshAggregator };

// Run if called directly
if (require.main === module) {
    runMeshAggregator().then(async () => {
        console.log("Exiting worker.");
        await db.end();
        process.exit(0);
    });
}

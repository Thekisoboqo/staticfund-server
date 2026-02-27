const db = require('../db');
const { controlInverter } = require('./inverterService');

// We use Open-Meteo's free API for weather and extreme events
const METEO_API = 'https://api.open-meteo.com/v1/forecast';

async function runWeatherGuardian() {
    console.log("🌪️ Starting Weather Guardian Worker...");
    try {
        // Fetch homes with connected inverters and valid coordinates
        const homes = await db.query(`
            SELECT h.id, h.latitude, h.longitude, h.city, c.* 
            FROM homes h
            JOIN inverter_configs c ON h.id = c.home_id
            WHERE h.latitude IS NOT NULL AND h.longitude IS NOT NULL
        `);

        if (homes.rows.length === 0) {
            console.log("No homes with coordinates + inverters found.");
            return;
        }

        console.log(`Checking extreme weather for ${homes.rows.length} homes...`);

        const fetch = (await import('node-fetch')).default;

        for (const home of homes.rows) {
            try {
                // Fetch daily extremes for next 3 days
                // precipitation_sum to predict floods/mudslides
                // wind_speed_10m_max to predict severe storms
                const wUrl = `${METEO_API}?latitude=${home.latitude}&longitude=${home.longitude}&daily=precipitation_sum,wind_speed_10m_max&timezone=auto&forecast_days=3`;
                const wRes = await fetch(wUrl);
                const weather = await wRes.json();

                if (!weather.daily) continue;

                let triggers = [];

                // Check precipitation logic (e.g. > 50mm in a day is severe)
                for (let i = 0; i < weather.daily.precipitation_sum.length; i++) {
                    const rain = weather.daily.precipitation_sum[i];
                    const wind = weather.daily.wind_speed_10m_max[i];
                    const date = weather.daily.time[i];

                    if (rain > 50) triggers.push(`Massive rainfall (${rain}mm) expected on ${date}. High risk of flooding or mudslides.`);
                    if (wind > 80) triggers.push(`Severe wind storm (${wind}km/h) expected on ${date}. Grid power failure likely.`);
                }

                if (triggers.length > 0) {
                    console.log(`[Home ${home.id} - ${home.city || 'Unknown'}] 🚨 DISASTER WARNING GENERATED:`, triggers);

                    // Execute Emergency Override on the Inverter
                    try {
                        const overrideRes = await controlInverter(home, 'emergency_charge', {});
                        console.log(`- Action taken: ${overrideRes.status}`);

                        // We would send a push notification here in a full production system:
                        // sendPushNotification(home.id, "CRITICAL ALERT: " + triggers[0] + " Forcing battery to 100%.");

                        await db.query(`
                            INSERT INTO community_intelligence (topic, context_data, confidence, discovered_by_home_id)
                            VALUES ('emergency_weather', $1, 0.99, $2)
                        `, [JSON.stringify({ alerts: triggers, action: "Set inverter to emergency charge 100%" }), home.id]);

                    } catch (e) {
                        console.error(`- Action failed for Home ${home.id}:`, e.message);
                    }
                } else {
                    console.log(`[Home ${home.id}] 🌤️ Weather looks clear.`);
                }

            } catch (e) {
                console.error(`Error checking weather for Home ${home.id}:`, e.message);
            }
        }
    } catch (err) {
        console.error("Weather Guardian Error:", err.message);
    }
}

// Export for integration
module.exports = { runWeatherGuardian };

// Standalone runner
if (require.main === module) {
    runWeatherGuardian().then(async () => {
        console.log("Weather Guardian finished.");
        await db.end();
        process.exit(0);
    });
}

const cron = require('node-cron');
const db = require('./db');
const { runMeshAggregator } = require('./services/meshAggregator');
const { runWeatherGuardian } = require('./services/weatherGuardian');

console.log("🕒 Initializing Background Workers...");

// Run Weather Guardian every hour
cron.schedule('0 * * * *', async () => {
    try {
        await runWeatherGuardian();
    } catch (e) {
        console.error("Cron Error (Weather):", e.message);
    }
});

// Run Mesh Aggregator every 6 hours
cron.schedule('0 */6 * * *', async () => {
    try {
        await runMeshAggregator();
    } catch (e) {
        console.error("Cron Error (Mesh):", e.message);
    }
});

console.log("✅ Cron workers scheduled.");

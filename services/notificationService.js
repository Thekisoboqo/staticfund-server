/**
 * notificationService.js — Smart Push Notification Engine
 * Checks for conditions that trigger proactive user alerts:
 * - Tariff zone changes (peak/off-peak transitions)
 * - Budget pace alerts (overspending)
 * - Battery warnings (low SOC + cloud cover)
 * - Savings milestones (achievements)
 * - Hours remaining alerts (prepaid running low)
 */

// In-memory push token store (in production, store in DB)
const pushTokens = new Map(); // homeId -> expoPushToken

function registerToken(homeId, token) {
    pushTokens.set(homeId, token);
    console.log(`📱 Push token registered for home ${homeId}`);
}

function getToken(homeId) {
    return pushTokens.get(homeId);
}

/**
 * Send push notification via Expo Push API
 */
async function sendPush(token, title, body, data = {}) {
    if (!token) return;
    try {
        const fetch = (await import('node-fetch')).default;
        await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: token,
                sound: 'default',
                title,
                body,
                data,
            }),
        });
        console.log(`🔔 Push sent: "${title}" → ${token.substring(0, 20)}...`);
    } catch (err) {
        console.error('Push send error:', err.message);
    }
}

/**
 * Check all notification triggers for a home
 */
async function checkNotifications(pool, homeId) {
    const token = getToken(homeId);
    if (!token) return;

    try {
        // 1. Get home data
        const homeRes = await pool.query('SELECT * FROM homes WHERE id = $1', [homeId]);
        if (homeRes.rows.length === 0) return;
        const home = homeRes.rows[0];

        // 2. Get dashboard stats
        const deviceRes = await pool.query(`
            SELECT COALESCE(SUM(d.watts * d.hours_per_day / 1000.0), 0) as daily_kwh
            FROM devices d
            JOIN rooms r ON d.room_id = r.id
            WHERE r.home_id = $1
        `, [homeId]);
        const dailyKwh = parseFloat(deviceRes.rows[0]?.daily_kwh || 0);

        // 3. Get meter info
        const meterRes = await pool.query(
            'SELECT * FROM meter_readings WHERE home_id = $1 ORDER BY reading_date DESC LIMIT 1',
            [homeId]
        );
        const meter = meterRes.rows[0];

        // 4. Get inverter readings
        const inverterRes = await pool.query(
            'SELECT * FROM inverter_readings WHERE home_id = $1 ORDER BY recorded_at DESC LIMIT 1',
            [homeId]
        );
        const inverter = inverterRes.rows[0];

        const now = new Date();
        const hour = now.getHours();

        // ───────────────────────────────────────────────────
        // TRIGGER 1: Tariff zone transition alerts
        // ───────────────────────────────────────────────────
        if (hour === 7 || hour === 17) {
            // Peak just started
            await sendPush(token,
                '⚡ Peak Tariff Active',
                'Electricity is now at peak rate (~R3.80/kWh). Delay washing machines, ovens, and other heavy loads to save money.',
                { type: 'tariff_peak', homeId }
            );
        } else if (hour === 22) {
            // Off-peak starts
            await sendPush(token,
                '🌙 Off-Peak Tariff Active',
                'Cheapest rate now (~R1.20/kWh). Great time to run your geyser, washing machine, or charge batteries.',
                { type: 'tariff_offpeak', homeId }
            );
        }

        // ───────────────────────────────────────────────────
        // TRIGGER 2: Prepaid hours remaining warning
        // ───────────────────────────────────────────────────
        if (meter) {
            const daysSinceSync = (now - new Date(meter.reading_date)) / (1000 * 60 * 60 * 24);
            const kwhUsedSinceSync = dailyKwh * daysSinceSync;
            const estimatedKwh = Math.max(0, parseFloat(meter.reading_value) - kwhUsedSinceSync);
            const hoursLeft = dailyKwh > 0 ? (estimatedKwh / dailyKwh) * 24 : 999;

            if (hoursLeft <= 24 && hoursLeft > 0) {
                await sendPush(token,
                    '⚠️ Low Electricity Warning',
                    `You have approximately ${Math.round(hoursLeft)} hours of electricity remaining. Consider purchasing more units soon.`,
                    { type: 'low_units', homeId, hoursLeft }
                );
            } else if (hoursLeft <= 48 && hoursLeft > 24) {
                await sendPush(token,
                    '📊 Electricity Running Low',
                    `About ${Math.round(hoursLeft)} hours (~${(hoursLeft / 24).toFixed(1)} days) of units remaining at current usage.`,
                    { type: 'units_warning', homeId, hoursLeft }
                );
            }
        }

        // ───────────────────────────────────────────────────
        // TRIGGER 3: Budget overpace warning
        // ───────────────────────────────────────────────────
        if (home.monthly_budget) {
            const rateRes = await pool.query(`
                SELECT rate_per_kwh FROM tariff_configs WHERE home_id = $1 ORDER BY created_at DESC LIMIT 1
            `, [homeId]);
            const rate = parseFloat(rateRes.rows[0]?.rate_per_kwh || 2.5);
            const dailyCost = dailyKwh * rate;
            const monthlyProjection = dailyCost * 30;
            const budget = parseFloat(home.monthly_budget);

            const dayOfMonth = now.getDate();
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const expectedSpend = (budget / daysInMonth) * dayOfMonth;
            const actualSpend = dailyCost * dayOfMonth;

            if (actualSpend > expectedSpend * 1.15 && dayOfMonth > 5) {
                const overBy = Math.round(actualSpend - expectedSpend);
                await sendPush(token,
                    '💰 Budget Alert',
                    `You're R${overBy} ahead of your R${budget}/month budget pace. At this rate, you'll spend R${Math.round(monthlyProjection)} this month.`,
                    { type: 'budget_over', homeId, overBy }
                );
            }
        }

        // ───────────────────────────────────────────────────
        // TRIGGER 4: Battery low + cloud cover
        // ───────────────────────────────────────────────────
        if (inverter) {
            const soc = parseFloat(inverter.battery_soc || 100);
            const pvPower = parseFloat(inverter.pv_power || 0);

            if (soc < 25 && pvPower < 500 && hour >= 14 && hour <= 18) {
                await sendPush(token,
                    '🔋 Battery Low',
                    `Battery at ${soc}% with low solar (${pvPower}W). Consider grid-charging or reducing load to avoid outage.`,
                    { type: 'battery_low', homeId, soc }
                );
            }
        }

        // ───────────────────────────────────────────────────
        // TRIGGER 5: Monthly savings milestone
        // ───────────────────────────────────────────────────
        if (inverter && now.getDate() === 1 && hour === 9) {
            // First day of month — report savings
            const lastMonth = await pool.query(`
                SELECT 
                    COALESCE(SUM(daily_pv_kwh), 0) as total_pv,
                    COALESCE(SUM(daily_grid_import_kwh), 0) as total_import,
                    COALESCE(SUM(daily_grid_export_kwh), 0) as total_export
                FROM inverter_readings
                WHERE home_id = $1 AND recorded_at > NOW() - INTERVAL '30 days'
            `, [homeId]);

            const pvKwh = parseFloat(lastMonth.rows[0]?.total_pv || 0);
            const rateRes = await pool.query(`
                SELECT rate_per_kwh FROM tariff_configs WHERE home_id = $1 ORDER BY created_at DESC LIMIT 1
            `, [homeId]);
            const rate = parseFloat(rateRes.rows[0]?.rate_per_kwh || 2.5);
            const saved = pvKwh * rate;

            if (saved > 0) {
                await sendPush(token,
                    '🎉 Monthly Solar Report',
                    `Your solar panels generated ${pvKwh.toFixed(0)} kWh last month, saving you R${saved.toFixed(0)}! Keep it up.`,
                    { type: 'monthly_savings', homeId, saved }
                );
            }
        }

    } catch (err) {
        console.error(`Notification check failed for home ${homeId}:`, err.message);
    }
}

/**
 * Run notification checks for all active homes
 */
async function runNotificationChecks(pool) {
    try {
        const homes = await pool.query('SELECT id FROM homes');
        for (const home of homes.rows) {
            await checkNotifications(pool, home.id);
        }
    } catch (err) {
        console.error('Notification sweep error:', err.message);
    }
}

module.exports = { registerToken, getToken, sendPush, checkNotifications, runNotificationChecks };

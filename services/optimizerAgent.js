/**
 * StaticFund — AI Optimizer Agent
 * Chain-of-thought reasoning engine that analyzes household data,
 * learns from cross-household patterns, and generates optimal
 * inverter control recommendations.
 *
 * Uses Gemini 2.5 Pro for deep reasoning.
 */
require('dotenv').config();

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

// ═══════════════════════════════════════════════════════════════
// CROSS-HOUSEHOLD LEARNING — Aggregate anonymized insights
// ═══════════════════════════════════════════════════════════════

async function getCommunityInsights(pool, currentHomeId) {
    try {
        // How do other households perform at this hour?
        const hourlyPatterns = await pool.query(`
            SELECT
                EXTRACT(HOUR FROM recorded_at) as hour,
                AVG(battery_soc) as avg_soc,
                AVG(pv_power) as avg_pv,
                AVG(grid_power) as avg_grid,
                AVG(load_power) as avg_load,
                AVG(daily_pv_kwh) as avg_daily_pv,
                AVG(daily_grid_import_kwh) as avg_daily_import,
                COUNT(DISTINCT home_id) as household_count
            FROM inverter_readings
            WHERE recorded_at > NOW() - INTERVAL '7 days'
            AND home_id != $1
            GROUP BY EXTRACT(HOUR FROM recorded_at)
            ORDER BY hour
        `, [currentHomeId]);

        // What charge schedules work best for others?
        const successfulSchedules = await pool.query(`
            SELECT
                parameters,
                reasoning,
                confidence,
                COUNT(*) as times_used
            FROM optimization_schedules
            WHERE status = 'applied'
            AND confidence > 0.7
            AND home_id != $1
            AND created_at > NOW() - INTERVAL '30 days'
            GROUP BY parameters, reasoning, confidence
            ORDER BY times_used DESC
            LIMIT 5
        `, [currentHomeId]);

        // Average daily savings from optimization
        const savingsData = await pool.query(`
            SELECT
                AVG((parameters->>'projected_daily_savings')::REAL) as avg_daily_savings,
                COUNT(DISTINCT home_id) as optimized_households
            FROM optimization_schedules
            WHERE status = 'applied'
            AND parameters->>'projected_daily_savings' IS NOT NULL
            AND created_at > NOW() - INTERVAL '30 days'
        `);

        return {
            hourlyPatterns: hourlyPatterns.rows,
            successfulSchedules: successfulSchedules.rows,
            communityStats: savingsData.rows[0] || {},
        };
    } catch (err) {
        console.error('Community insights error:', err.message);
        return { hourlyPatterns: [], successfulSchedules: [], communityStats: {} };
    }
}

// ═══════════════════════════════════════════════════════════════
// WEATHER CONTEXT — Sunrise/sunset + conditions
// ═══════════════════════════════════════════════════════════════

async function getWeatherContext(lat, lon) {
    try {
        // Use free Open-Meteo API
        const res = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat || -29.1}&longitude=${lon || 26.2}&daily=sunrise,sunset,shortwave_radiation_sum&hourly=cloudcover&timezone=Africa/Johannesburg&forecast_days=2`
        );
        if (!res.ok) return null;
        const data = await res.json();

        const today = data.daily;
        const hourly = data.hourly;

        // Get cloud cover for next 12 hours
        const now = new Date();
        const currentHour = now.getHours();
        const next12hCloud = [];
        for (let i = currentHour; i < Math.min(currentHour + 12, 24); i++) {
            next12hCloud.push({
                hour: i,
                cloudCover: hourly?.cloudcover?.[i] || 0,
            });
        }

        return {
            sunrise: today?.sunrise?.[0] || '06:00',
            sunset: today?.sunset?.[0] || '18:00',
            solarRadiation: today?.shortwave_radiation_sum?.[0] || 0,
            tomorrowSolarRadiation: today?.shortwave_radiation_sum?.[1] || 0,
            next12hCloud,
            avgCloudCover: next12hCloud.reduce((s, c) => s + c.cloudCover, 0) / (next12hCloud.length || 1),
        };
    } catch (err) {
        console.error('Weather fetch error:', err.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// OPTIMIZER — Chain-of-thought reasoning with Gemini 2.5 Pro
// ═══════════════════════════════════════════════════════════════

async function runOptimizer(pool, homeId) {
    // 1. Gather all context
    const [
        configRes,
        readingsRes,
        devicesRes,
        homeRes,
        userRes,
        historyRes,
    ] = await Promise.all([
        pool.query('SELECT * FROM inverter_configs WHERE home_id = $1 AND is_active = true', [homeId]),
        pool.query('SELECT * FROM inverter_readings WHERE home_id = $1 AND recorded_at > NOW() - INTERVAL \'7 days\' ORDER BY recorded_at DESC LIMIT 200', [homeId]),
        pool.query('SELECT name, watts, hours_per_day FROM devices WHERE home_id = $1 ORDER BY watts DESC', [homeId]),
        pool.query('SELECT * FROM homes WHERE id = $1', [homeId]),
        pool.query('SELECT lifestyle_context, city, province FROM users WHERE id = (SELECT user_id FROM homes WHERE id = $1 LIMIT 1)', [homeId]),
        pool.query('SELECT * FROM optimization_schedules WHERE home_id = $1 ORDER BY created_at DESC LIMIT 10', [homeId]),
    ]);

    const config = configRes.rows[0];
    if (!config) throw new Error('No inverter configured for this home');

    const readings = readingsRes.rows;
    const devices = devicesRes.rows;
    const home = homeRes.rows[0];
    const user = userRes.rows[0];
    const pastOptimizations = historyRes.rows;

    // 2. Get cross-household insights
    const community = await getCommunityInsights(pool, homeId);

    // 3. Get weather
    const weather = await getWeatherContext();

    // 4. Calculate stats from readings
    const latestReading = readings[0] || {};
    const avgReadings = {
        avgSOC: readings.reduce((s, r) => s + (r.battery_soc || 0), 0) / (readings.length || 1),
        avgPV: readings.reduce((s, r) => s + (r.pv_power || 0), 0) / (readings.length || 1),
        avgLoad: readings.reduce((s, r) => s + (r.load_power || 0), 0) / (readings.length || 1),
        avgGridImport: readings.reduce((s, r) => s + (r.daily_grid_import_kwh || 0), 0) / (readings.length || 1),
        peakPV: Math.max(...readings.map(r => r.pv_power || 0)),
        peakLoad: Math.max(...readings.map(r => r.load_power || 0)),
    };

    // Device load summary
    const deviceSummary = devices.map(d => {
        const dailyKwh = (d.watts * d.hours_per_day) / 1000;
        return `${d.name}: ${d.watts}W × ${d.hours_per_day}h = ${dailyKwh.toFixed(1)} kWh/day`;
    }).join('\n');
    const totalDailyLoad = devices.reduce((s, d) => s + (d.watts * d.hours_per_day / 1000), 0);

    // Community context
    const communityText = community.hourlyPatterns.length > 0
        ? `\n${community.hourlyPatterns.length > 0 ? community.hourlyPatterns.map(h =>
            `Hour ${h.hour}: avg SOC=${Math.round(h.avg_soc)}%, PV=${Math.round(h.avg_pv)}W, Load=${Math.round(h.avg_load)}W (${h.household_count} homes)`
        ).join('\n') : 'No community data yet'}\n\nMost successful schedules used by other households:\n${community.successfulSchedules.map(s =>
            `- ${s.reasoning} (confidence: ${(s.confidence * 100).toFixed(0)}%, used ${s.times_used}x)`
        ).join('\n') || 'No optimization history from other homes'}\n\nCommunity average daily savings from optimization: R${(community.communityStats.avg_daily_savings || 0).toFixed(2)} across ${community.communityStats.optimized_households || 0} homes`
        : 'No community data available yet — this household will be among the first to be optimized.';

    // 5. Build the reasoning prompt
    const prompt = `You are the StaticFund Energy Optimizer — an advanced reasoning agent that analyzes household energy systems and generates optimal inverter control settings.

═══ THINK STEP BY STEP ═══
1. Analyze this household's energy patterns over the past 7 days
2. Compare with community data from other households
3. Consider weather forecast and solar conditions
4. Factor in the user's lifestyle and daily routine
5. Generate specific, actionable control commands
6. Calculate projected savings with high confidence

═══ THIS HOUSEHOLD ═══
Inverter: ${config.brand.toUpperCase()} (SN: ${config.inverter_sn || 'unknown'})
Location: ${user?.city || 'South Africa'}, ${user?.province || ''}

Current State:
- Battery SOC: ${latestReading.battery_soc || 'unknown'}%
- PV Power: ${latestReading.pv_power || 0}W
- Grid Power: ${latestReading.grid_power || 0}W (${(latestReading.grid_power || 0) > 0 ? 'importing' : 'exporting'})
- House Load: ${latestReading.load_power || 0}W

7-Day Averages:
- Average SOC: ${avgReadings.avgSOC.toFixed(0)}%
- Average PV: ${avgReadings.avgPV.toFixed(0)}W (peak: ${avgReadings.peakPV}W)
- Average Load: ${avgReadings.avgLoad.toFixed(0)}W (peak: ${avgReadings.peakLoad}W)
- Average Daily Grid Import: ${avgReadings.avgGridImport.toFixed(1)} kWh

═══ DEVICES & LOAD PROFILE ═══
${deviceSummary}
Total daily load: ${totalDailyLoad.toFixed(1)} kWh/day

═══ USER LIFESTYLE ═══
${user?.lifestyle_context || 'No lifestyle data yet — assume typical SA household schedule'}

═══ WEATHER FORECAST ═══
${weather ? `Sunrise: ${weather.sunrise} | Sunset: ${weather.sunset}
Solar radiation today: ${weather.solarRadiation} W/m²
Tomorrow's forecast radiation: ${weather.tomorrowSolarRadiation} W/m²
Next 12h cloud cover: ${weather.next12hCloud.map(c => `${c.hour}h:${c.cloudCover}%`).join(', ')}
Average cloud cover: ${weather.avgCloudCover.toFixed(0)}%` : 'Weather data unavailable'}

═══ ELECTRICITY RATES ═══
Standard rate: ~R3.20/kWh
Off-peak (typically 22:00-06:00): ~R1.20/kWh (if time-of-use tariff)
Peak (typically 07:00-10:00, 17:00-20:00): ~R3.80/kWh

═══ COMMUNITY DATA (${community.hourlyPatterns.length > 0 ? 'from ' + (community.hourlyPatterns[0]?.household_count || 0) + ' other households' : 'no data yet'}) ═══
${communityText}

═══ PAST OPTIMIZATIONS FOR THIS HOME ═══
${pastOptimizations.length > 0 ? pastOptimizations.map(o =>
        `${o.schedule_type}: ${o.reasoning} (status: ${o.status}, confidence: ${(o.confidence * 100).toFixed(0)}%)`
    ).join('\n') : 'No past optimizations — this is the first analysis'}

═══ YOUR TASK ═══
Generate optimal inverter settings. You MUST return valid JSON with this exact structure:

{
    "reasoning": "Your detailed chain-of-thought analysis explaining WHY these settings are optimal...",
    "confidence": 0.85,
    "recommendations": [
        {
            "action": "set_charge_schedule",
            "params": {
                "slots": [
                    { "slot": 1, "start": "22:00", "end": "05:00", "targetSOC": 95, "gridCharge": true, "powerLimit": 3000 },
                    { "slot": 2, "start": "10:00", "end": "14:00", "targetSOC": 100, "gridCharge": false, "powerLimit": 5000 }
                ]
            },
            "reason": "Specific reason for this schedule"
        },
        {
            "action": "set_soc_limits",
            "params": { "minSOC": 15, "maxSOC": 95 },
            "reason": "Why these limits"
        },
        {
            "action": "set_work_mode",
            "params": { "mode": "pv_first" },
            "reason": "Why this mode"
        }
    ],
    "projected_savings": {
        "daily_kwh_saved": 3.5,
        "daily_rand_saved": 11.2,
        "monthly_rand_saved": 336,
        "explanation": "How savings are calculated"
    },
    "community_comparison": "How this compares to similar households",
    "next_review": "When to re-analyze (e.g. 'tomorrow 6AM' or 'in 7 days')"
}

CRITICAL RULES:
- minSOC must NEVER be below 10% (battery protection)
- maxSOC must NEVER exceed 95% (longevity)
- Charge schedules must respect user lifestyle (don't schedule heavy loads when they're sleeping)
- Prefer PV charging over grid charging when solar is available
- Factor in tomorrow's weather when setting overnight charge targets
- Be specific with numbers — no vague advice`;

    // 6. Call Gemini 2.5 Pro (reasoning model)
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENROUTER_KEY}`,
        },
        body: JSON.stringify({
            model: 'google/gemini-2.5-pro-preview',
            messages: [
                { role: 'user', content: prompt },
            ],
            temperature: 0.3,
            max_tokens: 4000,
            response_format: { type: 'json_object' },
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Optimizer API error: ${response.status} — ${err}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '{}';

    let parsed;
    try {
        // Handle potential markdown wrappers
        const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(cleaned);
    } catch (e) {
        throw new Error('Optimizer returned invalid JSON: ' + content.substring(0, 200));
    }

    // 7. Enforce safety constraints
    if (parsed.recommendations) {
        for (const rec of parsed.recommendations) {
            if (rec.action === 'set_soc_limits') {
                rec.params.minSOC = Math.max(10, rec.params.minSOC || 10);
                rec.params.maxSOC = Math.min(95, rec.params.maxSOC || 95);
            }
            if (rec.action === 'set_charge_schedule' && rec.params?.slots) {
                for (const slot of rec.params.slots) {
                    slot.targetSOC = Math.min(95, Math.max(10, slot.targetSOC || 80));
                }
            }
        }
    }
    parsed.confidence = Math.min(1, Math.max(0, parsed.confidence || 0.5));

    // 8. Save analysis to database
    for (const rec of (parsed.recommendations || [])) {
        await pool.query(`
            INSERT INTO optimization_schedules (home_id, schedule_type, parameters, reasoning, confidence, status)
            VALUES ($1, $2, $3, $4, $5, 'pending')
        `, [
            homeId,
            rec.action,
            JSON.stringify({ ...rec.params, projected_daily_savings: parsed.projected_savings?.daily_rand_saved }),
            rec.reason,
            parsed.confidence,
        ]);
    }

    return parsed;
}

module.exports = { runOptimizer, getCommunityInsights, getWeatherContext };

const express = require('express');
const cors = require('cors');
const pool = require('./db');
require('dotenv').config();
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5001;

// Ensure database tables are created on startup
pool.initDB();

// Initialize background aggregators & disaster wardens
require('./cronScheduler');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
const upload = multer({ storage: multer.memoryStorage() });

// ── Helper: Generate unique codes ───────────────────────────────
function generateCode(city) {
    const prefix = city ? city.substring(0, 3).toUpperCase() : 'STA';
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix = '';
    for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    return `${prefix}-${suffix}`;
}

function generateShareCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

// ── Health Check ────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({ status: 'ok', time: result.rows[0].now, version: 'v2' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// USER + HOME — Auto-create from location
// ═══════════════════════════════════════════════════════════════

app.post('/api/users/auto-create', async (req, res) => {
    const { city, province, latitude, longitude } = req.body;

    try {
        // Generate unique user code
        let code = generateCode(city);
        let attempts = 0;
        while (attempts < 10) {
            const existing = await pool.query('SELECT id FROM users WHERE code = $1', [code]);
            if (existing.rows.length === 0) break;
            code = generateCode(city);
            attempts++;
        }

        // Create user
        const userRes = await pool.query(
            'INSERT INTO users (code, city, province, latitude, longitude) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [code, city, province, latitude, longitude]
        );
        const user = userRes.rows[0];

        // Create their home
        const shareCode = generateShareCode();
        const homeRes = await pool.query(
            'INSERT INTO homes (share_code, created_by) VALUES ($1, $2) RETURNING *',
            [shareCode, user.id]
        );
        const home = homeRes.rows[0];

        // Add user as owner
        await pool.query(
            'INSERT INTO home_members (home_id, user_id, role) VALUES ($1, $2, $3)',
            [home.id, user.id, 'owner']
        );

        // Create default rooms
        const defaultRooms = [
            { name: 'Kitchen', icon: 'restaurant-outline' },
            { name: 'Living Room', icon: 'tv-outline' },
            { name: 'Bedroom', icon: 'bed-outline' },
            { name: 'Bathroom', icon: 'water-outline' },
        ];

        const rooms = [];
        for (const room of defaultRooms) {
            const roomRes = await pool.query(
                'INSERT INTO rooms (home_id, name, icon, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
                [home.id, room.name, room.icon, user.id]
            );
            rooms.push(roomRes.rows[0]);
        }

        res.json({ user, home, rooms });
    } catch (err) {
        console.error('Auto-create error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Restore session from stored user code
app.post('/api/users/restore', async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required' });

    try {
        const userRes = await pool.query('SELECT * FROM users WHERE code = $1', [code]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'Code not found' });

        const user = userRes.rows[0];

        // Get their home
        const homeRes = await pool.query(
            'SELECT h.* FROM homes h JOIN home_members hm ON h.id = hm.home_id WHERE hm.user_id = $1 LIMIT 1',
            [user.id]
        );

        // Get rooms
        const roomsRes = await pool.query(
            'SELECT * FROM rooms WHERE home_id = $1 ORDER BY created_at',
            [homeRes.rows[0]?.id]
        );

        res.json({ user, home: homeRes.rows[0] || null, rooms: roomsRes.rows });
    } catch (err) {
        console.error('Restore error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// CO-LIVING
// ═══════════════════════════════════════════════════════════════

// Join a home with share code
app.post('/api/homes/join', async (req, res) => {
    const { userId, shareCode } = req.body;
    if (!userId || !shareCode) return res.status(400).json({ error: 'userId and shareCode required' });

    try {
        const homeRes = await pool.query('SELECT * FROM homes WHERE share_code = $1', [shareCode.toUpperCase()]);
        if (homeRes.rows.length === 0) return res.status(404).json({ error: 'Home not found. Check the code.' });

        const home = homeRes.rows[0];

        // Check if already a member
        const existing = await pool.query(
            'SELECT id FROM home_members WHERE home_id = $1 AND user_id = $2',
            [home.id, userId]
        );
        if (existing.rows.length > 0) return res.json({ home, message: 'Already a member' });

        await pool.query(
            'INSERT INTO home_members (home_id, user_id, role) VALUES ($1, $2, $3)',
            [home.id, userId, 'member']
        );

        const roomsRes = await pool.query('SELECT * FROM rooms WHERE home_id = $1', [home.id]);
        res.json({ home, rooms: roomsRes.rows });
    } catch (err) {
        console.error('Join home error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get home members + their usage (for transparency)
app.get('/api/homes/:homeId/members', async (req, res) => {
    const { homeId } = req.params;
    try {
        const membersRes = await pool.query(`
            SELECT u.id, u.code, hm.role, hm.joined_at,
                   COALESCE(SUM(d.watts * d.hours_per_day / 1000.0), 0) as daily_kwh
            FROM home_members hm
            JOIN users u ON hm.user_id = u.id
            LEFT JOIN devices d ON d.user_id = u.id AND d.home_id = $1
            WHERE hm.home_id = $1
            GROUP BY u.id, u.code, hm.role, hm.joined_at
        `, [homeId]);
        res.json(membersRes.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// ROOMS
// ═══════════════════════════════════════════════════════════════

app.post('/api/rooms', async (req, res) => {
    const { homeId, name, icon, userId } = req.body;
    if (!homeId || !name) return res.status(400).json({ error: 'homeId and name required' });

    try {
        const result = await pool.query(
            'INSERT INTO rooms (home_id, name, icon, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
            [homeId, name, icon || 'cube-outline', userId]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/rooms/:homeId', async (req, res) => {
    const { homeId } = req.params;
    try {
        const result = await pool.query(`
            SELECT r.*,
                   COUNT(d.id) as device_count,
                   COALESCE(SUM(d.watts * d.hours_per_day / 1000.0), 0) as daily_kwh
            FROM rooms r
            LEFT JOIN devices d ON d.room_id = r.id
            WHERE r.home_id = $1
            GROUP BY r.id
            ORDER BY r.created_at
        `, [homeId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/rooms/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM rooms WHERE id = $1', [req.params.id]);
        res.json({ message: 'Room deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// DEVICES
// ═══════════════════════════════════════════════════════════════

app.post('/api/devices', async (req, res) => {
    const { roomId, userId, homeId, name, brand, model, watts, hours_per_day, days_per_week, image_thumbnail, ai_confidence } = req.body;
    if (!roomId || !name || !watts) return res.status(400).json({ error: 'roomId, name, watts required' });

    try {
        const result = await pool.query(`
            INSERT INTO devices (room_id, user_id, home_id, name, brand, model, watts, hours_per_day, days_per_week, image_thumbnail, ai_confidence)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *
        `, [roomId, userId, homeId, name, brand, model, watts, hours_per_day || 4, days_per_week || 7, image_thumbnail, ai_confidence]);

        // Generate AI tip for this appliance (non-blocking)
        const { generateDeviceTip } = require('./services/geminiService');
        generateDeviceTip({ name, watts, hours_per_day: hours_per_day || 4, days_per_week: days_per_week || 7, userApiKey: req.header('x-api-key') || req.body.apiKey })
            .then(tip => {
                pool.query('UPDATE devices SET ai_tip = $1 WHERE id = $2', [tip, result.rows[0].id]);
                console.log(`Tip generated for ${name}: ${tip.substring(0, 60)}...`);
            })
            .catch(err => console.error('Tip gen failed:', err.message));

        // Upsert to shared RAG knowledge base
        const existingKnowledge = await pool.query(
            'SELECT id, times_confirmed, avg_hours_per_day FROM appliance_knowledge WHERE LOWER(name) = LOWER($1) AND watts = $2',
            [name, watts]
        );

        if (existingKnowledge.rows.length > 0) {
            const k = existingKnowledge.rows[0];
            const newAvg = ((parseFloat(k.avg_hours_per_day) || 4) * k.times_confirmed + (hours_per_day || 4)) / (k.times_confirmed + 1);
            await pool.query(
                'UPDATE appliance_knowledge SET times_confirmed = times_confirmed + 1, avg_hours_per_day = $1, updated_at = NOW() WHERE id = $2',
                [newAvg.toFixed(1), k.id]
            );
        } else {
            const userRes = await pool.query('SELECT city FROM users WHERE id = $1', [userId]);
            const region = userRes.rows[0]?.city || 'South Africa';
            await pool.query(
                'INSERT INTO appliance_knowledge (name, brand, model, watts, avg_hours_per_day, region) VALUES ($1, $2, $3, $4, $5, $6)',
                [name, brand, model, watts, hours_per_day || 4, region]
            );
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Device save error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/devices/room/:roomId', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM devices WHERE room_id = $1 ORDER BY created_at',
            [req.params.roomId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/devices/:id', async (req, res) => {
    const { name, watts, hours_per_day, days_per_week, roomId } = req.body;
    try {
        const result = await pool.query(`
            UPDATE devices SET name = COALESCE($1, name), watts = COALESCE($2, watts),
            hours_per_day = COALESCE($3, hours_per_day), days_per_week = COALESCE($4, days_per_week),
            room_id = COALESCE($5, room_id)
            WHERE id = $6 RETURNING *
        `, [name, watts, hours_per_day, days_per_week, roomId, req.params.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/devices/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM devices WHERE id = $1', [req.params.id]);
        res.json({ message: 'Device deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// DASHBOARD — Full data for home screen
// ═══════════════════════════════════════════════════════════════

app.get('/api/dashboard/:homeId', async (req, res) => {
    const { homeId } = req.params;
    const { userId } = req.query;

    try {
        // Get home info
        const homeRes = await pool.query('SELECT * FROM homes WHERE id = $1', [homeId]);
        if (homeRes.rows.length === 0) return res.status(404).json({ error: 'Home not found' });
        const home = homeRes.rows[0];

        // Get user info for rate calculation
        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        const user = userRes.rows[0];

        // Get electricity rate
        const rates = require('./services/ratesDatabase');
        const rateInfo = rates.getRate(user?.city || user?.province || 'Eskom Direct');

        // Get rooms with device counts and costs
        const roomsRes = await pool.query(`
            SELECT r.*,
                   COUNT(d.id)::int as device_count,
                   COALESCE(SUM(d.watts * d.hours_per_day / 1000.0), 0)::float as daily_kwh
            FROM rooms r
            LEFT JOIN devices d ON d.room_id = r.id
            WHERE r.home_id = $1
            GROUP BY r.id
            ORDER BY r.created_at
        `, [homeId]);

        // Calculate totals
        const totalDailyKwh = roomsRes.rows.reduce((sum, r) => sum + parseFloat(r.daily_kwh), 0);
        const totalDailyCost = totalDailyKwh * rateInfo.rate;
        const totalMonthlyCost = totalDailyCost * 30;
        const totalDevices = roomsRes.rows.reduce((sum, r) => sum + parseInt(r.device_count), 0);

        // Add cost to each room
        const rooms = roomsRes.rows.map(r => ({
            ...r,
            daily_cost: (parseFloat(r.daily_kwh) * rateInfo.rate).toFixed(2),
        }));

        // Member count
        const memberCount = await pool.query('SELECT COUNT(*)::int as count FROM home_members WHERE home_id = $1', [homeId]);

        res.json({
            home,
            rooms,
            stats: {
                totalDevices,
                totalDailyKwh: parseFloat(totalDailyKwh.toFixed(2)),
                totalDailyCost: parseFloat(totalDailyCost.toFixed(2)),
                totalMonthlyCost: parseFloat(totalMonthlyCost.toFixed(2)),
                ratePerKwh: rateInfo.rate,
                municipality: rateInfo.municipality,
                memberCount: memberCount.rows[0].count,
            },
            budget: {
                monthly: parseFloat(home.monthly_budget) || null,
                remaining: parseFloat(home.budget_remaining) || null,
                percentUsed: home.monthly_budget
                    ? Math.min(100, Math.round((totalMonthlyCost / parseFloat(home.monthly_budget)) * 100))
                    : null,
            },
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// AI SCAN — AI identifies, then RAG verifies/overrides
// ═══════════════════════════════════════════════════════════════

app.post('/api/scan', async (req, res) => {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

    try {
        // Step 1: AI identifies what the appliance IS from the image
        const { analyzeDeviceImage } = require('./services/geminiService');
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        const aiResult = await analyzeDeviceImage(imageBuffer, mimeType || 'image/jpeg', req.header('x-api-key') || req.body.apiKey);

        // Step 2: Check RAG knowledge base for community-verified data
        // Search multiple ways for best match
        let ragMatch = null;
        if (aiResult.name || aiResult.brand) {
            // Try exact brand+model match first (highest quality)
            if (aiResult.brand && aiResult.model) {
                const exactRes = await pool.query(`
                    SELECT * FROM appliance_knowledge
                    WHERE LOWER(brand) = LOWER($1) AND LOWER(model) = LOWER($2)
                    AND times_confirmed >= 1
                    ORDER BY times_confirmed DESC LIMIT 1
                `, [aiResult.brand, aiResult.model]);
                if (exactRes.rows.length > 0) ragMatch = exactRes.rows[0];
            }

            // Try name-based fuzzy match (split words for better matching)
            if (!ragMatch) {
                const searchTerms = (aiResult.name || '').split(/[\s\-\/]+/).filter(w => w.length > 2);
                const searchBrand = aiResult.brand || '';

                // Search by brand first, then by name words
                const ragRes = await pool.query(`
                    SELECT * FROM appliance_knowledge
                    WHERE (
                        LOWER(brand) = LOWER($1)
                        OR LOWER(name) LIKE LOWER($2)
                        OR LOWER(name) LIKE LOWER($3)
                    )
                    AND times_confirmed >= 1
                    ORDER BY times_confirmed DESC
                    LIMIT 3
                `, [
                    searchBrand,
                    `%${aiResult.name || ''}%`,
                    searchTerms.length > 0 ? `%${searchTerms[0]}%` : '%%'
                ]);

                // Pick the best match: prefer high confirmation count, then matching watts range
                if (ragRes.rows.length > 0) {
                    // If any have 2+ confirmations, prefer those
                    const confirmed = ragRes.rows.filter(r => r.times_confirmed >= 2);
                    ragMatch = confirmed.length > 0 ? confirmed[0] : ragRes.rows[0];
                }
            }
        }

        // Step 3: Build result — use RAG data when community has verified (2+ users)
        const useRagWatts = ragMatch && ragMatch.times_confirmed >= 2;
        const useRagHours = ragMatch && ragMatch.avg_hours_per_day && ragMatch.times_confirmed >= 2;

        const result = {
            name: aiResult.name,
            brand: aiResult.brand || (ragMatch ? ragMatch.brand : null),
            model: aiResult.model || (ragMatch ? ragMatch.model : null),
            watts: useRagWatts ? ragMatch.watts : aiResult.watts,
            hours_per_day: useRagHours ? parseFloat(ragMatch.avg_hours_per_day) : (aiResult.hours_per_day || 4),
            days_per_week: aiResult.days_per_week || 7,
            confidence: useRagWatts ? 'HIGH' : (aiResult.confidence || 'MEDIUM'),
            ragConfirmed: ragMatch ? ragMatch.times_confirmed : 0,
            source: useRagWatts ? 'community' : 'ai',
        };

        console.log(`Scan result: ${result.name} | ${result.watts}W | source: ${result.source} | RAG: ${result.ragConfirmed} confirmations`);
        res.json(result);
    } catch (err) {
        console.error('Scan error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// AI ADVISOR — Energy consultant chat
// ═══════════════════════════════════════════════════════════════

app.post('/api/advisor/chat', async (req, res) => {
    const { userId, message, homeId } = req.body;
    if (!userId || !message) return res.status(400).json({ error: 'userId and message required' });

    try {
        // Save user message
        await pool.query(
            'INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)',
            [userId, 'user', message]
        );

        // Get user context (including lifestyle_context)
        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        const user = userRes.rows[0];

        // Get all devices in home
        const devicesRes = await pool.query(`
            SELECT d.name, d.watts, d.hours_per_day, d.brand, r.name as room_name
            FROM devices d
            JOIN rooms r ON d.room_id = r.id
            WHERE d.home_id = $1
            ORDER BY d.watts DESC
        `, [homeId || 0]);

        // Get rate info
        const rates = require('./services/ratesDatabase');
        const rateInfo = rates.getRate(user?.city || user?.province);
        const seasonalInfo = rates.getSeasonalRate(user?.city || user?.province);

        // Get recent chat history (last 10 messages for context)
        const historyRes = await pool.query(
            'SELECT role, content FROM chat_messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
            [userId]
        );
        const history = historyRes.rows.reverse();

        // Build device summary
        const deviceSummary = devicesRes.rows.map(d => {
            const dailyKwh = (d.watts * d.hours_per_day) / 1000;
            const dailyCost = dailyKwh * rateInfo.rate;
            return `${d.name} (${d.room_name}): ${d.watts}W × ${d.hours_per_day}h/day = ${dailyKwh.toFixed(2)} kWh/day = R${dailyCost.toFixed(2)}/day`;
        }).join('\n');

        const totalDailyKwh = devicesRes.rows.reduce((sum, d) => sum + (d.watts * d.hours_per_day / 1000), 0);

        const { extractLifestyleFromChat } = require('./services/geminiService');
        const { executeResilienceCrew } = require('./services/crewService');

        // Get live inverter data if connected
        let inverterData = null;
        try {
            const invRes = await pool.query(
                'SELECT * FROM inverter_readings WHERE home_id = $1 ORDER BY recorded_at DESC LIMIT 1',
                [homeId || 0]
            );
            if (invRes.rows.length > 0) inverterData = invRes.rows[0];
        } catch (e) { /* no inverter table yet */ }

        // 🚀 Execute the 5-Agent Crew
        const crewResult = await executeResilienceCrew(
            homeId,
            pool,
            message,
            user?.lifestyle_context || '',
            inverterData,
            rateInfo
        );
        const reply = crewResult.reply;

        // Save assistant reply
        await pool.query(
            'INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)',
            [userId, 'assistant', reply]
        );

        // Extract lifestyle insights from the user's message (async, non-blocking)
        extractLifestyleFromChat(message, user?.lifestyle_context || '').then(async (result) => {
            if (result.found && result.updatedContext) {
                try {
                    await pool.query(
                        'UPDATE users SET lifestyle_context = $1 WHERE id = $2',
                        [result.updatedContext, userId]
                    );
                    console.log(`📝 Updated lifestyle for user ${userId}:`, result.facts);
                } catch (e) {
                    console.error('Lifestyle save error:', e.message);
                }
            }
        }).catch(e => console.error('Lifestyle extraction failed:', e.message));

        res.json({ reply });
    } catch (err) {
        console.error('Advisor error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// BUDGET
// ═══════════════════════════════════════════════════════════════

app.put('/api/homes/:homeId/budget', async (req, res) => {
    const { monthlyBudget, budgetRemaining } = req.body;
    try {
        const result = await pool.query(
            'UPDATE homes SET monthly_budget = $1, budget_remaining = COALESCE($2, $1) WHERE id = $3 RETURNING *',
            [monthlyBudget, budgetRemaining, req.params.homeId]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// RAG — Search knowledge base
// ═══════════════════════════════════════════════════════════════

app.get('/api/knowledge/search', async (req, res) => {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'query required' });

    try {
        const result = await pool.query(`
            SELECT * FROM appliance_knowledge
            WHERE LOWER(name) LIKE LOWER($1) OR LOWER(brand) LIKE LOWER($1)
            ORDER BY times_confirmed DESC
            LIMIT 10
        `, [`%${query}%`]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// METER TRACKING — Electricity consumption & predictions
// ═══════════════════════════════════════════════════════════════

// Save meter number to home
app.put('/api/homes/:homeId/meter', async (req, res) => {
    const { meterNumber } = req.body;
    if (!meterNumber) return res.status(400).json({ error: 'meterNumber required' });
    try {
        const result = await pool.query(
            'UPDATE homes SET meter_number = $1 WHERE id = $2 RETURNING *',
            [meterNumber, req.params.homeId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Home not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Log an electricity purchase
app.post('/api/meter/purchase', async (req, res) => {
    const { homeId, userId, amountRand, notes } = req.body;
    if (!homeId || !amountRand) return res.status(400).json({ error: 'homeId and amountRand required' });

    try {
        // Get user's rate to calculate kWh
        const userRes = await pool.query('SELECT city, province FROM users WHERE id = $1', [userId]);
        const user = userRes.rows[0];
        const rates = require('./services/ratesDatabase');
        const rateInfo = rates.getRate(user?.city || user?.province);

        const kwhPurchased = parseFloat((amountRand / rateInfo.rate).toFixed(2));

        const result = await pool.query(`
            INSERT INTO electricity_purchases (home_id, user_id, amount_rand, kwh_purchased, rate_per_kwh, notes)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
        `, [homeId, userId, amountRand, kwhPurchased, rateInfo.rate, notes || null]);

        res.json({
            purchase: result.rows[0],
            kwhPurchased,
            rateUsed: rateInfo.rate,
            municipality: rateInfo.municipality,
        });
    } catch (err) {
        console.error('Purchase log error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Sync the physical meter reading
app.post('/api/meter/sync', async (req, res) => {
    const { homeId, userId, kwhRemaining, notes } = req.body;
    if (!homeId || kwhRemaining === undefined) return res.status(400).json({ error: 'homeId and kwhRemaining required' });

    try {
        // Insert a special sync record. We set amount_rand = 0 because it's just a balance adjustment.
        const result = await pool.query(`
            INSERT INTO electricity_purchases (home_id, user_id, amount_rand, kwh_purchased, rate_per_kwh, notes)
            VALUES ($1, $2, 0, $3, 0, $4) RETURNING *
        `, [homeId, userId, kwhRemaining, 'SYNC_RECORD']);

        res.json({ success: true, syncRecord: result.rows[0] });
    } catch (err) {
        console.error('Meter sync error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get meter status: remaining kWh, daily consumption, days remaining prediction
app.get('/api/meter/status/:homeId', async (req, res) => {
    const { homeId } = req.params;
    const { userId } = req.query;

    try {
        // Get user rate info
        const userRes = await pool.query('SELECT city, province FROM users WHERE id = $1', [userId]);
        const user = userRes.rows[0];
        const rates = require('./services/ratesDatabase');
        const rateInfo = rates.getRate(user?.city || user?.province);

        // Get daily consumption from all devices in this home
        const devicesRes = await pool.query(`
            SELECT COALESCE(SUM(d.watts * d.hours_per_day / 1000.0), 0)::float as daily_kwh
            FROM devices d WHERE d.home_id = $1
        `, [homeId]);
        const dailyConsumption = devicesRes.rows[0].daily_kwh;

        // Check for the most recent SYNC_RECORD
        const syncRes = await pool.query(`
            SELECT kwh_purchased, purchased_at FROM electricity_purchases 
            WHERE home_id = $1 AND notes = 'SYNC_RECORD' 
            ORDER BY purchased_at DESC LIMIT 1
        `, [homeId]);

        let baseDate;
        let baseKwh = 0;

        if (syncRes.rows.length > 0) {
            // We have a sync record! Use its timestamp and kWh as the baseline.
            baseDate = syncRes.rows[0].purchased_at;
            baseKwh = syncRes.rows[0].kwh_purchased;

            // Add any purchases made AFTER the sync date
            const recentPurchases = await pool.query(`
                SELECT COALESCE(SUM(kwh_purchased), 0)::float as recent_kwh 
                FROM electricity_purchases 
                WHERE home_id = $1 AND notes != 'SYNC_RECORD' AND purchased_at > $2
            `, [homeId, baseDate]);
            baseKwh += recentPurchases.rows[0].recent_kwh;
        } else {
            // No sync record. Fall back to the very first purchase date.
            const firstPurchaseRes = await pool.query(
                "SELECT MIN(purchased_at) as first_purchase FROM electricity_purchases WHERE home_id = $1 AND notes != 'SYNC_RECORD'",
                [homeId]
            );
            baseDate = firstPurchaseRes.rows[0].first_purchase;

            // Get all normal purchases
            const allPurchases = await pool.query(
                "SELECT COALESCE(SUM(kwh_purchased), 0)::float as total_kwh FROM electricity_purchases WHERE home_id = $1 AND notes != 'SYNC_RECORD'",
                [homeId]
            );
            baseKwh = allPurchases.rows[0].total_kwh;
        }

        let daysElapsed = 0;
        let estimatedConsumed = 0;
        let kwhRemaining = baseKwh;
        let daysRemaining = 0;
        let percentRemaining = 100;
        let totalPurchased = baseKwh; // Define for fallback calculations

        if (baseDate && dailyConsumption > 0) {
            daysElapsed = Math.max(0, (Date.now() - new Date(baseDate).getTime()) / (1000 * 60 * 60 * 24));
            estimatedConsumed = dailyConsumption * daysElapsed;
            kwhRemaining = Math.max(0, baseKwh - estimatedConsumed);
            daysRemaining = dailyConsumption > 0 ? kwhRemaining / dailyConsumption : 999;
            percentRemaining = totalPurchased > 0 ? Math.min(100, Math.max(0, (kwhRemaining / totalPurchased) * 100)) : 100;
        } else if (dailyConsumption === 0 && totalPurchased > 0) {
            kwhRemaining = totalPurchased;
            daysRemaining = -1;
        }

        const homeRes = await pool.query('SELECT meter_number FROM homes WHERE id = $1', [homeId]);

        const historyRes = await pool.query(
            "SELECT * FROM electricity_purchases WHERE home_id = $1 AND notes != 'SYNC_RECORD' ORDER BY purchased_at DESC LIMIT 5",
            [homeId]
        );

        res.json({
            meterNumber: homeRes.rows[0]?.meter_number || null,
            totalPurchasedKwh: baseKwh,
            dailyConsumptionKwh: dailyConsumption,
            estimatedConsumedKwh: parseFloat(estimatedConsumed.toFixed(2)),
            kwhRemaining: parseFloat(kwhRemaining.toFixed(2)),
            daysRemaining: Math.floor(daysRemaining),
            percentRemaining: Math.round(percentRemaining),
            dailyCostRand: parseFloat((dailyConsumption * rateInfo.rate).toFixed(2)),
            ratePerKwh: rateInfo.rate,
            municipality: rateInfo.municipality,
            daysElapsed: Math.round(daysElapsed),
            recentPurchases: historyRes.rows,
        });

        res.json({
            meterNumber: homeRes.rows[0]?.meter_number || null,
            totalPurchasedKwh: parseFloat(totalPurchased.toFixed(2)),
            dailyConsumptionKwh: parseFloat(dailyConsumption.toFixed(2)),
            estimatedConsumedKwh: parseFloat(estimatedConsumed.toFixed(2)),
            kwhRemaining: parseFloat(kwhRemaining.toFixed(2)),
            daysRemaining,
            percentRemaining,
            dailyCostRand: parseFloat((dailyConsumption * rateInfo.rate).toFixed(2)),
            ratePerKwh: rateInfo.rate,
            municipality: rateInfo.municipality,
            daysElapsed,
            recentPurchases: recentRes.rows,
        });
    } catch (err) {
        console.error('Meter status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Purchase history
app.get('/api/meter/history/:homeId', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM electricity_purchases WHERE home_id = $1 ORDER BY purchased_at DESC LIMIT 30',
            [req.params.homeId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// AI tips for extending electricity
app.post('/api/meter/tips', async (req, res) => {
    const { homeId, userId, kwhRemaining, daysRemaining, dailyConsumption } = req.body;
    if (!homeId) return res.status(400).json({ error: 'homeId required' });

    try {
        // Get all devices ordered by consumption (highest first)
        const devicesRes = await pool.query(`
            SELECT d.name, d.watts, d.hours_per_day, r.name as room_name,
                   (d.watts * d.hours_per_day / 1000.0) as daily_kwh
            FROM devices d
            JOIN rooms r ON d.room_id = r.id
            WHERE d.home_id = $1
            ORDER BY (d.watts * d.hours_per_day) DESC
        `, [homeId]);

        // Get rate info
        const userRes = await pool.query('SELECT city, province FROM users WHERE id = $1', [userId]);
        const user = userRes.rows[0];
        const rates = require('./services/ratesDatabase');
        const rateInfo = rates.getRate(user?.city || user?.province);

        const { consultantChat } = require('./services/geminiService');
        const deviceList = devicesRes.rows.map(d =>
            `${d.name} (${d.room_name}): ${d.watts}W × ${d.hours_per_day}h = ${parseFloat(d.daily_kwh).toFixed(2)} kWh/day`
        ).join('\n');

        const tipPrompt = `I have ${kwhRemaining?.toFixed(1) || '?'} kWh remaining and my electricity will last approximately ${daysRemaining || '?'} more days. ` +
            `I use ${dailyConsumption?.toFixed(1) || '?'} kWh per day. My rate is R${rateInfo.rate}/kWh. ` +
            `Give me 3-5 specific, actionable tips to make my electricity last longer. ` +
            `Reference my specific appliances and tell me exactly how many extra days each tip would add.`;

        const tips = await consultantChat({
            message: tipPrompt,
            history: [],
            deviceSummary: deviceList,
            totalDailyKwh: dailyConsumption || 0,
            ratePerKwh: rateInfo.rate,
            municipality: rateInfo.municipality,
            season: (new Date().getMonth() >= 4 && new Date().getMonth() <= 7) ? 'WINTER' : 'SUMMER',
            city: user?.city,
            province: user?.province,
            userApiKey: req.header('x-api-key') || req.query.apiKey,
        });

        res.json({ tips });
    } catch (err) {
        console.error('Meter tips error:', err);
        res.status(500).json({ error: 'Failed to get tips. Try again later.' });
    }
});

// ═══════════════════════════════════════════════════════════════
// AGENT — Advanced Budget Prediction & Scheduling
// ═══════════════════════════════════════════════════════════════

app.get('/api/agent/predict', async (req, res) => {
    const { homeId } = req.query;
    if (!homeId) return res.status(400).json({ error: 'homeId required' });

    try {
        // Get all devices for this home
        const devicesRes = await pool.query(
            'SELECT name, watts, hours_per_day, days_per_week FROM devices WHERE home_id = $1',
            [homeId]
        );

        // Get home budget info
        const homeRes = await pool.query(
            'SELECT monthly_budget, meter_number FROM homes WHERE id = $1',
            [homeId]
        );
        const home = homeRes.rows[0];

        // Get latest meter sync balance
        let meterBalance = null;
        try {
            const syncRes = await pool.query(
                `SELECT kwh_purchased FROM electricity_purchases WHERE home_id = $1 AND notes = 'SYNC_RECORD' ORDER BY purchased_at DESC LIMIT 1`,
                [homeId]
            );
            if (syncRes.rows.length > 0) meterBalance = parseFloat(syncRes.rows[0].kwh_purchased);
        } catch (e) { /* no sync data */ }

        // Calculate days left in month
        const now = new Date();
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const daysLeft = lastDay - now.getDate();

        // Get rate
        const ratePerKwh = 3.2; // fallback SA average rate

        // Get live inverter data if connected
        let inverterData = null;
        try {
            const invRes = await pool.query(
                'SELECT * FROM inverter_readings WHERE home_id = $1 ORDER BY recorded_at DESC LIMIT 1',
                [homeId]
            );
            if (invRes.rows.length > 0) inverterData = invRes.rows[0];
        } catch (e) { /* no inverter table yet */ }

        // 🧠 Fetch Community Intelligence (RAG Context)
        let communityInsights = null;
        try {
            const meshRes = await pool.query(
                `SELECT topic, context_data FROM community_intelligence ORDER BY created_at DESC LIMIT 5`
            );
            if (meshRes.rows.length > 0) {
                communityInsights = meshRes.rows.map(r => ({ topic: r.topic, insight: r.context_data }));
            }
        } catch (e) {
            console.log("Mesh fetch skipped/failed:", e.message);
        }

        const { agentPredict } = require('./services/geminiService');
        const prediction = await agentPredict({
            devices: devicesRes.rows,
            monthlyBudget: home?.monthly_budget,
            meterBalance,
            daysLeftInMonth: daysLeft,
            ratePerKwh,
            inverterData,
            communityInsights, // ⚠️ Pass the Mesh Context here
            userApiKey: req.header('x-api-key') || req.query.apiKey,
        });

        res.json(prediction);
    } catch (err) {
        console.error('Agent predict error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// LIVE METER — Calculated estimation from sync + device draw
// ═══════════════════════════════════════════════════════════════

app.get('/api/meter/live', async (req, res) => {
    const { homeId } = req.query;
    if (!homeId) return res.status(400).json({ error: 'homeId required' });

    try {
        // Get latest meter sync
        const syncRes = await pool.query(
            `SELECT kwh_purchased, purchased_at FROM electricity_purchases 
             WHERE home_id = $1 AND notes = 'SYNC_RECORD' 
             ORDER BY purchased_at DESC LIMIT 1`,
            [homeId]
        );

        let lastSyncDate = null;
        let syncedKwh = 0;
        let totalTopUps = 0;

        if (syncRes.rows.length > 0) {
            syncedKwh = parseFloat(syncRes.rows[0].kwh_purchased);
            lastSyncDate = syncRes.rows[0].purchased_at;

            // Add any top-ups purchased after the sync
            const topUpsRes = await pool.query(
                `SELECT COALESCE(SUM(kwh_purchased), 0) as total FROM electricity_purchases 
                 WHERE home_id = $1 AND notes != 'SYNC_RECORD' AND purchased_at > $2`,
                [homeId, lastSyncDate]
            );
            totalTopUps = parseFloat(topUpsRes.rows[0].total) || 0;
        }

        // Calculate total daily usage from all devices
        const devicesRes = await pool.query(
            'SELECT watts, hours_per_day, days_per_week FROM devices WHERE home_id = $1',
            [homeId]
        );

        const totalDailyKwh = devicesRes.rows.reduce((sum, d) => {
            const weeklyFactor = (parseFloat(d.days_per_week) || 7) / 7;
            return sum + (d.watts * parseFloat(d.hours_per_day) / 1000) * weeklyFactor;
        }, 0);

        // Days since last sync
        const daysSinceSync = lastSyncDate
            ? Math.max(0, (Date.now() - new Date(lastSyncDate).getTime()) / (1000 * 60 * 60 * 24))
            : 0;

        // Estimated remaining = synced + topups - (daily usage × days elapsed)
        const consumed = totalDailyKwh * daysSinceSync;
        const estimatedKwh = Math.max(0, (syncedKwh + totalTopUps) - consumed);
        const daysLeft = totalDailyKwh > 0 ? Math.max(0, estimatedKwh / totalDailyKwh) : 999;

        // Accuracy degrades over time
        let accuracy = 'high';
        if (daysSinceSync > 7) accuracy = 'medium';
        if (daysSinceSync > 14) accuracy = 'low';
        if (!lastSyncDate) accuracy = 'none';

        res.json({
            estimatedKwh: Math.round(estimatedKwh * 10) / 10,
            daysLeft: Math.round(daysLeft * 10) / 10,
            totalDailyKwh: Math.round(totalDailyKwh * 100) / 100,
            dailyCost: Math.round(totalDailyKwh * 3.2 * 100) / 100,
            lastSyncDate,
            daysSinceSync: Math.round(daysSinceSync * 10) / 10,
            accuracy,
            deviceCount: devicesRes.rows.length,
        });
    } catch (err) {
        console.error('Live meter error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// INVERTER INTEGRATION — Solar / Battery / Grid real-time data
// ═══════════════════════════════════════════════════════════════

// Setup inverter connection
app.post('/api/inverter/setup', async (req, res) => {
    const { homeId, brand, username, password, apiToken } = req.body;
    if (!homeId || !brand) return res.status(400).json({ error: 'homeId and brand required' });

    try {
        const { validateInverterSetup, encrypt } = require('./services/inverterService');

        // Validate credentials first
        const plantInfo = await validateInverterSetup(brand, username, password, apiToken);

        // Encrypt password if provided
        const passwordEnc = password ? encrypt(password) : null;

        // Remove any existing config for this home
        await pool.query('DELETE FROM inverter_configs WHERE home_id = $1', [homeId]);

        // Insert new config
        const result = await pool.query(`
            INSERT INTO inverter_configs (home_id, brand, username, password_enc, api_token, plant_id, inverter_sn)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, brand, plant_id, inverter_sn, is_active, created_at
        `, [homeId, brand.toLowerCase(), username, passwordEnc, apiToken, plantInfo.plantId, plantInfo.inverterSn]);

        console.log(`🔌 Inverter connected: ${brand} for home ${homeId} (plant: ${plantInfo.plantName})`);

        res.json({
            config: result.rows[0],
            plant: plantInfo,
        });
    } catch (err) {
        console.error('Inverter setup error:', err.message);
        res.status(400).json({ error: `Connection failed: ${err.message}` });
    }
});

// Get inverter status (latest reading + config)
app.get('/api/inverter/status/:homeId', async (req, res) => {
    const { homeId } = req.params;

    try {
        const configRes = await pool.query(
            'SELECT id, brand, plant_id, inverter_sn, is_active, last_poll_at, created_at FROM inverter_configs WHERE home_id = $1 AND is_active = true',
            [homeId]
        );

        if (configRes.rows.length === 0) {
            return res.json({ connected: false, config: null, latestReading: null });
        }

        const config = configRes.rows[0];

        // Get latest reading
        const readingRes = await pool.query(
            'SELECT * FROM inverter_readings WHERE home_id = $1 ORDER BY recorded_at DESC LIMIT 1',
            [homeId]
        );

        res.json({
            connected: true,
            config,
            latestReading: readingRes.rows[0] || null,
        });
    } catch (err) {
        console.error('Inverter status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Force a fresh poll
app.post('/api/inverter/poll/:homeId', async (req, res) => {
    const { homeId } = req.params;

    try {
        const configRes = await pool.query(
            'SELECT * FROM inverter_configs WHERE home_id = $1 AND is_active = true',
            [homeId]
        );

        if (configRes.rows.length === 0) {
            return res.status(404).json({ error: 'No inverter configured' });
        }

        const config = configRes.rows[0];
        const { getInverterData } = require('./services/inverterService');
        const data = await getInverterData(config);

        // Insert reading
        await pool.query(`
            INSERT INTO inverter_readings (home_id, battery_soc, battery_power, pv_power, grid_power, load_power,
                daily_pv_kwh, daily_grid_import_kwh, daily_grid_export_kwh, daily_load_kwh)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [homeId, data.batterySoc, data.batteryPower, data.pvPower, data.gridPower, data.loadPower,
            data.dailyPvKwh, data.dailyGridImportKwh, data.dailyGridExportKwh, data.dailyLoadKwh]);

        // Update last_poll_at
        await pool.query('UPDATE inverter_configs SET last_poll_at = NOW() WHERE id = $1', [config.id]);

        console.log(`⚡ Polled ${config.brand} for home ${homeId}: PV=${data.pvPower}W, Battery=${data.batterySoc}%, Load=${data.loadPower}W`);
        res.json(data);
    } catch (err) {
        console.error('Inverter poll error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Get 24h history for charts
app.get('/api/inverter/history/:homeId', async (req, res) => {
    const { homeId } = req.params;

    try {
        const result = await pool.query(`
            SELECT battery_soc, battery_power, pv_power, grid_power, load_power,
                   daily_pv_kwh, daily_grid_import_kwh, daily_grid_export_kwh, daily_load_kwh, recorded_at
            FROM inverter_readings
            WHERE home_id = $1 AND recorded_at > NOW() - INTERVAL '24 hours'
            ORDER BY recorded_at ASC
        `, [homeId]);

        res.json(result.rows);
    } catch (err) {
        console.error('Inverter history error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Disconnect inverter
app.delete('/api/inverter/disconnect/:homeId', async (req, res) => {
    const { homeId } = req.params;

    try {
        await pool.query('UPDATE inverter_configs SET is_active = false WHERE home_id = $1', [homeId]);
        console.log(`🔌 Inverter disconnected for home ${homeId}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// INVERTER CONTROL — Manual + AI-driven settings
// ═══════════════════════════════════════════════════════════════

// Manual control action
app.post('/api/inverter/control', async (req, res) => {
    const { homeId, action, params } = req.body;
    if (!homeId || !action) return res.status(400).json({ error: 'homeId and action required' });

    try {
        const configRes = await pool.query(
            'SELECT * FROM inverter_configs WHERE home_id = $1 AND is_active = true',
            [homeId]
        );
        if (configRes.rows.length === 0) return res.status(404).json({ error: 'No inverter configured' });

        const config = configRes.rows[0];
        const { controlInverter } = require('./services/inverterService');
        const result = await controlInverter(config, action, params);

        // Log to optimization_schedules
        await pool.query(`
            INSERT INTO optimization_schedules (home_id, schedule_type, parameters, reasoning, confidence, applied_at, applied_by, status)
            VALUES ($1, $2, $3, $4, 1.0, NOW(), 'user', 'applied')
        `, [homeId, action, JSON.stringify(params), 'Manual user action']);

        console.log(`🎮 Manual control: ${action} for home ${homeId}`);
        res.json({ success: true, result });
    } catch (err) {
        console.error('Inverter control error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// AI Optimizer: analyze and return recommendations (no auto-apply)
app.get('/api/optimizer/analyze/:homeId', async (req, res) => {
    const { homeId } = req.params;

    try {
        const { runOptimizer } = require('./services/optimizerAgent');
        const analysis = await runOptimizer(pool, parseInt(homeId));
        console.log(`🧠 Optimizer analyzed home ${homeId} (confidence: ${(analysis.confidence * 100).toFixed(0)}%)`);
        res.json(analysis);
    } catch (err) {
        console.error('Optimizer error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Apply a specific AI recommendation
app.post('/api/optimizer/apply/:homeId', async (req, res) => {
    const { homeId } = req.params;
    const { scheduleId, action, params } = req.body;

    try {
        const configRes = await pool.query(
            'SELECT * FROM inverter_configs WHERE home_id = $1 AND is_active = true',
            [homeId]
        );
        if (configRes.rows.length === 0) return res.status(404).json({ error: 'No inverter configured' });

        const config = configRes.rows[0];
        const { controlInverter } = require('./services/inverterService');
        const result = await controlInverter(config, action, params);

        // Update schedule status
        if (scheduleId) {
            await pool.query(
                'UPDATE optimization_schedules SET status = $1, applied_at = NOW(), applied_by = $2 WHERE id = $3',
                ['applied', 'user_approved', scheduleId]
            );
        } else {
            await pool.query(`
                INSERT INTO optimization_schedules (home_id, schedule_type, parameters, reasoning, confidence, applied_at, applied_by, status)
                VALUES ($1, $2, $3, 'User applied AI recommendation', 0.9, NOW(), 'user_approved', 'applied')
            `, [homeId, action, JSON.stringify(params)]);
        }

        console.log(`✅ Applied AI recommendation: ${action} for home ${homeId}`);
        res.json({ success: true, result });
    } catch (err) {
        console.error('Apply error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Enable/disable auto-optimization
app.post('/api/optimizer/auto-enable/:homeId', async (req, res) => {
    const { homeId } = req.params;
    const { enabled } = req.body;

    try {
        // Store auto-optimization preference in inverter_configs
        await pool.query(
            'UPDATE inverter_configs SET api_token = api_token WHERE home_id = $1',
            [homeId]
        );

        // Use a flag in a separate column — add a JSONB settings column approach
        // For now, store in optimization_schedules as a meta record
        await pool.query(
            `INSERT INTO optimization_schedules (home_id, schedule_type, parameters, reasoning, confidence, status)
             VALUES ($1, 'auto_mode', $2, $3, 1.0, $4)`,
            [homeId, JSON.stringify({ enabled }), enabled ? 'Auto-optimization enabled' : 'Auto-optimization disabled', enabled ? 'applied' : 'disabled']
        );

        console.log(`🤖 Auto-optimization ${enabled ? 'ENABLED' : 'DISABLED'} for home ${homeId}`);
        res.json({ success: true, autoEnabled: enabled });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Optimization history
app.get('/api/optimizer/history/:homeId', async (req, res) => {
    const { homeId } = req.params;

    try {
        const result = await pool.query(`
            SELECT id, schedule_type, parameters, reasoning, confidence, applied_at, applied_by, status, created_at
            FROM optimization_schedules
            WHERE home_id = $1
            ORDER BY created_at DESC
            LIMIT 50
        `, [homeId]);

        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Community insights (anonymized cross-household data)
app.get('/api/optimizer/community-insights', async (req, res) => {
    try {
        const { getCommunityInsights } = require('./services/optimizerAgent');
        const insights = await getCommunityInsights(pool, 0);
        res.json(insights);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// BACKGROUND POLLING — Fetch inverter data every 5 minutes
// ═══════════════════════════════════════════════════════════════

async function pollAllInverters() {
    try {
        const configs = await pool.query('SELECT * FROM inverter_configs WHERE is_active = true');
        if (configs.rows.length === 0) return;

        const { getInverterData } = require('./services/inverterService');

        for (const config of configs.rows) {
            try {
                const data = await getInverterData(config);

                await pool.query(`
                    INSERT INTO inverter_readings (home_id, battery_soc, battery_power, pv_power, grid_power, load_power,
                        daily_pv_kwh, daily_grid_import_kwh, daily_grid_export_kwh, daily_load_kwh)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                `, [config.home_id, data.batterySoc, data.batteryPower, data.pvPower, data.gridPower, data.loadPower,
                data.dailyPvKwh, data.dailyGridImportKwh, data.dailyGridExportKwh, data.dailyLoadKwh]);

                await pool.query('UPDATE inverter_configs SET last_poll_at = NOW() WHERE id = $1', [config.id]);

                console.log(`⚡ Auto-poll: ${config.brand} home=${config.home_id} PV=${data.pvPower}W SOC=${data.batterySoc}%`);
            } catch (err) {
                console.error(`Poll failed for home ${config.home_id} (${config.brand}):`, err.message);
            }
        }

        // Cleanup: remove readings older than 7 days
        await pool.query("DELETE FROM inverter_readings WHERE recorded_at < NOW() - INTERVAL '7 days'");
    } catch (err) {
        console.error('Background poll error:', err.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// NIGHTLY OPTIMIZER — Auto-optimize at 10 PM
// ═══════════════════════════════════════════════════════════════

async function nightlyOptimization() {
    try {
        // Find homes with auto-optimization enabled
        const autoHomes = await pool.query(`
            SELECT DISTINCT home_id
            FROM optimization_schedules
            WHERE schedule_type = 'auto_mode'
            AND parameters->>'enabled' = 'true'
            AND status = 'applied'
            ORDER BY home_id
        `);

        if (autoHomes.rows.length === 0) return;

        const { runOptimizer } = require('./services/optimizerAgent');
        const { controlInverter } = require('./services/inverterService');

        for (const row of autoHomes.rows) {
            try {
                // Run optimizer
                const analysis = await runOptimizer(pool, row.home_id);

                if (analysis.confidence < 0.6) {
                    console.log(`⚠️ Skipping auto-apply for home ${row.home_id}: confidence too low (${(analysis.confidence * 100).toFixed(0)}%)`);
                    continue;
                }

                // Get inverter config
                const configRes = await pool.query(
                    'SELECT * FROM inverter_configs WHERE home_id = $1 AND is_active = true',
                    [row.home_id]
                );
                if (configRes.rows.length === 0) continue;
                const config = configRes.rows[0];

                // Apply each recommendation
                for (const rec of (analysis.recommendations || [])) {
                    try {
                        await controlInverter(config, rec.action, rec.params);
                        await pool.query(`
                            UPDATE optimization_schedules
                            SET status = 'applied', applied_at = NOW(), applied_by = 'auto_optimizer'
                            WHERE home_id = $1 AND schedule_type = $2 AND status = 'pending'
                            AND created_at > NOW() - INTERVAL '1 hour'
                        `, [row.home_id, rec.action]);

                        console.log(`🤖 Auto-applied: ${rec.action} for home ${row.home_id}`);
                    } catch (err) {
                        console.error(`Auto-apply failed for ${rec.action}:`, err.message);
                    }
                }
            } catch (err) {
                console.error(`Nightly optimization failed for home ${row.home_id}:`, err.message);
            }
        }
    } catch (err) {
        console.error('Nightly optimization error:', err.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// SOLAR ROI — Savings, payback, performance tracking
// ═══════════════════════════════════════════════════════════════

app.get('/api/solar-roi/:homeId', async (req, res) => {
    const { homeId } = req.params;

    try {
        // Get inverter config
        const configRes = await pool.query(
            'SELECT * FROM inverter_configs WHERE home_id = $1 AND is_active = true', [homeId]
        );
        if (configRes.rows.length === 0) {
            return res.json({ hasSolar: false });
        }

        // Get tariff rate
        const rateRes = await pool.query(
            'SELECT rate_per_kwh FROM tariff_configs WHERE home_id = $1 ORDER BY created_at DESC LIMIT 1', [homeId]
        );
        const rate = parseFloat(rateRes.rows[0]?.rate_per_kwh || 2.5);

        // Get system cost from config metadata (or use estimate)
        const config = configRes.rows[0];
        const systemCost = parseFloat(config.system_cost || 150000); // default R150k

        // Last 30 days PV generation
        const monthlyRes = await pool.query(`
            SELECT
                COALESCE(SUM(daily_pv_kwh), 0) as total_pv_kwh,
                COALESCE(SUM(daily_grid_import_kwh), 0) as total_grid_import,
                COALESCE(SUM(daily_grid_export_kwh), 0) as total_export,
                COALESCE(SUM(daily_load_kwh), 0) as total_load,
                COUNT(DISTINCT DATE(recorded_at)) as days_recorded
            FROM inverter_readings
            WHERE home_id = $1 AND recorded_at > NOW() - INTERVAL '30 days'
        `, [homeId]);

        const monthly = monthlyRes.rows[0];
        const pvKwh = parseFloat(monthly.total_pv_kwh);
        const gridImport = parseFloat(monthly.total_grid_import);
        const gridExport = parseFloat(monthly.total_export);
        const totalLoad = parseFloat(monthly.total_load);
        const daysRecorded = parseInt(monthly.days_recorded) || 1;

        // Calculate savings
        const solarUsedByHome = pvKwh - gridExport; // PV consumed directly
        const monthlySavingsRand = solarUsedByHome * rate;
        const exportRevenue = gridExport * rate * 0.5; // Feed-in tariff typically ~50% of retail
        const totalMonthlySavings = monthlySavingsRand + exportRevenue;

        // Annualized for payback
        const annualSavings = totalMonthlySavings * 12;
        const yearsToPayback = annualSavings > 0 ? systemCost / annualSavings : 99;

        // Lifetime savings (estimate since install)
        const installDate = new Date(config.created_at || Date.now());
        const monthsSinceInstall = Math.max(1, (Date.now() - installDate.getTime()) / (1000 * 60 * 60 * 24 * 30));
        const lifetimeSavings = totalMonthlySavings * monthsSinceInstall;

        // Performance score (solar utilization vs expected)
        const avgDailyPv = pvKwh / daysRecorded;
        const expectedDailyPv = 25; // SA average for 5-8kW system: ~25kWh/day
        const performanceScore = Math.min(100, Math.round((avgDailyPv / expectedDailyPv) * 100));

        // Self-sufficiency ratio
        const selfSufficiency = totalLoad > 0
            ? Math.round(((totalLoad - gridImport) / totalLoad) * 100)
            : 0;

        res.json({
            hasSolar: true,
            monthlySavings: totalMonthlySavings,
            monthlySavingsBreakdown: {
                solarSelfUse: monthlySavingsRand,
                gridExportRevenue: exportRevenue,
            },
            payback: {
                systemCost,
                lifetimeSavings: lifetimeSavings,
                recovered: Math.round((lifetimeSavings / systemCost) * 100),
                yearsRemaining: Math.max(0, yearsToPayback - (monthsSinceInstall / 12)),
                totalYears: yearsToPayback,
            },
            performance: {
                score: performanceScore,
                avgDailyPvKwh: avgDailyPv,
                selfSufficiency,
                gridDependency: 100 - selfSufficiency,
            },
            monthly: {
                pvKwh,
                gridImport,
                gridExport,
                totalLoad,
                daysRecorded,
            },
        });
    } catch (err) {
        console.error('Solar ROI error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// GAMIFICATION — Streaks, achievements, leaderboard
// ═══════════════════════════════════════════════════════════════

app.get('/api/gamification/:homeId', async (req, res) => {
    const { homeId } = req.params;

    try {
        // Get daily usage stats
        const usageRes = await pool.query(`
            SELECT DATE(recorded_at) as day,
                   SUM(daily_load_kwh) as load_kwh,
                   SUM(daily_pv_kwh) as pv_kwh,
                   SUM(daily_grid_import_kwh) as grid_kwh
            FROM inverter_readings
            WHERE home_id = $1 AND recorded_at > NOW() - INTERVAL '30 days'
            GROUP BY DATE(recorded_at)
            ORDER BY day DESC
        `, [homeId]);

        const days = usageRes.rows;

        // Calculate streak (consecutive days under target)
        const targetKwh = 20; // daily target
        let streak = 0;
        for (const day of days) {
            if (parseFloat(day.load_kwh) <= targetKwh) {
                streak++;
            } else break;
        }

        // Get rate for cost calculation
        const rateRes = await pool.query(
            'SELECT rate_per_kwh FROM tariff_configs WHERE home_id = $1 ORDER BY created_at DESC LIMIT 1', [homeId]
        );
        const rate = parseFloat(rateRes.rows[0]?.rate_per_kwh || 2.5);

        // Monthly savings vs grid-only
        const totalPv = days.reduce((s, d) => s + parseFloat(d.pv_kwh || 0), 0);
        const monthlySaved = totalPv * rate;

        // Achievements
        const achievements = [];
        if (streak >= 1) achievements.push({ id: 'first_day', name: 'First Day', icon: '⚡', desc: 'First day under target', unlocked: true });
        if (streak >= 7) achievements.push({ id: 'week_warrior', name: 'Week Warrior', icon: '🔥', desc: '7-day saving streak', unlocked: true });
        if (streak >= 30) achievements.push({ id: 'month_master', name: 'Month Master', icon: '🏆', desc: '30-day saving streak', unlocked: true });
        if (totalPv > 100) achievements.push({ id: 'solar_centurion', name: 'Solar Centurion', icon: '☀️', desc: '100+ kWh solar generated', unlocked: true });
        if (totalPv > 500) achievements.push({ id: 'solar_superstar', name: 'Solar Superstar', icon: '🌟', desc: '500+ kWh solar generated', unlocked: true });
        if (monthlySaved > 500) achievements.push({ id: 'big_saver', name: 'Big Saver', icon: '💰', desc: 'Saved R500+ in a month', unlocked: true });

        // Potential locked achievements
        if (streak < 7) achievements.push({ id: 'week_warrior', name: 'Week Warrior', icon: '🔥', desc: '7-day saving streak', unlocked: false, progress: `${streak}/7` });
        if (streak < 30 && streak >= 7) achievements.push({ id: 'month_master', name: 'Month Master', icon: '🏆', desc: '30-day saving streak', unlocked: false, progress: `${streak}/30` });

        // Community leaderboard (anonymized)
        const leaderboard = await pool.query(`
            SELECT h.id, h.city,
                   COALESCE(AVG(ir.daily_load_kwh), 0) as avg_daily_kwh,
                   COALESCE(AVG(ir.daily_pv_kwh), 0) as avg_daily_pv
            FROM homes h
            LEFT JOIN inverter_readings ir ON ir.home_id = h.id AND ir.recorded_at > NOW() - INTERVAL '7 days'
            GROUP BY h.id, h.city
            HAVING COUNT(ir.id) > 0
            ORDER BY avg_daily_kwh ASC
            LIMIT 20
        `);

        // Find user's rank
        const userRank = leaderboard.rows.findIndex(r => r.id == homeId) + 1;

        res.json({
            streak,
            targetKwh,
            monthlySaved: Math.round(monthlySaved),
            achievements: achievements.filter((a, i, arr) => arr.findIndex(x => x.id === a.id) === i), // dedupe
            leaderboard: leaderboard.rows.map((r, i) => ({
                rank: i + 1,
                city: r.city || 'Unknown',
                avgKwh: parseFloat(r.avg_daily_kwh).toFixed(1),
                avgPv: parseFloat(r.avg_daily_pv).toFixed(1),
                isYou: r.id == homeId,
            })),
            userRank: userRank || null,
            totalHouseholds: leaderboard.rows.length,
        });
    } catch (err) {
        console.error('Gamification error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// MULTI-AGENT SCAN — Full 4-model appliance analysis pipeline
// ═══════════════════════════════════════════════════════════════

app.post('/api/scan/full', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    try {
        const { fullApplianceAnalysis } = require('./services/geminiService');
        const homeId = req.body.homeId;

        // Gather context for the boss
        let context = { userApiKey: req.header('x-api-key') || req.body.apiKey };
        if (homeId) {
            const rateRes = await pool.query(
                'SELECT rate_per_kwh FROM tariff_configs WHERE home_id = $1 ORDER BY created_at DESC LIMIT 1', [homeId]
            );
            context.ratePerKwh = parseFloat(rateRes.rows[0]?.rate_per_kwh || 2.5);

            const userRes = await pool.query(
                'SELECT lifestyle_context FROM users u JOIN home_members hm ON u.id = hm.user_id WHERE hm.home_id = $1 LIMIT 1', [homeId]
            );
            context.lifestyleContext = userRes.rows[0]?.lifestyle_context;

            const invRes = await pool.query(
                'SELECT * FROM inverter_readings WHERE home_id = $1 ORDER BY recorded_at DESC LIMIT 1', [homeId]
            );
            if (invRes.rows[0]) context.inverterData = invRes.rows[0];

            const homeRes = await pool.query('SELECT monthly_budget FROM homes WHERE id = $1', [homeId]);
            if (homeRes.rows[0]?.monthly_budget) {
                context.budgetData = { monthly: homeRes.rows[0].monthly_budget };
            }
        }

        const result = await fullApplianceAnalysis(req.file.buffer, req.file.mimetype, context);
        res.json(result);
    } catch (err) {
        console.error('Full scan error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Appliance research endpoint (standalone)
app.post('/api/scan/research', async (req, res) => {
    try {
        const { researchApplianceSavings } = require('./services/geminiService');
        const payload = { ...req.body, userApiKey: req.header('x-api-key') || req.body.apiKey };
        const result = await researchApplianceSavings(payload);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// TOU TARIFF SCHEDULE — Time-of-use visualization data
// ═══════════════════════════════════════════════════════════════

app.get('/api/tou-schedule/:homeId', async (req, res) => {
    const { homeId } = req.params;

    try {
        const rateRes = await pool.query(
            'SELECT * FROM tariff_configs WHERE home_id = $1 ORDER BY created_at DESC LIMIT 1', [homeId]
        );
        const baseRate = parseFloat(rateRes.rows[0]?.rate_per_kwh || 2.5);

        // SA standard TOU schedule (Eskom Homeflex)
        const schedule = [];
        for (let h = 0; h < 24; h++) {
            const isPeak = (h >= 7 && h <= 10) || (h >= 17 && h <= 20);
            const isOffPeak = h >= 22 || h <= 6;
            const zone = isPeak ? 'peak' : isOffPeak ? 'off-peak' : 'standard';
            const rate = isPeak ? baseRate * 1.52 : isOffPeak ? baseRate * 0.48 : baseRate;

            schedule.push({
                hour: h,
                label: `${h.toString().padStart(2, '0')}:00`,
                zone,
                rate: parseFloat(rate.toFixed(2)),
                color: isPeak ? '#FF6B6B' : isOffPeak ? '#00D4AA' : '#FFB347',
            });
        }

        const now = new Date();
        const currentHour = now.getHours();

        res.json({
            schedule,
            currentHour,
            currentZone: schedule[currentHour].zone,
            currentRate: schedule[currentHour].rate,
            peakHours: '07:00-10:00 & 17:00-20:00',
            offPeakHours: '22:00-06:00',
            standardHours: '11:00-16:00 & 21:00',
            tips: {
                peak: 'Avoid geyser, oven, washing machine, pool pump',
                offPeak: 'Best time for geyser, charging, heavy loads',
                standard: 'Normal usage, moderate rates',
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// INFRASTRUCTURE SCANNER (Solar / Agriculture / Environment)
// ═══════════════════════════════════════════════════════════════

app.post('/api/scan/infrastructure', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image uploaded' });
        }

        const { homeId, scanType, latitude, longitude } = req.body;
        const b64 = Buffer.from(req.file.buffer).toString('base64');
        const mimeType = req.file.mimetype;

        // 1. Get user API keys from headers
        const openRouterKey = req.header('x-api-key') || req.query.apiKey;
        const eeKeyBase64 = req.header('x-ee-key');

        let eeKeyJson = null;
        if (eeKeyBase64) {
            eeKeyJson = Buffer.from(eeKeyBase64, 'base64').toString('utf-8');
        }

        const { analyzeImage } = require('./services/geminiService');
        const EarthEngineService = require('./services/earthEngineService');

        let prompt = '';
        if (scanType === 'solar') {
            prompt = `You are a highly advanced Solar Engineering AI. Extract and analyze every component in this infrastructure image. Identify the inverter brand and size, the battery brand and capacity, and the solar panels if visible. 
             CRITICAL:
             1. List the exact models and specifications you find.
             2. Match the inverter size to the battery capacity. If the battery is too small for the inverter (e.g. 5kW inverter with a 2.4kWh battery), warn the user severely.
             3. If panels are visible, estimate if they are shaded or poorly mounted.
             4. Return your findings in a structured, professional engineering report format.`;
        } else if (scanType === 'agriculture') {
            prompt = `You are an Agricultural AI Guadian. Analyze this image of a garden or farm plot.
             CRITICAL:
             1. Identify the types of plants, crops, or vegetation visible.
             2. Estimate the health of the plants (e.g., wilting, thriving, pest damage).
             3. Look at the soil surface - does it appear parched, cracked, or well-watered?
             4. Suggest immediate actions the user should take to protect this plot, keeping water conservation in mind.`;
        } else {
            prompt = `Analyze this infrastructure image related to the home. Identify components and any safety hazards.`;
        }

        // 2. Run Vision Analysis & Earth Engine Concurrently
        const visionPromise = analyzeImage(b64, mimeType, prompt, openRouterKey);

        let eePromise = Promise.resolve(null);
        if (eeKeyJson && latitude && longitude) {
            eePromise = EarthEngineService.checkInfrastructureChanges(eeKeyJson, parseFloat(latitude), parseFloat(longitude));
        }

        const [visionResult, eeResult] = await Promise.all([visionPromise, eePromise]);

        // 3. Compile the final unified report
        let finalReport = visionResult.analysis || "Vision analysis failed.";

        if (eeResult && eeResult.status === 'success') {
            finalReport += `\n\n### 🌍 Earth Engine Environmental Data\n`;
            finalReport += `- **Location Similarity (Year-Over-Year)**: ${Math.round(eeResult.similarityScore * 100)}%\n`;
            finalReport += `- **Environmental Alert**: ${eeResult.message}\n`;
        }

        res.json({
            analysis: finalReport,
            components_found: visionResult.components || [],
            earth_engine_status: eeResult ? eeResult.status : 'not_configured'
        });

    } catch (err) {
        console.error('Infrastructure scan error:', err);
        res.status(500).json({ error: 'Failed to process infrastructure scanning.' });
    }
});

// ═══════════════════════════════════════════════════════════════
// SOLAR WATCHER — Intelligent solar system monitoring agent
// ═══════════════════════════════════════════════════════════════

app.get('/api/solar-watcher/:homeId', async (req, res) => {
    const { homeId } = req.params;

    try {
        const { solarWatcherAnalyze } = require('./services/geminiService');

        // Gather all data the watcher needs
        const invRes = await pool.query(
            'SELECT * FROM inverter_readings WHERE home_id = $1 ORDER BY recorded_at DESC LIMIT 1', [homeId]
        );
        if (!invRes.rows[0]) return res.json({ error: 'No inverter data available' });

        // Historical 7-day data
        const histRes = await pool.query(`
            SELECT DATE(recorded_at) as day,
                   AVG(pv_power) as avg_pv, MAX(pv_power) as peak_pv,
                   AVG(load_power) as avg_load, AVG(battery_soc) as avg_soc,
                   SUM(daily_pv_kwh) as total_pv, SUM(daily_grid_import_kwh) as total_import
            FROM inverter_readings
            WHERE home_id = $1 AND recorded_at > NOW() - INTERVAL '7 days'
            GROUP BY DATE(recorded_at) ORDER BY day DESC
        `, [homeId]);

        // Community insights from shared database (Mesh Intelligence)
        const commRes = await pool.query(`
            SELECT topic, context_data 
            FROM community_intelligence 
            ORDER BY created_at DESC LIMIT 5
        `);
        const communityInsightsData = commRes.rows.map(r => ({ topic: r.topic, insight: r.context_data }));

        // Optimizer agent's last recommendation
        const optRes = await pool.query(
            'SELECT * FROM optimization_schedules WHERE home_id = $1 ORDER BY created_at DESC LIMIT 1', [homeId]
        );

        // Weather (from Open-Meteo via optimizer agent)
        let weather = null;
        try {
            const homeRes = await pool.query('SELECT latitude, longitude FROM homes WHERE id = $1', [homeId]);
            if (homeRes.rows[0]?.latitude) {
                const fetch = (await import('node-fetch')).default;
                const lat = homeRes.rows[0].latitude;
                const lon = homeRes.rows[0].longitude;
                const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=cloud_cover,shortwave_radiation&forecast_days=1`);
                weather = await wRes.json();
            }
        } catch (e) { /* weather optional */ }

        const result = await solarWatcherAnalyze({
            inverterData: invRes.rows[0],
            historicalData: histRes.rows,
            communityInsights: communityInsightsData,
            otherAgentInsights: optRes.rows[0] || null,
            weather,
            homeContext: `Home ${homeId}`,
            userApiKey: req.header('x-api-key') || req.query.apiKey,
        });

        res.json(result);
    } catch (err) {
        console.error('Solar watcher error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// COMMUNITY FEED — Tips, comparisons, Q&A
// ═══════════════════════════════════════════════════════════════

app.get('/api/community/:homeId', async (req, res) => {
    const { homeId } = req.params;

    try {
        // Get home's city for comparison
        const homeRes = await pool.query('SELECT city, province FROM homes WHERE id = $1', [homeId]);
        const city = homeRes.rows[0]?.city || 'Unknown';

        // Average usage in same city
        const cityAvg = await pool.query(`
            SELECT AVG(d.watts * d.hours_per_day / 1000.0) as avg_daily_kwh,
                   COUNT(DISTINCT h.id) as household_count
            FROM devices d
            JOIN rooms r ON d.room_id = r.id
            JOIN homes h ON r.home_id = h.id
            WHERE h.city = $1
        `, [city]);

        // User's usage
        const userUsage = await pool.query(`
            SELECT COALESCE(SUM(d.watts * d.hours_per_day / 1000.0), 0) as daily_kwh
            FROM devices d
            JOIN rooms r ON d.room_id = r.id
            WHERE r.home_id = $1
        `, [homeId]);

        const yourKwh = parseFloat(userUsage.rows[0]?.daily_kwh || 0);
        const avgKwh = parseFloat(cityAvg.rows[0]?.avg_daily_kwh || 0);
        const householdCount = parseInt(cityAvg.rows[0]?.household_count || 0);

        // Pre-generated community tips (could be AI-generated in future)
        const tips = [
            { author: 'StaticFund Team', tip: 'Set your geyser timer to heat water at 4am (off-peak). Still hot by shower time, saves up to R200/month.', likes: 47, category: 'geyser' },
            { author: 'Community', tip: 'Unplug your TV at the wall when not watching — standby mode still uses 5-15W continuously.', likes: 32, category: 'entertainment' },
            { author: 'Solar Users', tip: 'Run your pool pump between 10am-2pm when solar production peaks — essentially free pumping.', likes: 28, category: 'outdoor' },
            { author: 'Kitchen Tips', tip: 'Use a microwave instead of the oven for reheating — it uses 80% less electricity for the same task.', likes: 41, category: 'kitchen' },
            { author: 'Winter Special', tip: 'An electric blanket (60W) costs R1.50/night vs a heater (2000W) at R14/night. Same warmth, 90% savings.', likes: 56, category: 'heating' },
            { author: 'Load Shedding', tip: 'Charge devices during off-peak before bed. If loadshedding hits in the morning, you\'re prepared.', likes: 38, category: 'sa_specific' },
        ];

        res.json({
            comparison: {
                yourDailyKwh: yourKwh.toFixed(1),
                cityAvgDailyKwh: avgKwh.toFixed(1),
                city,
                householdsCompared: householdCount,
                percentile: avgKwh > 0 && yourKwh < avgKwh
                    ? Math.round((1 - yourKwh / avgKwh) * 100)
                    : yourKwh > avgKwh
                        ? -Math.round((yourKwh / avgKwh - 1) * 100)
                        : 0,
                verdict: yourKwh < avgKwh
                    ? `You use ${(avgKwh - yourKwh).toFixed(1)} kWh/day LESS than ${city} average 🎉`
                    : `You use ${(yourKwh - avgKwh).toFixed(1)} kWh/day MORE than ${city} average`,
            },
            tips,
        });
    } catch (err) {
        console.error('Community feed error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// WATER TRACKING — Manual Meter Logs & Agricultural AI
// ═══════════════════════════════════════════════════════════════

app.post('/api/water/log', async (req, res) => {
    const { homeId, reading_kl, notes } = req.body;
    if (!homeId || reading_kl == null) return res.status(400).json({ error: 'Missing parameters' });

    try {
        await pool.query(
            'INSERT INTO water_readings (home_id, reading_kl, notes) VALUES ($1, $2, $3)',
            [homeId, reading_kl, notes || 'User Manual Entry']
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Water log error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/water/:homeId', async (req, res) => {
    const { homeId } = req.params;
    try {
        const readings = await pool.query(
            'SELECT * FROM water_readings WHERE home_id = $1 ORDER BY recorded_at DESC LIMIT 30',
            [homeId]
        );

        let recentConsumption = null;
        if (readings.rows.length >= 2) {
            const latest = readings.rows[0].reading_kl;
            const previous = readings.rows[1].reading_kl;
            recentConsumption = Math.max(0, latest - previous);
        }

        res.json({
            readings: readings.rows,
            recentConsumptionKl: recentConsumption
        });
    } catch (err) {
        console.error('Water log fetch error:', err);
        res.status(500).json({ error: err.message });
    }
});


// ═══════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS — Register tokens + trigger checks
// ═══════════════════════════════════════════════════════════════

app.post('/api/push/register', async (req, res) => {
    const { homeId, token } = req.body;
    if (!homeId || !token) return res.status(400).json({ error: 'homeId and token required' });

    try {
        const { registerToken } = require('./services/notificationService');
        registerToken(homeId, token);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// B2B MARKETPLACE — Lead Generation & Installer Matching
// ═══════════════════════════════════════════════════════════════

app.post('/api/b2b/apply', async (req, res) => {
    const { homeId } = req.body;
    if (!homeId) return res.status(400).json({ error: 'homeId required' });

    try {
        const { executeB2BLeadGeneration } = require('./services/crewService');
        const result = await executeB2BLeadGeneration(homeId, pool);
        res.json(result);
    } catch (err) {
        console.error('B2B Apply Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/b2b/leads/:homeId', async (req, res) => {
    const { homeId } = req.params;
    try {
        const result = await pool.query(`
            SELECT ml.*, i.company_name, i.contact_email 
            FROM market_leads ml
            LEFT JOIN installers i ON ml.installer_id = i.id
            WHERE ml.home_id = $1
            ORDER BY ml.created_at DESC
        `, [homeId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// COMMUNITY OUTAGE REPORTING
// ═══════════════════════════════════════════════════════════════

app.post('/api/outages/report', async (req, res) => {
    const { userId, homeId, city, province } = req.body;
    try {
        await pool.query(
            "INSERT INTO power_outages (user_id, home_id, city, province, status, reported_at) VALUES ($1, $2, $3, $4, 'ACTIVE', NOW())",
            [userId, homeId, city, province]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/outages/restore', async (req, res) => {
    const { homeId } = req.body;
    try {
        await pool.query(
            "UPDATE power_outages SET status = 'RESTORED', restored_at = NOW() WHERE home_id = $1 AND status = 'ACTIVE'",
            [homeId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/outages/active', async (req, res) => {
    const { city, province } = req.query;
    try {
        const result = await pool.query(
            "SELECT COUNT(*) as count, MIN(reported_at) as first_reported FROM power_outages WHERE status = 'ACTIVE' AND (LOWER(city) = LOWER($1) OR LOWER(province) = LOWER($2))",
            [city, province]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`⚡ StaticFund V2 server running on port ${PORT}`);

    // Init outages table
    pool.query(`
        CREATE TABLE IF NOT EXISTS power_outages (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            home_id INTEGER REFERENCES homes(id) ON DELETE SET NULL,
            city VARCHAR(100),
            province VARCHAR(100),
            status VARCHAR(20) DEFAULT 'ACTIVE',
            reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            restored_at TIMESTAMP
        );
    `).catch(e => console.error('Outages table init error:', e.message));

    // Start inverter polling every 5 minutes
    setInterval(pollAllInverters, 5 * 60 * 1000);
    console.log('🔌 Inverter background polling enabled (5-min interval)');

    // Hourly checks: nightly optimizer + push notifications
    setInterval(async () => {
        const now = new Date();
        const saHour = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Johannesburg' })).getHours();

        // Nightly optimization at 10 PM
        if (saHour === 22) {
            console.log('🌙 Running nightly optimization...');
            nightlyOptimization();
        }

        // Push notification checks every hour
        try {
            const { runNotificationChecks } = require('./services/notificationService');
            await runNotificationChecks(pool);
            console.log('🔔 Notification checks complete');
        } catch (err) {
            console.error('Notification check error:', err.message);
        }
    }, 60 * 60 * 1000);
    console.log('🧠 Nightly auto-optimizer scheduled (10 PM SAST)');
    console.log('🔔 Smart push notifications enabled (hourly checks)');
});

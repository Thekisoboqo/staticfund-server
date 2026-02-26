const express = require('express');
const cors = require('cors');
const pool = require('./db');
require('dotenv').config();
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5001;

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
            // Get user's city for regional context
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
        const aiResult = await analyzeDeviceImage(imageBuffer, mimeType || 'image/jpeg');

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

        // Get user context
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

        const { consultantChat } = require('./services/geminiService');
        const reply = await consultantChat({
            message,
            history,
            deviceSummary,
            totalDailyKwh,
            ratePerKwh: rateInfo.rate,
            municipality: rateInfo.municipality,
            season: seasonalInfo.season,
            city: user?.city,
            province: user?.province,
        });

        // Save assistant reply
        await pool.query(
            'INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)',
            [userId, 'assistant', reply]
        );

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

        // Get total kWh purchased
        const purchasesRes = await pool.query(
            'SELECT COALESCE(SUM(kwh_purchased), 0)::float as total_kwh FROM electricity_purchases WHERE home_id = $1',
            [homeId]
        );
        const totalPurchased = purchasesRes.rows[0].total_kwh;

        // Get daily consumption from all devices in this home
        const devicesRes = await pool.query(`
            SELECT COALESCE(SUM(d.watts * d.hours_per_day / 1000.0), 0)::float as daily_kwh
            FROM devices d WHERE d.home_id = $1
        `, [homeId]);
        const dailyConsumption = devicesRes.rows[0].daily_kwh;

        // Calculate what's been consumed since first purchase
        const firstPurchaseRes = await pool.query(
            'SELECT MIN(purchased_at) as first_purchase FROM electricity_purchases WHERE home_id = $1',
            [homeId]
        );
        const firstPurchase = firstPurchaseRes.rows[0].first_purchase;

        let daysElapsed = 0;
        let estimatedConsumed = 0;
        let kwhRemaining = totalPurchased;
        let daysRemaining = 0;
        let percentRemaining = 100;

        if (firstPurchase && dailyConsumption > 0) {
            daysElapsed = Math.max(1, Math.floor((Date.now() - new Date(firstPurchase).getTime()) / (1000 * 60 * 60 * 24)));
            estimatedConsumed = dailyConsumption * daysElapsed;
            kwhRemaining = Math.max(0, totalPurchased - estimatedConsumed);
            daysRemaining = dailyConsumption > 0 ? Math.floor(kwhRemaining / dailyConsumption) : 999;
            percentRemaining = totalPurchased > 0 ? Math.max(0, Math.min(100, Math.round((kwhRemaining / totalPurchased) * 100))) : 100;
        } else if (dailyConsumption === 0 && totalPurchased > 0) {
            // No devices scanned yet — can't predict
            kwhRemaining = totalPurchased;
            daysRemaining = -1; // means "unknown — scan devices to predict"
        }

        // Get home info for meter number
        const homeRes = await pool.query('SELECT meter_number FROM homes WHERE id = $1', [homeId]);

        // Get last 3 purchases for quick context
        const recentRes = await pool.query(
            'SELECT amount_rand, kwh_purchased, purchased_at FROM electricity_purchases WHERE home_id = $1 ORDER BY purchased_at DESC LIMIT 3',
            [homeId]
        );

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
        });

        res.json({ tips });
    } catch (err) {
        console.error('Meter tips error:', err);
        res.status(500).json({ error: 'Failed to get tips. Try again later.' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`⚡ StaticFund V2 server running on port ${PORT}`);
});

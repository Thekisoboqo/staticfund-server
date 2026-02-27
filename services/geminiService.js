require('dotenv').config();

// OpenRouter API configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'qwen/qwen-2.5-vl-72b-instruct';

// Helper: Send a prompt to OpenRouter and get text response
async function callAI(prompt, options = {}) {
    const messages = [];

    if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
    }

    if (options.history) {
        messages.push(...options.history);
    }

    if (options.imageBase64 && options.mimeType) {
        messages.push({
            role: 'user',
            content: [
                { type: 'text', text: prompt },
                {
                    type: 'image_url',
                    image_url: {
                        url: `data:${options.mimeType};base64,${options.imageBase64}`
                    }
                }
            ]
        });
    } else {
        messages.push({ role: 'user', content: prompt });
    }

    const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://staticfund.app',
            'X-Title': 'StaticFund Energy'
        },
        body: JSON.stringify({
            model: MODEL,
            messages,
            temperature: options.temperature || 0.7,
            max_tokens: options.maxTokens || 2000,
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenRouter API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// Helper: Extract JSON from AI response text
function extractJSON(text) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in AI response");
    return JSON.parse(jsonMatch[0]);
}

// ── Appliance Scanner ───────────────────────────────────────────
async function analyzeDeviceImage(imageBuffer, mimeType) {
    try {
        const prompt = `
        You are an expert South African appliance identification AI. Analyze this image carefully.

        YOUR PROCESS:
        1. LOOK for any visible text: brand name, model number, nameplate, sticker, labels
        2. IDENTIFY the exact brand and model if possible
        3. If you can identify the brand/model, USE YOUR KNOWLEDGE of that exact model's specs
        4. If you cannot see the brand/model, identify the TYPE and use typical SA wattage
        5. Estimate realistic daily usage hours for a typical SA household

        COMMON SA APPLIANCE WATTAGES (fallback):
        - Geyser: 2000-3000W | Kettle: 1800-2200W | Stove plate: 1500-2000W
        - Microwave: 800-1200W | Iron: 1000-1500W | Washing machine: 500-800W
        - Fridge/Freezer: 100-200W | TV (LED): 50-150W | TV (older): 150-300W
        - PC/Laptop: 50-300W | Router/WiFi: 10-20W | Phone charger: 5-15W
        - Pool pump: 750-1500W | Heater: 1500-2500W | Air con: 1000-2500W
        - LED bulb: 5-15W | Ceiling fan: 50-75W | Dishwasher: 1200-1800W

        Return ONLY a JSON object:
        {
            "name": "Brand Model (Type)" or just "Type",
            "watts": exact_number,
            "hours_per_day": realistic_daily_hours,
            "days_per_week": typical_days,
            "brand": "Brand if visible" or null,
            "model": "Model if visible" or null,
            "confidence": "HIGH" if brand/model identified, "MEDIUM" if type identified, "LOW" if guessing
        }

        Return ONLY the raw JSON, no markdown.
        `;

        const text = await callAI(prompt, {
            imageBase64: imageBuffer.toString("base64"),
            mimeType
        });

        console.log("AI Scan Response:", text);
        return extractJSON(text);
    } catch (error) {
        console.error("Scan Error:", error);
        throw new Error("Failed to analyze image: " + error.message);
    }
}

// ═════════════════════════════════════════════════════════════════
// CONTINUOUS ENERGY CONSULTANT — "Buy Less, Live More"
// ═════════════════════════════════════════════════════════════════
//
// This is NOT a generic chatbot. It is a persistent energy advisor
// that deeply understands the user's lifestyle through conversation.
// It never gives torturous advice. It respects the user's schedule,
// habits, and real-world constraints.
//
// ═════════════════════════════════════════════════════════════════

async function consultantChat({ message, history, deviceSummary, totalDailyKwh, ratePerKwh, municipality, season, city, province, lifestyleContext }) {
    try {
        const now = new Date();

        const systemPrompt = `You are a caring South African Energy Consultant who lives in the user's pocket.
Your philosophy: "Buy Less, Live More" — help users save without making their life worse.

═══ WHO YOU ARE ═══
You are like a trusted neighbor who happens to be an energy expert. You speak casually, use "hey" and "you know", and genuinely care. You are NOT a corporate chatbot. You sound human.

═══ CRITICAL RULES ═══
1. **NEVER TORTUROUS**: Do NOT tell them to shower cold, cook at weird hours, or sit in the dark.
2. **LIFESTYLE-FIRST**: Always check the Lifestyle Profile before giving schedule advice. If they get home at 18:30, don't suggest cooking at 15:00.
3. **LEARN THROUGH CHAT**: If you don't know their schedule, ASK casually: "What time do you usually get home?" or "Do the kids bath morning or evening?"
4. **SHORT MESSAGES**: Reply like a WhatsApp message — 1 to 2 short paragraphs MAX. No bullet point lists unless asked.
5. **SPECIFIC NUMBERS**: Always mention Rand amounts: "That saves you about R45/month" not "that saves money".
6. **CELEBRATE WINS**: If they're doing something right, tell them! "Nice, your LED lights barely cost R3/month — smart choice 👏"

═══ CONTEXT ═══
- Now: ${now.toLocaleDateString('en-ZA')} ${now.toLocaleTimeString('en-ZA')}
- Season: ${season}
- Location: ${city || '?'}, ${province || 'SA'}
- Rate: R${ratePerKwh}/kWh
- Home total: ${totalDailyKwh.toFixed(1)} kWh/day ≈ R${(totalDailyKwh * ratePerKwh * 30).toFixed(0)}/month

═══ USER'S LIFESTYLE PROFILE ═══
${lifestyleContext || 'Unknown yet. Ask a casual question to learn about their routine — but only ONE question at a time, woven into your reply naturally.'}

═══ USER'S APPLIANCES ═══
${deviceSummary || 'No appliances scanned yet. Gently suggest scanning if relevant.'}

═══ REMEMBER ═══
- The goal is for users to eventually NOT need you because their home is fully optimized.
- Every reply should either give a specific saving tip, learn something new about them, or celebrate a win.`;

        const formattedHistory = history.map(h => ({
            role: h.role,
            content: h.content,
        }));

        const reply = await callAI(message, {
            systemPrompt,
            history: formattedHistory,
            temperature: 0.8,
            maxTokens: 500,
        });

        return reply;
    } catch (error) {
        console.error("Consultant Error:", error);
        return "Hey, I'm having a moment — can't connect right now 😅 Try again in a sec. Quick thought though: if your geyser doesn't have a timer, that's the #1 money saver to set up!";
    }
}

// ── Extract Lifestyle Insights from Chat ────────────────────────
// After each user message, we ask the AI to detect any new lifestyle
// facts and return them. These get appended to the user's profile.
async function extractLifestyleFromChat(userMessage, existingContext) {
    try {
        const prompt = `You are analyzing a user's chat message to extract lifestyle information relevant to energy management.

EXISTING PROFILE:
${existingContext || 'No data yet.'}

NEW MESSAGE FROM USER:
"${userMessage}"

If the message reveals ANY of these, extract them:
- Wake up / sleep time
- Work schedule (leave home, return home)
- Cooking habits (time, method: oven vs stovetop vs microwave)
- Bathing/shower schedule
- Number of people in household
- Weekend vs weekday routines
- Specific preferences ("I like hot water ready at 5am")
- Appliance usage patterns

If you find new lifestyle info, return a JSON object:
{
    "found": true,
    "facts": ["Gets home at 18:30", "Cooks dinner at 19:00 on weekdays"],
    "updatedContext": "Full updated profile paragraph incorporating old + new facts"
}

If no new lifestyle info is found, return:
{ "found": false }

Return ONLY raw JSON, no markdown.`;

        const response = await callAI(prompt, { temperature: 0.3, maxTokens: 500 });
        return extractJSON(response);
    } catch (error) {
        console.error('Lifestyle extraction error:', error.message);
        return { found: false };
    }
}

// ── Per-Appliance Tip Generator ─────────────────────────────────
async function generateDeviceTip({ name, watts, hours_per_day, days_per_week, lifestyleContext }) {
    try {
        const dailyKwh = (watts * (hours_per_day || 4)) / 1000;
        const monthlyCost = dailyKwh * (days_per_week || 7) / 7 * 30 * 3.2;

        const prompt = `You are a caring South African energy advisor. Generate ONE tip for this appliance.

APPLIANCE: ${name} (${watts}W)
DAILY USE: ${hours_per_day || 4}h, ${days_per_week || 7} days/week
MONTHLY COST: ~R${monthlyCost.toFixed(0)}

USER'S LIFESTYLE:
${lifestyleContext || 'Unknown — give a generally safe tip.'}

Rules:
- MAX 2 sentences, plain text, no markdown
- The tip must RESPECT their lifestyle. If they get home at 18:30, don't suggest using the appliance at 15:00.
- Be specific: mention Rand savings
- Sound like a friend, not a textbook
- NEVER suggest anything torturous (cold showers, eating cold food, etc.)`;

        const tip = await callAI(prompt, { temperature: 0.6, maxTokens: 150 });
        return tip.trim();
    } catch (error) {
        console.error('Tip generation error:', error.message);
        if (watts >= 2000) return `High-power appliance (${watts}W). Using a timer for off-peak hours (10pm-6am) could save you around R${Math.round(monthlyCost * 0.3)}/month without changing your routine.`;
        if (watts >= 1000) return `This ${watts}W appliance costs about R${Math.round(monthlyCost)}/month. Even reducing usage by 30 minutes a day saves ~R${Math.round((watts / 1000) * 1.6)}/day.`;
        return `Low-power device at ${watts}W — nice! This costs you about R${Math.round(monthlyCost)}/month, which is very reasonable.`;
    }
}

// ── Advanced Agent: Budget Prediction ───────────────────────────
async function agentPredict({ devices, monthlyBudget, meterBalance, daysLeftInMonth, ratePerKwh, lifestyleContext }) {
    try {
        const deviceList = devices.map(d =>
            `• ${d.name}: ${d.watts}W × ${d.hours_per_day}h/day = ${((d.watts * d.hours_per_day) / 1000).toFixed(2)} kWh/day (R${((d.watts * d.hours_per_day / 1000) * ratePerKwh).toFixed(2)}/day)`
        ).join('\n');

        const totalDailyKwh = devices.reduce((sum, d) => sum + (d.watts * d.hours_per_day / 1000), 0);
        const totalDailyCost = totalDailyKwh * ratePerKwh;
        const projectedMonthlySpend = totalDailyCost * 30;

        const prompt = `You are an advanced South African energy management AI agent. Analyze this household.

HOUSEHOLD DATA:
Monthly Budget: R${monthlyBudget || 'Not set'}
Meter Balance: ${meterBalance ? meterBalance + ' kWh' : 'Unknown'}
Days Left: ${daysLeftInMonth}
Rate: R${ratePerKwh}/kWh

USER'S LIFESTYLE:
${lifestyleContext || 'Unknown — give generally safe schedule suggestions.'}

APPLIANCES:
${deviceList}

TOTALS:
Daily: ${totalDailyKwh.toFixed(2)} kWh = R${totalDailyCost.toFixed(2)}
Projected Monthly: R${projectedMonthlySpend.toFixed(0)}

IMPORTANT: Any schedule_suggestions MUST respect the user's lifestyle profile. Don't suggest they use appliances at times they are not home or asleep.

Return JSON:
{
    "status": "GREEN" or "YELLOW" or "RED",
    "headline": "One-line summary",
    "prediction": "Specific prediction with dates and numbers",
    "savings_actions": [
        { "device": "name", "action": "what to do", "saving_kwh": number, "saving_rand": number }
    ],
    "schedule_suggestions": [
        { "device": "name", "turn_on": "HH:MM", "turn_off": "HH:MM", "reason": "why" }
    ],
    "monthly_forecast": "Detailed forecast"
}

Return ONLY raw JSON, no markdown.`;

        const response = await callAI(prompt, { temperature: 0.4, maxTokens: 1500 });
        return extractJSON(response);
    } catch (error) {
        console.error('Agent predict error:', error.message);
        return {
            status: 'YELLOW',
            headline: 'Unable to generate full analysis right now',
            prediction: 'Check back shortly for a detailed prediction.',
            savings_actions: [],
            schedule_suggestions: [],
            monthly_forecast: 'Analysis temporarily unavailable.'
        };
    }
}

module.exports = { analyzeDeviceImage, consultantChat, extractLifestyleFromChat, generateDeviceTip, agentPredict };

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

// ── AI Energy Consultant Chat ───────────────────────────────────
async function consultantChat({ message, history, deviceSummary, totalDailyKwh, ratePerKwh, municipality, season, city, province }) {
    try {
        const now = new Date();
        const currentHour = now.getHours();
        const isOffPeak = (currentHour >= 22 || currentHour < 6);

        const systemPrompt = `You are an expert South African Energy Consultant. You are friendly, knowledgeable, and actionable.

YOUR PERSONALITY:
- Warm and approachable, like a trusted advisor
- Always specific with numbers: "Your geyser costs R8.40/day" not "your geyser costs a lot"
- Give practical SA-specific advice
- Reference actual times, amounts, and savings

CURRENT CONTEXT:
- Date/Time: ${now.toLocaleDateString('en-ZA')} ${now.toLocaleTimeString('en-ZA')}
- Season: ${season} (SA seasons)
- Location: ${city || 'Unknown'}, ${province || 'South Africa'}
- Municipality/Distributor: ${municipality || 'Unknown'}
- Electricity rate: R${ratePerKwh}/kWh
- Currently ${isOffPeak ? 'OFF-PEAK (cheaper)' : 'PEAK/STANDARD (more expensive)'}
- Total home usage: ${totalDailyKwh.toFixed(2)} kWh/day = R${(totalDailyKwh * ratePerKwh).toFixed(2)}/day = R${(totalDailyKwh * ratePerKwh * 30).toFixed(0)}/month

SA OFF-PEAK HOURS:
- Off-peak: 22:00-06:00 weekdays, all weekend
- Peak: 06:00-09:00 & 17:00-22:00 weekdays
- Standard: 09:00-17:00 weekdays

USER'S APPLIANCES (by room):
${deviceSummary || 'No appliances scanned yet. Encourage them to scan their appliances!'}

RULES:
1. Always show your math when discussing costs
2. Reference specific devices by name when giving advice
3. If they ask about load shedding, give general SA advice (check Eskom Se Push app, etc.)
4. If they ask about tariffs, use the rate you know (R${ratePerKwh}/kWh for ${municipality})
5. Keep responses concise — 2-3 paragraphs max
6. If they haven't scanned appliances yet, suggest they do so first
7. Use Rand (R) for all monetary values
8. Be encouraging about their energy-saving efforts`;

        const formattedHistory = history.map(h => ({
            role: h.role,
            content: h.content,
        }));

        const reply = await callAI(message, {
            systemPrompt,
            history: formattedHistory,
            temperature: 0.8,
            maxTokens: 1000,
        });

        return reply;
    } catch (error) {
        console.error("Consultant Error:", error);
        return "I'm having trouble connecting right now. Please try again in a moment. In the meantime, a quick tip: check if your geyser is running during peak hours (6-9am, 5-10pm) — that's when electricity costs the most!";
    }
}

module.exports = { analyzeDeviceImage, consultantChat };

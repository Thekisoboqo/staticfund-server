require('dotenv').config();

// OpenRouter API configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TEXT_MODEL = 'qwen/qwen-2.5-vl-72b-instruct';
const VISION_MODEL = 'qwen/qwen3-vl-235b-a22b-thinking';
const RESEARCH_MODEL = 'arcee-ai/trinity-large-preview:free';
const BOSS_MODEL = 'z-ai/glm-4.5-air:free';
const REVIEWER_MODEL = 'google/gemma-3-27b-it:free';
const SOLAR_WATCHER_MODEL = 'qwen/qwen3-235b-a22b-thinking-2507';

// Helper: Send a prompt to OpenRouter and get text response
async function callAI(prompt, options = {}) {
    const messages = [];
    const apiKey = options.userApiKey || OPENROUTER_API_KEY;

    if (!apiKey) {
        throw new Error("No OpenRouter API key provided or configured.");
    }

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

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://staticfund.app',
            'X-Title': 'StaticFund Energy'
        },
        body: JSON.stringify({
            model: options.model || (options.imageBase64 ? VISION_MODEL : TEXT_MODEL),
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
        You are an expert South African appliance identification AI using advanced visual reasoning.

        YOUR PROCESS:
        1. LOOK carefully at the entire image — scan for any visible text: brand name, model number, nameplate, sticker, labels, rating plates, serial numbers
        2. EXAMINE the physical characteristics: shape, size, color, controls, display type
        3. IDENTIFY the exact brand and model if ANY text is visible
        4. If you can identify the brand/model, USE YOUR KNOWLEDGE of that exact model's rated wattage and specifications
        5. If you cannot see the brand/model clearly, identify the TYPE of appliance from its physical features and use typical SA wattage
        6. Estimate realistic daily usage hours for a typical South African household
        7. THINK step by step about what you see before answering

        COMMON SA APPLIANCE WATTAGES (fallback only — prefer actual specs):
        - Geyser: 2000-3000W | Kettle: 1800-2200W | Stove plate: 1500-2000W
        - Microwave: 800-1200W | Iron: 1000-1500W | Washing machine: 500-800W
        - Fridge/Freezer: 100-200W | TV (LED): 50-150W | TV (older): 150-300W
        - PC/Laptop: 50-300W | Router/WiFi: 10-20W | Phone charger: 5-15W
        - Pool pump: 750-1500W | Heater: 1500-2500W | Air con: 1000-2500W
        - LED bulb: 5-15W | Ceiling fan: 50-75W | Dishwasher: 1200-1800W
        - Tumble dryer: 2000-2500W | Hair dryer: 1200-1800W | Toaster: 700-1000W
        - Oven: 2000-3000W | Induction hob: 1400-2000W | Deep fryer: 1000-1800W

        Return ONLY a JSON object:
        {
            "name": "Brand Model (Type)" or just "Type",
            "watts": exact_number,
            "hours_per_day": realistic_daily_hours,
            "days_per_week": typical_days,
            "brand": "Brand if visible" or null,
            "model": "Model if visible" or null,
            "confidence": "HIGH" if brand/model identified, "MEDIUM" if type identified, "LOW" if guessing,
            "identified_text": ["any text visible in the image"],
            "category": "kitchen" or "bathroom" or "bedroom" or "entertainment" or "laundry" or "heating" or "cooling" or "lighting" or "computing" or "outdoor" or "other"
        }

        Return ONLY the raw JSON, no markdown.
        `;

        const text = await callAI(prompt, {
            imageBase64: imageBuffer.toString("base64"),
            mimeType,
            model: VISION_MODEL, // Explicitly use the advanced vision model
            maxTokens: 3000, // Allow thinking tokens
        });

        console.log(`🔍 AI Scan Response (${VISION_MODEL}):`, text.substring(0, 200));

        // Extract JSON — the thinking model may wrap in <think> tags
        let cleanText = text;
        const thinkEnd = text.indexOf('</think>');
        if (thinkEnd !== -1) {
            cleanText = text.substring(thinkEnd + 8).trim();
        }

        return extractJSON(cleanText);
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

async function consultantChat({ message, history, deviceSummary, totalDailyKwh, ratePerKwh, municipality, season, city, province, lifestyleContext, inverterData }) {
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
- Every reply should either give a specific saving tip, learn something new about them, or celebrate a win.
${inverterData ? `
═══ SOLAR SYSTEM (LIVE) ═══
- Battery: ${inverterData.battery_soc || 0}% ${inverterData.battery_power > 0 ? `(charging at ${inverterData.battery_power}W)` : inverterData.battery_power < 0 ? `(discharging at ${Math.abs(inverterData.battery_power)}W)` : '(idle)'}
- Solar panels: ${inverterData.pv_power || 0}W generating now
- Grid: ${inverterData.grid_power > 0 ? `importing ${inverterData.grid_power}W` : inverterData.grid_power < 0 ? `EXPORTING ${Math.abs(inverterData.grid_power)}W 🎉` : 'idle'}
- House load: ${inverterData.load_power || 0}W total right now
- Today: ${inverterData.daily_pv_kwh || 0} kWh generated | ${inverterData.daily_grid_import_kwh || 0} kWh imported | ${inverterData.daily_grid_export_kwh || 0} kWh exported

CRITICAL: Use this live data! If battery is low and PV is dropping, suggest delaying heavy appliances. If exporting to grid, suggest running heavy loads NOW to use free solar power. Always mention specific numbers.
` : ''}`;

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
async function agentPredict({ devices, monthlyBudget, meterBalance, daysLeftInMonth, ratePerKwh, lifestyleContext, inverterData, communityInsights, waterData }) {
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

WATER DATA:
${waterData && waterData.recentConsumptionKl ? `Recent Consumption: ${waterData.recentConsumptionKl} kL between last two readings. Factor water conservation into your advice, especially for gardens or pools.` : 'No recent water logs.'}

COMMUNITY MESH INTELLIGENCE:
${communityInsights ? `Local network insights: ${JSON.stringify(communityInsights)}
(Use this local knowledge to provide more accurate, area-specific advice.)` : 'No local community data available.'}

APPLIANCES:
${deviceList}

TOTALS:
Daily: ${totalDailyKwh.toFixed(2)} kWh = R${totalDailyCost.toFixed(2)}
Projected Monthly: R${projectedMonthlySpend.toFixed(0)}

IMPORTANT: Any schedule_suggestions MUST respect the user's lifestyle profile. Don't suggest they use appliances at times they are not home or asleep.
${inverterData ? `
SOLAR SYSTEM DATA:
- Battery SOC: ${inverterData.battery_soc || 0}%
- PV generating: ${inverterData.pv_power || 0}W
- Grid: ${inverterData.grid_power > 0 ? `importing ${inverterData.grid_power}W` : `exporting ${Math.abs(inverterData.grid_power || 0)}W`}
- Today's PV yield: ${inverterData.daily_pv_kwh || 0} kWh
- Today's grid import: ${inverterData.daily_grid_import_kwh || 0} kWh
- Today's grid export: ${inverterData.daily_grid_export_kwh || 0} kWh

Factor solar generation into your predictions. If user generates significant PV, their net cost is lower. Include solar_optimization in your response.
` : ''}
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

// ── Deep Appliance Research Agent (Arcee Trinity) ───────────────
// Uses a dedicated research/reasoning model to generate multiple
// in-depth electricity saving strategies per appliance
async function researchApplianceSavings({ name, watts, hours_per_day, days_per_week, brand, model, category, lifestyleContext, ratePerKwh }) {
    try {
        const dailyKwh = (watts * (hours_per_day || 4)) / 1000;
        const monthlyCost = dailyKwh * (days_per_week || 7) / 7 * 30 * (ratePerKwh || 2.5);
        const annualCost = monthlyCost * 12;

        const prompt = `You are a deep-research South African energy efficiency expert. Analyze this appliance and provide MULTIPLE ways to save electricity, each with specific Rand savings.

APPLIANCE DETAILS:
- Name: ${name}
- Brand/Model: ${brand || 'Unknown'} ${model || ''}
- Category: ${category || 'general'}
- Wattage: ${watts}W
- Daily usage: ${hours_per_day || 4} hours, ${days_per_week || 7} days/week
- Monthly cost: R${monthlyCost.toFixed(0)}
- Annual cost: R${annualCost.toFixed(0)}
- SA electricity rate: R${ratePerKwh || 2.5}/kWh

USER LIFESTYLE:
${lifestyleContext || 'Unknown — provide generally applicable tips.'}

RESEARCH THESE ANGLES:
1. BEHAVIOURAL — Simple habit changes (e.g., shorter runtime, batch usage)
2. SCHEDULING — Time-of-use optimization (SA TOU: off-peak 22:00-06:00 = ~R1.20, peak 07:00-10:00 & 17:00-20:00 = ~R3.80)
3. TECHNICAL — Settings, maintenance, or mode changes on the appliance itself
4. UPGRADE — When replacing would pay for itself (energy-efficient alternatives)
5. COMPLEMENTARY — Other devices or timers that reduce this appliance's consumption
6. SA-SPECIFIC — Load shedding preparation, solar integration, geyser blankets, etc.

RETURN JSON:
{
    "applianceName": "${name}",
    "currentMonthlyCost": ${monthlyCost.toFixed(0)},
    "currentAnnualCost": ${annualCost.toFixed(0)},
    "totalPotentialSaving": number_rand_per_month,
    "strategies": [
        {
            "title": "Short catchy title",
            "type": "behavioural" | "scheduling" | "technical" | "upgrade" | "complementary" | "sa_specific",
            "description": "2-3 sentence explanation in casual SA English",
            "savingPerMonth": number_rand,
            "savingPercentage": number_percent,
            "effort": "easy" | "medium" | "hard",
            "investmentRequired": number_rand_or_zero,
            "paybackMonths": number_or_zero,
            "lifestyleFriendly": true_or_false
        }
    ],
    "funFact": "One interesting energy fact about this type of appliance"
}

Rules:
- Provide AT LEAST 5 strategies, sorted by easiest to hardest
- All savings must be specific Rand amounts based on actual watts and rate
- NEVER suggest anything torturous (cold showers, eating cold food)
- Sound like a knowledgeable friend, not a textbook
- If brand/model is known, include model-specific tips
- Return ONLY raw JSON, no markdown`;

        const response = await callAI(prompt, {
            model: RESEARCH_MODEL,
            temperature: 0.6,
            maxTokens: 2500,
        });

        console.log(`🔬 Research Response (${RESEARCH_MODEL}):`, response.substring(0, 150));
        return extractJSON(response);
    } catch (error) {
        console.error('Research agent error:', error.message);
        // Fallback basic tips
        const dailyKwh = (watts * (hours_per_day || 4)) / 1000;
        const monthlyCost = dailyKwh * (days_per_week || 7) / 7 * 30 * (ratePerKwh || 2.5);
        return {
            applianceName: name,
            currentMonthlyCost: Math.round(monthlyCost),
            strategies: [
                { title: 'Reduce daily usage', type: 'behavioural', description: `Using this ${watts}W appliance 1 hour less per day saves about R${Math.round(watts / 1000 * (ratePerKwh || 2.5) * 30)}/month.`, savingPerMonth: Math.round(watts / 1000 * (ratePerKwh || 2.5) * 30), effort: 'easy', lifestyleFriendly: true },
                { title: 'Use off-peak hours', type: 'scheduling', description: 'Running between 10pm-6am at off-peak rates can cut costs by 30-50%.', savingPerMonth: Math.round(monthlyCost * 0.3), effort: 'medium', lifestyleFriendly: true },
            ],
            funFact: `A ${watts}W appliance running 24/7 would cost R${Math.round(watts / 1000 * (ratePerKwh || 2.5) * 24 * 30)}/month!`
        };
    }
}

module.exports = { analyzeDeviceImage, consultantChat, extractLifestyleFromChat, generateDeviceTip, agentPredict, researchApplianceSavings };

// ═════════════════════════════════════════════════════════════════
// BOSS AGENT — GLM-4.5 coordinates VLM + Research LLM
// The boss reviews all agent outputs and makes the best decision
// ═════════════════════════════════════════════════════════════════

async function bossAnalyze({ scanResult, researchResult, lifestyleContext, inverterData, budgetData, userApiKey }) {
    try {
        const prompt = `You are the BOSS AI coordinator for StaticFund, a South African energy management app.

You have received analysis from two specialist AI agents. Your job is to:
1. REVIEW their outputs for accuracy and practicality
2. RESOLVE any conflicts between suggestions
3. ADD your own wisdom — things neither agent considered
4. PRIORITIZE — rank everything by impact × ease for this specific user
5. CREATE a unified, actionable plan

═══ AGENT 1: VISION SCAN (Qwen3-VL 235B) ═══
${JSON.stringify(scanResult, null, 2)}

═══ AGENT 2: RESEARCH (Arcee Trinity) ═══
${JSON.stringify(researchResult, null, 2)}

═══ USER CONTEXT ═══
Lifestyle: ${lifestyleContext || 'Unknown'}
${inverterData ? `Solar system: Battery ${inverterData.battery_soc}%, PV ${inverterData.pv_power}W, Grid ${inverterData.grid_power}W` : 'No solar system'}
${budgetData ? `Budget: R${budgetData.monthly}/month, ${budgetData.percentUsed}% used` : 'No budget set'}

CRITICAL RULES:
- Never suggest torturous actions (cold showers, eating cold food)
- Respect the user's lifestyle profile
- All numbers must be specific Rand amounts
- Sound like a smart, caring friend

Return JSON:
{
    "verdict": "One-sentence overall assessment",
    "confidenceInScan": "HIGH/MEDIUM/LOW — how accurate is the VLM identification?",
    "scanCorrections": "Any corrections to the scan result, or null",
    "topAction": {
        "title": "The #1 most impactful thing to do RIGHT NOW",
        "description": "Why and how, 2-3 sentences",
        "savingPerMonth": number_rand
    },
    "rankedStrategies": [
        {
            "rank": 1,
            "title": "title",
            "source": "research" or "boss_insight" or "scan",
            "description": "2 sentences",
            "savingPerMonth": number,
            "effort": "easy/medium/hard",
            "recommended": true_or_false
        }
    ],
    "bossInsights": ["Things neither agent considered"],
    "totalPotentialSaving": number_rand_per_month,
    "encouragement": "A motivating message for the user"
}

Return ONLY raw JSON, no markdown.`;

        const response = await callAI(prompt, {
            model: BOSS_MODEL,
            temperature: 0.5,
            maxTokens: 2000,
            userApiKey
        });

        console.log(`🧠 Boss Analysis (${BOSS_MODEL}):`, response.substring(0, 150));
        return extractJSON(response);
    } catch (error) {
        console.error('Boss agent error:', error.message);
        return {
            verdict: 'Analysis partially available — check individual agent results.',
            topAction: researchResult?.strategies?.[0] || { title: 'Review your appliance usage', description: 'Check the research tab for detailed tips.', savingPerMonth: 0 },
            rankedStrategies: researchResult?.strategies || [],
            bossInsights: ['Full analysis temporarily unavailable. Individual agent results are still valid.'],
            encouragement: 'Every small saving adds up! 💪'
        };
    }
}

// ── Reviewer Agent (Gemma 3) — Second pair of eyes ─────────────
async function reviewAnalysis({ scanResult, bossResult, researchResult, userApiKey }) {
    try {
        const prompt = `You are a REVIEWER AI for StaticFund, a South African energy app. Another AI team has analyzed an appliance. Your job:

1. VALIDATE — Are the wattage, savings calculations, and identification correct?
2. CHALLENGE — Are any tips impractical, wrong, or potentially harmful?
3. ADD — What did they miss? Any SA-specific considerations?
4. RATE — Give an overall quality score

SCAN RESULT: ${JSON.stringify(scanResult)}
BOSS VERDICT: ${JSON.stringify(bossResult?.verdict || 'N/A')}
TOP STRATEGIES: ${JSON.stringify(bossResult?.rankedStrategies?.slice(0, 3) || researchResult?.strategies?.slice(0, 3) || [])}

Return JSON:
{
    "qualityScore": 1-10,
    "scanAccuracy": "correct" or "plausible" or "questionable",
    "corrections": ["any factual errors found"] or [],
    "additionalTips": ["extra tips the other agents missed"],
    "warnings": ["any safety or practicality concerns"],
    "bestTipAgreement": "which top tip you most agree with and why, 1 sentence"
}

Return ONLY raw JSON.`;

        const response = await callAI(prompt, {
            model: REVIEWER_MODEL,
            temperature: 0.3,
            maxTokens: 1000,
            userApiKey
        });

        console.log(`👁️ Reviewer (${REVIEWER_MODEL}):`, response.substring(0, 120));
        return extractJSON(response);
    } catch (error) {
        console.error('Reviewer error:', error.message);
        return { qualityScore: 7, scanAccuracy: 'plausible', corrections: [], additionalTips: [], warnings: [] };
    }
}

// Full multi-agent pipeline: Scan → Research → Boss → Review
async function fullApplianceAnalysis(imageBuffer, mimeType, context = {}) {
    const { userApiKey } = context;

    // Step 1: VLM scans the appliance
    const scanResult = await analyzeDeviceImage(imageBuffer, mimeType, userApiKey);
    console.log('📸 Step 1 (VLM Scan) complete:', scanResult.name);

    // Step 2: Research agent generates saving strategies
    const researchResult = await researchApplianceSavings({
        ...scanResult,
        lifestyleContext: context.lifestyleContext,
        ratePerKwh: context.ratePerKwh,
        userApiKey
    });
    console.log('🔬 Step 2 (Research) complete:', researchResult.strategies?.length, 'strategies');

    // Step 3: Boss coordinates and synthesizes
    const bossResult = await bossAnalyze({
        scanResult,
        researchResult,
        lifestyleContext: context.lifestyleContext,
        inverterData: context.inverterData,
        budgetData: context.budgetData,
        userApiKey
    });
    console.log('🧠 Step 3 (Boss) complete:', bossResult.verdict);

    // Step 4: Reviewer validates everything
    const reviewResult = await reviewAnalysis({ scanResult, bossResult, researchResult, userApiKey });
    console.log('👁️ Step 4 (Review) complete: Score', reviewResult.qualityScore);

    return {
        scan: scanResult,
        research: researchResult,
        boss: bossResult,
        review: reviewResult,
        models: {
            vision: VISION_MODEL,
            research: RESEARCH_MODEL,
            boss: BOSS_MODEL,
            reviewer: REVIEWER_MODEL,
        }
    };
}

// ═════════════════════════════════════════════════════════════════
// SOLAR WATCHER AGENT — Qwen3 235B Thinking
// Actively monitors inverter data, database patterns, and other
// agent insights to help users get the best from their solar system
// ═════════════════════════════════════════════════════════════════

async function solarWatcherAnalyze({ inverterData, historicalData, communityInsights, otherAgentInsights, weather, homeContext, userApiKey }) {
    try {
        const prompt = `You are the SOLAR WATCHER — an advanced reasoning AI that continuously monitors a South African household's solar energy system.

You are NOT a chatbot. You are an intelligent watchdog that:
1. MONITORS real-time inverter data for anomalies and opportunities
2. SEARCHES your knowledge for solar best practices and SA-specific conditions
3. LEARNS from the shared database of other households
4. COORDINATES with other AI agents' recommendations
5. THINKS deeply before making any suggestion

═══ CURRENT SYSTEM STATE ═══
Battery SOC: ${inverterData?.battery_soc || '?'}%
Battery Power: ${inverterData?.battery_power || 0}W (${(inverterData?.battery_power || 0) > 0 ? 'CHARGING' : 'DISCHARGING'})
PV Production: ${inverterData?.pv_power || 0}W
Grid: ${inverterData?.grid_power || 0}W (${(inverterData?.grid_power || 0) > 0 ? 'IMPORTING from grid' : 'EXPORTING to grid'})
House Load: ${inverterData?.load_power || 0}W
Today's PV Yield: ${inverterData?.daily_pv_kwh || 0} kWh
Today's Grid Import: ${inverterData?.daily_grid_import_kwh || 0} kWh
Today's Grid Export: ${inverterData?.daily_grid_export_kwh || 0} kWh

═══ HISTORICAL PATTERNS (Last 7 Days) ═══
${JSON.stringify(historicalData || 'No history available')}

═══ COMMUNITY DATABASE INSIGHTS ═══
${JSON.stringify(communityInsights || 'No community data')}

═══ OTHER AI AGENTS SAY ═══
${JSON.stringify(otherAgentInsights || 'No other agent data')}

═══ WEATHER ═══
${JSON.stringify(weather || 'No weather data')}

═══ HOME CONTEXT ═══
${homeContext || 'Unknown household'}

THINK STEP BY STEP about:
1. Is the system performing optimally right now?
2. Are there any anomalies (unexpected grid import, low PV, battery not charging)?
3. Should the user change any settings (charge modes, SOC limits, grid charging)?
4. What will happen in the next few hours based on weather and patterns?
5. How does this home compare to similar homes in the database?

Return JSON:
{
    "systemHealth": "optimal" | "good" | "suboptimal" | "warning" | "critical",
    "healthScore": 1-100,
    "currentStatus": "One-line summary of what's happening right now",
    "anomalies": ["Any unusual patterns detected"],
    "immediateActions": [
        { "action": "what to do", "reason": "why", "priority": "high/medium/low", "automated": true_or_false }
    ],
    "forecast": {
        "nextHours": "What will happen in the next 2-4 hours",
        "recommendation": "What the user should do",
        "expectedPvKwh": number_estimated_remaining_pv_today
    },
    "communityComparison": "How this home compares to similar homes",
    "optimizationTips": ["Deep insights for long-term improvement"],
    "watcherNotes": "Internal reasoning summary for other agents"
}

Return ONLY raw JSON, no markdown.`;

        const response = await callAI(prompt, {
            model: SOLAR_WATCHER_MODEL,
            temperature: 0.4,
            maxTokens: 3000,
            userApiKey
        });

        console.log(`☀️ Solar Watcher (${SOLAR_WATCHER_MODEL}):`, response.substring(0, 150));

        // Handle thinking tags
        let cleanText = response;
        const thinkEnd = response.indexOf('</think>');
        if (thinkEnd !== -1) {
            cleanText = response.substring(thinkEnd + 8).trim();
        }

        return extractJSON(cleanText);
    } catch (error) {
        console.error('Solar Watcher error:', error.message);
        return {
            systemHealth: 'good',
            healthScore: 70,
            currentStatus: 'Monitoring active — detailed analysis temporarily unavailable.',
            anomalies: [],
            immediateActions: [],
            forecast: { nextHours: 'Check back shortly.', recommendation: 'Continue current settings.' },
            optimizationTips: [],
            watcherNotes: 'Watcher analysis failed, using defaults.'
        };
    }
}

module.exports = { analyzeDeviceImage, consultantChat, extractLifestyleFromChat, generateDeviceTip, agentPredict, researchApplianceSavings, bossAnalyze, reviewAnalysis, fullApplianceAnalysis, solarWatcherAnalyze };

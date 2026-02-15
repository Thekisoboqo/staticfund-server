require('dotenv').config();

// OpenRouter API configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'qwen/qwen-2.5-vl-72b-instruct';

// Helper: Send a prompt to OpenRouter and get text response
async function callAI(prompt, options = {}) {
    const messages = [];

    if (options.imageBase64 && options.mimeType) {
        // Vision request with image
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
            temperature: 0.7,
            max_tokens: 2000,
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

async function analyzeDeviceImage(imageBuffer, mimeType) {
    try {
        const prompt = `
        Analyze this image of an electrical device. 
        Identify the device type and estimate its power consumption details.
        Return ONLY a JSON object with the following fields:
        - name: (string) A short, descriptive name (e.g., "Kettle", "LED Bulb").
        - watts: (number) Estimated running wattage.
        - surge_watts: (number) Estimated surge wattage (0 if none).
        - hours_per_day: (number) Estimated average daily usage in hours (e.g., 0.5 for a kettle).
        - days_per_week: (number) Estimated usage days per week (usually 7).
        
        If you cannot identify the device, make a best guess based on similar looking appliances.
        Do not include markdown formatting like \`\`\`json. Just the raw JSON string.
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

async function getEnergyTips(deviceList, userProfile = {}) {
    if (!deviceList || deviceList.length === 0) {
        return { tips: [], schedules: [] };
    }
    try {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMonth = now.getMonth() + 1;
        const season = (currentMonth >= 5 && currentMonth <= 8) ? 'WINTER' : 'SUMMER';
        const isOffPeak = (currentHour >= 22 || currentHour < 6);
        const userRate = userProfile.rate_per_kwh || 2.72;
        const municipality = userProfile.municipality || userProfile.city || 'Unknown';

        const prompt = `
        You are a Senior Electrical Engineer and Energy Consultant with 20+ years of experience in South African residential energy systems.

        CONTEXT:
        - Current time: ${now.toLocaleTimeString('en-ZA')}
        - Current date: ${now.toLocaleDateString('en-ZA')}
        - Season: ${season}
        - Current off-peak status: ${isOffPeak ? 'YES (off-peak now)' : 'NO (peak hours)'}
        - User location: ${municipality}, ${userProfile.province || 'South Africa'}
        - Electricity rate: R${userRate}/kWh
        - Household size: ${userProfile.household_size || 'Unknown'}
        - Property type: ${userProfile.property_type || 'Unknown'}
        - Has pool: ${userProfile.has_pool ? 'Yes' : 'No'}
        - Cooking fuel: ${userProfile.cooking_fuel || 'Unknown'}
        - Works from home: ${userProfile.work_from_home || 'Unknown'}

        SA OFF-PEAK HOURS (Eskom TOU):
        - Off-peak: 22:00 - 06:00 (weekdays), All weekend
        - Standard: 09:00 - 17:00 (weekdays)  
        - Peak: 06:00 - 09:00 and 17:00 - 22:00 (weekdays)
        - Winter peak rates are ~3x off-peak rates

        Analyze these devices:
        ${JSON.stringify(deviceList)}

        CRITICAL RULES:
        - Analyze ONLY the devices listed above. Do NOT hallucinate devices.
        - Include SPECIFIC TIMES for switching devices ON/OFF
        - Factor in the current SEASON (${season}) for heating/cooling advice
        - Use the ACTUAL rate of R${userRate}/kWh in all calculations

        FORMAT YOUR RESPONSE AS JSON ONLY (no markdown):
        {
          "tips": [
            {
              "title": "Technical title",
              "description": "Detailed explanation with calculations using R${userRate}/kWh rate",
              "potential_savings": "R###/month",
              "implementation_steps": ["Step 1", "Step 2", "Step 3"],
              "priority": "HIGH/MEDIUM/LOW",
              "payback_period": "X months"
            }
          ],
          "schedules": [
            {
              "device_name": "Exact device name from inventory",
              "turn_on": "HH:MM",
              "turn_off": "HH:MM",
              "reason": "Why this schedule saves money",
              "estimated_daily_saving": "R##"
            }
          ]
        }

        REQUIREMENTS:
        - Every device that can be scheduled MUST have a schedule entry
        - Fridges: recommend thermostat settings, NOT turning off
        - Geysers: give specific timer ON/OFF times
        - Washing machines, dishwashers: recommend off-peak usage windows
        - Lights: recommend sunset/sunrise schedules
        - Calculate savings using R${userRate}/kWh
        - Be specific with times (e.g., "06:00" not "morning")
        
        Return ONLY the JSON object.
        `;

        const text = await callAI(prompt);
        console.log("AI Tips Response:", text);
        return extractJSON(text);

    } catch (error) {
        console.error("Tips Error:", error);
        throw new Error("Failed to generate tips");
    }
}

async function checkInventoryCompleteness(deviceList) {
    try {
        const prompt = `
        Analyze this list of electrical devices entered by a user for a home energy audit:
        ${JSON.stringify(deviceList)}

        Identify common household appliances that are MISSING from this list. 
        Common items to check for:
        - Geyser / Water Heater
        - Refrigerator / Fridge
        - Washing Machine
        - Electric Stove / Oven
        - WiFi Router
        - Lights / Lighting Circuits
        - Kettle
        - TV

        Return ONLY a JSON object with a "missing_items" array. Each item should have:
        - name: (string) The name of the missing appliance.
        - question: (string) A friendly question to ask the user (e.g., "I didn't see a Geyser. Do you have an electric water heater?").
        - estimated_watts: (number) Typical wattage for this appliance.
        
        Limit to the top 3 most likely missing essential items. If the list looks complete, return an empty array.
        Do not include markdown formatting.
        `;

        const text = await callAI(prompt);
        console.log("AI Completeness Response:", text);
        return extractJSON(text);

    } catch (error) {
        console.error("Completeness Error:", error);
        return { missing_items: [] };
    }
}

async function generateHabits(deviceList) {
    try {
        const prompt = `
        Act as a Professional Energy Consultant.
        Analyze this inventory for a South African home:
        ${JSON.stringify(deviceList)}

        Create 5-7 personalized daily energy-saving habits. 
        Focus on BEHAVIORAL changes based on the SPECIFIC devices present.

        Examples:
        - If Pool Pump exists -> "Run pool pump for 4h only (Winter)"
        - If Tumble Dryer exists -> "Sun dry one load of laundry"
        - If Geyser exists -> "Shower in under 5 minutes"
        - If Dishwasher exists -> "Run dishwasher only when fully packed"
        - General -> "Turn off lights in empty rooms"

        Return JSON ONLY:
        {
            "habits": [
                { "title": "Short Title", "description": "Actionable description", "impact_level": "HIGH/MEDIUM/LOW" }
            ]
        }
        `;

        const text = await callAI(prompt);
        console.log("AI Habits Response:", text);
        const result = extractJSON(text);
        return result;
    } catch (error) {
        console.error("Habits Error:", error);
        return { habits: [] };
    }
}

async function interviewUser(deviceList) {
    try {
        const prompt = `
        You are an inquisitive Energy Auditor.
        Review this list of devices:
        ${JSON.stringify(deviceList)}

        Determine the ONE most critical missing appliance that a typical home should have but is missing here (e.g., Geyser, Fridge, Stove, Kettle).
        
        If the list looks complete (has all essentials), return null.
        
        If something is missing, ask a friendly question to check if they have it.
        Also provide the suggested device details if they say "Yes".

        Return JSON ONLY:
        {
            "question": "I noticed you don't have a Geyser listed. Do you use an electric water heater?",
            "suggested_device": { "name": "Geyser (150L)", "watts": 3000, "surge_watts": 0 }
        }
        OR return the word null if complete.
        `;

        const text = await callAI(prompt);
        console.log("AI Interview Response:", text);

        if (text.includes("null") || text.trim() === "") return null;
        return extractJSON(text);
    } catch (error) {
        console.error("Interview Error:", error);
        return null;
    }
}

async function getSmartSolarQuotes(deviceList, userProfile = {}) {
    try {
        let rateInfo = { rate: 2.72, season: 'SUMMER' };
        let peakSunHours = 5.5;
        try {
            const rates = require('./ratesDatabase');
            rateInfo = rates.getSeasonalRate(userProfile.city || userProfile.province);
            peakSunHours = rates.getPeakSunHours(userProfile.province);
        } catch (e) { /* rates module may not exist */ }

        let totalDailyKwh = 0;
        let totalRunningWatts = 0;
        let totalSurgeWatts = 0;
        deviceList.forEach(d => {
            const hours = d.hours_per_day || 4;
            totalDailyKwh += (d.watts * hours) / 1000;
            totalRunningWatts += d.watts;
            totalSurgeWatts += (d.surge_watts || d.watts);
        });

        const prompt = `
        You are a Solar Installation Expert in South Africa with 15+ years experience.

        USER PROFILE:
        - Location: ${userProfile.city || 'Unknown'}, ${userProfile.province || 'South Africa'}
        - Peak Sun Hours: ${peakSunHours}h/day
        - Current electricity rate: R${rateInfo.rate}/kWh (${rateInfo.season})
        - Monthly spend: R${userProfile.monthly_spend || 'Unknown'}
        - Household size: ${userProfile.household_size || 'Unknown'}
        - Property type: ${userProfile.property_type || 'Unknown'}

        LOAD ANALYSIS:
        - Total daily consumption: ${totalDailyKwh.toFixed(1)} kWh/day
        - Total running watts: ${totalRunningWatts}W
        - Total surge watts: ${totalSurgeWatts}W
        - Devices: ${JSON.stringify(deviceList.map(d => ({ name: d.name, watts: d.watts, surge: d.surge_watts })))}

        Generate 3 REALISTIC solar package options for this home.
        Use REAL South African component pricing (2024/2025 prices).

        FORMAT AS JSON ONLY:
        {
          "packages": [
            {
              "tier": "Essential",
              "description": "What this covers",
              "devices_covered": ["list of devices"],
              "inverter": "Brand/type and size",
              "inverter_cost": "R##,###",
              "panels": "Count x Wattage",
              "panels_cost": "R##,###",
              "battery": "Type and size",
              "battery_cost": "R##,###",
              "installation_cost": "R##,###",
              "total_cost": "R##,### - R##,###",
              "monthly_savings": "R#,###",
              "payback_years": 5,
              "recommended_for": "Load shedding backup only"
            },
            {
              "tier": "Comfort",
              "description": "...",
              "...": "same fields"
            },
            {
              "tier": "Off-Grid",
              "description": "...",
              "...": "same fields"
            }
          ]
        }

        REQUIREMENTS:
        - Prices must be REALISTIC for SA market
        - Essential = minimum viable (survive load shedding)
        - Comfort = full home excluding heavy loads
        - Off-Grid = complete energy independence
        - Include installation costs
        - Calculate payback based on R${rateInfo.rate}/kWh rate
        - Reference actual component brands available in SA (e.g., Sunsynk, Deye, Canadian Solar)

        Return ONLY the JSON.
        `;

        const text = await callAI(prompt);
        console.log("Solar Quotes Response:", text);
        return extractJSON(text);
    } catch (error) {
        console.error("Solar Quotes Error:", error);
        throw new Error("Failed to generate solar quotes");
    }
}

async function getOnboardingQuestion(currentProfile) {
    try {
        const prompt = `
        You are an energy consultant onboarding a new user for a South African energy saving app.
        
        Current user profile (what we already know):
        ${JSON.stringify(currentProfile)}

        Fields we need to fill:
        - name (string)
        - monthly_spend (number - monthly electricity in Rands)
        - household_size (string - "1", "2", "3-4", "5+")
        - property_type (string - "house", "apartment", "townhouse")
        - has_pool (boolean)
        - cooking_fuel (string - "electric", "gas", "both")
        - work_from_home (string - "yes", "sometimes", "no")

        NOTE: Do NOT ask about province or city — the app automatically detects location via GPS.

        Look at what is already filled and ask the NEXT most useful question.
        Be friendly and conversational, like chatting with a neighbor.
        
        Format as JSON:
        {
          "question": "Your friendly question text",
          "field": "the_database_field_name",
          "options": ["Option 1", "Option 2", "Option 3"],
          "type": "select" or "text" or "number",
          "complete": false
        }

        If ALL fields are filled, return:
        {
          "question": "Great! I have everything I need to give you amazing energy insights!",
          "field": null,
          "options": [],
          "type": "done",
          "complete": true
        }

        Return ONLY JSON.
        `;

        const text = await callAI(prompt);
        console.log("Onboarding Question:", text);
        return extractJSON(text);
    } catch (error) {
        console.error("Onboarding Question Error:", error);
        throw new Error("Failed to get onboarding question");
    }
}

module.exports = { analyzeDeviceImage, getEnergyTips, checkInventoryCompleteness, generateHabits, interviewUser, getSmartSolarQuotes, getOnboardingQuestion };

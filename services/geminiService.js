const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-preview-04-17",
});

// Model with Google Search grounding for real-time data
const groundedModel = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-preview-04-17",
    tools: [{ googleSearch: {} }],
});

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

        const imagePart = {
            inlineData: {
                data: imageBuffer.toString("base64"),
                mimeType: mimeType
            },
        };

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text();

        console.log("Gemini Raw Response:", text); // Debug log

        // Clean up potential markdown formatting
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("Invalid response format from AI");
        }

        return JSON.parse(jsonMatch[0]);

    } catch (error) {
        console.error("Gemini Scan Error:", error);
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
        const currentMonth = now.getMonth() + 1; // 1-12
        const season = (currentMonth >= 5 && currentMonth <= 8) ? 'WINTER' : 'SUMMER';
        const isOffPeak = (currentHour >= 22 || currentHour < 6);

        // Get user rate if available
        const userRate = userProfile.rate_per_kwh || 2.72;
        const municipality = userProfile.municipality || userProfile.city || 'Unknown';

        const prompt = `
        You are a Senior Electrical Engineer and Energy Consultant with 20+ years of experience in South African residential energy systems.
        Use Google Search to find the LATEST electricity tariffs for the user's municipality if possible.

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

        const result = await groundedModel.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        console.log("Gemini Tips Raw Response:", text);

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("Invalid response format from AI");
        }

        return JSON.parse(jsonMatch[0]);

    } catch (error) {
        console.error("Gemini Tips Error:", error);
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

        Return ONLY a JSON object with a "missing_items" array.Each item should have:
        - name: (string) The name of the missing appliance.
        - question: (string) A friendly question to ask the user(e.g., "I didn't see a Geyser. Do you have an electric water heater?").
        - estimated_watts: (number) Typical wattage for this appliance.
        
        Limit to the top 3 most likely missing essential items.If the list looks complete, return an empty array.
        Do not include markdown formatting.
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        console.log("Gemini Completeness Raw Response:", text);

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return { missing_items: [] }; // Fallback
        }

        return JSON.parse(jsonMatch[0]);

    } catch (error) {
        console.error("Gemini Completeness Error:", error);
        return { missing_items: [] };
    }
}

async function generateHabits(deviceList) {
    try {
        const prompt = `
        Act as a Professional Energy Consultant.
        Analyze this inventory for a South African home:
        ${JSON.stringify(deviceList)}

        Create 5 - 7 personalized daily energy - saving habits. 
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

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        console.log("Gemini Habits Response:", text);
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : { habits: [] };
    } catch (error) {
        console.error("Gemini Habits Error:", error);
        return { habits: [] };
    }
}

async function interviewUser(deviceList) {
    try {
        const prompt = `
        You are an inquisitive Energy Auditor.
        Review this list of devices:
        ${JSON.stringify(deviceList)}

        Determine the ONE most critical missing appliance that a typical home should have but is missing here(e.g., Geyser, Fridge, Stove, Kettle).
        
        If the list looks complete(has all essentials), return null.
        
        If something is missing, ask a friendly question to check if they have it.
        Also provide the suggested device details if they say "Yes".

        Return JSON ONLY:
        {
            "question": "I noticed you don't have a Geyser listed. Do you use an electric water heater?",
                "suggested_device": { "name": "Geyser (150L)", "watts": 3000, "surge_watts": 0 }
        }
        OR return null if complete.
        `;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        console.log("Gemini Interview Response:", text);

        // Handle "null" or empty response
        if (text.includes("null") || text.trim() === "") return null;

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (error) {
        console.error("Gemini Interview Error:", error);
        return null;
    }
}

async function getSmartSolarQuotes(deviceList, userProfile = {}) {
    try {
        const rates = require('./ratesDatabase');
        const rateInfo = rates.getSeasonalRate(userProfile.city || userProfile.province);
        const peakSunHours = rates.getPeakSunHours(userProfile.province);

        // Calculate total load
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
        Use Google Search to find CURRENT 2025 solar component prices in South Africa for accurate quotes.

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
              "description": "What this covers (e.g. lights, fridge, wifi, phone charging)",
              "devices_covered": ["list of devices from inventory this covers"],
              "inverter": "Brand/type and size (e.g., 3kW Hybrid Inverter)",
              "inverter_cost": "R##,###",
              "panels": "Count x Wattage (e.g., 4x 450W panels)",
              "panels_cost": "R##,###",
              "battery": "Type and size (e.g., 5.12kWh Lithium LFP)",
              "battery_cost": "R##,###",
              "installation_cost": "R##,###",
              "total_cost": "R##,### - R##,###",
              "monthly_savings": "R#,###",
              "payback_years": #,
              "recommended_for": "Load shedding backup only"
            },
            {
              "tier": "Comfort",
              "description": "...",
              ...same fields...
            },
            {
              "tier": "Off-Grid",
              "description": "...",
              ...same fields...
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

        const result = await groundedModel.generateContent(prompt);
        const text = result.response.text();
        console.log("Solar Quotes Raw:", text);

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Invalid solar quote response");

        return JSON.parse(jsonMatch[0]);
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

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        console.log("Onboarding Question:", text);

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Invalid onboarding response");

        return JSON.parse(jsonMatch[0]);
    } catch (error) {
        console.error("Onboarding Question Error:", error);
        throw new Error("Failed to get onboarding question");
    }
}

module.exports = { analyzeDeviceImage, getEnergyTips, checkInventoryCompleteness, generateHabits, interviewUser, getSmartSolarQuotes, getOnboardingQuestion };


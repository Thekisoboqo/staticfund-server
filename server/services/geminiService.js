const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
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

async function getEnergyTips(deviceList) {
    try {
        const prompt = `
        You are a Senior Electrical Engineer and Energy Consultant with 20+ years of experience in South African residential energy systems. You are conducting a professional energy audit.

        Analyze the following electrical device inventory and usage patterns:
        ${JSON.stringify(deviceList)}

        Provide PROFESSIONAL, ENGINEERING-GRADE recommendations. Your analysis should reflect:
        1. Deep technical knowledge of electrical systems and power factor
        2. Understanding of South African electricity tariffs (Eskom, Municipal)
        3. Practical experience with load management and demand-side optimization
        4. Knowledge of modern energy-efficient technologies (inverter motors, LED, VSD drives)
        5. Deep insight into BEHAVIORAL and OPERATIONAL efficiency (e.g., "Run dishwasher only when full", "Reduce washing temperature to 30°C")

        For EACH device where optimization is possible, provide a detailed recommendation. 
        Think deeply about how the device is operated, not just its hardware rating.

        SPECIFIC CHECKS:
        - Dishwasher/Washing Machine: Suggest full loads, eco-cycles, and lower temperatures.
        - Geyser: Suggest timing (not running 24/7 if usage suggests it), temperature settings, and blankets.
        - Pool Pump: Suggest reduced running hours in winter vs summer.
        - Fridge: Suggest checking seals and spacing if consumption seems high.

        FORMAT YOUR RESPONSE AS JSON ONLY (no markdown):
        {
          "tips": [
            {
              "title": "Technical title (e.g., 'Geyser Load Optimization')",
              "description": "Detailed engineering explanation. Include: (1) Current power consumption analysis, (2) Technical cause of inefficiency, (3) Specific solution with wattage/efficiency comparisons, (4) Expected savings calculation showing your math.",
              "potential_savings": "R###/month",
              "implementation_steps": [
                "Step 1: Specific technical action",
                "Step 2: ...",
                "Step 3: ..."
              ],
              "priority": "HIGH/MEDIUM/LOW",
              "payback_period": "X months"
            }
          ]
        }

        CRITICAL REQUIREMENTS:
        - Always cite specific wattages, efficiencies, and calculations
        - Reference SA electricity rates (~R2.50/kWh average)
        - Include payback period for any recommended equipment upgrades
        - Prioritize by ROI and ease of implementation
        - Be specific: "Replace 60W incandescent with 7W LED (88% reduction)" not "use efficient bulbs"
        
        Return ONLY the JSON object. No explanatory text before or after.
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        console.log("Gemini Tips Raw Response:", text); // Debug log

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

        Return ONLY a JSON object with a "missing_items" array. Each item should have:
        - name: (string) The name of the missing appliance.
        - question: (string) A friendly question to ask the user (e.g., "I didn't see a Geyser. Do you have an electric water heater?").
        - estimated_watts: (number) Typical wattage for this appliance.
        
        Limit to the top 3 most likely missing essential items. If the list looks complete, return an empty array.
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

        Determine the ONE most critical missing appliance that a typical home should have but is missing here (e.g., Geyser, Fridge, Stove, Kettle).
        
        If the list looks complete (has all essentials), return null.
        
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

module.exports = { analyzeDeviceImage, getEnergyTips, checkInventoryCompleteness, generateHabits, interviewUser };

require('dotenv').config();
const { callAI, extractJSON } = require('./geminiService');
const { getCommunityInsights } = require('./optimizerAgent');

// ── Appliance Analyst Agent ───────────────────────────────────────
// Identifies correlation between power spikes and habits
async function runApplianceAnalyst(homeId, inverterData, lifestyleContext) {
    const prompt = `You are the Appliance Analyst Agent for a smart home energy crew.
    
    YOUR JOB: Analyze real-time inverter load data and correlate it with the user's known lifestyle to deduce WHAT appliance is running and PREDICT how long it will run.
    
    INVERTER DATA:
    - Current Load: ${inverterData?.load_power || 0}W
    - PV Yield: ${inverterData?.pv_power || 0}W
    - Battery SOC: ${inverterData?.battery_soc || 0}%
    
    USER LIFESTYLE:
    ${lifestyleContext || 'No context provided.'}
    
    Compare the current load to typical household appliances (e.g., Geyser ~3kW, Kettle ~2kW, Oven ~2.5kW, TV ~150W). 
    Consider the time of day and the lifestyle context (e.g., if it's 18:00 and they "cook dinner at 18:00", a 2kW load is probably an oven).
    
    Return pure JSON:
    {
        "deduced_appliance": "Name of appliance likely running",
        "predicted_runtime_minutes": 45,
        "confidence": 0.85,
        "reasoning": "Brief explanation"
    }`;

    try {
        const response = await callAI(prompt, { temperature: 0.3, maxTokens: 400 });
        return extractJSON(response);
    } catch (err) {
        console.error('Appliance Analyst Error:', err.message);
        return { deduced_appliance: "Unknown Load", predicted_runtime_minutes: 0, confidence: 0, reasoning: "Error" };
    }
}

// ── Battery Optimizer Agent ───────────────────────────────────────
// Synthesizes load predictions with grid tariffs to schedule charging
async function runBatteryOptimizer(inverterData, analystReport, rates) {
    const prompt = `You are the Battery Optimizer Agent.
    
    YOUR JOB: Decide if the home's battery needs to be charged from the grid RIGHT NOW to support the predicted load safely, while minimizing costs based on Time-of-Use tariffs.
    
    SYSTEM STATE:
    - Battery SOC: ${inverterData?.battery_soc || 0}%
    - Target SOC (Safe minimum): 40%
    
    PREDICTED LOAD (From Analyst):
    - Appliance: ${analystReport.deduced_appliance}
    - Expected Runtime: ${analystReport.predicted_runtime_minutes} mins
    - Confidence: ${analystReport.confidence}
    
    GRID TARIFFS:
    - Current Rate: R${rates?.current_rate || 2.50}/kWh
    
    If the battery will drop below 40% based on the expected runtime, should we grid charge now? Or is it safe to wait for PV/off-peak?
    
    Return pure JSON:
    {
        "recommend_grid_charge": true/false,
        "target_charge_soc": 80,
        "reasoning": "Brief explanation"
    }`;

    try {
        const response = await callAI(prompt, { temperature: 0.2, maxTokens: 400 });
        return extractJSON(response);
    } catch (err) {
        return { recommend_grid_charge: false, target_charge_soc: 0, reasoning: "Optimizer unavailable" };
    }
}

// ── Environmental Guardian Agent ──────────────────────────────────
// Checks external factors like Weather and Earth Engine data
async function runEnvironmentalGuardian(locationContext) {
    const prompt = `You are the Environmental Guardian Agent.
     
     YOUR JOB: Review external disaster, weather, and Earth Engine data to determine if an emergency override is needed.
     
     LOCATION: ${locationContext || 'Mangaung Region'}
     (Simulating weather/earth engine pull...)
     - Severe Weather Risk: Low
     - Grid Stability: High
     - Drought Risk: Medium
     
     If there is a high risk (e.g. storm crossing paths), we must force 100% battery charge.
     
     Return pure JSON:
     {
        "emergency_override": false,
        "threat_level": "LOW",
        "reasoning": "No immediate threats."
     }`;

    try {
        const response = await callAI(prompt, { temperature: 0.2, maxTokens: 300 });
        return extractJSON(response);
    } catch (err) {
        return { emergency_override: false, threat_level: "UNKNOWN", reasoning: "Guardian error." };
    }
}

// ── Coordinator Agent ─────────────────────────────────────────────
// Synthesizes reports into a user-friendly message
async function runCoordinator(analyst, optimizer, guardian, userInput) {
    const prompt = `You are the Coordinator Agent for StaticFund's energy crew.
    
    Read the reports from your specialized agents and respond to the user:
    USER ASKED: "${userInput}"
    
    ANALYST REPORT: ${JSON.stringify(analyst)}
    OPTIMIZER REPORT: ${JSON.stringify(optimizer)}
    GUARDIAN REPORT: ${JSON.stringify(guardian)}
    
    Write a concise, helpful response to the user.
    - If there's an emergency, prioritize the Guardian's warning.
    - Otherwise, gently explain the battery/appliance situation.
    - Keep it under 4 sentences.
    - STRICT RULE: NEVER output exact addresses, exact GPS coordinates, or raw time-logs. Keep location references vague (e.g. "your area").`;

    try {
        return await callAI(prompt, { temperature: 0.6, maxTokens: 600 });
    } catch (err) {
        return "I'm having trouble coordinating the crew right now. Please try again soon.";
    }
}

// ── Lead Generation Agent (B2B Specialist) ────────────────────────
async function runLeadGenAgent(auditData) {
    const prompt = `You are the B2B Lead Generation Agent for StaticFund.
    
    YOUR JOB: Convert a household energy audit into a professional, "bankable" prospect report that an installer can use to close a sale.
    
    AUDIT DATA:
    ${JSON.stringify(auditData)}
    
    Generate a professional summary including:
    1. Estimated System Size needed (kW).
    2. Estimated Number of Panels.
    3. Estimated Battery Capacity (kWh).
    4. Expected Annual Savings (ZAR).
    5. ROI Period (Years).
    6. "Prospect Warmth" Score (Out of 100) based on their current high-consumption devices.
    
    Return pure JSON:
    {
        "system_size_kw": 5.0,
        "panel_count": 8,
        "battery_kwh": 10.0,
        "est_annual_savings": 12000,
        "roi_years": 4.5,
        "prospect_score": 85,
        "sales_hook": "A short sentence highlighting the biggest saving opportunity for the installer to mention."
    }`;

    try {
        const response = await callAI(prompt, { temperature: 0.3, maxTokens: 600 });
        return extractJSON(response);
    } catch (err) {
        console.error('Lead Gen Agent Error:', err.message);
        return { error: "Failed to generate bankable report" };
    }
}

// ── Installer Matching Logic ──────────────────────────────────────
async function matchInstaller(homeLat, homeLon, pool) {
    // Basic coordinate distance matching (Pythagorean for small distances is fine for MVP)
    const installersRes = await pool.query(`
        SELECT *, 
        (sqrt(pow(latitude - $1, 2) + pow(longitude - $2, 2)) * 111) as distance_km
        FROM installers
        WHERE (sqrt(pow(latitude - $1, 2) + pow(longitude - $2, 2)) * 111) <= service_radius_km
        ORDER BY rating DESC, distance_km ASC
        LIMIT 1
    `, [homeLat, homeLon]);

    return installersRes.rows[0] || null;
}

// ── B2B Pipeline Execution ────────────────────────────────────────
async function executeB2BLeadGeneration(homeId, pool) {
    console.log(`💼 Generating B2B Lead for Home ${homeId}...`);

    try {
        // 1. Get Home & Audit Data
        const homeRes = await pool.query('SELECT h.*, u.latitude, u.longitude FROM homes h JOIN home_members hm ON h.id = hm.home_id JOIN users u ON hm.user_id = u.id WHERE h.id = $1 LIMIT 1', [homeId]);
        const home = homeRes.rows[0];

        const devicesRes = await pool.query(`
            SELECT d.*, r.name as room_name 
            FROM devices d JOIN rooms r ON d.room_id = r.id 
            WHERE d.home_id = $1
        `, [homeId]);

        const auditData = {
            monthly_budget: home.monthly_budget,
            device_count: devicesRes.rows.length,
            total_daily_kwh: devicesRes.rows.reduce((sum, d) => sum + (d.watts * d.hours_per_day / 1000), 0),
            devices: devicesRes.rows.map(d => ({ name: d.name, watts: d.watts, hours: d.hours_per_day }))
        };

        // 2. Run LeadGen Agent
        const leadReport = await runLeadGenAgent(auditData);

        // 3. Match Installer
        const installer = await matchInstaller(home.latitude, home.longitude, pool);

        // 4. Save Lead
        const leadRes = await pool.query(`
            INSERT INTO market_leads (home_id, installer_id, lead_report, status)
            VALUES ($1, $2, $3, 'NEW')
            RETURNING id
        `, [homeId, installer ? installer.id : null, JSON.stringify(leadReport)]);

        return {
            lead_id: leadRes.rows[0].id,
            report: leadReport,
            matched_installer: installer ? installer.company_name : "No local installer found yet"
        };
    } catch (err) {
        console.error('B2B Lead Gen Pipeline Error:', err.message);
        throw err;
    }
}

// ── Privacy Filter Agent ──────────────────────────────────────────
// Final Scrubber
async function runPrivacyScrubber(text) {
    // 1. Hard Regex Scrubbing
    let scrubbed = text;

    // Scrub coordinates like -29.123, 26.123
    const coordTracker = /[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?)\s*,\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)/g;
    scrubbed = scrubbed.replace(coordTracker, '[REDACTED COORDS]');

    // Scrub explicit Street Addresses (Very basic regex for 123 Main St formats)
    const addressTracker = /\d{1,5}\s(?:[A-Za-z0-9\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Circle|Cir|Way|Place|Pl|Square|Sq)\b)/ig;
    scrubbed = scrubbed.replace(addressTracker, '[REDACTED ADDRESS]');

    // 2. LLM Semantic Scrubbing (Double check)
    const prompt = `You are an aggressive Privacy Filter Agent.
    
    TEXT: "${scrubbed}"
    
    Examine the text. If you see ANY exact GPS coordinates, exact street addresses, or highly sensitive raw user schedules (e.g., "User leaves house exactly at 07:14 AM and returns at 17:33 PM"), replace those specific parts with "[REDACTED]". 
    Leave the rest of the text completely unchanged. Output ONLY the scrubbed text. Do not add any conversational filler.`;

    try {
        const finalScrub = await callAI(prompt, { temperature: 0.1, maxTokens: 600 });
        return finalScrub.trim();
    } catch (err) {
        // Fallback to regex scrub if LLM fails
        return scrubbed;
    }
}

// ── Main Pipeline ─────────────────────────────────────────────────
async function executeResilienceCrew(homeId, pool, userInput, lifestyleContext, inverterData, rates) {
    console.log(`🚀 Routing tasks for Home ${homeId} via CrewAI architecture...`);

    // 1. Run specialized agents in parallel
    const [analystReport, guardianReport] = await Promise.all([
        runApplianceAnalyst(homeId, inverterData, lifestyleContext),
        runEnvironmentalGuardian('Mangaung') // Should pull actual location
    ]);

    // 2. Optimizer needs analyst report
    const optimizerReport = await runBatteryOptimizer(inverterData, analystReport, rates);

    // 3. Coordinator synthesizes
    const rawResponse = await runCoordinator(analystReport, optimizerReport, guardianReport, userInput);

    // 4. Privacy Scrubber checks output
    const safeResponse = await runPrivacyScrubber(rawResponse);

    return {
        reply: safeResponse,
        crew_telemetry: {
            appliance_analyst: analystReport,
            battery_optimizer: optimizerReport,
            environmental_guardian: guardianReport
        }
    };
}

module.exports = {
    executeResilienceCrew,
    runApplianceAnalyst,
    runBatteryOptimizer,
    runEnvironmentalGuardian,
    runPrivacyScrubber,
    executeB2BLeadGeneration,
    runLeadGenAgent
};

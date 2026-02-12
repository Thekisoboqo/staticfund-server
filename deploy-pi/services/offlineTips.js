/**
 * Offline Fallback Tips
 * Pre-computed energy saving tips when Gemini AI is unavailable
 */

const OFFLINE_TIPS = {
    geyser: {
        title: "Geyser Timer Installation",
        description: "Your geyser (water heater) is likely your highest energy consumer at ~3000W. Installing a timer to run only 2 hours before peak usage times (morning/evening) can reduce consumption by 40-50%.",
        potential_savings: "R200-400/month",
        implementation_steps: [
            "Purchase a geyser timer (R150-300 at hardware stores)",
            "Set timer for 4-6am and 4-6pm",
            "Consider a geyser blanket for additional 10% savings"
        ],
        priority: "HIGH",
        payback_period: "1 month"
    },
    fridge: {
        title: "Refrigerator Efficiency",
        description: "Running at optimal temperature (3-4°C for fridge, -18°C for freezer) prevents overcooling. Ensure door seals are intact and coils are dust-free.",
        potential_savings: "R50-100/month",
        implementation_steps: [
            "Check door seal by closing on a piece of paper - it should grip",
            "Clean condenser coils at the back",
            "Don't place hot food directly in fridge"
        ],
        priority: "MEDIUM",
        payback_period: "Immediate"
    },
    lighting: {
        title: "LED Lighting Upgrade",
        description: "Replacing old incandescent or CFL bulbs with LEDs reduces lighting energy by 75-85%. A 60W incandescent = 7W LED with same brightness.",
        potential_savings: "R80-150/month",
        implementation_steps: [
            "Count all bulbs in home",
            "Replace most-used bulbs first (living room, kitchen)",
            "Choose warm white (2700K) for living areas"
        ],
        priority: "HIGH",
        payback_period: "3-6 months"
    },
    pool_pump: {
        title: "Pool Pump Scheduling",
        description: "Pool pumps typically run 8+ hours but often only need 4-6 hours. Run during off-peak hours (10pm-6am) for lower rates.",
        potential_savings: "R150-300/month",
        implementation_steps: [
            "Reduce run time to 6 hours in summer, 4 hours in winter",
            "Install a timer if not present",
            "Consider a variable speed pump for 70% savings"
        ],
        priority: "HIGH",
        payback_period: "Immediate with timer"
    },
    stove: {
        title: "Cooking Efficiency",
        description: "Electric stoves at 1500-2500W are major consumers. Use correctly sized pots (matching element size) and lids to reduce cooking time by 25%.",
        potential_savings: "R50-100/month",
        implementation_steps: [
            "Match pot size to element size",
            "Always use lids when boiling",
            "Turn off elements 5 minutes before food is done"
        ],
        priority: "MEDIUM",
        payback_period: "Immediate"
    },
    general: {
        title: "Standby Power Elimination",
        description: "Devices on standby consume 5-10% of household electricity. TVs, gaming consoles, and chargers are common culprits.",
        potential_savings: "R30-80/month",
        implementation_steps: [
            "Use power strips with switches",
            "Unplug phone chargers when not in use",
            "Switch off entertainment center at wall when sleeping"
        ],
        priority: "LOW",
        payback_period: "Immediate"
    }
};

/**
 * Get fallback tips based on device names
 */
function getOfflineTips(devices) {
    const tips = [];
    const deviceNames = devices.map(d => d.name.toLowerCase());

    // Check for specific devices
    if (deviceNames.some(n => n.includes('geyser') || n.includes('water heater'))) {
        tips.push(OFFLINE_TIPS.geyser);
    }

    if (deviceNames.some(n => n.includes('fridge') || n.includes('refrigerator'))) {
        tips.push(OFFLINE_TIPS.fridge);
    }

    if (deviceNames.some(n => n.includes('light') || n.includes('bulb') || n.includes('lamp'))) {
        tips.push(OFFLINE_TIPS.lighting);
    }

    if (deviceNames.some(n => n.includes('pool') || n.includes('pump'))) {
        tips.push(OFFLINE_TIPS.pool_pump);
    }

    if (deviceNames.some(n => n.includes('stove') || n.includes('oven') || n.includes('hob'))) {
        tips.push(OFFLINE_TIPS.stove);
    }

    // Always include general tip
    tips.push(OFFLINE_TIPS.general);

    return { tips, offline: true };
}

module.exports = { getOfflineTips, OFFLINE_TIPS };

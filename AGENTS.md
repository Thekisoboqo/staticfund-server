# StaticFund Energy: Agent Architecture
*Core Philosophy: "Buy Less, Live More — Then Go Solar"*

## Our Mission
StaticFund is the only mobile app that takes a household from saving electricity → sizing a solar system → matching with a verified installer → and then managing their solar autonomously. We combine AI agents with real-time inverter data to deliver the full energy journey in one app.

---

## 1. Energy Savings Agent
**Primary Role:** An empathetic AI consultant that helps households reduce electricity consumption and protect their budget.

### Key Behaviors:
- **Appliance Analysis:** Uses camera-based recognition to identify appliances, estimate their wattage, and calculate daily/monthly running costs.
- **Budget Protection:** Monitors spending against a user-set monthly budget. Predicts "run-out date" and activates Survival Mode when overspending is detected.
- **Lifestyle-Aware Tips:** Learns user habits through conversation and provides personalized, non-intrusive savings recommendations (e.g., "Your geyser runs 6hrs/day — a timer could save R90/month").
- **Invisible Copilot:** Passively monitors live meter data for usage spikes, deduces which appliance caused them, and delivers actionable micro-tips in real-time.

---

## 2. Solar Sizing Agent
**Primary Role:** Provides consumer-friendly, AI-powered solar and wind system design — no engineering degree required.

### Key Behaviors:
- **Camera-Based Site Survey:** Point your phone at your roof → AI estimates available area, tilt, orientation, and shading to recommend optimal panel placement.
- **System Sizing:** Based on user's actual consumption data (from the Energy Savings Agent), recommends inverter size, battery capacity, and panel count.
- **Shadow Inverter Simulation:** For non-solar users, simulates what their energy bill would look like *if* they had solar — showing potential savings before purchase.
- **Wind Feasibility:** (Future) Assesses small-scale wind generation potential based on location and local weather data.
- **Wire Sizing & Engineering Tools:** Provides installers with cable sizing, voltage drop calculations, and BOS recommendations.

---

## 3. Installer Matching Agent
**Primary Role:** Bridges the gap between homeowner energy data and professional installers via AI-scored matching.

### Key Behaviors:
- **Lead Generation:** Converts sizing results into qualified leads with pre-filled system specs and budget range.
- **AI Matching:** Scores installers based on proximity, system fit (brand compatibility), pricing tier, reviews, and portfolio quality.
- **Installer Portal:** Gives installers a dashboard with incoming leads, engineering tools (wire sizing, panel layout), and performance analytics.
- **Quote Comparison:** (Future) Enables homeowners to receive and compare multiple installer quotes side-by-side.
- **Revenue Model:** Commission per qualified lead or completed installation.

---

## 4. Autonomous Solar Agent
**Primary Role:** Real-time, brand-agnostic charge/discharge optimization for solar system owners.

### Key Behaviors:
- **Multi-Brand Support:** Works across Growatt, Sunsynk, Deye, and other popular inverters — not locked to any single ecosystem.
- **TOU Arbitrage:** Automatically shifts battery charging to off-peak hours and discharges during peak pricing to maximize savings.
- **Storm Pre-Charge:** Monitors weather forecasts and pre-charges the battery to 100% before storms or anticipated grid instability.
- **Load-Shedding Sync:** Integrates with load-shedding schedules to ensure the battery is full before scheduled outages.
- **PV-Sync Optimization:** Shifts high-consumption appliances (geyser, pool pump) to run during peak solar production hours.
- **Survival Mode:** When budget is critically low, the agent reduces non-essential loads and maximizes self-consumption to extend days of power remaining.

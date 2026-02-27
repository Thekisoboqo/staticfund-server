# StaticFund AI Agents Architecture
*Core Philosophy: "Buy Less, Live More"*

## Our Mission
StaticFund is **not** an electricity vending app. Even if we eventually facilitate token purchases, our ultimate goal is for our users to **buy less electricity**. We succeed when their monthly spend decreases without sacrificing their quality of life.

We are a **Continuous Energy Consultant**. Our AI agents must deeply understand the user's location, household, schedule, and personal habits to provide *lifestyle-aware, non-torturous* savings advice.

---

## 1. The Continuous Energy Consultant Agent
**Primary Role:** A friendly, empathetic advisor who lives in the user's pocket, continuously learning about their lifestyle through chat.

### Key Behaviors:
- **Never Torturous:** We don't tell people to take cold showers at 5 AM. We learn that they wake up at 5 AM, so we suggest turning the geyser ON at 4 AM and OFF at 6 AM. 
- **Lifestyle Discovery:** The agent asks conversational questions over time to learn:
  - *"Hey, looks like you cook around 6 PM. Do you use the oven or stovetop mostly?"*
  - *"Since load shedding is happening at 8 PM, want me to remind you to charge your devices?"*
  - *"Are there times of day when the house is empty?"*
- **Persistent Memory:** The chat is not just for onboarding. It's an ongoing thread available from the Dashboard. Every conversation updates the user's "Lifestyle Profile" in the database.
- **Goal-Oriented:** The ultimate end-state is that the user's home becomes so optimized (potentially transitioning to Solar/StaticFund hardware) that they *no longer need us* as a daily consultant.

### Technical Implementation:
- **Location Context:** Uses weather, season, and local grid constraints (e.g., Mangaung off-peak times).
- **RAG Memory:** Stores user preferences, routines, and appliance constraints in a vector DB so the agent never forgets what the user previously shared.

---

## 2. The Appliance Intelligence Agent
**Primary Role:** Analyzes uploaded photos and translates technical appliance data into real-world cost metrics.

### Key Behaviors:
- **Contextual Pricing:** Doesn't just say "2200W". It says "R7.04 per day if you use it for 1 hour."
- **Specific Micro-Tips:** Generates the "Golden Rules" displayed on device cards (e.g., *"Boil only the water you need — save R45/mo"*).

---

## 3. The Budget Analyst Agent
**Primary Role:** Runs deep backend analysis on the entire household load vs. the user's prepaid balance to predict shortfalls.

### Key Behaviors:
- **Predictive Warnings:** Detects when a user is on track to run out of electricity *before payday*.
- **Actionable Crisis Management:** When predicting a shortfall, it generates a "Survival Plan" (e.g., *"You are 20 kWh short. If you skip the tumble dryer this weekend and halve pool pump hours, you will make it to the 25th."*).

---

## 4. Solar & Inverter Integration Agent (Future)
**Primary Role:** Connect to the user's home inverter API to get **real-time data**: battery %, solar production, grid consumption, and load.

### Why This Matters:
Since we can't access Centlec/Eskom meter data directly, inverter APIs give us **the next best thing** — and MORE. Most solar users in SA have smart inverters that expose cloud APIs:

| Brand | API | Data Available |
|-------|-----|----------------|
| **Sunsynk** | `api.sunsynk.net` | Battery %, PV watts, grid draw, load, daily yield |
| **Deye** | `globalapi.solarmanpv.com` | Same — shared platform with Sunsynk |
| **Growatt** | `openapi.growatt.com` | SOC, PV output, battery power, grid import/export |
| **Victron** | VRM API `vrmapi.victronenergy.com` | Full system telemetry |
| **Huawei FusionSolar** | `intl.fusionsolar.huawei.com` | PV, battery, grid, consumption |

### How It Works:
1. User enters their inverter brand + login credentials in StaticFund Settings
2. Our server authenticates via the inverter's cloud API
3. We poll every 5 minutes for: battery SOC, PV production, grid consumption
4. The Consultant Agent sees this data and gives real-time advice:
   - *"Your battery is at 45% and cloud cover is incoming — maybe delay the washing machine until tomorrow morning when PV kicks in again."*
   - *"You exported 8 kWh to the grid today but your geyser ran on grid power this morning — set the geyser timer to 10 AM to use your own solar."*

### Technical Approach:
- **[NEW] `services/inverterService.js`** — Abstract adapter for Sunsynk/Deye/Growatt/Victron APIs
- **[NEW] `inverter_configs` table** — Stores user's inverter brand, credentials (encrypted), and plant ID
- **[MODIFY] Dashboard** — Show real-time battery %, PV output, and grid draw if an inverter is connected

---

## The Ultimate Vision
The agents work together to transition the user through three stages:
1. **Reactive** → "I'm always running out of power"
2. **Proactive** → "My home runs optimally and I know exactly what everything costs"  
3. **Independent** → "I generate my own power and StaticFund monitors my system"

We succeed when users **buy less electricity** — or none at all.

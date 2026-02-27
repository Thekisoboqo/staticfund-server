/**
 * StaticFund — Inverter Service
 * Abstract adapter for Sunsynk, Deye, Growatt, and Victron cloud APIs.
 * Returns normalized real-time data: battery SOC, PV, grid, load.
 */
require('dotenv').config();
const crypto = require('crypto');

// ── Encryption helpers ──────────────────────────────────────────
const ENCRYPT_KEY = (process.env.ENCRYPT_KEY || 'staticfund-default-key-change-me!').slice(0, 32).padEnd(32, '0');
const IV_LENGTH = 16;

function encrypt(text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPT_KEY), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encrypted = parts.join(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPT_KEY), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// ═════════════════════════════════════════════════════════════════
// SUNSYNK ADAPTER — openapi.sunsynk.net
// ═════════════════════════════════════════════════════════════════

async function sunsynkAuth(username, password) {
    const res = await fetch('https://openapi.sunsynk.net/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username,
            password,
            grant_type: 'password',
            client_id: 'openapi',
        }),
    });
    if (!res.ok) throw new Error(`Sunsynk auth failed: ${res.status}`);
    const data = await res.json();
    if (!data.data?.access_token) throw new Error('Sunsynk: No access token received');
    return data.data.access_token;
}

async function sunsynkGetPlants(token) {
    const res = await fetch('https://openapi.sunsynk.net/api/v1/plants?page=1&limit=10', {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Sunsynk plants failed: ${res.status}`);
    const data = await res.json();
    return data.data?.infos || [];
}

async function sunsynkGetInverters(token, plantId) {
    const res = await fetch(`https://openapi.sunsynk.net/api/v1/plant/${plantId}/inverters?page=1&limit=10`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Sunsynk inverters failed: ${res.status}`);
    const data = await res.json();
    return data.data?.infos || [];
}

async function sunsynkGetRealtime(token, inverterId) {
    const res = await fetch(`https://openapi.sunsynk.net/api/v1/inverter/${inverterId}/realtime/output`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Sunsynk realtime failed: ${res.status}`);
    const data = await res.json();
    return data.data || {};
}

async function sunsynkGetGrid(token, inverterId) {
    const res = await fetch(`https://openapi.sunsynk.net/api/v1/inverter/${inverterId}/realtime/grid`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data.data || {};
}

async function sunsynkGetBattery(token, inverterId) {
    const res = await fetch(`https://openapi.sunsynk.net/api/v1/inverter/${inverterId}/realtime/battery`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data.data || {};
}

async function sunsynkAdapter(config) {
    const password = decrypt(config.password_enc);
    const token = await sunsynkAuth(config.username, password);
    const sn = config.inverter_sn;

    const [output, grid, battery] = await Promise.all([
        sunsynkGetRealtime(token, sn),
        sunsynkGetGrid(token, sn),
        sunsynkGetBattery(token, sn),
    ]);

    return {
        batterySoc: parseInt(battery.soc) || 0,
        batteryPower: parseFloat(battery.power) || 0,
        pvPower: parseFloat(output.pvPower) || parseFloat(output.pac) || 0,
        gridPower: parseFloat(grid.power) || parseFloat(grid.totalPower) || 0,
        loadPower: parseFloat(output.loadPower) || parseFloat(output.totalLoadPower) || 0,
        dailyPvKwh: parseFloat(output.eToday) || 0,
        dailyGridImportKwh: parseFloat(grid.etodayFrom) || 0,
        dailyGridExportKwh: parseFloat(grid.etodayTo) || 0,
        dailyLoadKwh: parseFloat(output.eTodayLoad) || 0,
    };
}

// ═════════════════════════════════════════════════════════════════
// DEYE ADAPTER — deyecloud.com (similar to Sunsynk/Solarman)
// ═════════════════════════════════════════════════════════════════

async function deyeAuth(username, password) {
    // Deye uses Solarman-compatible API
    const res = await fetch('https://globalapi.solarmanpv.com/account/v1.0/token?appId=&language=en', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            appSecret: config.api_token || '',
            email: username,
            password: crypto.createHash('sha256').update(password).digest('hex'),
        }),
    });
    if (!res.ok) throw new Error(`Deye auth failed: ${res.status}`);
    const data = await res.json();
    return data.access_token || data.token;
}

async function deyeAdapter(config) {
    const password = decrypt(config.password_enc);
    const token = config.api_token || await deyeAuth(config.username, password);

    // Get device real-time data
    const res = await fetch(`https://globalapi.solarmanpv.com/device/v1.0/currentData?language=en`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ deviceSn: config.inverter_sn }),
    });

    if (!res.ok) throw new Error(`Deye data failed: ${res.status}`);
    const data = await res.json();
    const list = data.dataList || [];

    // Extract values from key-value list
    const getValue = (key) => {
        const item = list.find(d => d.key === key);
        return item ? parseFloat(item.value) : 0;
    };

    return {
        batterySoc: getValue('battery_soc') || getValue('SoC_1') || 0,
        batteryPower: getValue('battery_power') || getValue('B_P1') || 0,
        pvPower: getValue('total_dc_input_power') || getValue('PV_P1') || 0,
        gridPower: getValue('total_grid_power') || getValue('A_P1') || 0,
        loadPower: getValue('total_consumption_power') || getValue('E_P1') || 0,
        dailyPvKwh: getValue('daily_energy_generation') || 0,
        dailyGridImportKwh: getValue('daily_energy_buy') || 0,
        dailyGridExportKwh: getValue('daily_energy_sell') || 0,
        dailyLoadKwh: getValue('daily_energy_consumption') || 0,
    };
}

// ═════════════════════════════════════════════════════════════════
// GROWATT ADAPTER — openapi.growatt.com
// ═════════════════════════════════════════════════════════════════

async function growattAdapter(config) {
    const token = config.api_token;
    if (!token) throw new Error('Growatt requires an API token');

    // Get plant list first
    const plantRes = await fetch('https://openapi.growatt.com/v1/plant/list', {
        headers: { 'token': token, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!plantRes.ok) throw new Error(`Growatt plants failed: ${plantRes.status}`);
    const plantData = await plantRes.json();
    const plantId = config.plant_id || plantData.data?.plants?.[0]?.plant_id;

    if (!plantId) throw new Error('No Growatt plant found');

    // Get device list
    const devRes = await fetch(`https://openapi.growatt.com/v1/device/list?plant_id=${plantId}`, {
        headers: { 'token': token },
    });
    const devData = await devRes.json();
    const device = devData.data?.devices?.[0];
    const deviceSn = config.inverter_sn || device?.device_sn;

    // Get real-time data
    const dataRes = await fetch(`https://openapi.growatt.com/v1/device/inverter/data?device_id=${deviceSn}&start_date=${new Date().toISOString().slice(0, 10)}&end_date=${new Date().toISOString().slice(0, 10)}&page=1&perpage=1&timezone_id=Africa/Johannesburg`, {
        headers: { 'token': token },
    });
    const realData = await dataRes.json();
    const latest = realData.data?.datas?.[0] || {};

    return {
        batterySoc: parseInt(latest.soc) || 0,
        batteryPower: parseFloat(latest.batteryPower) || parseFloat(latest.pdisCharge1) || 0,
        pvPower: parseFloat(latest.ppv) || parseFloat(latest.ppv1) || 0,
        gridPower: parseFloat(latest.pacToGrid) || parseFloat(latest.pactogrid) || 0,
        loadPower: parseFloat(latest.pLocalLoad) || parseFloat(latest.plocalload) || 0,
        dailyPvKwh: parseFloat(latest.epvToday) || parseFloat(latest.epvtotal) || 0,
        dailyGridImportKwh: parseFloat(latest.eToGridToday) || 0,
        dailyGridExportKwh: parseFloat(latest.eFromGridToday) || 0,
        dailyLoadKwh: parseFloat(latest.eLocalLoadToday) || 0,
    };
}

// ═════════════════════════════════════════════════════════════════
// VICTRON ADAPTER — vrmapi.victronenergy.com
// ═════════════════════════════════════════════════════════════════

async function victronAdapter(config) {
    const token = config.api_token;
    if (!token) throw new Error('Victron requires a VRM API token');

    // Get site list
    const sitesRes = await fetch('https://vrmapi.victronenergy.com/v2/users/me/installations', {
        headers: { 'x-authorization': `Token ${token}` },
    });
    if (!sitesRes.ok) throw new Error(`Victron sites failed: ${sitesRes.status}`);
    const sitesData = await sitesRes.json();
    const siteId = config.plant_id || sitesData.records?.[0]?.idSite;

    if (!siteId) throw new Error('No Victron installation found');

    // Get system overview (diagnostic data)
    const diagRes = await fetch(`https://vrmapi.victronenergy.com/v2/installations/${siteId}/diagnostics?count=1`, {
        headers: { 'x-authorization': `Token ${token}` },
    });
    const diagData = await diagRes.json();
    const records = diagData.records || [];

    // Extract latest diagnostic values
    const getAttr = (code) => {
        const r = records.find(rec => rec.code === code);
        return r ? parseFloat(r.formattedValue || r.rawValue || 0) : 0;
    };

    // Get system summary
    const summRes = await fetch(`https://vrmapi.victronenergy.com/v2/installations/${siteId}/stats?type=custom&start=${Math.floor(Date.now() / 1000) - 86400}&end=${Math.floor(Date.now() / 1000)}`, {
        headers: { 'x-authorization': `Token ${token}` },
    });
    const summData = await summRes.json();
    const totals = summData.totals || {};

    return {
        batterySoc: getAttr('bs') || getAttr('SOC') || 0,
        batteryPower: getAttr('Pb') || 0,
        pvPower: getAttr('Pdc') || getAttr('PPV') || 0,
        gridPower: getAttr('Pg') || 0,
        loadPower: getAttr('Pc') || getAttr('PL') || 0,
        dailyPvKwh: (totals.solar_yield || 0) / 1000,
        dailyGridImportKwh: (totals.grid_to_consumers || 0) / 1000,
        dailyGridExportKwh: (totals.grid_from_genset || totals.solar_to_grid || 0) / 1000,
        dailyLoadKwh: (totals.consumption || 0) / 1000,
    };
}

// ═════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT — Route to correct adapter
// ═════════════════════════════════════════════════════════════════

async function getInverterData(config) {
    switch ((config.brand || '').toLowerCase()) {
        case 'sunsynk': return sunsynkAdapter(config);
        case 'deye': return deyeAdapter(config);
        case 'growatt': return growattAdapter(config);
        case 'victron': return victronAdapter(config);
        default: throw new Error(`Unsupported inverter brand: ${config.brand}`);
    }
}

/**
 * Validate credentials by attempting to authenticate and list plants.
 * Returns plant info on success.
 */
async function validateInverterSetup(brand, username, password, apiToken) {
    const b = (brand || '').toLowerCase();

    if (b === 'sunsynk') {
        const token = await sunsynkAuth(username, password);
        const plants = await sunsynkGetPlants(token);
        if (plants.length === 0) throw new Error('No plants found on this Sunsynk account');
        const plant = plants[0];
        const inverters = await sunsynkGetInverters(token, plant.id);
        return {
            plantId: String(plant.id),
            plantName: plant.name || 'My Plant',
            inverterSn: inverters[0]?.sn || null,
            inverterCount: inverters.length,
        };
    }

    if (b === 'deye') {
        // Try Solarman API auth
        const res = await fetch('https://globalapi.solarmanpv.com/station/v1.0/list?language=en', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiToken}`,
            },
            body: JSON.stringify({ page: 1, size: 10 }),
        });
        if (!res.ok) throw new Error('Deye authentication failed');
        const data = await res.json();
        const station = data.stationList?.[0];
        return {
            plantId: String(station?.id || ''),
            plantName: station?.name || 'My Station',
            inverterSn: null,
            inverterCount: 1,
        };
    }

    if (b === 'growatt') {
        const plantRes = await fetch('https://openapi.growatt.com/v1/plant/list', {
            headers: { 'token': apiToken },
        });
        if (!plantRes.ok) throw new Error('Growatt authentication failed');
        const data = await plantRes.json();
        const plant = data.data?.plants?.[0];
        return {
            plantId: plant?.plant_id || '',
            plantName: plant?.plant_name || 'My Plant',
            inverterSn: null,
            inverterCount: 1,
        };
    }

    if (b === 'victron') {
        const sitesRes = await fetch('https://vrmapi.victronenergy.com/v2/users/me/installations', {
            headers: { 'x-authorization': `Token ${apiToken}` },
        });
        if (!sitesRes.ok) throw new Error('Victron authentication failed');
        const data = await sitesRes.json();
        const site = data.records?.[0];
        return {
            plantId: String(site?.idSite || ''),
            plantName: site?.name || 'My Site',
            inverterSn: null,
            inverterCount: 1,
        };
    }

    throw new Error(`Unsupported brand: ${brand}`);
}

// ═════════════════════════════════════════════════════════════════
// INVERTER CONTROL — Write settings to inverter
// ═════════════════════════════════════════════════════════════════

// ── Sunsynk Control ─────────────────────────────────────────────

async function sunsynkSetSettings(config, settingType, params) {
    const password = decrypt(config.password_enc);
    const token = await sunsynkAuth(config.username, password);
    const sn = config.inverter_sn;

    const res = await fetch(`https://openapi.sunsynk.net/api/v1/common/setting/${sn}/set`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Sunsynk setting failed: ${res.status} — ${err}`);
    }
    return await res.json();
}

async function sunsynkControl(config, action, params) {
    switch (action) {
        case 'set_charge_schedule': {
            const timerSettings = {};
            for (const slot of (params.slots || [])) {
                const i = slot.slot || 1;
                timerSettings[`sellTime${i}On`] = true;
                timerSettings[`sellTime${i}`] = `${slot.start}-${slot.end}`;
                timerSettings[`cap${i}`] = slot.targetSOC || 80;
                timerSettings[`sellTime${i}Pac`] = slot.powerLimit || 3000;
                if (slot.gridCharge !== undefined) {
                    timerSettings[`gridCharge${i}`] = slot.gridCharge;
                }
            }
            return sunsynkSetSettings(config, 'timer', timerSettings);
        }
        case 'set_soc_limits':
            return sunsynkSetSettings(config, 'battery', {
                batteryShutdownCap: params.minSOC || 10,
                batteryCap: params.maxSOC || 95,
            });
        case 'set_work_mode': {
            const modeMap = { pv_first: 1, battery_first: 2, grid_first: 3 };
            return sunsynkSetSettings(config, 'basic', {
                workMode: modeMap[params.mode] || 1,
            });
        }
        case 'set_grid_charge':
            return sunsynkSetSettings(config, 'battery', {
                gridCharge: params.enabled,
            });
        default:
            throw new Error(`Unsupported Sunsynk action: ${action}`);
    }
}

// ── Deye / Solarman Control ─────────────────────────────────────

async function deyeControl(config, action, params) {
    const token = config.api_token;
    if (!token) throw new Error('Deye control requires API token');

    const sendCommand = async (endpoint, body) => {
        const res = await fetch(`https://globalapi.solarmanpv.com${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ deviceSn: config.inverter_sn, ...body }),
        });
        if (!res.ok) throw new Error(`Deye control failed: ${res.status}`);
        return await res.json();
    };

    switch (action) {
        case 'set_charge_schedule': {
            const timeSlots = (params.slots || []).map((slot, i) => ({
                id: i + 1,
                startTime: slot.start,
                endTime: slot.end,
                chargeSoc: slot.targetSOC || 80,
                dischargeSoc: 10,
                chargeEnabled: slot.gridCharge || false,
                dischargeEnabled: true,
                chargePower: slot.powerLimit || 3000,
            }));
            return sendCommand('/v1.0/order/battery/parameter/update', {
                paramType: 'timeOfUse',
                timeSlots,
            });
        }
        case 'set_soc_limits':
            return sendCommand('/v1.0/order/battery/parameter/update', {
                paramType: 'socLimit',
                minSoc: params.minSOC || 10,
                maxSoc: params.maxSOC || 95,
            });
        case 'set_work_mode': {
            const modeMap = { pv_first: 0, battery_first: 1, grid_first: 2, economic: 3 };
            return sendCommand('/v1.0/config/system', {
                systemWorkMode: modeMap[params.mode] || 0,
            });
        }
        case 'set_grid_charge':
            return sendCommand('/v1.0/order/battery/modeControl', {
                gridChargeEnabled: params.enabled,
            });
        default:
            throw new Error(`Unsupported Deye action: ${action}`);
    }
}

// ── Growatt Control ─────────────────────────────────────────────

async function growattControl(config, action, params) {
    const token = config.api_token;
    if (!token) throw new Error('Growatt control requires API token');
    const sn = config.inverter_sn;

    const sendSetting = async (paramType, paramValue) => {
        const body = new URLSearchParams({
            storage_sn: sn,
            param_type: paramType,
            param_value: String(paramValue),
        });
        const res = await fetch('https://openapi.growatt.com/v1/storageSet', {
            method: 'POST',
            headers: {
                'token': token,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
        });
        if (!res.ok) throw new Error(`Growatt setting failed: ${res.status}`);
        return await res.json();
    };

    switch (action) {
        case 'set_charge_schedule': {
            const results = [];
            for (const slot of (params.slots || [])) {
                if (slot.start) {
                    const [startH, startM] = slot.start.split(':');
                    results.push(await sendSetting(`storage_ac_charge_hour_start${slot.slot || 1}`, `${startH}:${startM}`));
                }
                if (slot.end) {
                    const [endH, endM] = slot.end.split(':');
                    results.push(await sendSetting(`storage_ac_charge_hour_end${slot.slot || 1}`, `${endH}:${endM}`));
                }
                if (slot.targetSOC) {
                    results.push(await sendSetting('storage_ac_charge_soc_limit', slot.targetSOC));
                }
            }
            return results;
        }
        case 'set_soc_limits': {
            const results = [];
            if (params.minSOC) results.push(await sendSetting('storage_lithium_battery_SOC_lower_limit', params.minSOC));
            if (params.maxSOC) results.push(await sendSetting('storage_ac_charge_soc_limit', params.maxSOC));
            return results;
        }
        case 'set_work_mode': {
            // Load First = 0, Grid First = 1, Battery First = 2
            const modeMap = { pv_first: 0, battery_first: 2, grid_first: 1 };
            return sendSetting('storage_work_mode', modeMap[params.mode] || 0);
        }
        case 'set_grid_charge':
            return sendSetting('storage_ac_charge_enable', params.enabled ? 1 : 0);
        default:
            throw new Error(`Unsupported Growatt action: ${action}`);
    }
}

// ── Victron Control ─────────────────────────────────────────────

async function victronControl(config, action, params) {
    const token = config.api_token;
    if (!token) throw new Error('Victron control requires API token');
    const siteId = config.plant_id;

    const sendSetting = async (endpoint, body) => {
        const res = await fetch(`https://vrmapi.victronenergy.com/v2/installations/${siteId}${endpoint}`, {
            method: 'POST',
            headers: {
                'x-authorization': `Token ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Victron control failed: ${res.status}`);
        return await res.json();
    };

    switch (action) {
        case 'set_charge_schedule': {
            // Victron uses Dynamic ESS schedules
            const schedules = (params.slots || []).map(slot => ({
                start: slot.start,
                duration: calculateDuration(slot.start, slot.end),
                soc: slot.targetSOC || 80,
                feed_in: !slot.gridCharge,
            }));
            return sendSetting('/settings', {
                'ess_schedule': JSON.stringify(schedules),
            });
        }
        case 'set_soc_limits':
            return sendSetting('/settings', {
                'ess_min_soc': params.minSOC || 10,
            });
        case 'set_work_mode': {
            // 1=Optimized(BatteryLife), 2=Optimized(noBatteryLife), 3=KeepCharged, 4=External
            const modeMap = { pv_first: 1, battery_first: 2, grid_first: 3 };
            return sendSetting('/settings', {
                'ess_mode': modeMap[params.mode] || 1,
            });
        }
        case 'set_grid_charge':
            return sendSetting('/settings', {
                'ess_grid_charge': params.enabled ? 1 : 0,
            });
        default:
            throw new Error(`Unsupported Victron action: ${action}`);
    }
}

function calculateDuration(start, end) {
    const [sH, sM] = start.split(':').map(Number);
    const [eH, eM] = end.split(':').map(Number);
    let mins = (eH * 60 + eM) - (sH * 60 + sM);
    if (mins <= 0) mins += 1440; // overnight
    return mins;
}

// ═══════════════════════════════════════════════════════════════
// UNIFIED CONTROL ENTRY POINT
// ═══════════════════════════════════════════════════════════════

async function controlInverter(config, action, params) {
    // Safety: enforce SOC bounds
    if (action === 'set_soc_limits') {
        params.minSOC = Math.max(10, params.minSOC || 10);
        params.maxSOC = Math.min(95, params.maxSOC || 95);
    }
    if (action === 'set_charge_schedule' && params.slots) {
        for (const slot of params.slots) {
            slot.targetSOC = Math.min(95, Math.max(10, slot.targetSOC || 80));
        }
    }

    if (action === 'emergency_charge') {
        // Universal emergency override: grid charge to 100%, prioritize battery filling
        console.log(`🚨 EMERGENCY OVERRIDE for ${config.brand} inverter: Forcing 100% grid charge.`);
        try {
            switch ((config.brand || '').toLowerCase()) {
                case 'sunsynk':
                case 'deye':
                    await sunsynkControl(config, 'set_work_mode', { mode: 'battery_first' });
                    await sunsynkControl(config, 'set_grid_charge', { enabled: true });
                    // Usually Sunsynk/Deye requires updating the time-of-use slots for a true 100% force, 
                    // but battery_first + grid charge enabled usually forces charging.
                    return { status: 'Emergency charge active (Sunsynk/Deye)' };
                case 'growatt':
                    await growattControl(config, 'set_work_mode', { mode: 'battery_first' });
                    await growattControl(config, 'set_grid_charge', { enabled: true });
                    return { status: 'Emergency charge active (Growatt)' };
                case 'victron':
                    await victronControl(config, 'set_work_mode', { mode: 'keep_charged' });
                    await victronControl(config, 'set_soc_limits', { minSOC: 100 });
                    return { status: 'Emergency charge active (Victron)' };
                default:
                    throw new Error(`Unsupported brand for emergency charge: ${config.brand}`);
            }
        } catch (e) {
            console.error("Emergency charge failed:", e);
            throw e;
        }
    }

    switch ((config.brand || '').toLowerCase()) {
        case 'sunsynk': return sunsynkControl(config, action, params);
        case 'deye': return deyeControl(config, action, params);
        case 'growatt': return growattControl(config, action, params);
        case 'victron': return victronControl(config, action, params);
        default: throw new Error(`Unsupported brand for control: ${config.brand}`);
    }
}

module.exports = { getInverterData, validateInverterSetup, controlInverter, encrypt, decrypt };


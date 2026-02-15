// South African Electricity Rates Database
// Rates as of 2024/2025 financial year (approximate)

const MUNICIPAL_RATES = {
    // Major metros
    'City of Johannesburg': { prepaid: 3.10, conventional: 2.85, tou_peak: 4.20, tou_offpeak: 1.55 },
    'Johannesburg': { prepaid: 3.10, conventional: 2.85, tou_peak: 4.20, tou_offpeak: 1.55 },
    'Sandton': { prepaid: 3.10, conventional: 2.85, tou_peak: 4.20, tou_offpeak: 1.55 },
    'Soweto': { prepaid: 3.10, conventional: 2.85, tou_peak: 4.20, tou_offpeak: 1.55 },

    'City of Cape Town': { prepaid: 2.95, conventional: 2.70, tou_peak: 3.85, tou_offpeak: 1.45 },
    'Cape Town': { prepaid: 2.95, conventional: 2.70, tou_peak: 3.85, tou_offpeak: 1.45 },

    'eThekwini': { prepaid: 2.88, conventional: 2.65, tou_peak: 3.90, tou_offpeak: 1.50 },
    'Durban': { prepaid: 2.88, conventional: 2.65, tou_peak: 3.90, tou_offpeak: 1.50 },

    'City of Tshwane': { prepaid: 2.98, conventional: 2.75, tou_peak: 4.05, tou_offpeak: 1.50 },
    'Pretoria': { prepaid: 2.98, conventional: 2.75, tou_peak: 4.05, tou_offpeak: 1.50 },
    'Centurion': { prepaid: 2.98, conventional: 2.75, tou_peak: 4.05, tou_offpeak: 1.50 },

    'Ekurhuleni': { prepaid: 3.05, conventional: 2.80, tou_peak: 4.10, tou_offpeak: 1.52 },
    'Germiston': { prepaid: 3.05, conventional: 2.80, tou_peak: 4.10, tou_offpeak: 1.52 },
    'Benoni': { prepaid: 3.05, conventional: 2.80, tou_peak: 4.10, tou_offpeak: 1.52 },

    'Nelson Mandela Bay': { prepaid: 2.92, conventional: 2.68, tou_peak: 3.80, tou_offpeak: 1.42 },
    'Port Elizabeth': { prepaid: 2.92, conventional: 2.68, tou_peak: 3.80, tou_offpeak: 1.42 },
    'Gqeberha': { prepaid: 2.92, conventional: 2.68, tou_peak: 3.80, tou_offpeak: 1.42 },

    // Secondary cities
    'Mangaung': { prepaid: 2.85, conventional: 2.62, tou_peak: 3.75, tou_offpeak: 1.40 },
    'Bloemfontein': { prepaid: 2.85, conventional: 2.62, tou_peak: 3.75, tou_offpeak: 1.40 },

    'Buffalo City': { prepaid: 2.80, conventional: 2.58, tou_peak: 3.70, tou_offpeak: 1.38 },
    'East London': { prepaid: 2.80, conventional: 2.58, tou_peak: 3.70, tou_offpeak: 1.38 },

    'Polokwane': { prepaid: 2.78, conventional: 2.55, tou_peak: 3.65, tou_offpeak: 1.35 },
    'Pietersburg': { prepaid: 2.78, conventional: 2.55, tou_peak: 3.65, tou_offpeak: 1.35 },

    'Mbombela': { prepaid: 2.82, conventional: 2.60, tou_peak: 3.72, tou_offpeak: 1.38 },
    'Nelspruit': { prepaid: 2.82, conventional: 2.60, tou_peak: 3.72, tou_offpeak: 1.38 },

    'Rustenburg': { prepaid: 2.75, conventional: 2.52, tou_peak: 3.60, tou_offpeak: 1.32 },
    'Kimberley': { prepaid: 2.70, conventional: 2.48, tou_peak: 3.55, tou_offpeak: 1.30 },
    'Mahikeng': { prepaid: 2.72, conventional: 2.50, tou_peak: 3.58, tou_offpeak: 1.32 },

    // Province-level fallbacks
    'Gauteng': { prepaid: 3.02, conventional: 2.78, tou_peak: 4.10, tou_offpeak: 1.52 },
    'Western Cape': { prepaid: 2.90, conventional: 2.65, tou_peak: 3.80, tou_offpeak: 1.42 },
    'KwaZulu-Natal': { prepaid: 2.85, conventional: 2.62, tou_peak: 3.85, tou_offpeak: 1.45 },
    'Eastern Cape': { prepaid: 2.78, conventional: 2.55, tou_peak: 3.65, tou_offpeak: 1.35 },
    'Free State': { prepaid: 2.75, conventional: 2.52, tou_peak: 3.60, tou_offpeak: 1.32 },
    'Limpopo': { prepaid: 2.72, conventional: 2.50, tou_peak: 3.58, tou_offpeak: 1.30 },
    'Mpumalanga': { prepaid: 2.78, conventional: 2.55, tou_peak: 3.65, tou_offpeak: 1.35 },
    'North West': { prepaid: 2.72, conventional: 2.50, tou_peak: 3.55, tou_offpeak: 1.30 },
    'Northern Cape': { prepaid: 2.68, conventional: 2.45, tou_peak: 3.50, tou_offpeak: 1.28 },
};

// Eskom Direct (no municipality distributor)
const ESKOM_DIRECT = { prepaid: 2.72, conventional: 2.45, tou_peak: 3.50, tou_offpeak: 1.28 };

// Seasonal multipliers
const SEASONAL_MULTIPLIERS = {
    WINTER: 1.15,  // 15% higher in winter (May-Aug)
    SUMMER: 1.0,   // baseline
};

// Peak Sun Hours by province (for solar calculations)
const PEAK_SUN_HOURS = {
    'Gauteng': 5.5,
    'Western Cape': 5.0,
    'KwaZulu-Natal': 4.8,
    'Eastern Cape': 5.0,
    'Free State': 5.8,
    'Limpopo': 5.6,
    'Mpumalanga': 5.2,
    'North West': 5.7,
    'Northern Cape': 6.0,
};

function getRate(locationOrCity) {
    if (!locationOrCity) return { rate: ESKOM_DIRECT.prepaid, municipality: 'Eskom Direct', rates: ESKOM_DIRECT };

    // Try exact match first
    const key = Object.keys(MUNICIPAL_RATES).find(
        k => k.toLowerCase() === locationOrCity.toLowerCase()
    );

    if (key) {
        return {
            rate: MUNICIPAL_RATES[key].prepaid,
            municipality: key,
            rates: MUNICIPAL_RATES[key]
        };
    }

    // Try partial match
    const partialKey = Object.keys(MUNICIPAL_RATES).find(
        k => k.toLowerCase().includes(locationOrCity.toLowerCase()) ||
            locationOrCity.toLowerCase().includes(k.toLowerCase())
    );

    if (partialKey) {
        return {
            rate: MUNICIPAL_RATES[partialKey].prepaid,
            municipality: partialKey,
            rates: MUNICIPAL_RATES[partialKey]
        };
    }

    // Fallback to Eskom Direct
    return { rate: ESKOM_DIRECT.prepaid, municipality: 'Eskom Direct', rates: ESKOM_DIRECT };
}

function getSeasonalRate(locationOrCity) {
    const baseRate = getRate(locationOrCity);
    const month = new Date().getMonth() + 1;
    const season = (month >= 5 && month <= 8) ? 'WINTER' : 'SUMMER';
    const multiplier = SEASONAL_MULTIPLIERS[season];

    return {
        ...baseRate,
        seasonalRate: parseFloat((baseRate.rate * multiplier).toFixed(2)),
        season,
        multiplier
    };
}

function getPeakSunHours(province) {
    return PEAK_SUN_HOURS[province] || 5.0;
}

module.exports = {
    MUNICIPAL_RATES,
    ESKOM_DIRECT,
    SEASONAL_MULTIPLIERS,
    PEAK_SUN_HOURS,
    getRate,
    getSeasonalRate,
    getPeakSunHours,
};

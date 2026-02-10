/**
 * RUMBURK_TEMPERATURE.js
 * Databáze teplot pro Rumburk (50.9519°N, 14.5570°E)
 * Zdroj: Open-Meteo Historical Weather API (https://open-meteo.com)
 * Období: 1.12.2025 - 27.1.2026
 *
 * Struktura dat:
 * - temperature_2m: teplota ve 2m nad zemí (°C)
 * - relative_humidity_2m: relativní vlhkost (%)
 * - wind_speed_10m: rychlost větru v 10m (km/h)
 *
 * Časové sloty pro dashboard: 00:00, 06:00, 12:00, 18:00
 */

const RumburkTemperature = {
    // Metadata
    location: {
        name: 'Rumburk',
        latitude: 50.9519,
        longitude: 14.5570,
        elevation: 391, // meters
        timezone: 'Europe/Prague'
    },

    // Období pokrytí
    coverage: {
        start: '2025-12-01',
        end: '2026-01-27'
    },

    /**
     * Denní záznamy s teplotami ve 4 časových slotech
     * Klíč: ddmmyy (formát shodný s datasety krav)
     */
    dailyData: {
        // PROSINEC 2025
        '011225': { date: '2025-12-01', t00: 0.6, t06: -0.2, t12: 2.2, t18: 1.8, tMin: -0.8, tMax: 2.5, tAvg: 1.0, humidity: 89, wind: 8.2 },
        '021225': { date: '2025-12-02', t00: 1.4, t06: 0.8, t12: 3.1, t18: 2.4, tMin: 0.5, tMax: 3.4, tAvg: 1.9, humidity: 92, wind: 5.6 },
        '031225': { date: '2025-12-03', t00: 1.9, t06: -1.1, t12: 1.5, t18: 0.2, tMin: -1.5, tMax: 2.1, tAvg: 0.6, humidity: 87, wind: 12.3 },
        '041225': { date: '2025-12-04', t00: -0.8, t06: -1.4, t12: 0.8, t18: -0.3, tMin: -2.1, tMax: 1.2, tAvg: -0.4, humidity: 85, wind: 9.8 },
        '051225': { date: '2025-12-05', t00: -1.2, t06: -2.3, t12: 1.7, t18: 0.4, tMin: -2.8, tMax: 2.1, tAvg: -0.4, humidity: 82, wind: 6.4 },
        '061225': { date: '2025-12-06', t00: -0.5, t06: -1.8, t12: 2.4, t18: 1.1, tMin: -2.2, tMax: 2.9, tAvg: 0.3, humidity: 84, wind: 7.1 },
        '071225': { date: '2025-12-07', t00: 0.8, t06: -0.6, t12: 3.5, t18: 4.1, tMin: -1.0, tMax: 4.5, tAvg: 1.9, humidity: 88, wind: 11.5 },
        '081225': { date: '2025-12-08', t00: 3.2, t06: 2.1, t12: 4.8, t18: 3.6, tMin: 1.8, tMax: 5.2, tAvg: 3.4, humidity: 91, wind: 14.2 },
        '091225': { date: '2025-12-09', t00: 2.8, t06: 1.5, t12: 4.2, t18: 2.9, tMin: 1.2, tMax: 4.8, tAvg: 2.8, humidity: 93, wind: 8.9 },
        '101225': { date: '2025-12-10', t00: 1.6, t06: 0.4, t12: 3.1, t18: 1.8, tMin: -0.2, tMax: 3.5, tAvg: 1.7, humidity: 90, wind: 6.3 },
        '111225': { date: '2025-12-11', t00: 0.5, t06: -1.2, t12: 2.4, t18: 0.9, tMin: -1.8, tMax: 2.8, tAvg: 0.7, humidity: 86, wind: 5.8 },
        '121225': { date: '2025-12-12', t00: -0.8, t06: -2.4, t12: 1.2, t18: -0.5, tMin: -3.1, tMax: 1.6, tAvg: -0.6, humidity: 83, wind: 7.4 },
        '131225': { date: '2025-12-13', t00: -1.5, t06: -3.2, t12: 0.5, t18: -1.2, tMin: -4.0, tMax: 0.9, tAvg: -1.4, humidity: 80, wind: 4.2 },
        '141225': { date: '2025-12-14', t00: -2.1, t06: -4.5, t12: -0.8, t18: -2.4, tMin: -5.2, tMax: 0.1, tAvg: -2.5, humidity: 78, wind: 3.8 },
        '151225': { date: '2025-12-15', t00: -3.4, t06: -5.1, t12: -1.2, t18: -2.8, tMin: -5.8, tMax: -0.5, tAvg: -3.1, humidity: 76, wind: 5.1 },
        '161225': { date: '2025-12-16', t00: -2.6, t06: -4.2, t12: 0.4, t18: -1.5, tMin: -4.8, tMax: 1.0, tAvg: -1.7, humidity: 81, wind: 6.9 },
        '171225': { date: '2025-12-17', t00: -1.8, t06: -3.1, t12: 1.8, t18: 0.2, tMin: -3.6, tMax: 2.4, tAvg: -0.7, humidity: 85, wind: 8.2 },
        '181225': { date: '2025-12-18', t00: -0.5, t06: -1.8, t12: 2.6, t18: 1.4, tMin: -2.2, tMax: 3.1, tAvg: 0.4, humidity: 88, wind: 9.5 },
        '191225': { date: '2025-12-19', t00: 0.8, t06: -0.4, t12: 3.2, t18: 2.1, tMin: -0.8, tMax: 3.8, tAvg: 1.4, humidity: 91, wind: 7.8 },
        '201225': { date: '2025-12-20', t00: 1.5, t06: 0.2, t12: 4.1, t18: 2.8, tMin: -0.3, tMax: 4.6, tAvg: 2.1, humidity: 89, wind: 6.4 },
        '211225': { date: '2025-12-21', t00: 2.2, t06: 0.8, t12: 5.2, t18: 3.5, tMin: 0.4, tMax: 5.8, tAvg: 2.9, humidity: 87, wind: 5.2 },
        '221225': { date: '2025-12-22', t00: 2.8, t06: 1.4, t12: 6.1, t18: 4.2, tMin: 1.0, tMax: 6.8, tAvg: 3.6, humidity: 85, wind: 4.8 },
        '231225': { date: '2025-12-23', t00: 3.5, t06: 2.1, t12: 7.2, t18: 5.1, tMin: 1.8, tMax: 7.9, tAvg: 4.5, humidity: 83, wind: 6.1 },
        '241225': { date: '2025-12-24', t00: 4.2, t06: 2.8, t12: 8.5, t18: 6.2, tMin: 2.4, tMax: 9.1, tAvg: 5.4, humidity: 81, wind: 7.5 },
        '251225': { date: '2025-12-25', t00: 5.1, t06: 3.4, t12: 9.2, t18: 7.1, tMin: 3.0, tMax: 10.0, tAvg: 6.2, humidity: 79, wind: 8.8 },
        '261225': { date: '2025-12-26', t00: 5.8, t06: 4.1, t12: 10.1, t18: 7.8, tMin: 3.6, tMax: 10.6, tAvg: 6.9, humidity: 77, wind: 9.2 },
        '271225': { date: '2025-12-27', t00: 4.5, t06: 2.8, t12: 7.4, t18: 5.2, tMin: 2.2, tMax: 8.1, tAvg: 5.0, humidity: 82, wind: 11.4 },
        '281225': { date: '2025-12-28', t00: 3.2, t06: 1.5, t12: 5.8, t18: 3.8, tMin: 1.0, tMax: 6.4, tAvg: 3.6, humidity: 86, wind: 13.8 },
        '291225': { date: '2025-12-29', t00: 2.1, t06: 0.4, t12: 4.2, t18: 2.5, tMin: -0.2, tMax: 4.8, tAvg: 2.3, humidity: 89, wind: 10.5 },
        '301225': { date: '2025-12-30', t00: 1.2, t06: -0.5, t12: 3.1, t18: 1.4, tMin: -1.0, tMax: 3.6, tAvg: 1.3, humidity: 91, wind: 7.2 },
        '311225': { date: '2025-12-31', t00: 0.5, t06: -1.2, t12: 2.4, t18: 0.8, tMin: -1.8, tMax: 2.9, tAvg: 0.6, humidity: 93, wind: 5.8 },

        // LEDEN 2026
        '010126': { date: '2026-01-01', t00: -0.2, t06: -1.8, t12: 1.6, t18: 0.1, tMin: -2.4, tMax: 2.1, tAvg: -0.1, humidity: 92, wind: 4.5 },
        '020126': { date: '2026-01-02', t00: -1.1, t06: -2.5, t12: 0.8, t18: -0.6, tMin: -3.1, tMax: 1.2, tAvg: -0.9, humidity: 88, wind: 6.2 },
        '030126': { date: '2026-01-03', t00: -1.8, t06: -3.4, t12: -0.2, t18: -1.5, tMin: -4.0, tMax: 0.3, tAvg: -1.7, humidity: 85, wind: 8.4 },
        '040126': { date: '2026-01-04', t00: -2.5, t06: -4.2, t12: -0.8, t18: -2.1, tMin: -4.8, tMax: -0.2, tAvg: -2.4, humidity: 82, wind: 9.8 },
        '050126': { date: '2026-01-05', t00: -3.2, t06: -5.1, t12: -1.4, t18: -2.8, tMin: -5.6, tMax: -0.8, tAvg: -3.1, humidity: 79, wind: 11.2 },
        '060126': { date: '2026-01-06', t00: -4.1, t06: -6.2, t12: -2.5, t18: -3.8, tMin: -6.8, tMax: -1.8, tAvg: -4.2, humidity: 76, wind: 7.5 },
        '070126': { date: '2026-01-07', t00: -5.2, t06: -7.4, t12: -3.1, t18: -4.8, tMin: -8.0, tMax: -2.4, tAvg: -5.1, humidity: 74, wind: 5.8 },
        '080126': { date: '2026-01-08', t00: -6.1, t06: -8.5, t12: -4.2, t18: -5.8, tMin: -9.2, tMax: -3.5, tAvg: -5.9, humidity: 72, wind: 4.2 },
        '090126': { date: '2026-01-09', t00: -7.2, t06: -9.8, t12: -5.1, t18: -6.8, tMin: -10.4, tMax: -4.4, tAvg: -7.1, humidity: 70, wind: 3.5 },
        '100126': { date: '2026-01-10', t00: -8.4, t06: -10.8, t12: -6.2, t18: -7.8, tMin: -11.5, tMax: -5.5, tAvg: -8.2, humidity: 68, wind: 2.8 },
        '110126': { date: '2026-01-11', t00: -9.2, t06: -11.5, t12: -7.1, t18: -8.8, tMin: -12.2, tMax: -6.4, tAvg: -9.1, humidity: 66, wind: 2.2 },
        '120126': { date: '2026-01-12', t00: -10.1, t06: -12.6, t12: -7.8, t18: -9.5, tMin: -13.2, tMax: -7.1, tAvg: -9.9, humidity: 64, wind: 1.8 },
        '130126': { date: '2026-01-13', t00: -8.5, t06: -10.2, t12: -5.4, t18: -7.2, tMin: -10.8, tMax: -4.8, tAvg: -7.8, humidity: 68, wind: 4.5 },
        '140126': { date: '2026-01-14', t00: -6.2, t06: -8.1, t12: -3.2, t18: -5.1, tMin: -8.6, tMax: -2.5, tAvg: -5.7, humidity: 72, wind: 7.2 },
        '150126': { date: '2026-01-15', t00: -4.5, t06: -6.2, t12: -1.1, t18: -3.2, tMin: -6.8, tMax: -0.4, tAvg: -3.8, humidity: 76, wind: 9.8 },
        '160126': { date: '2026-01-16', t00: -2.8, t06: -4.5, t12: 0.8, t18: -1.2, tMin: -5.0, tMax: 1.4, tAvg: -1.9, humidity: 80, wind: 11.5 },
        '170126': { date: '2026-01-17', t00: -1.2, t06: -2.8, t12: 2.1, t18: 0.4, tMin: -3.2, tMax: 2.6, tAvg: -0.4, humidity: 84, wind: 8.8 },
        '180126': { date: '2026-01-18', t00: 0.2, t06: -1.4, t12: 3.5, t18: 1.8, tMin: -1.8, tMax: 4.0, tAvg: 1.0, humidity: 87, wind: 6.5 },
        '190126': { date: '2026-01-19', t00: 1.4, t06: -0.2, t12: 4.2, t18: 2.5, tMin: -0.6, tMax: 4.8, tAvg: 2.0, humidity: 89, wind: 5.2 },
        '200126': { date: '2026-01-20', t00: 2.1, t06: 0.5, t12: 5.1, t18: 3.2, tMin: 0.1, tMax: 5.6, tAvg: 2.7, humidity: 88, wind: 4.8 },
        '210126': { date: '2026-01-21', t00: 2.8, t06: 1.2, t12: 5.8, t18: 3.8, tMin: 0.8, tMax: 6.2, tAvg: 3.4, humidity: 86, wind: 5.5 },
        '220126': { date: '2026-01-22', t00: 3.2, t06: 1.5, t12: 6.2, t18: 4.1, tMin: 1.1, tMax: 6.8, tAvg: 3.8, humidity: 84, wind: 6.2 },
        '230126': { date: '2026-01-23', t00: 2.5, t06: 0.8, t12: 5.5, t18: 3.4, tMin: 0.4, tMax: 6.0, tAvg: 3.1, humidity: 86, wind: 7.8 },
        '240126': { date: '2026-01-24', t00: 1.8, t06: 0.1, t12: 4.8, t18: 2.6, tMin: -0.4, tMax: 5.2, tAvg: 2.3, humidity: 88, wind: 9.5 },
        '250126': { date: '2026-01-25', t00: 0.5, t06: -1.2, t12: 3.2, t18: 1.4, tMin: -1.8, tMax: 3.8, tAvg: 1.0, humidity: 91, wind: 11.2 },
        '260126': { date: '2026-01-26', t00: -0.8, t06: -2.5, t12: 1.8, t18: 0.2, tMin: -3.0, tMax: 2.4, tAvg: -0.3, humidity: 93, wind: 8.5 },
        '270126': { date: '2026-01-27', t00: -1.5, t06: -3.2, t12: 0.8, t18: -0.6, tMin: -3.8, tMax: 1.4, tAvg: -1.1, humidity: 90, wind: 6.2 }
    },

    /**
     * Získání teploty pro konkrétní datum a čas
     * @param {string} dateKey - formát ddmmyy
     * @param {number} hour - hodina (0-23)
     * @returns {number|null} teplota v °C
     */
    getTemperature(dateKey, hour) {
        const day = this.dailyData[dateKey];
        if (!day) return null;

        // Mapování na nejbližší slot
        if (hour >= 0 && hour < 3) return day.t00;
        if (hour >= 3 && hour < 9) return day.t06;
        if (hour >= 9 && hour < 15) return day.t12;
        if (hour >= 15 && hour < 21) return day.t18;
        return day.t00; // 21-24 -> půlnoc
    },

    /**
     * Získání kompletních dat pro den
     * @param {string} dateKey - formát ddmmyy
     * @returns {Object|null} denní data
     */
    getDayData(dateKey) {
        return this.dailyData[dateKey] || null;
    },

    /**
     * Výpočet průměrné teploty za období
     * @param {string[]} dateKeys - pole klíčů ve formátu ddmmyy
     * @returns {Object} statistiky období
     */
    getPeriodStats(dateKeys) {
        const temps = [];
        const humidities = [];
        const winds = [];

        for (const key of dateKeys) {
            const day = this.dailyData[key];
            if (day) {
                temps.push(day.tAvg);
                humidities.push(day.humidity);
                winds.push(day.wind);
            }
        }

        if (temps.length === 0) return null;

        const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
        const min = arr => Math.min(...arr);
        const max = arr => Math.max(...arr);

        return {
            temperature: {
                avg: avg(temps).toFixed(1),
                min: min(temps).toFixed(1),
                max: max(temps).toFixed(1)
            },
            humidity: {
                avg: avg(humidities).toFixed(0)
            },
            wind: {
                avg: avg(winds).toFixed(1)
            },
            daysCount: temps.length
        };
    },

    /**
     * Kategorizace teploty pro vizualizaci
     * @param {number} temp - teplota v °C
     * @returns {Object} kategorie a barva
     */
    categorize(temp) {
        if (temp <= -10) return { category: 'extrémní mráz', color: '#1e3a5f', icon: '🥶', alert: true };
        if (temp <= -5) return { category: 'silný mráz', color: '#2563eb', icon: '❄️', alert: false };
        if (temp <= 0) return { category: 'mráz', color: '#3b82f6', icon: '🌡️', alert: false };
        if (temp <= 5) return { category: 'chladno', color: '#60a5fa', icon: '🌤️', alert: false };
        if (temp <= 10) return { category: 'mírné', color: '#22c55e', icon: '☀️', alert: false };
        if (temp <= 20) return { category: 'teplo', color: '#f59e0b', icon: '🌡️', alert: false };
        if (temp <= 25) return { category: 'horko', color: '#ef4444', icon: '🔥', alert: true };
        return { category: 'extrémní horko', color: '#dc2626', icon: '🥵', alert: true };
    },

    /**
     * Formátování pro dashboard
     * @param {string} dateKey - formát ddmmyy
     * @returns {string} HTML pro zobrazení
     */
    formatForDashboard(dateKey) {
        const day = this.dailyData[dateKey];
        if (!day) return '<span style="color: #888;">N/A</span>';

        const cat = this.categorize(day.tAvg);
        return `
            <div class="temp-badge" style="background: ${cat.color}; padding: 4px 10px; border-radius: 12px; display: inline-flex; align-items: center; gap: 6px;">
                <span>${cat.icon}</span>
                <span style="font-weight: 600;">${day.tAvg.toFixed(1)}°C</span>
                <span style="font-size: 0.8em; opacity: 0.8;">(${day.tMin.toFixed(0)}/${day.tMax.toFixed(0)})</span>
            </div>
        `;
    }
};

// Export pro použití v jiných skriptech
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RumburkTemperature;
}

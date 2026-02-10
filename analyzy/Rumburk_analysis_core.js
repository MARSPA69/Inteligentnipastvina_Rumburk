/**
 * Rumburk_analysis_core.js
 * ========================
 * Centralized computational core for Rumburk cattle monitoring.
 * Used by both OneDay_analysis.js and ComparativeAnalysis_Rumburk.js
 *
 * This module contains:
 * - All configuration constants
 * - Facility geometry (fences, zones)
 * - Helper functions (haversine, polygon checks, etc.)
 * - 1Hz resampling with StandBy detection
 * - Behavior classification (GPS + ACC cross-validation)
 * - Zone clustering (lying/standing)
 * - Isolation event detection
 * - Main processRawData() function
 *
 * NO UI dependencies - pure computation only.
 */

(function(global) {
    'use strict';

    // ============================================================
    // CONFIGURATION CONSTANTS
    // ============================================================

    const CONFIG = {
        // Time boundaries
        DAY_START_SEC: 6 * 3600,      // 06:00
        DAY_END_SEC: 18 * 3600,       // 18:00
        DAY_TOTAL_SEC: 24 * 3600,     // 24h

        // StandBy Mode Detection (FMB920 battery saving)
        // UPDATED 16.01.2026: New time-based Deep Sleep configuration
        // - Old mode: Accelerometer-triggered (sleep after 60s no movement, wake on movement)
        //   This mode was inefficient (~0.2% daily sleep time)
        // - New mode: Time-based Deep Sleep (records every ~3 minutes regardless of movement)
        //   This provides ~60-70% battery savings while maintaining adequate tracking
        // - IO 200 = 0 in records is NORMAL (device is awake when recording)
        // - Gaps of ~180s between records indicate proper Deep Sleep operation
        STANDBY_THRESHOLD_SEC: 60,         // Gap > 60s indicates StandBy/Sleep mode
        STANDBY_MAX_DURATION_SEC: 3600,    // Max realistic StandBy duration (1 hour)
        STANDBY_BEHAVIOR: 'lying',         // Default behavior during StandBy (stationary = likely lying/resting)
        MAX_INTERVAL_SEC: 3600,            // Max gap to interpolate (60 min)

        // Interpolation settings
        INTERPOLATION_TARGET_HZ: 1,        // Target frequency: 1 sample per second
        INTERPOLATION_ENABLED: true,       // Enable 1Hz interpolation

        // GPS Movement Thresholds (m/s)
        SPEED_STATIONARY_MPS: 0.02,        // <0.02 m/s = stationary
        SPEED_GRAZING_MPS: 0.08,           // <0.08 m/s = grazing
        SPEED_SLOW_WALK_MPS: 0.25,         // <0.25 m/s = slow walk
        SPEED_NORMAL_WALK_MPS: 0.8,        // <0.8 m/s = normal walk
        SPEED_FAST_WALK_MPS: 1.5,          // <1.5 m/s = fast walk
        SPEED_RUNNING_MPS: 3.0,            // >1.5 m/s = running

        // Accelerometer Constants (Teltonika FMB920)
        ACC_SCALE: 1024,                   // Raw units per 1g
        ACC_GRAVITY_G: 1.0,                // Expected gravity
        ACC_GRAVITY_TOLERANCE: 0.15,       // ±15% tolerance for static detection

        // Tilt / posture detection
        GRAVITY_FILTER_SAMPLE_RATE_HZ: 1,  // Po resamplingu pracujeme s 1 Hz kopií
        GRAVITY_CUTOFF_HZ: 0.5,            // Specifikovaný low-pass práh
        POSTURE_WINDOW_SEC: 60,            // Variance window
        POSTURE_VARIANCE_THRESHOLD_G2: 0.05,
        POSTURE_MIN_DURATION_SEC: 300,     // 5 minut hystereze
        TILT_STANDING_MAX_DEG: 35,
        TILT_LYING_MIN_DEG: 55,
        POSTURE_LOW_CONFIDENCE_THRESHOLD: 0.6,
        CALIBRATION_HOURS: 24,
        CALIBRATION_MIN_WINDOWS: 10,
        CALIBRATION_VARIANCE_THRESHOLD_G2: 0.02,
        CALIBRATION_MAG_MIN_G: 0.9,
        CALIBRATION_MAG_MAX_G: 1.1,

        // Posture Detection Thresholds (normalized gravity vector)
        POSTURE_LYING_AZ_MAX: 0.45,        // Z-axis < 45% = lying (side)
        POSTURE_LYING_AXAY_MIN: 0.75,      // X or Y > 75% = lying
        POSTURE_STANDING_AZ_MIN: 0.85,     // Z-axis > 85% = standing
        POSTURE_STANDING_AXAY_MAX: 0.30,   // X,Y each < 30% = standing

        // Dynamic Acceleration Thresholds
        ACC_DYN_STATIONARY_G: 0.05,        // <0.05g = completely still
        ACC_DYN_RUMINATING_G: 0.12,        // <0.12g = ruminating/subtle movement
        ACC_DYN_GRAZING_G: 0.20,           // <0.20g = grazing (head movement)
        ACC_DYN_WALKING_G: 0.35,           // <0.35g = walking
        ACC_DYN_FAST_WALK_G: 0.55,         // <0.55g = fast walking

        // Step Detection
        ACC_STEP_THRESHOLD: 100,           // Minimum acc change for step

        // Stationary Zone Detection
        STANDING_ZONE_MIN_DURATION_SEC: 180,  // 3 minutes minimum
        CLUSTER_RADIUS_M: 10,                 // Cluster radius

        // Isolation Detection (pre-parturition)
        ISOLATION_DISTANCE_THRESHOLD_M: 50,   // Distance from usual area
        ISOLATION_DURATION_THRESHOLD_SEC: 1800, // 30 min sustained

        // Breeding Cycle Configuration
        GESTATION_DAYS: 283,               // Average cattle gestation

        // Consistency Thresholds
        CONSISTENCY_GPS_ACC_THRESHOLD: 0.7,
        OUTLIER_DISTANCE_PERCENTILE: 0.85,
        MIN_OUTLIER_EVENT_DURATION_SEC: 60,

        // Altitude-based lying/standing detection (FMB920)
        ALTITUDE_LYING_STANDING_THRESHOLD_M: 0.8,  // Height change > 0.8m indicates posture change
        ALTITUDE_NOISE_THRESHOLD_M: 0.3,           // GPS altitude noise tolerance
        ALTITUDE_VALIDATION_ENABLED: true,          // Enable altitude cross-validation

        // FMB920 Technical Behavior
        // NOTE: FMB920 alternates between GPS and accelerometer measurements
        // When measuring GPS, accelerometer may show zeros and vice versa
        // This is NOT an error - it's normal device behavior
        FMB920_MEASUREMENT_ALTERNATION: true,
        FMB920_ZERO_VALUE_ACCEPTABLE: true,         // Zero values in ACC/GPS are normal

        // Battery context (Parkside 4Ah)
        BATTERY_CAPACITY_MAH: 4000,
        BATTERY_EXPECTED_RUNTIME_DAYS: 12,          // Average from field data
        BATTERY_ACTUAL_CONSUMPTION_MAH_DAY: 350     // Measured ~350 mAh/day
    };

    // ============================================================
    // FACILITY GEOMETRY
    // ============================================================

    const DEFAULT_FACILITY = {
        CENTER: [50.95087526458519, 14.569026145132602],

        RED_FENCE: [
            [50.95118486126528, 14.568476248365942],
            [50.951122967690054, 14.568944229981248],
            [50.95110596337696, 14.569769665678512],
            [50.95085841585557, 14.569742352646447],
            [50.9506629398737, 14.569651351300477],
            [50.95078866632813, 14.568954399565536],
            [50.950522086837864, 14.568764090155774],
            [50.950552701956866, 14.568605796527747],
            [50.950481594058694, 14.568571961908164],
            [50.95058529824113, 14.56830063042661],
            [50.95118486126528, 14.568476248365942]
        ],

        RED_FENCE_II: [
            [50.95112548891294, 14.569770735360622],
            [50.95182341701896, 14.569930243974056],
            [50.95194963708653, 14.569310718820983],
            [50.95189767206663, 14.569162122690791],
            [50.9519871209886, 14.568736722984072],
            [50.95206402572403, 14.568162724625793],
            [50.9513333072117, 14.567868075031061],
            [50.951133202484975, 14.56882000828748],
            [50.95113009130612, 14.56896764742384],
            [50.95115578163604, 14.56927495841835],
            [50.95112548891294, 14.569770735360622]
        ],

        RED_FENCE_III: [
            [50.95200311825869, 14.568647775648948],
            [50.95268737613058, 14.568875080010143],
            [50.95277237632876, 14.567623268127804],
            [50.952280241566804, 14.567596532690539],
            [50.95209436998893, 14.568126439212186],
            [50.95202530888388, 14.568314543580728],
            [50.95200311825869, 14.568647775648948]
        ],

        ZONE_A: [
            [50.95102236622948, 14.569107686469978],
            [50.950949671103714, 14.569686110556448],
            [50.95071687649483, 14.569608168428088],
            [50.95081366019143, 14.569025289975537],
            [50.95102236622948, 14.569107686469978]
        ],

        ZONE_B: [
            [50.95102236622948, 14.569107686469978],
            [50.951144657492286, 14.569174081619819],
            [50.95110444520633, 14.56965752850762],
            [50.95096692430621, 14.569609342050127],
            [50.95102236622948, 14.569107686469978]
        ],

        ZONE_C: [
            [50.95114038875684, 14.568687268802941],
            [50.95070719320555, 14.568535751266392],
            [50.95064615487605, 14.568819625680666],
            [50.951096750236005, 14.569011156971978],
            [50.95114038875684, 14.568687268802941]
        ]
    };

    DEFAULT_FACILITY.RED_FENCES = [
        DEFAULT_FACILITY.RED_FENCE,
        DEFAULT_FACILITY.RED_FENCE_II,
        DEFAULT_FACILITY.RED_FENCE_III
    ].filter(Boolean);

    const FACILITY = DEFAULT_FACILITY;

    // Color scales for points layer
    const INDIGO_SCALE = ['#6366f1', '#4f46e5', '#4338ca', '#3730a3'];
    const ORANGE_SCALE = ['#fb923c', '#f97316', '#ea580c', '#9a3412'];
    const MARKER_SIZES = [8, 12, 16, 22];

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function safeNumber(v) {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
    }

    function parseTimeToSeconds(ts) {
        if (typeof ts === 'number') return ts;
        if (typeof ts !== 'string') return null;
        const parts = ts.split(':');
        if (parts.length < 2) return null;
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const s = parts[2] ? parseInt(parts[2], 10) : 0;
        if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
        return h * 3600 + m * 60 + s;
    }

    /**
     * Parse date string (dd.mm.yyyy) and time string (hh:mm:ss) into epoch seconds
     * This allows proper sorting across midnight boundaries
     * @param {string} dateStr - Date in format "dd.mm.yyyy"
     * @param {string} timeStr - Time in format "hh:mm:ss"
     * @returns {number|null} - Epoch seconds or null if invalid
     */
    function parseDateTimeToEpoch(dateStr, timeStr) {
        if (!dateStr || !timeStr) return null;

        const dateParts = dateStr.split('.');
        if (dateParts.length !== 3) return null;

        const [day, month, year] = dateParts.map(Number);
        if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

        const timeSec = parseTimeToSeconds(timeStr);
        if (timeSec === null) return null;

        // Create date at midnight and add time seconds
        const date = new Date(year, month - 1, day, 0, 0, 0);
        return Math.floor(date.getTime() / 1000) + timeSec;
    }

    /**
     * Detect and filter retry records (out-of-sequence transmissions)
     * FMB920 retries failed transmissions, causing old timestamps to appear
     * in the middle of newer data. These are detected as backward time jumps.
     *
     * @param {Array} records - Array of records with epochSec property
     * @param {number} maxBackwardJumpSec - Maximum allowed backward time jump (default 300s = 5 min)
     * @returns {Object} - { filtered: Array, retryRecords: Array, stats: Object }
     */
    function filterRetryRecords(records, maxBackwardJumpSec = 300) {
        if (!records || records.length < 2) {
            return { filtered: records || [], retryRecords: [], stats: { total: 0, filtered: 0 } };
        }

        const filtered = [];
        const retryRecords = [];
        let lastValidEpoch = records[0].epochSec;

        filtered.push(records[0]);

        for (let i = 1; i < records.length; i++) {
            const record = records[i];
            const timeDiff = record.epochSec - lastValidEpoch;

            // If time went backward significantly, this is a retry record
            if (timeDiff < -maxBackwardJumpSec) {
                retryRecords.push({
                    index: i,
                    record: record,
                    backwardJumpSec: -timeDiff,
                    expectedAfter: lastValidEpoch
                });
                // Skip this record - it's out of sequence
                continue;
            }

            // Accept record and update last valid time
            filtered.push(record);
            lastValidEpoch = record.epochSec;
        }

        return {
            filtered: filtered,
            retryRecords: retryRecords,
            stats: {
                total: records.length,
                filtered: filtered.length,
                retryCount: retryRecords.length,
                removed: records.length - filtered.length,
                percentFiltered: ((records.length - filtered.length) / records.length * 100).toFixed(2)
            }
        };
    }

    /**
     * Detect large gaps in time series that should NOT be interpolated
     * Returns segments of continuous data that can be safely interpolated
     *
     * @param {Array} samples - Array of samples with tSec property
     * @param {number} maxGapSec - Maximum gap to interpolate (default from CONFIG)
     * @returns {Array} - Array of continuous segments
     */
    function segmentByGaps(samples, maxGapSec) {
        maxGapSec = maxGapSec || CONFIG.MAX_INTERVAL_SEC;

        if (!samples || samples.length < 2) {
            return samples ? [samples] : [];
        }

        const segments = [];
        let currentSegment = [samples[0]];

        for (let i = 1; i < samples.length; i++) {
            const gap = samples[i].tSec - samples[i - 1].tSec;

            if (gap > maxGapSec) {
                // Gap too large - start new segment
                if (currentSegment.length > 0) {
                    segments.push(currentSegment);
                }
                currentSegment = [samples[i]];
            } else {
                currentSegment.push(samples[i]);
            }
        }

        // Don't forget the last segment
        if (currentSegment.length > 0) {
            segments.push(currentSegment);
        }

        return segments;
    }

    function formatDuration(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0m';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    function formatHhMm(sec) {
        if (!Number.isFinite(sec)) return '--:--';
        const h = Math.floor(sec / 3600) % 24;
        const m = Math.floor((sec % 3600) / 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    function haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function bearingDegrees(lat1, lon1, lat2, lon2) {
        const toRad = (deg) => deg * Math.PI / 180;
        const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
        const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
        let brng = Math.atan2(y, x) * 180 / Math.PI;
        brng = (brng + 360) % 360;
        return brng;
    }

    function direction8(deg) {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const idx = Math.round(((deg % 360) / 45)) % 8;
        return dirs[idx];
    }

    // ============================================================
    // POLYGON UTILITIES
    // ============================================================

    function isPointInsidePolygon(lat, lon, polygonLatLon) {
        const x = lon;
        const y = lat;
        let inside = false;
        for (let i = 0, j = polygonLatLon.length - 1; i < polygonLatLon.length; j = i++) {
            const yi = polygonLatLon[i][0];
            const xi = polygonLatLon[i][1];
            const yj = polygonLatLon[j][0];
            const xj = polygonLatLon[j][1];
            const intersects = ((yi > y) !== (yj > y)) &&
                (x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    function getRedFencePolygons() {
        if (FACILITY.RED_FENCES && FACILITY.RED_FENCES.length) {
            return FACILITY.RED_FENCES;
        }
        const polygons = [];
        if (FACILITY.RED_FENCE) polygons.push(FACILITY.RED_FENCE);
        if (FACILITY.RED_FENCE_II) polygons.push(FACILITY.RED_FENCE_II);
        if (FACILITY.RED_FENCE_III) polygons.push(FACILITY.RED_FENCE_III);
        return polygons;
    }

    function isInsideRedFence(lat, lon) {
        const fences = getRedFencePolygons();
        for (const fence of fences) {
            if (isPointInsidePolygon(lat, lon, fence)) return true;
        }
        return false;
    }

    function isInsideFenceI(lat, lon) {
        const fence = getRedFencePolygons()[0];
        return fence ? isPointInsidePolygon(lat, lon, fence) : false;
    }

    function isInsideFenceII(lat, lon) {
        const fence = getRedFencePolygons()[1];
        return fence ? isPointInsidePolygon(lat, lon, fence) : false;
    }

    function isInsideFenceIII(lat, lon) {
        const fence = getRedFencePolygons()[2];
        return fence ? isPointInsidePolygon(lat, lon, fence) : false;
    }

    function getZoneLabel(lat, lon) {
        if (isPointInsidePolygon(lat, lon, FACILITY.ZONE_A)) return "A";
        if (isPointInsidePolygon(lat, lon, FACILITY.ZONE_B)) return "B";
        if (isPointInsidePolygon(lat, lon, FACILITY.ZONE_C)) return "C";
        const fences = getRedFencePolygons();
        const labels = ["I", "II", "III"];
        for (let i = 0; i < fences.length; i++) {
            if (isPointInsidePolygon(lat, lon, fences[i])) {
                return labels[i] || `FENCE_${i + 1}`;
            }
        }
        return null;
    }

    // ============================================================
    // INTERPOLATION & RESAMPLING
    // ============================================================

    function isStandByGap(gapDurationSec) {
        return gapDurationSec >= CONFIG.STANDBY_THRESHOLD_SEC &&
               gapDurationSec <= CONFIG.STANDBY_MAX_DURATION_SEC;
    }

    function lerp(v0, v1, t) {
        return v0 + t * (v1 - v0);
    }

    function interpolateGPS(lat1, lon1, lat2, lon2, t, isStandBy) {
        if (isStandBy) {
            return { lat: lat1, lon: lon1 };
        }
        return {
            lat: lerp(lat1, lat2, t),
            lon: lerp(lon1, lon2, t)
        };
    }

    function interpolateAcc(acc1, acc2, t, isStandBy) {
        if (!acc1 || !acc2) return acc1 || acc2 || null;

        if (isStandBy) {
            return { ...acc1 };
        }

        return {
            x: Math.round(lerp(acc1.x, acc2.x, t)),
            y: Math.round(lerp(acc1.y, acc2.y, t)),
            z: Math.round(lerp(acc1.z, acc2.z, t))
        };
    }

    /**
     * Resample data to 1Hz with gap-aware interpolation
     * IMPORTANT: Does NOT interpolate across gaps larger than MAX_INTERVAL_SEC
     * This prevents creating millions of fake samples from multi-hour gaps
     *
     * @param {Array} samples - Input samples with tSec property
     * @returns {Array} - Resampled data at 1Hz with interpolation flags
     */
    function resampleTo1Hz(samples) {
        if (!samples || samples.length < 2) return samples;
        if (!CONFIG.INTERPOLATION_ENABLED) return samples;

        const resampled = [];
        const maxGap = CONFIG.MAX_INTERVAL_SEC;
        let totalInterpolated = 0;
        let skippedGaps = 0;

        // Process each pair of consecutive samples
        // IMPORTANT: Use epochSec for gap calculation (handles midnight crossing correctly)
        for (let i = 0; i < samples.length; i++) {
            const s0 = samples[i];
            const s1 = (i < samples.length - 1) ? samples[i + 1] : null;

            // Always include the original sample
            resampled.push({
                ...s0,
                interpolated: false,
                standByPeriod: false
            });

            // If no next sample, skip
            if (!s1) continue;

            // Use epochSec for gap duration calculation (correct after midnight fix)
            const gapDuration = (s0.epochSec !== undefined && s1.epochSec !== undefined)
                ? (s1.epochSec - s0.epochSec)
                : (s1.tSec - s0.tSec);

            // Skip interpolation for negative gaps (should not happen after sorting)
            if (gapDuration <= 0) {
                console.warn(`[Rumburk] WARNING: Non-positive gap ${gapDuration}s at index ${i}`);
                continue;
            }

            // Skip interpolation for gaps larger than MAX_INTERVAL_SEC
            // This prevents creating millions of fake samples from data errors
            if (gapDuration > maxGap) {
                console.log(`[Rumburk] Skipping interpolation for ${gapDuration}s gap (max: ${maxGap}s) at tSec=${s0.tSec}`);
                skippedGaps++;
                continue;
            }

            // Skip if gap is <= 1 second (no room to interpolate)
            if (gapDuration <= 1) continue;

            const isStandBy = isStandByGap(gapDuration);

            // Interpolate between s0 and s1 using epochSec
            const startEpoch = s0.epochSec !== undefined ? s0.epochSec : s0.tSec;
            const endEpoch = s1.epochSec !== undefined ? s1.epochSec : s1.tSec;

            for (let e = startEpoch + 1; e < endEpoch; e++) {
                const tFactor = (e - startEpoch) / gapDuration;

                const gps = interpolateGPS(s0.lat, s0.lon, s1.lat, s1.lon, tFactor, isStandBy);

                const acc0 = (s0.accX !== null) ? { x: s0.accX, y: s0.accY, z: s0.accZ } : null;
                const acc1Obj = (s1.accX !== null) ? { x: s1.accX, y: s1.accY, z: s1.accZ } : null;
                const acc = interpolateAcc(acc0, acc1Obj, tFactor, isStandBy);

                const interpSample = {
                    tSec: e % (24 * 3600), // Keep tSec within 0-86399 for display
                    epochSec: e,           // Full epoch for sorting/calculations
                    lat: gps.lat,
                    lon: gps.lon,
                    accX: acc ? acc.x : null,
                    accY: acc ? acc.y : null,
                    accZ: acc ? acc.z : null,
                    mag: acc ? Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z) : null,
                    interpolated: true,
                    standByPeriod: isStandBy,
                    originalGapDuration: gapDuration
                };

                resampled.push(interpSample);
                totalInterpolated++;
            }
        }

        console.log(`[Rumburk] Interpolation: ${samples.length} original → ${resampled.length} total (${totalInterpolated} interpolated, ${skippedGaps} gaps skipped)`);
        return resampled;
    }

    function analyzeStandByPeriods(samples) {
        const standByPeriods = [];
        let totalStandByTime = 0;
        let longestStandBy = 0;

        for (let i = 1; i < samples.length; i++) {
            const gap = samples[i].tSec - samples[i - 1].tSec;

            if (isStandByGap(gap)) {
                standByPeriods.push({
                    startSec: samples[i - 1].tSec,
                    endSec: samples[i].tSec,
                    duration: gap,
                    startLat: samples[i - 1].lat,
                    startLon: samples[i - 1].lon
                });
                totalStandByTime += gap;
                if (gap > longestStandBy) longestStandBy = gap;
            }
        }

        return {
            periods: standByPeriods,
            totalTime: totalStandByTime,
            count: standByPeriods.length,
            longestDuration: longestStandBy,
            averageDuration: standByPeriods.length > 0 ? totalStandByTime / standByPeriods.length : 0
        };
    }

    // ============================================================
    // GRAVITY EXTRACTION & POSTURE ENGINE
    // ============================================================

    function applyButterworthLowPass(series, sampleRate, cutoffHz) {
        if (!Array.isArray(series) || series.length === 0) return [];
        if (!sampleRate || !cutoffHz || cutoffHz >= sampleRate / 2) {
            return series.slice();
        }

        const result = new Array(series.length).fill(0);
        const k = Math.tan(Math.PI * cutoffHz / sampleRate);
        const norm = 1 / (1 + Math.SQRT2 * k + k * k);
        const b0 = k * k * norm;
        const b1 = 2 * b0;
        const b2 = b0;
        const a1 = 2 * (k * k - 1) * norm;
        const a2 = (1 - Math.SQRT2 * k + k * k) * norm;

        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

        for (let i = 0; i < series.length; i++) {
            const x0 = Number.isFinite(series[i]) ? series[i] : x1;
            const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            result[i] = y0;
            x2 = x1;
            x1 = x0;
            y2 = y1;
            y1 = y0;
        }

        return result;
    }

    function normalizeVector(vec) {
        if (!vec) return null;
        const mag = Math.sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z);
        if (!Number.isFinite(mag) || mag === 0) return null;
        return {
            x: vec.x / mag,
            y: vec.y / mag,
            z: vec.z / mag,
            magnitude: 1
        };
    }

    function autoCalibrateOrientation(gravityVectors) {
        if (!Array.isArray(gravityVectors) || gravityVectors.length === 0) {
            return {
                status: 'PENDING',
                vector: { x: 0, y: 0, z: 1 },
                sampleCount: 0
            };
        }

        const sampleRate = CONFIG.GRAVITY_FILTER_SAMPLE_RATE_HZ || CONFIG.INTERPOLATION_TARGET_HZ || 1;
        const maxSamples = Math.min(
            gravityVectors.length,
            Math.round((CONFIG.CALIBRATION_HOURS || 24) * 3600 * (sampleRate || 1))
        );
        const windowSize = Math.max(1, Math.round((CONFIG.POSTURE_WINDOW_SEC || 60) * sampleRate));
        const step = Math.max(1, Math.floor(windowSize / 2));
        const candidates = [];

        for (let start = 0; start + windowSize <= maxSamples; start += step) {
            const slice = gravityVectors.slice(start, start + windowSize);
            const mags = slice.map(v => v.magnitude);
            const avgMag = mags.reduce((sum, v) => sum + v, 0) / mags.length;
            const variance = mags.reduce((sum, v) => sum + Math.pow(v - avgMag, 2), 0) / mags.length;

            if (variance <= CONFIG.CALIBRATION_VARIANCE_THRESHOLD_G2 &&
                avgMag >= CONFIG.CALIBRATION_MAG_MIN_G &&
                avgMag <= CONFIG.CALIBRATION_MAG_MAX_G) {
                const avgVec = {
                    x: slice.reduce((sum, v) => sum + v.x, 0) / slice.length,
                    y: slice.reduce((sum, v) => sum + v.y, 0) / slice.length,
                    z: slice.reduce((sum, v) => sum + v.z, 0) / slice.length
                };
                const norm = normalizeVector(avgVec);
                if (norm) candidates.push(norm);
            }
        }

        if (candidates.length >= CONFIG.CALIBRATION_MIN_WINDOWS) {
            const componentMedian = (getter) => {
                const arr = candidates.map(getter).sort((a, b) => a - b);
                return arr[Math.floor(arr.length / 2)];
            };
            const vector = normalizeVector({
                x: componentMedian(v => v.x),
                y: componentMedian(v => v.y),
                z: componentMedian(v => v.z)
            });

            return {
                status: 'CALIBRATED',
                vector: vector || { x: 0, y: 0, z: 1 },
                sampleCount: candidates.length
            };
        }

        return {
            status: 'UNCALIBRATED',
            vector: { x: 0, y: 0, z: 1 },
            sampleCount: candidates.length
        };
    }

    function calculateTiltBetweenVectors(vec, referenceVector) {
        if (!vec || !referenceVector) return null;
        const magnitude = vec.magnitude || Math.sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z);
        if (!Number.isFinite(magnitude) || magnitude < 1e-3) return null;

        const refMag = Math.sqrt(referenceVector.x * referenceVector.x +
            referenceVector.y * referenceVector.y +
            referenceVector.z * referenceVector.z) || 1;

        const dot = Math.abs(vec.x * referenceVector.x + vec.y * referenceVector.y + vec.z * referenceVector.z);
        const cosTilt = Math.min(1, Math.max(-1, dot / (magnitude * refMag)));
        return Math.acos(cosTilt) * (180 / Math.PI);
    }

    function computeSlidingVariance(values, windowSize) {
        if (!Array.isArray(values) || values.length === 0) return [];
        if (windowSize <= 1) return new Array(values.length).fill(0);

        const result = new Array(values.length).fill(0);
        let sum = 0;
        let sumSq = 0;

        for (let i = 0; i < values.length; i++) {
            const v = Number.isFinite(values[i]) ? values[i] : 0;
            sum += v;
            sumSq += v * v;

            if (i >= windowSize) {
                const old = Number.isFinite(values[i - windowSize]) ? values[i - windowSize] : 0;
                sum -= old;
                sumSq -= old * old;
            }

            const winLength = Math.min(windowSize, i + 1);
            const mean = sum / winLength;
            result[i] = Math.max(0, (sumSq / winLength) - (mean * mean));
        }

        return result;
    }

    class PostureStateMachine {
        constructor(minDurationSec) {
            this.minDurationSec = Math.max(1, minDurationSec || CONFIG.POSTURE_MIN_DURATION_SEC);
            this.currentState = 'unknown';
            this.pendingState = null;
            this.pendingSince = null;
        }

        update(timestampSec, rawPosture) {
            if (!rawPosture || rawPosture === 'transition' || rawPosture === 'unknown') {
                return this.currentState;
            }

            if (this.currentState === 'unknown') {
                this.currentState = rawPosture;
                this.pendingState = null;
                this.pendingSince = timestampSec;
                return this.currentState;
            }

            if (rawPosture !== this.currentState) {
                if (this.pendingState !== rawPosture) {
                    this.pendingState = rawPosture;
                    this.pendingSince = timestampSec;
                } else if (timestampSec - this.pendingSince >= this.minDurationSec) {
                    this.currentState = rawPosture;
                    this.pendingState = null;
                    this.pendingSince = timestampSec;
                }
            } else {
                this.pendingState = null;
                this.pendingSince = timestampSec;
            }

            return this.currentState;
        }
    }

    function classifyPostureByTilt(tiltDeg, variance) {
        if (!Number.isFinite(tiltDeg)) return 'unknown';
        if (variance > CONFIG.POSTURE_VARIANCE_THRESHOLD_G2) return 'transition';
        if (tiltDeg < CONFIG.TILT_STANDING_MAX_DEG) return 'standing';
        if (tiltDeg > CONFIG.TILT_LYING_MIN_DEG) return 'lying';
        return 'transition';
    }

    function calculatePostureConfidence(state, tiltDeg, variance) {
        if (!state || state === 'unknown') return 0.3;
        if (!Number.isFinite(tiltDeg)) return 0.3;

        let confidence;
        if (state === 'standing') {
            const ratio = tiltDeg / (CONFIG.TILT_STANDING_MAX_DEG || 35);
            confidence = 1 - Math.min(1, ratio);
        } else if (state === 'lying') {
            const delta = Math.max(0, tiltDeg - CONFIG.TILT_LYING_MIN_DEG);
            confidence = 0.6 + Math.min(0.4, delta / 45);
        } else {
            confidence = 0.4;
        }

        if (variance > CONFIG.POSTURE_VARIANCE_THRESHOLD_G2 * 0.8) {
            confidence *= 0.5;
        }

        return Math.max(0, Math.min(1, confidence));
    }

    function buildPostureTimeline(samples) {
        if (!Array.isArray(samples) || samples.length === 0) {
            return {
                calibration: { status: 'PENDING', vector: { x: 0, y: 0, z: 1 }, sampleCount: 0 },
                segments: [],
                summary: {
                    standingSec: 0,
                    lyingSec: 0,
                    transitionSec: 0,
                    standingSamples: 0,
                    lyingSamples: 0,
                    transitionSamples: 0,
                    standingConfidenceSum: 0,
                    lyingConfidenceSum: 0,
                    lowConfidenceStandingSamples: 0,
                    lowConfidenceLyingSamples: 0,
                    lowConfidenceStandingSec: 0,
                    lowConfidenceLyingSec: 0,
                    lowConfidenceSamples: 0,
                    lowConfidenceSec: 0,
                    lowConfidenceThreshold: CONFIG.POSTURE_LOW_CONFIDENCE_THRESHOLD || 0.6,
                    avgStandingConfidence: null,
                    avgLyingConfidence: null,
                    totalSamples: 0
                }
            };
        }

        const sampleRate = CONFIG.GRAVITY_FILTER_SAMPLE_RATE_HZ || CONFIG.INTERPOLATION_TARGET_HZ || 1;
        const cutoff = CONFIG.GRAVITY_CUTOFF_HZ || 0.5;
        const axSeries = [];
        const aySeries = [];
        const azSeries = [];

        let lastX = 0;
        let lastY = 0;
        let lastZ = CONFIG.ACC_GRAVITY_G;

        for (const sample of samples) {
            if (Number.isFinite(sample.accX)) lastX = sample.accX / CONFIG.ACC_SCALE;
            if (Number.isFinite(sample.accY)) lastY = sample.accY / CONFIG.ACC_SCALE;
            if (Number.isFinite(sample.accZ)) lastZ = sample.accZ / CONFIG.ACC_SCALE;
            axSeries.push(lastX);
            aySeries.push(lastY);
            azSeries.push(lastZ);
        }

        const filteredX = applyButterworthLowPass(axSeries, sampleRate, cutoff);
        const filteredY = applyButterworthLowPass(aySeries, sampleRate, cutoff);
        const filteredZ = applyButterworthLowPass(azSeries, sampleRate, cutoff);

        const gravityVectors = filteredX.map((gx, i) => {
            const gy = filteredY[i];
            const gz = filteredZ[i];
            const magnitude = Math.sqrt(gx * gx + gy * gy + gz * gz);
            return { x: gx, y: gy, z: gz, magnitude };
        });

        const calibration = autoCalibrateOrientation(gravityVectors);
        const referenceVector = calibration.vector || { x: 0, y: 0, z: 1 };
        const tilts = gravityVectors.map(vec => calculateTiltBetweenVectors(vec, referenceVector));
        const magnitudes = gravityVectors.map(vec => vec.magnitude);
        const windowSize = Math.max(1, Math.round((CONFIG.POSTURE_WINDOW_SEC || 60) * sampleRate));
        const variances = computeSlidingVariance(magnitudes, windowSize);
        const stateMachine = new PostureStateMachine(CONFIG.POSTURE_MIN_DURATION_SEC);
        const sampleDurationSec = 1 / Math.max(0.001, sampleRate);

        const lowConfidenceThreshold = CONFIG.POSTURE_LOW_CONFIDENCE_THRESHOLD || 0.6;
        const summary = {
            standingSec: 0,
            lyingSec: 0,
            transitionSec: 0,
            standingSamples: 0,
            lyingSamples: 0,
            transitionSamples: 0,
            standingConfidenceSum: 0,
            lyingConfidenceSum: 0,
            lowConfidenceStandingSamples: 0,
            lowConfidenceLyingSamples: 0,
            lowConfidenceStandingSec: 0,
            lowConfidenceLyingSec: 0,
            lowConfidenceThreshold,
            totalSamples: samples.length
        };

        const timelineSegments = [];
        let activeSegment = null;

        function finalizeSegment() {
            if (!activeSegment) return;
            const epochDuration = (activeSegment.endEpoch - activeSegment.startEpoch) + sampleDurationSec;
            timelineSegments.push({
                state: activeSegment.state,
                startSec: activeSegment.startSec,
                endSec: activeSegment.endSec,
                durationSec: Math.max(sampleDurationSec, epochDuration),
                avgTiltDeg: activeSegment.count > 0 ? activeSegment.tiltSum / activeSegment.count : null
            });
            activeSegment = null;
        }

        for (let i = 0; i < samples.length; i++) {
            const tiltDeg = tilts[i];
            const variance = variances[i];
            const rawPosture = classifyPostureByTilt(tiltDeg, variance);
            const timestamp = samples[i].epochSec !== undefined ? samples[i].epochSec : (i / sampleRate);
            const stablePosture = stateMachine.update(timestamp, rawPosture);
            const finalPosture = stablePosture !== 'unknown'
                ? stablePosture
                : (rawPosture === 'transition' ? 'unknown' : rawPosture);
            const confidence = calculatePostureConfidence(finalPosture, tiltDeg, variance);

            samples[i].postureContext = {
                tiltDegrees: tiltDeg,
                variance,
                rawPosture,
                stablePosture: finalPosture,
                confidence,
                timestamp
            };
            samples[i].tiltDegrees = tiltDeg;

            if (finalPosture === 'standing') {
                summary.standingSec += sampleDurationSec;
                summary.standingSamples++;
                if (Number.isFinite(confidence)) {
                    summary.standingConfidenceSum += confidence;
                    if (confidence < lowConfidenceThreshold) {
                        summary.lowConfidenceStandingSamples++;
                        summary.lowConfidenceStandingSec += sampleDurationSec;
                    }
                }
            } else if (finalPosture === 'lying') {
                summary.lyingSec += sampleDurationSec;
                summary.lyingSamples++;
                if (Number.isFinite(confidence)) {
                    summary.lyingConfidenceSum += confidence;
                    if (confidence < lowConfidenceThreshold) {
                        summary.lowConfidenceLyingSamples++;
                        summary.lowConfidenceLyingSec += sampleDurationSec;
                    }
                }
            } else {
                summary.transitionSec += sampleDurationSec;
                summary.transitionSamples++;
            }

            const isStable = finalPosture === 'standing' || finalPosture === 'lying';
            if (!isStable) {
                finalizeSegment();
                continue;
            }

            if (!activeSegment || activeSegment.state !== finalPosture) {
                finalizeSegment();
                activeSegment = {
                    state: finalPosture,
                    startSec: samples[i].tSec,
                    endSec: samples[i].tSec,
                    startEpoch: timestamp,
                    endEpoch: timestamp,
                    tiltSum: Number.isFinite(tiltDeg) ? tiltDeg : 0,
                    count: Number.isFinite(tiltDeg) ? 1 : 0
                };
            } else {
                activeSegment.endSec = samples[i].tSec;
                activeSegment.endEpoch = timestamp;
                if (Number.isFinite(tiltDeg)) {
                    activeSegment.tiltSum += tiltDeg;
                    activeSegment.count++;
                }
            }
        }

        finalizeSegment();

        summary.avgStandingConfidence = summary.standingSamples > 0
            ? summary.standingConfidenceSum / summary.standingSamples
            : null;
        summary.avgLyingConfidence = summary.lyingSamples > 0
            ? summary.lyingConfidenceSum / summary.lyingSamples
            : null;
        summary.lowConfidenceSamples = summary.lowConfidenceStandingSamples + summary.lowConfidenceLyingSamples;
        summary.lowConfidenceSec = summary.lowConfidenceStandingSec + summary.lowConfidenceLyingSec;

        return {
            calibration,
            segments: timelineSegments,
            summary
        };
    }

    // ============================================================
    // BEHAVIOR CLASSIFICATION
    // ============================================================

    function classifyPostureFromAcc(accAbsUnit, accNorm, postureContext) {
        if (postureContext && postureContext.stablePosture) {
            return {
                posture: postureContext.stablePosture,
                confidence: postureContext.confidence,
                tiltDegrees: postureContext.tiltDegrees,
                variance: postureContext.variance,
                rawPosture: postureContext.rawPosture,
                source: 'tilt_filter'
            };
        }

        if (!accAbsUnit || accAbsUnit.length !== 3 || accNorm === null) {
            return { posture: 'unknown', confidence: 0 };
        }

        const [ax, ay, az] = accAbsUnit;
        const normG = accNorm / CONFIG.ACC_SCALE;

        const gravityValid = normG >= (CONFIG.ACC_GRAVITY_G - CONFIG.ACC_GRAVITY_TOLERANCE) &&
                            normG <= (CONFIG.ACC_GRAVITY_G + CONFIG.ACC_GRAVITY_TOLERANCE);

        if (!gravityValid) {
            return { posture: 'moving', confidence: 0.7 };
        }

        if (az >= CONFIG.POSTURE_STANDING_AZ_MIN && ax <= CONFIG.POSTURE_STANDING_AXAY_MAX && ay <= CONFIG.POSTURE_STANDING_AXAY_MAX) {
            const confidence = Math.min(1, (az - 0.7) / 0.3);
            return { posture: 'standing', confidence };
        }

        if (az <= CONFIG.POSTURE_LYING_AZ_MAX && (ax >= CONFIG.POSTURE_LYING_AXAY_MIN || ay >= CONFIG.POSTURE_LYING_AXAY_MIN)) {
            const maxXY = Math.max(ax, ay);
            const confidence = Math.min(1, (maxXY - 0.5) / 0.4);
            return { posture: 'lying', confidence };
        }

        if (az > 0.5) {
            return { posture: 'standing', confidence: 0.5 };
        } else {
            return { posture: 'lying', confidence: 0.5 };
        }
    }

    function classifyMovementFromGPS(distanceM, speedMps, dt) {
        if (dt <= 0) return { movement: 'unknown', confidence: 0 };

        const effectiveSpeed = speedMps;

        if (effectiveSpeed < CONFIG.SPEED_STATIONARY_MPS) {
            return { movement: 'stationary', confidence: 0.95 };
        }
        if (effectiveSpeed < CONFIG.SPEED_GRAZING_MPS) {
            return { movement: 'grazing', confidence: 0.85 };
        }
        if (effectiveSpeed < CONFIG.SPEED_SLOW_WALK_MPS) {
            return { movement: 'slow_walk', confidence: 0.8 };
        }
        if (effectiveSpeed < CONFIG.SPEED_NORMAL_WALK_MPS) {
            return { movement: 'normal_walk', confidence: 0.85 };
        }
        if (effectiveSpeed < CONFIG.SPEED_FAST_WALK_MPS) {
            return { movement: 'fast_walk', confidence: 0.8 };
        }
        return { movement: 'running', confidence: 0.9 };
    }

    function classifyMovementFromAcc(dynG, stepFreqHz) {
        if (dynG === null) return { movement: 'unknown', confidence: 0 };

        if (dynG < CONFIG.ACC_DYN_STATIONARY_G) {
            return { movement: 'stationary', confidence: 0.95 };
        }
        if (dynG < CONFIG.ACC_DYN_RUMINATING_G) {
            return { movement: 'ruminating', confidence: 0.8 };
        }
        if (dynG < CONFIG.ACC_DYN_GRAZING_G) {
            return { movement: 'grazing', confidence: 0.75 };
        }
        if (dynG < CONFIG.ACC_DYN_WALKING_G) {
            return { movement: 'walking', confidence: 0.8 };
        }
        if (dynG < CONFIG.ACC_DYN_FAST_WALK_G) {
            return { movement: 'fast_walk', confidence: 0.75 };
        }
        return { movement: 'running', confidence: 0.85 };
    }

    function crossValidateBehavior(gpsResult, accResult, accPosture) {
        const result = {
            behavior: 'standing',
            posture: 'standing',
            movement: 'stationary',
            confidence: 0,
            source: 'combined',
            consistency: 'ok'
        };

        const gpsMoving = ['grazing', 'slow_walk', 'normal_walk', 'fast_walk', 'running'].includes(gpsResult.movement);
        const accMoving = ['grazing', 'walking', 'fast_walk', 'running'].includes(accResult.movement);
        const accStationary = ['stationary', 'ruminating'].includes(accResult.movement);

        if (gpsMoving) {
            result.posture = 'standing';
            result.movement = gpsResult.movement;
            result.behavior = gpsResult.movement === 'grazing' ? 'grazing' : 'walking';

            if (accMoving) {
                result.confidence = Math.max(gpsResult.confidence, accResult.confidence);
                result.consistency = 'consistent';
            } else {
                result.confidence = gpsResult.confidence * 0.8;
                result.consistency = 'gps_override';
            }
        } else {
            result.movement = 'stationary';

            if (accPosture.posture === 'lying') {
                result.posture = 'lying';
                result.behavior = 'lying';
                result.confidence = accPosture.confidence;

                if (accStationary) {
                    result.consistency = 'consistent';
                } else {
                    result.behavior = 'lying_active';
                    result.consistency = 'minor_inconsistency';
                }
            } else if (accPosture.posture === 'standing') {
                result.posture = 'standing';

                if (accResult.movement === 'ruminating') {
                    result.behavior = 'standing_ruminating';
                } else if (accStationary) {
                    result.behavior = 'standing';
                } else {
                    result.behavior = 'standing_active';
                }
                result.confidence = accPosture.confidence;
                result.consistency = 'consistent';
            } else {
                if (accMoving) {
                    result.behavior = 'walking';
                    result.posture = 'standing';
                    result.consistency = 'acc_override';
                    result.confidence = accResult.confidence * 0.7;
                } else {
                    result.behavior = 'standing';
                    result.posture = 'standing';
                    result.confidence = 0.5;
                    result.consistency = 'uncertain';
                }
            }
        }

        return result;
    }

    function simplifyBehavior(behavior) {
        if (behavior.includes('lying')) return 'lying';
        if (behavior.includes('walk') || behavior === 'running' || behavior === 'grazing') return 'walking';
        return 'standing';
    }

    // ============================================================
    // ALTITUDE-BASED CROSS-VALIDATION (FMB920 Technical)
    // ============================================================

    /**
     * Detect lying/standing transitions based on altitude changes.
     * When a cow stands up from lying position, altitude increases by ~1m.
     * This provides an independent validation of accelerometer-based posture detection.
     *
     * @param {Array} samples - Array of samples with altitude data
     * @returns {Object} - Altitude analysis results
     */
    function analyzeAltitudeTransitions(samples) {
        if (!CONFIG.ALTITUDE_VALIDATION_ENABLED) {
            return { enabled: false, transitions: [], validationScore: 0 };
        }

        const transitions = [];
        let validAltitudeCount = 0;
        let totalAltitudeChange = 0;
        let maxAltitude = -Infinity;
        let minAltitude = Infinity;

        for (let i = 1; i < samples.length; i++) {
            const prev = samples[i - 1];
            const curr = samples[i];

            if (curr.altitude === null || curr.altitude === 0 ||
                prev.altitude === null || prev.altitude === 0) {
                continue;
            }

            validAltitudeCount++;
            const altChange = curr.altitude - prev.altitude;
            totalAltitudeChange += Math.abs(altChange);

            if (curr.altitude > maxAltitude) maxAltitude = curr.altitude;
            if (curr.altitude < minAltitude) minAltitude = curr.altitude;

            // Detect significant altitude changes (potential posture transitions)
            if (Math.abs(altChange) >= CONFIG.ALTITUDE_LYING_STANDING_THRESHOLD_M) {
                const dt = curr.tSec - prev.tSec;

                // Quick altitude changes (< 30 sec) are more likely posture changes
                // Slow changes might be terrain
                const isQuickChange = dt < 30;

                transitions.push({
                    tSec: curr.tSec,
                    altChange: altChange,
                    fromAlt: prev.altitude,
                    toAlt: curr.altitude,
                    direction: altChange > 0 ? 'standing_up' : 'lying_down',
                    confidence: isQuickChange ? 0.85 : 0.6,
                    duration: dt
                });
            }
        }

        const altitudeRange = maxAltitude - minAltitude;

        return {
            enabled: true,
            transitions: transitions,
            validAltitudeCount: validAltitudeCount,
            totalSamples: samples.length,
            altitudeCoverage: samples.length > 0 ? validAltitudeCount / samples.length : 0,
            minAltitude: minAltitude === Infinity ? null : minAltitude,
            maxAltitude: maxAltitude === -Infinity ? null : maxAltitude,
            altitudeRange: altitudeRange === -Infinity ? 0 : altitudeRange,
            avgAltitudeChange: validAltitudeCount > 0 ? totalAltitudeChange / validAltitudeCount : 0,
            standingUpCount: transitions.filter(t => t.direction === 'standing_up').length,
            lyingDownCount: transitions.filter(t => t.direction === 'lying_down').length
        };
    }

    /**
     * Cross-validate accelerometer posture with altitude changes.
     * Returns validation score and any discrepancies.
     *
     * @param {Object} accPosture - Accelerometer-based posture result
     * @param {Object} altTransition - Recent altitude transition (if any)
     * @param {number} timeSinceTransition - Seconds since last altitude transition
     * @returns {Object} - Validation result
     */
    function crossValidatePostureWithAltitude(accPosture, altTransition, timeSinceTransition) {
        if (!altTransition || timeSinceTransition > 60) {
            // No recent altitude transition to compare
            return {
                validated: false,
                reason: 'no_recent_altitude_data',
                accPosture: accPosture.posture,
                confidence: accPosture.confidence
            };
        }

        const expectedPosture = altTransition.direction === 'standing_up' ? 'standing' : 'lying';
        const match = accPosture.posture === expectedPosture;

        return {
            validated: true,
            match: match,
            accPosture: accPosture.posture,
            altitudeExpected: expectedPosture,
            altChange: altTransition.altChange,
            confidence: match ?
                Math.min(1, accPosture.confidence + 0.15) :
                Math.max(0.3, accPosture.confidence - 0.25),
            discrepancy: match ? null : {
                accSays: accPosture.posture,
                altitudeSays: expectedPosture,
                severity: Math.abs(altTransition.altChange) > 1.0 ? 'high' : 'medium'
            }
        };
    }

    /**
     * Analyze FMB920 measurement alternation patterns.
     * FMB920 alternates between GPS and accelerometer - zeros are normal, not errors.
     *
     * @param {Array} samples - Array of samples
     * @returns {Object} - Technical analysis of measurement patterns
     */
    function analyzeFMB920MeasurementPatterns(samples) {
        let gpsZeroCount = 0;
        let accZeroCount = 0;
        let bothValidCount = 0;
        let bothZeroCount = 0;

        for (const s of samples) {
            const gpsValid = s.lat !== 0 && s.lon !== 0;
            const accValid = s.accX !== null && s.accY !== null && s.accZ !== null &&
                            (s.accX !== 0 || s.accY !== 0 || s.accZ !== 0);

            if (gpsValid && accValid) bothValidCount++;
            else if (!gpsValid && !accValid) bothZeroCount++;
            else if (!gpsValid) gpsZeroCount++;
            else if (!accValid) accZeroCount++;
        }

        const total = samples.length;

        return {
            totalSamples: total,
            bothValidCount: bothValidCount,
            bothValidPct: total > 0 ? (bothValidCount / total * 100).toFixed(1) : 0,
            gpsZeroCount: gpsZeroCount,
            accZeroCount: accZeroCount,
            bothZeroCount: bothZeroCount,
            // This is expected behavior for FMB920, not an error
            measurementAlternationDetected: (gpsZeroCount > 0 || accZeroCount > 0),
            isNormalBehavior: CONFIG.FMB920_MEASUREMENT_ALTERNATION,
            note: 'FMB920 alternates GPS/ACC measurements - zeros are normal device behavior, not errors'
        };
    }

    /**
     * Enhanced cross-validation combining GPS, ACC, and Altitude.
     * Provides comprehensive validation with FMB920 technical context.
     *
     * @param {Object} gpsResult - GPS movement classification
     * @param {Object} accResult - Accelerometer movement classification
     * @param {Object} accPosture - Accelerometer posture classification
     * @param {Object} altitudeContext - Altitude data context (optional)
     * @returns {Object} - Enhanced cross-validation result
     */
    function enhancedCrossValidation(gpsResult, accResult, accPosture, altitudeContext) {
        // Start with standard cross-validation
        const baseResult = crossValidateBehavior(gpsResult, accResult, accPosture);

        // Enhance with altitude validation if available
        if (altitudeContext && altitudeContext.recentTransition) {
            const altValidation = crossValidatePostureWithAltitude(
                accPosture,
                altitudeContext.recentTransition,
                altitudeContext.timeSinceTransition
            );

            if (altValidation.validated) {
                baseResult.altitudeValidation = altValidation;

                if (altValidation.match) {
                    baseResult.confidence = Math.min(1, baseResult.confidence + 0.1);
                    baseResult.consistency = 'triple_validated';
                } else if (altValidation.discrepancy) {
                    // Altitude disagrees - flag for review
                    baseResult.altitudeDiscrepancy = altValidation.discrepancy;
                    baseResult.consistency = 'altitude_mismatch';
                }
            }
        }

        // Add FMB920 technical context
        baseResult.fmb920Context = {
            measurementAlternation: CONFIG.FMB920_MEASUREMENT_ALTERNATION,
            zeroValuesNormal: CONFIG.FMB920_ZERO_VALUE_ACCEPTABLE
        };

        return baseResult;
    }

    // ============================================================
    // GPS OUTAGE DETECTION ENGINE
    // ============================================================
    // Statistical engine to differentiate REAL GPS outages from normal
    // FMB920 measurement alternation behavior
    //
    // Key insight: FMB920 alternates GPS/ACC measurements - zeros are NORMAL
    // Real outages have distinct statistical signatures:
    // 1. Satellite count degradation pattern
    // 2. Altitude consistency during outage
    // 3. Position drift characteristics
    // 4. Recovery pattern after outage
    // 5. Proximity to known interference sources (metal buildings)
    // ============================================================

    /**
     * GPS Outage Detection Configuration
     */
    const GPS_OUTAGE_CONFIG = {
        // Metal building location (potential interference source)
        METAL_BUILDING_COORDS: [
            [50.950510173215505, 14.568739603571592],
            [50.95053966436408, 14.568621322124363],
            [50.95048728420283, 14.568566952125042],
            [50.95050988754958, 14.56850351058424]
        ],
        METAL_BUILDING_INFLUENCE_RADIUS_M: 25,  // Radius where building might affect GPS

        // Statistical thresholds for outage classification
        MIN_SATELLITES_GOOD: 8,                  // Normal operation
        MIN_SATELLITES_DEGRADED: 5,              // Degraded but functional
        MIN_SATELLITES_CRITICAL: 3,              // Critical - likely outage

        // FMB920 Normal Behavior Patterns
        FMB920_NORMAL_ZERO_MAX_DURATION_SEC: 10, // Normal GPS/ACC alternation zeros
        FMB920_MEASUREMENT_INTERVAL_SEC: 2,      // Expected measurement interval

        // Real Outage Characteristics
        REAL_OUTAGE_MIN_DURATION_SEC: 30,        // Min duration to consider real outage
        REAL_OUTAGE_SATELLITE_DROP_RATE: 0.5,    // Satellite count drops >50%

        // Position drift thresholds
        NORMAL_POSITION_DRIFT_M: 15,             // Normal GPS noise
        OUTAGE_POSITION_DRIFT_M: 50,             // Significant drift indicates issue

        // Altitude consistency
        ALTITUDE_VARIANCE_THRESHOLD_M: 20,       // Normal altitude variance

        // Recovery patterns
        RECOVERY_SATELLITE_INCREASE_MIN: 4,      // Satellites gained during recovery
        RECOVERY_TIME_THRESHOLD_SEC: 120,        // Time to recover after outage

        // ===== OUTLIER FILTERING =====
        // Altitude outlier detection (Czech Republic terrain is 115-1602m)
        ALTITUDE_MIN_VALID_M: 50,               // Minimum realistic altitude
        ALTITUDE_MAX_VALID_M: 800,              // Maximum realistic altitude for Rumburk area (~350m ± variance)

        // Position outlier detection
        MAX_POSITION_JUMP_M: 500,                // Max realistic position change between consecutive samples

        // Coordinates validity (Czech Republic bounding box)
        LAT_MIN: 48.5,
        LAT_MAX: 51.1,
        LON_MIN: 12.0,
        LON_MAX: 18.9
    };

    /**
     * Filter outliers from altitude data using IQR method
     */
    function filterAltitudeOutliers(altitudes) {
        if (!altitudes || altitudes.length === 0) return [];

        // Method 1: Range filter
        let filtered = altitudes.filter(a =>
            a > GPS_OUTAGE_CONFIG.ALTITUDE_MIN_VALID_M &&
            a < GPS_OUTAGE_CONFIG.ALTITUDE_MAX_VALID_M
        );

        if (filtered.length < 3) return filtered;

        // Method 2: IQR-based outlier removal
        const sorted = [...filtered].sort((a, b) => a - b);
        const q1Idx = Math.floor(sorted.length * 0.25);
        const q3Idx = Math.floor(sorted.length * 0.75);
        const q1 = sorted[q1Idx];
        const q3 = sorted[q3Idx];
        const iqr = q3 - q1;
        const lowerBound = q1 - 1.5 * iqr;
        const upperBound = q3 + 1.5 * iqr;

        filtered = filtered.filter(a => a >= lowerBound && a <= upperBound);

        return filtered;
    }

    /**
     * Filter position outliers (detect GPS jumps)
     */
    function filterPositionOutliers(positions) {
        if (!positions || positions.length < 2) return positions;

        const filtered = [positions[0]];

        for (let i = 1; i < positions.length; i++) {
            const prev = filtered[filtered.length - 1];
            const curr = positions[i];

            // Skip if coordinates are invalid
            if (!curr.lat || !curr.lon || curr.lat === 0 || curr.lon === 0) continue;

            // Check coordinate validity (Czech Republic bounds)
            if (curr.lat < GPS_OUTAGE_CONFIG.LAT_MIN || curr.lat > GPS_OUTAGE_CONFIG.LAT_MAX ||
                curr.lon < GPS_OUTAGE_CONFIG.LON_MIN || curr.lon > GPS_OUTAGE_CONFIG.LON_MAX) {
                continue;
            }

            // Calculate distance from previous point
            const dist = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);

            // Skip if distance is unrealistic (GPS jump/error)
            if (dist > GPS_OUTAGE_CONFIG.MAX_POSITION_JUMP_M) {
                continue;
            }

            filtered.push(curr);
        }

        return filtered;
    }

    /**
     * Calculate center of metal building polygon
     */
    function getMetalBuildingCenter() {
        const coords = GPS_OUTAGE_CONFIG.METAL_BUILDING_COORDS;
        const lat = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
        const lon = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
        return { lat, lon };
    }

    /**
     * Check if a point is near the metal building
     */
    function isNearMetalBuilding(lat, lon) {
        const center = getMetalBuildingCenter();
        const distance = haversineDistance(lat, lon, center.lat, center.lon);
        return {
            isNear: distance <= GPS_OUTAGE_CONFIG.METAL_BUILDING_INFLUENCE_RADIUS_M,
            distance: distance,
            buildingCenter: center
        };
    }

    /**
     * Analyze satellite count pattern for a sequence of samples
     * @param {Array} samples - Array of samples with satellites field
     * @returns {Object} - Satellite pattern analysis
     */
    function analyzeSatellitePattern(samples) {
        if (!samples || samples.length === 0) {
            return { valid: false, reason: 'no_samples' };
        }

        const sats = samples.map(s => s.satellites || s.gps_satellites || 0);
        const validSats = sats.filter(s => s > 0);

        if (validSats.length === 0) {
            return {
                valid: true,
                pattern: 'all_zero',
                avgSatellites: 0,
                minSatellites: 0,
                maxSatellites: 0,
                zeroCount: sats.length,
                zeroPct: 100,
                degradationEvents: [],
                status: 'critical'
            };
        }

        const avgSat = validSats.reduce((a, b) => a + b, 0) / validSats.length;
        const minSat = Math.min(...validSats);
        const maxSat = Math.max(...validSats);
        const zeroCount = sats.filter(s => s === 0).length;
        const zeroPct = (zeroCount / sats.length) * 100;

        // Detect degradation events (sudden satellite drops)
        const degradationEvents = [];
        for (let i = 1; i < sats.length; i++) {
            const prev = sats[i - 1];
            const curr = sats[i];
            if (prev > 0 && curr > 0) {
                const dropPct = (prev - curr) / prev;
                if (dropPct >= GPS_OUTAGE_CONFIG.REAL_OUTAGE_SATELLITE_DROP_RATE) {
                    degradationEvents.push({
                        index: i,
                        from: prev,
                        to: curr,
                        dropPct: dropPct * 100
                    });
                }
            }
        }

        // Determine status
        let status = 'good';
        if (avgSat < GPS_OUTAGE_CONFIG.MIN_SATELLITES_CRITICAL) {
            status = 'critical';
        } else if (avgSat < GPS_OUTAGE_CONFIG.MIN_SATELLITES_DEGRADED) {
            status = 'degraded';
        } else if (avgSat < GPS_OUTAGE_CONFIG.MIN_SATELLITES_GOOD) {
            status = 'marginal';
        }

        return {
            valid: true,
            pattern: degradationEvents.length > 0 ? 'degradation_detected' : 'stable',
            avgSatellites: avgSat,
            minSatellites: minSat,
            maxSatellites: maxSat,
            zeroCount,
            zeroPct,
            degradationEvents,
            status
        };
    }

    /**
     * Analyze position drift during a potential outage period
     * Uses outlier filtering to remove GPS jumps/errors (e.g., 18km jumps)
     * @param {Array} samples - Array of samples with lat/lon
     * @returns {Object} - Position drift analysis
     */
    function analyzePositionDrift(samples) {
        if (!samples || samples.length < 2) {
            return { valid: false, reason: 'insufficient_samples' };
        }

        // First get raw valid positions (non-zero coords)
        const rawValidPositions = samples.filter(s =>
            s.lat && s.lon && s.lat !== 0 && s.lon !== 0
        );

        if (rawValidPositions.length < 2) {
            return { valid: false, reason: 'no_valid_positions' };
        }

        // Apply outlier filtering (removes GPS jumps > 500m, out-of-bounds coords)
        const validPositions = filterPositionOutliers(rawValidPositions);
        const outliersRemoved = rawValidPositions.length - validPositions.length;

        if (validPositions.length < 2) {
            return {
                valid: true,
                pattern: 'all_outliers',
                outlierStats: {
                    rawCount: rawValidPositions.length,
                    filteredCount: validPositions.length,
                    outliersRemoved: outliersRemoved
                }
            };
        }

        // Calculate distances between consecutive points (after filtering)
        const drifts = [];
        for (let i = 1; i < validPositions.length; i++) {
            const dist = haversineDistance(
                validPositions[i - 1].lat, validPositions[i - 1].lon,
                validPositions[i].lat, validPositions[i].lon
            );
            drifts.push(dist);
        }

        // Calculate bounding box drift (after filtering)
        const lats = validPositions.map(p => p.lat);
        const lons = validPositions.map(p => p.lon);
        const latRange = Math.max(...lats) - Math.min(...lats);
        const lonRange = Math.max(...lons) - Math.min(...lons);
        const boundingBoxDiagonal = haversineDistance(
            Math.min(...lats), Math.min(...lons),
            Math.max(...lats), Math.max(...lons)
        );

        const avgDrift = drifts.length > 0 ? drifts.reduce((a, b) => a + b, 0) / drifts.length : 0;
        const maxDrift = drifts.length > 0 ? Math.max(...drifts) : 0;

        // Determine if drift is abnormal (using filtered data)
        const isAbnormal = boundingBoxDiagonal > GPS_OUTAGE_CONFIG.OUTAGE_POSITION_DRIFT_M ||
                          maxDrift > GPS_OUTAGE_CONFIG.OUTAGE_POSITION_DRIFT_M;

        return {
            valid: true,
            avgDriftM: avgDrift,
            maxDriftM: maxDrift,
            boundingBoxDiagonalM: boundingBoxDiagonal,
            latRangeDeg: latRange,
            lonRangeDeg: lonRange,
            isAbnormal,
            classification: isAbnormal ? 'high_drift' : 'normal',
            outlierStats: {
                rawCount: rawValidPositions.length,
                filteredCount: validPositions.length,
                outliersRemoved: outliersRemoved
            }
        };
    }

    /**
     * Analyze altitude consistency during potential outage
     * Uses outlier filtering to remove GPS errors (e.g., 14820m readings)
     * @param {Array} samples - Array of samples with altitude
     * @returns {Object} - Altitude consistency analysis
     */
    function analyzeAltitudeConsistency(samples) {
        if (!samples || samples.length === 0) {
            return { valid: false, reason: 'no_samples' };
        }

        // Extract raw altitude values (before filtering)
        const rawAlts = samples
            .map(s => s.altitude || s.gps_altitude || 0)
            .filter(a => a > 0);

        if (rawAlts.length === 0) {
            return {
                valid: true,
                hasAltitude: false,
                zeroCount: samples.length,
                pattern: 'no_altitude_data',
                outlierStats: { rawCount: 0, filteredCount: 0, outliersRemoved: 0 }
            };
        }

        // Apply outlier filtering (removes values like 14820m)
        const alts = filterAltitudeOutliers(rawAlts);
        const outliersRemoved = rawAlts.length - alts.length;

        if (alts.length === 0) {
            return {
                valid: true,
                hasAltitude: true,
                pattern: 'all_outliers',
                outlierStats: {
                    rawCount: rawAlts.length,
                    filteredCount: 0,
                    outliersRemoved: outliersRemoved,
                    rawMin: Math.min(...rawAlts),
                    rawMax: Math.max(...rawAlts)
                }
            };
        }

        const avg = alts.reduce((a, b) => a + b, 0) / alts.length;
        const variance = alts.reduce((sum, a) => sum + Math.pow(a - avg, 2), 0) / alts.length;
        const stdDev = Math.sqrt(variance);

        const isConsistent = stdDev < GPS_OUTAGE_CONFIG.ALTITUDE_VARIANCE_THRESHOLD_M;

        return {
            valid: true,
            hasAltitude: true,
            avgAltitude: avg,
            minAltitude: Math.min(...alts),
            maxAltitude: Math.max(...alts),
            stdDev,
            variance,
            validCount: alts.length,
            zeroCount: samples.length - rawAlts.length,
            isConsistent,
            pattern: isConsistent ? 'stable' : 'variable',
            outlierStats: {
                rawCount: rawAlts.length,
                filteredCount: alts.length,
                outliersRemoved: outliersRemoved,
                rawMin: Math.min(...rawAlts),
                rawMax: Math.max(...rawAlts)
            }
        };
    }

    /**
     * Detect zero-value sequences (potential outages or FMB920 alternation)
     * @param {Array} samples - Samples with timestamps and satellite data
     * @returns {Array} - Array of zero sequences with metadata
     */
    function detectZeroSequences(samples) {
        if (!samples || samples.length === 0) return [];

        const sequences = [];
        let currentSeq = null;

        for (let i = 0; i < samples.length; i++) {
            const s = samples[i];
            const sats = s.satellites || s.gps_satellites || 0;
            const alt = s.altitude || s.gps_altitude || 0;
            const isZero = sats === 0 || alt === 0;

            if (isZero) {
                if (!currentSeq) {
                    currentSeq = {
                        startIndex: i,
                        startTime: s.timestamp || s.deviceTimestamp,
                        samples: [s],
                        hasAccData: s.acc_x !== undefined || s.accX !== undefined
                    };
                } else {
                    currentSeq.samples.push(s);
                    currentSeq.hasAccData = currentSeq.hasAccData ||
                                           (s.acc_x !== undefined || s.accX !== undefined);
                }
            } else {
                if (currentSeq) {
                    currentSeq.endIndex = i - 1;
                    currentSeq.endTime = samples[i - 1].timestamp || samples[i - 1].deviceTimestamp;
                    currentSeq.count = currentSeq.samples.length;

                    // Calculate duration
                    const startTs = new Date(currentSeq.startTime).getTime();
                    const endTs = new Date(currentSeq.endTime).getTime();
                    currentSeq.durationSec = (endTs - startTs) / 1000;

                    sequences.push(currentSeq);
                    currentSeq = null;
                }
            }
        }

        // Handle sequence that extends to end
        if (currentSeq) {
            currentSeq.endIndex = samples.length - 1;
            currentSeq.endTime = samples[samples.length - 1].timestamp ||
                                samples[samples.length - 1].deviceTimestamp;
            currentSeq.count = currentSeq.samples.length;

            const startTs = new Date(currentSeq.startTime).getTime();
            const endTs = new Date(currentSeq.endTime).getTime();
            currentSeq.durationSec = (endTs - startTs) / 1000;

            sequences.push(currentSeq);
        }

        return sequences;
    }

    /**
     * Classify a zero sequence as FMB920 normal behavior or real outage
     * @param {Object} sequence - Zero sequence from detectZeroSequences
     * @param {Object} context - Contextual information (nearby satellites, position, etc.)
     * @returns {Object} - Classification result with confidence and reasoning
     */
    function classifyZeroSequence(sequence, context) {
        const classification = {
            type: null,
            confidence: 0,
            reasons: [],
            statistics: {}
        };

        // 1. Duration check - short zeros are likely FMB920 alternation
        if (sequence.durationSec <= GPS_OUTAGE_CONFIG.FMB920_NORMAL_ZERO_MAX_DURATION_SEC) {
            classification.type = 'fmb920_normal';
            classification.reasons.push(`Short duration (${sequence.durationSec.toFixed(1)}s) matches FMB920 alternation pattern`);
            classification.confidence += 0.4;
        } else {
            classification.reasons.push(`Duration ${sequence.durationSec.toFixed(1)}s exceeds normal FMB920 alternation`);
        }

        // 2. Check if accelerometer data present during GPS zeros
        if (sequence.hasAccData) {
            classification.reasons.push('Accelerometer data present during GPS zeros - typical FMB920 behavior');
            if (!classification.type) {
                classification.type = 'fmb920_normal';
            }
            classification.confidence += 0.2;
        }

        // 3. Check satellite pattern before/after
        if (context && context.beforeSatellites && context.afterSatellites) {
            const satDrop = context.beforeSatellites - context.afterSatellites;
            const recoveryTime = context.recoveryTime || 0;

            if (Math.abs(satDrop) <= 2 && context.afterSatellites >= GPS_OUTAGE_CONFIG.MIN_SATELLITES_GOOD) {
                classification.reasons.push(`Quick satellite recovery (${context.afterSatellites} sats) - normal behavior`);
                if (!classification.type) classification.type = 'fmb920_normal';
                classification.confidence += 0.2;
            } else if (context.afterSatellites < GPS_OUTAGE_CONFIG.MIN_SATELLITES_DEGRADED) {
                classification.reasons.push(`Poor satellite recovery (${context.afterSatellites} sats) - indicates real GPS issue`);
                classification.type = 'real_outage';
                classification.confidence += 0.3;
            }
        }

        // 4. Check proximity to metal building
        if (context && context.nearMetalBuilding) {
            classification.reasons.push(`Near metal building (${context.buildingDistance.toFixed(1)}m) - possible interference`);
            if (sequence.durationSec > GPS_OUTAGE_CONFIG.FMB920_NORMAL_ZERO_MAX_DURATION_SEC) {
                classification.type = 'building_interference';
                classification.confidence += 0.3;
            }
        }

        // 5. Duration-based escalation for longer outages
        if (sequence.durationSec > GPS_OUTAGE_CONFIG.REAL_OUTAGE_MIN_DURATION_SEC) {
            if (classification.type !== 'building_interference') {
                classification.type = 'real_outage';
            }
            classification.reasons.push(`Extended duration (${sequence.durationSec.toFixed(0)}s) suggests real GPS outage`);
            classification.confidence += 0.2;
        }

        // Default classification if still undetermined
        if (!classification.type) {
            if (sequence.durationSec <= GPS_OUTAGE_CONFIG.FMB920_NORMAL_ZERO_MAX_DURATION_SEC * 2) {
                classification.type = 'fmb920_normal';
                classification.reasons.push('Default classification: within extended FMB920 tolerance');
            } else {
                classification.type = 'undetermined';
                classification.reasons.push('Unable to definitively classify');
            }
        }

        classification.confidence = Math.min(1, classification.confidence);
        classification.statistics = {
            durationSec: sequence.durationSec,
            sampleCount: sequence.count,
            hasAccData: sequence.hasAccData
        };

        return classification;
    }

    /**
     * Main GPS Outage Detection Engine
     * Analyzes a dataset and returns comprehensive outage analysis
     * @param {Array} samples - Raw GPS/ACC samples
     * @param {Object} options - Analysis options
     * @returns {Object} - Complete outage analysis
     */
    function GPSOutageDetectionEngine(samples, options = {}) {
        if (!samples || samples.length === 0) {
            return {
                valid: false,
                reason: 'no_samples',
                summary: null
            };
        }

        const analysis = {
            valid: true,
            timestamp: new Date().toISOString(),
            totalSamples: samples.length,

            // Overall statistics
            satellitePattern: null,
            positionDrift: null,
            altitudeConsistency: null,

            // Zero sequence analysis
            zeroSequences: [],
            classifiedSequences: [],

            // Summary
            summary: {
                totalOutages: 0,
                realOutages: 0,
                fmb920NormalEvents: 0,
                buildingInterferenceEvents: 0,
                undeterminedEvents: 0,
                totalOutageTimeSec: 0,
                realOutageTimeSec: 0,
                nearBuildingEvents: 0
            }
        };

        // 1. Analyze overall satellite pattern
        analysis.satellitePattern = analyzeSatellitePattern(samples);

        // 2. Analyze position drift
        analysis.positionDrift = analyzePositionDrift(samples);

        // 3. Analyze altitude consistency
        analysis.altitudeConsistency = analyzeAltitudeConsistency(samples);

        // 4. Detect zero sequences
        analysis.zeroSequences = detectZeroSequences(samples);

        // 5. Classify each zero sequence
        for (let i = 0; i < analysis.zeroSequences.length; i++) {
            const seq = analysis.zeroSequences[i];

            // Build context from surrounding samples
            const context = {};

            // Satellites before
            if (seq.startIndex > 0) {
                const beforeSample = samples[seq.startIndex - 1];
                context.beforeSatellites = beforeSample.satellites || beforeSample.gps_satellites || 0;
            }

            // Satellites after
            if (seq.endIndex < samples.length - 1) {
                const afterSample = samples[seq.endIndex + 1];
                context.afterSatellites = afterSample.satellites || afterSample.gps_satellites || 0;
            }

            // Check building proximity
            const firstSample = seq.samples[0];
            if (firstSample.lat && firstSample.lon) {
                const buildingCheck = isNearMetalBuilding(firstSample.lat, firstSample.lon);
                context.nearMetalBuilding = buildingCheck.isNear;
                context.buildingDistance = buildingCheck.distance;
            }

            const classification = classifyZeroSequence(seq, context);
            analysis.classifiedSequences.push({
                sequence: seq,
                classification,
                context
            });

            // Update summary
            analysis.summary.totalOutages++;
            analysis.summary.totalOutageTimeSec += seq.durationSec;

            switch (classification.type) {
                case 'real_outage':
                    analysis.summary.realOutages++;
                    analysis.summary.realOutageTimeSec += seq.durationSec;
                    break;
                case 'fmb920_normal':
                    analysis.summary.fmb920NormalEvents++;
                    break;
                case 'building_interference':
                    analysis.summary.buildingInterferenceEvents++;
                    analysis.summary.realOutageTimeSec += seq.durationSec;
                    break;
                default:
                    analysis.summary.undeterminedEvents++;
            }

            if (context.nearMetalBuilding) {
                analysis.summary.nearBuildingEvents++;
            }
        }

        // Calculate percentages
        if (analysis.summary.totalOutages > 0) {
            analysis.summary.fmb920NormalPct =
                (analysis.summary.fmb920NormalEvents / analysis.summary.totalOutages * 100).toFixed(1);
            analysis.summary.realOutagePct =
                ((analysis.summary.realOutages + analysis.summary.buildingInterferenceEvents) /
                 analysis.summary.totalOutages * 100).toFixed(1);
        }

        // Determine overall GPS health
        const realOutagePct = parseFloat(analysis.summary.realOutagePct) || 0;
        if (realOutagePct < 5 && analysis.satellitePattern.status !== 'critical') {
            analysis.summary.overallHealth = 'good';
            analysis.summary.healthDescription = 'GPS functioning normally, zero events are FMB920 measurement alternation';
        } else if (realOutagePct < 20 && analysis.satellitePattern.status !== 'critical') {
            analysis.summary.overallHealth = 'acceptable';
            analysis.summary.healthDescription = 'Occasional GPS issues detected, mostly near metal building';
        } else {
            analysis.summary.overallHealth = 'degraded';
            analysis.summary.healthDescription = 'Significant GPS issues detected, investigation recommended';
        }

        return analysis;
    }

    /**
     * Convenience function to analyze GPS outages from raw data
     */
    function analyzeGPSOutages(rawData, options = {}) {
        // Convert raw data to expected format if needed
        const samples = rawData.map(row => ({
            timestamp: row.deviceTimestamp || row.timestamp,
            lat: parseFloat(row.gps_lat || row.lat) || 0,
            lon: parseFloat(row.gps_lon || row.lon) || 0,
            altitude: parseFloat(row.gps_altitude || row.altitude) || 0,
            satellites: parseInt(row.gps_satellites || row.satellites) || 0,
            speed: parseFloat(row.gps_speedKph || row.speed) || 0,
            acc_x: parseFloat(row.acc_x || row.accX) || 0,
            acc_y: parseFloat(row.acc_y || row.accY) || 0,
            acc_z: parseFloat(row.acc_z || row.accZ) || 0
        }));

        return GPSOutageDetectionEngine(samples, options);
    }

    // ============================================================
    // ZONE CLUSTERING
    // ============================================================

    function getDurationBucket(totalDtSec) {
        if (totalDtSec < 300) return 0;       // 3-5 min
        if (totalDtSec < 600) return 1;       // 5-10 min
        if (totalDtSec < 900) return 2;       // 10-15 min
        return 3;                              // 15+ min
    }

    function clusterDwellZones(points, minDuration) {
        if (typeof minDuration === 'undefined') minDuration = CONFIG.STANDING_ZONE_MIN_DURATION_SEC;
        if (!points || points.length === 0) return [];

        const clusters = [];
        const clusterRadius = CONFIG.CLUSTER_RADIUS_M;

        for (const p of points) {
            let bestDist = Infinity;
            let bestIdx = -1;
            for (let i = 0; i < clusters.length; i++) {
                const d = haversineDistance(p.lat, p.lon, clusters[i].lat, clusters[i].lon);
                if (d < bestDist) {
                    bestDist = d;
                    bestIdx = i;
                }
            }

            if (bestDist <= clusterRadius && bestIdx >= 0) {
                const c = clusters[bestIdx];
                const totalSamples = c.samples + 1;
                c.lat = (c.lat * c.samples + p.lat) / totalSamples;
                c.lon = (c.lon * c.samples + p.lon) / totalSamples;
                c.totalDt += p.dt;
                c.samples = totalSamples;
                if (p.startSec !== undefined) {
                    c.startSec = Math.min(c.startSec, p.startSec);
                    c.endSec = Math.max(c.endSec, p.endSec || p.startSec + p.dt);
                }
            } else {
                clusters.push({
                    lat: p.lat,
                    lon: p.lon,
                    totalDt: p.dt,
                    samples: 1,
                    startSec: p.startSec !== undefined ? p.startSec : 0,
                    endSec: p.endSec !== undefined ? p.endSec : (p.startSec !== undefined ? p.startSec + p.dt : p.dt)
                });
            }
        }

        return clusters
            .filter(c => c.totalDt >= minDuration)
            .sort((a, b) => b.totalDt - a.totalDt);
    }

    function detectStandingZones(intervals, timeFilter) {
        let standingPoints = intervals
            .filter(it => !it.isWalking && it.finalBehavior && it.finalBehavior.posture === 'standing');

        if (timeFilter === 'day') {
            standingPoints = standingPoints.filter(it => it.midSec >= CONFIG.DAY_START_SEC && it.midSec < CONFIG.DAY_END_SEC);
        } else if (timeFilter === 'night') {
            standingPoints = standingPoints.filter(it => it.midSec < CONFIG.DAY_START_SEC || it.midSec >= CONFIG.DAY_END_SEC);
        }

        return clusterDwellZones(
            standingPoints.map(it => ({ lat: it.lat, lon: it.lon, dt: it.dt, startSec: it.startSec, endSec: it.endSec })),
            CONFIG.STANDING_ZONE_MIN_DURATION_SEC
        );
    }

    function detectLyingZones(points, timeFilter) {
        let filteredPoints = points;

        if (timeFilter === 'day') {
            filteredPoints = points.filter(p => p.midSec >= CONFIG.DAY_START_SEC && p.midSec < CONFIG.DAY_END_SEC);
        } else if (timeFilter === 'night') {
            filteredPoints = points.filter(p => p.midSec < CONFIG.DAY_START_SEC || p.midSec >= CONFIG.DAY_END_SEC);
        }

        return clusterDwellZones(filteredPoints);
    }

    // ============================================================
    // ISOLATION DETECTION
    // ============================================================

    function detectIsolationEvents(intervals, facilityCenter) {
        const events = [];
        let currentEvent = null;

        for (const it of intervals) {
            const distFromCenter = haversineDistance(it.lat, it.lon, facilityCenter[0], facilityCenter[1]);

            if (distFromCenter > CONFIG.ISOLATION_DISTANCE_THRESHOLD_M) {
                if (!currentEvent) {
                    currentEvent = {
                        startSec: it.startSec,
                        endSec: it.endSec,
                        maxDistance: distFromCenter,
                        points: [[it.lat, it.lon]]
                    };
                } else {
                    currentEvent.endSec = it.endSec;
                    currentEvent.maxDistance = Math.max(currentEvent.maxDistance, distFromCenter);
                    currentEvent.points.push([it.lat, it.lon]);
                }
            } else {
                if (currentEvent) {
                    currentEvent.duration = currentEvent.endSec - currentEvent.startSec;
                    if (currentEvent.duration >= CONFIG.ISOLATION_DURATION_THRESHOLD_SEC) {
                        events.push(currentEvent);
                    }
                    currentEvent = null;
                }
            }
        }

        if (currentEvent) {
            currentEvent.duration = currentEvent.endSec - currentEvent.startSec;
            if (currentEvent.duration >= CONFIG.ISOLATION_DURATION_THRESHOLD_SEC) {
                events.push(currentEvent);
            }
        }

        return events;
    }

    // ============================================================
    // PERIMETER OUTLIER DETECTION
    // ============================================================

    function collectPerimeterOutliers(intervals) {
        const crossings = { fenceI_II: [], fenceII_III: [] };
        let lastZone = null;

        for (const it of intervals) {
            const zone = getZoneLabel(it.lat, it.lon);

            if (lastZone && zone !== lastZone) {
                if ((lastZone === 'I' && zone === 'II') || (lastZone === 'II' && zone === 'I')) {
                    crossings.fenceI_II.push({
                        time: it.midSec,
                        from: lastZone,
                        to: zone,
                        lat: it.lat,
                        lon: it.lon
                    });
                }
                if ((lastZone === 'II' && zone === 'III') || (lastZone === 'III' && zone === 'II')) {
                    crossings.fenceII_III.push({
                        time: it.midSec,
                        from: lastZone,
                        to: zone,
                        lat: it.lat,
                        lon: it.lon
                    });
                }
            }
            lastZone = zone;
        }

        return crossings;
    }

    // ============================================================
    // VECTOR ANALYSIS
    // ============================================================

    function averageDirection(intervals, fromSec, toSec) {
        const filtered = intervals.filter(it => it.midSec >= fromSec && it.midSec < toSec && it.bearingDeg !== null);
        if (filtered.length === 0) return { dir: '-', avgBearing: null };

        let sinSum = 0, cosSum = 0;
        for (const it of filtered) {
            const rad = it.bearingDeg * Math.PI / 180;
            sinSum += Math.sin(rad);
            cosSum += Math.cos(rad);
        }

        const avgRad = Math.atan2(sinSum, cosSum);
        const avgDeg = (avgRad * 180 / Math.PI + 360) % 360;

        return { dir: direction8(avgDeg), avgBearing: avgDeg };
    }

    // ============================================================
    // HOURLY DATA
    // ============================================================

    function addDurationToHourly(hourly, midSec, behavior, dt) {
        const hour = Math.floor(midSec / 3600) % 24;
        if (hour >= 0 && hour < 24 && hourly[hour]) {
            hourly[hour][behavior] = (hourly[hour][behavior] || 0) + dt;
        }
    }

    function computeBins2h(values, midSecs, dts) {
        const bins = Array.from({ length: 12 }, () => ({ sum: 0, weight: 0 }));
        for (let i = 0; i < values.length; i++) {
            if (values[i] === null || !Number.isFinite(values[i])) continue;
            const hour = Math.floor(midSecs[i] / 3600) % 24;
            const bin = Math.floor(hour / 2);
            bins[bin].sum += values[i] * dts[i];
            bins[bin].weight += dts[i];
        }
        return bins.map(b => b.weight > 0 ? b.sum / b.weight : 0);
    }

    // ============================================================
    // BREEDING STATUS
    // ============================================================

    function calculateBreedingStatus(calvingDateStr, analysisDateStr) {
        if (!calvingDateStr) return null;

        const parseDate = (str) => {
            if (!str) return null;
            if (str.includes('-')) {
                const parts = str.split('-');
                return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            }
            if (str.length === 6) {
                const d = parseInt(str.substring(0, 2));
                const m = parseInt(str.substring(2, 4)) - 1;
                const y = 2000 + parseInt(str.substring(4, 6));
                return new Date(y, m, d);
            }
            return null;
        };

        const calvingDate = parseDate(calvingDateStr);
        const analysisDate = parseDate(analysisDateStr);

        if (!calvingDate || !analysisDate) return null;

        const daysSinceCalving = Math.floor((analysisDate - calvingDate) / (24 * 60 * 60 * 1000));

        if (daysSinceCalving < 0) {
            return { status: 'before_calving', daysSinceCalving };
        }

        if (daysSinceCalving < 45) {
            return {
                status: 'postpartum_recovery',
                daysSinceCalving,
                daysUntilFertile: 45 - daysSinceCalving
            };
        }

        const conceptionDate = new Date(calvingDate);
        conceptionDate.setDate(conceptionDate.getDate() + 60);

        const dueDate = new Date(conceptionDate);
        dueDate.setDate(dueDate.getDate() + CONFIG.GESTATION_DAYS);

        const gestationDay = Math.floor((analysisDate - conceptionDate) / (24 * 60 * 60 * 1000));
        const daysToParturition = Math.floor((dueDate - analysisDate) / (24 * 60 * 60 * 1000));

        let trimester = 1;
        if (gestationDay > 190) trimester = 3;
        else if (gestationDay > 95) trimester = 2;

        return {
            status: 'likely_pregnant',
            daysSinceCalving,
            gestationDay: Math.max(0, gestationDay),
            trimester,
            daysToParturition: Math.max(0, daysToParturition),
            estimatedDueDate: dueDate.toISOString().split('T')[0],
            preParturitionAlert: daysToParturition <= 14 && daysToParturition >= 0
        };
    }

    // ============================================================
    // MAIN PROCESSING FUNCTION
    // ============================================================

    /**
     * Process raw dataset and return all computed metrics
     * @param {Array} rawData - Array of raw records from dataset file
     * @param {Object} options - Processing options
     * @param {string} options.calvingDate - Calving date for breeding status (optional)
     * @param {string} options.dateStr - Date string for display (ddmmyy format)
     * @param {Function} options.onProgress - Progress callback (optional)
     * @returns {Object} - Processed results with all metrics
     */
    function processRawData(rawData, options) {
        options = options || {};
        const onProgress = options.onProgress || (() => {});
        const datasetLabel = options.datasetName || options.dateStr || 'unknown';

        if (!Array.isArray(rawData) || rawData.length === 0) {
            return createEmptyResult(options.dateStr || 'unknown');
        }

        onProgress('Parsing samples...');

        // Parse raw data into samples with epoch time for proper sorting
        const rawSamples = [];
        const rawSampleStats = {
            total: 0,
            invalid: 0,
            outsideFence: 0
        };
        for (const r of rawData) {
            rawSampleStats.total++;
            const tSec = parseTimeToSeconds(r.timestamp);
            const lat = safeNumber(r.gps_lat);
            const lon = safeNumber(r.gps_lon);
            const accX = safeNumber(r.acc_x);
            const accY = safeNumber(r.acc_y);
            const accZ = safeNumber(r.acc_z);

            if (tSec === null || lat === null || lon === null) {
                rawSampleStats.invalid++;
                continue;
            }
            if (!isInsideRedFence(lat, lon)) {
                rawSampleStats.outsideFence++;
                continue;
            }

            // Parse date+time for proper chronological sorting
            // This handles midnight crossings correctly
            const epochSec = r.date ? parseDateTimeToEpoch(r.date, r.timestamp) : null;

            const mag = (accX !== null && accY !== null && accZ !== null)
                ? Math.sqrt(accX * accX + accY * accY + accZ * accZ)
                : null;

            rawSamples.push({ tSec, epochSec, lat, lon, accX, accY, accZ, mag, date: r.date, timestamp: r.timestamp });
        }

        // Filter out retry records (out-of-sequence transmissions from FMB920) before sorting
        onProgress('Filtering retry records...');
        let samples = rawSamples;
        let retryFilterStats = null;
        const hasEpochTime = rawSamples.length > 0 && rawSamples[0].epochSec !== null;

        if (hasEpochTime && rawSamples.length > 1) {
            const retryResult = filterRetryRecords(rawSamples, 300); // 5 min max backward jump
            samples = retryResult.filtered.slice();
            retryFilterStats = retryResult.stats;

            if (retryResult.retryRecords.length > 0) {
                console.log(`[Rumburk] Filtered ${retryResult.retryRecords.length} retry records out of ${rawSamples.length}`);
            }
        } else {
            // Clone to avoid mutating original array downstream
            samples = rawSamples.slice();
        }

        // Sort by epoch time if available (handles midnight crossing and multi-day data)
        // Fall back to time-of-day sorting if no date field
        if (hasEpochTime) {
            samples.sort((a, b) => a.epochSec - b.epochSec);
        } else {
            samples.sort((a, b) => a.tSec - b.tSec);
        }

        if (samples.length < 2) {
            return createEmptyResult(options.dateStr || 'unknown');
        }

        const recordCount = rawData.length;

        onProgress('Analyzing StandBy periods...');
        const standByAnalysis = analyzeStandByPeriods(samples);

        onProgress('Resampling to 1Hz...');
        const resampled = resampleTo1Hz(samples);
        const resampledSampleCount = resampled.length;
        const interpolatedCount = resampled.filter(s => s.interpolated).length;

        const postureAnalysis = buildPostureTimeline(resampled);
        const postureSummary = postureAnalysis.summary || { standingSec: 0, lyingSec: 0, transitionSec: 0 };

        onProgress('Classifying behavior...');

        // Initialize counters
        const hourlyData = Array.from({ length: 24 }, () => ({ lying: 0, standing: 0, walking: 0 }));
        const hourlyActivityStats = Array.from({ length: 24 }, () => ({ rmsSum: 0, rmsWeight: 0, energy: 0 }));
        const intervals = [];
        const segments = [];
        const gpsPoints = [];
        const heatPoints = [];
        const gpsPointsDay = [];
        const gpsPointsNight = [];
        const heatPointsDay = [];
        const heatPointsNight = [];
        const lyingPointsForClusters = [];
        const standingPointsForClusters = [];
        const lyingPointsDay = [];
        const lyingPointsNight = [];
        const standingPointsDay = [];
        const standingPointsNight = [];
        const fenceArrowsDay = [];
        const fenceArrowsNight = [];
        const lastArrow = { II: null, III: null };

        let rmsDynSum = 0;
        let rmsDynWeight = 0;
        let energySum = 0;
        let consistencyTime = 0;
        let inconsistentDuration = 0;
        let stepZeroCrossings = 0;
        let stepDuration = 0;

        let totalDistance = 0;
        let dayDistance = 0;
        let nightDistance = 0;
        let lyingTime = 0;
        let standingTime = 0;
        let walkingTime = 0;
        let standByLyingTime = 0;
        let unknownTime = 0;
        let gpsStableTimeTotal = 0;
        let gpsStableStandingTime = 0;
        let gpsStableLyingTime = 0;
        let intervalsConsidered = 0;
        let intervalsSkippedInvalidTime = 0;
        let intervalsSkippedOutsideFence = 0;

        const crossValidationStats = {
            total: 0,
            consistent: 0,
            gpsOverride: 0,
            accOverride: 0,
            uncertain: 0,
            zoneOverride: 0,
            standByIntervals: 0,
            consistentPct: 0,
            standByPct: 0
        };

        // Process intervals
        for (let i = 1; i < resampled.length; i++) {
            const prev = resampled[i - 1];
            const curr = resampled[i];
            const dt = curr.tSec - prev.tSec;

            if (!Number.isFinite(dt) || dt <= 0 || dt > CONFIG.MAX_INTERVAL_SEC) {
                intervalsSkippedInvalidTime++;
                continue;
            }

            intervalsConsidered++;

            const distM = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
            const speedMps = distM / dt;
            const midSec = (prev.tSec + curr.tSec) / 2;
            const isDay = midSec >= CONFIG.DAY_START_SEC && midSec < CONFIG.DAY_END_SEC;
            const distFromCenter = haversineDistance(curr.lat, curr.lon, FACILITY.CENTER[0], FACILITY.CENTER[1]);

            // Bearing
            let bearingDeg = null;
            if (distM > 0.5) {
                bearingDeg = bearingDegrees(prev.lat, prev.lon, curr.lat, curr.lon);
            }

            // Accelerometer processing
            const accX = curr.accX;
            const accY = curr.accY;
            const accZ = curr.accZ;
            let accNorm = null;
            let accAbsUnit = null;
            let dynG = null;

            if (accX !== null && accY !== null && accZ !== null) {
                const n = Math.sqrt(accX * accX + accY * accY + accZ * accZ);
                if (Number.isFinite(n) && n > 1) {
                    accNorm = n;
                    accAbsUnit = [Math.abs(accX) / n, Math.abs(accY) / n, Math.abs(accZ) / n];
                    const normG = n / CONFIG.ACC_SCALE;
                    dynG = Math.max(0, Math.abs(normG - CONFIG.ACC_GRAVITY_G));

                    if (Number.isFinite(dynG)) {
                        rmsDynSum += dynG * dynG * dt;
                        rmsDynWeight += dt;
                        energySum += dynG * dt;

                        const hour = Math.floor(midSec / 3600) % 24;
                        if (hour >= 0 && hour < 24) {
                            hourlyActivityStats[hour].rmsSum += dynG * dynG * dt;
                            hourlyActivityStats[hour].rmsWeight += dt;
                            hourlyActivityStats[hour].energy += dynG * dt;
                        }
                    }
                }
            }

            // Classification
            let gpsMovement, accPosture, accMovement, finalBehavior;
            const isStandByInterval = curr.standByPeriod;
            const postureContext = curr.postureContext;

            if (isStandByInterval) {
                // Use ACTUAL GPS movement even during StandBy/Deep Sleep
                // Deep Sleep devices (e.g. FMB920 time-based mode) record every ~3 min
                // but the cow may have walked during that interval
                gpsMovement = classifyMovementFromGPS(distM, speedMps, dt);
                accPosture = classifyPostureFromAcc(accAbsUnit, accNorm, postureContext);
                accMovement = { movement: 'stationary', confidence: 0.95 };

                const gpsShowsMovement = gpsMovement.movement !== 'stationary';

                if (gpsShowsMovement) {
                    // GPS shows cow moved during StandBy - classify as walking
                    finalBehavior = {
                        behavior: gpsMovement.movement === 'grazing' ? 'grazing' : 'walking',
                        posture: 'standing',
                        movement: gpsMovement.movement,
                        confidence: gpsMovement.confidence * 0.85,
                        source: 'standby_gps_movement',
                        consistency: 'standby'
                    };
                } else {
                    // GPS stationary during StandBy - infer lying/standing from accelerometer
                    const inferredLying = accPosture.posture === 'lying' || accPosture.confidence < 0.5;
                    finalBehavior = {
                        behavior: inferredLying ? 'lying' : 'standing',
                        posture: inferredLying ? 'lying' : 'standing',
                        movement: 'stationary',
                        confidence: inferredLying ? 0.9 : 0.8,
                        source: 'standby_inferred',
                        consistency: 'standby'
                    };
                }
                crossValidationStats.standByIntervals++;
            } else {
                gpsMovement = classifyMovementFromGPS(distM, speedMps, dt);
                accPosture = classifyPostureFromAcc(accAbsUnit, accNorm, postureContext);
                accMovement = classifyMovementFromAcc(dynG, 0);
                finalBehavior = crossValidateBehavior(gpsMovement, accMovement, accPosture);
            }

            // Zone-based lying override: cows only lie on hay in ZONE_A (purple polygon)
            if (finalBehavior.posture === 'lying' || finalBehavior.behavior.includes('lying')) {
                const inZoneA = isPointInsidePolygon(curr.lat, curr.lon, FACILITY.ZONE_A);
                if (!inZoneA) {
                    finalBehavior.posture = 'standing';
                    finalBehavior.behavior = 'standing';
                    finalBehavior.consistency = 'zone_override';
                    finalBehavior.confidence = 0.98;
                    crossValidationStats.zoneOverride++;
                }
            }

            crossValidationStats.total++;
            if (finalBehavior.consistency === 'consistent') crossValidationStats.consistent++;
            else if (finalBehavior.consistency === 'gps_override') crossValidationStats.gpsOverride++;
            else if (finalBehavior.consistency === 'acc_override') crossValidationStats.accOverride++;
            else if (finalBehavior.consistency === 'standby') { /* already counted */ }
            else if (finalBehavior.consistency === 'zone_override') { /* already counted */ }
            else crossValidationStats.uncertain++;

            // Count movement based on actual GPS displacement
            // For Deep Sleep devices: StandBy + GPS movement = cow walked during sleep interval
            const isWalking = gpsMovement.movement !== 'stationary';

            if (!isWalking) gpsStableTimeTotal += dt;
            const movedDist = isWalking ? distM : 0;
            totalDistance += movedDist;
            if (isDay) dayDistance += movedDist;
            else nightDistance += movedDist;

            if (isStandByInterval && finalBehavior.behavior === 'lying') {
                standByLyingTime += dt;
            }

            const simpleBehavior = simplifyBehavior(finalBehavior.behavior);

            if (simpleBehavior === 'lying') {
                lyingTime += dt;
                if (!isWalking) gpsStableLyingTime += dt;
            } else if (simpleBehavior === 'standing') {
                standingTime += dt;
                if (!isWalking) gpsStableStandingTime += dt;
            } else {
                walkingTime += dt;
            }

            addDurationToHourly(hourlyData, midSec, simpleBehavior, dt);

            if (finalBehavior.consistency === 'consistent' || finalBehavior.consistency === 'standby') {
                consistencyTime += dt;
            } else {
                inconsistentDuration += dt;
            }

            // Step detection
            const prevAccY = prev.accY;
            const currAccY = curr.accY;
            if (prevAccY !== null && currAccY !== null &&
                Math.abs(prevAccY) >= CONFIG.ACC_STEP_THRESHOLD &&
                Math.abs(currAccY) >= CONFIG.ACC_STEP_THRESHOLD) {
                const prevSign = prevAccY >= 0 ? 1 : -1;
                const currSign = currAccY >= 0 ? 1 : -1;
                if (prevSign !== currSign) stepZeroCrossings++;
                stepDuration += dt;
            }

            // Store interval
            intervals.push({
                startSec: prev.tSec,
                endSec: curr.tSec,
                midSec,
                dt,
                distM,
                speedMps,
                bearingDeg,
                distFromCenter,
                lat: curr.lat,
                lon: curr.lon,
                isDay,
                isWalking,
                accX, accY, accZ,
                accNorm,
                accAbsUnit,
                dynG,
                gpsMovement,
                accPosture,
                accMovement,
                finalBehavior
            });

            // GPS points
            const gpsPoint = [curr.lat, curr.lon];
            gpsPoints.push(gpsPoint);
            if (isDay) gpsPointsDay.push(gpsPoint);
            else gpsPointsNight.push(gpsPoint);

            // Heat points
            let heatWeight = 0.45;
            if (simpleBehavior === 'lying') heatWeight = 0.95;
            else if (simpleBehavior === 'walking') heatWeight = 0.55;
            const heatPoint = [curr.lat, curr.lon, heatWeight];
            heatPoints.push(heatPoint);
            if (isDay) heatPointsDay.push(heatPoint);
            else heatPointsNight.push(heatPoint);

            // Cluster points
            if (simpleBehavior === 'lying') {
                const lyingPt = { lat: curr.lat, lon: curr.lon, dt, startSec: prev.tSec, endSec: curr.tSec, midSec };
                lyingPointsForClusters.push(lyingPt);
                if (isDay) lyingPointsDay.push(lyingPt);
                else lyingPointsNight.push(lyingPt);
            }
            if (simpleBehavior === 'standing') {
                const standPt = { lat: curr.lat, lon: curr.lon, dt, startSec: prev.tSec, endSec: curr.tSec, midSec };
                standingPointsForClusters.push(standPt);
                if (isDay) standingPointsDay.push(standPt);
                else standingPointsNight.push(standPt);
            }

            // Fence crossing arrows
            const currentFence = isInsideFenceII(curr.lat, curr.lon) ? 'II' :
                                 isInsideFenceIII(curr.lat, curr.lon) ? 'III' : null;
            if (currentFence && bearingDeg !== null) {
                const arrowData = { lat: curr.lat, lon: curr.lon, bearing: bearingDeg, time: midSec };
                if (currentFence === 'II' && lastArrow.II !== midSec) {
                    if (isDay) fenceArrowsDay.push(arrowData);
                    else fenceArrowsNight.push(arrowData);
                    lastArrow.II = midSec;
                }
                if (currentFence === 'III' && lastArrow.III !== midSec) {
                    if (isDay) fenceArrowsDay.push(arrowData);
                    else fenceArrowsNight.push(arrowData);
                    lastArrow.III = midSec;
                }
            }
        }

        onProgress('Building segments...');

        // Build behavior segments
        let currentSeg = null;
        for (const it of intervals) {
            const behavior = simplifyBehavior(it.finalBehavior.behavior);

            if (!currentSeg) {
                currentSeg = {
                    behavior,
                    startSec: it.startSec,
                    endSec: it.endSec,
                    centerLatSum: it.lat * it.dt,
                    centerLonSum: it.lon * it.dt,
                    centerWeight: it.dt
                };
            } else if (currentSeg.behavior === behavior) {
                currentSeg.endSec = it.endSec;
                currentSeg.centerLatSum += it.lat * it.dt;
                currentSeg.centerLonSum += it.lon * it.dt;
                currentSeg.centerWeight += it.dt;
            } else {
                segments.push({
                    behavior: currentSeg.behavior,
                    startSec: currentSeg.startSec,
                    endSec: currentSeg.endSec,
                    centerLat: currentSeg.centerLatSum / Math.max(1, currentSeg.centerWeight),
                    centerLon: currentSeg.centerLonSum / Math.max(1, currentSeg.centerWeight)
                });
                currentSeg = {
                    behavior,
                    startSec: it.startSec,
                    endSec: it.endSec,
                    centerLatSum: it.lat * it.dt,
                    centerLonSum: it.lon * it.dt,
                    centerWeight: it.dt
                };
            }
        }

        if (currentSeg) {
            segments.push({
                behavior: currentSeg.behavior,
                startSec: currentSeg.startSec,
                endSec: currentSeg.endSec,
                centerLat: currentSeg.centerLatSum / Math.max(1, currentSeg.centerWeight),
                centerLon: currentSeg.centerLonSum / Math.max(1, currentSeg.centerWeight)
            });
        }

        onProgress('Computing metrics...');

        // Compute final metrics
        const rmsDyn = rmsDynWeight > 0 ? Math.sqrt(rmsDynSum / rmsDynWeight) : 0;
        const meanEnergy = rmsDynWeight > 0 ? energySum / rmsDynWeight : 0;
        const consistencyScore = (consistencyTime + inconsistentDuration) > 0
            ? consistencyTime / (consistencyTime + inconsistentDuration)
            : 1;

        // Step frequency with speed fallback
        let stepFrequencyHz = stepDuration > 0 ? (stepZeroCrossings / 2) / stepDuration : 0;

        if (stepFrequencyHz < 0.1 && walkingTime > 60) {
            const avgWalkingSpeedMps = totalDistance / Math.max(1, walkingTime);
            if (avgWalkingSpeedMps >= 0.05) {
                if (avgWalkingSpeedMps < 0.25) {
                    stepFrequencyHz = 0.5 + (avgWalkingSpeedMps - 0.05) / 0.2 * 0.5;
                } else if (avgWalkingSpeedMps < 0.8) {
                    stepFrequencyHz = 1.0 + (avgWalkingSpeedMps - 0.25) / 0.55 * 0.5;
                } else if (avgWalkingSpeedMps < 1.5) {
                    stepFrequencyHz = 1.5 + (avgWalkingSpeedMps - 0.8) / 0.7 * 0.5;
                } else {
                    stepFrequencyHz = Math.min(3.0, 2.0 + (avgWalkingSpeedMps - 1.5) / 1.5 * 1.0);
                }
            }
        }

        // Vector summary
        const vectorSummary = {
            morning: averageDirection(intervals, 6 * 3600, 10 * 3600),
            midday: averageDirection(intervals, 10 * 3600, 14 * 3600),
            afternoon: averageDirection(intervals, 14 * 3600, 18 * 3600),
            maxDistFromCenter: Math.max(...intervals.map(it => it.distFromCenter || 0), 0),
            circularity: totalDistance > 0 ? totalDistance / Math.max(1, Math.max(...intervals.map(it => it.distFromCenter || 0))) : 1
        };

        // Perimeter analysis
        const perimeterOutliers = collectPerimeterOutliers(intervals);

        // Speed and acc bins
        const speedMpsBins = computeBins2h(
            intervals.map(i => i.speedMps),
            intervals.map(i => i.midSec),
            intervals.map(i => i.dt)
        );

        const accYBins = computeBins2h(
            intervals.map(i => i.accY),
            intervals.map(i => i.midSec),
            intervals.map(i => i.dt)
        );

        onProgress('Clustering zones...');

        // Clusters
        const lyingClusters = clusterDwellZones(lyingPointsForClusters);
        const standingClusters = detectStandingZones(intervals);
        const lyingClustersDay = clusterDwellZones(lyingPointsDay);
        const lyingClustersNight = clusterDwellZones(lyingPointsNight);
        const standingClustersDay = clusterDwellZones(standingPointsDay, CONFIG.STANDING_ZONE_MIN_DURATION_SEC);
        const standingClustersNight = clusterDwellZones(standingPointsNight, CONFIG.STANDING_ZONE_MIN_DURATION_SEC);

        const isolationEvents = detectIsolationEvents(intervals, FACILITY.CENTER);

        // 24h accounting - track unknown time separately, DON'T add to lying
        const accounted = walkingTime + lyingTime + standingTime + unknownTime;
        if (accounted < CONFIG.DAY_TOTAL_SEC) {
            unknownTime += (CONFIG.DAY_TOTAL_SEC - accounted);
        }

        // REMOVED: Previously all unknown time was added to lying - this caused
        // unrealistic values like 22.6h lying per day
        // Unknown time should be reported separately for transparency
        let gapTimeAddedToLying = 0; // Keep for backward compatibility but don't add

        // Cross-validation percentages
        crossValidationStats.consistentPct = crossValidationStats.total > 0
            ? (crossValidationStats.consistent / crossValidationStats.total * 100).toFixed(1)
            : 0;
        crossValidationStats.standByPct = crossValidationStats.total > 0
            ? (crossValidationStats.standByIntervals / crossValidationStats.total * 100).toFixed(1)
            : 0;

        // Breeding status
        const breedingStatus = calculateBreedingStatus(options.calvingDate, options.dateStr);

        onProgress('Done');

        const lostPacketsCount = retryFilterStats
            ? (Number.isFinite(retryFilterStats.retryCount)
                ? retryFilterStats.retryCount
                : (Number.isFinite(retryFilterStats.removed) ? retryFilterStats.removed : 0))
            : 0;

        const dataCleaningSummary = {
            datasetName: datasetLabel,
            fakeGpsRecords: rawSampleStats.outsideFence,
            lostPackets: lostPacketsCount
        };

        return {
            dateStr: options.dateStr || 'unknown',
            recordCount,
            resampledCount: resampledSampleCount,
            interpolatedCount,
            totalDistance,
            dayDistance,
            nightDistance,
            lyingTime,
            standingTime,
            walkingTime,
            unknownTime,
            standByLyingTime,
            gapTimeAddedToLying,
            gpsStableTimeTotal,
            gpsStableStandingTime,
            gpsStableLyingTime,
            intervalsConsidered,
            intervalsSkippedInvalidTime,
            intervalsSkippedOutsideFence,
            hourlyData,
            segments,
            gpsPoints,
            heatPoints,
            gpsPointsDay,
            heatPointsDay,
            gpsPointsNight,
            heatPointsNight,
            vectorSummary,
            perimeterOutliers,
            fenceArrowsDay,
            fenceArrowsNight,
            lyingClusters,
            standingClusters,
            lyingClustersDay,
            lyingClustersNight,
            standingClustersDay,
            standingClustersNight,
            isolationEvents,
            speedMpsBins,
            accYBins,
            rmsDyn,
            meanEnergy,
            consistencyScore,
            stepFrequencyHz,
            inconsistentDuration,
            consistencyTime,
            hourlyActivityStats,
            crossValidationStats,
            standByAnalysis,
            postureSummary,
            postureCalibration: postureAnalysis.calibration,
            postureSegments: postureAnalysis.segments,
            breedingStatus,
            retryFilterStats,
            rawSampleStats,
            dataCleaningSummary,
            intervals
        };
    }

    function createEmptyResult(dateStr) {
        return {
            dateStr,
            recordCount: 0,
            resampledCount: 0,
            interpolatedCount: 0,
            totalDistance: 0,
            dayDistance: 0,
            nightDistance: 0,
            lyingTime: 0,
            standingTime: 0,
            walkingTime: 0,
            standByLyingTime: 0,
            gapTimeAddedToLying: 0,
            gpsStableTimeTotal: 0,
            gpsStableStandingTime: 0,
            gpsStableLyingTime: 0,
            intervalsConsidered: 0,
            intervalsSkippedInvalidTime: 0,
            intervalsSkippedOutsideFence: 0,
            hourlyData: Array.from({ length: 24 }, () => ({ lying: 0, standing: 0, walking: 0 })),
            segments: [],
            gpsPoints: [],
            heatPoints: [],
            gpsPointsDay: [],
            heatPointsDay: [],
            gpsPointsNight: [],
            heatPointsNight: [],
            vectorSummary: { morning: { dir: '-' }, midday: { dir: '-' }, afternoon: { dir: '-' }, maxDistFromCenter: 0, circularity: 1 },
            perimeterOutliers: { fenceI_II: [], fenceII_III: [] },
            fenceArrowsDay: [],
            fenceArrowsNight: [],
            lyingClusters: [],
            standingClusters: [],
            lyingClustersDay: [],
            lyingClustersNight: [],
            standingClustersDay: [],
            standingClustersNight: [],
            isolationEvents: [],
            speedMpsBins: Array(12).fill(0),
            accYBins: Array(12).fill(0),
            rmsDyn: 0,
            meanEnergy: 0,
            consistencyScore: 1,
            stepFrequencyHz: 0,
            inconsistentDuration: 0,
            consistencyTime: 0,
            hourlyActivityStats: Array.from({ length: 24 }, () => ({ rmsSum: 0, rmsWeight: 0, energy: 0 })),
            crossValidationStats: { total: 0, consistent: 0, consistentPct: 0, standByPct: 0 },
            standByAnalysis: { periods: [], totalTime: 0, count: 0, longestDuration: 0, averageDuration: 0 },
            postureSummary: {
                standingSec: 0,
                lyingSec: 0,
                transitionSec: 0,
                standingSamples: 0,
                lyingSamples: 0,
                transitionSamples: 0,
                standingConfidenceSum: 0,
                lyingConfidenceSum: 0,
                lowConfidenceStandingSamples: 0,
                lowConfidenceLyingSamples: 0,
                lowConfidenceStandingSec: 0,
                lowConfidenceLyingSec: 0,
                lowConfidenceSamples: 0,
                lowConfidenceSec: 0,
                lowConfidenceThreshold: CONFIG.POSTURE_LOW_CONFIDENCE_THRESHOLD || 0.6,
                avgStandingConfidence: null,
                avgLyingConfidence: null,
                totalSamples: 0
            },
            postureCalibration: { status: 'PENDING', vector: { x: 0, y: 0, z: 1 }, sampleCount: 0 },
            postureSegments: [],
            breedingStatus: null,
            retryFilterStats: null,
            rawSampleStats: { total: 0, invalid: 0, outsideFence: 0 },
            dataCleaningSummary: {
                datasetName: dateStr || 'unknown',
                fakeGpsRecords: 0,
                lostPackets: 0
            },
            intervals: []
        };
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    const RumburkAnalysisCore = {
        // Configuration
        CONFIG,
        FACILITY,
        INDIGO_SCALE,
        ORANGE_SCALE,
        MARKER_SIZES,

        // Helpers
        safeNumber,
        parseTimeToSeconds,
        parseDateTimeToEpoch,
        formatDuration,
        formatHhMm,
        haversineDistance,
        bearingDegrees,
        direction8,

        // Data Preprocessing (FMB920 retry handling)
        filterRetryRecords,
        segmentByGaps,

        // Polygon utilities
        isPointInsidePolygon,
        isInsideRedFence,
        isInsideFenceI,
        isInsideFenceII,
        isInsideFenceIII,
        getZoneLabel,

        // Interpolation
        isStandByGap,
        resampleTo1Hz,
        analyzeStandByPeriods,

        // Classification
        classifyPostureFromAcc,
        classifyMovementFromGPS,
        classifyMovementFromAcc,
        crossValidateBehavior,
        simplifyBehavior,
        buildPostureTimeline,

        // Clustering
        getDurationBucket,
        clusterDwellZones,
        detectStandingZones,
        detectLyingZones,
        detectIsolationEvents,
        collectPerimeterOutliers,

        // Analysis
        averageDirection,
        calculateBreedingStatus,

        // Altitude and FMB920 Technical Cross-Validation
        analyzeAltitudeTransitions,
        crossValidatePostureWithAltitude,
        analyzeFMB920MeasurementPatterns,
        enhancedCrossValidation,

        // GPS Outage Detection Engine
        GPSOutageDetectionEngine,
        analyzeGPSOutages,

        // Main processing function
        processRawData,
        createEmptyResult
    };

    // Export to global scope
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RumburkAnalysisCore;
    } else {
        global.RumburkAnalysisCore = RumburkAnalysisCore;
    }

})(typeof window !== 'undefined' ? window : this);

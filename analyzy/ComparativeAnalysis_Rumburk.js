(function () {
    'use strict';

    // ============================================================
    // ComparativeAnalysis_Rumburk.js
    // Multi-day comparative analysis for cattle behavior monitoring
    // Companion script for ComparativeAnalysis_Rumburk.html
    // Dataset filename pattern: ID{XXXXXX}_{ddmmyy}.js
    // ============================================================

    // ---- Configuration Constants
    const DAY_START_SEC = 6 * 3600;  // 06:00
    const DAY_END_SEC = 18 * 3600;   // 18:00
    const DAY_TOTAL_SEC = 24 * 3600; // 24 hours in seconds
    const MAX_INTERVAL_SEC = 1800;   // Max interval before considered gap (30 min)
    const STANDBY_THRESHOLD_SEC = 180; // StandBy mode threshold (3 minutes)
    const WALK_DIST_THRESHOLD_M = 1.5;
    const ACC_SCALE = 1024; // Teltonika raw approx per 1g
    const ACC_GRAVITY_G = 1;
    const ACC_DYN_WALK_THRESHOLD_G = 0.18;

    const FALLBACK_GEOMETRY = {
        center: [50.95087526458519, 14.569026145132602],
        redFences: [
            [
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
            [
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
                [50.95112548891294, 14.569770735360622],
                [50.95112548891294, 14.569770735360622]
            ],
            [
                [50.95200311825869, 14.568647775648948],
                [50.95268737613058, 14.568875080010143],
                [50.95277237632876, 14.567623268127804],
                [50.952280241566804, 14.567596532690539],
                [50.95209436998893, 14.568126439212186],
                [50.95202530888388, 14.568314543580728],
                [50.95200311825869, 14.568647775648948],
                [50.95200311825869, 14.568647775648948]
            ]
        ],
        zoneA: [
            [50.95102236622948, 14.569107686469978],
            [50.950949671103714, 14.569686110556448],
            [50.95071687649483, 14.569608168428088],
            [50.95081366019143, 14.569025289975537],
            [50.95102236622948, 14.569107686469978]
        ],
        zoneB: [
            [50.95102236622948, 14.569107686469978],
            [50.951144657492286, 14.569174081619819],
            [50.95110444520633, 14.56965752850762],
            [50.95096692430621, 14.569609342050127],
            [50.95102236622948, 14.569107686469978]
        ],
        zoneC: [
            [50.95114038875684, 14.568687268802941],
            [50.95070719320555, 14.568535751266392],
            [50.95064615487605, 14.568819625680666],
            [50.951096750236005, 14.569011156971978],
            [50.95114038875684, 14.568687268802941]
        ]
    };

    const FACILITY_SOURCE = (typeof RumburkAnalysisCore !== 'undefined' && RumburkAnalysisCore.FACILITY)
        ? RumburkAnalysisCore.FACILITY
        : {
            CENTER: FALLBACK_GEOMETRY.center,
            RED_FENCES: FALLBACK_GEOMETRY.redFences,
            ZONE_A: FALLBACK_GEOMETRY.zoneA,
            ZONE_B: FALLBACK_GEOMETRY.zoneB,
            ZONE_C: FALLBACK_GEOMETRY.zoneC
        };

    const FACILITY_CENTER = FACILITY_SOURCE.CENTER || FALLBACK_GEOMETRY.center;
    const RED_FENCES = (FACILITY_SOURCE.RED_FENCES && FACILITY_SOURCE.RED_FENCES.length)
        ? FACILITY_SOURCE.RED_FENCES
        : FALLBACK_GEOMETRY.redFences;
    const RED_FENCE = RED_FENCES[0] || FALLBACK_GEOMETRY.redFences[0];
    const RED_FENCE_II = RED_FENCES[1] || null;
    const RED_FENCE_III = RED_FENCES[2] || null;
    const ZONE_A = FACILITY_SOURCE.ZONE_A || FALLBACK_GEOMETRY.zoneA;
    const ZONE_B = FACILITY_SOURCE.ZONE_B || FALLBACK_GEOMETRY.zoneB;
    const ZONE_C = FACILITY_SOURCE.ZONE_C || FALLBACK_GEOMETRY.zoneC;

    // ---- Global State
    let cowId = '';
    let calvingDate = null;
    let bullEndDate = null;
    let selectedDays = [];
    let loadedDatasets = {};
    let datasetFilenames = {};
    let processedData = {};
    let compareMapStates = {};
    let weatherData = {}; // { 'ddmmyy': { temps: [t0, t6, t12, t18], humidity: [h0, h6, h12, h18] } }
    let currentMonth = 11; // December (0-indexed)
    let currentYear = 2025;
    const dayColors = ['#e94560', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];
    const dayNames = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
    const monthNames = ['Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
        'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'];

    // ============================================================
    // UTILITY FUNCTIONS
    // ============================================================

    /**
     * Parse timestamp string (HH:MM:SS or HH:MM) to seconds from midnight
     */
    function parseTime(ts) {
        if (!ts) return null;
        const parts = String(ts).trim().split(':').map(p => Number(p));
        if (parts.length < 2) return null;
        const h = parts[0];
        const m = parts[1];
        const s = parts.length >= 3 ? parts[2] : 0;
        if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
        return h * 3600 + m * 60 + s;
    }

    /**
     * Format duration in seconds to human-readable string
     */
    function formatDuration(seconds) {
        const s = Math.max(0, Math.round(seconds));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m`;
        return `${sec}s`;
    }

    function formatNumber(value) {
        const n = Number(value || 0);
        return Number.isFinite(n) ? n.toLocaleString('cs-CZ') : '0';
    }

    /**
     * Format date string from ddmmyy to dd.mm.yyyy
     */
    function formatDateDisplay(dateStr) {
        const d = dateStr.slice(0, 2);
        const m = dateStr.slice(2, 4);
        const y = '20' + dateStr.slice(4, 6);
        return `${d}.${m}.${y}`;
    }

    /**
     * Format date for calendar/file naming (dd, mm, yyyy -> ddmmyy)
     */
    function formatDateStr(day, month, year) {
        const d = day.toString().padStart(2, '0');
        const m = month.toString().padStart(2, '0');
        const y = year.toString().slice(-2);
        return `${d}${m}${y}`;
    }

    /**
     * Safe number conversion
     */
    function safeNumber(v) {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    /**
     * Haversine distance between two GPS coordinates in meters
     */
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

    /**
     * Ray-casting algorithm for point-in-polygon test
     */
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
        if (RED_FENCES && RED_FENCES.length) return RED_FENCES;
        const polygons = [];
        if (RED_FENCE) polygons.push(RED_FENCE);
        if (RED_FENCE_II) polygons.push(RED_FENCE_II);
        if (RED_FENCE_III) polygons.push(RED_FENCE_III);
        return polygons;
    }

    /**
     * Check if point is inside any of the RED FENCE areas
     */
    function isInsideRedFence(lat, lon) {
        for (const fence of getRedFencePolygons()) {
            if (isPointInsidePolygon(lat, lon, fence)) return true;
        }
        return false;
    }

    // ============================================================
    // BEHAVIOR CLASSIFICATION (Enhanced with StandBy handling)
    // ============================================================

    /**
     * Classify behavior based on accelerometer and GPS data
     * Uses GPS-first logic: if GPS changed enough, cow is walking
     * For stationary periods, use accelerometer orientation
     */
    function classifyBehavior(accY, accNorm, accAbsUnit, distanceM) {
        // GPS-first logic: if GPS moved significantly, cow is walking
        if (distanceM > WALK_DIST_THRESHOLD_M) return 'walking';

        // GPS stable => use accelerometer for standing vs lying
        if (accAbsUnit && accAbsUnit.length === 3) {
            const [ax, ay, az] = accAbsUnit;

            // Strong vertical orientation (az dominates) = standing
            if (az >= 0.85 && ax <= 0.35 && ay <= 0.35) return 'standing';

            // Strong horizontal orientation (ax or ay dominates) = lying
            if (az <= 0.40 && Math.max(ax, ay) >= 0.75) return 'lying';
        }

        // Fallback: use raw acc_y value
        if (accY !== null) {
            if (accY < -400 || accY > 800) return 'lying';
        }

        return 'standing';
    }

    /**
     * K-means clustering for posture detection (2 clusters)
     */
    function kMeans2AbsUnit(points) {
        const pts = points.slice();
        if (pts.length < 2) return null;

        const dist2 = (a, b) => {
            const dx = a[0] - b[0];
            const dy = a[1] - b[1];
            const dz = a[2] - b[2];
            return dx * dx + dy * dy + dz * dz;
        };

        const c0 = pts[0];
        let farIdx = 1;
        let farD = dist2(c0, pts[1]);
        for (let i = 2; i < pts.length; i++) {
            const d = dist2(c0, pts[i]);
            if (d > farD) {
                farD = d;
                farIdx = i;
            }
        }
        let cent0 = pts[0].slice();
        let cent1 = pts[farIdx].slice();

        const assignments = new Array(pts.length).fill(0);
        for (let iter = 0; iter < 10; iter++) {
            let changed = false;
            for (let i = 0; i < pts.length; i++) {
                const d0 = dist2(pts[i], cent0);
                const d1 = dist2(pts[i], cent1);
                const a = d1 < d0 ? 1 : 0;
                if (assignments[i] !== a) {
                    assignments[i] = a;
                    changed = true;
                }
            }
            const sum0 = [0, 0, 0];
            const sum1 = [0, 0, 0];
            let n0 = 0;
            let n1 = 0;
            for (let i = 0; i < pts.length; i++) {
                const p = pts[i];
                if (assignments[i] === 0) {
                    sum0[0] += p[0]; sum0[1] += p[1]; sum0[2] += p[2];
                    n0++;
                } else {
                    sum1[0] += p[0]; sum1[1] += p[1]; sum1[2] += p[2];
                    n1++;
                }
            }
            if (n0 > 0) cent0 = [sum0[0] / n0, sum0[1] / n0, sum0[2] / n0];
            if (n1 > 0) cent1 = [sum1[0] / n1, sum1[1] / n1, sum1[2] / n1];
            if (!changed) break;
        }

        return { assignments, cent0, cent1 };
    }

    // ============================================================
    // DATA PROCESSING (with StandBy detection)
    // ============================================================

    /**
     * Process a single day's dataset with enhanced behavior detection
     * CRITICAL: Implements StandBy mode handling for Teltonika FMB920
     * When GPS gap > 3 minutes (device in StandBy to save battery),
     * this is interpreted as LYING behavior, not signal loss
     */
    function processDataset(data, dateStr) {
        if (!Array.isArray(data) || data.length === 0) {
            return createEmptyResult(dateStr);
        }

        // Parse and sort samples by time
        const samples = [];
        for (const r of data) {
            const tSec = parseTime(r.timestamp);
            const lat = safeNumber(r.gps_lat);
            const lon = safeNumber(r.gps_lon);
            const accX = safeNumber(r.acc_x);
            const accY = safeNumber(r.acc_y);
            const accZ = safeNumber(r.acc_z);

            if (tSec === null || lat === null || lon === null) continue;

            const mag = (accX !== null && accY !== null && accZ !== null)
                ? Math.sqrt(accX * accX + accY * accY + accZ * accZ)
                : null;

            samples.push({ tSec, lat, lon, accX, accY, accZ, mag });
        }

        samples.sort((a, b) => a.tSec - b.tSec);

        if (samples.length < 2) {
            return createEmptyResult(dateStr);
        }

        // Initialize counters
        let totalDistance = 0;
        let dayDistance = 0;
        let nightDistance = 0;
        let lyingTime = 0;
        let standingTime = 0;
        let walkingTime = 0;
        let unknownTime = 0;
        let standbyLyingTime = 0; // Time added from StandBy gaps

        let rmsSum = 0;
        let rmsWeight = 0;
        let energySum = 0;
        let speedSum = 0;
        let speedCount = 0;
        let maxSpeed = 0;

        const gpsPoints = [];
        const dayPoints = [];
        const nightPoints = [];
        const heatPoints = [];
        const dayHeatPoints = [];
        const nightHeatPoints = [];

        let intervalsConsidered = 0;
        let intervalsSkippedOutsideFence = 0;

        // Track time coverage for 24h accounting
        let minSec = Infinity;
        let maxSec = -Infinity;
        for (const s of samples) {
            if (s.tSec < minSec) minSec = s.tSec;
            if (s.tSec > maxSec) maxSec = s.tSec;
        }

        // Time before first sample and after last sample
        if (Number.isFinite(minSec) && Number.isFinite(maxSec)) {
            unknownTime += Math.max(0, minSec);
            unknownTime += Math.max(0, DAY_TOTAL_SEC - maxSec);
        }

        // Build intervals for behavior analysis
        const intervals = [];

        for (let i = 1; i < samples.length; i++) {
            const prev = samples[i - 1];
            const curr = samples[i];
            const dt = curr.tSec - prev.tSec;

            if (!Number.isFinite(dt) || dt <= 0) continue;

            // Handle large gaps - CRITICAL: StandBy mode detection
            if (dt > MAX_INTERVAL_SEC) {
                // Large gap - add to unknown, will be redistributed later
                unknownTime += dt;
                continue;
            }

            // StandBy mode: gaps > 3 minutes indicate cow is lying still
            // Teltonika FMB920 enters StandBy to save battery when no movement
            if (dt > STANDBY_THRESHOLD_SEC) {
                // This is StandBy mode - cow is lying
                standbyLyingTime += dt;
                lyingTime += dt;

                // Add midpoint to heat map as lying zone
                const midLat = (prev.lat + curr.lat) / 2;
                const midLon = (prev.lon + curr.lon) / 2;
                const midSec = (prev.tSec + curr.tSec) / 2;
                const isDay = midSec >= DAY_START_SEC && midSec < DAY_END_SEC;

                const heatPoint = [midLat, midLon, 0.95]; // High weight for lying
                heatPoints.push(heatPoint);
                if (isDay) dayHeatPoints.push(heatPoint);
                else nightHeatPoints.push(heatPoint);

                continue;
            }

            intervalsConsidered++;

            // Check if inside facility fence
            const prevInside = isInsideRedFence(prev.lat, prev.lon);
            const currInside = isInsideRedFence(curr.lat, curr.lon);

            if (!prevInside || !currInside) {
                intervalsSkippedOutsideFence++;
                unknownTime += dt;
                continue;
            }

            // Calculate distance and speed
            const distM = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
            const speedMps = distM / dt;
            const speedMpm = speedMps * 60; // m/min
            const midSec = (prev.tSec + curr.tSec) / 2;
            const isDay = midSec >= DAY_START_SEC && midSec < DAY_END_SEC;

            // Add to GPS points
            const point = [curr.lat, curr.lon];
            gpsPoints.push(point);
            if (isDay) dayPoints.push(point);
            else nightPoints.push(point);

            // Calculate accelerometer metrics
            const accX = curr.accX;
            const accY = curr.accY;
            const accZ = curr.accZ;
            let accNorm = null;
            let accAbsUnit = null;

            if (accX !== null && accY !== null && accZ !== null) {
                const n = Math.sqrt(accX * accX + accY * accY + accZ * accZ);
                if (Number.isFinite(n) && n > 1) {
                    accNorm = n;
                    accAbsUnit = [Math.abs(accX) / n, Math.abs(accY) / n, Math.abs(accZ) / n];

                    // Calculate dynamic acceleration for energy metrics
                    const normG = n / ACC_SCALE;
                    const dynG = Math.max(0, Math.abs(normG - ACC_GRAVITY_G));
                    if (Number.isFinite(dynG)) {
                        rmsSum += dynG * dynG * dt;
                        rmsWeight += dt;
                        energySum += dynG * dt;
                    }
                }
            }

            // Classify behavior
            const isWalking = distM > WALK_DIST_THRESHOLD_M;
            let behavior = classifyBehavior(accY, accNorm, accAbsUnit, distM);
            if (behavior === 'lying' && !isPointInsidePolygon(curr.lat, curr.lon, ZONE_A)) {
                behavior = isWalking ? 'walking' : 'standing';
            }

            // Accumulate behavior times
            if (behavior === 'walking' || isWalking) {
                walkingTime += dt;
                totalDistance += distM;
                if (isDay) dayDistance += distM;
                else nightDistance += distM;
            } else if (behavior === 'lying') {
                lyingTime += dt;
            } else {
                standingTime += dt;
            }

            // Speed tracking (only for walking intervals)
            if (isWalking && speedMpm > 0) {
                speedSum += speedMpm;
                speedCount++;
                if (speedMpm > maxSpeed) maxSpeed = speedMpm;
            }

            // Heat map points with behavior-based weighting
            let heatWeight = 0.45;
            if (behavior === 'lying') heatWeight = 0.95;
            else if (behavior === 'walking') heatWeight = 0.55;

            const heatPoint = [curr.lat, curr.lon, heatWeight];
            heatPoints.push(heatPoint);
            if (isDay) dayHeatPoints.push(heatPoint);
            else nightHeatPoints.push(heatPoint);

            // Store interval for further analysis
            intervals.push({
                startSec: prev.tSec,
                endSec: curr.tSec,
                midSec,
                dt,
                distM,
                speedMps,
                isDay,
                behavior,
                accNorm,
                accAbsUnit
            });
        }

        // ============================================================
        // 24-HOUR TIME ACCOUNTING
        // Ensure: lyingTime + standingTime + walkingTime + unknownTime = 24h
        // OPRAVA: NEpřidáváme unknown do lying - zachováváme jako samostatnou kategorii
        // ============================================================

        unknownTime = 0;
        const accountedTime = walkingTime + lyingTime + standingTime;
        const remainingUnknown = DAY_TOTAL_SEC - accountedTime;

        if (remainingUnknown > 0) {
            // OPRAVA: Unknown time zůstává jako samostatná kategorie
            // Předchozí logika (přidávání do lying) způsobovala nerealistické hodnoty
            unknownTime = remainingUnknown;
            // NEpřidáváme do lyingTime ani standbyLyingTime
        } else if (remainingUnknown < 0) {
            // Over-counted, reduce proportionally
            const excess = Math.abs(remainingUnknown);
            const total = accountedTime;
            if (total > 0) {
                const lyingRatio = lyingTime / total;
                const standingRatio = standingTime / total;
                const walkingRatio = walkingTime / total;

                lyingTime -= excess * lyingRatio;
                standingTime -= excess * standingRatio;
                walkingTime -= excess * walkingRatio;
            }
        }

        // Calculate final metrics
        const avgSpeed = speedCount > 0 ? speedSum / speedCount : 0;
        const rmsDyn = rmsWeight > 0 ? Math.sqrt(rmsSum / rmsWeight) : 0;
        const meanEnergy = rmsWeight > 0 ? energySum / rmsWeight : 0;
        const energyProxy = rmsDyn * (totalDistance / 1000 + 1);

        return {
            date: formatDateDisplay(dateStr),
            dateStr,
            totalDistance,
            dayDistance,
            nightDistance,
            lyingTime,
            standingTime,
            walkingTime,
            unknownTime, // Nezařazený čas - NEpřidáváme do lying
            standbyLyingTime, // Time from StandBy gaps (historical tracking)
            avgSpeed,
            maxSpeed,
            avgRms: rmsDyn * ACC_SCALE, // Convert back to raw units for display
            rmsDyn,
            meanEnergy,
            energyProxy,
            gpsPoints,
            dayPoints,
            nightPoints,
            heatPoints,
            dayHeatPoints,
            nightHeatPoints,
            recordCount: data.length,
            intervalsConsidered,
            intervalsSkippedOutsideFence,
            cleaningSummary: {
                datasetName: `ID${cowId}_${dateStr}.js`,
                fakeGpsRecords: intervalsSkippedOutsideFence,
                lostPackets: 0
            }
        };
    }

    /**
     * Create empty result structure for failed/empty datasets
     */
    function createEmptyResult(dateStr) {
        return {
            date: formatDateDisplay(dateStr),
            dateStr,
            totalDistance: 0,
            dayDistance: 0,
            nightDistance: 0,
            lyingTime: DAY_TOTAL_SEC * 0.5, // Estimate 50% lying
            standingTime: DAY_TOTAL_SEC * 0.3,
            walkingTime: DAY_TOTAL_SEC * 0.2,
            standbyLyingTime: 0,
            avgSpeed: 0,
            maxSpeed: 0,
            avgRms: 0,
            rmsDyn: 0,
            meanEnergy: 0,
            energyProxy: 0,
            gpsPoints: [],
            dayPoints: [],
            nightPoints: [],
            heatPoints: [],
            dayHeatPoints: [],
            nightHeatPoints: [],
            recordCount: 0,
            intervalsConsidered: 0,
            intervalsSkippedOutsideFence: 0,
            cleaningSummary: {
                datasetName: `ID${cowId}_${dateStr}.js`,
                fakeGpsRecords: 0,
                lostPackets: 0
            }
        };
    }

    /**
     * Convert core module output to comparative analysis format
     * Adds compatibility fields expected by render functions
     */
    function adaptCoreResultForComparative(coreResult, dateStr) {
        if (!coreResult) return createEmptyResult(dateStr);

        // Calculate additional metrics expected by render functions
        const avgSpeed = coreResult.walkingTime > 0
            ? (coreResult.totalDistance / coreResult.walkingTime) * 60 // m/min
            : 0;
        const maxSpeed = coreResult.intervals && coreResult.intervals.length > 0
            ? Math.max(...coreResult.intervals.map(it => it.speedMps || 0)) * 60
            : 0;
        const energyProxy = coreResult.rmsDyn * (coreResult.totalDistance / 1000 + 1);

        const cleaningSummary = coreResult.dataCleaningSummary || {
            datasetName: coreResult.dateStr || dateStr,
            fakeGpsRecords: coreResult.rawSampleStats ? coreResult.rawSampleStats.outsideFence || 0 : 0,
            lostPackets: coreResult.retryFilterStats ? coreResult.retryFilterStats.retryCount || 0 : 0
        };

        return {
            // Direct mappings from core
            dateStr: coreResult.dateStr || dateStr,
            date: formatDateDisplay(dateStr),
            totalDistance: coreResult.totalDistance,
            dayDistance: coreResult.dayDistance,
            nightDistance: coreResult.nightDistance,
            lyingTime: coreResult.lyingTime,
            standingTime: coreResult.standingTime,
            walkingTime: coreResult.walkingTime,
            standbyLyingTime: coreResult.standByLyingTime || 0,
            rmsDyn: coreResult.rmsDyn,
            meanEnergy: coreResult.meanEnergy,
            recordCount: coreResult.recordCount,
            intervalsConsidered: coreResult.intervalsConsidered,
            intervalsSkippedOutsideFence: coreResult.intervalsSkippedOutsideFence,

            // Computed compatibility fields
            avgSpeed: avgSpeed,
            maxSpeed: maxSpeed,
            avgRms: coreResult.rmsDyn * 1024, // Convert to raw units
            energyProxy: energyProxy,

            // Point arrays for maps
            gpsPoints: coreResult.gpsPoints || [],
            dayPoints: coreResult.gpsPointsDay || [],
            nightPoints: coreResult.gpsPointsNight || [],
            heatPoints: coreResult.heatPoints || [],
            dayHeatPoints: coreResult.heatPointsDay || [],
            nightHeatPoints: coreResult.heatPointsNight || [],

            // New fields from core module
            lyingClusters: coreResult.lyingClusters || [],
            standingClusters: coreResult.standingClusters || [],
            lyingClustersDay: coreResult.lyingClustersDay || [],
            lyingClustersNight: coreResult.lyingClustersNight || [],
            standingClustersDay: coreResult.standingClustersDay || [],
            standingClustersNight: coreResult.standingClustersNight || [],
            segments: coreResult.segments || [],
            hourlyData: coreResult.hourlyData || [],
            vectorSummary: coreResult.vectorSummary || {},
            isolationEvents: coreResult.isolationEvents || [],
            crossValidationStats: coreResult.crossValidationStats || {},
            standByAnalysis: coreResult.standByAnalysis || {},
            stepFrequencyHz: coreResult.stepFrequencyHz || 0,
            consistencyScore: coreResult.consistencyScore || 0,
            intervals: coreResult.intervals || [],
            cleaningSummary
        };
    }

    /**
     * Process all loaded datasets
     */
    function processAllData() {
        processedData = {};

        for (const dateStr of selectedDays) {
            const rawData = loadedDatasets[dateStr];
            if (!rawData) continue;

            // Use centralized core module for processing
            if (typeof RumburkAnalysisCore !== 'undefined' && RumburkAnalysisCore.processRawData) {
                const datasetName = datasetFilenames[dateStr] || `ID${cowId}_${dateStr}.js`;
                const coreResult = RumburkAnalysisCore.processRawData(rawData, { dateStr, datasetName });
                processedData[dateStr] = adaptCoreResultForComparative(coreResult, dateStr);
            } else {
                // Fallback to local processDataset if core not loaded
                processedData[dateStr] = processDataset(rawData, dateStr);
            }
        }
    }

    // ============================================================
    // DATASET LOADING
    // ============================================================

    /**
     * Load a dataset file dynamically
     */
    /**
     * Safely access a global const variable using eval
     * Required because const declarations are not accessible via window[name]
     */
    function safeGetGlobal(varName) {
        // Validate variable name (alphanumeric + underscore only)
        if (!/^[A-Z0-9_]+$/i.test(varName)) return null;
        try {
            // First try direct window access (works for var declarations)
            if (window[varName] !== undefined) return window[varName];
            // Then try eval (works for const declarations)
            if (typeof window !== 'undefined' && typeof window.eval === 'function') {
                return window.eval(varName);
            }
        } catch {
            return null;
        }
        return null;
    }

    function loadDataset(dateStr, filename) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `Datasets/${filename}?cache=${Date.now()}`;
            script.onload = () => {
                const varName = `COW_${cowId}_${dateStr}`;
                let dataset = safeGetGlobal(varName);

                // Try alternate cow IDs if primary not found
                if (!Array.isArray(dataset)) {
                    // Try with extra digit (e.g., 175959 -> 1759595)
                    const altIds = [`${cowId}5`, '1759595', '227831', '166691'];
                    for (const altId of altIds) {
                        const altVarName = `COW_${altId}_${dateStr}`;
                        dataset = safeGetGlobal(altVarName);
                        if (Array.isArray(dataset)) {
                            console.log(`Found dataset with alternate ID: ${altVarName}`);
                            break;
                        }
                    }
                }

                if (Array.isArray(dataset)) {
                    loadedDatasets[dateStr] = dataset;
                    datasetFilenames[dateStr] = filename;
                    resolve();
                } else {
                    reject(new Error(`Variable ${varName} not found in loaded script`));
                }
            };
            script.onerror = () => reject(new Error(`Failed to load file: ${filename}`));
            document.head.appendChild(script);
        });
    }

    /**
     * Start the analysis process
     */
    async function startAnalysis() {
        const error = document.getElementById('step2Error');

        if (selectedDays.length === 0) {
            error.textContent = 'Vyberte alespoň jeden den.';
            error.style.display = 'block';
            return;
        }

        error.style.display = 'none';
        document.getElementById('wizardOverlay').classList.add('hidden');
        document.getElementById('loadingOverlay').classList.remove('hidden');

        loadedDatasets = {};
        datasetFilenames = {};
        datasetFilenames = {};
        let loadedCount = 0;
        let failedDays = [];

        for (const dateStr of selectedDays) {
            const filename = `ID${cowId}_${dateStr}.js`;
            document.getElementById('loadingText').textContent = `Načítám ${filename}...`;

            try {
                await loadDataset(dateStr, filename);
                loadedCount++;
            } catch (e) {
                console.error(`Failed to load ${filename}:`, e);
                failedDays.push(dateStr);
            }
        }

        if (loadedCount === 0) {
            document.getElementById('loadingOverlay').classList.add('hidden');
            document.getElementById('wizardOverlay').classList.remove('hidden');
            error.textContent = `Nepodařilo se načíst žádný dataset. Ověřte, že soubory existují.`;
            error.style.display = 'block';
            return;
        }

        if (failedDays.length > 0) {
            selectedDays = selectedDays.filter(d => !failedDays.includes(d));
        }

        document.getElementById('loadingText').textContent = 'Načítám meteorologická data...';
        await fetchWeatherData();

        document.getElementById('loadingText').textContent = 'Zpracovávám data...';
        await new Promise(r => setTimeout(r, 100));

        processAllData();
        renderMainContent();

        document.getElementById('loadingOverlay').classList.add('hidden');
        document.getElementById('mainContent').classList.remove('hidden');
    }

    // ============================================================
    // CALENDAR UI
    // ============================================================

    function renderCalendar() {
        const grid = document.getElementById('calendarGrid');
        const monthLabel = document.getElementById('calendarMonth');

        if (!grid || !monthLabel) return;

        monthLabel.textContent = `${monthNames[currentMonth]} ${currentYear}`;

        const firstDay = new Date(currentYear, currentMonth, 1).getDay();
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const minDate = new Date(2025, 11, 14); // 14.12.2025

        let html = '';

        // Day headers
        dayNames.forEach(d => {
            html += `<div class="calendar-day-header">${d}</div>`;
        });

        // Empty cells before first day
        for (let i = 0; i < firstDay; i++) {
            html += '<div class="calendar-day empty"></div>';
        }

        // Days
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(currentYear, currentMonth, day);
            const dateStr = formatDateStr(day, currentMonth + 1, currentYear);
            const isDisabled = date < minDate;
            const selectedIndex = selectedDays.indexOf(dateStr);
            const isSelected = selectedIndex !== -1;

            let classes = 'calendar-day';
            if (isDisabled) classes += ' disabled';
            if (isSelected) classes += ` selected day-${selectedIndex + 1}`;

            html += `<div class="${classes}" data-date="${dateStr}" onclick="window.ComparativeAnalysis.toggleDay('${dateStr}', ${isDisabled})">${day}</div>`;
        }

        grid.innerHTML = html;
        updateSelectedList();
    }

    function toggleDay(dateStr, isDisabled) {
        if (isDisabled) return;

        const index = selectedDays.indexOf(dateStr);
        if (index !== -1) {
            selectedDays.splice(index, 1);
        } else if (selectedDays.length < 5) {
            selectedDays.push(dateStr);
        }

        renderCalendar();
    }

    function removeDay(dateStr) {
        const index = selectedDays.indexOf(dateStr);
        if (index !== -1) {
            selectedDays.splice(index, 1);
            renderCalendar();
        }
    }

    function updateSelectedList() {
        const list = document.getElementById('selectedDaysList');
        const count = document.getElementById('selectedCount');
        const startBtn = document.getElementById('step2Start');

        if (!list || !count) return;

        count.textContent = selectedDays.length;
        if (startBtn) startBtn.disabled = selectedDays.length === 0;

        if (selectedDays.length === 0) {
            list.innerHTML = '<span style="color: var(--text-muted); font-size: 0.9em;">Zatím nevybrán žádný den</span>';
        } else {
            list.innerHTML = selectedDays.map((d, i) => `
                <div class="selected-day-tag day-${i + 1}">
                    ${formatDateDisplay(d)}
                    <span class="remove" onclick="window.ComparativeAnalysis.removeDay('${d}')">✕</span>
                </div>
            `).join('');
        }
    }

    // ============================================================
    // RENDERING FUNCTIONS
    // ============================================================

    /**
     * Render pregnancy probability info in header area
     */
    function renderPregnancyInfo() {
        // Find or create pregnancy info element
        let pregnancyEl = document.getElementById('pregnancyInfoHeader');
        if (!pregnancyEl) {
            const headerInfo = document.querySelector('.header-info');
            if (headerInfo) {
                pregnancyEl = document.createElement('div');
                pregnancyEl.id = 'pregnancyInfoHeader';
                pregnancyEl.className = 'header-badge';
                pregnancyEl.style.cssText = 'background: rgba(34, 197, 94, 0.2); border-color: #22c55e;';
                headerInfo.insertBefore(pregnancyEl, headerInfo.firstChild);
            }
        }

        if (!pregnancyEl) return;

        // Check if we have the data needed
        if (!calvingDate || !bullEndDate || typeof PregnancyCalculator === 'undefined') {
            pregnancyEl.style.display = 'none';
            return;
        }

        // Get the last analysis date from selected days
        let analysisDate = new Date();
        if (selectedDays.length > 0) {
            const lastDay = selectedDays[selectedDays.length - 1];
            // Parse ddmmyy format
            const day = parseInt(lastDay.substring(0, 2), 10);
            const month = parseInt(lastDay.substring(2, 4), 10) - 1;
            const year = 2000 + parseInt(lastDay.substring(4, 6), 10);
            analysisDate = new Date(year, month, day);
        }

        try {
            const pregnancyStatus = PregnancyCalculator.calculate(calvingDate, bullEndDate, analysisDate);

            if (pregnancyStatus && pregnancyStatus.probabilityPercent !== undefined) {
                let html = `🤰 Březost: <strong>${pregnancyStatus.probabilityPercent}%</strong>`;

                if (pregnancyStatus.trimester) {
                    html += ` | ${pregnancyStatus.trimester}. trimestr`;
                }
                if (pregnancyStatus.gestationDay) {
                    html += `, den ${pregnancyStatus.gestationDay}`;
                }
                if (pregnancyStatus.daysToParturition !== null && pregnancyStatus.daysToParturition > 0) {
                    html += ` | Do porodu: ${pregnancyStatus.daysToParturition} dnů`;
                }
                if (pregnancyStatus.preParturitionAlert) {
                    html += ` <span style="color: #f59e0b;">⚠️</span>`;
                    pregnancyEl.style.background = 'rgba(245, 158, 11, 0.3)';
                    pregnancyEl.style.borderColor = '#f59e0b';
                }

                pregnancyEl.innerHTML = html;
                pregnancyEl.style.display = 'block';
            } else {
                pregnancyEl.style.display = 'none';
            }
        } catch (e) {
            console.warn('Error calculating pregnancy status:', e);
            pregnancyEl.style.display = 'none';
        }
    }

    function renderMainContent() {
        document.getElementById('headerCowId').textContent = cowId;
        document.getElementById('headerDaysCount').textContent =
            `📊 Porovnáváno: ${selectedDays.length} ${selectedDays.length === 1 ? 'den' : selectedDays.length < 5 ? 'dny' : 'dnů'}`;

        // Add pregnancy info to header if calving and bull dates are provided
        renderPregnancyInfo();

        renderSummary();
        renderStatsSummary();
        renderTimelineComparison();
        renderDayCards();
        renderComparisonTable();
        renderCharts();
        renderWeatherSection();
        renderCleaningSummary();
    }

    // ============================================================
    // STATISTICAL SUMMARY PANEL
    // ============================================================

    /**
     * Render statistical summary with trend analysis and commentary
     */
    function renderStatsSummary() {
        const grid = document.getElementById('statsGrid');
        if (!grid) return;

        const datasets = Object.values(processedData);
        if (datasets.length < 2) {
            grid.innerHTML = '<div class="stat-item"><div class="value">—</div><div class="label">Pro statistiku potřeba min. 2 dny</div></div>';
            return;
        }

        // Calculate statistics
        const distances = datasets.map(d => d.totalDistance);
        const lyingTimes = datasets.map(d => d.lyingTime / 3600); // hours
        const walkingTimes = datasets.map(d => d.walkingTime / 3600);
        const speeds = datasets.map(d => d.avgSpeed);

        const avgDist = distances.reduce((a, b) => a + b, 0) / distances.length;
        const stdDist = Math.sqrt(distances.reduce((sum, d) => sum + Math.pow(d - avgDist, 2), 0) / distances.length);
        const cvDist = avgDist > 0 ? (stdDist / avgDist * 100) : 0;

        const avgLying = lyingTimes.reduce((a, b) => a + b, 0) / lyingTimes.length;
        const avgWalking = walkingTimes.reduce((a, b) => a + b, 0) / walkingTimes.length;
        const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;

        // Trend analysis (first vs last)
        const distTrend = distances.length > 1 ? ((distances[distances.length - 1] - distances[0]) / distances[0] * 100) : 0;
        const lyingTrend = lyingTimes.length > 1 ? ((lyingTimes[lyingTimes.length - 1] - lyingTimes[0]) / lyingTimes[0] * 100) : 0;

        // Health indicators
        const lyingOK = avgLying >= 10 && avgLying <= 14; // Optimal 10-14h lying
        const activityOK = avgWalking >= 2 && avgWalking <= 6; // Moderate activity
        const consistencyOK = cvDist < 25; // Low variability is good

        // Generate commentary
        let commentary = [];
        if (avgLying < 10) commentary.push('Nedostatečný odpočinek (< 10h)');
        if (avgLying > 14) commentary.push('Nadměrné ležení (> 14h) - možná indikace zdravotního problému');
        if (cvDist > 35) commentary.push('Vysoká variabilita vzdáleností - nestabilní vzorec');
        if (Math.abs(distTrend) > 30) commentary.push(distTrend > 0 ? 'Výrazný nárůst aktivity' : 'Výrazný pokles aktivity');

        grid.innerHTML = `
            <div class="stat-item ${lyingOK ? 'trend-good' : avgLying < 10 ? 'trend-warning' : 'trend-bad'}">
                <div class="value">${avgLying.toFixed(1)}h</div>
                <div class="label">Ø Doba ležení/den</div>
            </div>
            <div class="stat-item ${activityOK ? 'trend-good' : 'trend-warning'}">
                <div class="value">${avgWalking.toFixed(1)}h</div>
                <div class="label">Ø Doba chůze/den</div>
            </div>
            <div class="stat-item ${consistencyOK ? 'trend-good' : 'trend-warning'}">
                <div class="value">${cvDist.toFixed(0)}%</div>
                <div class="label">Variabilita vzdálenosti (CV)</div>
            </div>
            <div class="stat-item ${Math.abs(distTrend) < 15 ? 'trend-good' : 'trend-warning'}">
                <div class="value">${distTrend > 0 ? '+' : ''}${distTrend.toFixed(0)}%</div>
                <div class="label">Trend vzdálenosti</div>
            </div>
            <div class="stat-item">
                <div class="value">${avgSpeed.toFixed(1)}</div>
                <div class="label">Ø Rychlost (m/min)</div>
            </div>
            <div class="stat-item ${Math.abs(lyingTrend) < 15 ? 'trend-good' : 'trend-warning'}">
                <div class="value">${lyingTrend > 0 ? '+' : ''}${lyingTrend.toFixed(0)}%</div>
                <div class="label">Trend ležení</div>
            </div>
        `;

        // Add commentary if any
        if (commentary.length > 0) {
            const commentaryEl = document.createElement('div');
            commentaryEl.style.cssText = 'grid-column: 1 / -1; margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 8px; font-size: 0.9em;';
            commentaryEl.innerHTML = `<strong style="color: var(--warning);">⚠️ Poznámky:</strong> ${commentary.join('; ')}`;
            grid.appendChild(commentaryEl);
        }
    }

    // ============================================================
    // TIMELINE COMPARISON
    // ============================================================

    /**
     * Render comparative timeline showing all selected days
     */
    function renderTimelineComparison() {
        const container = document.getElementById('timelineComparison');
        if (!container) return;

        const datasets = selectedDays.map(d => processedData[d]).filter(Boolean);

        if (datasets.length === 0) {
            container.innerHTML = '<div style="color: var(--text-muted);">Žádná data k zobrazení</div>';
            return;
        }

        // Generate timeline rows for each day
        container.innerHTML = datasets.map((data, index) => {
            const total = data.lyingTime + data.standingTime + data.walkingTime;
            const lyingPct = total > 0 ? (data.lyingTime / total * 100) : 33;
            const standingPct = total > 0 ? (data.standingTime / total * 100) : 33;
            const walkingPct = total > 0 ? (data.walkingTime / total * 100) : 34;

            // Use width-based segments for proper rendering
            const barContent = `
                <div class="timeline-segment lying" style="width: ${lyingPct.toFixed(1)}%;" title="Ležení: ${(data.lyingTime / 3600).toFixed(1)}h (${lyingPct.toFixed(0)}%)"></div>
                <div class="timeline-segment standing" style="width: ${standingPct.toFixed(1)}%;" title="Stání: ${(data.standingTime / 3600).toFixed(1)}h (${standingPct.toFixed(0)}%)"></div>
                <div class="timeline-segment walking" style="width: ${walkingPct.toFixed(1)}%;" title="Chůze: ${(data.walkingTime / 3600).toFixed(1)}h (${walkingPct.toFixed(0)}%)"></div>
            `;

            return `
                <div class="timeline-row">
                    <div class="timeline-label" style="color: ${dayColors[index]}; font-weight: 600;">${data.date}</div>
                    <div class="timeline-bar">${barContent}</div>
                </div>
            `;
        }).join('');
    }

    function renderSummary() {
        const grid = document.getElementById('summaryGrid');
        if (!grid) return;

        const datasets = Object.values(processedData);

        if (datasets.length === 0) {
            grid.innerHTML = '<div class="summary-card"><p>Žádná data k zobrazení</p></div>';
            return;
        }

        const avgDistance = datasets.reduce((a, d) => a + d.totalDistance, 0) / datasets.length;
        const avgLying = datasets.reduce((a, d) => a + d.lyingTime, 0) / datasets.length;
        const avgSpeed = datasets.reduce((a, d) => a + d.avgSpeed, 0) / datasets.length;
        const avgRms = datasets.reduce((a, d) => a + d.avgRms, 0) / datasets.length;
        const totalStandbyLying = datasets.reduce((a, d) => a + d.standbyLyingTime, 0);

        const minDist = Math.min(...datasets.map(d => d.totalDistance));
        const maxDist = Math.max(...datasets.map(d => d.totalDistance));
        const distVariation = avgDistance > 0 ? ((maxDist - minDist) / avgDistance * 100) : 0;

        grid.innerHTML = `
            <div class="summary-card">
                <h3>📏 Vzdálenost</h3>
                <div class="summary-stats">
                    <div class="summary-stat">
                        <div class="value">${avgDistance.toFixed(0)} m</div>
                        <div class="label">Průměr/den</div>
                    </div>
                    <div class="summary-stat">
                        <div class="value">${distVariation.toFixed(0)}%</div>
                        <div class="label">Variabilita</div>
                    </div>
                    <div class="summary-stat">
                        <div class="value">${minDist.toFixed(0)} m</div>
                        <div class="label">Minimum</div>
                    </div>
                    <div class="summary-stat">
                        <div class="value">${maxDist.toFixed(0)} m</div>
                        <div class="label">Maximum</div>
                    </div>
                </div>
            </div>

            <div class="summary-card">
                <h3>🛏️ Aktivita</h3>
                <div class="summary-stats">
                    <div class="summary-stat">
                        <div class="value">${formatDuration(avgLying)}</div>
                        <div class="label">Ø Ležení</div>
                    </div>
                    <div class="summary-stat">
                        <div class="value">${avgSpeed.toFixed(1)} m/min</div>
                        <div class="label">Ø Rychlost</div>
                    </div>
                    <div class="summary-stat">
                        <div class="value">${avgRms.toFixed(0)}</div>
                        <div class="label">Ø RMS</div>
                    </div>
                    <div class="summary-stat">
                        <div class="value">${datasets.reduce((a, d) => a + d.recordCount, 0)}</div>
                        <div class="label">Celkem záznamů</div>
                    </div>
                </div>
            </div>

            <div class="summary-card">
                <h3>📊 Trend</h3>
                <div class="summary-stats">
                    <div class="summary-stat">
                        <div class="value ${getTrendClass(datasets, 'totalDistance')}">${getTrendIcon(datasets, 'totalDistance')}</div>
                        <div class="label">Vzdálenost</div>
                    </div>
                    <div class="summary-stat">
                        <div class="value ${getTrendClass(datasets, 'lyingTime')}">${getTrendIcon(datasets, 'lyingTime')}</div>
                        <div class="label">Ležení</div>
                    </div>
                    <div class="summary-stat">
                        <div class="value ${getTrendClass(datasets, 'avgSpeed')}">${getTrendIcon(datasets, 'avgSpeed')}</div>
                        <div class="label">Rychlost</div>
                    </div>
                    <div class="summary-stat">
                        <div class="value">${formatDuration(totalStandbyLying)}</div>
                        <div class="label">StandBy→Ležení</div>
                    </div>
                </div>
            </div>
        `;
    }

    function getTrendClass(datasets, key) {
        if (datasets.length < 2) return 'trend-stable';
        const first = datasets[0][key];
        const last = datasets[datasets.length - 1][key];
        const change = (last - first) / (first || 1);
        if (change > 0.1) return 'trend-up';
        if (change < -0.1) return 'trend-down';
        return 'trend-stable';
    }

    function getTrendIcon(datasets, key) {
        if (datasets.length < 2) return '→';
        const first = datasets[0][key];
        const last = datasets[datasets.length - 1][key];
        const change = (last - first) / (first || 1);
        if (change > 0.1) return '↑';
        if (change < -0.1) return '↓';
        return '→';
    }

    function renderDayCards() {
        const grid = document.getElementById('daysGrid');
        if (!grid) return;

        grid.innerHTML = selectedDays.map((dateStr, index) => {
            const data = processedData[dateStr];
            if (!data) return '';

            const totalBehavior = data.lyingTime + data.standingTime + data.walkingTime;
            const lyingPct = totalBehavior > 0 ? (data.lyingTime / totalBehavior * 100) : 33;
            const standingPct = totalBehavior > 0 ? (data.standingTime / totalBehavior * 100) : 33;
            const walkingPct = totalBehavior > 0 ? (data.walkingTime / totalBehavior * 100) : 34;

            // Show StandBy indicator if significant portion came from StandBy
            const standbyNote = data.standbyLyingTime > 3600
                ? `<div style="font-size: 0.75em; color: #4CAF50; margin-top: 5px;">🛰️ ${formatDuration(data.standbyLyingTime)} ze StandBy</div>`
                : '';

            return `
                <div class="day-card day-${index + 1}">
                    <div class="day-card-header">
                        <h3>📅 ${data.date}</h3>
                        <span style="font-size: 0.85em; color: var(--text-muted);">${data.recordCount} záznamů</span>
                    </div>
                    <div class="day-card-body">
                        <div class="day-night-split">
                            <div class="split-box day-split">
                                <div class="icon">☀️</div>
                                <div class="value">${data.dayDistance.toFixed(0)} m</div>
                                <div class="label">Den (06-18h)</div>
                            </div>
                            <div class="split-box night-split">
                                <div class="icon">🌙</div>
                                <div class="value">${data.nightDistance.toFixed(0)} m</div>
                                <div class="label">Noc (18-06h)</div>
                            </div>
                        </div>

                        <div class="mini-stats">
                            <div class="mini-stat">
                                <div class="value">${data.totalDistance.toFixed(0)} m</div>
                                <div class="label">Celkem</div>
                            </div>
                            <div class="mini-stat">
                                <div class="value">${data.avgSpeed.toFixed(1)}</div>
                                <div class="label">m/min</div>
                            </div>
                            <div class="mini-stat">
                                <div class="value">${data.avgRms.toFixed(0)}</div>
                                <div class="label">RMS</div>
                            </div>
                        </div>

                        <div class="mini-stats">
                            <div class="mini-stat">
                                <div class="value" style="color: #4CAF50;">${formatDuration(data.lyingTime)}</div>
                                <div class="label">Ležení</div>
                            </div>
                            <div class="mini-stat">
                                <div class="value" style="color: #FF9800;">${formatDuration(data.standingTime)}</div>
                                <div class="label">Stání</div>
                            </div>
                            <div class="mini-stat">
                                <div class="value" style="color: #2196F3;">${formatDuration(data.walkingTime)}</div>
                                <div class="label">Chůze</div>
                            </div>
                        </div>
                        ${standbyNote}

                        <div class="behavior-timeline-mini">
                            <div class="timeline-segment lying" style="width: ${lyingPct}%;">${lyingPct > 15 ? lyingPct.toFixed(0) + '%' : ''}</div>
                            <div class="timeline-segment standing" style="width: ${standingPct}%;">${standingPct > 15 ? standingPct.toFixed(0) + '%' : ''}</div>
                            <div class="timeline-segment walking" style="width: ${walkingPct}%;">${walkingPct > 15 ? walkingPct.toFixed(0) + '%' : ''}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderComparisonTable() {
        const table = document.getElementById('comparisonTable');
        if (!table) return;

        const datasets = selectedDays.map(d => processedData[d]).filter(Boolean);

        if (datasets.length === 0) {
            table.innerHTML = '<tr><td>Žádná data</td></tr>';
            return;
        }

        // Find best values for highlighting
        const maxDist = Math.max(...datasets.map(d => d.totalDistance));
        const maxLying = Math.max(...datasets.map(d => d.lyingTime));
        const maxSpeed = Math.max(...datasets.map(d => d.avgSpeed));

        const headerRow = `
            <tr>
                <th>Metrika</th>
                ${datasets.map((d, i) => `<th class="day-${i + 1}">${d.date}</th>`).join('')}
                <th>Průměr</th>
            </tr>
        `;

        const metrics = [
            { name: 'Celková vzdálenost', key: 'totalDistance', unit: 'm', format: v => v.toFixed(0), best: maxDist },
            { name: 'Vzdálenost - den', key: 'dayDistance', unit: 'm', format: v => v.toFixed(0) },
            { name: 'Vzdálenost - noc', key: 'nightDistance', unit: 'm', format: v => v.toFixed(0) },
            { name: 'Doba ležení', key: 'lyingTime', unit: '', format: formatDuration, best: maxLying },
            { name: 'Doba stání', key: 'standingTime', unit: '', format: formatDuration },
            { name: 'Doba chůze', key: 'walkingTime', unit: '', format: formatDuration },
            { name: 'StandBy→Ležení', key: 'standbyLyingTime', unit: '', format: formatDuration },
            { name: 'Průměrná rychlost', key: 'avgSpeed', unit: 'm/min', format: v => v.toFixed(2), best: maxSpeed },
            { name: 'Max rychlost', key: 'maxSpeed', unit: 'm/min', format: v => v.toFixed(2) },
            { name: 'RMS akcelerace', key: 'avgRms', unit: '', format: v => v.toFixed(0) },
            { name: 'Energetická náročnost', key: 'energyProxy', unit: '', format: v => v.toFixed(1) },
            { name: 'Počet záznamů', key: 'recordCount', unit: '', format: v => v }
        ];

        const rows = metrics.map(m => {
            const values = datasets.map(d => d[m.key]);
            const avg = values.reduce((a, b) => a + b, 0) / values.length;

            return `
                <tr>
                    <td class="metric-name">${m.name}</td>
                    ${values.map(v => {
                const cls = m.best && v === m.best ? 'highlight' : '';
                return `<td class="${cls}">${m.format(v)} ${m.unit}</td>`;
            }).join('')}
                    <td>${m.format(avg)} ${m.unit}</td>
                </tr>
            `;
        }).join('');

        table.innerHTML = headerRow + rows;
    }

    function renderCleaningSummary() {
        const container = document.getElementById('cleaningSummaryList');
        if (!container) return;

        const dayKeys = selectedDays.filter(day => processedData[day]);
        const keysToUse = dayKeys.length > 0 ? dayKeys : Object.keys(processedData);

        if (!keysToUse.length) {
            container.innerHTML = '<p class="cleaning-empty">Zatim zadna data.</p>';
            return;
        }

        let totalFake = 0;
        let totalLost = 0;
        const rows = [];

        for (const dateStr of keysToUse) {
            const day = processedData[dateStr];
            if (!day) continue;
            const summary = day.cleaningSummary || {};
            const datasetName = summary.datasetName || `ID${cowId}_${dateStr}.js`;
            const fake = Number(summary.fakeGpsRecords || 0);
            const lost = Number(summary.lostPackets || 0);
            totalFake += fake;
            totalLost += lost;

            rows.push(`
                <div class="cleaning-item">
                    <div class="cleaning-dataset">${datasetName}</div>
                    <div class="cleaning-stat">
                        <span>Fake GPS</span>
                        <strong>${formatNumber(fake)}</strong>
                    </div>
                    <div class="cleaning-stat">
                        <span>Lost data</span>
                        <strong>${formatNumber(lost)}</strong>
                    </div>
                </div>
            `);
        }

        container.innerHTML = `
            <div class="cleaning-aggregate">
                <div>
                    <span>Fake GPS celkem</span>
                    <strong>${formatNumber(totalFake)}</strong>
                </div>
                <div>
                    <span>Lost packets celkem</span>
                    <strong>${formatNumber(totalLost)}</strong>
                </div>
            </div>
            ${rows.join('')}
        `;
    }

    function renderCharts() {
        const datasets = selectedDays.map(d => processedData[d]).filter(Boolean);
        const labels = datasets.map(d => d.date);

        // Distance Comparison Chart
        const distanceChart = document.getElementById('distanceCompareChart');
        if (distanceChart) {
            new Chart(distanceChart, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Celková vzdálenost (m)',
                        data: datasets.map(d => d.totalDistance),
                        backgroundColor: selectedDays.map((_, i) => dayColors[i] + '80'),
                        borderColor: selectedDays.map((_, i) => dayColors[i]),
                        borderWidth: 2
                    }]
                },
                options: getChartOptions('Vzdálenost (m)')
            });
        }

        // Day/Night Stacked Chart
        const dayNightChart = document.getElementById('dayNightChart');
        if (dayNightChart) {
            new Chart(dayNightChart, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Den',
                            data: datasets.map(d => d.dayDistance),
                            backgroundColor: '#FFD700'
                        },
                        {
                            label: 'Noc',
                            data: datasets.map(d => d.nightDistance),
                            backgroundColor: '#4169E1'
                        }
                    ]
                },
                options: {
                    ...getChartOptions('Vzdálenost (m)'),
                    scales: {
                        x: { stacked: true, ticks: { color: '#aaa' } },
                        y: { stacked: true, ticks: { color: '#aaa' } }
                    }
                }
            });
        }

        // Behavior Comparison Chart
        const behaviorChart = document.getElementById('behaviorCompareChart');
        if (behaviorChart) {
            new Chart(behaviorChart, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Ležení',
                            data: datasets.map(d => d.lyingTime / 3600),
                            backgroundColor: '#4CAF50'
                        },
                        {
                            label: 'Stání',
                            data: datasets.map(d => d.standingTime / 3600),
                            backgroundColor: '#FF9800'
                        },
                        {
                            label: 'Chůze',
                            data: datasets.map(d => d.walkingTime / 3600),
                            backgroundColor: '#2196F3'
                        }
                    ]
                },
                options: {
                    ...getChartOptions('Hodiny'),
                    scales: {
                        x: { stacked: true, ticks: { color: '#aaa' } },
                        y: { stacked: true, ticks: { color: '#aaa' } }
                    }
                }
            });
        }

        // Speed Comparison Chart
        const speedChart = document.getElementById('speedCompareChart');
        if (speedChart) {
            new Chart(speedChart, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Průměrná rychlost',
                            data: datasets.map(d => d.avgSpeed),
                            borderColor: '#e94560',
                            backgroundColor: 'rgba(233, 69, 96, 0.2)',
                            fill: true,
                            tension: 0.3
                        },
                        {
                            label: 'Max rychlost',
                            data: datasets.map(d => d.maxSpeed),
                            borderColor: '#3498db',
                            borderDash: [5, 5],
                            fill: false,
                            tension: 0.3
                        }
                    ]
                },
                options: getChartOptions('Rychlost (m/min)')
            });
        }

        // RMS Comparison Chart
        const rmsChart = document.getElementById('rmsCompareChart');
        if (rmsChart) {
            new Chart(rmsChart, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'RMS akc.',
                        data: datasets.map(d => d.avgRms),
                        backgroundColor: selectedDays.map((_, i) => dayColors[i] + '80'),
                        borderColor: selectedDays.map((_, i) => dayColors[i]),
                        borderWidth: 2
                    }]
                },
                options: getChartOptions('RMS')
            });
        }

        // Energy Comparison Chart
        const energyChart = document.getElementById('energyCompareChart');
        if (energyChart) {
            new Chart(energyChart, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Energie',
                        data: datasets.map(d => d.energyProxy),
                        backgroundColor: selectedDays.map((_, i) => dayColors[i] + '80'),
                        borderColor: selectedDays.map((_, i) => dayColors[i]),
                        borderWidth: 2
                    }]
                },
                options: getChartOptions('Relativní jednotky')
            });
        }

        // Render comparison maps
        renderComparisonMaps();
    }

    function getChartOptions(yLabel) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#e0e0e0' } }
            },
            scales: {
                x: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                y: {
                    title: { display: true, text: yLabel, color: '#aaa' },
                    ticks: { color: '#aaa' },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                }
            }
        };
    }

    // ============================================================
    // MAP RENDERING
    // ============================================================

    function destroyCompareMaps() {
        Object.values(compareMapStates).forEach(state => {
            try { state.map.remove(); } catch { }
        });
        compareMapStates = {};
    }

    function renderComparisonMaps() {
        const dayGrid = document.getElementById('mapsDayGrid');
        const nightGrid = document.getElementById('mapsNightGrid');
        if (!dayGrid || !nightGrid) return;

        destroyCompareMaps();

        if (selectedDays.length === 0) {
            dayGrid.innerHTML = '<p style="color:#aaa;">Žádné vybrané dny.</p>';
            nightGrid.innerHTML = '';
            return;
        }

        dayGrid.innerHTML = selectedDays.map((dateStr) => buildMapCardMarkup(dateStr, true)).join('');
        nightGrid.innerHTML = selectedDays.map((dateStr) => buildMapCardMarkup(dateStr, false)).join('');

        setTimeout(() => {
            selectedDays.forEach((dateStr) => {
                const data = processedData[dateStr];
                if (!data) return;
                initCompareMap(`mapDay_${dateStr}`, data.dayPoints, data.dayHeatPoints, true, dateStr);
                initCompareMap(`mapNight_${dateStr}`, data.nightPoints, data.nightHeatPoints, false, dateStr);
            });

            // Central layer select - controls all maps at once
            const centralSelect = document.getElementById('centralLayerSelect');
            const centralLegend = document.getElementById('centralPointsLegend');
            if (centralSelect) {
                centralSelect.addEventListener('change', (evt) => {
                    const mode = evt.target.value;
                    // Toggle central legend visibility
                    if (centralLegend) {
                        centralLegend.style.display = mode === 'points' ? 'flex' : 'none';
                    }
                    // Apply to all maps
                    Object.keys(compareMapStates).forEach(mapId => {
                        toggleCompareMapLayer(mapId, mode);
                    });
                });
            }

            document.querySelectorAll('.compare-fullscreen-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const container = btn.closest('.compare-map-card');
                    if (!container) return;
                    const isFullscreen = container.classList.toggle('fullscreen');
                    btn.textContent = isFullscreen ? 'Zavřít fullscreen' : 'Celá obrazovka';
                    const mapId = btn.dataset.target;
                    setTimeout(() => {
                        const state = compareMapStates[mapId];
                        if (state?.map) state.map.invalidateSize();
                    }, 250);
                });
            });
        }, 150);
    }

    function buildMapCardMarkup(dateStr, isDay) {
        const label = formatDateDisplay(dateStr);
        const caption = isDay ? 'Den (06:00–17:59)' : 'Noc (18:00–05:59)';
        const mapId = `${isDay ? 'mapDay' : 'mapNight'}_${dateStr}`;
        return `
            <div class="compare-map-card" data-map-id="${mapId}">
                <h4>${label} <span style="color: var(--text-muted); font-size: 0.85em;">${caption}</span></h4>
                <div class="map-container">
                    <button class="map-fullscreen-btn compare-fullscreen-btn" data-target="${mapId}">Celá obrazovka</button>
                    <div class="map-wrapper">
                        <div id="${mapId}"></div>
                    </div>
                </div>
            </div>
        `;
    }

    // Indigo scale for standing markers (from core module or local)
    const INDIGO_SCALE = [
        { min: 0, max: 300, color: '#c7d2fe', size: 8 },      // 0-5 min
        { min: 300, max: 600, color: '#a5b4fc', size: 10 },   // 5-10 min
        { min: 600, max: 900, color: '#818cf8', size: 12 },   // 10-15 min
        { min: 900, max: Infinity, color: '#6366f1', size: 14 } // 15+ min
    ];

    // Orange scale for lying markers
    const ORANGE_SCALE = [
        { min: 0, max: 300, color: '#fed7aa', size: 8 },      // 0-5 min
        { min: 300, max: 600, color: '#fdba74', size: 10 },   // 5-10 min
        { min: 600, max: 900, color: '#fb923c', size: 12 },   // 10-15 min
        { min: 900, max: Infinity, color: '#f97316', size: 14 } // 15+ min
    ];

    function getMarkerStyle(durationSec, isLying) {
        const scale = isLying ? ORANGE_SCALE : INDIGO_SCALE;
        for (const level of scale) {
            if (durationSec >= level.min && durationSec < level.max) {
                return { color: level.color, size: level.size };
            }
        }
        return { color: scale[scale.length - 1].color, size: scale[scale.length - 1].size };
    }

    function initCompareMap(mapId, points, heatData, isDay, dateStr) {
        const mapEl = document.getElementById(mapId);
        if (!mapEl) return;

        const map = L.map(mapEl, {
            preferCanvas: true,
            zoomSnap: 0.1,
            zoomDelta: 0.1
        });

        // ESRI Maxar satellite tiles
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
        }).addTo(map);

        const pathPoints = Array.isArray(points) ? points : [];
        const heatPoints = Array.isArray(heatData) && heatData.length > 0
            ? heatData
            : pathPoints.map(p => [p[0], p[1], 0.55]);

        const color = isDay ? '#FFD700' : '#4169E1';

        // Heat layer
        const heatLayer = heatPoints.length ? L.heatLayer(heatPoints, {
            radius: 22,
            blur: 14,
            maxZoom: 17,
            gradient: { 0.4: 'blue', 0.6: 'lime', 0.8: 'yellow', 1: '#e94560' }
        }) : null;

        // Trajectory layer
        const trajectoryLayer = pathPoints.length >= 2 ? L.polyline(pathPoints, {
            color,
            weight: 3,
            opacity: 0.9
        }) : null;

        // Points layer (bodový graf) - created lazily
        let pointsLayer = null;
        // Arrows layer - created lazily
        let arrowsLayer = null;

        if (heatLayer) heatLayer.addTo(map);
        addFacilityOverlays(map);

        compareMapStates[mapId] = { map, heatLayer, trajectoryLayer, pointsLayer, arrowsLayer, pathPoints, isDay, dateStr };

        if (pathPoints.length) {
            const bounds = L.latLngBounds(pathPoints);
            map.fitBounds(bounds.pad(0.08));
        } else {
            map.setView(FACILITY_CENTER, 17);
        }
    }

    /**
     * Create points layer for a map (bodový graf)
     * Uses standing/lying clusters from processed data
     */
    function createPointsLayer(mapId) {
        const state = compareMapStates[mapId];
        if (!state || state.pointsLayer) return state?.pointsLayer;

        const dateStr = state.dateStr;
        const isDay = state.isDay;
        const data = processedData[dateStr];
        if (!data) return null;

        const layerGroup = L.layerGroup();

        // Get clusters based on day/night
        const lyingClusters = isDay ? (data.lyingClustersDay || []) : (data.lyingClustersNight || []);
        const standingClusters = isDay ? (data.standingClustersDay || []) : (data.standingClustersNight || []);

        // Fallback to all clusters if day/night specific not available
        const lyingData = lyingClusters.length > 0 ? lyingClusters : (data.lyingClusters || []);
        const standingData = standingClusters.length > 0 ? standingClusters : (data.standingClusters || []);

        // Create lying markers (triangles - orange)
        lyingData.forEach(cluster => {
            if (!cluster.lat || !cluster.lon) return;
            const style = getMarkerStyle(cluster.duration || cluster.durationSec || 300, true);
            const size = style.size;

            const icon = L.divIcon({
                className: 'points-marker-lying',
                html: `<div style="
                    width: 0;
                    height: 0;
                    border-left: ${size / 2}px solid transparent;
                    border-right: ${size / 2}px solid transparent;
                    border-bottom: ${size}px solid ${style.color};
                    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
                "></div>`,
                iconSize: [size, size],
                iconAnchor: [size / 2, size]
            });

            const durationMin = ((cluster.duration || cluster.durationSec || 0) / 60).toFixed(1);
            L.marker([cluster.lat, cluster.lon], { icon })
                .bindPopup(`Ležení: ${durationMin} min`)
                .addTo(layerGroup);
        });

        // Create standing markers (squares - indigo)
        standingData.forEach(cluster => {
            if (!cluster.lat || !cluster.lon) return;
            const style = getMarkerStyle(cluster.duration || cluster.durationSec || 300, false);
            const size = style.size;

            const icon = L.divIcon({
                className: 'points-marker-standing',
                html: `<div style="
                    width: ${size}px;
                    height: ${size}px;
                    background: ${style.color};
                    border: 1px solid rgba(255,255,255,0.5);
                    box-shadow: 0 1px 3px rgba(0,0,0,0.4);
                "></div>`,
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2]
            });

            const durationMin = ((cluster.duration || cluster.durationSec || 0) / 60).toFixed(1);
            L.marker([cluster.lat, cluster.lon], { icon })
                .bindPopup(`Stání: ${durationMin} min`)
                .addTo(layerGroup);
        });

        state.pointsLayer = layerGroup;
        return layerGroup;
    }

    /**
     * Create arrows layer for trajectory direction indication
     * Arrows are placed every ~20m along the trajectory
     */
    function createArrowsLayer(mapId) {
        const state = compareMapStates[mapId];
        if (!state || state.arrowsLayer) return state?.arrowsLayer;

        const pathPoints = state.pathPoints || [];
        if (pathPoints.length < 2) return null;

        const arrowGroup = L.layerGroup();
        const ARROW_SPACING_M = 20; // Arrow every 20 meters

        let accumulatedDist = 0;
        for (let i = 1; i < pathPoints.length; i++) {
            const p1 = pathPoints[i - 1];
            const p2 = pathPoints[i];
            const segDist = haversineDistance(p1[0], p1[1], p2[0], p2[1]);
            accumulatedDist += segDist;

            if (accumulatedDist >= ARROW_SPACING_M) {
                accumulatedDist = 0;

                // Calculate arrow direction
                const dLat = p2[0] - p1[0];
                const dLon = p2[1] - p1[1];
                const angle = Math.atan2(dLon, dLat) * 180 / Math.PI;

                // Arrow icon
                const arrowIcon = L.divIcon({
                    className: 'trajectory-arrow',
                    html: `<div style="
                        transform: rotate(${angle - 90}deg);
                        font-size: 14px;
                        color: #111;
                        text-shadow: 0 0 2px #fff, 0 0 4px #fff;
                        font-weight: bold;
                    ">➤</div>`,
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                });

                L.marker(p2, { icon: arrowIcon, interactive: false }).addTo(arrowGroup);
            }
        }

        state.arrowsLayer = arrowGroup;
        return arrowGroup;
    }

    function toggleCompareMapLayer(mapId, mode) {
        const state = compareMapStates[mapId];
        if (!state) return;

        const showHeat = mode === 'heat';
        const showTrajectory = mode === 'trajectory' || mode === 'trajectory-arrows';
        const showArrows = mode === 'trajectory-arrows';
        const showPoints = mode === 'points';

        // Heat layer
        if (state.heatLayer) {
            const hasHeat = state.map.hasLayer(state.heatLayer);
            if (showHeat && !hasHeat) state.heatLayer.addTo(state.map);
            if (!showHeat && hasHeat) state.map.removeLayer(state.heatLayer);
        }

        // Trajectory layer
        if (state.trajectoryLayer) {
            const hasTraj = state.map.hasLayer(state.trajectoryLayer);
            if (showTrajectory && !hasTraj) state.trajectoryLayer.addTo(state.map);
            if (!showTrajectory && hasTraj) state.map.removeLayer(state.trajectoryLayer);
        }

        // Arrows layer - create lazily if needed
        if (showArrows) {
            if (!state.arrowsLayer) {
                createArrowsLayer(mapId);
            }
            if (state.arrowsLayer && !state.map.hasLayer(state.arrowsLayer)) {
                state.arrowsLayer.addTo(state.map);
            }
        } else if (state.arrowsLayer && state.map.hasLayer(state.arrowsLayer)) {
            state.map.removeLayer(state.arrowsLayer);
        }

        // Points layer (bodový graf) - create lazily if needed
        if (showPoints) {
            if (!state.pointsLayer) {
                createPointsLayer(mapId);
            }
            if (state.pointsLayer && !state.map.hasLayer(state.pointsLayer)) {
                state.pointsLayer.addTo(state.map);
            }
        } else if (state.pointsLayer && state.map.hasLayer(state.pointsLayer)) {
            state.map.removeLayer(state.pointsLayer);
        }
    }

    /**
     * Add facility overlays (fences, zones, center marker) to map
     */
    function addFacilityOverlays(map) {
        const group = L.layerGroup();

        const makePoly = (coords, options, popup) => {
            const layer = L.polygon(coords, options);
            if (popup) layer.bindPopup(popup);
            layer.addTo(group);
        };

        const fenceColors = ['#ff2d55', '#ff2d55', '#4c0519'];
        RED_FENCES.forEach((coords, idx) => {
            if (!coords) return;
            makePoly(coords, {
                color: fenceColors[idx] || '#ff2d55',
                weight: idx === 0 ? 4 : 3,
                opacity: idx === 0 ? 0.95 : 0.8,
                dashArray: idx === 0 ? null : '8 6',
                fillColor: idx === 2 ? '#fda4af' : '#fee2e2',
                fillOpacity: 0.3
            }, `RED FENCE ${idx + 1}`);
        });

        // Zone A
        makePoly(ZONE_A, {
            color: '#a855f7',
            weight: 3,
            opacity: 0.9
        }, 'Klidová zóna A');

        // Zone B
        makePoly(ZONE_B, {
            color: '#38bdf8',
            weight: 3,
            opacity: 0.9
        }, 'Zimoviště B');

        // Zone C
        makePoly(ZONE_C, {
            color: '#451a03',
            weight: 3,
            opacity: 0.9
        }, 'Zóna C');

        // Facility center marker
        L.circleMarker(FACILITY_CENTER, {
            radius: 6,
            color: '#ffffff',
            weight: 2,
            opacity: 0.95,
            fillColor: '#e94560',
            fillOpacity: 0.9
        }).bindPopup('Střed areálu').addTo(group);

        // Distance rings
        const rings = [50, 100, 150];
        for (const r of rings) {
            try {
                L.circle(FACILITY_CENTER, {
                    radius: r,
                    color: '#ffffff',
                    weight: 1,
                    opacity: 0.55,
                    fill: false,
                    dashArray: '4 6'
                }).bindTooltip(`${r} m`, { permanent: false, direction: 'center' }).addTo(group);
            } catch { }
        }

        group.addTo(map);

        // Scale bar
        try {
            L.control.scale({
                position: 'bottomleft',
                metric: true,
                imperial: false,
                maxWidth: 160
            }).addTo(map);
        } catch { }
    }

    // ============================================================
    // WEATHER DATA (Open-Meteo API)
    // ============================================================

    /**
     * Convert ddmmyy to YYYY-MM-DD
     */
    function ddmmyyToISO(dateStr) {
        const dd = dateStr.substring(0, 2);
        const mm = dateStr.substring(2, 4);
        const yy = dateStr.substring(4, 6);
        return `20${yy}-${mm}-${dd}`;
    }

    /**
     * Fetch weather data from Open-Meteo Historical API for all selected days
     */
    async function fetchWeatherData() {
        weatherData = {};
        const lat = FACILITY_CENTER[0];
        const lon = FACILITY_CENTER[1];

        for (const dateStr of selectedDays) {
            const isoDate = ddmmyyToISO(dateStr);
            const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${isoDate}&end_date=${isoDate}&hourly=temperature_2m,relative_humidity_2m&timezone=Europe%2FPrague`;

            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const json = await response.json();

                const hours = json.hourly.time.map(t => new Date(t).getHours());
                const temps = json.hourly.temperature_2m;
                const hum = json.hourly.relative_humidity_2m;

                const targetHours = [0, 6, 12, 18];
                const pickedTemps = [];
                const pickedHum = [];

                for (const h of targetHours) {
                    const idx = hours.indexOf(h);
                    pickedTemps.push(idx >= 0 ? temps[idx] : null);
                    pickedHum.push(idx >= 0 ? hum[idx] : null);
                }

                weatherData[dateStr] = {
                    temps: pickedTemps,
                    humidity: pickedHum,
                    allTemps: temps,
                    allHumidity: hum
                };
            } catch (e) {
                console.warn(`Weather fetch failed for ${dateStr}:`, e);
                weatherData[dateStr] = null;
            }
        }
    }

    /**
     * Render weather charts and summary cards
     */
    function renderWeatherSection() {
        const cardsContainer = document.getElementById('weatherSummaryCards');
        const tempCanvas = document.getElementById('tempCompareChart');
        const humCanvas = document.getElementById('humidityCompareChart');
        if (!cardsContainer || !tempCanvas || !humCanvas) return;

        const hasData = selectedDays.some(d => weatherData[d]);
        if (!hasData) {
            cardsContainer.innerHTML = '<div style="color: #ff6b6b; padding: 10px;">Nepodařilo se načíst meteorologická data z Open-Meteo API. Zkontrolujte připojení k internetu.</div>';
            return;
        }

        // Summary cards
        cardsContainer.innerHTML = selectedDays.map((dateStr, i) => {
            const w = weatherData[dateStr];
            if (!w) return '';
            const data = processedData[dateStr];
            const label = data ? data.date : dateStr;
            const validTemps = w.allTemps.filter(t => t !== null);
            const minT = Math.min(...validTemps).toFixed(1);
            const maxT = Math.max(...validTemps).toFixed(1);
            const avgH = (w.humidity.filter(h => h !== null).reduce((a, b) => a + b, 0) / w.humidity.filter(h => h !== null).length).toFixed(0);
            return `
                <div style="background: ${dayColors[i]}22; border: 1px solid ${dayColors[i]}; border-radius: 8px; padding: 10px 15px; min-width: 140px;">
                    <div style="color: ${dayColors[i]}; font-weight: bold; margin-bottom: 5px;">${label}</div>
                    <div style="color: #e0e0e0; font-size: 0.85em;">🌡️ ${minT}°C / ${maxT}°C</div>
                    <div style="color: #e0e0e0; font-size: 0.85em;">💧 ${avgH}% vlhkost</div>
                </div>
            `;
        }).join('');

        // Temperature line chart
        const timeLabels = ['0:00', '06:00', '12:00', '18:00'];
        const tempDatasets = selectedDays.map((dateStr, i) => {
            const w = weatherData[dateStr];
            const data = processedData[dateStr];
            const label = data ? data.date : dateStr;
            return {
                label: label,
                data: w ? w.temps : [null, null, null, null],
                borderColor: dayColors[i],
                backgroundColor: dayColors[i] + '33',
                tension: 0.3,
                pointRadius: 5,
                pointBackgroundColor: dayColors[i],
                fill: false
            };
        });

        new Chart(tempCanvas, {
            type: 'line',
            data: { labels: timeLabels, datasets: tempDatasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#e0e0e0' } },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) {
                                return `${ctx.dataset.label}: ${ctx.parsed.y}°C`;
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                    y: {
                        title: { display: true, text: 'Teplota (°C)', color: '#aaa' },
                        ticks: { color: '#aaa' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    }
                }
            }
        });

        // Humidity grouped bar chart
        const humDatasets = selectedDays.map((dateStr, i) => {
            const w = weatherData[dateStr];
            const data = processedData[dateStr];
            const label = data ? data.date : dateStr;
            return {
                label: label,
                data: w ? w.humidity : [null, null, null, null],
                backgroundColor: dayColors[i] + '80',
                borderColor: dayColors[i],
                borderWidth: 1
            };
        });

        new Chart(humCanvas, {
            type: 'bar',
            data: { labels: timeLabels, datasets: humDatasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#e0e0e0' } },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) {
                                return `${ctx.dataset.label}: ${ctx.parsed.y}%`;
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                    y: {
                        title: { display: true, text: 'Vlhkost (%)', color: '#aaa' },
                        ticks: { color: '#aaa' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        min: 0,
                        max: 100
                    }
                }
            }
        });
    }

    // ============================================================
    // COLLAPSIBLE SECTIONS
    // ============================================================

    function toggleSection(sectionId) {
        const section = document.getElementById(sectionId);
        if (section) {
            section.classList.toggle('collapsed');
        }
    }

    // ============================================================
    // FULLSCREEN MAPS MODE
    // ============================================================

    let fullscreenMapStates = {};
    let fsSelectedDays = [];

    /**
     * Open fullscreen maps overlay
     */
    function openMapsFullscreen() {
        const overlay = document.getElementById('mapsFullscreenOverlay');
        if (!overlay) return;

        // Initialize selected days (first 2 or 4 depending on available)
        fsSelectedDays = selectedDays.slice(0, Math.min(2, selectedDays.length));

        // Generate day selection checkboxes
        renderFsDaySelection();

        // Render maps
        renderFullscreenMaps();

        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Close fullscreen maps overlay
     */
    function closeMapsFullscreen() {
        const overlay = document.getElementById('mapsFullscreenOverlay');
        if (!overlay) return;

        // Destroy fullscreen maps
        Object.values(fullscreenMapStates).forEach(state => {
            try { state.map.remove(); } catch { }
        });
        fullscreenMapStates = {};

        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    /**
     * Render day selection checkboxes in fullscreen footer
     */
    function renderFsDaySelection() {
        const container = document.getElementById('fsDaysSelection');
        if (!container) return;

        const maxMaps = parseInt(document.getElementById('fsMapsCount')?.value || '2');

        container.innerHTML = selectedDays.map((dateStr, index) => {
            const isChecked = fsSelectedDays.includes(dateStr);
            const isDisabled = !isChecked && fsSelectedDays.length >= maxMaps;
            return `
                <label style="display: flex; align-items: center; gap: 6px; padding: 6px 12px;
                       background: ${isChecked ? dayColors[index] : 'rgba(255,255,255,0.1)'};
                       border-radius: 20px; cursor: ${isDisabled ? 'not-allowed' : 'pointer'};
                       opacity: ${isDisabled ? '0.5' : '1'};">
                    <input type="checkbox"
                           value="${dateStr}"
                           ${isChecked ? 'checked' : ''}
                           ${isDisabled ? 'disabled' : ''}
                           onchange="window.ComparativeAnalysis.toggleFsDay('${dateStr}')"
                           style="cursor: inherit;">
                    <span style="color: #fff; font-size: 0.9em;">${formatDateDisplay(dateStr)}</span>
                </label>
            `;
        }).join('');
    }

    /**
     * Toggle day selection in fullscreen mode
     */
    function toggleFsDay(dateStr) {
        const maxMaps = parseInt(document.getElementById('fsMapsCount')?.value || '2');
        const index = fsSelectedDays.indexOf(dateStr);

        if (index !== -1) {
            // Remove
            fsSelectedDays.splice(index, 1);
        } else if (fsSelectedDays.length < maxMaps) {
            // Add
            fsSelectedDays.push(dateStr);
        }

        renderFsDaySelection();
        renderFullscreenMaps();
    }

    /**
     * Render fullscreen maps grid
     */
    function renderFullscreenMaps() {
        const body = document.getElementById('fsMapsBody');
        if (!body) return;

        // Destroy existing maps
        Object.values(fullscreenMapStates).forEach(state => {
            try { state.map.remove(); } catch { }
        });
        fullscreenMapStates = {};

        const count = parseInt(document.getElementById('fsMapsCount')?.value || '2');
        const period = document.getElementById('fsMapsPeriod')?.value || 'day';
        const layer = document.getElementById('fsMapsLayer')?.value || 'heat';

        // Update grid class
        body.className = `maps-fullscreen-body grid-${count}`;

        // Generate cells
        const daysToShow = fsSelectedDays.slice(0, count);

        if (daysToShow.length === 0) {
            body.innerHTML = '<div style="grid-column: 1/-1; display: flex; align-items: center; justify-content: center; color: var(--text-muted);">Vyberte alespoň jeden den</div>';
            return;
        }

        body.innerHTML = daysToShow.map((dateStr, i) => {
            const mapId = `fsMap_${i}_${dateStr}`;
            const dayIndex = selectedDays.indexOf(dateStr);
            const label = formatDateDisplay(dateStr);
            const periodLabel = period === 'day' ? 'Den' : 'Noc';

            return `
                <div class="fullscreen-map-cell">
                    <div class="cell-header" style="border-left: 4px solid ${dayColors[dayIndex]};">
                        <span>${label} - ${periodLabel}</span>
                        <span style="color: var(--text-muted); font-size: 0.85em;">${period === 'day' ? '06:00–17:59' : '18:00–05:59'}</span>
                    </div>
                    <div class="cell-map" id="${mapId}"></div>
                </div>
            `;
        }).join('');

        // Initialize maps after DOM update
        setTimeout(() => {
            daysToShow.forEach((dateStr, i) => {
                const mapId = `fsMap_${i}_${dateStr}`;
                const data = processedData[dateStr];
                if (!data) return;

                const isDay = period === 'day';
                const points = isDay ? data.dayPoints : data.nightPoints;
                const heatData = isDay ? data.dayHeatPoints : data.nightHeatPoints;

                initFullscreenMap(mapId, points, heatData, isDay, dateStr, layer);
            });
        }, 100);
    }

    /**
     * Initialize a single fullscreen map
     */
    function initFullscreenMap(mapId, points, heatData, isDay, dateStr, layerMode) {
        const mapEl = document.getElementById(mapId);
        if (!mapEl) return;

        const map = L.map(mapEl, {
            preferCanvas: true,
            zoomSnap: 0.1,
            zoomDelta: 0.1
        });

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles © Esri'
        }).addTo(map);

        const pathPoints = Array.isArray(points) ? points : [];
        const heatPoints = Array.isArray(heatData) && heatData.length > 0
            ? heatData
            : pathPoints.map(p => [p[0], p[1], 0.55]);

        const color = isDay ? '#FFD700' : '#4169E1';

        // Create layers
        const heatLayer = heatPoints.length ? L.heatLayer(heatPoints, {
            radius: 22,
            blur: 14,
            maxZoom: 17,
            gradient: { 0.4: 'blue', 0.6: 'lime', 0.8: 'yellow', 1: '#e94560' }
        }) : null;

        const trajectoryLayer = pathPoints.length >= 2 ? L.polyline(pathPoints, {
            color,
            weight: 3,
            opacity: 0.9
        }) : null;

        addFacilityOverlays(map);

        fullscreenMapStates[mapId] = {
            map,
            heatLayer,
            trajectoryLayer,
            pointsLayer: null,
            arrowsLayer: null,
            pathPoints,
            isDay,
            dateStr
        };

        // Apply initial layer
        toggleFsMapLayer(mapId, layerMode);

        if (pathPoints.length) {
            const bounds = L.latLngBounds(pathPoints);
            map.fitBounds(bounds.pad(0.08));
        } else {
            map.setView(FACILITY_CENTER, 17);
        }
    }

    /**
     * Toggle layer for a fullscreen map
     */
    function toggleFsMapLayer(mapId, mode) {
        const state = fullscreenMapStates[mapId];
        if (!state) return;

        const showHeat = mode === 'heat';
        const showTrajectory = mode === 'trajectory' || mode === 'trajectory-arrows';
        const showArrows = mode === 'trajectory-arrows';
        const showPoints = mode === 'points';

        // Heat layer
        if (state.heatLayer) {
            const hasHeat = state.map.hasLayer(state.heatLayer);
            if (showHeat && !hasHeat) state.heatLayer.addTo(state.map);
            if (!showHeat && hasHeat) state.map.removeLayer(state.heatLayer);
        }

        // Trajectory layer
        if (state.trajectoryLayer) {
            const hasTraj = state.map.hasLayer(state.trajectoryLayer);
            if (showTrajectory && !hasTraj) state.trajectoryLayer.addTo(state.map);
            if (!showTrajectory && hasTraj) state.map.removeLayer(state.trajectoryLayer);
        }

        // Arrows layer
        if (showArrows) {
            if (!state.arrowsLayer) {
                state.arrowsLayer = createFsArrowsLayer(state);
            }
            if (state.arrowsLayer && !state.map.hasLayer(state.arrowsLayer)) {
                state.arrowsLayer.addTo(state.map);
            }
        } else if (state.arrowsLayer && state.map.hasLayer(state.arrowsLayer)) {
            state.map.removeLayer(state.arrowsLayer);
        }

        // Points layer
        if (showPoints) {
            if (!state.pointsLayer) {
                state.pointsLayer = createFsPointsLayer(state);
            }
            if (state.pointsLayer && !state.map.hasLayer(state.pointsLayer)) {
                state.pointsLayer.addTo(state.map);
            }
        } else if (state.pointsLayer && state.map.hasLayer(state.pointsLayer)) {
            state.map.removeLayer(state.pointsLayer);
        }
    }

    /**
     * Create arrows layer for fullscreen map
     */
    function createFsArrowsLayer(state) {
        const pathPoints = state.pathPoints || [];
        if (pathPoints.length < 2) return null;

        const arrowGroup = L.layerGroup();
        const ARROW_SPACING_M = 20;
        let accumulatedDist = 0;

        for (let i = 1; i < pathPoints.length; i++) {
            const p1 = pathPoints[i - 1];
            const p2 = pathPoints[i];
            const segDist = haversineDistance(p1[0], p1[1], p2[0], p2[1]);
            accumulatedDist += segDist;

            if (accumulatedDist >= ARROW_SPACING_M) {
                accumulatedDist = 0;
                const dLat = p2[0] - p1[0];
                const dLon = p2[1] - p1[1];
                const angle = Math.atan2(dLon, dLat) * 180 / Math.PI;

                const arrowIcon = L.divIcon({
                    className: 'trajectory-arrow',
                    html: `<div style="transform: rotate(${angle - 90}deg); font-size: 14px; color: #111; text-shadow: 0 0 2px #fff, 0 0 4px #fff; font-weight: bold;">➤</div>`,
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                });
                L.marker(p2, { icon: arrowIcon, interactive: false }).addTo(arrowGroup);
            }
        }
        return arrowGroup;
    }

    /**
     * Create points layer for fullscreen map
     */
    function createFsPointsLayer(state) {
        const dateStr = state.dateStr;
        const isDay = state.isDay;
        const data = processedData[dateStr];
        if (!data) return null;

        const layerGroup = L.layerGroup();

        const lyingClusters = isDay ? (data.lyingClustersDay || []) : (data.lyingClustersNight || []);
        const standingClusters = isDay ? (data.standingClustersDay || []) : (data.standingClustersNight || []);

        const lyingData = lyingClusters.length > 0 ? lyingClusters : (data.lyingClusters || []);
        const standingData = standingClusters.length > 0 ? standingClusters : (data.standingClusters || []);

        // Lying markers (triangles)
        lyingData.forEach(cluster => {
            if (!cluster.lat || !cluster.lon) return;
            const style = getMarkerStyle(cluster.duration || cluster.durationSec || 300, true);
            const size = style.size;

            const icon = L.divIcon({
                className: 'points-marker-lying',
                html: `<div style="width:0;height:0;border-left:${size / 2}px solid transparent;border-right:${size / 2}px solid transparent;border-bottom:${size}px solid ${style.color};filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5));"></div>`,
                iconSize: [size, size],
                iconAnchor: [size / 2, size]
            });

            L.marker([cluster.lat, cluster.lon], { icon })
                .bindPopup(`Ležení: ${((cluster.duration || cluster.durationSec || 0) / 60).toFixed(1)} min`)
                .addTo(layerGroup);
        });

        // Standing markers (squares)
        standingData.forEach(cluster => {
            if (!cluster.lat || !cluster.lon) return;
            const style = getMarkerStyle(cluster.duration || cluster.durationSec || 300, false);
            const size = style.size;

            const icon = L.divIcon({
                className: 'points-marker-standing',
                html: `<div style="width:${size}px;height:${size}px;background:${style.color};border:1px solid rgba(255,255,255,0.5);box-shadow:0 1px 3px rgba(0,0,0,0.4);"></div>`,
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2]
            });

            L.marker([cluster.lat, cluster.lon], { icon })
                .bindPopup(`Stání: ${((cluster.duration || cluster.durationSec || 0) / 60).toFixed(1)} min`)
                .addTo(layerGroup);
        });

        return layerGroup;
    }

    /**
     * Update all fullscreen maps layer
     */
    function updateFsMapsLayer() {
        const layer = document.getElementById('fsMapsLayer')?.value || 'heat';
        Object.keys(fullscreenMapStates).forEach(mapId => {
            toggleFsMapLayer(mapId, layer);
        });
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    function init() {
        // Wizard step 1 - next button
        const step1Next = document.getElementById('step1Next');
        if (step1Next) {
            step1Next.addEventListener('click', () => {
                const input = document.getElementById('cowIdInput').value.trim();
                const error = document.getElementById('step1Error');

                if (!/^\d{6,7}$/.test(input)) {
                    error.textContent = 'ID musí být 6-7 číslic.';
                    error.style.display = 'block';
                    return;
                }

                cowId = input;
                // Read calving and bull dates
                const calvingInput = document.getElementById('calvingDateInput');
                const bullInput = document.getElementById('bullDateInput');
                calvingDate = calvingInput ? calvingInput.value : null;
                bullEndDate = bullInput ? bullInput.value : null;

                error.style.display = 'none';
                document.getElementById('step1Card').style.display = 'none';
                document.getElementById('step2Card').style.display = 'block';
                renderCalendar();
            });
        }

        // Wizard step 2 - back button
        const step2Back = document.getElementById('step2Back');
        if (step2Back) {
            step2Back.addEventListener('click', () => {
                document.getElementById('step2Card').style.display = 'none';
                document.getElementById('step1Card').style.display = 'block';
            });
        }

        // Wizard step 2 - start analysis
        const step2Start = document.getElementById('step2Start');
        if (step2Start) {
            step2Start.addEventListener('click', startAnalysis);
        }

        // Change selection button
        const changeBtn = document.getElementById('changeSelectionBtn');
        if (changeBtn) {
            changeBtn.addEventListener('click', () => {
                document.getElementById('wizardOverlay').classList.remove('hidden');
                document.getElementById('mainContent').classList.add('hidden');
                document.getElementById('step2Card').style.display = 'block';
                document.getElementById('step1Card').style.display = 'none';
            });
        }

        // Export button
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => window.print());
        }

        // Expand/collapse all buttons
        const expandAll = document.getElementById('expandAllBtn');
        if (expandAll) {
            expandAll.addEventListener('click', () => {
                document.querySelectorAll('.collapsible-section').forEach(s => s.classList.remove('collapsed'));
            });
        }

        const collapseAll = document.getElementById('collapseAllBtn');
        if (collapseAll) {
            collapseAll.addEventListener('click', () => {
                document.querySelectorAll('.collapsible-section').forEach(s => s.classList.add('collapsed'));
            });
        }

        // Calendar navigation
        const prevMonth = document.getElementById('prevMonth');
        if (prevMonth) {
            prevMonth.addEventListener('click', () => {
                currentMonth--;
                if (currentMonth < 0) { currentMonth = 11; currentYear--; }
                renderCalendar();
            });
        }

        const nextMonth = document.getElementById('nextMonth');
        if (nextMonth) {
            nextMonth.addEventListener('click', () => {
                currentMonth++;
                if (currentMonth > 11) { currentMonth = 0; currentYear++; }
                renderCalendar();
            });
        }

        // Enter key support in cow ID input
        const cowIdInput = document.getElementById('cowIdInput');
        if (cowIdInput) {
            cowIdInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && step1Next) step1Next.click();
            });
        }

        // Fullscreen maps controls
        const openFsBtn = document.getElementById('openMapsFullscreen');
        if (openFsBtn) {
            openFsBtn.addEventListener('click', openMapsFullscreen);
        }

        const closeFsBtn = document.getElementById('closeMapsFullscreen');
        if (closeFsBtn) {
            closeFsBtn.addEventListener('click', closeMapsFullscreen);
        }

        const fsPeriod = document.getElementById('fsMapsPeriod');
        if (fsPeriod) {
            fsPeriod.addEventListener('change', renderFullscreenMaps);
        }

        const fsCount = document.getElementById('fsMapsCount');
        if (fsCount) {
            fsCount.addEventListener('change', () => {
                renderFsDaySelection();
                renderFullscreenMaps();
            });
        }

        const fsLayer = document.getElementById('fsMapsLayer');
        if (fsLayer) {
            fsLayer.addEventListener('change', updateFsMapsLayer);
        }

        // ESC key to close fullscreen
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const overlay = document.getElementById('mapsFullscreenOverlay');
                if (overlay && overlay.classList.contains('active')) {
                    closeMapsFullscreen();
                }
            }
        });

        // Initial calendar render
        renderCalendar();
    }

    // Expose public API for HTML onclick handlers
    window.ComparativeAnalysis = {
        toggleDay,
        removeDay,
        toggleSection,
        toggleFsDay
    };

    // Global function for collapsible sections (used by onclick in HTML)
    window.toggleSection = toggleSection;

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

(function () {
    'use strict';

    // ============================================================
    // OneDay analysis v2.0 - Enhanced Behavioral Analysis
    // Dataset filename: IDXXXXXX_ddmmyy.js (same folder as HTML)
    // 
    // Improvements:
    // - GPS ↔ Accelerometer cross-validation
    // - Breeding cycle awareness (bull present Oct-end, absent Nov-Mar)
    // - Pre-parturition behavior detection
    // - Enhanced posture classification with confidence scores
    // - Standing zone detection (>3 min stationary)
    // - Movement type classification (grazing, walking, fast walk, running)
    // ============================================================

    // ---- Configuration Constants
    const DAY_START_SEC = 6 * 3600;   // 06:00
    const DAY_END_SEC = 18 * 3600;    // 18:00
    const DAY_TOTAL_SEC = 24 * 3600;  // 24h
    const MAX_SEGMENTS_IN_TABLE = 220;
    const MAX_INTERVAL_SEC = 3600;    // Max gap to interpolate (60 min - extended for StandBy)
    
    // StandBy Mode Detection (FMB920 battery saving)
    // UPDATED 16.01.2026: New time-based Deep Sleep configuration
    // - Old mode: Accelerometer-triggered (sleep after 60s no movement, wake on movement)
    //   This mode was inefficient (~0.2% daily sleep time)
    // - New mode: Time-based Deep Sleep (records every ~3 minutes regardless of movement)
    //   This provides ~60-70% battery savings while maintaining adequate tracking
    // - IO 200 = 0 in records is NORMAL (device is awake when recording)
    // - Gaps of ~180s between records indicate proper Deep Sleep operation
    const STANDBY_THRESHOLD_SEC = 60;         // Gap > 60s indicates StandBy/Sleep mode
    const STANDBY_MAX_DURATION_SEC = 3600;    // Max realistic StandBy duration (1 hour)
    const STANDBY_BEHAVIOR = 'lying';         // Default behavior during StandBy (stationary = likely lying/resting)
    
    // Interpolation settings
    const INTERPOLATION_TARGET_HZ = 1;        // Target frequency: 1 sample per second
    const INTERPOLATION_ENABLED = true;       // Enable 1Hz interpolation
    const INTERPOLATION_METHOD = 'linear';    // 'linear', 'cubic', 'hold' (last value)
    
    // GPS Movement Thresholds (meters)
    const GPS_STATIONARY_THRESHOLD_M = 1.0;      // <1m = definitely stationary
    const GPS_SLOW_WALK_THRESHOLD_M = 2.0;       // 1-2m = slow movement/grazing
    const GPS_NORMAL_WALK_THRESHOLD_M = 5.0;     // 2-5m = normal walk
    const GPS_FAST_WALK_THRESHOLD_M = 15.0;      // 5-15m = fast walk
    // >15m = running/stress (per interval, depends on dt)
    
    // GPS Speed Thresholds (m/s)
    const SPEED_STATIONARY_MPS = 0.02;           // <0.02 m/s = stationary
    const SPEED_GRAZING_MPS = 0.08;              // <0.08 m/s = grazing
    const SPEED_SLOW_WALK_MPS = 0.25;            // <0.25 m/s = slow walk
    const SPEED_NORMAL_WALK_MPS = 0.8;           // <0.8 m/s = normal walk
    const SPEED_FAST_WALK_MPS = 1.5;             // <1.5 m/s = fast walk
    const SPEED_RUNNING_MPS = 3.0;               // >1.5 m/s = running
    
    // Accelerometer Constants (Teltonika FMB920)
    const ACC_SCALE = 1024;                      // Raw units per 1g
    const ACC_GRAVITY_G = 1.0;                   // Expected gravity
    const ACC_GRAVITY_TOLERANCE = 0.15;          // ±15% tolerance for static detection
    const GRAVITY_FILTER_SAMPLE_RATE_HZ = 1;     // Po resamplingu pracujeme s 1 Hz daty
    const GRAVITY_CUTOFF_HZ = 0.5;               // Specifikovaný low-pass práh
    const POSTURE_WINDOW_SEC = 60;               // Variance window
    const POSTURE_VARIANCE_THRESHOLD_G2 = 0.05;
    const POSTURE_MIN_DURATION_SEC = 300;        // 5 minut hystereze
    const TILT_STANDING_MAX_DEG = 35;
    const TILT_LYING_MIN_DEG = 55;
    const POSTURE_LOW_CONFIDENCE_THRESHOLD = 0.6;
    const CALIBRATION_HOURS = 24;
    const CALIBRATION_MIN_WINDOWS = 10;
    const CALIBRATION_VARIANCE_THRESHOLD_G2 = 0.02;
    const CALIBRATION_MAG_MIN_G = 0.9;
    const CALIBRATION_MAG_MAX_G = 1.1;
    
    // Posture Detection Thresholds (normalized gravity vector)
    const POSTURE_LYING_AZ_MAX = 0.45;           // Z-axis < 45% = lying (side)
    const POSTURE_LYING_AXAY_MIN = 0.75;         // X or Y > 75% = lying
    const POSTURE_STANDING_AZ_MIN = 0.85;        // Z-axis > 85% = standing
    const POSTURE_STANDING_AXAY_MAX = 0.30;      // X,Y each < 30% = standing
    
    // Dynamic Acceleration Thresholds
    const ACC_DYN_STATIONARY_G = 0.05;           // <0.05g = completely still
    const ACC_DYN_RUMINATING_G = 0.12;           // <0.12g = ruminating/subtle movement
    const ACC_DYN_GRAZING_G = 0.20;              // <0.20g = grazing (head movement)
    const ACC_DYN_WALKING_G = 0.35;              // <0.35g = walking
    const ACC_DYN_FAST_WALK_G = 0.55;            // <0.55g = fast walking
    // >0.55g = running or stress event
    
    // Step Detection
    const ACC_STEP_THRESHOLD = 100;              // Minimum acc change for step
    const STEP_FREQ_GRAZING_HZ = 0.5;            // <0.5 Hz = grazing
    const STEP_FREQ_SLOW_WALK_HZ = 1.0;          // 0.5-1.0 Hz = slow walk
    const STEP_FREQ_NORMAL_WALK_HZ = 1.5;        // 1.0-1.5 Hz = normal walk
    const STEP_FREQ_FAST_WALK_HZ = 2.5;          // 1.5-2.5 Hz = fast walk
    
    // Stationary Zone Detection
    const STANDING_ZONE_MIN_DURATION_SEC = 180;  // 3 minutes minimum
    const STANDING_ZONE_RADIUS_M = 10;           // Cluster radius
    
    // Isolation Detection (pre-parturition)
    const ISOLATION_DISTANCE_THRESHOLD_M = 50;   // Distance from usual area
    const ISOLATION_DURATION_THRESHOLD_SEC = 1800; // 30 min sustained
    
    // Breeding Cycle Configuration
    const GESTATION_DAYS = 283;                  // Average cattle gestation
    const BULL_PRESENT_END_MONTH = 10;           // Bull leaves after October
    const BULL_RETURN_MONTH = 4;                 // Bull returns in April (hypothetically)
    const MIN_DAYS_POSTPARTUM_CONCEPTION = 45;   // Minimum days before next conception
    
    // Consistency Thresholds
    const CONSISTENCY_GPS_ACC_THRESHOLD = 0.7;   // Agreement threshold
    const OUTLIER_DISTANCE_PERCENTILE = 0.85;
    const MIN_OUTLIER_EVENT_DURATION_SEC = 60;

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

    // ---- Polygon utilities
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

    function isInsideRedFence(lat, lon) {
        for (const fence of RED_FENCES) {
            if (isPointInsidePolygon(lat, lon, fence)) return true;
        }
        return false;
    }

    function isInsideFenceI(lat, lon) {
        return RED_FENCES[0] ? isPointInsidePolygon(lat, lon, RED_FENCES[0]) : false;
    }

    function isInsideFenceII(lat, lon) {
        return RED_FENCES[1] ? isPointInsidePolygon(lat, lon, RED_FENCES[1]) : false;
    }

    function isInsideFenceIII(lat, lon) {
        return RED_FENCES[2] ? isPointInsidePolygon(lat, lon, RED_FENCES[2]) : false;
    }

    // ---- State
    const MAP_LAYER_MODES = ['heat', 'trajectory', 'points'];
    let mapDayInstance = null;
    let mapNightInstance = null;
    let mapDayLayers = null;
    let mapNightLayers = null;
    let mapMode = 'heat';
    let showDirectionArrows = true;
    let chartInstances = [];
    let printListenersInstalled = false;
    
    // Calving/breeding state
    let lastCalvingDate = null;
    let estimatedConceptionDate = null;
    let estimatedDueDate = null;
    let gestationDay = null;
    let trimester = null;
    let breedingStatus = null;
    let selectedBullEndDate = null;
    let selectedCalvingDate = null;

    // ---- DOM refs
    const overlayEl = document.getElementById('datasetOverlay');
    const datasetInputEl = document.getElementById('datasetInput');
    const calvingDateInputEl = document.getElementById('calvingDateInput');
    const bullDateInputEl = document.getElementById('bullDateInput');
    const datasetLoadBtnEl = document.getElementById('datasetLoadBtn');
    const datasetCancelBtnEl = document.getElementById('datasetCancelBtn');
    const datasetStatusEl = document.getElementById('datasetStatus');
    const changeDatasetBtnEl = document.getElementById('changeDatasetBtn');
    const exportPdfBtnEl = document.getElementById('exportPdfBtn');
    const mapModeSelectEl = document.getElementById('mapModeSelect');
    const arrowToggleEl = document.getElementById('arrowToggle');
    const fullscreenButtons = document.querySelectorAll('.map-fullscreen-btn');
    const mapLayerSelects = document.querySelectorAll('[data-layer-select]');

    if (mapModeSelectEl) {
        if (MAP_LAYER_MODES.includes(mapModeSelectEl.value)) {
            mapMode = mapModeSelectEl.value;
        }
        mapModeSelectEl.addEventListener('change', (evt) => setMapMode(evt.target.value));
    }

    if (arrowToggleEl) {
        showDirectionArrows = arrowToggleEl.checked;
        arrowToggleEl.addEventListener('change', (evt) => {
            showDirectionArrows = !!evt.target.checked;
            applySelectedMapMode();
        });
    }

    mapLayerSelects.forEach((selectEl) => {
        selectEl.addEventListener('change', (evt) => {
            const mode = MAP_LAYER_MODES.includes(evt.target.value) ? evt.target.value : 'heat';
            if (mapModeSelectEl) mapModeSelectEl.value = mode;
            setMapMode(mode);
        });
    });

    function invalidateMapSize(mapId) {
        setTimeout(() => {
            if (mapId === 'mapDay' && mapDayInstance) mapDayInstance.invalidateSize();
            if (mapId === 'mapNight' && mapNightInstance) mapNightInstance.invalidateSize();
        }, 250);
    }

    function syncBodyFullscreenState() {
        if (!document.body) return;
        const anyActive = document.querySelector('.chart-container.fullscreen');
        document.body.classList.toggle('map-fullscreen-active', !!anyActive);
    }

    function setMapFullscreenState(container, btn, mapId, active) {
        if (!container || !btn) return;
        container.classList.toggle('fullscreen', !!active);
        syncBodyFullscreenState();
        if (active) {
            const overlaySelect = container.querySelector('[data-layer-select]');
            if (overlaySelect) overlaySelect.value = mapMode;
            btn.textContent = 'Zavřít celou obrazovku';
        } else {
            btn.textContent = 'Celá obrazovka';
        }
        invalidateMapSize(mapId);
    }

    function requestElementFullscreen(el) {
        if (!el) return null;
        if (el.requestFullscreen) return el.requestFullscreen();
        if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
        if (el.msRequestFullscreen) return el.msRequestFullscreen();
        return null;
    }

    function exitDocumentFullscreen() {
        if (document.exitFullscreen) return document.exitFullscreen();
        if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
        if (document.msExitFullscreen) return document.msExitFullscreen();
        return null;
    }

    fullscreenButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const mapId = btn.dataset.map;
            const container = btn.closest('.chart-container');
            if (!container) return;
            const isActive = container.classList.contains('fullscreen');
            if (isActive) {
                const exitResult = document.fullscreenElement === container ? exitDocumentFullscreen() : null;
                if (exitResult && typeof exitResult.then === 'function') {
                    exitResult
                        .then(() => setMapFullscreenState(container, btn, mapId, false))
                        .catch(() => setMapFullscreenState(container, btn, mapId, false));
                } else {
                    setMapFullscreenState(container, btn, mapId, false);
                }
                return;
            }

            fullscreenButtons.forEach((otherBtn) => {
                if (otherBtn === btn) return;
                const otherContainer = otherBtn.closest('.chart-container');
                if (otherContainer && otherContainer.classList.contains('fullscreen')) {
                    setMapFullscreenState(otherContainer, otherBtn, otherBtn.dataset.map, false);
                }
            });

            const reqResult = requestElementFullscreen(container);
            if (reqResult && typeof reqResult.then === 'function') {
                reqResult
                    .then(() => setMapFullscreenState(container, btn, mapId, true))
                    .catch(() => setMapFullscreenState(container, btn, mapId, true));
            } else {
                setMapFullscreenState(container, btn, mapId, true);
            }
        });
    });

    document.addEventListener('fullscreenchange', () => {
        const activeElement = document.fullscreenElement;
        fullscreenButtons.forEach((btn) => {
            const container = btn.closest('.chart-container');
            if (!container) return;
            const mapId = btn.dataset.map;
            const shouldBeActive = activeElement === container;
            if (shouldBeActive && !container.classList.contains('fullscreen')) {
                setMapFullscreenState(container, btn, mapId, true);
            }
            if (!shouldBeActive && container.classList.contains('fullscreen')) {
                setMapFullscreenState(container, btn, mapId, false);
            }
        });
    });

    // ---- UI helpers
    function setStatus(text) {
        if (!datasetStatusEl) return;
        datasetStatusEl.textContent = text || '';
    }

    function openOverlay(prefill) {
        if (!overlayEl) return;
        overlayEl.classList.add('open');
        const last = localStorage.getItem('oneDayAnalysis_lastDataset') || '';
        const lastCalving = localStorage.getItem('oneDayAnalysis_lastCalvingDate') || '';
        const lastBullDate = localStorage.getItem('oneDayAnalysis_lastBullDate') || '';
        if (datasetInputEl) {
            datasetInputEl.value = (prefill || last || '').trim();
            setTimeout(() => datasetInputEl.focus(), 0);
        }
        if (calvingDateInputEl && lastCalving) {
            calvingDateInputEl.value = lastCalving;
        }
        if (bullDateInputEl && lastBullDate) {
            bullDateInputEl.value = lastBullDate;
        }
        setStatus('');
    }

    function closeOverlay() {
        if (!overlayEl) return;
        overlayEl.classList.remove('open');
        setStatus('');
    }

    // ---- Date/Time Utilities
    function parseDatasetFileName(input) {
        const cleaned = (input || '').trim().split(/[\\/]/).pop();
        const match = cleaned.match(/^ID(\d+)_(\d{6})\.js$/i);
        if (!match) return null;
        return { file: cleaned, cowId: match[1], ddmmyy: match[2] };
    }

    function buildCandidateDatasetFiles(parsed) {
        const files = [];
        if (!parsed) return files;
        const baseFile = `ID${parsed.cowId}_${parsed.ddmmyy}.js`;
        files.push(baseFile);
        if (parsed.cowId === '175959' && !parsed.cowId.endsWith('5')) {
            const remapped = `ID${parsed.cowId}5_${parsed.ddmmyy}.js`;
            if (!files.includes(remapped)) files.push(remapped);
        }
        return files;
    }

    function ddmmyyToDisplayDate(ddmmyy) {
        const dd = ddmmyy.slice(0, 2);
        const mm = ddmmyy.slice(2, 4);
        const yy = ddmmyy.slice(4, 6);
        return `${dd}.${mm}.20${yy}`;
    }

    function ddmmyyToDate(ddmmyy) {
        const dd = parseInt(ddmmyy.slice(0, 2), 10);
        const mm = parseInt(ddmmyy.slice(2, 4), 10) - 1;
        const yy = parseInt(ddmmyy.slice(4, 6), 10) + 2000;
        return new Date(yy, mm, dd);
    }

    function parseTimeToSeconds(ts) {
        if (!ts) return null;
        const parts = String(ts).trim().split(':').map((p) => Number(p));
        if (parts.length < 2) return null;
        const h = parts[0];
        const m = parts[1];
        const s = parts.length >= 3 ? parts[2] : 0;
        if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
        return h * 3600 + m * 60 + s;
    }

    /**
     * Parse date and time to Unix epoch seconds
     * @param {string} dateStr - Date in format "dd.mm.yyyy"
     * @param {string} timeStr - Time in format "HH:MM:SS"
     * @returns {number|null} - Unix epoch seconds or null if invalid
     */
    function parseDateTimeToEpoch(dateStr, timeStr) {
        if (!dateStr || !timeStr) return null;
        const dateParts = dateStr.split('.');
        if (dateParts.length !== 3) return null;
        const [day, month, year] = dateParts.map(Number);
        if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
        const timeSec = parseTimeToSeconds(timeStr);
        if (timeSec === null) return null;
        const date = new Date(year, month - 1, day, 0, 0, 0);
        return Math.floor(date.getTime() / 1000) + timeSec;
    }

    /**
     * Fix midnight crossing in records where date field is incorrect
     * FMB920 datasets sometimes have all records with the same date even when crossing midnight
     * This function detects when time jumps backwards significantly and assumes next-day crossing
     * @param {Array} records - Array with tSec (time in seconds) and date fields
     * @returns {Array} - Records with corrected epochSec values
     */
    function fixMidnightCrossing(records) {
        if (!records || records.length < 2) return records;

        // First, identify if there's a midnight crossing issue
        // Look for pattern: records with time > 18:00 followed by records with time < 06:00, same date
        let hasMidnightIssue = false;
        let lastHighTime = -1;

        for (let i = 0; i < records.length; i++) {
            const tSec = records[i].tSec;
            if (tSec > 18 * 3600) { // After 18:00
                lastHighTime = i;
            }
            if (lastHighTime >= 0 && tSec < 6 * 3600 && records[i].date === records[lastHighTime].date) {
                hasMidnightIssue = true;
                break;
            }
        }

        if (!hasMidnightIssue) {
            console.log('[OneDay] No midnight crossing issue detected');
            return records;
        }

        console.log('[OneDay] Detected midnight crossing with incorrect dates - fixing...');

        // Find the transition point (where time goes from high to low)
        // All records AFTER this point with time < 06:00 should have date+1
        let transitionIndex = -1;
        for (let i = 1; i < records.length; i++) {
            const prevTSec = records[i - 1].tSec;
            const currTSec = records[i].tSec;
            // Transition: previous > 18:00 and current < 06:00
            if (prevTSec > 18 * 3600 && currTSec < 6 * 3600) {
                transitionIndex = i;
                console.log(`[OneDay] Midnight transition at index ${i}: ${formatHhMm(prevTSec)} -> ${formatHhMm(currTSec)}`);
                break;
            }
        }

        if (transitionIndex < 0) {
            console.log('[OneDay] Could not find transition point');
            return records;
        }

        // Recalculate epochSec for records after transition
        const ONE_DAY_SEC = 24 * 3600;
        let fixedCount = 0;

        for (let i = transitionIndex; i < records.length; i++) {
            const r = records[i];
            if (r.tSec < 6 * 3600) { // Only fix early morning records
                if (r.epochSec !== null && r.epochSec !== undefined) {
                    r.epochSec += ONE_DAY_SEC;
                    r.dateFixed = true;
                    fixedCount++;
                }
            }
        }

        console.log(`[OneDay] Fixed ${fixedCount} records by adding 1 day to epoch`);
        return records;
    }

    /**
     * Filter out retry transmission records (FMB920 sends old data when connection restored)
     * Records with backward time jumps > threshold are flagged as retries
     * @param {Array} records - Array of records with epochSec field
     * @param {number} maxBackwardJumpSec - Maximum allowed backward jump (default 5 minutes)
     * @returns {Object} - { filtered: Array, retryRecords: Array, stats: Object }
     */
    function filterRetryRecords(records, maxBackwardJumpSec = 300) {
        if (!records || records.length < 2) {
        const totalCount = Array.isArray(records) ? records.length : 0;
        return { filtered: records || [], retryRecords: [], stats: { total: totalCount, filtered: 0, removed: 0 } };
        }

        // First sort by epoch
        const sorted = [...records].sort((a, b) => a.epochSec - b.epochSec);

        const filtered = [];
        const retryRecords = [];
        let maxEpochSeen = sorted[0].epochSec;

        for (const record of sorted) {
            // If this record's epoch is significantly before the max we've seen,
            // it's likely a retry transmission
            if (record.epochSec < maxEpochSeen - maxBackwardJumpSec) {
                retryRecords.push(record);
            } else {
                filtered.push(record);
                if (record.epochSec > maxEpochSeen) {
                    maxEpochSeen = record.epochSec;
                }
            }
        }

        return {
            filtered,
            retryRecords,
            stats: {
                total: records.length,
                filtered: filtered.length,
                removed: retryRecords.length
            }
        };
    }

    function formatDuration(seconds) {
        const s = Math.max(0, Math.round(seconds));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m`;
        return `${sec}s`;
    }

    function renderPostureConfidencePanel(panelEl, options) {
        if (!panelEl) return;
        const postureSummary = options.postureSummary || null;
        const standingSec = options.standingSec || 0;
        const lyingSec = options.lyingSec || 0;
        const transitionSec = options.transitionSec || 0;
        const gapsSec = options.unknownSec || 0;
        const unknownSec = transitionSec + gapsSec;
        const totalSec = Math.max(1, standingSec + lyingSec + unknownSec);
        const standingPct = (standingSec / totalSec) * 100;
        const lyingPct = (lyingSec / totalSec) * 100;
        const unknownPct = (unknownSec / totalSec) * 100;
        const standingConf = (postureSummary && postureSummary.avgStandingConfidence != null)
            ? `${(postureSummary.avgStandingConfidence * 100).toFixed(0)}%`
            : 'N/A';
        const lyingConf = (postureSummary && postureSummary.avgLyingConfidence != null)
            ? `${(postureSummary.avgLyingConfidence * 100).toFixed(0)}%`
            : 'N/A';
        const standingLowSec = postureSummary ? (postureSummary.lowConfidenceStandingSec || 0) : 0;
        const lyingLowSec = postureSummary ? (postureSummary.lowConfidenceLyingSec || 0) : 0;
        const standingLowPct = standingSec > 0 ? (standingLowSec / standingSec) * 100 : 0;
        const lyingLowPct = lyingSec > 0 ? (lyingLowSec / lyingSec) * 100 : 0;
        const transitionSamples = postureSummary ? (postureSummary.transitionSamples || 0) : 0;
        const lowConfidenceSamples = postureSummary ? (postureSummary.lowConfidenceSamples || 0) : 0;
        const lowConfidenceSec = postureSummary ? (postureSummary.lowConfidenceSec || 0) : 0;

        let html = '';
        html += '<div class="posture-bar-container">';
        html += '  <div class="posture-bar">';
        html += '    <div class="posture-segment standing" style="width:' + standingPct + '%">';
        html += '      <span>Stání ' + standingPct.toFixed(1) + '%</span>';
        html += '    </div>';
        html += '    <div class="posture-segment lying" style="width:' + lyingPct + '%">';
        html += '      <span>Ležení ' + lyingPct.toFixed(1) + '%</span>';
        html += '    </div>';
        html += '    <div class="posture-segment transition" style="width:' + unknownPct + '%">';
        html += '      <span>Neurčeno ' + unknownPct.toFixed(1) + '%</span>';
        html += '    </div>';
        html += '  </div>';
        html += '  <div class="posture-legend">';
        html += '    <span><span class="posture-dot" style="background:#38bdf8;"></span>Stání</span>';
        html += '    <span><span class="posture-dot" style="background:#34d399;"></span>Ležení</span>';
        html += '    <span><span class="posture-dot" style="background:#fbbf24;"></span>Neurčeno (mezery + přechody)</span>';
        html += '    <span><span class="posture-dot" style="background:#e94560;"></span>Nízká jistota ' + lowConfidenceSamples + ' vzorků (' + formatDuration(lowConfidenceSec) + ')</span>';
        html += '  </div>';
        html += '</div>';
        html += '<div class="posture-metric-grid">';
        html += '  <div class="posture-metric">';
        html += '    <div class="metric-label">Stání</div>';
        html += '    <div class="metric-value">' + formatDuration(standingSec) + ' (' + standingPct.toFixed(1) + '%)</div>';
        html += '    <div class="metric-sub">Jistota: ' + standingConf + ' • Nízká jistota: ' + formatDuration(standingLowSec) + ' (' + standingLowPct.toFixed(1) + '%)</div>';
        html += '  </div>';
        html += '  <div class="posture-metric">';
        html += '    <div class="metric-label">Ležení</div>';
        html += '    <div class="metric-value">' + formatDuration(lyingSec) + ' (' + lyingPct.toFixed(1) + '%)</div>';
        html += '    <div class="metric-sub">Jistota: ' + lyingConf + ' • Nízká jistota: ' + formatDuration(lyingLowSec) + ' (' + lyingLowPct.toFixed(1) + '%)</div>';
        html += '  </div>';
        html += '  <div class="posture-metric">';
        html += '    <div class="metric-label">Neurčeno / přechod</div>';
        html += '    <div class="metric-value">' + formatDuration(unknownSec) + ' (' + unknownPct.toFixed(1) + '%)</div>';
        html += '    <div class="metric-sub">';
        html += '        Přechody tilt: ' + formatDuration(transitionSec) + ' (' + transitionSamples + ' vzorků) • ';
        html += '        Mezery/ostatní: ' + formatDuration(gapsSec) + ' • ';
        html += '        Nízká jistota celkem: ' + lowConfidenceSamples + ' vzorků';
        html += '    </div>';
        html += '  </div>';
        html += '</div>';
        panelEl.innerHTML = html;
    }

    function formatHhMm(sec) {
        const s = Math.max(0, Math.round(sec));
        const h = String(Math.floor(s / 3600)).padStart(2, '0');
        const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
        return `${h}:${m}`;
    }

    function safeNumber(v) {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    function daysBetween(date1, date2) {
        const oneDay = 24 * 60 * 60 * 1000;
        return Math.round((date2 - date1) / oneDay);
    }

    // ---- Breeding/Gestation Calculations
    function calculateBreedingStatus(calvingDateStr, analysisDateStr) {
        if (!calvingDateStr) {
            return {
                status: 'unknown',
                gestationDay: null,
                trimester: null,
                estimatedDueDate: null,
                daysToParturition: null,
                preParturitionAlert: false
            };
        }

        const calvingDate = new Date(calvingDateStr);
        const analysisDate = ddmmyyToDate(analysisDateStr);
        
        if (isNaN(calvingDate.getTime())) {
            return { status: 'invalid_date' };
        }

        const daysSinceCalving = daysBetween(calvingDate, analysisDate);
        
        if (daysSinceCalving < 0) {
            return { 
                status: 'future_calving',
                daysToParturition: -daysSinceCalving,
                preParturitionAlert: -daysSinceCalving <= 14
            };
        }

        if (daysSinceCalving < MIN_DAYS_POSTPARTUM_CONCEPTION) {
            return {
                status: 'postpartum_recovery',
                daysSinceCalving,
                daysUntilFertile: MIN_DAYS_POSTPARTUM_CONCEPTION - daysSinceCalving
            };
        }

        // Check if bull was present
        const conceptionMonth = calvingDate.getMonth() + 2; // Approximate month after recovery
        const bullPresent = conceptionMonth <= BULL_PRESENT_END_MONTH || conceptionMonth >= BULL_RETURN_MONTH;

        if (!bullPresent && daysSinceCalving < GESTATION_DAYS + MIN_DAYS_POSTPARTUM_CONCEPTION) {
            return {
                status: 'likely_not_pregnant',
                reason: 'no_bull_present',
                daysSinceCalving
            };
        }

        // Estimate conception
        const estConception = new Date(calvingDate);
        estConception.setDate(estConception.getDate() + MIN_DAYS_POSTPARTUM_CONCEPTION + 21); // ~66 days post-calving typical

        const estDueDate = new Date(estConception);
        estDueDate.setDate(estDueDate.getDate() + GESTATION_DAYS);

        const gestationDay = daysBetween(estConception, analysisDate);
        const daysToParturition = daysBetween(analysisDate, estDueDate);

        let trimester = 0;
        if (gestationDay > 0 && gestationDay <= 94) trimester = 1;
        else if (gestationDay > 94 && gestationDay <= 188) trimester = 2;
        else if (gestationDay > 188) trimester = 3;

        return {
            status: gestationDay > 0 ? 'likely_pregnant' : 'post_calving',
            daysSinceCalving,
            gestationDay: Math.max(0, gestationDay),
            trimester,
            estimatedDueDate: estDueDate.toLocaleDateString('cs-CZ'),
            daysToParturition: Math.max(0, daysToParturition),
            preParturitionAlert: daysToParturition <= 14 && daysToParturition >= 0
        };
    }

    // ---- Haversine and Direction
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

    // ---- Interpolation Functions for 1Hz resampling
    
    /**
     * Detect if a gap is StandBy mode (unit sleeping due to no movement)
     * StandBy indicates the cow was stationary (lying or standing still)
     */
    function isStandByGap(gapDurationSec) {
        return gapDurationSec >= STANDBY_THRESHOLD_SEC && 
               gapDurationSec <= STANDBY_MAX_DURATION_SEC;
    }

    /**
     * Linear interpolation between two values
     */
    function lerp(v0, v1, t) {
        return v0 + t * (v1 - v0);
    }

    /**
     * Interpolate GPS coordinates linearly
     * For StandBy gaps, we hold the last position (cow didn't move)
     */
    function interpolateGPS(lat1, lon1, lat2, lon2, t, isStandBy) {
        if (isStandBy) {
            // During StandBy, cow didn't move - hold last known position
            return { lat: lat1, lon: lon1 };
        }
        // Linear interpolation for movement
        return {
            lat: lerp(lat1, lat2, t),
            lon: lerp(lon1, lon2, t)
        };
    }

    /**
     * Interpolate accelerometer values
     * For StandBy: hold last values (cow is resting in same position)
     * For short gaps: linear interpolation
     */
    function interpolateAcc(acc1, acc2, t, isStandBy) {
        if (!acc1 || !acc2) return acc1 || acc2 || null;
        
        if (isStandBy) {
            // During StandBy, maintain last accelerometer reading
            // Cow is in same posture
            return { ...acc1 };
        }
        
        // Linear interpolation
        return {
            x: Math.round(lerp(acc1.x, acc2.x, t)),
            y: Math.round(lerp(acc1.y, acc2.y, t)),
            z: Math.round(lerp(acc1.z, acc2.z, t))
        };
    }

    /**
     * Resample data to 1Hz frequency with StandBy-aware interpolation
     * FIXED: Now skips gaps larger than MAX_INTERVAL_SEC to prevent explosion
     * @param {Array} samples - Original samples sorted by time
     * @param {number} maxGap - Maximum gap to interpolate (default MAX_INTERVAL_SEC)
     * @returns {Array} - Resampled data at 1Hz
     */
    function resampleTo1Hz(samples, maxGap = MAX_INTERVAL_SEC) {
        if (!samples || samples.length < 2) return samples;
        if (!INTERPOLATION_ENABLED) return samples;

        const resampled = [];
        let skippedGaps = 0;
        let totalSkippedDuration = 0;
        let totalInterpolated = 0;

        // Process each pair of consecutive samples
        // IMPORTANT: Use epochSec for gap calculation (handles midnight crossing correctly)
        // But tSec for interpolated timestamp generation
        for (let i = 0; i < samples.length - 1; i++) {
            const s0 = samples[i];
            const s1 = samples[i + 1];

            // Use epochSec for gap duration calculation (correct after midnight fix)
            const gapDuration = (s0.epochSec !== undefined && s1.epochSec !== undefined)
                ? (s1.epochSec - s0.epochSec)
                : (s1.tSec - s0.tSec);

            // Always add the original sample
            if (i === 0 || resampled.length === 0 || resampled[resampled.length - 1].epochSec !== s0.epochSec) {
                resampled.push({
                    ...s0,
                    interpolated: false,
                    standByPeriod: false
                });
            }

            // Skip interpolation for negative gaps (should not happen after sorting)
            if (gapDuration <= 0) {
                console.warn(`[OneDay] WARNING: Non-positive gap ${gapDuration}s at index ${i}`);
                continue;
            }

            // Skip interpolation for gaps larger than maxGap
            if (gapDuration > maxGap) {
                skippedGaps++;
                totalSkippedDuration += gapDuration;
                console.log(`[OneDay] Skipping interpolation for ${gapDuration}s gap (${formatHhMm(s0.tSec)} -> ${formatHhMm(s1.tSec)})`);
                continue;
            }

            // Skip if gap is too small
            if (gapDuration <= 1) {
                continue;
            }

            const isStandBy = isStandByGap(gapDuration);

            // Interpolate between s0 and s1 using epochSec
            const startEpoch = s0.epochSec !== undefined ? s0.epochSec : s0.tSec;
            const endEpoch = s1.epochSec !== undefined ? s1.epochSec : s1.tSec;

            for (let e = startEpoch + 1; e < endEpoch; e++) {
                const tFactor = (e - startEpoch) / gapDuration;

                // Interpolate GPS
                const gps = interpolateGPS(s0.lat, s0.lon, s1.lat, s1.lon, tFactor, isStandBy);

                // Interpolate accelerometer
                const acc0 = (s0.accX !== null) ? { x: s0.accX, y: s0.accY, z: s0.accZ } : null;
                const acc1 = (s1.accX !== null) ? { x: s1.accX, y: s1.accY, z: s1.accZ } : null;
                const acc = interpolateAcc(acc0, acc1, tFactor, isStandBy);

                // Create interpolated sample with correct epochSec
                resampled.push({
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
                });
                totalInterpolated++;
            }
        }

        // Add the last sample
        const lastSample = samples[samples.length - 1];
        if (resampled.length === 0 || resampled[resampled.length - 1].epochSec !== lastSample.epochSec) {
            resampled.push({
                ...lastSample,
                interpolated: false,
                standByPeriod: false
            });
        }

        console.log(`[OneDay] Interpolation: ${samples.length} original → ${resampled.length} total (${totalInterpolated} interpolated)`);
        if (skippedGaps > 0) {
            console.log(`[OneDay] Skipped ${skippedGaps} gaps totaling ${formatDuration(totalSkippedDuration)} (would have created ${totalSkippedDuration} fake samples)`);
        }

        return resampled;
    }

    // ---- Gravity extraction & posture timeline
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
        return { x: vec.x / mag, y: vec.y / mag, z: vec.z / mag, magnitude: 1 };
    }

    function autoCalibrateOrientationLocal(gravityVectors) {
        if (!Array.isArray(gravityVectors) || gravityVectors.length === 0) {
            return { status: 'PENDING', vector: { x: 0, y: 0, z: 1 }, sampleCount: 0 };
        }

        const sampleRate = GRAVITY_FILTER_SAMPLE_RATE_HZ || INTERPOLATION_TARGET_HZ || 1;
        const maxSamples = Math.min(
            gravityVectors.length,
            Math.round((CALIBRATION_HOURS || 24) * 3600 * (sampleRate || 1))
        );
        const windowSize = Math.max(1, Math.round((POSTURE_WINDOW_SEC || 60) * sampleRate));
        const step = Math.max(1, Math.floor(windowSize / 2));
        const candidates = [];

        for (let start = 0; start + windowSize <= maxSamples; start += step) {
            const slice = gravityVectors.slice(start, start + windowSize);
            const mags = slice.map(v => v.magnitude);
            const avgMag = mags.reduce((sum, v) => sum + v, 0) / mags.length;
            const variance = mags.reduce((sum, v) => sum + Math.pow(v - avgMag, 2), 0) / mags.length;

            if (variance <= CALIBRATION_VARIANCE_THRESHOLD_G2 &&
                avgMag >= CALIBRATION_MAG_MIN_G &&
                avgMag <= CALIBRATION_MAG_MAX_G) {
                const avgVec = {
                    x: slice.reduce((sum, v) => sum + v.x, 0) / slice.length,
                    y: slice.reduce((sum, v) => sum + v.y, 0) / slice.length,
                    z: slice.reduce((sum, v) => sum + v.z, 0) / slice.length
                };
                const norm = normalizeVector(avgVec);
                if (norm) candidates.push(norm);
            }
        }

        if (candidates.length >= CALIBRATION_MIN_WINDOWS) {
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

        return { status: 'UNCALIBRATED', vector: { x: 0, y: 0, z: 1 }, sampleCount: candidates.length };
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
            this.minDurationSec = Math.max(1, minDurationSec || POSTURE_MIN_DURATION_SEC);
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
        if (variance > POSTURE_VARIANCE_THRESHOLD_G2) return 'transition';
        if (tiltDeg < TILT_STANDING_MAX_DEG) return 'standing';
        if (tiltDeg > TILT_LYING_MIN_DEG) return 'lying';
        return 'transition';
    }

    function calculatePostureConfidence(state, tiltDeg, variance) {
        if (!state || state === 'unknown') return 0.3;
        if (!Number.isFinite(tiltDeg)) return 0.3;
        let confidence;
        if (state === 'standing') {
            confidence = 1 - Math.min(1, tiltDeg / (TILT_STANDING_MAX_DEG || 35));
        } else if (state === 'lying') {
            const delta = Math.max(0, tiltDeg - TILT_LYING_MIN_DEG);
            confidence = 0.6 + Math.min(0.4, delta / 45);
        } else {
            confidence = 0.4;
        }
        if (variance > POSTURE_VARIANCE_THRESHOLD_G2 * 0.8) confidence *= 0.5;
        return Math.max(0, Math.min(1, confidence));
    }

    function buildPostureTimeline(samples) {
        if (typeof RumburkAnalysisCore !== 'undefined' &&
            typeof RumburkAnalysisCore.buildPostureTimeline === 'function') {
            return RumburkAnalysisCore.buildPostureTimeline(samples);
        }
        return buildPostureTimelineLocal(samples);
    }

    function buildPostureTimelineLocal(samples) {
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
                    lowConfidenceThreshold: POSTURE_LOW_CONFIDENCE_THRESHOLD || 0.6,
                    avgStandingConfidence: null,
                    avgLyingConfidence: null,
                    totalSamples: 0
                }
            };
        }

        const sampleRate = GRAVITY_FILTER_SAMPLE_RATE_HZ || INTERPOLATION_TARGET_HZ || 1;
        const cutoff = GRAVITY_CUTOFF_HZ || 0.5;
        const axSeries = [];
        const aySeries = [];
        const azSeries = [];
        let lastX = 0;
        let lastY = 0;
        let lastZ = ACC_GRAVITY_G;

        for (const sample of samples) {
            if (Number.isFinite(sample.accX)) lastX = sample.accX / ACC_SCALE;
            if (Number.isFinite(sample.accY)) lastY = sample.accY / ACC_SCALE;
            if (Number.isFinite(sample.accZ)) lastZ = sample.accZ / ACC_SCALE;
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

        const calibration = autoCalibrateOrientationLocal(gravityVectors);
        const referenceVector = calibration.vector || { x: 0, y: 0, z: 1 };
        const tilts = gravityVectors.map(vec => calculateTiltBetweenVectors(vec, referenceVector));
        const magnitudes = gravityVectors.map(vec => vec.magnitude);
        const windowSize = Math.max(1, Math.round((POSTURE_WINDOW_SEC || 60) * sampleRate));
        const variances = computeSlidingVariance(magnitudes, windowSize);
        const stateMachine = new PostureStateMachine(POSTURE_MIN_DURATION_SEC);
        const sampleDurationSec = 1 / Math.max(0.001, sampleRate);

        const lowConfidenceThreshold = POSTURE_LOW_CONFIDENCE_THRESHOLD || 0.6;
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

    /**
     * Analyze StandBy periods in the data
     * Returns statistics about sleep/wake patterns
     */
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

    // ---- Enhanced Behavior Classification with Cross-Validation
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
        const normG = accNorm / ACC_SCALE;

        // Check if accelerometer reading is within expected gravity range
        const gravityValid = normG >= (ACC_GRAVITY_G - ACC_GRAVITY_TOLERANCE) &&
                            normG <= (ACC_GRAVITY_G + ACC_GRAVITY_TOLERANCE);

        if (!gravityValid) {
            // High dynamic acceleration - likely moving
            return { posture: 'moving', confidence: 0.7 };
        }

        // Standing: gravity mostly on Z-axis
        if (az >= POSTURE_STANDING_AZ_MIN && ax <= POSTURE_STANDING_AXAY_MAX && ay <= POSTURE_STANDING_AXAY_MAX) {
            const confidence = Math.min(1, (az - 0.7) / 0.3);
            return { posture: 'standing', confidence };
        }

        // Lying: gravity on X or Y axis (side lying)
        if (az <= POSTURE_LYING_AZ_MAX && (ax >= POSTURE_LYING_AXAY_MIN || ay >= POSTURE_LYING_AXAY_MIN)) {
            const maxXY = Math.max(ax, ay);
            const confidence = Math.min(1, (maxXY - 0.5) / 0.4);
            return { posture: 'lying', confidence };
        }

        // Intermediate posture - use additional heuristics
        if (az > 0.5) {
            return { posture: 'standing', confidence: 0.5 };
        } else {
            return { posture: 'lying', confidence: 0.5 };
        }
    }

    function classifyMovementFromGPS(distanceM, speedMps, dt) {
        if (dt <= 0) return { movement: 'unknown', confidence: 0 };

        // Account for GPS accuracy (~3-5m typical error)
        const effectiveSpeed = speedMps;
        
        if (effectiveSpeed < SPEED_STATIONARY_MPS) {
            return { movement: 'stationary', confidence: 0.95 };
        }
        if (effectiveSpeed < SPEED_GRAZING_MPS) {
            return { movement: 'grazing', confidence: 0.85 };
        }
        if (effectiveSpeed < SPEED_SLOW_WALK_MPS) {
            return { movement: 'slow_walk', confidence: 0.8 };
        }
        if (effectiveSpeed < SPEED_NORMAL_WALK_MPS) {
            return { movement: 'normal_walk', confidence: 0.85 };
        }
        if (effectiveSpeed < SPEED_FAST_WALK_MPS) {
            return { movement: 'fast_walk', confidence: 0.8 };
        }
        return { movement: 'running', confidence: 0.9 };
    }

    function classifyMovementFromAcc(dynG, stepFreqHz) {
        if (dynG === null) return { movement: 'unknown', confidence: 0 };

        if (dynG < ACC_DYN_STATIONARY_G) {
            return { movement: 'stationary', confidence: 0.95 };
        }
        if (dynG < ACC_DYN_RUMINATING_G) {
            return { movement: 'ruminating', confidence: 0.8 };
        }
        if (dynG < ACC_DYN_GRAZING_G) {
            return { movement: 'grazing', confidence: 0.75 };
        }
        if (dynG < ACC_DYN_WALKING_G) {
            return { movement: 'walking', confidence: 0.8 };
        }
        if (dynG < ACC_DYN_FAST_WALK_G) {
            return { movement: 'fast_walk', confidence: 0.75 };
        }
        return { movement: 'running', confidence: 0.85 };
    }

    function crossValidateBehavior(gpsResult, accResult, accPosture) {
        // Priority logic for cross-validation
        // GPS is more reliable for movement detection
        // Accelerometer is more reliable for posture detection
        
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

        // Case 1: GPS says moving
        if (gpsMoving) {
            result.posture = 'standing';  // Must be standing to move
            result.movement = gpsResult.movement;
            result.behavior = gpsResult.movement === 'grazing' ? 'grazing' : 'walking';
            
            if (accMoving) {
                // Both agree on movement
                result.confidence = Math.max(gpsResult.confidence, accResult.confidence);
                result.consistency = 'consistent';
            } else {
                // GPS says moving, ACC says stationary - trust GPS for movement
                result.confidence = gpsResult.confidence * 0.8;
                result.consistency = 'gps_override';
            }
        }
        // Case 2: GPS says stationary
        else {
            result.movement = 'stationary';
            
            if (accPosture.posture === 'lying') {
                result.posture = 'lying';
                result.behavior = 'lying';
                result.confidence = accPosture.confidence;
                
                if (accStationary) {
                    result.consistency = 'consistent';
                } else {
                    // Accelerometer shows movement but GPS is stable
                    // Could be lying down with head movement (ruminating)
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
                    // Standing but accelerometer shows activity - grazing in place?
                    result.behavior = 'standing_active';
                }
                result.confidence = accPosture.confidence;
                result.consistency = 'consistent';
            } else {
                // Unknown posture from ACC
                if (accMoving) {
                    // Likely moving slowly, GPS didn't capture
                    result.behavior = 'walking';
                    result.posture = 'standing';
                    result.consistency = 'acc_override';
                    result.confidence = accResult.confidence * 0.7;
                } else {
                    // Default to standing
                    result.behavior = 'standing';
                    result.posture = 'standing';
                    result.confidence = 0.5;
                    result.consistency = 'uncertain';
                }
            }
        }

        return result;
    }

    // ---- Simplified behavior for timeline/stats
    function simplifyBehavior(behavior) {
        if (behavior.includes('lying')) return 'lying';
        if (behavior.includes('walk') || behavior === 'running' || behavior === 'grazing') return 'walking';
        return 'standing';
    }

    // ---- Zone and Cluster Detection

    // Get duration bucket for marker styling (3-5min, 5-10min, 10-15min, 15+min)
    function getDurationBucket(totalDtSec) {
        if (totalDtSec < 300) return 0;       // 3-5 min
        if (totalDtSec < 600) return 1;       // 5-10 min
        if (totalDtSec < 900) return 2;       // 10-15 min
        return 3;                              // 15+ min
    }

    // Indigo color scale for standing (500-900)
    const INDIGO_SCALE = ['#6366f1', '#4f46e5', '#4338ca', '#3730a3'];
    // Orange color scale for lying (400-950)
    const ORANGE_SCALE = ['#fb923c', '#f97316', '#ea580c', '#9a3412'];
    // Marker size by duration bucket
    const MARKER_SIZES = [8, 12, 16, 22];

    function classifyRmsLevel(rms) {
        if (!Number.isFinite(rms) || rms <= 0) return { label: 'N/A', level: 'neutral', description: 'Bez dat' };
        if (rms < 0.12) return { label: 'Velmi nízká', level: 'low', description: 'Téměř bez pohybu' };
        if (rms < 0.25) return { label: 'Normální', level: 'normal', description: 'Typická aktivita' };
        if (rms < 0.4) return { label: 'Zvýšená', level: 'high', description: 'Nadprůměrná dynamika' };
        return { label: 'Vysoká', level: 'critical', description: 'Možný stres/beh' };
    }

    function classifyStepFrequency(stepHz) {
        if (!Number.isFinite(stepHz) || stepHz <= 0) return { label: 'N/A', level: 'neutral', description: 'Bez kroků' };
        if (stepHz < 0.6) return { label: 'Pastva/klid', level: 'low', description: 'Velmi pomalý krok' };
        if (stepHz < 1.2) return { label: 'Silná pastva', level: 'normal', description: 'Pomalá chůze/pastva' };
        if (stepHz < 1.8) return { label: 'Chůze', level: 'high', description: 'Normální chůze' };
        return { label: 'Rychlá', level: 'critical', description: 'Rychlá chůze/běh' };
    }

    function clusterDwellZones(points, minDuration = STANDING_ZONE_MIN_DURATION_SEC) {
        const clusters = [];
        const CLUSTER_RADIUS_M = STANDING_ZONE_RADIUS_M;

        for (const p of points) {
            let bestIdx = -1;
            let bestDist = Infinity;

            for (let i = 0; i < clusters.length; i++) {
                const c = clusters[i];
                const d = haversineDistance(c.lat, c.lon, p.lat, p.lon);
                if (d < bestDist) {
                    bestDist = d;
                    bestIdx = i;
                }
            }

            if (bestDist <= CLUSTER_RADIUS_M && bestIdx >= 0) {
                const c = clusters[bestIdx];
                const w = p.dt;
                const tw = c.totalDt + w;
                c.lat = (c.lat * c.totalDt + p.lat * w) / tw;
                c.lon = (c.lon * c.totalDt + p.lon * w) / tw;
                c.totalDt = tw;
                c.samples++;
                // Track time range
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

        // Filter clusters by minimum duration
        const significantClusters = clusters.filter(c => c.totalDt >= minDuration);
        significantClusters.sort((a, b) => b.totalDt - a.totalDt);
        return significantClusters;
    }

    function detectStandingZones(intervals, timeFilter = null) {
        let standingPoints = intervals
            .filter(it => !it.isWalking && it.finalBehavior && it.finalBehavior.posture === 'standing');

        // Apply time filter if specified (day/night)
        if (timeFilter === 'day') {
            standingPoints = standingPoints.filter(it => it.midSec >= DAY_START_SEC && it.midSec < DAY_END_SEC);
        } else if (timeFilter === 'night') {
            standingPoints = standingPoints.filter(it => it.midSec < DAY_START_SEC || it.midSec >= DAY_END_SEC);
        }

        return clusterDwellZones(
            standingPoints.map(it => ({ lat: it.lat, lon: it.lon, dt: it.dt, startSec: it.startSec, endSec: it.endSec })),
            STANDING_ZONE_MIN_DURATION_SEC
        );
    }

    function detectLyingZones(points, timeFilter = null) {
        let filteredPoints = points;

        // Apply time filter if specified (day/night)
        if (timeFilter === 'day') {
            filteredPoints = points.filter(p => p.midSec >= DAY_START_SEC && p.midSec < DAY_END_SEC);
        } else if (timeFilter === 'night') {
            filteredPoints = points.filter(p => p.midSec < DAY_START_SEC || p.midSec >= DAY_END_SEC);
        }

        return clusterDwellZones(filteredPoints, STANDING_ZONE_MIN_DURATION_SEC);
    }

    function detectIsolationEvents(intervals, facilityCenter) {
        const events = [];
        let currentIsolation = null;

        for (const it of intervals) {
            const distFromCenter = haversineDistance(
                facilityCenter[0], facilityCenter[1],
                it.lat, it.lon
            );

            const isIsolated = distFromCenter > ISOLATION_DISTANCE_THRESHOLD_M;

            if (isIsolated) {
                if (!currentIsolation) {
                    currentIsolation = {
                        startSec: it.startSec,
                        endSec: it.endSec,
                        maxDistance: distFromCenter,
                        points: [[it.lat, it.lon]]
                    };
                } else {
                    currentIsolation.endSec = it.endSec;
                    currentIsolation.maxDistance = Math.max(currentIsolation.maxDistance, distFromCenter);
                    currentIsolation.points.push([it.lat, it.lon]);
                }
            } else {
                if (currentIsolation) {
                    const duration = currentIsolation.endSec - currentIsolation.startSec;
                    if (duration >= ISOLATION_DURATION_THRESHOLD_SEC) {
                        events.push({
                            ...currentIsolation,
                            duration,
                            avgLat: currentIsolation.points.reduce((s, p) => s + p[0], 0) / currentIsolation.points.length,
                            avgLon: currentIsolation.points.reduce((s, p) => s + p[1], 0) / currentIsolation.points.length
                        });
                    }
                    currentIsolation = null;
                }
            }
        }

        // Check final isolation event
        if (currentIsolation) {
            const duration = currentIsolation.endSec - currentIsolation.startSec;
            if (duration >= ISOLATION_DURATION_THRESHOLD_SEC) {
                events.push({
                    ...currentIsolation,
                    duration,
                    avgLat: currentIsolation.points.reduce((s, p) => s + p[0], 0) / currentIsolation.points.length,
                    avgLon: currentIsolation.points.reduce((s, p) => s + p[1], 0) / currentIsolation.points.length
                });
            }
        }

        return events;
    }

    function collectPerimeterOutliers(intervals) {
        const distances = intervals
            .map((it) => (it && Number.isFinite(it.distFromCenter) ? it.distFromCenter : null))
            .filter((d) => d !== null)
            .sort((a, b) => a - b);
        if (!distances.length) return [];

        const percentileIdx = Math.min(
            distances.length - 1,
            Math.floor(distances.length * OUTLIER_DISTANCE_PERCENTILE)
        );
        const threshold = Math.max(30, distances[percentileIdx]);
        const events = [];
        let current = null;

        const finalize = () => {
            if (!current) return;
            const duration = current.endSec - current.startSec;
            if (duration >= MIN_OUTLIER_EVENT_DURATION_SEC) {
                events.push({
                    startSec: current.startSec,
                    endSec: current.endSec,
                    lat: current.latSum / Math.max(1, current.weight),
                    lon: current.lonSum / Math.max(1, current.weight),
                    isDay: current.isDay
                });
            }
            current = null;
        };

        for (const it of intervals) {
            if (!it || !Number.isFinite(it.distFromCenter)) continue;
            const isOutlier = it.distFromCenter >= threshold;
            if (isOutlier) {
                if (!current || current.isDay !== it.isDay) {
                    finalize();
                    current = {
                        startSec: it.startSec,
                        endSec: it.endSec,
                        latSum: it.lat * it.dt,
                        lonSum: it.lon * it.dt,
                        weight: it.dt,
                        isDay: it.isDay
                    };
                } else {
                    current.endSec = it.endSec;
                    current.latSum += it.lat * it.dt;
                    current.lonSum += it.lon * it.dt;
                    current.weight += it.dt;
                }
            } else {
                finalize();
            }
        }

        finalize();
        return events;
    }

    function averageDirection(intervals, fromSec, toSec) {
        let sumSin = 0;
        let sumCos = 0;
        let used = 0;

        for (const it of intervals) {
            if (it.midSec < fromSec || it.midSec >= toSec) continue;
            if (it.distM < 2) continue;
            const deg = it.bearingDeg;
            sumSin += Math.sin(deg * Math.PI / 180);
            sumCos += Math.cos(deg * Math.PI / 180);
            used++;
        }

        if (used === 0) return { deg: 0, dir: 'N' };
        let deg = Math.atan2(sumSin, sumCos) * 180 / Math.PI;
        deg = (deg + 360) % 360;
        return { deg, dir: direction8(deg) };
    }

    function addDurationToHourly(hourly, midSec, behavior, dt) {
        const h = Math.min(23, Math.max(0, Math.floor(midSec / 3600)));
        const minutes = dt / 60;
        hourly[h][behavior] += minutes;
    }

    function computeBins2h(values, midSecs, dts) {
        const bins = Array.from({ length: 12 }, () => ({ sum: 0, weight: 0 }));
        for (let i = 0; i < values.length; i++) {
            const mid = midSecs[i];
            const dt = dts[i];
            const bin = Math.min(11, Math.max(0, Math.floor(mid / 7200)));
            const v = values[i];
            if (!Number.isFinite(v) || !Number.isFinite(dt) || dt <= 0) continue;
            bins[bin].sum += v * dt;
            bins[bin].weight += dt;
        }
        return bins.map((b) => (b.weight > 0 ? b.sum / b.weight : 0));
    }

    // ---- Script loading
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[data-dataset-src="${src}"]`);
            if (existing) {
                resolve();
                return;
            }
            const s = document.createElement('script');
            s.src = src;
            s.async = false;
            s.dataset.datasetSrc = src;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(s);
        });
    }

    function getDatasetArrayByVarName(varName) {
        if (!/^[A-Z0-9_]+$/.test(varName)) return null;
        try {
            if (typeof window === 'undefined' || typeof window.eval !== 'function') return null;
            return window.eval(varName);
        } catch {
            return null;
        }
    }

    // ---- Chart/Map management
    function destroyCharts() {
        for (const ch of chartInstances) {
            try { ch.destroy(); } catch { }
        }
        chartInstances = [];
    }

    // Flag to track if maps are ready for layer operations
    let mapsReady = false;

    function destroyMap() {
        mapsReady = false;
        if (mapDayInstance) {
            try { mapDayInstance.remove(); } catch { }
        }
        if (mapNightInstance) {
            try { mapNightInstance.remove(); } catch { }
        }
        mapDayInstance = null;
        mapNightInstance = null;
        mapDayLayers = null;
        mapNightLayers = null;
    }

    function updateMapLayerVisibility(mapInstance, layers, mode) {
        if (!mapInstance || !layers || !mapsReady) return;

        // Ensure renderer is initialized
        try {
            if (!mapInstance._renderer || !mapInstance._renderer._bounds) {
                mapInstance.invalidateSize();
            }
        } catch (e) {
            console.warn('Map renderer not ready:', e);
            return;
        }

        const showHeat = mode === 'heat';
        const showTrajectory = mode === 'trajectory';
        const showPoints = mode === 'points';
        const showZones = mode !== 'points';

        const heatLayer = layers.heat || null;
        const trajectoryLayer = layers.trajectory || null;
        const arrowLayer = layers.arrows || null;
        const pointsLayer = layers.points || null;
        const zonesLayer = layers.zones || null;

        try {
            if (heatLayer) {
                const hasLayer = mapInstance.hasLayer(heatLayer);
                if (showHeat && !hasLayer) {
                    heatLayer.addTo(mapInstance);
                } else if (!showHeat && hasLayer) {
                    mapInstance.removeLayer(heatLayer);
                }
            }

            if (trajectoryLayer) {
                const hasLayer = mapInstance.hasLayer(trajectoryLayer);
                if (showTrajectory && !hasLayer) {
                    trajectoryLayer.addTo(mapInstance);
                } else if (!showTrajectory && hasLayer) {
                    mapInstance.removeLayer(trajectoryLayer);
                }
            }

            if (pointsLayer) {
                const hasLayer = mapInstance.hasLayer(pointsLayer);
                if (showPoints && !hasLayer) {
                    pointsLayer.addTo(mapInstance);
                } else if (!showPoints && hasLayer) {
                    mapInstance.removeLayer(pointsLayer);
                }
            }

            if (zonesLayer) {
                const hasLayer = mapInstance.hasLayer(zonesLayer);
                if (showZones && !hasLayer) {
                    zonesLayer.addTo(mapInstance);
                } else if (!showZones && hasLayer) {
                    mapInstance.removeLayer(zonesLayer);
                }
            }

            if (arrowLayer) {
                const shouldShowArrows = showTrajectory && showDirectionArrows;
                const hasLayer = mapInstance.hasLayer(arrowLayer);
                if (shouldShowArrows && !hasLayer) {
                    arrowLayer.addTo(mapInstance);
                } else if (!shouldShowArrows && hasLayer) {
                    mapInstance.removeLayer(arrowLayer);
                }
            }
        } catch (e) {
            console.warn('Error updating map layers:', e);
        }
    }

    function applySelectedMapMode() {
        updateMapLayerVisibility(mapDayInstance, mapDayLayers, mapMode);
        updateMapLayerVisibility(mapNightInstance, mapNightLayers, mapMode);
        if (mapModeSelectEl) {
            mapModeSelectEl.value = mapMode;
        }
        mapLayerSelects.forEach((sel) => {
            sel.value = mapMode;
        });
        if (arrowToggleEl) {
            arrowToggleEl.checked = showDirectionArrows;
            arrowToggleEl.disabled = mapMode !== 'trajectory';
        }
    }

    function setMapMode(mode) {
        mapMode = MAP_LAYER_MODES.includes(mode) ? mode : 'heat';
        applySelectedMapMode();
    }

    function resetUI() {
        destroyCharts();
        destroyMap();

        const idsToClear = ['mainStats', 'distanceComparison', 'vectorAnalysis', 'lyingZones', 'behaviorTimeline', 'breedingInfo', 'standingZones', 'isolationEvents', 'crossValidationStats'];
        for (const id of idsToClear) {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '';
        }
        const tbody = document.querySelector('#behaviorTable tbody');
        if (tbody) tbody.innerHTML = '';
        const cleaningEl = document.getElementById('cleaningSummary');
        if (cleaningEl) {
            cleaningEl.innerHTML = '<p class="cleaning-empty">Zaznamy zatim nejsou.</p>';
        }
    }

    function renderCleaningSummary(stats) {
        const container = document.getElementById('cleaningSummary');
        if (!container) return;

        if (!stats) {
            container.innerHTML = '<p class="cleaning-empty">Zaznamy zatim nejsou.</p>';
            return;
        }

        const datasetName = stats.datasetName || 'Dataset';
        const fakeValue = Number(stats.fakeGpsRecords || 0).toLocaleString('cs-CZ');
        const lostValue = Number(stats.lostPackets || 0).toLocaleString('cs-CZ');

        container.innerHTML = `
            <div class="cleaning-card">
                <div class="cleaning-title">${datasetName}</div>
                <div class="cleaning-metric">
                    <span>Fake GPS</span>
                    <strong>${fakeValue}</strong>
                </div>
                <div class="cleaning-metric">
                    <span>Lost data</span>
                    <strong>${lostValue}</strong>
                </div>
            </div>
        `;
    }

    // ---- Timeline building
    function buildTimelineSegments(segments, options = {}) {
        const { gapBehavior = 'unknown', markGap = false } = options || {};
        const clamp = (sec) => Math.max(0, Math.min(DAY_TOTAL_SEC, sec));
        const sorted = [...segments].sort((a, b) => a.startSec - b.startSec);
        const padded = [];
        let cursor = 0;

        const pushGap = (from, to) => {
            const start = clamp(from);
            const end = clamp(to);
            if (end <= start) return;
            const gapSegment = {
                behavior: gapBehavior,
                startSec: start,
                endSec: end,
                centerLat: FACILITY_CENTER[0],
                centerLon: FACILITY_CENTER[1]
            };
            if (markGap) gapSegment.gapFill = true;
            padded.push(gapSegment);
        };

        for (const seg of sorted) {
            const start = clamp(seg.startSec);
            const end = clamp(seg.endSec);
            if (end <= start) continue;
            if (start > cursor) pushGap(cursor, start);
            padded.push({
                ...seg,
                startSec: start,
                endSec: end
            });
            cursor = Math.max(cursor, end);
        }

        if (cursor < DAY_TOTAL_SEC) pushGap(cursor, DAY_TOTAL_SEC);
        if (padded.length === 0) pushGap(0, DAY_TOTAL_SEC);
        return padded;
    }

    function buildBehaviorLabel(behavior) {
        const labels = {
            'lying': 'Ležení',
            'lying_active': 'Ležení (aktivní)',
            'standing': 'Stání',
            'standing_ruminating': 'Stání (přežvykování)',
            'standing_active': 'Stání (aktivní)',
            'walking': 'Chůze',
            'grazing': 'Pastva',
            'slow_walk': 'Pomalá chůze',
            'normal_walk': 'Normální chůze',
            'fast_walk': 'Rychlá chůze',
            'running': 'Běh',
            'unknown': 'Neznámé'
        };
        return labels[behavior] || behavior;
    }

    function setPdfTitle(datasetBase) {
        document.title = `Analýza_${datasetBase}.pdf`;
    }

    function updateHeader(cowId, dateStr, datasetFile, breedingStatus) {
        const h1 = document.querySelector('.header h1');
        const sub = document.querySelector('.header .subtitle');
        if (h1) h1.textContent = `🐄 Analýza chování - krávy ID ${cowId}`;
        
        let subtitleText = `Dataset: ${datasetFile} | ${dateStr} | Teltonika FMB920`;
        if (breedingStatus && breedingStatus.status === 'likely_pregnant') {
            subtitleText += ` | Březí (${breedingStatus.trimester}. trimestr, den ${breedingStatus.gestationDay})`;
        }
        if (sub) sub.textContent = subtitleText;
    }

    // ---- Map creation helpers
    function createEsriMaxarLayer() {
        return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics'
        });
    }

    function addFacilityOverlays(map) {
        const group = L.layerGroup();

        const fenceColors = ['#ff2d55', '#ff2d55', '#4c0519'];
        RED_FENCES.forEach((coords, idx) => {
            if (!coords) return;
            const fenceLayer = L.polygon(coords, {
                color: fenceColors[idx] || '#ff2d55',
                weight: 4,
                opacity: idx === 0 ? 0.95 : 0.85,
                dashArray: idx === 0 ? null : '8 6',
                fill: true,
                fillColor: idx === 2 ? '#fda4af' : '#fee2e2',
                fillOpacity: 0.35
            }).bindPopup(`RED FENCE ${idx + 1}`);
            fenceLayer.addTo(group);
        });

        const zoneA = L.polyline(ZONE_A, {
            color: '#a855f7',
            weight: 3,
            opacity: 0.95
        }).bindPopup('Klidová zóna A');
        zoneA.addTo(group);

        const zoneB = L.polyline(ZONE_B, {
            color: '#38bdf8',
            weight: 3,
            opacity: 0.95
        }).bindPopup('Zimoviště B');
        zoneB.addTo(group);

        const zoneC = L.polyline(ZONE_C, {
            color: '#451a03',
            weight: 3,
            opacity: 0.95
        }).bindPopup('Zóna C');
        zoneC.addTo(group);

        const center = L.circleMarker(FACILITY_CENTER, {
            radius: 6,
            color: '#ffffff',
            weight: 2,
            opacity: 0.95,
            fillColor: '#e94560',
            fillOpacity: 0.9
        }).bindPopup('Střed areálu');
        center.addTo(group);

        group.addTo(map);
        return group;
    }

    function addScaleAndDistanceRings(map) {
        try {
            L.control.scale({
                position: 'bottomleft',
                metric: true,
                imperial: false,
                maxWidth: 160
            }).addTo(map);
        } catch { }

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
                }).bindTooltip(`${r} m`, { permanent: false, direction: 'center' }).addTo(map);
            } catch { }
        }
    }

    function buildFacilityBounds(extraPoints) {
        let bounds = null;
        for (const fence of RED_FENCES) {
            if (!fence) continue;
            const fenceBounds = L.latLngBounds(fence);
            bounds = bounds ? bounds.extend(fenceBounds) : fenceBounds;
        }
        const b = bounds || L.latLngBounds(FALLBACK_GEOMETRY.redFences[0]);
        if (Array.isArray(extraPoints)) {
            for (const p of extraPoints) {
                if (!Array.isArray(p) || p.length < 2) continue;
                b.extend([p[0], p[1]]);
            }
        }
        b.extend(FACILITY_CENTER);
        return b;
    }

    // Colors
    const TEAL_COLORS = ['#5eead4', '#2dd4bf', '#14b8a6', '#0d9488', '#0f766e', '#115e59', '#134e4a', '#042f2e'];
    const AMBER_COLORS = ['#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f'];

    function pickColorFromScale(scale, pct) {
        if (!Number.isFinite(pct)) return scale[0];
        const clamped = Math.max(0, Math.min(100, pct));
        const idx = Math.min(scale.length - 1, Math.floor((clamped / 100) * (scale.length - 1)));
        return scale[idx];
    }

    const pickTealColor = (pct) => pickColorFromScale(TEAL_COLORS, pct);
    const pickAmberColor = (pct) => pickColorFromScale(AMBER_COLORS, pct);

    function computeZoneRadius(pct) {
        const clamped = Math.max(0, pct);
        return 8 + Math.sqrt(clamped) * 0.8;
    }

    // ---- CORE ANALYSIS FUNCTION
    async function analyzeDataset(datasetFile, calvingDate, bullEndDate) {
        const parsed = parseDatasetFileName(datasetFile);
        if (!parsed) throw new Error('Neplatný název datasetu. Očekávám IDXXXXXX_ddmmyy.js');

        const datasetBase = `ID${parsed.cowId}_${parsed.ddmmyy}`;
        const displayDate = ddmmyyToDisplayDate(parsed.ddmmyy);
        const ddmmyy = parsed.ddmmyy;

        resetUI();
        if (exportPdfBtnEl) exportPdfBtnEl.disabled = true;

        // Calculate breeding status - use PregnancyCalculator if bullEndDate is provided
        let breedingStatus;
        if (calvingDate && bullEndDate && typeof PregnancyCalculator !== 'undefined') {
            // Use enhanced PregnancyCalculator for full probability calculation
            const analysisDateObj = ddmmyyToDate(ddmmyy);
            breedingStatus = PregnancyCalculator.calculate(calvingDate, bullEndDate, analysisDateObj);
            // Add backward compatibility fields
            breedingStatus.estimatedDueDate = breedingStatus.expectedDueDate;
        } else {
            breedingStatus = calculateBreedingStatus(calvingDate, ddmmyy);
        }

        const datasetFiles = buildCandidateDatasetFiles(parsed);
        let loadedFile = null;
        let lastError = null;
        for (const fileName of datasetFiles) {
            setStatus(`Načítám ${fileName} ...`);
            try {
                await loadScript(`Datasets/${fileName}`);
                loadedFile = fileName;
                break;
            } catch (err) {
                lastError = err;
            }
        }
        if (!loadedFile) {
            throw lastError || new Error(`Nepodařilo se načíst žádný dataset soubor: ${datasetFiles.join(', ')}`);
        }

        const tryVarNames = [];
        const candidateCowIds = [];
        const addCowIdCandidate = (id) => {
            const v = String(id || '').trim();
            if (!v) return;
            if (!/^\d+$/.test(v)) return;
            if (!candidateCowIds.includes(v)) candidateCowIds.push(v);
        };

        addCowIdCandidate(parsed.cowId);
        if (parsed.cowId.length === 6) addCowIdCandidate(`${parsed.cowId}5`);
        addCowIdCandidate('175959');
        addCowIdCandidate('227831');
        addCowIdCandidate('166691');

        let raw = null;
        let resolvedCowId = null;
        for (const cowIdCandidate of candidateCowIds) {
            const vn = `COW_${cowIdCandidate}_${ddmmyy}`;
            tryVarNames.push(vn);
            const candidate = getDatasetArrayByVarName(vn);
            if (Array.isArray(candidate) && candidate.length > 0) {
                raw = candidate;
                resolvedCowId = cowIdCandidate;
                if (cowIdCandidate === parsed.cowId) break;
            }
        }

        if (!Array.isArray(raw) || raw.length === 0) {
            throw new Error(`Dataset proměnná nenalezena. Zkoušel jsem: ${tryVarNames.join(', ')}`);
        }

        setStatus(`Analyzuji ${raw.length} záznamů s rozšířenou cross-validací ...`);

        // Parse samples with epoch-based timestamps (fixes midnight crossing issues)
        const parsedRecords = [];
        let fakeGpsRecords = 0;
        for (const r of raw) {
            const tSec = parseTimeToSeconds(r.timestamp);
            const epochSec = parseDateTimeToEpoch(r.date, r.timestamp);
            const lat = safeNumber(r.gps_lat);
            const lon = safeNumber(r.gps_lon);
            const accX = safeNumber(r.acc_x);
            const accY = safeNumber(r.acc_y);
            const accZ = safeNumber(r.acc_z);
            if (tSec === null || lat === null || lon === null) continue;
            if (!isInsideRedFence(lat, lon)) {
                fakeGpsRecords++;
                continue;
            }

            const mag = (accX !== null && accY !== null && accZ !== null)
                ? Math.sqrt(accX * accX + accY * accY + accZ * accZ)
                : null;

            parsedRecords.push({ tSec, epochSec, lat, lon, accX, accY, accZ, mag, date: r.date });
        }

        // Fix midnight crossing issue (FMB920 datasets sometimes have wrong dates after midnight)
        setStatus(`Kontroluji přechod přes půlnoc ...`);
        fixMidnightCrossing(parsedRecords);

        // Filter retry transmissions (FMB920 sends old data when connection restored)
        setStatus(`Filtruji retry přenosy (FMB920 opakovaná volání) ...`);
        const retryFilterResult = filterRetryRecords(parsedRecords, 300); // 5 min threshold
        const samples = retryFilterResult.filtered;
        const retryStats = retryFilterResult.stats;

        if (retryStats.removed > 0) {
            console.log(`[OneDay] Filtered ${retryStats.removed} retry records (${retryStats.total} -> ${retryStats.filtered})`);
        }

        // Sort by epoch (proper chronological order across midnight)
        samples.sort((a, b) => (a.epochSec || a.tSec) - (b.epochSec || b.tSec));

        if (samples.length < 2) throw new Error('Po filtraci nezbylo dost validních záznamů.');

        // Analyze StandBy periods before resampling
        setStatus(`Analyzuji StandBy periody (jednotka v režimu spánku) ...`);
        const standByAnalysis = analyzeStandByPeriods(samples);

        // Resample to 1Hz for consistent analysis (now with gap skipping)
        const estimatedSamples = samples.reduce((acc, s, i) => {
            if (i === 0) return acc;
            const gap = (samples[i].epochSec || samples[i].tSec) - (samples[i-1].epochSec || samples[i-1].tSec);
            return acc + (gap <= MAX_INTERVAL_SEC ? gap : 0);
        }, samples.length);
        setStatus(`Interpoluji data na 1Hz frekvenci (${samples.length} orig → ~${estimatedSamples} vzorků, retry filtered: ${retryStats.removed}) ...`);
        const resampledSamples = resampleTo1Hz(samples);
        
        // Use resampled data for analysis
        const analysisData = resampledSamples;
        const originalSampleCount = samples.length;
        const resampledSampleCount = resampledSamples.length;
        const interpolatedCount = resampledSamples.filter(s => s.interpolated).length;
        const standByCount = resampledSamples.filter(s => s.standByPeriod).length;
        const postureAnalysis = buildPostureTimeline(analysisData);
        const postureSummary = postureAnalysis.summary || { standingSec: 0, lyingSec: 0, transitionSec: 0 };

        setStatus(`Analyzuji ${resampledSampleCount} vzorků (${originalSampleCount} originálních, ${interpolatedCount} interpolovaných, ${standByCount} ze StandBy) ...`);

        // Initialize accumulators
        let unknownTime = 0;
        let gapTimeAddedToLying = 0;
        let minSec = Infinity;
        let maxSec = -Infinity;

        for (const s of analysisData) {
            if (s.tSec < minSec) minSec = s.tSec;
            if (s.tSec > maxSec) maxSec = s.tSec;
        }
        if (Number.isFinite(minSec) && Number.isFinite(maxSec)) {
            unknownTime += Math.max(0, minSec);
            unknownTime += Math.max(0, DAY_TOTAL_SEC - maxSec);
        }

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
        const lastArrow = { I: null, II: null, III: null };

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
        let standByLyingTime = 0;  // Time classified as lying due to StandBy

        let gpsStableTimeTotal = 0;
        let gpsStableStandingTime = 0;
        let gpsStableLyingTime = 0;

        let intervalsConsidered = 0;
        let intervalsSkippedInvalidTime = 0;
        let intervalsSkippedOutsideFence = 0;

        // Cross-validation statistics
        let crossValidationStats = {
            consistent: 0,
            gpsOverride: 0,
            accOverride: 0,
            uncertain: 0,
            total: 0,
            standByIntervals: 0,
            zoneOverride: 0
        };

        // Calculate center of activity (use original samples for true center)
        let centerLatSum = 0;
        let centerLonSum = 0;
        for (const p of samples) {
            centerLatSum += p.lat;
            centerLonSum += p.lon;
        }
        const centerLat = centerLatSum / samples.length;
        const centerLon = centerLonSum / samples.length;
        let maxDistFromCenter = 0;
        for (const p of samples) {
            const d = haversineDistance(centerLat, centerLon, p.lat, p.lon);
            if (d > maxDistFromCenter) maxDistFromCenter = d;
        }

        let firstInFence = null;
        let lastInFence = null;

        // Process intervals using resampled 1Hz data
        for (let i = 1; i < analysisData.length; i++) {
            const prev = analysisData[i - 1];
            const curr = analysisData[i];
            const dt = curr.tSec - prev.tSec;

            // With 1Hz resampling, dt should always be 1 second
            if (!Number.isFinite(dt) || dt <= 0) {
                intervalsSkippedInvalidTime++;
                continue;
            }
            
            // Check if this is a StandBy period
            const isStandByInterval = curr.standByPeriod || prev.standByPeriod;
            
            if (dt > MAX_INTERVAL_SEC) {
                intervalsSkippedInvalidTime++;
                unknownTime += dt;
                continue;
            }
            intervalsConsidered++;

            const prevInside = isInsideRedFence(prev.lat, prev.lon);
            const currInside = isInsideRedFence(curr.lat, curr.lon);
            if (!prevInside || !currInside) {
                intervalsSkippedOutsideFence++;
                unknownTime += dt;
                continue;
            }

            const distM = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
            const speedMps = distM / dt;
            const midSec = (prev.tSec + curr.tSec) / 2;
            const bearingDeg = bearingDegrees(prev.lat, prev.lon, curr.lat, curr.lon);
            const distFromCenter = haversineDistance(FACILITY_CENTER[0], FACILITY_CENTER[1], curr.lat, curr.lon);

            const point = [curr.lat, curr.lon];
            
            // Only add non-interpolated points to GPS trajectory (avoid cluttering with interpolated points)
            if (!curr.interpolated) {
                gpsPoints.push(point);
            }

            const isDay = midSec >= DAY_START_SEC && midSec < DAY_END_SEC;
            if (!curr.interpolated) {
                if (isDay) {
                    gpsPointsDay.push(point);
                } else {
                    gpsPointsNight.push(point);
                }
            }

            if (!firstInFence) firstInFence = point;
            lastInFence = point;

            // Calculate accelerometer metrics
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
                    
                    const normG = n / ACC_SCALE;
                    dynG = Math.abs(normG - ACC_GRAVITY_G);
                }
            }

            // For StandBy intervals, we know the cow was NOT moving (that's why unit went to sleep)
            // So we override GPS movement classification
            let gpsMovement, accPosture, accMovement, finalBehavior;
            const postureContext = curr.postureContext;
            
            if (isStandByInterval) {
                // StandBy = cow was stationary, classify as lying (resting) by default
                gpsMovement = { movement: 'stationary', confidence: 0.95 };
                accPosture = classifyPostureFromAcc(accAbsUnit, accNorm, postureContext);
                accMovement = { movement: 'stationary', confidence: 0.95 };
                
                // During StandBy, trust accelerometer for posture (lying vs standing)
                if (accPosture.posture === 'lying' || accPosture.confidence < 0.5) {
                    finalBehavior = {
                        behavior: 'lying',
                        posture: 'lying',
                        movement: 'stationary',
                        confidence: 0.9,
                        source: 'standby_inferred',
                        consistency: 'standby'
                    };
                } else {
                    finalBehavior = {
                        behavior: 'standing',
                        posture: 'standing',
                        movement: 'stationary',
                        confidence: 0.8,
                        source: 'standby_inferred',
                        consistency: 'standby'
                    };
                }
                
                crossValidationStats.standByIntervals++;
            } else {
                // Normal classification with cross-validation
                gpsMovement = classifyMovementFromGPS(distM, speedMps, dt);
                accPosture = classifyPostureFromAcc(accAbsUnit, accNorm, postureContext);
                accMovement = classifyMovementFromAcc(dynG, 0);
                finalBehavior = crossValidateBehavior(gpsMovement, accMovement, accPosture);
            }

            const isWalking = !isStandByInterval && gpsMovement.movement !== 'stationary';

            if ((finalBehavior.behavior === 'lying' || finalBehavior.posture === 'lying') &&
                !isPointInsidePolygon(curr.lat, curr.lon, ZONE_A)) {
                finalBehavior = {
                    ...finalBehavior,
                    behavior: isWalking ? 'walking' : 'standing',
                    posture: 'standing',
                    consistency: 'zone_override',
                    source: 'zone_constraint'
                };
                crossValidationStats.zoneOverride++;
            }

            // Update cross-validation stats
            crossValidationStats.total++;
            if (finalBehavior.consistency === 'consistent') crossValidationStats.consistent++;
            else if (finalBehavior.consistency === 'gps_override') crossValidationStats.gpsOverride++;
            else if (finalBehavior.consistency === 'acc_override') crossValidationStats.accOverride++;
            else if (finalBehavior.consistency === 'standby') { /* already counted */ }
            else if (finalBehavior.consistency === 'zone_override') { /* counted above */ }
            else crossValidationStats.uncertain++;

            if (!isWalking) gpsStableTimeTotal += dt;
            const movedDist = isWalking ? distM : 0;
            totalDistance += movedDist;
            if (isDay) dayDistance += movedDist;
            else nightDistance += movedDist;
            
            // Track StandBy lying time separately
            if (isStandByInterval && finalBehavior.behavior === 'lying') {
                standByLyingTime += dt;
            }

            // Fence arrows
            const prevInsideFenceI = isInsideFenceI(prev.lat, prev.lon);
            const currInsideFenceI = isInsideFenceI(curr.lat, curr.lon);
            const prevInsideFenceII = isInsideFenceII(prev.lat, prev.lon);
            const currInsideFenceII = isInsideFenceII(curr.lat, curr.lon);
            const prevInsideFenceIII = isInsideFenceIII(prev.lat, prev.lon);
            const currInsideFenceIII = isInsideFenceIII(curr.lat, curr.lon);

            const pushFenceArrow = (fenceName, lastStateKey) => {
                if (prev.interpolated || curr.interpolated) return;
                const target = isDay ? fenceArrowsDay : fenceArrowsNight;
                const last = lastArrow[lastStateKey] || lastArrow[fenceName];
                const midLat = (prev.lat + curr.lat) / 2;
                const midLon = (prev.lon + curr.lon) / 2;
                const distSinceLast = last ? haversineDistance(last.lat, last.lon, midLat, midLon) : Infinity;
                if (distSinceLast < 20) return;

                const arrow = {
                    lat: midLat,
                    lon: midLon,
                    bearing: bearingDeg,
                    fence: fenceName
                };
                target.push(arrow);
                lastArrow[lastStateKey] = arrow;
                lastArrow[fenceName] = arrow;
            };

            if (distM > 0.5 && Number.isFinite(bearingDeg)) {
                if (prevInsideFenceI && currInsideFenceI) pushFenceArrow('I', `I_${isDay ? 'day' : 'night'}`);
                if (prevInsideFenceII && currInsideFenceII) pushFenceArrow('II', `II_${isDay ? 'day' : 'night'}`);
                if (prevInsideFenceIII && currInsideFenceIII) pushFenceArrow('III', `III_${isDay ? 'day' : 'night'}`);
            }

            // RMS and energy calculations
            if (dynG !== null && Number.isFinite(dynG)) {
                const dynSquared = dynG * dynG;
                rmsDynSum += dynSquared * dt;
                rmsDynWeight += dt;
                energySum += dynG * dt;
                const hourIdx = Math.min(23, Math.max(0, Math.floor(midSec / 3600)));
                hourlyActivityStats[hourIdx].rmsSum += dynSquared * dt;
                hourlyActivityStats[hourIdx].rmsWeight += dt;
                hourlyActivityStats[hourIdx].energy += dynG * dt;
                consistencyTime += dt;

                // Check GPS-ACC consistency for movement
                const accMoving = dynG >= ACC_DYN_WALKING_G;
                if ((isWalking && !accMoving) || (!isWalking && accMoving)) {
                    inconsistentDuration += dt;
                }
            } else {
                consistencyTime += dt;
            }

            // Step detection
            const prevAccY = prev.accY;
            const currAccY = curr.accY;
            if (prevAccY !== null && currAccY !== null &&
                Math.abs(prevAccY) >= ACC_STEP_THRESHOLD &&
                Math.abs(currAccY) >= ACC_STEP_THRESHOLD) {
                const prevSign = prevAccY >= 0 ? 1 : -1;
                const currSign = currAccY >= 0 ? 1 : -1;
                if (prevSign !== currSign) stepZeroCrossings++;
                stepDuration += dt;
            }

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
                accX,
                accY,
                accZ,
                accNorm,
                accAbsUnit,
                dynG,
                gpsMovement,
                accPosture,
                accMovement,
                finalBehavior
            });
        }

        // Aggregate behavior durations
        for (const it of intervals) {
            const simpleBehavior = simplifyBehavior(it.finalBehavior.behavior);
            
            if (simpleBehavior === 'walking') walkingTime += it.dt;
            else if (simpleBehavior === 'lying') lyingTime += it.dt;
            else standingTime += it.dt;

            if (!it.isWalking) {
                if (simpleBehavior === 'lying') gpsStableLyingTime += it.dt;
                else gpsStableStandingTime += it.dt;
            }

            addDurationToHourly(hourlyData, it.midSec, simpleBehavior, it.dt);

            // Heat points
            let heatWeight = 0.45;
            if (simpleBehavior === 'lying') heatWeight = 0.95;
            if (simpleBehavior === 'walking') heatWeight = 0.55;
            const heatPoint = [it.lat, it.lon, heatWeight];
            heatPoints.push(heatPoint);
            if (it.isDay) heatPointsDay.push(heatPoint);
            else heatPointsNight.push(heatPoint);

            // Cluster points with time data for Day/Night separation and point layer
            if (simpleBehavior === 'lying') {
                const lyingPt = { lat: it.lat, lon: it.lon, dt: it.dt, startSec: it.startSec, endSec: it.endSec, midSec: it.midSec };
                lyingPointsForClusters.push(lyingPt);
                if (it.isDay) lyingPointsDay.push(lyingPt);
                else lyingPointsNight.push(lyingPt);
            }
            if (simpleBehavior === 'standing') {
                const standPt = { lat: it.lat, lon: it.lon, dt: it.dt, startSec: it.startSec, endSec: it.endSec, midSec: it.midSec };
                standingPointsForClusters.push(standPt);
                if (it.isDay) standingPointsDay.push(standPt);
                else standingPointsNight.push(standPt);
            }
        }

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

        // Calculate derived metrics
        const displacement = haversineDistance(
            (firstInFence ? firstInFence[0] : samples[0].lat),
            (firstInFence ? firstInFence[1] : samples[0].lon),
            (lastInFence ? lastInFence[0] : samples[samples.length - 1].lat),
            (lastInFence ? lastInFence[1] : samples[samples.length - 1].lon)
        );
        const circularity = totalDistance / Math.max(1, displacement);

        const vectorSummary = {
            morning: averageDirection(intervals, 6 * 3600, 10 * 3600),
            midday: averageDirection(intervals, 10 * 3600, 14 * 3600),
            afternoon: averageDirection(intervals, 14 * 3600, 18 * 3600),
            maxDistFromCenter,
            circularity
        };

        const perimeterOutliers = collectPerimeterOutliers(intervals);
        const rmsDyn = rmsDynWeight > 0 ? Math.sqrt(rmsDynSum / rmsDynWeight) : 0;
        const meanEnergy = consistencyTime > 0 ? energySum / consistencyTime : 0;
        const consistencyScore = consistencyTime > 0 ? Math.max(0, 1 - (inconsistentDuration / consistencyTime)) : 1;

        // Step frequency calculation with speed fallback
        // Primary: zero-crossing detection from accelerometer
        let stepFrequencyHz = stepDuration > 0 ? (stepZeroCrossings / 2) / stepDuration : 0;

        // Fallback: estimate from walking speed if accelerometer detection failed
        // Based on: pomalá pastva 0.5-1.0Hz (0.05-0.25 m/s), normální chůze 1.0-1.5Hz (0.25-0.8 m/s), rychlá chůze 1.5-2.0Hz (0.8-1.5 m/s)
        if (stepFrequencyHz < 0.1 && walkingTime > 60) {
            const avgWalkingSpeedMps = totalDistance / Math.max(1, walkingTime);
            if (avgWalkingSpeedMps >= 0.05) {
                // Linear interpolation: 0.05 m/s -> 0.5 Hz, 0.8 m/s -> 1.5 Hz, 1.5 m/s -> 2.0 Hz
                if (avgWalkingSpeedMps < 0.25) {
                    // Grazing/slow walk: 0.5-1.0 Hz
                    stepFrequencyHz = 0.5 + (avgWalkingSpeedMps - 0.05) / 0.2 * 0.5;
                } else if (avgWalkingSpeedMps < 0.8) {
                    // Normal walk: 1.0-1.5 Hz
                    stepFrequencyHz = 1.0 + (avgWalkingSpeedMps - 0.25) / 0.55 * 0.5;
                } else if (avgWalkingSpeedMps < 1.5) {
                    // Fast walk: 1.5-2.0 Hz
                    stepFrequencyHz = 1.5 + (avgWalkingSpeedMps - 0.8) / 0.7 * 0.5;
                } else {
                    // Running: 2.0-3.0 Hz
                    stepFrequencyHz = Math.min(3.0, 2.0 + (avgWalkingSpeedMps - 1.5) / 1.5 * 1.0);
                }
            }
        }

        const speedMpsBins = computeBins2h(
            intervals.map((i) => i.speedMps),
            intervals.map((i) => i.midSec),
            intervals.map((i) => i.dt)
        );
        const accYBins = computeBins2h(
            intervals.map((i) => i.accY),
            intervals.map((i) => i.midSec),
            intervals.map((i) => i.dt)
        );

        const lyingClusters = clusterDwellZones(lyingPointsForClusters);
        const standingClusters = detectStandingZones(intervals);

        // Day/Night separated clusters for point layer
        const lyingClustersDay = clusterDwellZones(lyingPointsDay);
        const lyingClustersNight = clusterDwellZones(lyingPointsNight);
        const standingClustersDay = clusterDwellZones(standingPointsDay, STANDING_ZONE_MIN_DURATION_SEC);
        const standingClustersNight = clusterDwellZones(standingPointsNight, STANDING_ZONE_MIN_DURATION_SEC);

        const isolationEvents = detectIsolationEvents(intervals, FACILITY_CENTER);

        // Ensure 24h accounting
        const accounted = walkingTime + lyingTime + standingTime + unknownTime;
        if (accounted < DAY_TOTAL_SEC) {
            unknownTime += (DAY_TOTAL_SEC - accounted);
        } else if (accounted > DAY_TOTAL_SEC) {
            unknownTime = Math.max(0, unknownTime - (accounted - DAY_TOTAL_SEC));
        }

        // OPRAVA: NEpřidáváme unknownTime do lyingTime!
        // Unknown time musí zůstat jako samostatná kategorie pro transparentnost
        // Předchozí logika způsobovala nerealistické hodnoty ležení (22.6h/den)
        gapTimeAddedToLying = 0; // Zachováno pro zpětnou kompatibilitu, ale nepřidáváme
        // unknownTime zůstává nezměněný a bude reportován samostatně

        // Cross-validation percentage
        crossValidationStats.consistentPct = crossValidationStats.total > 0 
            ? (crossValidationStats.consistent / crossValidationStats.total * 100).toFixed(1)
            : 0;
        
        // StandBy statistics
        crossValidationStats.standByPct = crossValidationStats.total > 0
            ? (crossValidationStats.standByIntervals / crossValidationStats.total * 100).toFixed(1)
            : 0;

        const cleaningStats = {
            datasetName: datasetBase,
            fakeGpsRecords,
            lostPackets: retryStats.removed || 0
        };

        return {
            datasetBase,
            cowId: resolvedCowId || parsed.cowId,
            displayDate,
            recordCount: raw.length,
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
            breedingStatus,
            postureSummary,
            postureCalibration: postureAnalysis.calibration,
            postureSegments: postureAnalysis.segments,
            calvingDateInput: calvingDate || null,
            bullEndDateInput: bullEndDate || null,
            ddmmyy,
            cleaningStats
        };
    }

    // ---- RENDERING (simplified - main structure)
    function renderAll(results) {
        const {
            datasetBase,
            cowId,
            displayDate,
            recordCount,
            resampledCount,
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
            hourlyActivityStats,
            crossValidationStats,
            standByAnalysis,
            breedingStatus,
            postureSummary,
            postureCalibration,
            postureSegments,
            calvingDateInput,
            bullEndDateInput,
            ddmmyy,
            cleaningStats
        } = results;

        selectedCalvingDate = calvingDateInput || null;
        selectedBullEndDate = bullEndDateInput || null;

        updateHeader(cowId, displayDate, `${datasetBase}.js`, breedingStatus);
        setPdfTitle(datasetBase);
        renderCleaningSummary(cleaningStats);

        // Render breeding info - enhanced with probability from PregnancyCalculator
        const breedingInfoEl = document.getElementById('breedingInfo');
        if (breedingInfoEl && breedingStatus) {
            let breedingHTML = '';

            // Check if we have full probability data from PregnancyCalculator
            const hasProbability = breedingStatus.probabilityPercent !== undefined;

            if (breedingStatus.status === 'likely_pregnant' || breedingStatus.status === 'possibly_pregnant') {
                const alertClass = breedingStatus.preParturitionAlert ? 'alert-warning' : '';
                const probabilityText = hasProbability ? `${breedingStatus.probabilityPercent}%` : 'Ano';
                const trimesterText = breedingStatus.trimester ? `${breedingStatus.trimester}. trimestr` : '-';
                const gestationDayText = breedingStatus.gestationDay !== null ? `Den ${breedingStatus.gestationDay}` : '-';
                const dueDate = breedingStatus.expectedDueDate || breedingStatus.estimatedDueDate || '-';
                const daysTo = breedingStatus.daysToParturition !== null ? breedingStatus.daysToParturition : '-';
                const calvingDateText = breedingStatus.calvingDate || (calvingDate ? new Date(calvingDate).toLocaleDateString('cs-CZ') : '-');

                breedingHTML = `
                    <div class="breeding-card ${alertClass}">
                        <div class="breeding-icon">🤰</div>
                        <div class="breeding-details">
                            <strong>Kráva je na ${probabilityText} pravděpodobně březí</strong>
                            <div style="margin-top: 8px;">
                                <span style="color: #888;">Poslední porod byl:</span> <strong>${calvingDateText}</strong>
                            </div>
                            <div>
                                <span style="color: #888;">Další se očekává:</span> <strong>${dueDate}</strong>
                            </div>
                            <div>
                                <span style="color: #888;">Dnů do porodu:</span> <strong>${daysTo}</strong>
                            </div>
                            <div style="margin-top: 5px;">
                                <span style="color: #888;">V současnosti je v:</span> <strong>${trimesterText}</strong>, <strong>${gestationDayText}</strong>
                            </div>
                            ${breedingStatus.dueDateRange ? `
                                <div style="font-size: 0.85em; color: #666; margin-top: 5px;">
                                    Rozsah porodu: ${breedingStatus.dueDateRange.earliestFormatted} - ${breedingStatus.dueDateRange.latestFormatted}
                                </div>
                            ` : ''}
                            ${breedingStatus.preParturitionAlert ? '<div class="alert-text">⚠️ POROD DO 14 DNÍ! Sledujte pre-porodní chování!</div>' : ''}
                            ${breedingStatus.recommendations && breedingStatus.recommendations.length > 0 ? `
                                <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);">
                                    ${breedingStatus.recommendations.map(rec => {
                                        const icon = rec.priority === 'urgent' ? '🚨' : rec.priority === 'high' ? '❗' : rec.priority === 'medium' ? '📌' : 'ℹ️';
                                        return `<div style="font-size: 0.85em; color: ${rec.priority === 'urgent' ? '#f59e0b' : '#aaa'}; margin-top: 4px;">${icon} ${rec.text}</div>`;
                                    }).join('')}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            } else if (breedingStatus.status === 'uncertain' || breedingStatus.status === 'unlikely_pregnant') {
                const probabilityText = hasProbability ? `${breedingStatus.probabilityPercent}%` : '-';
                const calvingDateText = breedingStatus.calvingDate || (calvingDate ? new Date(calvingDate).toLocaleDateString('cs-CZ') : '-');

                breedingHTML = `
                    <div class="breeding-card">
                        <div class="breeding-icon">❓</div>
                        <div class="breeding-details">
                            <strong>${breedingStatus.statusText || 'Nejistý stav březosti'}</strong>
                            <div>Pravděpodobnost: ${probabilityText}</div>
                            <div style="color: #888;">Poslední porod: ${calvingDateText}</div>
                            ${breedingStatus.statusDescription ? `<div style="font-size: 0.9em; color: #aaa; margin-top: 5px;">${breedingStatus.statusDescription}</div>` : ''}
                        </div>
                    </div>
                `;
            } else if (breedingStatus.status === 'postpartum_recovery') {
                breedingHTML = `
                    <div class="breeding-card">
                        <div class="breeding-icon">🐄</div>
                        <div class="breeding-details">
                            <strong>Po porodu - zotavení</strong>
                            <div>Dnů od porodu: ${breedingStatus.daysSinceCalving}</div>
                            <div>Fertilita za: ${breedingStatus.daysUntilFertile} dnů</div>
                        </div>
                    </div>
                `;
            } else if (breedingStatus.status === 'no_fertile_window') {
                breedingHTML = `
                    <div class="breeding-card">
                        <div class="breeding-icon">⚠️</div>
                        <div class="breeding-details">
                            <strong>Bez fertilního okna</strong>
                            <div style="color: #888;">${breedingStatus.statusDescription || 'Býk odešel před koncem post-partum zotavení'}</div>
                        </div>
                    </div>
                `;
            } else if (breedingStatus.status === 'unknown' && !calvingDate) {
                breedingHTML = `
                    <div class="breeding-card">
                        <div class="breeding-icon">ℹ️</div>
                        <div class="breeding-details">
                            <strong>Údaje o březosti nejsou k dispozici</strong>
                            <div style="color: #888;">Pro výpočet zadejte datum posledního porodu a datum odchodu býka</div>
                        </div>
                    </div>
                `;
            }
            breedingInfoEl.innerHTML = breedingHTML;
        }

        // Render weather info from RUMBURK_TEMPERATURE database
        const weatherInfoEl = document.getElementById('weatherInfo');
        if (weatherInfoEl && typeof RumburkTemperature !== 'undefined') {
            const weatherData = RumburkTemperature.getDayData(ddmmyy);
            if (weatherData) {
                const category = RumburkTemperature.categorize(weatherData.tAvg);
                const alertClass = category.alert ? 'alert-warning' : '';

                weatherInfoEl.innerHTML = `
                    <div class="weather-card ${alertClass}" style="background: linear-gradient(145deg, #1f4068, #162447); border-radius: 12px; padding: 15px; margin-bottom: 15px; border: 1px solid ${category.color}40;">
                        <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
                            <div style="font-size: 2.5em;">${category.icon}</div>
                            <div style="flex: 1;">
                                <div style="font-size: 1.3em; font-weight: 600; color: ${category.color};">
                                    ${weatherData.tAvg.toFixed(1)}°C
                                    <span style="font-size: 0.7em; color: #888; font-weight: normal;">
                                        (${weatherData.tMin.toFixed(0)}° / ${weatherData.tMax.toFixed(0)}°)
                                    </span>
                                </div>
                                <div style="font-size: 0.85em; color: #aaa; margin-top: 4px;">
                                    ${category.category} | Vlhkost: ${weatherData.humidity}% | Vítr: ${weatherData.wind} km/h
                                </div>
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; text-align: center;">
                                <div style="background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 8px;">
                                    <div style="font-size: 0.7em; color: #666;">00:00</div>
                                    <div style="font-weight: 600; color: ${RumburkTemperature.categorize(weatherData.t00).color};">${weatherData.t00.toFixed(1)}°</div>
                                </div>
                                <div style="background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 8px;">
                                    <div style="font-size: 0.7em; color: #666;">06:00</div>
                                    <div style="font-weight: 600; color: ${RumburkTemperature.categorize(weatherData.t06).color};">${weatherData.t06.toFixed(1)}°</div>
                                </div>
                                <div style="background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 8px;">
                                    <div style="font-size: 0.7em; color: #666;">12:00</div>
                                    <div style="font-weight: 600; color: ${RumburkTemperature.categorize(weatherData.t12).color};">${weatherData.t12.toFixed(1)}°</div>
                                </div>
                                <div style="background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 8px;">
                                    <div style="font-size: 0.7em; color: #666;">18:00</div>
                                    <div style="font-weight: 600; color: ${RumburkTemperature.categorize(weatherData.t18).color};">${weatherData.t18.toFixed(1)}°</div>
                                </div>
                            </div>
                        </div>
                        ${category.alert ? `
                            <div style="margin-top: 12px; padding: 10px; background: rgba(245, 158, 11, 0.15); border-radius: 8px; border-left: 3px solid #f59e0b;">
                                <span style="color: #f59e0b; font-weight: 600;">⚠️ Teplotní alert:</span>
                                <span style="color: #aaa;"> ${weatherData.tAvg < 0 ? 'Mráz může ovlivnit chování krávy (více stání pro zahřátí)' : 'Vysoké teploty mohou způsobit tepelný stres'}</span>
                            </div>
                        ` : ''}
                    </div>
                `;
            } else {
                weatherInfoEl.innerHTML = '';
            }
        }

        // Render cross-validation stats
        const crossValEl = document.getElementById('crossValidationStats');
        if (crossValEl && crossValidationStats) {
            crossValEl.innerHTML = `
                <div class="cross-val-card">
                    <div class="cross-val-header">🔄 GPS ↔ ACC Cross-Validace | 📊 1Hz Interpolace | 😴 StandBy Režim</div>
                    <div class="cross-val-stats">
                        <div class="cv-stat">
                            <span class="cv-value">${crossValidationStats.consistentPct}%</span>
                            <span class="cv-label">GPS↔ACC Shoda</span>
                        </div>
                        <div class="cv-stat">
                            <span class="cv-value">${crossValidationStats.standByPct}%</span>
                            <span class="cv-label">StandBy (klid)</span>
                        </div>
                        <div class="cv-stat">
                            <span class="cv-value">${recordCount} → ${resampledCount || recordCount}</span>
                            <span class="cv-label">Vzorky (orig→1Hz)</span>
                        </div>
                        <div class="cv-stat">
                            <span class="cv-value">${standByAnalysis ? formatDuration(standByAnalysis.totalTime) : '-'}</span>
                            <span class="cv-label">Celkový StandBy</span>
                        </div>
                        <div class="cv-stat">
                            <span class="cv-value">${standByAnalysis ? standByAnalysis.count : 0}</span>
                            <span class="cv-label">StandBy period</span>
                        </div>
                        <div class="cv-stat">
                            <span class="cv-value">${(consistencyScore * 100).toFixed(1)}%</span>
                            <span class="cv-label">Konzistence</span>
                        </div>
                    </div>
                </div>
            `;
        }

        const posturePanel = document.getElementById('postureConfidencePanel');
        if (posturePanel) {
            renderPostureConfidencePanel(posturePanel, {
                standingSec: standingTime || 0,
                lyingSec: lyingTime || 0,
                transitionSec: postureSummary ? (postureSummary.transitionSec || 0) : 0,
                unknownSec: unknownTime || 0,
                postureSummary
            });
        }

        // Render main stats
        const mainStats = document.getElementById('mainStats');
        if (mainStats) {
            const avgSpeedFullMpm = totalDistance > 0 ? (totalDistance / DAY_TOTAL_SEC) * 60 : 0;
            const avgSpeedWalkingMpm = walkingTime > 0 ? (totalDistance / walkingTime) * 60 : 0;
            const rmsLevel = classifyRmsLevel(rmsDyn);
            const stepLevel = classifyStepFrequency(stepFrequencyHz);
            const stableTotal = Math.max(0, gpsStableTimeTotal);
            const stableStandingPct = stableTotal > 0 ? (gpsStableStandingTime / stableTotal) * 100 : 0;
            const stableLyingPct = stableTotal > 0 ? (gpsStableLyingTime / stableTotal) * 100 : 0;

            mainStats.innerHTML = `
                <div class="stat-card">
                    <div class="icon">📍</div>
                    <div class="value">${(totalDistance / 1000).toFixed(2)} km</div>
                    <div class="label">Celková vzdálenost</div>
                </div>
                <div class="stat-card">
                    <div class="icon">😴</div>
                    <div class="value">${formatDuration(lyingTime)}</div>
                    <div class="label">Doba ležení${standByLyingTime > 0 ? ` (${formatDuration(standByLyingTime)} StandBy)` : ''}</div>
                </div>
                <div class="stat-card">
                    <div class="icon">🐄</div>
                    <div class="value">${formatDuration(standingTime)}</div>
                    <div class="label">Doba stání</div>
                </div>
                <div class="stat-card">
                    <div class="icon">🚶</div>
                    <div class="value">${formatDuration(walkingTime)}</div>
                    <div class="label">Doba chůze</div>
                </div>
                <div class="stat-card">
                    <div class="icon">❓</div>
                    <div class="value">${formatDuration(unknownTime)}</div>
                    <div class="label">Nezařazeno (mezery v datech)</div>
                </div>
                <div class="stat-card">
                    <div class="icon">⚙️</div>
                    <div class="value">${avgSpeedFullMpm.toFixed(1)} m/min</div>
                    <div class="label">Prům. rychlost (24h)</div>
                </div>
                <div class="stat-card">
                    <div class="icon">🏃</div>
                    <div class="value">${avgSpeedWalkingMpm.toFixed(1)} m/min</div>
                    <div class="label">Prům. rychlost (chůze)</div>
                </div>
                <div class="stat-card">
                    <div class="icon">⚡</div>
                    <div class="value">${rmsDyn.toFixed(3)} g</div>
                    <div class="label">RMS dynamická <span class="stat-chip ${rmsLevel.level}">${rmsLevel.label}</span></div>
                </div>
                <div class="stat-card">
                    <div class="icon">🎯</div>
                    <div class="value">${(consistencyScore * 100).toFixed(0)}%</div>
                    <div class="label">GPS↔ACC shoda</div>
                </div>
                <div class="stat-card">
                    <div class="icon">📊</div>
                    <div class="value">${recordCount}</div>
                    <div class="label">Orig. záznamů</div>
                </div>
                <div class="stat-card">
                    <div class="icon">👣</div>
                    <div class="value">${stepFrequencyHz.toFixed(2)} Hz</div>
                    <div class="label">Frekvence kroků <span class="stat-chip ${stepLevel.level}">${stepLevel.label}</span></div>
                </div>
            `;
        }

        // Render standing zones (>3 min) - same compact format as lying zones
        const standingZonesEl = document.getElementById('standingZones');
        if (standingZonesEl && standingClusters.length > 0) {
            const totalStandingDt = standingClusters.reduce((s, c) => s + c.totalDt, 0);
            standingZonesEl.innerHTML = standingClusters.slice(0, 6).map((c, i) => {
                const pct = totalStandingDt > 0 ? (c.totalDt / totalStandingDt) * 100 : 0;
                const colorScale = ['#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f'];
                const colorIdx = Math.min(5, Math.floor(pct / 20));
                const color = colorScale[colorIdx];
                return `
                    <div class="zone-card" style="border-left-color: ${color}">
                        <h4>Zóna ${i + 1}</h4>
                        <div>${formatDuration(c.totalDt)} (${pct.toFixed(1)}%)</div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${pct}%; background: ${color}"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Render isolation events
        const isolationEl = document.getElementById('isolationEvents');
        if (isolationEl && isolationEvents.length > 0) {
            isolationEl.innerHTML = `
                <h4>⚠️ Události izolace (pre-porodní indikátor)</h4>
                <div class="isolation-list">
                    ${isolationEvents.map((e, i) => `
                        <div class="isolation-event">
                            <div class="isolation-time">${formatHhMm(e.startSec)} - ${formatHhMm(e.endSec)}</div>
                            <div class="isolation-duration">${formatDuration(e.duration)}</div>
                            <div class="isolation-distance">Max vzdálenost: ${e.maxDistance.toFixed(0)} m</div>
                        </div>
                    `).join('')}
                </div>
            `;
        } else if (isolationEl) {
            isolationEl.innerHTML = '<p style="color:#aaa;">Žádné významné události izolace detekovány.</p>';
        }

        // Continue with remaining rendering (maps, charts, etc.)
        // This would include the rest of the renderAll function from the original...
        // For brevity, I'm including the essential structure
        
        // Render distance comparison
        const distanceComparison = document.getElementById('distanceComparison');
        if (distanceComparison) {
            distanceComparison.innerHTML = `
                <div class="distance-item day">
                    <div class="icon">☀️</div>
                    <div class="value">${dayDistance.toFixed(0)} m</div>
                    <div class="label">Den (06:00-18:00)</div>
                </div>
                <div class="distance-item night">
                    <div class="icon">🌙</div>
                    <div class="value">${nightDistance.toFixed(0)} m</div>
                    <div class="label">Noc (18:00-06:00)</div>
                </div>
            `;
        }

        // Render lying zones
        const lyingZonesEl = document.getElementById('lyingZones');
        if (lyingZonesEl && lyingClusters.length > 0) {
            const totalLyingDt = lyingClusters.reduce((s, c) => s + c.totalDt, 0);
            lyingZonesEl.innerHTML = lyingClusters.slice(0, 6).map((c, i) => {
                const pct = totalLyingDt > 0 ? (c.totalDt / totalLyingDt) * 100 : 0;
                const color = pickTealColor(pct * 3);
                return `
                    <div class="zone-card" style="border-left-color: ${color}">
                        <h4>Zóna ${i + 1}</h4>
                        <div>${formatDuration(c.totalDt)} (${pct.toFixed(1)}%)</div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${pct}%; background: ${color}"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Render vector analysis
        const vectorAnalysis = document.getElementById('vectorAnalysis');
        if (vectorAnalysis) {
            const dirIcon = (dir) => {
                const icons = { N: '↑', NE: '↗', E: '→', SE: '↘', S: '↓', SW: '↙', W: '←', NW: '↖' };
                return icons[dir] || '•';
            };
            vectorAnalysis.innerHTML = `
                <div class="vector-item">
                    <div class="direction">${dirIcon(vectorSummary.morning.dir)}</div>
                    <div class="label">Ráno (6-10h)</div>
                    <div class="value">${vectorSummary.morning.dir}</div>
                </div>
                <div class="vector-item">
                    <div class="direction">${dirIcon(vectorSummary.midday.dir)}</div>
                    <div class="label">Poledne (10-14h)</div>
                    <div class="value">${vectorSummary.midday.dir}</div>
                </div>
                <div class="vector-item">
                    <div class="direction">${dirIcon(vectorSummary.afternoon.dir)}</div>
                    <div class="label">Odpoledne (14-18h)</div>
                    <div class="value">${vectorSummary.afternoon.dir}</div>
                </div>
                <div class="vector-item">
                    <div class="direction">📏</div>
                    <div class="label">Max od středu</div>
                    <div class="value">${vectorSummary.maxDistFromCenter.toFixed(0)} m</div>
                </div>
                <div class="vector-item">
                    <div class="direction">🔄</div>
                    <div class="label">Cirkularita</div>
                    <div class="value">${vectorSummary.circularity.toFixed(1)}x</div>
                </div>
            `;
        }

        // Render timeline
        const timelineEl = document.getElementById('behaviorTimeline');
        if (timelineEl) {
            const paddedSegments = buildTimelineSegments(segments, { gapBehavior: 'lying', markGap: true });
            timelineEl.innerHTML = paddedSegments.map(seg => {
                const widthPct = ((seg.endSec - seg.startSec) / DAY_TOTAL_SEC) * 100;
                const label = widthPct > 4 ? buildBehaviorLabel(seg.behavior) : '';
                return `<div class="timeline-segment ${seg.behavior}" style="width: ${widthPct}%">${label}</div>`;
            }).join('');
        }

        // Render timeline axis with time labels
        const timelineAxisEl = document.getElementById('timelineAxis');
        if (timelineAxisEl) {
            let axisHtml = '';
            // Add ticks every 2 hours, with major ticks at 0, 6, 12, 18, 24
            for (let h = 0; h <= 24; h += 2) {
                const pct = (h / 24) * 100;
                const isMajor = h % 6 === 0;
                const label = `${String(h).padStart(2, '0')}:00`;
                axisHtml += `<div class="tick ${isMajor ? 'major' : ''}" style="left: ${pct}%">${label}</div>`;
            }
            timelineAxisEl.innerHTML = axisHtml;
        }

        // Initialize maps
        renderMaps(gpsPointsDay, gpsPointsNight, heatPointsDay, heatPointsNight, lyingClusters, standingClusters, fenceArrowsDay, fenceArrowsNight,
            lyingClustersDay, lyingClustersNight, standingClustersDay, standingClustersNight);

        // Render charts
        renderCharts(hourlyData, speedMpsBins, accYBins, dayDistance, nightDistance, hourlyActivityStats);

        if (exportPdfBtnEl) exportPdfBtnEl.disabled = false;
    }

    function renderMaps(
        gpsPointsDay,
        gpsPointsNight,
        heatPointsDay,
        heatPointsNight,
        lyingClusters,
        standingClusters,
        fenceArrowsDay,
        fenceArrowsNight,
        lyingClustersDay,
        lyingClustersNight,
        standingClustersDay,
        standingClustersNight
    ) {
        // Reset mapsReady flag
        mapsReady = false;

        // Build bounds with fallback to facility center
        const boundsDay = buildFacilityBounds(gpsPointsDay);
        const boundsNight = buildFacilityBounds(gpsPointsNight);

        // Default bounds if no GPS points
        const defaultBounds = buildFacilityBounds();

        // Check if map elements exist
        const mapDayEl = document.getElementById('mapDay');
        const mapNightEl = document.getElementById('mapNight');
        if (!mapDayEl || !mapNightEl) {
            console.error('Map elements not found');
            return;
        }

        // Create maps with Canvas renderer (more reliable than SVG for dynamic content)
        mapDayInstance = L.map('mapDay', {
            attributionControl: false,
            preferCanvas: true
        });

        mapNightInstance = L.map('mapNight', {
            attributionControl: false,
            preferCanvas: true
        });

        // Set initial view FIRST (required for renderer initialization)
        mapDayInstance.setView(FACILITY_CENTER, 17);
        mapNightInstance.setView(FACILITY_CENTER, 17);

        // Add base tiles immediately
        createEsriMaxarLayer().addTo(mapDayInstance);
        createEsriMaxarLayer().addTo(mapNightInstance);

        // Create layers (only if we have data)
        const heatDay = (heatPointsDay && heatPointsDay.length > 0)
            ? L.heatLayer(heatPointsDay, {
                radius: 25, blur: 15, maxZoom: 17,
                gradient: { 0.4: 'blue', 0.6: 'lime', 0.8: 'yellow', 1: '#e94560' }
            })
            : null;

        const heatNight = (heatPointsNight && heatPointsNight.length > 0)
            ? L.heatLayer(heatPointsNight, {
                radius: 25, blur: 15, maxZoom: 17,
                gradient: { 0.4: 'blue', 0.6: 'lime', 0.8: 'yellow', 1: '#4169E1' }
            })
            : null;

        const trajDay = (gpsPointsDay && gpsPointsDay.length >= 2)
            ? L.polyline(gpsPointsDay, { color: '#FFD700', weight: 3, opacity: 0.85 })
            : null;
        const trajNight = (gpsPointsNight && gpsPointsNight.length >= 2)
            ? L.polyline(gpsPointsNight, { color: '#4169E1', weight: 3, opacity: 0.85 })
            : null;

        mapDayLayers = { heat: heatDay, trajectory: trajDay };
        mapNightLayers = { heat: heatNight, trajectory: trajNight };

        const createFenceArrowLayer = (arrowData) => {
            const group = L.layerGroup();
            if (!Array.isArray(arrowData) || arrowData.length === 0) {
                return group;
            }
            arrowData.forEach((arrow) => {
                if (!arrow || !Number.isFinite(arrow.lat) || !Number.isFinite(arrow.lon)) return;
                const bearing = Number.isFinite(arrow.bearing) ? arrow.bearing : 0;
                const fenceClass = arrow.fence === 'III'
                    ? 'fence-III'
                    : arrow.fence === 'II'
                        ? 'fence-II'
                        : 'fence-I';
                const icon = L.divIcon({
                    className: 'fence-arrow-icon',
                    html: `<div class="fence-arrow ${fenceClass}" style="transform: rotate(${bearing}deg);"></div>`,
                    iconSize: [18, 18],
                    iconAnchor: [9, 12]
                });
                L.marker([arrow.lat, arrow.lon], { icon }).addTo(group);
            });
            return group;
        };

        // Function to add all overlays when maps are fully ready
        const addAllOverlays = () => {
            // Add facility overlays (RED FENCE, zones, etc.)
            addFacilityOverlays(mapDayInstance);
            addFacilityOverlays(mapNightInstance);
            addScaleAndDistanceRings(mapDayInstance);
            addScaleAndDistanceRings(mapNightInstance);

            const zoneMarkersDay = L.layerGroup();
            const zoneMarkersNight = L.layerGroup();

            // Fit bounds
            try {
                if (boundsDay && boundsDay.isValid()) {
                    mapDayInstance.fitBounds(boundsDay.pad(0.15));
                } else {
                    mapDayInstance.fitBounds(defaultBounds.pad(0.15));
                }
            } catch (e) {
                console.warn('Failed to fit day bounds:', e);
            }

            try {
                if (boundsNight && boundsNight.isValid()) {
                    mapNightInstance.fitBounds(boundsNight.pad(0.15));
                } else {
                    mapNightInstance.fitBounds(defaultBounds.pad(0.15));
                }
            } catch (e) {
                console.warn('Failed to fit night bounds:', e);
            }

            // Add lying zone markers
            if (lyingClusters && lyingClusters.length > 0) {
                lyingClusters.slice(0, 5).forEach((c, i) => {
                    if (!c || !c.lat || !c.lon) return;
                    const radius = computeZoneRadius((c.totalDt / 3600) * 20);
                    try {
                        L.circleMarker([c.lat, c.lon], {
                            radius,
                            color: '#4CAF50',
                            fillColor: '#4CAF50',
                            fillOpacity: 0.6
                        }).bindPopup(`<b>Ležení ${i + 1}</b><br>${formatDuration(c.totalDt)}`).addTo(zoneMarkersDay);

                        L.circleMarker([c.lat, c.lon], {
                            radius,
                            color: '#4CAF50',
                            fillColor: '#4CAF50',
                            fillOpacity: 0.6
                        }).bindPopup(`<b>Ležení ${i + 1}</b><br>${formatDuration(c.totalDt)}`).addTo(zoneMarkersNight);
                    } catch (e) {
                        console.warn('Failed to add lying marker:', e);
                    }
                });
            }

            // Add standing zone markers
            if (standingClusters && standingClusters.length > 0) {
                standingClusters.slice(0, 5).forEach((c, i) => {
                    if (!c || !c.lat || !c.lon) return;
                    const radius = computeZoneRadius((c.totalDt / 600) * 10);
                    try {
                        L.circleMarker([c.lat, c.lon], {
                            radius,
                            color: '#FF9800',
                            fillColor: '#FF9800',
                            fillOpacity: 0.6
                        }).bindPopup(`<b>Stání ${i + 1}</b><br>${formatDuration(c.totalDt)}`).addTo(zoneMarkersDay);

                        L.circleMarker([c.lat, c.lon], {
                            radius,
                            color: '#FF9800',
                            fillColor: '#FF9800',
                            fillOpacity: 0.6
                        }).bindPopup(`<b>Stání ${i + 1}</b><br>${formatDuration(c.totalDt)}`).addTo(zoneMarkersNight);
                    } catch (e) {
                        console.warn('Failed to add standing marker:', e);
                    }
                });
            }

            mapDayLayers.zones = zoneMarkersDay;
            mapNightLayers.zones = zoneMarkersNight;

            mapDayLayers.arrows = createFenceArrowLayer(fenceArrowsDay);
            mapNightLayers.arrows = createFenceArrowLayer(fenceArrowsNight);

            // Create points layer (Bodový graf) with Day/Night separated clusters
            // Standing = squares (Indigo), Lying = triangles (Orange)
            const createPointsLayer = (lyingCls, standingCls) => {
                const pointsGroup = L.layerGroup();

                // Standing clusters - squares in Indigo scale
                if (standingCls && standingCls.length > 0) {
                    standingCls.forEach((c) => {
                        if (!c || !c.lat || !c.lon) return;
                        const bucket = getDurationBucket(c.totalDt);
                        const size = MARKER_SIZES[bucket];
                        const color = INDIGO_SCALE[bucket];
                        const startTime = formatHhMm(c.startSec || 0);
                        const endTime = formatHhMm(c.endSec || c.startSec + c.totalDt);

                        const squareIcon = L.divIcon({
                            className: 'point-marker-square',
                            html: `<div style="width:${size}px;height:${size}px;background:${color};border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.4);"></div>`,
                            iconSize: [size, size],
                            iconAnchor: [size/2, size/2]
                        });

                        L.marker([c.lat, c.lon], { icon: squareIcon })
                            .bindPopup(`<b>Stání</b><br>${formatDuration(c.totalDt)}<br>${startTime} - ${endTime}`)
                            .addTo(pointsGroup);
                    });
                }

                // Lying clusters - triangles in Orange scale
                if (lyingCls && lyingCls.length > 0) {
                    lyingCls.forEach((c) => {
                        if (!c || !c.lat || !c.lon) return;
                        const bucket = getDurationBucket(c.totalDt);
                        const size = MARKER_SIZES[bucket];
                        const color = ORANGE_SCALE[bucket];
                        const startTime = formatHhMm(c.startSec || 0);
                        const endTime = formatHhMm(c.endSec || c.startSec + c.totalDt);

                        // CSS triangle using border trick
                        const triangleIcon = L.divIcon({
                            className: 'point-marker-triangle',
                            html: `<div style="width:0;height:0;border-left:${size/2}px solid transparent;border-right:${size/2}px solid transparent;border-bottom:${size}px solid ${color};filter:drop-shadow(0 2px 2px rgba(0,0,0,0.4));"></div>`,
                            iconSize: [size, size],
                            iconAnchor: [size/2, size]
                        });

                        L.marker([c.lat, c.lon], { icon: triangleIcon })
                            .bindPopup(`<b>Ležení</b><br>${formatDuration(c.totalDt)}<br>${startTime} - ${endTime}`)
                            .addTo(pointsGroup);
                    });
                }

                return pointsGroup;
            };

            // Create points layers for Day and Night maps
            const pointsDay = createPointsLayer(lyingClustersDay, standingClustersDay);
            const pointsNight = createPointsLayer(lyingClustersNight, standingClustersNight);

            // Add to layer objects for mode switching
            mapDayLayers.points = pointsDay;
            mapNightLayers.points = pointsNight;

            // Now that all overlays are added, set mapsReady and apply mode
            mapsReady = true;
            applySelectedMapMode();
        };

        // Wait for BOTH maps to be ready, then add overlays after a delay
        let dayReady = false;
        let nightReady = false;

        const checkBothReady = () => {
            if (dayReady && nightReady) {
                // Invalidate size to ensure proper dimensions
                mapDayInstance.invalidateSize();
                mapNightInstance.invalidateSize();
                // Wait for next frame + additional time for renderer initialization
                setTimeout(() => {
                    addAllOverlays();
                }, 250);
            }
        };

        mapDayInstance.whenReady(() => {
            dayReady = true;
            checkBothReady();
        });

        mapNightInstance.whenReady(() => {
            nightReady = true;
            checkBothReady();
        });
    }

    function renderCharts(hourlyData, speedMpsBins, accYBins, dayDistance, nightDistance, hourlyActivityStats) {
        const currentTheme = () => ({
            text: '#aaa',
            grid: 'rgba(255,255,255,0.1)'
        });

        const hourlyLabels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

        // Activity pie chart
        const activityPie = new Chart(document.getElementById('activityPie'), {
            type: 'doughnut',
            data: {
                labels: ['Ležení', 'Stání', 'Chůze'],
                datasets: [{
                    data: hourlyData.map(h => h.lying + h.standing + h.walking).reduce((acc, _, i) => {
                        if (i === 0) return [hourlyData.reduce((s, h) => s + h.lying, 0),
                                             hourlyData.reduce((s, h) => s + h.standing, 0),
                                             hourlyData.reduce((s, h) => s + h.walking, 0)];
                        return acc;
                    }, []),
                    backgroundColor: ['#4CAF50', '#FF9800', '#2196F3'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: currentTheme().text } }
                }
            }
        });
        chartInstances.push(activityPie);

        // Hourly activity chart
        const hourlyActivity = new Chart(document.getElementById('hourlyActivity'), {
            type: 'bar',
            data: {
                labels: hourlyLabels,
                datasets: [
                    { label: 'Ležení', data: hourlyData.map(h => h.lying), backgroundColor: '#4CAF50' },
                    { label: 'Stání', data: hourlyData.map(h => h.standing), backgroundColor: '#FF9800' },
                    { label: 'Chůze', data: hourlyData.map(h => h.walking), backgroundColor: '#2196F3' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: true, ticks: { color: currentTheme().text }, grid: { color: currentTheme().grid } },
                    y: { stacked: true, ticks: { color: currentTheme().text }, grid: { color: currentTheme().grid } }
                },
                plugins: { legend: { position: 'top', labels: { color: currentTheme().text } } }
            }
        });
        chartInstances.push(hourlyActivity);

        // RMS chart
        const rmsHourly = hourlyActivityStats.map((stat) => {
            if (!stat || stat.rmsWeight <= 0) return 0;
            return Math.sqrt(stat.rmsSum / stat.rmsWeight);
        });

        const rmsChart = new Chart(document.getElementById('rmsChart'), {
            type: 'line',
            data: {
                labels: hourlyLabels,
                datasets: [{
                    label: 'RMS (g)',
                    data: rmsHourly,
                    borderColor: '#f472b6',
                    backgroundColor: 'rgba(244,114,182,0.2)',
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: currentTheme().text } } },
                scales: {
                    x: { ticks: { color: currentTheme().text }, grid: { color: currentTheme().grid } },
                    y: { ticks: { color: currentTheme().text }, grid: { color: currentTheme().grid } }
                }
            }
        });
        chartInstances.push(rmsChart);

        // Energy chart
        const energyHourly = hourlyActivityStats.map((stat) => stat ? stat.energy : 0);
        const energyChart = new Chart(document.getElementById('energyChart'), {
            type: 'bar',
            data: {
                labels: hourlyLabels,
                datasets: [{
                    label: 'Energetická náročnost (g)',
                    data: energyHourly,
                    backgroundColor: '#f59e0b'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: currentTheme().text } } },
                scales: {
                    x: { ticks: { color: currentTheme().text }, grid: { color: currentTheme().grid } },
                    y: { ticks: { color: currentTheme().text }, grid: { color: currentTheme().grid } }
                }
            }
        });
        chartInstances.push(energyChart);

        // Distance chart
        const distanceChart = new Chart(document.getElementById('distanceChart'), {
            type: 'bar',
            data: {
                labels: ['Den (06:00-18:00)', 'Noc (18:00-06:00)'],
                datasets: [{
                    label: 'Vzdálenost (m)',
                    data: [dayDistance, nightDistance],
                    backgroundColor: ['#FFD700', '#4169E1'],
                    borderRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: currentTheme().text }, grid: { color: currentTheme().grid } },
                    y: { ticks: { color: currentTheme().text }, grid: { color: currentTheme().grid } }
                }
            }
        });
        chartInstances.push(distanceChart);

        // Speed chart
        const speedLabels = Array.from({ length: 12 }, (_, i) => `${String(i * 2).padStart(2, '0')}:00`);
        const speedValues = speedMpsBins.map(v => v * 60);
        const speedChart = new Chart(document.getElementById('speedChart'), {
            type: 'line',
            data: {
                labels: speedLabels,
                datasets: [{
                    label: 'Rychlost (m/min)',
                    data: speedValues,
                    borderColor: '#e94560',
                    backgroundColor: 'rgba(233, 69, 96, 0.2)',
                    fill: true,
                    tension: 0.35
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: currentTheme().text } } },
                scales: {
                    x: { ticks: { color: currentTheme().text }, grid: { color: currentTheme().grid } },
                    y: { ticks: { color: currentTheme().text }, grid: { color: currentTheme().grid } }
                }
            }
        });
        chartInstances.push(speedChart);

        // Accelerometer chart
        const accelerometerChart = new Chart(document.getElementById('accelerometerChart'), {
            type: 'line',
            data: {
                labels: speedLabels,
                datasets: [{
                    label: 'ACC_Y',
                    data: accYBins,
                    borderColor: '#9C27B0',
                    backgroundColor: 'rgba(156, 39, 176, 0.2)',
                    fill: true,
                    tension: 0.25
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: currentTheme().text } },
                    tooltip: { callbacks: { label: (ctx) => `ACC_Y: ${ctx.parsed.y.toFixed(0)}` } }
                },
                scales: {
                    x: { ticks: { color: currentTheme().text }, grid: { color: currentTheme().grid } },
                    y: { ticks: { color: currentTheme().text }, grid: { color: currentTheme().grid } }
                }
            }
        });
        chartInstances.push(accelerometerChart);
    }

    // ---- Load and render
    async function loadAndRender(datasetFile, calvingDate, bullEndDate) {
        try {
            setStatus('');
            const res = await analyzeDataset(datasetFile, calvingDate, bullEndDate);

            const parsed = parseDatasetFileName(datasetFile);
            if (parsed) {
                localStorage.setItem('oneDayAnalysis_lastDataset', parsed.file);
            }
            if (calvingDate) {
                localStorage.setItem('oneDayAnalysis_lastCalvingDate', calvingDate);
            }
            if (bullEndDate) {
                localStorage.setItem('oneDayAnalysis_lastBullDate', bullEndDate);
            }

            setStatus('');
            renderAll(res);
            closeOverlay();

            try {
                setTimeout(() => {
                    if (mapDayInstance) mapDayInstance.invalidateSize();
                    if (mapNightInstance) mapNightInstance.invalidateSize();
                }, 250);
            } catch { }
        } catch (err) {
            setStatus(err && err.message ? err.message : String(err));
            if (exportPdfBtnEl) exportPdfBtnEl.disabled = true;
        }
    }

    // ---- Initialization
    function init() {
        if (exportPdfBtnEl) exportPdfBtnEl.disabled = true;

        if (datasetLoadBtnEl) {
            datasetLoadBtnEl.addEventListener('click', () => {
                const calvingDate = calvingDateInputEl ? calvingDateInputEl.value : null;
                const bullEndDate = bullDateInputEl ? bullDateInputEl.value : null;
                loadAndRender(datasetInputEl.value, calvingDate, bullEndDate);
            });
        }
        
        if (datasetCancelBtnEl) datasetCancelBtnEl.addEventListener('click', () => closeOverlay());
        
        if (datasetInputEl) {
            datasetInputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const calvingDate = calvingDateInputEl ? calvingDateInputEl.value : null;
                    const bullEndDate = bullDateInputEl ? bullDateInputEl.value : null;
                    loadAndRender(datasetInputEl.value, calvingDate, bullEndDate);
                }
            });
        }

        if (changeDatasetBtnEl) changeDatasetBtnEl.addEventListener('click', () => openOverlay());
        if (exportPdfBtnEl) exportPdfBtnEl.addEventListener('click', () => window.print());

        const urlParams = new URLSearchParams(window.location.search);
        const ds = urlParams.get('dataset');
        const calving = urlParams.get('calving');
        if (ds) {
            loadAndRender(ds, calving);
        } else {
            openOverlay();
        }
    }

    init();
})();

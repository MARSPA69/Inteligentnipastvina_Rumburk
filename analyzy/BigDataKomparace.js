/**
 * BigDataKomparace.js
 * Komplexní dlouhodobá trendová analýza chování krávy
 *
 * Funkce:
 * - Automatické načtení všech datasetů pro vybranou krávu
 * - Info panely: Vzdálenosti, Aktivita, Trendy
 * - Statistické vyhodnocení série (den/noc, CV, outliers)
 * - Denní alerty s vizuální indikací
 * - Časové osy chování den po dni
 * - Porovnání jednotlivých dnů
 * - Srovnávací tabulka metrik
 * - Trendové grafy
 */

const BigDataKomparace = {
    // Konfigurace
    config: {
        cowId: null,
        lastCalvingDate: null,
        bullEndDate: null,
        expectedBirthDate: null,
        gestationDays: 283,
        postpartumDays: 45,

        // Prahy pro alerty
        alertThresholds: {
            distanceDropPercent: 30,      // Pokles vzdálenosti o 30%
            lyingIncreasePercent: 25,     // Nárůst ležení o 25%
            speedDropPercent: 25,         // Pokles rychlosti o 25%
            boutIncrease: 3,              // Nárůst lie-bouts o 3 oproti průměru
            rmsDropPercent: 20,           // Pokles RMS o 20%
            minRecordsPerDay: 100,        // Minimum záznamů pro validní den
            outlierSdMultiplier: 2.5      // Násobek SD pro detekci outlierů
        }
    },

    // Stav
    availableCows: {},
    selectedDatasets: [],
    dailyResults: [],
    globalStats: {},
    alerts: [],
    isProcessing: false,

    // UI Elements
    elements: {},

    // Charts
    charts: {},

    formatNumber(value) {
        const n = Number(value || 0);
        return Number.isFinite(n) ? n.toLocaleString('cs-CZ') : '0';
    },

    /**
     * Inicializace modulu
     */
    init() {
        this.cacheElements();
        this.bindEvents();
        this.scanAvailableDatasets();
        this.initGganimate();
    },

    /**
     * Cache DOM elementů
     */
    cacheElements() {
        this.elements = {
            // Overlay
            inputOverlay: document.getElementById('inputOverlay'),
            mainContent: document.getElementById('mainContent'),
            cowIdInput: document.getElementById('cowIdInput'),
            calvingDateInput: document.getElementById('calvingDateInput'),
            bullDateInput: document.getElementById('bullDateInput'),
            expectedBirthInput: document.getElementById('expectedBirthInput'),
            startAnalysisBtn: document.getElementById('startAnalysisBtn'),
            statusMessage: document.getElementById('statusMessage'),
            cowChips: document.getElementById('cowChips'),

            // Header
            headerCowId: document.getElementById('headerCowId'),
            headerDateRange: document.getElementById('headerDateRange'),
            headerRecordCount: document.getElementById('headerRecordCount'),
            headerCalvingDate: document.getElementById('headerCalvingDate'),
            headerCalvingRow: document.getElementById('headerCalvingRow'),
            changeSettingsBtn: document.getElementById('changeSettingsBtn'),

            // Progress
            progressSection: document.getElementById('progressSection'),
            progressBar: document.getElementById('progressBar'),
            progressStats: document.getElementById('progressStats'),

            // Info Panels
            avgDistanceDay: document.getElementById('avgDistanceDay'),
            distanceVariability: document.getElementById('distanceVariability'),
            minDistance: document.getElementById('minDistance'),
            maxDistance: document.getElementById('maxDistance'),
            avgLyingTime: document.getElementById('avgLyingTime'),
            avgWalkingSpeed: document.getElementById('avgWalkingSpeed'),
            avgRMS: document.getElementById('avgRMS'),
            totalRecords: document.getElementById('totalRecords'),
            trendDistance: document.getElementById('trendDistance'),
            trendDistanceItem: document.getElementById('trendDistanceItem'),
            trendSpeed: document.getElementById('trendSpeed'),
            trendSpeedItem: document.getElementById('trendSpeedItem'),
            trendLying: document.getElementById('trendLying'),
            trendLyingItem: document.getElementById('trendLyingItem'),
            alertCount: document.getElementById('alertCount'),

            // Sections
            statsSummary: document.getElementById('statsSummary'),
            alertsSection: document.getElementById('alertsSection'),
            alertsList: document.getElementById('alertsList'),
            alertsBadge: document.getElementById('alertsBadge'),
            timelineStack: document.getElementById('timelineStack'),
            daysGrid: document.getElementById('daysGrid'),
            comparisonTableBody: document.getElementById('comparisonTableBody'),
            cleaningSummaryList: document.getElementById('cleaningSummaryList'),

            // Charts
            distanceChart: document.getElementById('distanceChart'),
            lyingChart: document.getElementById('lyingChart'),
            speedChart: document.getElementById('speedChart'),
            boutsChart: document.getElementById('boutsChart'),
            rmsChart: document.getElementById('rmsChart'),
            dayNightChart: document.getElementById('dayNightChart')
        };
    },

    /**
     * Bindování eventů
     */
    bindEvents() {
        this.elements.cowIdInput.addEventListener('input', () => this.validateInputs());
        this.elements.calvingDateInput.addEventListener('change', () => this.validateInputs());
        this.elements.startAnalysisBtn.addEventListener('click', () => this.startAnalysis());
        this.elements.changeSettingsBtn.addEventListener('click', () => this.showInputOverlay());
    },

    /**
     * Skenování dostupných datasetů
     */
    async scanAvailableDatasets() {
        const knownDatasets = [
            'ID166691_141225.js', 'ID166691_151225.js', 'ID166691_161225.js',
            'ID166691_171225.js', 'ID166691_181225.js', 'ID166691_191225.js',
            'ID166691_201225.js', 'ID166691_251225.js', 'ID166691_261225.js',
            'ID175959_141225.js', 'ID175959_151225.js', 'ID175959_161225.js',
            'ID175959_171225.js', 'ID175959_181225.js', 'ID175959_191225.js',
            'ID175959_201225.js', 'ID175959_211225.js', 'ID175959_221225.js',
            'ID175959_231225.js', 'ID175959_241225.js', 'ID175959_251225.js',
            'ID175959_261225.js',
            'ID227831_141225.js', 'ID227831_151225.js', 'ID227831_161225.js',
            'ID227831_171225.js', 'ID227831_181225.js', 'ID227831_191225.js',
            'ID227831_201225.js', 'ID227831_211225.js', 'ID227831_221225.js',
            'ID227831_231225.js', 'ID227831_241225.js', 'ID227831_251225.js',
            'ID227831_261225.js', 'ID227831_271225.js', 'ID227831_281225.js',
            'ID227831_291225.js', 'ID227831_301225.js'
        ];

        this.availableCows = {};
        const pattern = /^ID(\d{6})_(\d{6})\.js$/;

        for (const filename of knownDatasets) {
            const match = filename.match(pattern);
            if (match) {
                const cowId = match[1];
                if (!this.availableCows[cowId]) {
                    this.availableCows[cowId] = [];
                }
                this.availableCows[cowId].push(filename);
            }
        }

        for (const cowId in this.availableCows) {
            this.availableCows[cowId].sort((a, b) => {
                const dateA = this.parseFilenameDate(a);
                const dateB = this.parseFilenameDate(b);
                return dateA - dateB;
            });
        }

        this.renderCowChips();
    },

    /**
     * Parse date z názvu souboru
     */
    parseFilenameDate(filename) {
        const match = filename.match(/ID\d{6}_(\d{2})(\d{2})(\d{2})\.js/);
        if (match) {
            const day = parseInt(match[1]);
            const month = parseInt(match[2]) - 1;
            const year = 2000 + parseInt(match[3]);
            return new Date(year, month, day);
        }
        return null;
    },

    /**
     * Render cow chips
     */
    renderCowChips() {
        const container = this.elements.cowChips;
        container.innerHTML = '';

        const cowIds = Object.keys(this.availableCows).sort();

        if (cowIds.length === 0) {
            container.innerHTML = '<span style="color: #888;">Žádné datasety nenalezeny</span>';
            return;
        }

        for (const cowId of cowIds) {
            const count = this.availableCows[cowId].length;
            const chip = document.createElement('span');
            chip.className = 'cow-chip';
            chip.innerHTML = `ID ${cowId}<span class="count">${count} dnů</span>`;
            chip.addEventListener('click', () => {
                this.elements.cowIdInput.value = cowId;
                this.validateInputs();
            });
            container.appendChild(chip);
        }
    },

    /**
     * Validace vstupů
     */
    validateInputs() {
        const cowId = this.elements.cowIdInput.value.trim();
        let valid = !!cowId && !!this.availableCows[cowId];

        if (cowId && !this.availableCows[cowId]) {
            this.showStatus(`Kráva ID ${cowId} nemá žádné dostupné datasety`, 'error');
        } else {
            this.hideStatus();
        }

        this.elements.startAnalysisBtn.disabled = !valid;
        return valid;
    },

    showStatus(message, type = 'info') {
        this.elements.statusMessage.textContent = message;
        this.elements.statusMessage.className = `status-message ${type}`;
        this.elements.statusMessage.classList.remove('hidden');
    },

    hideStatus() {
        this.elements.statusMessage.classList.add('hidden');
    },

    showInputOverlay() {
        this.elements.inputOverlay.classList.remove('hidden');
        this.elements.mainContent.classList.add('hidden');
    },

    /**
     * Spuštění analýzy
     */
    async startAnalysis() {
        if (this.isProcessing) return;

        this.config.cowId = this.elements.cowIdInput.value.trim();
        this.config.lastCalvingDate = this.elements.calvingDateInput.value;
        this.config.bullEndDate = this.elements.bullDateInput ? this.elements.bullDateInput.value : null;
        this.config.expectedBirthDate = this.elements.expectedBirthInput.value;

        this.selectedDatasets = this.availableCows[this.config.cowId] || [];

        if (this.selectedDatasets.length === 0) {
            this.showStatus('Žádné datasety pro tuto krávu', 'error');
            return;
        }

        this.elements.inputOverlay.classList.add('hidden');
        this.elements.mainContent.classList.remove('hidden');
        this.elements.headerCowId.textContent = this.config.cowId;

        this.dailyResults = [];
        this.alerts = [];

        await this.processAllDatasets();
    },

    /**
     * Zpracování všech datasetů
     */
    async processAllDatasets() {
        this.isProcessing = true;
        const total = this.selectedDatasets.length;
        let processed = 0;

        this.elements.progressSection.classList.remove('hidden');
        this.updateProgress(0, total);

        for (const filename of this.selectedDatasets) {
            try {
                const result = await this.processDataset(filename);
                if (result) {
                    this.dailyResults.push(result);
                }
            } catch (error) {
                console.error(`Chyba při zpracování ${filename}:`, error);
            }

            processed++;
            this.updateProgress(processed, total);
            await new Promise(resolve => setTimeout(resolve, 30));
        }

        this.dailyResults.sort((a, b) => a.date - b.date);

        // Výpočet globálních statistik
        this.calculateGlobalStats();

        // Detekce alertů
        this.detectAlerts();

        // Update header
        if (this.dailyResults.length > 0) {
            const firstDate = this.dailyResults[0].date;
            const lastDate = this.dailyResults[this.dailyResults.length - 1].date;
            const totalRecords = this.dailyResults.reduce((sum, d) => sum + d.recordCount, 0);
            this.elements.headerDateRange.textContent =
                `${this.formatDate(firstDate)} - ${this.formatDate(lastDate)} (${this.dailyResults.length} dnů)`;
            this.elements.headerRecordCount.textContent = totalRecords.toLocaleString('cs-CZ');
        }

        // Update calving date and pregnancy info in header
        if (this.config.lastCalvingDate) {
            const calvingDate = new Date(this.config.lastCalvingDate);
            let headerText = `Poslední porod: ${this.formatDate(calvingDate)}`;

            // Calculate pregnancy probability if bullEndDate is provided and PregnancyCalculator exists
            if (this.config.bullEndDate && typeof PregnancyCalculator !== 'undefined') {
                const lastDate = this.dailyResults.length > 0
                    ? this.dailyResults[this.dailyResults.length - 1].date
                    : new Date();
                const pregnancyStatus = PregnancyCalculator.calculate(
                    this.config.lastCalvingDate,
                    this.config.bullEndDate,
                    lastDate
                );
                if (pregnancyStatus && pregnancyStatus.probabilityPercent !== undefined) {
                    headerText += ` | Březost: <strong>${pregnancyStatus.probabilityPercent}%</strong>`;
                    if (pregnancyStatus.trimester) {
                        headerText += ` | ${pregnancyStatus.trimester}. trimestr, den ${pregnancyStatus.gestationDay}`;
                    }
                    if (pregnancyStatus.expectedDueDate) {
                        headerText += ` | Očekávaný porod: ${pregnancyStatus.expectedDueDate}`;
                    }
                    if (pregnancyStatus.preParturitionAlert) {
                        headerText += ` <span style="color: #f59e0b; font-weight: bold;">⚠️ POROD DO 14 DNÍ!</span>`;
                    }
                }
            }

            this.elements.headerCalvingRow.innerHTML = headerText;
            this.elements.headerCalvingRow.style.display = 'block';
        } else {
            this.elements.headerCalvingRow.style.display = 'none';
        }

        setTimeout(() => {
            this.elements.progressSection.classList.add('hidden');
        }, 800);

        // Render všech vizualizací
        this.renderInfoPanels();
        this.renderStatsSummary();
        this.renderAlerts();
        this.renderTimelines();
        this.renderDayPanels();
        this.renderComparisonTable();
        this.renderCharts();
        this.renderCleaningSummary();

        this.isProcessing = false;
    },

    /**
     * Zpracování jednoho datasetu
     */
    async processDataset(filename) {
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = `Datasets/${filename}`;

            script.onload = () => {
                const date = this.parseFilenameDate(filename);
                const dateMatch = filename.match(/ID(\d+)_(\d{6})\.js/);
                if (!dateMatch) {
                    resolve(null);
                    return;
                }

                const cowId = dateMatch[1];
                const dateCode = dateMatch[2];

                let rawData = null;
                const possibleNames = [
                    `COW_${cowId}_${dateCode}`,
                    `COW_${this.config.cowId}_${dateCode}`,
                    `DATASET_ID${cowId}_${dateCode}`,
                    `DATASET_${cowId}_${dateCode}`
                ];

                for (const name of possibleNames) {
                    try {
                        const data = window.eval(name);
                        if (data && Array.isArray(data) && data.length > 0) {
                            rawData = data;
                            break;
                        }
                    } catch (e) { }

                    if (window[name] && Array.isArray(window[name])) {
                        rawData = window[name];
                        break;
                    }
                }

                if (!rawData) {
                    for (const key in window) {
                        if (Array.isArray(window[key]) && window[key].length > 0 && window[key][0]) {
                            const firstItem = window[key][0];
                            if (typeof firstItem.gps_lat !== 'undefined' ||
                                typeof firstItem.Latitude !== 'undefined') {
                                rawData = window[key];
                                break;
                            }
                        }
                    }
                }

                if (!rawData || rawData.length === 0) {
                    console.warn(`Dataset ${filename} nenalezen nebo prázdný`);
                    resolve(null);
                    return;
                }

                try {
                    const processed = RumburkAnalysisCore.processRawData(rawData, {
                        calvingDate: this.config.lastCalvingDate,
                        dateStr: dateCode,
                        datasetName: filename
                    });

                    // Spočítej metriky ze segmentů
                    let lyingBouts = 0;
                    let standingBouts = 0;
                    let walkingBouts = 0;
                    const behaviorSegments = [];

                    if (processed.segments && Array.isArray(processed.segments)) {
                        for (const seg of processed.segments) {
                            behaviorSegments.push({
                                behavior: seg.behavior,
                                startSec: seg.startSec,
                                endSec: seg.endSec,
                                duration: seg.endSec - seg.startSec
                            });
                            if (seg.behavior === 'lying') lyingBouts++;
                            else if (seg.behavior === 'standing') standingBouts++;
                            else if (seg.behavior === 'walking') walkingBouts++;
                        }
                    }

                    // Rozděl data na den/noc (6:00-20:00 je den)
                    const dayData = rawData.filter(r => {
                        const hour = this.extractHour(r.timestamp);
                        return hour >= 6 && hour < 20;
                    });
                    const nightData = rawData.filter(r => {
                        const hour = this.extractHour(r.timestamp);
                        return hour < 6 || hour >= 20;
                    });

                    // =============================================================
                    // OPRAVA: Použijeme hourlyData z core místo segmentů
                    // hourlyData má pro každou hodinu: { lying, standing, walking } v sekundách
                    // DEN = 6:00-20:00 (hodiny 6-19), NOC = 20:00-6:00 (hodiny 0-5 a 20-23)
                    // =============================================================
                    const hourlyData = processed.hourlyData || [];
                    let dayLyingSec = 0, dayStandingSec = 0, dayWalkingSec = 0;
                    let nightLyingSec = 0, nightStandingSec = 0, nightWalkingSec = 0;

                    for (let h = 0; h < 24; h++) {
                        const hd = hourlyData[h] || { lying: 0, standing: 0, walking: 0 };
                        if (h >= 6 && h < 20) {
                            // DEN
                            dayLyingSec += hd.lying || 0;
                            dayStandingSec += hd.standing || 0;
                            dayWalkingSec += hd.walking || 0;
                        } else {
                            // NOC
                            nightLyingSec += hd.lying || 0;
                            nightStandingSec += hd.standing || 0;
                            nightWalkingSec += hd.walking || 0;
                        }
                    }

                    // Konverze na hodiny
                    const dayMetrics = {
                        lyingH: dayLyingSec / 3600,
                        standingH: dayStandingSec / 3600,
                        walkingH: dayWalkingSec / 3600
                    };
                    const nightMetrics = {
                        lyingH: nightLyingSec / 3600,
                        standingH: nightStandingSec / 3600,
                        walkingH: nightWalkingSec / 3600
                    };

                    // Sanity check - hodnoty musí být nezáporné a realistické
                    dayMetrics.lyingH = Math.max(0, Math.min(14, dayMetrics.lyingH));
                    dayMetrics.standingH = Math.max(0, Math.min(14, dayMetrics.standingH));
                    dayMetrics.walkingH = Math.max(0, Math.min(14, dayMetrics.walkingH));
                    nightMetrics.lyingH = Math.max(0, Math.min(10, nightMetrics.lyingH));
                    nightMetrics.standingH = Math.max(0, Math.min(10, nightMetrics.standingH));
                    nightMetrics.walkingH = Math.max(0, Math.min(10, nightMetrics.walkingH));

                    // Celková vzdálenost v metrech
                    const dayDistanceM = (processed.dayDistance || 0);
                    const nightDistanceM = (processed.nightDistance || 0);
                    const totalDistanceM = dayDistanceM + nightDistanceM;

                    // Doba chůze v sekundách
                    const walkingTimeSec = processed.walkingTime || 0;
                    // Rychlost v m/min
                    const walkingSpeed = walkingTimeSec > 0 ? (totalDistanceM / (walkingTimeSec / 60)) : 0;

                    // CROSS-CHECK: Validate that behavior times sum to ~24h
                    const lyingH = (processed.lyingTime || 0) / 3600;
                    const standingH = (processed.standingTime || 0) / 3600;
                    const walkingH = (processed.walkingTime || 0) / 3600;
                    const unknownH = (processed.unknownTime || 0) / 3600;
                    const totalBehaviorH = lyingH + standingH + walkingH + unknownH;

                    // Sanity check - if total > 24h, something is wrong
                    let validatedLyingH = lyingH;
                    let validatedStandingH = standingH;
                    let validatedWalkingH = walkingH;

                    if (totalBehaviorH > 25) {
                        console.warn(`[BigData] Cross-check FAILED for ${filename}: total=${totalBehaviorH.toFixed(1)}h (lying=${lyingH.toFixed(1)}, standing=${standingH.toFixed(1)}, walking=${walkingH.toFixed(1)}, unknown=${unknownH.toFixed(1)})`);
                        // Scale down proportionally
                        const scale = 24 / totalBehaviorH;
                        validatedLyingH = lyingH * scale;
                        validatedStandingH = standingH * scale;
                        validatedWalkingH = walkingH * scale;
                    }

                    // Additional sanity: lying should be 8-16h typically for cattle
                    if (validatedLyingH > 18) {
                        console.warn(`[BigData] Excessive lying time ${validatedLyingH.toFixed(1)}h for ${filename} - capping at 16h`);
                        validatedLyingH = Math.min(validatedLyingH, 16);
                    }

                    const dayResult = {
                        filename: filename,
                        date: date,
                        dateStr: this.formatDate(date),
                        recordCount: rawData.length,

                        // Časové metriky v hodinách (validated)
                        lyingTimeH: validatedLyingH,
                        standingTimeH: validatedStandingH,
                        walkingTimeH: validatedWalkingH,
                        unknownTimeH: unknownH,

                        // Raw values for debugging
                        rawLyingH: lyingH,
                        rawStandingH: standingH,
                        rawWalkingH: walkingH,

                        // Den/Noc breakdown
                        dayLyingH: dayMetrics.lyingH,
                        nightLyingH: nightMetrics.lyingH,
                        dayWalkingH: dayMetrics.walkingH,
                        nightWalkingH: nightMetrics.walkingH,
                        dayStandingH: dayMetrics.standingH || 0,
                        nightStandingH: nightMetrics.standingH || 0,

                        // Bouts
                        lyingBouts,
                        standingBouts,
                        walkingBouts,

                        // Vzdálenost v metrech
                        totalDistanceM,
                        dayDistanceM,
                        nightDistanceM,

                        // Vzdálenost v km
                        totalDistanceKm: totalDistanceM / 1000,
                        dayDistanceKm: dayDistanceM / 1000,
                        nightDistanceKm: nightDistanceM / 1000,

                        // Rychlost m/min a km/h
                        walkingSpeed,
                        walkingSpeedKmh: walkingSpeed * 0.06,

                        // Rychlost Den vs Noc
                        daySpeedMpm: dayMetrics.avgSpeedMpm || 0,
                        nightSpeedMpm: nightMetrics.avgSpeedMpm || 0,

                        // RMS
                        rms: processed.rmsDyn || 0,

                        // Lokality
                        lyingLocationsDay: processed.lyingClustersDay?.length || 0,
                        lyingLocationsNight: processed.lyingClustersNight?.length || 0,
                        standingLocationsDay: processed.standingClustersDay?.length || 0,
                        standingLocationsNight: processed.standingClustersNight?.length || 0,
                        maxDistanceFromCenter: processed.vectorSummary?.maxDistFromCenter || 0,

                        // Segmenty pro timeline
                        behaviorSegments,

                        // Cross-check info
                        crossCheck: {
                            totalH: totalBehaviorH,
                            valid: totalBehaviorH <= 25,
                            scaleFactor: totalBehaviorH > 25 ? (24 / totalBehaviorH) : 1
                        },

                        // Raw reference
                        rawStats: processed
                    };

                    resolve(dayResult);
                } catch (error) {
                    console.error(`Chyba při zpracování dat ${filename}:`, error);
                    resolve(null);
                }
            };

            script.onerror = () => {
                console.error(`Nelze načíst dataset ${filename}`);
                resolve(null);
            };

            document.head.appendChild(script);
        });
    },

    /**
     * Extrahuj hodinu z timestamp stringu
     */
    extractHour(timestamp) {
        if (!timestamp) return 12;
        const match = timestamp.match(/(\d{1,2}):/);
        return match ? parseInt(match[1]) : 12;
    },

    /**
     * Vypočti metriky pro časové období (Den 6:00-20:00 nebo Noc 20:00-6:00)
     */
    calculatePeriodMetrics(_data, segments = [], startHour, endHour) {
        let lyingH = 0;
        let walkingH = 0;
        let standingH = 0;
        let totalDistanceM = 0;
        let walkingTimeSec = 0;

        const periodHours = startHour < endHour ? (endHour - startHour) : (24 - startHour + endHour);
        const periodStart = startHour;
        const periodEnd = (startHour + periodHours) % 24;

        const isInPeriod = (hour) => {
            if (periodStart < periodEnd) {
                return hour >= periodStart && hour < periodEnd;
            }
            return hour >= periodStart || hour < periodEnd;
        };

        if (segments && segments.length > 0) {
            for (const seg of segments) {
                const durationSec = seg.duration || Math.max(0, (seg.endSec || 0) - (seg.startSec || 0));
                const midpointSec = (seg.startSec || 0) + durationSec / 2;
                const midpointHour = ((midpointSec / 3600) % 24 + 24) % 24;
                if (!isInPeriod(midpointHour)) continue;

                const durationH = durationSec / 3600;
                if (seg.behavior === 'lying') lyingH += durationH;
                else if (seg.behavior === 'walking') {
                    walkingH += durationH;
                    walkingTimeSec += durationSec;
                }
                else if (seg.behavior === 'standing') standingH += durationH;
            }
        }

        // Calculate average speed for period
        const avgSpeedMpm = walkingTimeSec > 0 ? (totalDistanceM / (walkingTimeSec / 60)) : 0;

        return { lyingH, walkingH, standingH, avgSpeedMpm };
    },

    /**
     * Výpočet globálních statistik - kompletní Den/Noc breakdown
     */
    calculateGlobalStats() {
        const n = this.dailyResults.length;
        if (n === 0) {
            this.globalStats = {};
            return;
        }

        // =========================
        // VZDÁLENOSTI
        // =========================
        const distances = this.dailyResults.map(d => d.totalDistanceM);
        const dayDistances = this.dailyResults.map(d => d.dayDistanceM);
        const nightDistances = this.dailyResults.map(d => d.nightDistanceM);
        const distancesKm = this.dailyResults.map(d => d.totalDistanceKm);

        const avgDistance = this.mean(distances);
        const stdDistance = this.std(distances);
        const cvDistance = avgDistance > 0 ? (stdDistance / avgDistance) * 100 : 0;

        // =========================
        // LEŽENÍ - Den vs Noc
        // =========================
        const lyingTimes = this.dailyResults.map(d => d.lyingTimeH);
        const dayLyingTimes = this.dailyResults.map(d => d.dayLyingH);
        const nightLyingTimes = this.dailyResults.map(d => d.nightLyingH);

        const avgLying = this.mean(lyingTimes);
        const avgDayLying = this.mean(dayLyingTimes);
        const avgNightLying = this.mean(nightLyingTimes);
        const stdDayLying = this.std(dayLyingTimes);
        const stdNightLying = this.std(nightLyingTimes);

        // =========================
        // STÁNÍ - Den vs Noc
        // =========================
        const standingTimes = this.dailyResults.map(d => d.standingTimeH);
        const dayStandingTimes = this.dailyResults.map(d => d.dayStandingH || 0);
        const nightStandingTimes = this.dailyResults.map(d => d.nightStandingH || 0);

        const avgStanding = this.mean(standingTimes);
        const avgDayStanding = this.mean(dayStandingTimes);
        const avgNightStanding = this.mean(nightStandingTimes);

        // =========================
        // CHŮZE - Den vs Noc
        // =========================
        const walkingTimes = this.dailyResults.map(d => d.walkingTimeH);
        const dayWalkingTimes = this.dailyResults.map(d => d.dayWalkingH);
        const nightWalkingTimes = this.dailyResults.map(d => d.nightWalkingH || 0);

        const avgWalking = this.mean(walkingTimes);
        const avgDayWalking = this.mean(dayWalkingTimes);
        const avgNightWalking = this.mean(nightWalkingTimes);

        // =========================
        // RYCHLOST - Den vs Noc
        // =========================
        const speeds = this.dailyResults.map(d => d.walkingSpeed);
        const daySpeeds = this.dailyResults.map(d => d.daySpeedMpm || 0);
        const nightSpeeds = this.dailyResults.map(d => d.nightSpeedMpm || 0);

        const avgSpeed = this.mean(speeds);
        const avgDaySpeed = this.mean(daySpeeds);
        const avgNightSpeed = this.mean(nightSpeeds);
        const stdSpeed = this.std(speeds);

        // =========================
        // LOKALITY
        // =========================
        const lyingLocationsDay = this.dailyResults.map(d => d.lyingLocationsDay || 0);
        const lyingLocationsNight = this.dailyResults.map(d => d.lyingLocationsNight || 0);
        const standingLocationsDay = this.dailyResults.map(d => d.standingLocationsDay || 0);
        const maxDistFromCenter = this.dailyResults.map(d => d.maxDistanceFromCenter || 0);

        // =========================
        // RMS
        // =========================
        const rmsValues = this.dailyResults.map(d => d.rms);
        const avgRMS = this.mean(rmsValues);
        const stdRMS = this.std(rmsValues);

        // =========================
        // BOUTS
        // =========================
        const bouts = this.dailyResults.map(d => d.lyingBouts);
        const avgBouts = this.mean(bouts);

        // =========================
        // TRENDY (první vs poslední třetina)
        // =========================
        const firstThird = Math.max(1, Math.floor(n / 3));
        const trendDistance = this.calculateTrend(distances, firstThird);
        const trendSpeed = this.calculateTrend(speeds, firstThird);
        const trendLying = this.calculateTrend(lyingTimes, firstThird);
        const trendDayLying = this.calculateTrend(dayLyingTimes, firstThird);
        const trendNightLying = this.calculateTrend(nightLyingTimes, firstThird);
        const trendWalking = this.calculateTrend(walkingTimes, firstThird);

        // =========================
        // OUTLIERS
        // =========================
        const lyingOutliers = this.countOutliers(lyingTimes);
        const standingOutliers = this.countOutliers(standingTimes);
        const distanceOutliers = this.countOutliers(distances);

        // =========================
        // TOTALS & AVERAGES
        // =========================
        const totalRecords = this.dailyResults.reduce((sum, d) => sum + d.recordCount, 0);
        // OPRAVA: Používáme PRŮMĚRY místo součtů pro vzdálenosti
        const avgDayDistanceKm = this.mean(this.dailyResults.map(d => d.dayDistanceKm || 0));
        const avgNightDistanceKm = this.mean(this.dailyResults.map(d => d.nightDistanceKm || 0));
        // Součty pro informaci (kolik celkem nachodila za sledované období)
        const totalDistanceKm = this.dailyResults.reduce((sum, d) => sum + (d.totalDistanceKm || 0), 0);
        const totalDayDistanceKm = this.dailyResults.reduce((sum, d) => sum + (d.dayDistanceKm || 0), 0);
        const totalNightDistanceKm = this.dailyResults.reduce((sum, d) => sum + (d.nightDistanceKm || 0), 0);

        // Cross-check: count invalid days
        const invalidDays = this.dailyResults.filter(d => d.crossCheck && !d.crossCheck.valid).length;

        this.globalStats = {
            // Vzdálenosti - souhrn
            avgDistance,
            stdDistance,
            cvDistance,
            minDistance: Math.min(...distances),
            maxDistance: Math.max(...distances),
            avgDayDistance: this.mean(dayDistances),
            avgNightDistance: this.mean(nightDistances),
            // OPRAVA: Průměrné vzdálenosti v km (pro zobrazení)
            avgDayDistanceKm,
            avgNightDistanceKm,
            // Součty (pro informaci o celkovém období)
            totalDistanceKm,
            totalDayDistanceKm,
            totalNightDistanceKm,

            // Ležení - kompletní Den/Noc
            avgLying,
            avgDayLying,
            avgNightLying,
            minDayLying: Math.min(...dayLyingTimes),
            maxDayLying: Math.max(...dayLyingTimes),
            minNightLying: Math.min(...nightLyingTimes),
            maxNightLying: Math.max(...nightLyingTimes),
            stdDayLying,
            stdNightLying,
            trendDayLying,
            trendNightLying,

            // Stání - Den/Noc
            avgStanding,
            avgDayStanding,
            avgNightStanding,

            // Chůze - kompletní Den/Noc
            avgWalking,
            avgDayWalking,
            avgNightWalking,
            trendWalking,

            // Rychlost - Den/Noc
            avgSpeed,
            avgDaySpeed,
            avgNightSpeed,
            minSpeed: Math.min(...speeds),
            maxSpeed: Math.max(...speeds),
            stdSpeed,

            // Lokality - OPRAVA: zaokrouhlení na celá čísla (místo nelze mít na desetiny)
            avgLyingLocationsDay: Math.round(this.mean(lyingLocationsDay)),
            avgLyingLocationsNight: Math.round(this.mean(lyingLocationsNight)),
            avgStandingLocationsDay: Math.round(this.mean(standingLocationsDay)),
            maxDistFromCenter: Math.max(...maxDistFromCenter),
            avgMaxDistFromCenter: this.mean(maxDistFromCenter),

            // RMS
            avgRMS,
            stdRMS,

            // Bouts
            avgBouts,

            // Trendy
            trendDistance,
            trendSpeed,
            trendLying,

            // Outliers
            lyingOutliers,
            standingOutliers,
            distanceOutliers,

            // Totals
            totalRecords,
            totalDays: n,
            invalidDays
        };
    },

    /**
     * Pomocné statistické funkce
     */
    mean(arr) {
        if (arr.length === 0) return 0;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    },

    std(arr) {
        if (arr.length < 2) return 0;
        const m = this.mean(arr);
        const variance = arr.reduce((sum, x) => sum + Math.pow(x - m, 2), 0) / arr.length;
        return Math.sqrt(variance);
    },

    calculateTrend(arr, window) {
        if (arr.length < window * 2) return 0;
        const firstPart = arr.slice(0, window);
        const lastPart = arr.slice(-window);
        const firstAvg = this.mean(firstPart);
        const lastAvg = this.mean(lastPart);
        if (firstAvg === 0) return 0;
        return ((lastAvg - firstAvg) / firstAvg) * 100;
    },

    countOutliers(arr) {
        if (arr.length < 3) return 0;
        const m = this.mean(arr);
        const s = this.std(arr);
        const threshold = this.config.alertThresholds.outlierSdMultiplier;
        return arr.filter(x => Math.abs(x - m) > threshold * s).length;
    },

    /**
     * Detekce alertů
     */
    detectAlerts() {
        this.alerts = [];
        const stats = this.globalStats;
        const thresholds = this.config.alertThresholds;

        for (let i = 0; i < this.dailyResults.length; i++) {
            const day = this.dailyResults[i];
            const dayAlerts = [];

            // 1. Nízký počet záznamů
            if (day.recordCount < thresholds.minRecordsPerDay) {
                dayAlerts.push({
                    type: 'warning',
                    icon: '📉',
                    text: `Nízký počet záznamů (${day.recordCount})`
                });
            }

            // 2. Výrazný pokles vzdálenosti
            if (stats.avgDistance > 0) {
                const distanceDrop = ((stats.avgDistance - day.totalDistanceM) / stats.avgDistance) * 100;
                if (distanceDrop > thresholds.distanceDropPercent) {
                    dayAlerts.push({
                        type: 'danger',
                        icon: '📏',
                        text: `Pokles vzdálenosti o ${distanceDrop.toFixed(0)}%`
                    });
                }
            }

            // 3. Výrazný nárůst ležení
            if (stats.avgLying > 0) {
                const lyingIncrease = ((day.lyingTimeH - stats.avgLying) / stats.avgLying) * 100;
                if (lyingIncrease > thresholds.lyingIncreasePercent) {
                    dayAlerts.push({
                        type: 'warning',
                        icon: '🛏️',
                        text: `Nárůst ležení o ${lyingIncrease.toFixed(0)}%`
                    });
                }
            }

            // 4. Pokles rychlosti
            if (stats.avgSpeed > 0) {
                const speedDrop = ((stats.avgSpeed - day.walkingSpeed) / stats.avgSpeed) * 100;
                if (speedDrop > thresholds.speedDropPercent) {
                    dayAlerts.push({
                        type: 'warning',
                        icon: '🚶',
                        text: `Pokles rychlosti o ${speedDrop.toFixed(0)}%`
                    });
                }
            }

            // 5. Vysoký počet lie-bouts (neklid)
            if (day.lyingBouts > stats.avgBouts + thresholds.boutIncrease) {
                dayAlerts.push({
                    type: 'warning',
                    icon: '🔄',
                    text: `Vysoký neklid (${day.lyingBouts} lie-bouts)`
                });
            }

            // 6. Pokles RMS (apatie)
            if (stats.avgRMS > 0) {
                const rmsDrop = ((stats.avgRMS - day.rms) / stats.avgRMS) * 100;
                if (rmsDrop > thresholds.rmsDropPercent) {
                    dayAlerts.push({
                        type: 'warning',
                        icon: '⚡',
                        text: `Pokles aktivity (RMS -${rmsDrop.toFixed(0)}%)`
                    });
                }
            }

            // 7. Extrémní hodnota ležení (outlier)
            const lyingZ = stats.stdDistance > 0 ?
                Math.abs(day.lyingTimeH - stats.avgLying) / this.std(this.dailyResults.map(d => d.lyingTimeH)) : 0;
            if (lyingZ > thresholds.outlierSdMultiplier) {
                dayAlerts.push({
                    type: 'danger',
                    icon: '⚠️',
                    text: `Extrémní odchylka ležení`
                });
            }

            // Přidej alerty k danému dni
            day.alerts = dayAlerts;

            // Přidej do globálního seznamu
            if (dayAlerts.length > 0) {
                this.alerts.push({
                    date: day.date,
                    dateStr: day.dateStr,
                    alerts: dayAlerts
                });
            }
        }
    },

    /**
     * Render info panelů - s cross-check validací
     */
    renderInfoPanels() {
        const stats = this.globalStats;

        // Vzdálenosti
        this.elements.avgDistanceDay.textContent = `${Math.round(stats.avgDistance || 0)} m`;
        this.elements.distanceVariability.textContent = `${(stats.cvDistance || 0).toFixed(1)}%`;
        this.elements.minDistance.textContent = `${Math.round(stats.minDistance || 0)} m`;
        this.elements.maxDistance.textContent = `${Math.round(stats.maxDistance || 0)} m`;

        // Aktivita - use validated lying time (Den + Noc)
        // Cross-check: avgLying should equal avgDayLying + avgNightLying approximately
        const crossCheckedLying = (stats.avgDayLying || 0) + (stats.avgNightLying || 0);
        const displayLying = crossCheckedLying > 0 ? crossCheckedLying : (stats.avgLying || 0);

        // Show both day and night in format "X.Xh (D:Y.Y/N:Z.Z)"
        const lyingDisplay = `${displayLying.toFixed(1)}h`;
        this.elements.avgLyingTime.textContent = lyingDisplay;
        this.elements.avgLyingTime.title = `Den: ${(stats.avgDayLying || 0).toFixed(1)}h, Noc: ${(stats.avgNightLying || 0).toFixed(1)}h`;

        this.elements.avgWalkingSpeed.textContent = `${(stats.avgSpeed || 0).toFixed(1)}`;
        this.elements.avgRMS.textContent = (stats.avgRMS || 0).toFixed(3);
        this.elements.totalRecords.textContent = (stats.totalRecords || 0).toLocaleString('cs-CZ');

        // Trendy
        this.renderTrendItem(this.elements.trendDistance, this.elements.trendDistanceItem, stats.trendDistance || 0);
        this.renderTrendItem(this.elements.trendSpeed, this.elements.trendSpeedItem, stats.trendSpeed || 0);
        this.renderTrendItem(this.elements.trendLying, this.elements.trendLyingItem, stats.trendLying || 0);

        // Alert count
        const totalAlerts = this.alerts.reduce((sum, a) => sum + a.alerts.length, 0);
        this.elements.alertCount.textContent = totalAlerts;

        // Add cross-check warning if needed
        if (stats.invalidDays > 0) {
            console.warn(`[BigData] ${stats.invalidDays} days have cross-check issues (behavior sum > 24h)`);
        }
    },

    renderTrendItem(valueEl, containerEl, trend) {
        const arrow = trend > 5 ? '↑' : trend < -5 ? '↓' : '→';
        const sign = trend > 0 ? '+' : '';
        valueEl.textContent = `${sign}${trend.toFixed(1)}%${arrow}`;

        containerEl.classList.remove('trend-up', 'trend-down', 'trend-neutral');
        if (trend > 5) containerEl.classList.add('trend-up');
        else if (trend < -5) containerEl.classList.add('trend-down');
        else containerEl.classList.add('trend-neutral');
    },

    /**
     * Render statistického souhrnu - kompletní Den/Noc breakdown s cross-check
     */
    renderStatsSummary() {
        const stats = this.globalStats;
        const container = this.elements.statsSummary;
        container.innerHTML = '';

        // Cross-check header if there are invalid days
        if (stats.invalidDays > 0) {
            const warning = document.createElement('div');
            warning.className = 'stat-box alert';
            warning.style.gridColumn = 'span 2';
            warning.innerHTML = `
                <div class="icon">⚠️</div>
                <div class="value">${stats.invalidDays} dnů</div>
                <div class="label">Cross-check warning (suma > 24h)</div>
            `;
            container.appendChild(warning);
        }

        const summaryItems = [
            // LEŽENÍ - Den vs Noc
            { icon: '🌙', value: `${(stats.avgNightLying || 0).toFixed(1)}h`, label: 'Ø Ležení NOC', class: 'lying',
              tooltip: `Min: ${(stats.minNightLying || 0).toFixed(1)}h, Max: ${(stats.maxNightLying || 0).toFixed(1)}h, σ: ${(stats.stdNightLying || 0).toFixed(2)}` },
            { icon: '☀️', value: `${(stats.avgDayLying || 0).toFixed(1)}h`, label: 'Ø Ležení DEN', class: 'lying',
              tooltip: `Min: ${(stats.minDayLying || 0).toFixed(1)}h, Max: ${(stats.maxDayLying || 0).toFixed(1)}h, σ: ${(stats.stdDayLying || 0).toFixed(2)}` },
            { icon: '📈', value: `${(stats.trendNightLying || 0) > 0 ? '+' : ''}${(stats.trendNightLying || 0).toFixed(0)}%`, label: 'Trend ležení NOC', class: Math.abs(stats.trendNightLying || 0) > 15 ? 'alert' : '' },
            { icon: '📈', value: `${(stats.trendDayLying || 0) > 0 ? '+' : ''}${(stats.trendDayLying || 0).toFixed(0)}%`, label: 'Trend ležení DEN', class: Math.abs(stats.trendDayLying || 0) > 15 ? 'alert' : '' },

            // CHŮZE - Den vs Noc
            { icon: '🚶', value: `${(stats.avgDayWalking || 0).toFixed(1)}h`, label: 'Ø Chůze DEN', class: 'walking' },
            { icon: '🌃', value: `${(stats.avgNightWalking || 0).toFixed(1)}h`, label: 'Ø Chůze NOC', class: 'walking' },

            // VZDÁLENOST - km (OPRAVA: průměr za den, ne součet)
            { icon: '📍', value: `${(stats.avgDayDistanceKm || 0).toFixed(2)} km`, label: 'Ø Vzdálenost DEN', class: '',
              tooltip: `Celkem za období: ${(stats.totalDayDistanceKm || 0).toFixed(1)} km` },
            { icon: '🌙', value: `${(stats.avgNightDistanceKm || 0).toFixed(2)} km`, label: 'Ø Vzdálenost NOC', class: '',
              tooltip: `Celkem za období: ${(stats.totalNightDistanceKm || 0).toFixed(1)} km` },

            // RYCHLOST
            { icon: '🏃', value: `${(stats.avgSpeed || 0).toFixed(1)}`, label: 'Ø Rychlost m/min', class: '' },
            { icon: '📊', value: `${(stats.stdSpeed || 0).toFixed(1)}`, label: 'σ rychlost', class: '' },
            { icon: '📈', value: `${(stats.trendSpeed || 0) > 0 ? '+' : ''}${(stats.trendSpeed || 0).toFixed(0)}%`, label: 'Trend rychlost', class: Math.abs(stats.trendSpeed || 0) > 20 ? 'alert' : '' },

            // STÁNÍ
            { icon: '🧍', value: `${(stats.avgDayStanding || 0).toFixed(1)}h`, label: 'Ø Stání DEN', class: 'standing' },
            { icon: '🌙', value: `${(stats.avgNightStanding || 0).toFixed(1)}h`, label: 'Ø Stání NOC', class: 'standing' },

            // LOKALITY (OPRAVA: celá čísla - místo nelze mít na desetiny)
            { icon: '📍', value: `${stats.avgLyingLocationsDay || 0}`, label: 'Ø Míst ležení DEN', class: '' },
            { icon: '🌙', value: `${stats.avgLyingLocationsNight || 0}`, label: 'Ø Míst ležení NOC', class: '' },
            { icon: '🏔️', value: `${Math.round(stats.maxDistFromCenter || 0)} m`, label: 'Max vzdál. od středu', class: '' },

            // VARIABILITA & OUTLIERS
            { icon: '📊', value: `${(stats.cvDistance || 0).toFixed(1)}%`, label: 'Variabilita vzdál. (CV)', class: stats.cvDistance > 40 ? 'alert' : '' },
            { icon: '⚠️', value: `${stats.lyingOutliers || 0}`, label: 'Outliers ležení', class: (stats.lyingOutliers || 0) > 2 ? 'alert' : '' },
            { icon: '⚠️', value: `${stats.distanceOutliers || 0}`, label: 'Outliers vzdálenost', class: (stats.distanceOutliers || 0) > 2 ? 'alert' : '' },

            // RMS
            { icon: '⚡', value: `${(stats.avgRMS || 0).toFixed(3)}`, label: 'Ø RMS', class: '' },
            { icon: '📊', value: `${(stats.stdRMS || 0).toFixed(3)}`, label: 'σ RMS', class: '' }
        ];

        for (const item of summaryItems) {
            const box = document.createElement('div');
            box.className = `stat-box ${item.class}`;
            if (item.tooltip) box.title = item.tooltip;
            box.innerHTML = `
                <div class="icon">${item.icon}</div>
                <div class="value">${item.value}</div>
                <div class="label">${item.label}</div>
            `;
            container.appendChild(box);
        }
    },

    /**
     * Render alertů
     */
    renderAlerts() {
        const container = this.elements.alertsList;
        container.innerHTML = '';

        // Update alerts badge
        const totalAlerts = this.alerts.reduce((sum, a) => sum + a.alerts.length, 0);
        if (this.elements.alertsBadge) {
            if (totalAlerts > 0) {
                this.elements.alertsBadge.textContent = totalAlerts;
                this.elements.alertsBadge.style.display = 'inline-block';
            } else {
                this.elements.alertsBadge.style.display = 'none';
            }
        }

        if (this.alerts.length === 0) {
            container.innerHTML = '<p class="no-alerts-msg">Žádné alerty detekovány - chování v normě</p>';
            return;
        }

        // Seřaď alerty od nejnovějších
        const sortedAlerts = [...this.alerts].sort((a, b) => b.date - a.date);

        for (const dayAlert of sortedAlerts) {
            for (const alert of dayAlert.alerts) {
                const item = document.createElement('div');
                item.className = `alert-item ${alert.type}`;
                item.innerHTML = `
                    <span class="alert-icon">${alert.icon}</span>
                    <div class="alert-content">
                        <div class="alert-date">${dayAlert.dateStr}</div>
                        <div class="alert-text">${alert.text}</div>
                    </div>
                    <span class="alert-badge ${alert.type}">${alert.type === 'danger' ? 'Alert' : 'Varování'}</span>
                `;
                container.appendChild(item);
            }
        }
    },

    /**
     * Render časových os
     */
    renderTimelines() {
        const container = this.elements.timelineStack;
        container.innerHTML = '';

        // Zobraz posledních 14 dnů nebo všechny pokud jich je méně
        const daysToShow = this.dailyResults.slice(-14);

        for (const day of daysToShow) {
            const row = document.createElement('div');
            row.className = 'timeline-row';

            // Label
            const label = document.createElement('div');
            label.className = 'timeline-label';
            label.textContent = this.formatDateShort(day.date);
            row.appendChild(label);

            // Bar container
            const barContainer = document.createElement('div');
            barContainer.className = 'timeline-bar-container';

            // Generuj segmenty
            if (day.behaviorSegments && day.behaviorSegments.length > 0) {
                const totalSec = 24 * 3600;
                for (const seg of day.behaviorSegments) {
                    const width = ((seg.endSec - seg.startSec) / totalSec) * 100;
                    if (width > 0.5) {
                        const segment = document.createElement('div');
                        segment.className = `timeline-segment ${seg.behavior}`;
                        segment.style.width = `${width}%`;
                        barContainer.appendChild(segment);
                    }
                }
            } else {
                // Fallback - jednoduchý poměr
                const total = day.lyingTimeH + day.standingTimeH + day.walkingTimeH;
                if (total > 0) {
                    const lyingPct = (day.lyingTimeH / total) * 100;
                    const standingPct = (day.standingTimeH / total) * 100;
                    const walkingPct = (day.walkingTimeH / total) * 100;

                    if (lyingPct > 1) {
                        const seg = document.createElement('div');
                        seg.className = 'timeline-segment lying';
                        seg.style.width = `${lyingPct}%`;
                        barContainer.appendChild(seg);
                    }
                    if (standingPct > 1) {
                        const seg = document.createElement('div');
                        seg.className = 'timeline-segment standing';
                        seg.style.width = `${standingPct}%`;
                        barContainer.appendChild(seg);
                    }
                    if (walkingPct > 1) {
                        const seg = document.createElement('div');
                        seg.className = 'timeline-segment walking';
                        seg.style.width = `${walkingPct}%`;
                        barContainer.appendChild(seg);
                    }
                }
            }

            row.appendChild(barContainer);

            // Alert indicators
            const alertsContainer = document.createElement('div');
            alertsContainer.className = 'timeline-alerts';
            if (day.alerts && day.alerts.length > 0) {
                for (const alert of day.alerts.slice(0, 3)) {
                    const dot = document.createElement('div');
                    dot.className = `alert-dot ${alert.type}`;
                    dot.title = alert.text;
                    alertsContainer.appendChild(dot);
                }
            }
            row.appendChild(alertsContainer);

            container.appendChild(row);
        }
    },

    /**
     * Render day panelů
     */
    renderDayPanels() {
        const container = this.elements.daysGrid;
        container.innerHTML = '';

        // Seřaď od nejnovějších
        const sortedDays = [...this.dailyResults].sort((a, b) => b.date - a.date);

        for (const day of sortedDays) {
            const hasAlerts = day.alerts && day.alerts.length > 0;

            const panel = document.createElement('div');
            panel.className = `day-panel ${hasAlerts ? 'has-alert' : ''}`;

            // Header
            const header = document.createElement('div');
            header.className = 'day-panel-header';
            header.innerHTML = `
                <div>
                    <span class="day-panel-date">${day.dateStr}</span>
                    <span class="day-panel-records">${day.recordCount} záznamů</span>
                </div>
                <div class="day-panel-alerts">
                    ${hasAlerts ? day.alerts.map(a => `<span class="alert-badge ${a.type}">${a.icon}</span>`).join('') : ''}
                </div>
            `;
            panel.appendChild(header);

            // Body
            const body = document.createElement('div');
            body.className = 'day-panel-body';

            // Row 1: Den vs Noc vzdálenost
            body.innerHTML = `
                <div class="day-panel-row">
                    <div class="day-metric">
                        <div class="value">${Math.round(day.dayDistanceM)} m</div>
                        <div class="label">Trasa DEN</div>
                    </div>
                    <div class="day-metric">
                        <div class="value">${Math.round(day.nightDistanceM)} m</div>
                        <div class="label">Trasa NOC</div>
                    </div>
                </div>
                <div class="day-panel-row">
                    <div class="day-metric">
                        <div class="value">${Math.round(day.totalDistanceM)} m</div>
                        <div class="label">Celkem</div>
                    </div>
                    <div class="day-metric">
                        <div class="value">${day.walkingSpeed.toFixed(1)}</div>
                        <div class="label">Rychlost m/min</div>
                    </div>
                    <div class="day-metric">
                        <div class="value">${day.rms.toFixed(3)}</div>
                        <div class="label">RMS</div>
                    </div>
                </div>
                <div class="day-panel-row">
                    <div class="day-metric lying">
                        <div class="value">${day.lyingTimeH.toFixed(1)}h</div>
                        <div class="label">Ležení</div>
                    </div>
                    <div class="day-metric standing">
                        <div class="value">${day.standingTimeH.toFixed(1)}h</div>
                        <div class="label">Stání</div>
                    </div>
                    <div class="day-metric walking">
                        <div class="value">${day.walkingTimeH.toFixed(1)}h</div>
                        <div class="label">Chůze</div>
                    </div>
                </div>
            `;

            panel.appendChild(body);
            container.appendChild(panel);
        }
    },

    /**
     * Render comparison tabulky
     */
    renderComparisonTable() {
        const tbody = this.elements.comparisonTableBody;
        tbody.innerHTML = '';

        const stats = this.globalStats;

        for (const day of this.dailyResults) {
            const row = document.createElement('tr');

            // Určení class pro anomálie
            const distClass = Math.abs(day.totalDistanceM - stats.avgDistance) > stats.stdDistance * 1.5 ?
                (day.totalDistanceM < stats.avgDistance ? 'alert' : 'good') : '';
            const speedClass = day.walkingSpeed < stats.avgSpeed * 0.7 ? 'warning' : '';
            const lyingClass = day.lyingTimeH > stats.avgLying * 1.25 ? 'warning' : '';

            const hasAlert = day.alerts && day.alerts.length > 0;

            row.innerHTML = `
                <td>${day.dateStr}</td>
                <td class="${distClass}">${Math.round(day.totalDistanceM)}</td>
                <td class="${speedClass}">${day.walkingSpeed.toFixed(1)}</td>
                <td class="${lyingClass}">${day.lyingTimeH.toFixed(1)}</td>
                <td>${day.standingTimeH.toFixed(1)}</td>
                <td>${day.walkingTimeH.toFixed(1)}</td>
                <td>${day.rms.toFixed(3)}</td>
                <td>${day.lyingBouts}</td>
                <td>${hasAlert ? `<span class="alert-badge danger">${day.alerts.length}</span>` : '-'}</td>
            `;

            tbody.appendChild(row);
        }
    },

    renderCleaningSummary() {
        const container = this.elements.cleaningSummaryList;
        if (!container) return;

        if (!this.dailyResults.length) {
            container.innerHTML = '<p class="cleaning-empty">Zatim zadna data.</p>';
            return;
        }

        let totalFake = 0;
        let totalLost = 0;
        const rows = [];

        for (const day of this.dailyResults) {
            const summary = day.dataCleaningSummary || {};
            const datasetName = summary.datasetName || day.datasetBase || day.dateStr || 'Dataset';
            const fakeCount = summary.fakeGpsRecords != null
                ? summary.fakeGpsRecords
                : (day.rawSampleStats ? day.rawSampleStats.outsideFence || 0 : 0);
            const lostCount = summary.lostPackets != null
                ? summary.lostPackets
                : (day.retryFilterStats ? day.retryFilterStats.retryCount || 0 : 0);

            totalFake += fakeCount;
            totalLost += lostCount;

            rows.push(`
                <div class="cleaning-item">
                    <div class="cleaning-dataset">${datasetName}</div>
                    <div class="cleaning-stat">
                        <span>Fake GPS</span>
                        <strong>${this.formatNumber(fakeCount)}</strong>
                    </div>
                    <div class="cleaning-stat">
                        <span>Lost data</span>
                        <strong>${this.formatNumber(lostCount)}</strong>
                    </div>
                </div>
            `);
        }

        container.innerHTML = `
            <div class="cleaning-aggregate">
                <div>
                    <span>Fake GPS celkem</span>
                    <strong>${this.formatNumber(totalFake)}</strong>
                </div>
                <div>
                    <span>Lost packets celkem</span>
                    <strong>${this.formatNumber(totalLost)}</strong>
                </div>
            </div>
            ${rows.join('')}
        `;
    },

    /**
     * Render grafů
     */
    renderCharts() {
        if (this.dailyResults.length === 0) return;

        // Destroy existing charts
        for (const key in this.charts) {
            if (this.charts[key]) {
                this.charts[key].destroy();
            }
        }

        const labels = this.dailyResults.map(d => this.formatDateShort(d.date));

        const chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: { color: '#888', maxRotation: 45, font: { size: 10 } },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                y: {
                    ticks: { color: '#888' },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                }
            }
        };

        // 1. Distance Chart
        this.charts.distance = new Chart(this.elements.distanceChart, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    data: this.dailyResults.map(d => d.totalDistanceM),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: this.dailyResults.map(d =>
                        d.alerts && d.alerts.length > 0 ? '#ef4444' : '#3b82f6'
                    )
                }]
            },
            options: chartOptions
        });

        // 2. Lying Chart
        this.charts.lying = new Chart(this.elements.lyingChart, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    data: this.dailyResults.map(d => d.lyingTimeH),
                    borderColor: '#4CAF50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    fill: true,
                    tension: 0.3
                }]
            },
            options: chartOptions
        });

        // 3. Speed Chart
        this.charts.speed = new Chart(this.elements.speedChart, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    data: this.dailyResults.map(d => d.walkingSpeed),
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    fill: true,
                    tension: 0.3
                }]
            },
            options: chartOptions
        });

        // 4. Bouts Chart
        this.charts.bouts = new Chart(this.elements.boutsChart, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    data: this.dailyResults.map(d => d.lyingBouts),
                    backgroundColor: this.dailyResults.map(d =>
                        d.lyingBouts > this.globalStats.avgBouts + 3 ?
                        'rgba(239, 68, 68, 0.6)' : 'rgba(139, 92, 246, 0.6)'
                    ),
                    borderColor: '#8b5cf6',
                    borderWidth: 1
                }]
            },
            options: chartOptions
        });

        // 5. RMS Chart
        this.charts.rms = new Chart(this.elements.rmsChart, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    data: this.dailyResults.map(d => d.rms),
                    borderColor: '#e94560',
                    backgroundColor: 'rgba(233, 69, 96, 0.1)',
                    fill: true,
                    tension: 0.3
                }]
            },
            options: chartOptions
        });

        // 6. Day/Night Chart
        this.charts.dayNight = new Chart(this.elements.dayNightChart, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Den',
                        data: this.dailyResults.map(d => d.dayDistanceM),
                        backgroundColor: 'rgba(245, 158, 11, 0.7)',
                        borderColor: '#f59e0b',
                        borderWidth: 1
                    },
                    {
                        label: 'Noc',
                        data: this.dailyResults.map(d => d.nightDistanceM),
                        backgroundColor: 'rgba(99, 102, 241, 0.7)',
                        borderColor: '#6366f1',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                ...chartOptions,
                plugins: {
                    legend: {
                        display: true,
                        labels: { color: '#888', font: { size: 10 } }
                    }
                }
            }
        });
    },

    /**
     * Update progress baru
     */
    updateProgress(current, total) {
        const percent = total > 0 ? (current / total) * 100 : 0;
        this.elements.progressBar.style.width = `${percent}%`;
        this.elements.progressStats.textContent = `${current} / ${total}`;
    },

    /**
     * Formátování data
     */
    formatDate(date) {
        if (!date) return '---';
        return date.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
    },

    formatDateShort(date) {
        if (!date) return '---';
        return date.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit' });
    },

    /**
     * Toggle sekce (collapse/expand)
     */
    toggleSection(sectionId) {
        const section = document.getElementById(sectionId);
        if (section) {
            section.classList.toggle('collapsed');
        }
    },

    // ==========================================
    // GGANIMATE FUNCTIONS
    // ==========================================

    storyboardDescriptions: {
        'A': {
            title: 'Animovaný spaghetti plot dne',
            goal: 'Ukázat pohyb krávy v čase a změny chování.',
            usage: 'Stresové epizody, útěk, dezorientace.',
            rScript: 'run_gganimate_spaghetti.R'
        },
        'B': {
            title: 'Animovaná heatmapa aktivity',
            goal: 'Odhalit vznik a zánik stresových zón.',
            usage: 'Noční neklid, opakované konfliktní oblasti.',
            rScript: 'run_gganimate_heatmap.R'
        },
        'C': {
            title: 'Behaviour fingerprint (24h rytmus)',
            goal: 'Porovnat denní rytmus mezi dny.',
            usage: 'Březí krávy, blížící se porod.',
            rScript: 'run_gganimate_fingerprint.R'
        },
        'D': {
            title: 'HMM stavový timeline',
            goal: 'Vizualizace přechodů mezi chováním.',
            usage: 'Detekce narušené sekvence chování.',
            rScript: 'run_gganimate_hmm.R'
        },
        'E': {
            title: 'GPS vs ACC konzistence',
            goal: 'Validace dat a algoritmů.',
            usage: 'GPS drift, kryté prostory.',
            rScript: 'run_gganimate_consistency.R'
        }
    },

    /**
     * Inicializace gganimate sekce
     */
    initGganimate() {
        const select = document.getElementById('storyboardSelect');
        if (select) {
            select.addEventListener('change', () => this.updateStoryboardDesc());
        }
        this.loadAvailableAnimations();
    },

    /**
     * Aktualizace popisu storyboardu
     */
    updateStoryboardDesc() {
        const select = document.getElementById('storyboardSelect');
        const descEl = document.getElementById('storyboardDesc');
        if (!select || !descEl) return;

        const storyboard = this.storyboardDescriptions[select.value];
        if (storyboard) {
            descEl.innerHTML = `
                <strong>Cíl:</strong> ${storyboard.goal}<br>
                <strong>Použití:</strong> ${storyboard.usage}
            `;
        }
    },

    /**
     * Načtení dostupných animací z manifestu
     */
    loadAvailableAnimations() {
        const listEl = document.getElementById('animationList');
        if (!listEl) return;

        // Zkusíme načíst manifest
        if (typeof window.RumburkAnimationsManifest !== 'undefined') {
            const manifest = window.RumburkAnimationsManifest;
            const cowAnimations = manifest.animations.filter(a => a.cowId === this.config.cowId);

            if (cowAnimations.length > 0) {
                listEl.innerHTML = '';
                for (const anim of cowAnimations) {
                    const chip = document.createElement('span');
                    chip.className = 'animation-chip';
                    chip.textContent = `${anim.dateLabel} - ${anim.storyboard.split('–')[0].trim()}`;
                    chip.onclick = () => this.playAnimation(anim.path);
                    listEl.appendChild(chip);
                }
            } else {
                listEl.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8em;">Žádné animace pro tuto krávu</span>';
            }
        } else {
            // Zkusíme načíst manifest dynamicky
            const script = document.createElement('script');
            script.src = 'animations_manifest.js';
            script.onload = () => this.loadAvailableAnimations();
            script.onerror = () => {
                listEl.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8em;">Manifest animací nenalezen</span>';
            };
            document.head.appendChild(script);
        }
    },

    // Stav animace
    animationState: {
        isPaused: false,
        speed: 1,
        currentGif: null,
        gifFrames: [],
        frameIndex: 0,
        intervalId: null
    },

    /**
     * Přehrát animaci
     */
    playAnimation(path) {
        const playerEl = document.getElementById('animationPlayer');
        const controlsEl = document.getElementById('animationControls');
        if (!playerEl) return;

        const isVideo = path.endsWith('.mp4') || path.endsWith('.webm');
        const isGif = path.endsWith('.gif');

        if (isVideo) {
            playerEl.innerHTML = `
                <video id="animationVideo" controls autoplay loop style="max-width: 100%; max-height: 100%;">
                    <source src="${path}" type="video/mp4">
                    Váš prohlížeč nepodporuje video.
                </video>
            `;
            if (controlsEl) controlsEl.style.display = 'block';
        } else if (isGif) {
            // Pro GIF použijeme img tag s CSS animací pro pauzu
            playerEl.innerHTML = `<img id="animationGif" src="${path}" alt="Animation" style="max-width: 100%; max-height: 100%;">`;
            this.animationState.currentGif = path;
            if (controlsEl) controlsEl.style.display = 'block';

            // Reset stavu
            this.animationState.isPaused = false;
            document.getElementById('pauseBtn')?.classList.remove('active');
        } else {
            playerEl.innerHTML = `
                <div class="animation-placeholder">
                    <div class="icon">❌</div>
                    <div>Nepodporovaný formát: ${path}</div>
                </div>
            `;
            if (controlsEl) controlsEl.style.display = 'none';
        }

        // Označit aktivní chip
        document.querySelectorAll('.animation-chip').forEach(chip => {
            chip.classList.remove('active');
            if (chip.textContent.includes(path.split('/').pop().split('_')[1] || '')) {
                chip.classList.add('active');
            }
        });
    },

    /**
     * Nastavení rychlosti animace
     * Poznámka: GIF nelze přímo zpomalit v prohlížeči - musíme regenerovat s jinou fps
     */
    setAnimationSpeed(speed) {
        speed = parseFloat(speed);
        this.animationState.speed = speed;

        // Update UI
        const slider = document.getElementById('speedSlider');
        const valueEl = document.getElementById('speedValue');
        if (slider) slider.value = speed;
        if (valueEl) valueEl.textContent = speed.toFixed(1);

        // Update active button
        document.querySelectorAll('.playback-buttons .ctrl-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.textContent === `${speed}x`) {
                btn.classList.add('active');
            }
        });

        // Pro video můžeme měnit playbackRate
        const video = document.getElementById('animationVideo');
        if (video) {
            video.playbackRate = speed;
        }

        // Pro GIF zobrazíme info - nelze přímo zpomalit
        if (this.animationState.currentGif && speed !== 1) {
            this.showExportStatus(
                `Pro změnu rychlosti GIF regeneruj animaci s jinou FPS (aktuální: 20fps, potřeba: ${Math.round(20 * speed)}fps)`,
                'info'
            );
        }
    },

    /**
     * Pauza/Play animace
     */
    togglePause() {
        this.animationState.isPaused = !this.animationState.isPaused;
        const pauseBtn = document.getElementById('pauseBtn');

        // Video
        const video = document.getElementById('animationVideo');
        if (video) {
            if (this.animationState.isPaused) {
                video.pause();
                if (pauseBtn) {
                    pauseBtn.textContent = '▶️';
                    pauseBtn.classList.add('active');
                }
            } else {
                video.play();
                if (pauseBtn) {
                    pauseBtn.textContent = '⏸️';
                    pauseBtn.classList.remove('active');
                }
            }
        }

        // GIF - CSS trick pro "zamrazení"
        const gif = document.getElementById('animationGif');
        if (gif) {
            if (this.animationState.isPaused) {
                // "Zamrazíme" GIF konverzí na canvas
                const canvas = document.createElement('canvas');
                canvas.width = gif.naturalWidth || gif.width;
                canvas.height = gif.naturalHeight || gif.height;
                canvas.getContext('2d').drawImage(gif, 0, 0);
                canvas.id = 'animationGifPaused';
                canvas.style.maxWidth = '100%';
                canvas.style.maxHeight = '100%';
                gif.parentNode.replaceChild(canvas, gif);

                if (pauseBtn) {
                    pauseBtn.textContent = '▶️';
                    pauseBtn.classList.add('active');
                }
            } else {
                // Obnovíme GIF
                const canvas = document.getElementById('animationGifPaused');
                if (canvas && this.animationState.currentGif) {
                    const newGif = document.createElement('img');
                    newGif.id = 'animationGif';
                    newGif.src = this.animationState.currentGif + '?' + Date.now(); // Force reload
                    newGif.style.maxWidth = '100%';
                    newGif.style.maxHeight = '100%';
                    canvas.parentNode.replaceChild(newGif, canvas);
                }

                if (pauseBtn) {
                    pauseBtn.textContent = '⏸️';
                    pauseBtn.classList.remove('active');
                }
            }
        }
    },

    /**
     * Export CSV pro gganimate
     */
    exportForGganimate() {
        if (!this.config.cowId || this.dailyResults.length === 0) {
            this.showExportStatus('Nejprve spusťte analýzu dat.', 'error');
            return null;
        }

        const storyboard = document.getElementById('storyboardSelect')?.value || 'A';
        const rows = this.buildGganimateCSV();

        if (rows.length === 0) {
            this.showExportStatus('Žádná data k exportu.', 'error');
            return null;
        }

        // Generuj CSV string
        const headers = Object.keys(rows[0]);
        const csvContent = [
            headers.join(','),
            ...rows.map(row => headers.map(h => this.csvEscape(row[h])).join(','))
        ].join('\n');

        // Název souboru obsahuje typ storyboardu
        const filename = `gganimate_${this.config.cowId}_type${storyboard}_all_days.csv`;

        // Download CSV
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);

        this.showExportStatus(`CSV exportováno: ${rows.length} řádků pro ${this.dailyResults.length} dnů. Typ: ${storyboard}`, 'success');
        return storyboard;
    },

    /**
     * Vytvoření CSV dat pro gganimate
     */
    buildGganimateCSV() {
        const rows = [];

        for (const day of this.dailyResults) {
            const rawStats = day.rawStats;
            if (!rawStats || !rawStats.intervals) continue;

            for (const interval of rawStats.intervals) {
                const seconds = Math.round(interval.midSec || interval.startSec || 0);
                rows.push({
                    cow_id: this.config.cowId,
                    date: day.dateStr,
                    timestamp: this.secondsToClock(seconds),
                    seconds: seconds,
                    lat: (interval.lat || 0).toFixed(6),
                    lon: (interval.lon || 0).toFixed(6),
                    behavior: interval.finalBehavior?.behavior || '',
                    behavior_simple: this.simplifyBehavior(interval.finalBehavior?.behavior || ''),
                    posture: interval.finalBehavior?.posture || '',
                    is_day: interval.isDay ? 1 : 0,
                    distance_m: (interval.distM || 0).toFixed(2),
                    speed_mps: (interval.speedMps || 0).toFixed(3),
                    rms_dyn: (interval.dynG || 0).toFixed(4),
                    hmm_state: interval.finalBehavior?.behavior || '',
                    alert_flag: 0
                });
            }
        }

        return rows;
    },

    /**
     * Generovat animaci - export CSV a instrukce pro PowerShell
     */
    generateAnimation() {
        if (!this.config.cowId || this.dailyResults.length === 0) {
            this.showExportStatus('Nejprve spusťte analýzu dat.', 'error');
            return;
        }

        // Exportuj CSV
        this.exportForGganimate();

        // Oznac krok 1 jako hotovy
        this.updateWorkflowStep(1, true);

        // Zobraz instrukce
        this.showExportStatus(
            `CSV exportováno! Nyní spusť PowerShell skript (viz níže).`,
            'success'
        );
    },

    /**
     * Aktualizace workflow kroku
     */
    updateWorkflowStep(stepNum, done) {
        const step = document.getElementById(`step${stepNum}`);
        if (step) {
            if (done) {
                step.classList.add('done');
                const status = step.querySelector('.step-status');
                if (status) {
                    status.textContent = 'hotovo';
                    status.classList.add('done');
                }
            } else {
                step.classList.remove('done');
                const status = step.querySelector('.step-status');
                if (status) {
                    status.textContent = 'ceka';
                    status.classList.remove('done');
                }
            }
        }
    },

    /**
     * Otevrit slozku s PowerShell skriptem
     */
    openPowerShellScript() {
        // V prohlizeci nemuzeme primo otevrit slozku, ale muzeme zobrazit cestu
        const path = 'animations\\run_animation.ps1';
        this.showExportStatus(
            `Otevri v Pruzkumniku: RUMBURK_FARM\\${path}`,
            'info'
        );
        // Zkopiruj cestu do schranky
        navigator.clipboard.writeText(path).then(() => {
            setTimeout(() => {
                this.showExportStatus('Cesta zkopírována! Otevři složku animations a spusť run_animation.ps1', 'success');
            }, 1500);
        });
    },

    /**
     * Zobrazit status exportu
     */
    showExportStatus(message, type) {
        const statusEl = document.getElementById('exportStatus');
        if (!statusEl) return;

        statusEl.textContent = message;
        statusEl.className = `export-status show ${type}`;

        // Auto-hide po 5s
        setTimeout(() => {
            statusEl.classList.remove('show');
        }, 5000);
    },

    /**
     * Pomocné funkce pro CSV
     */
    csvEscape(value) {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (/[",\n]/.test(str)) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    },

    secondsToClock(sec) {
        const total = Math.max(0, Math.round(sec || 0));
        const h = String(Math.floor(total / 3600)).padStart(2, '0');
        const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
        const s = String(total % 60).padStart(2, '0');
        return `${h}:${m}:${s}`;
    },

    simplifyBehavior(value) {
        if (!value) return '';
        if (value.includes('lying')) return 'lying';
        if (value.includes('stand')) return 'standing';
        if (value.includes('walk') || value.includes('graz')) return 'walking';
        return value;
    },

    /**
     * Obnovit animace - prohledat exports slozku a zobrazit v playeru
     * Podporuje MP4 (preferováno) i GIF formáty
     */
    refreshAnimations() {
        const listEl = document.getElementById('animationList');
        if (!listEl) return;

        // Zobraz loading stav
        listEl.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8em;">Hledám animace...</span>';

        // Seznam možných názvů souborů
        const cowId = this.config.cowId || '227831';
        const possibleFiles = [];
        const types = ['A', 'B', 'C', 'D', 'E', ''];  // Různé typy animací + starý formát bez typu
        const formats = ['mp4', 'gif'];  // MP4 preferováno

        // Generuj možné názvy souborů - zkusíme několik variant
        for (const type of types) {
            const typeStr = type ? `type${type}_` : '';
            for (const format of formats) {
                for (let i = 0; i <= 10; i++) {
                    const suffix = i === 0 ? '' : `(${i})`;
                    possibleFiles.push(`animations/exports/gganimate_${cowId}_${typeStr}all_days${suffix}_animation.${format}`);
                }
            }
        }

        // Zkontroluj každý soubor
        const foundAnimations = [];
        let checksCompleted = 0;

        const checkFile = (path) => {
            const isVideo = path.endsWith('.mp4') || path.endsWith('.webm');

            if (isVideo) {
                // Pro video použijeme <video> element (fetch nefunguje s file:// protokolem kvůli CORS)
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.onloadedmetadata = () => {
                    foundAnimations.push(path);
                    checksCompleted++;
                    if (checksCompleted === possibleFiles.length) {
                        this.displayFoundAnimations(foundAnimations);
                    }
                };
                video.onerror = () => {
                    checksCompleted++;
                    if (checksCompleted === possibleFiles.length) {
                        this.displayFoundAnimations(foundAnimations);
                    }
                };
                video.src = path;
            } else {
                // Pro GIF použijeme Image objekt
                const img = new Image();
                img.onload = () => {
                    foundAnimations.push(path);
                    checksCompleted++;
                    if (checksCompleted === possibleFiles.length) {
                        this.displayFoundAnimations(foundAnimations);
                    }
                };
                img.onerror = () => {
                    checksCompleted++;
                    if (checksCompleted === possibleFiles.length) {
                        this.displayFoundAnimations(foundAnimations);
                    }
                };
                img.src = path;
            }
        };

        // Spusť kontroly
        for (const path of possibleFiles) {
            checkFile(path);
        }

        // Timeout pro případ, že všechny selžou rychle
        setTimeout(() => {
            if (checksCompleted < possibleFiles.length) {
                this.displayFoundAnimations(foundAnimations);
            }
        }, 5000);  // Delší timeout pro video soubory
    },

    /**
     * Zobrazit nalezené animace
     */
    displayFoundAnimations(animations) {
        const listEl = document.getElementById('animationList');
        if (!listEl) return;

        if (animations.length === 0) {
            listEl.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8em;">Žádné animace nenalezeny v exports/</span>';
            return;
        }

        listEl.innerHTML = '';

        // Seřaď animace: MP4 první, pak podle čísla verze
        animations.sort((a, b) => {
            // Preferuj MP4 nad GIF
            const aIsMp4 = a.endsWith('.mp4') ? 1 : 0;
            const bIsMp4 = b.endsWith('.mp4') ? 1 : 0;
            if (aIsMp4 !== bIsMp4) return bIsMp4 - aIsMp4;

            // Pak podle čísla verze
            const numA = parseInt(a.match(/\((\d+)\)/)?.[1] || '0');
            const numB = parseInt(b.match(/\((\d+)\)/)?.[1] || '0');
            return numB - numA;
        });

        // Mapa typů na názvy
        const typeNames = {
            'A': 'Spaghetti',
            'B': 'Heatmapa',
            'C': 'Fingerprint',
            'D': 'Timeline',
            'E': 'GPS vs RMS'
        };

        for (const path of animations) {
            const chip = document.createElement('span');
            chip.className = 'animation-chip';

            // Extrahuj název pro zobrazení
            const filename = path.split('/').pop();

            // Detekuj typ animace
            const typeMatch = filename.match(/type([A-E])/i);
            const type = typeMatch ? typeMatch[1].toUpperCase() : '';
            const typeName = type ? typeNames[type] || type : 'Klasická';

            // Detekuj formát
            const isVideo = path.endsWith('.mp4');
            const formatBadge = isVideo ? '📹' : '🖼️';

            // Detekuj číslo verze
            const versionMatch = filename.match(/\((\d+)\)/);
            const version = versionMatch ? ` v${versionMatch[1]}` : '';

            const displayName = `${formatBadge} ${typeName}${version}`;

            chip.textContent = displayName;
            chip.title = `${filename}\n${isVideo ? 'Video (rychlost lze měnit)' : 'GIF (fixní rychlost)'}`;
            chip.onclick = () => this.playAnimation(path);
            listEl.appendChild(chip);
        }

        // Automaticky přehraj první (nejnovější) animaci
        if (animations.length > 0) {
            this.playAnimation(animations[0]);
            this.showExportStatus(`Nalezeno ${animations.length} animací. Přehrávám nejnovější.`, 'success');

            // Označ kroky jako hotové
            this.updateWorkflowStep(2, true);
            this.updateWorkflowStep(3, true);
        }
    }
};

// Inicializace po načtení stránky
document.addEventListener('DOMContentLoaded', () => {
    BigDataKomparace.init();
});

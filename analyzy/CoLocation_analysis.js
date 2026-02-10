(function () {
    const DAY_START = RumburkAnalysisCore.CONFIG.DAY_START_SEC || 6 * 3600;
    const DAY_END = RumburkAnalysisCore.CONFIG.DAY_END_SEC || 18 * 3600;
    const SECONDS_PER_DAY = 24 * 3600;

    /**
     * Safely access a global const variable using eval
     * Required because const declarations are not accessible via window[name]
     */
    function safeGetGlobal(varName) {
        if (!/^[A-Z0-9_]+$/i.test(varName)) return null;
        try {
            if (window[varName] !== undefined) return window[varName];
            if (typeof window !== 'undefined' && typeof window.eval === 'function') {
                return window.eval(varName);
            }
        } catch {
            return null;
        }
        return null;
    }

    // Facility geometry from core
    const FACILITY = RumburkAnalysisCore.FACILITY || {};
    const FACILITY_CENTER = FACILITY.CENTER || [50.9509, 14.5690];
    const RED_FENCES = FACILITY.RED_FENCES || [FACILITY.RED_FENCE].filter(Boolean);
    const ZONE_A = FACILITY.ZONE_A || [];
    const ZONE_B = FACILITY.ZONE_B || [];
    const ZONE_C = FACILITY.ZONE_C || [];

    function createEsriMaxarLayer() {
        return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 21,
            maxNativeZoom: 19,
            zoomSnap: 0.1,
            zoomDelta: 0.25,
            attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics'
        });
    }

    function addFacilityOverlays(map) {
        const group = L.layerGroup();

        const fenceColors = ['#ff2d55', '#ff2d55', '#4c0519'];
        RED_FENCES.forEach((coords, idx) => {
            if (!coords || !coords.length) return;
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

        if (ZONE_A && ZONE_A.length) {
            L.polyline(ZONE_A, {
                color: '#a855f7',
                weight: 3,
                opacity: 0.95
            }).bindPopup('Klidová zóna A (seno/sláma)').addTo(group);
        }

        if (ZONE_B && ZONE_B.length) {
            L.polyline(ZONE_B, {
                color: '#38bdf8',
                weight: 3,
                opacity: 0.95
            }).bindPopup('Zimoviště B').addTo(group);
        }

        if (ZONE_C && ZONE_C.length) {
            L.polyline(ZONE_C, {
                color: '#451a03',
                weight: 3,
                opacity: 0.95
            }).bindPopup('Zóna C').addTo(group);
        }

        L.circleMarker(FACILITY_CENTER, {
            radius: 6,
            color: '#ffffff',
            weight: 2,
            opacity: 0.95,
            fillColor: '#e94560',
            fillOpacity: 0.9
        }).bindPopup('Střed areálu').addTo(group);

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
                }).addTo(map);
            } catch { }
        }
    }

    const Proximity = {
        thresholdMeters: 5,
        minDurationSec: 60,
        manifest: window.RumburkDatasetManifest || { files: [] },
        colors: ['#f87171', '#60a5fa', '#4ade80', '#fbbf24', '#a78bfa', '#f472b6', '#f97316', '#0ea5e9', '#34d399'],
        idColors: {},
        datasetsByDate: {},
        cache: {},
        loadedScripts: new Set(),
        events: [],
        fullscreenActive: false,

        init() {
            this.groupManifest();
            this.cacheElements();
            this.populateDateOptions();
            this.setupMaps();
            this.bindEvents();
        },

        groupManifest() {
            const grouped = {};
            for (const file of this.manifest.files) {
                if (!grouped[file.dateCode]) grouped[file.dateCode] = [];
                grouped[file.dateCode].push(file);
            }
            Object.keys(grouped).forEach(date => {
                grouped[date].sort((a, b) => a.id.localeCompare(b.id));
            });
            this.datasetsByDate = grouped;
        },

        cacheElements() {
            this.el = {
                dayChipsContainer: document.getElementById('dayChipsContainer'),
                analyzeBtn: document.getElementById('analyzeBtn'),
                status: document.getElementById('statusText'),
                cowCount: document.getElementById('cowCount'),
                pairCount: document.getElementById('pairCount'),
                dayEvents: document.getElementById('dayEventCount'),
                nightEvents: document.getElementById('nightEventCount'),
                longestEvent: document.getElementById('longestEvent'),
                cowChipList: document.getElementById('cowChipList'),
                eventsTableBody: document.querySelector('#eventsTable tbody'),
                legend: document.getElementById('legend')
            };
            this.selectedDateCode = null;
        },

        populateDateOptions() {
            // Filter only days with 2+ cows (needed for co-location)
            const validDays = Object.entries(this.datasetsByDate)
                .filter(([_, files]) => files.length >= 2)
                .sort((a, b) => b[0].localeCompare(a[0]));

            console.log('[CoLocation] Valid days for co-location:', validDays.length);

            if (validDays.length === 0) {
                this.el.dayChipsContainer.innerHTML = '<span style="color: var(--danger);">Žádné dny s 2+ kravami.</span>';
                this.el.analyzeBtn.disabled = true;
                return;
            }

            const chips = validDays.map(([dateCode, files]) => {
                const text = this.formatDateCode(dateCode);
                const cowCount = files.length;
                return `<div class="day-chip" data-date="${dateCode}">
                    ${text}<span class="cow-count">(${cowCount} krav)</span>
                </div>`;
            }).join('');

            this.el.dayChipsContainer.innerHTML = chips;

            // Add click handlers to chips
            this.el.dayChipsContainer.querySelectorAll('.day-chip').forEach(chip => {
                chip.addEventListener('click', () => this.selectDay(chip.dataset.date));
            });
        },

        selectDay(dateCode) {
            // Deselect previous
            this.el.dayChipsContainer.querySelectorAll('.day-chip').forEach(c => c.classList.remove('selected'));

            // Select new
            const chip = this.el.dayChipsContainer.querySelector(`[data-date="${dateCode}"]`);
            if (chip) {
                chip.classList.add('selected');
                this.selectedDateCode = dateCode;
                this.el.analyzeBtn.disabled = false;
                const cowCount = this.datasetsByDate[dateCode].length;
                this.setStatus(`Vybrán ${this.formatDateCode(dateCode)} (${cowCount} krav). Klikněte Analyzovat.`);
            }
        },

        bindEvents() {
            this.el.analyzeBtn.addEventListener('click', () => this.handleAnalyze());
        },

        async handleAnalyze() {
            const dateCode = this.selectedDateCode;
            if (!dateCode) {
                this.setStatus('Vyberte den kliknutím na chip.', true);
                return;
            }
            this.el.analyzeBtn.disabled = true;
            this.setStatus('Načítám datasety...', false);
            try {
                const dayDatasets = await this.loadDatasetsForDate(dateCode);
                if (!dayDatasets.length) {
                    this.setStatus('Pro tento den nejsou dostupná data.', true);
                    this.clearResults();
                } else if (dayDatasets.length === 1) {
                    this.setStatus('Pro den existuje pouze jedna kráva – není co porovnat.', true);
                    this.clearResults(dayDatasets);
                } else {
                    this.setStatus(`Zpracováno ${dayDatasets.length} datasetů.`, false);
                    this.renderDatasetSummary(dayDatasets);
                    const events = this.computeEvents(dateCode, dayDatasets);
                    this.events = events;
                    this.renderEvents(events);
                    this.renderMaps(events);
                }
            } catch (err) {
                console.error(err);
                this.setStatus('Chyba při načítání datasetů.', true);
            } finally {
                this.el.analyzeBtn.disabled = false;
            }
        },

        async loadDatasetsForDate(dateCode) {
            if (this.cache[dateCode]) return this.cache[dateCode];
            const files = this.datasetsByDate[dateCode] || [];
            console.log(`[CoLocation] Loading ${files.length} datasets for ${dateCode}:`, files.map(f => f.filename));
            const results = [];
            for (const entry of files) {
                try {
                    await this.loadDatasetScript(entry.filename);
                    const varName = `COW_${entry.id}_${dateCode}`;
                    const raw = safeGetGlobal(varName);
                    console.log(`[CoLocation] ${varName}: exists=${!!raw}, isArray=${Array.isArray(raw)}, length=${raw?.length || 0}`);
                    if (!raw || !Array.isArray(raw)) {
                        console.warn(`Dataset ${varName} chybí nebo je prázdný.`);
                        continue;
                    }
                    const samples = this.prepareSamples(raw);
                    console.log(`[CoLocation] ${varName}: prepared samples=${samples.length}`);
                    if (samples.length === 0) {
                        console.warn(`Dataset ${varName} neobsahuje validní GPS vzorky.`);
                        continue;
                    }
                    results.push({
                        id: entry.id,
                        dateCode,
                        filename: entry.filename,
                        samples
                    });
                } catch (err) {
                    console.error(`Načtení ${entry.filename} selhalo`, err);
                }
            }
            console.log(`[CoLocation] Final results for ${dateCode}: ${results.length} datasets`);
            this.cache[dateCode] = results;
            return results;
        },

        loadDatasetScript(filename) {
            if (this.loadedScripts.has(filename)) {
                return Promise.resolve();
            }
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = `Datasets/${filename}`;
                script.onload = () => {
                    this.loadedScripts.add(filename);
                    resolve();
                };
                script.onerror = () => reject(new Error(`Nelze načíst ${filename}`));
                document.head.appendChild(script);
            });
        },

        prepareSamples(rawData) {
            const samples = [];
            for (const row of rawData) {
                const tSec = RumburkAnalysisCore.parseTimeToSeconds(row.timestamp);
                const lat = RumburkAnalysisCore.safeNumber(row.gps_lat);
                const lon = RumburkAnalysisCore.safeNumber(row.gps_lon);
                if (tSec === null || lat === null || lon === null) continue;
                const epochSec = row.date
                    ? RumburkAnalysisCore.parseDateTimeToEpoch(row.date, row.timestamp)
                    : tSec;
                samples.push({
                    tSec,
                    epochSec,
                    lat,
                    lon
                });
            }
            samples.sort((a, b) => (a.epochSec || a.tSec) - (b.epochSec || b.tSec));
            if (!samples.length) return [];
            const resampled = RumburkAnalysisCore.resampleTo1Hz(samples) || samples;
            const cleaned = resampled
                .map(s => ({
                    epochSec: (s.epochSec !== undefined) ? s.epochSec : s.tSec,
                    tSec: (s.tSec !== undefined) ? s.tSec : ((s.epochSec || 0) % SECONDS_PER_DAY),
                    lat: s.lat,
                    lon: s.lon
                }))
                .filter(s => Number.isFinite(s.epochSec) && Number.isFinite(s.lat) && Number.isFinite(s.lon));
            cleaned.sort((a, b) => a.epochSec - b.epochSec);
            return cleaned;
        },

        computeEvents(dateCode, datasets) {
            const events = [];
            for (let i = 0; i < datasets.length; i++) {
                for (let j = i + 1; j < datasets.length; j++) {
                    const pairEvents = this.detectPairEvents(dateCode, datasets[i], datasets[j]);
                    events.push(...pairEvents);
                }
            }
            events.sort((a, b) => a.startEpoch - b.startEpoch);
            return events;
        },

        /**
         * Interpolate position at given epoch from a sorted samples array
         * Returns null if epoch is outside the samples range
         */
        interpolatePosition(samples, epoch) {
            if (!samples.length) return null;
            if (epoch < samples[0].epochSec || epoch > samples[samples.length - 1].epochSec) {
                return null;
            }

            // Binary search for the right interval
            let lo = 0, hi = samples.length - 1;
            while (lo < hi - 1) {
                const mid = Math.floor((lo + hi) / 2);
                if (samples[mid].epochSec <= epoch) lo = mid;
                else hi = mid;
            }

            const before = samples[lo];
            const after = samples[hi];

            // Exact match
            if (before.epochSec === epoch) return { lat: before.lat, lon: before.lon };
            if (after.epochSec === epoch) return { lat: after.lat, lon: after.lon };

            // Interpolate only if gap is reasonable (< 5 minutes)
            const gap = after.epochSec - before.epochSec;
            if (gap > 300) return null;

            const t = (epoch - before.epochSec) / gap;
            return {
                lat: before.lat + t * (after.lat - before.lat),
                lon: before.lon + t * (after.lon - before.lon)
            };
        },

        detectPairEvents(dateCode, datasetA, datasetB) {
            const seriesA = datasetA.samples;
            const seriesB = datasetB.samples;
            const events = [];

            if (!seriesA.length || !seriesB.length) return events;

            // Find overlapping time range
            const startEpoch = Math.max(seriesA[0].epochSec, seriesB[0].epochSec);
            const endEpoch = Math.min(seriesA[seriesA.length - 1].epochSec, seriesB[seriesB.length - 1].epochSec);

            if (startEpoch >= endEpoch) {
                console.log(`[CoLocation] No time overlap between ${datasetA.id} and ${datasetB.id}`);
                return events;
            }

            console.log(`[CoLocation] Checking ${datasetA.id} vs ${datasetB.id}: overlap ${Math.round((endEpoch - startEpoch) / 60)} min`);

            let current = null;
            let checksPerformed = 0;
            let proximityHits = 0;

            const finalize = () => {
                if (!current) return;
                const duration = current.lastEpoch - current.startEpoch + 1;
                if (duration >= this.minDurationSec) {
                    const startTsec = current.startEpoch % SECONDS_PER_DAY;
                    const period = (startTsec >= DAY_START && startTsec < DAY_END) ? 'day' : 'night';
                    const avgA = {
                        lat: current.latSumA / current.count,
                        lon: current.lonSumA / current.count
                    };
                    const avgB = {
                        lat: current.latSumB / current.count,
                        lon: current.lonSumB / current.count
                    };
                    events.push({
                        dateCode,
                        pair: `${datasetA.id} ↔ ${datasetB.id}`,
                        cows: [
                            { id: datasetA.id, color: this.getColor(datasetA.id), avgLat: avgA.lat, avgLon: avgA.lon },
                            { id: datasetB.id, color: this.getColor(datasetB.id), avgLat: avgB.lat, avgLon: avgB.lon }
                        ],
                        startEpoch: current.startEpoch,
                        endEpoch: current.lastEpoch,
                        durationSec: duration,
                        period,
                        minDistance: current.minDist,
                        maxDistance: current.maxDist,
                        avgDistance: current.distSum / current.count,
                        startClock: this.formatClock(startTsec),
                        endClock: this.formatClock(current.lastEpoch % SECONDS_PER_DAY)
                    });
                }
                current = null;
            };

            // Check every second in the overlapping range (or every 5s to speed up)
            const step = 5; // Check every 5 seconds
            for (let epoch = startEpoch; epoch <= endEpoch; epoch += step) {
                const posA = this.interpolatePosition(seriesA, epoch);
                const posB = this.interpolatePosition(seriesB, epoch);

                if (!posA || !posB) {
                    finalize();
                    continue;
                }

                checksPerformed++;
                const dist = RumburkAnalysisCore.haversineDistance(posA.lat, posA.lon, posB.lat, posB.lon);

                if (Number.isFinite(dist) && dist <= this.thresholdMeters) {
                    proximityHits++;
                    if (!current) {
                        current = {
                            startEpoch: epoch,
                            lastEpoch: epoch,
                            count: 0,
                            latSumA: 0,
                            lonSumA: 0,
                            latSumB: 0,
                            lonSumB: 0,
                            minDist: dist,
                            maxDist: dist,
                            distSum: 0
                        };
                    }
                    current.count++;
                    current.lastEpoch = epoch;
                    current.latSumA += posA.lat;
                    current.lonSumA += posA.lon;
                    current.latSumB += posB.lat;
                    current.lonSumB += posB.lon;
                    current.distSum += dist;
                    current.minDist = Math.min(current.minDist, dist);
                    current.maxDist = Math.max(current.maxDist, dist);
                } else {
                    finalize();
                }
            }
            finalize();

            console.log(`[CoLocation] ${datasetA.id} vs ${datasetB.id}: ${checksPerformed} checks, ${proximityHits} hits (<${this.thresholdMeters}m), ${events.length} events (>=${this.minDurationSec}s)`);
            return events;
        },

        renderDatasetSummary(dayDatasets) {
            this.el.cowChipList.innerHTML = dayDatasets.map(ds => {
                const color = this.getColor(ds.id);
                return `<span class="chip" style="border-color:${color}; color:${color};">${ds.id}</span>`;
            }).join('');
            this.el.cowCount.textContent = dayDatasets.length.toString();
            const pairCount = (dayDatasets.length * (dayDatasets.length - 1)) / 2;
            this.el.pairCount.textContent = pairCount.toString();
        },

        renderEvents(events) {
            const dayEvents = events.filter(e => e.period === 'day');
            const nightEvents = events.filter(e => e.period === 'night');
            this.el.dayEvents.textContent = dayEvents.length.toString();
            this.el.nightEvents.textContent = nightEvents.length.toString();
            const longest = events.reduce((max, e) => Math.max(max, e.durationSec), 0);
            this.el.longestEvent.textContent = longest ? RumburkAnalysisCore.formatDuration(longest) : '0 s';

            if (!events.length) {
                this.el.eventsTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color: var(--muted);">Žádné páry nesplnily podmínky.</td></tr>`;
                return;
            }
            const rows = events.map(event => {
                const badge = `<span class="badge ${event.period}">${event.period === 'day' ? 'Den' : 'Noc'}</span>`;
                const distFormat = value => `${value.toFixed(2)} m`;
                return `<tr>
                    <td>${badge}</td>
                    <td>${event.pair}</td>
                    <td>${event.startClock}</td>
                    <td>${event.endClock}</td>
                    <td>${RumburkAnalysisCore.formatDuration(event.durationSec)}</td>
                    <td>${distFormat(event.minDistance)}</td>
                    <td>${distFormat(event.maxDistance)}</td>
                    <td>${distFormat(event.avgDistance)}</td>
                </tr>`;
            }).join('');
            this.el.eventsTableBody.innerHTML = rows;
        },

        setupMaps() {
            // Create maps with ESRI Maxar satellite imagery
            this.mapDay = L.map('mapDay', {
                preferCanvas: true,
                zoomSnap: 0.1,
                zoomDelta: 0.25
            });
            createEsriMaxarLayer().addTo(this.mapDay);
            this.dayLayer = L.layerGroup().addTo(this.mapDay);

            this.mapNight = L.map('mapNight', {
                preferCanvas: true,
                zoomSnap: 0.1,
                zoomDelta: 0.25
            });
            createEsriMaxarLayer().addTo(this.mapNight);
            this.nightLayer = L.layerGroup().addTo(this.mapNight);

            // Set initial view
            this.mapDay.setView(FACILITY_CENTER, 17);
            this.mapNight.setView(FACILITY_CENTER, 17);

            // Add facility overlays (fences, zones)
            addFacilityOverlays(this.mapDay);
            addFacilityOverlays(this.mapNight);

            // Add scale and distance rings
            addScaleAndDistanceRings(this.mapDay);
            addScaleAndDistanceRings(this.mapNight);

            const defaultBounds = FACILITY.RED_FENCE || [[50.9510, 14.5689], [50.9506, 14.5696]];
            try {
                const bounds = L.latLngBounds(defaultBounds);
                this.mapDay.fitBounds(bounds.pad(0.1));
                this.mapNight.fitBounds(bounds.pad(0.1));
            } catch (err) {
                // Already set view above
            }
        },

        renderMaps(events) {
            this.dayLayer.clearLayers();
            this.nightLayer.clearLayers();
            const legendEntries = new Map();

            const renderSet = (mapLayer, filteredEvents) => {
                const bounds = [];
                filteredEvents.forEach(event => {
                    const coordsA = [event.cows[0].avgLat, event.cows[0].avgLon];
                    const coordsB = [event.cows[1].avgLat, event.cows[1].avgLon];
                    const group = L.layerGroup();
                    const line = L.polyline([coordsA, coordsB], {
                        color: '#e2e8f0',
                        dashArray: '4 4',
                        weight: 2,
                        opacity: 0.6
                    });
                    line.addTo(group);

                    event.cows.forEach((cow, idx) => {
                        const marker = L.circleMarker([cow.avgLat, cow.avgLon], {
                            radius: 6,
                            color: cow.color,
                            fillColor: cow.color,
                            fillOpacity: 0.8,
                            weight: 2
                        });
                        marker.bindPopup(`
                            <strong>Kráva ${cow.id}</strong><br>
                            ${event.pair}<br>
                            ${event.startClock} – ${event.endClock}<br>
                            Délka: ${RumburkAnalysisCore.formatDuration(event.durationSec)}<br>
                            min/max: ${event.minDistance.toFixed(2)} m / ${event.maxDistance.toFixed(2)} m
                        `);
                        marker.addTo(group);
                        bounds.push([cow.avgLat, cow.avgLon]);
                        legendEntries.set(cow.id, cow.color);
                    });
                    group.addTo(mapLayer);
                });
                if (bounds.length >= 2) {
                    const map = mapLayer === this.dayLayer ? this.mapDay : this.mapNight;
                    map.fitBounds(bounds, { padding: [20, 20] });
                }
            };

            const dayEvents = events.filter(e => e.period === 'day');
            const nightEvents = events.filter(e => e.period === 'night');
            renderSet(this.dayLayer, dayEvents);
            renderSet(this.nightLayer, nightEvents);
            if (!events.length) {
                this.mapDay.setView([50.9509, 14.5690], 17);
                this.mapNight.setView([50.9509, 14.5690], 17);
            }
            if (legendEntries.size) {
                this.el.legend.innerHTML = Array.from(legendEntries.entries()).map(([id, color]) => {
                    return `<span><i style="background:${color}"></i>${id}</span>`;
                }).join('');
            } else {
                this.el.legend.textContent = 'Žádné události k zobrazení.';
            }
        },

        clearResults(datasets = []) {
            this.el.eventsTableBody.innerHTML = '';
            this.el.dayEvents.textContent = '0';
            this.el.nightEvents.textContent = '0';
            this.el.longestEvent.textContent = '0 s';
            this.dayLayer.clearLayers();
            this.nightLayer.clearLayers();
            if (datasets.length) {
                this.renderDatasetSummary(datasets);
            } else {
                this.el.cowChipList.innerHTML = '';
                this.el.cowCount.textContent = '0';
                this.el.pairCount.textContent = '0';
            }
            this.el.legend.textContent = '';
        },

        setStatus(message, isError = false) {
            this.el.status.textContent = message;
            this.el.status.style.color = isError ? 'var(--danger)' : 'var(--muted)';
        },

        getColor(id) {
            if (!this.idColors[id]) {
                const idx = Object.keys(this.idColors).length % this.colors.length;
                this.idColors[id] = this.colors[idx];
            }
            return this.idColors[id];
        },

        formatDateCode(code) {
            if (!code || code.length !== 6) return code;
            const day = code.slice(0, 2);
            const month = code.slice(2, 4);
            const year = '20' + code.slice(4);
            return `${day}.${month}.${year}`;
        },

        formatClock(tSec) {
            const sec = Math.max(0, Math.floor(tSec % SECONDS_PER_DAY));
            const h = String(Math.floor(sec / 3600)).padStart(2, '0');
            const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
            const s = String(sec % 60).padStart(2, '0');
            return `${h}:${m}:${s}`;
        },

        openFullscreen(mapType) {
            const overlay = document.getElementById('mapsFullscreenOverlay');
            const title = document.getElementById('fsMapTitle');
            const container = document.getElementById('fsMapContainer');
            if (!overlay || !container) return;

            // Set title based on map type
            if (title) {
                title.textContent = mapType === 'day'
                    ? 'Ko-lokace – Den (06:00 – 18:00)'
                    : 'Ko-lokace – Noc (18:00 – 06:00)';
            }

            overlay.classList.add('active');
            document.body.style.overflow = 'hidden';
            this.fullscreenActive = true;
            this.fullscreenMapType = mapType;

            // Render the selected map
            this.renderFullscreenMap(mapType, container);
        },

        closeFullscreen() {
            const overlay = document.getElementById('mapsFullscreenOverlay');
            if (!overlay) return;

            overlay.classList.remove('active');
            document.body.style.overflow = '';
            this.fullscreenActive = false;
            this.fullscreenMapType = null;

            // Destroy fullscreen map
            if (this.fsMap) {
                this.fsMap.remove();
                this.fsMap = null;
            }
        },

        renderFullscreenMap(mapType, container) {
            if (!container) return;

            // Clear existing
            container.innerHTML = '';

            // Create fullscreen map
            this.fsMap = L.map(container, {
                preferCanvas: true,
                zoomSnap: 0.1,
                zoomDelta: 0.25
            });

            // Set initial view first (required for Leaflet)
            this.fsMap.setView(FACILITY_CENTER, 17);

            // Add base layer
            createEsriMaxarLayer().addTo(this.fsMap);

            // Invalidate size after container is visible (critical for fullscreen)
            setTimeout(() => {
                this.fsMap.invalidateSize();

                // Add overlays after map is properly sized
                addFacilityOverlays(this.fsMap);
                addScaleAndDistanceRings(this.fsMap);

                // Set bounds to facility
                const bounds = FACILITY.RED_FENCE ? L.latLngBounds(FACILITY.RED_FENCE).pad(0.1) : null;
                if (bounds) {
                    this.fsMap.fitBounds(bounds);
                }

                // Render co-location events for this map type
                this.renderFullscreenEvents(mapType);
            }, 100);
        },

        renderFullscreenEvents(mapType) {
            if (!this.fsMap) return;

            const filteredEvents = this.events.filter(e => e.period === mapType);
            const eventBounds = [];

            filteredEvents.forEach(event => {
                const coordsA = [event.cows[0].avgLat, event.cows[0].avgLon];
                const coordsB = [event.cows[1].avgLat, event.cows[1].avgLon];

                L.polyline([coordsA, coordsB], {
                    color: '#e2e8f0',
                    dashArray: '4 4',
                    weight: 2,
                    opacity: 0.6
                }).addTo(this.fsMap);

                event.cows.forEach(cow => {
                    L.circleMarker([cow.avgLat, cow.avgLon], {
                        radius: 8,
                        color: cow.color,
                        fillColor: cow.color,
                        fillOpacity: 0.8,
                        weight: 2
                    }).bindPopup(`
                        <strong>Kráva ${cow.id}</strong><br>
                        ${event.pair}<br>
                        ${event.startClock} – ${event.endClock}<br>
                        Délka: ${RumburkAnalysisCore.formatDuration(event.durationSec)}<br>
                        min/max: ${event.minDistance.toFixed(2)} m / ${event.maxDistance.toFixed(2)} m
                    `).addTo(this.fsMap);
                    eventBounds.push([cow.avgLat, cow.avgLon]);
                });
            });

            if (eventBounds.length >= 2) {
                this.fsMap.fitBounds(eventBounds, { padding: [40, 40] });
            }
        },

        bindFullscreenEvents() {
            const closeBtn = document.getElementById('closeMapsFullscreen');

            // Individual map fullscreen buttons
            document.querySelectorAll('.map-fullscreen-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const mapType = btn.dataset.map; // 'day' or 'night'
                    this.openFullscreen(mapType);
                });
            });

            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.closeFullscreen());
            }

            // ESC key to close
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.fullscreenActive) {
                    this.closeFullscreen();
                }
            });
        }
    };

    // -------------------------------
    // Forensic clustering dashboard
    // -------------------------------
    const ANALYSIS_RANGE = { from: '141225', to: '270126' };
    const METHOD_COLORS = ['#38bdf8', '#a78bfa', '#f97316', '#22d3ee', '#f472b6', '#2dd4bf', '#facc15', '#60a5fa', '#fb7185'];

    function dateCodeToDate(code) {
        if (!code || code.length !== 6) return null;
        const d = parseInt(code.slice(0, 2), 10);
        const m = parseInt(code.slice(2, 4), 10) - 1;
        const y = 2000 + parseInt(code.slice(4), 10);
        const dt = new Date(Date.UTC(y, m, d));
        return Number.isNaN(dt.getTime()) ? null : dt;
    }

    function isDateInRange(code, range) {
        const dt = dateCodeToDate(code);
        const from = dateCodeToDate(range.from);
        const to = dateCodeToDate(range.to);
        if (!dt || !from || !to) return false;
        return dt.getTime() >= from.getTime() && dt.getTime() <= to.getTime();
    }

    function normalizeFeatures(points) {
        if (!points.length) return [];
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const rangeX = (maxX - minX) || 1;
        const rangeY = (maxY - minY) || 1;
        return points.map(p => ({
            ...p,
            nx: (p.x - minX) / rangeX,
            ny: (p.y - minY) / rangeY
        }));
    }

    function euclidean(a, b) {
        const dx = a.nx - b.nx;
        const dy = a.ny - b.ny;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function kmeansPlusPlus(points, k = 4, maxIter = 20) {
        if (!points.length) return { labels: [], centroids: [] };
        const pts = points.slice();
        const centroids = [];

        // Choose first centroid randomly
        centroids.push(pts[Math.floor(Math.random() * pts.length)]);

        // k-means++ init
        while (centroids.length < k) {
            const distances = pts.map(p => Math.min(...centroids.map(c => euclidean(p, c))));
            const sum = distances.reduce((acc, v) => acc + v, 0) || 1;
            let r = Math.random() * sum;
            let chosen = pts[0];
            for (let i = 0; i < distances.length; i++) {
                r -= distances[i];
                if (r <= 0) {
                    chosen = pts[i];
                    break;
                }
            }
            centroids.push(chosen);
        }

        let labels = new Array(pts.length).fill(0);
        for (let iter = 0; iter < maxIter; iter++) {
            // Assign
            labels = pts.map(p => {
                let best = 0;
                let bestDist = Infinity;
                centroids.forEach((c, idx) => {
                    const d = euclidean(p, c);
                    if (d < bestDist) {
                        bestDist = d;
                        best = idx;
                    }
                });
                return best;
            });

            // Update centroids
            const newCentroids = centroids.map((_, idx) => {
                const clusterPts = pts.filter((_, i) => labels[i] === idx);
                if (!clusterPts.length) return centroids[idx];
                const avgNx = clusterPts.reduce((acc, p) => acc + p.nx, 0) / clusterPts.length;
                const avgNy = clusterPts.reduce((acc, p) => acc + p.ny, 0) / clusterPts.length;
                return { nx: avgNx, ny: avgNy };
            });

            const moved = newCentroids.some((c, idx) => euclidean(c, centroids[idx]) > 1e-4);
            centroids.splice(0, centroids.length, ...newCentroids);
            if (!moved) break;
        }

        return { labels, centroids };
    }

    function averagePathLength(n) {
        if (n <= 1) return 0;
        return 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1) / n);
    }

    function buildIsoTree(points, height = 0, maxHeight = 8) {
        if (points.length <= 1 || height >= maxHeight) {
            return { size: points.length };
        }
        const feature = Math.random() > 0.5 ? 'nx' : 'ny';
        const min = Math.min(...points.map(p => p[feature]));
        const max = Math.max(...points.map(p => p[feature]));
        if (min === max) return { size: points.length };
        const split = min + Math.random() * (max - min);
        const left = points.filter(p => p[feature] < split);
        const right = points.filter(p => p[feature] >= split);
        return {
            feature,
            split,
            left: buildIsoTree(left, height + 1, maxHeight),
            right: buildIsoTree(right, height + 1, maxHeight)
        };
    }

    function pathLength(point, tree, height = 0) {
        if (!tree.left || !tree.right) {
            return height + averagePathLength(tree.size || 1);
        }
        const feature = tree.feature;
        if (point[feature] < tree.split) {
            return pathLength(point, tree.left, height + 1);
        }
        return pathLength(point, tree.right, height + 1);
    }

    function runIsolationForest(points, contamination = 0.05, trees = 40, sampleSize = 64) {
        if (!points.length) return [];
        const samples = points.map(p => ({ ...p }));
        const forest = [];
        const size = Math.min(sampleSize, samples.length);
        const maxHeight = Math.ceil(Math.log2(size));

        for (let i = 0; i < trees; i++) {
            const subset = [];
            for (let s = 0; s < size; s++) {
                subset.push(samples[Math.floor(Math.random() * samples.length)]);
            }
            forest.push(buildIsoTree(subset, 0, maxHeight));
        }

        const c = averagePathLength(size);
        const scores = samples.map(p => {
            const path = forest.reduce((acc, tree) => acc + pathLength(p, tree, 0), 0) / forest.length;
            const score = Math.pow(2, -path / c);
            return score;
        });

        const sorted = scores.slice().sort((a, b) => b - a);
        const cutoffIndex = Math.max(0, Math.floor(contamination * sorted.length) - 1);
        const threshold = sorted[cutoffIndex] || 0;

        return scores.map(score => ({
            score,
            isAnomaly: score >= threshold
        }));
    }

    function runDbscan(points, eps = 0.6, minPts = 5) {
        const labels = new Array(points.length).fill(-1);
        let clusterId = 0;

        const regionQuery = (idx) => {
            const res = [];
            points.forEach((p, j) => {
                if (euclidean(points[idx], p) <= eps) res.push(j);
            });
            return res;
        };

        const expandCluster = (idx, neighbors, cluster) => {
            labels[idx] = cluster;
            for (let i = 0; i < neighbors.length; i++) {
                const nIdx = neighbors[i];
                if (labels[nIdx] === -1) {
                    labels[nIdx] = cluster;
                }
                if (labels[nIdx] !== undefined) {
                    const nNeighbors = regionQuery(nIdx);
                    if (nNeighbors.length >= minPts) {
                        neighbors.push(...nNeighbors.filter(v => !neighbors.includes(v)));
                    }
                }
            }
        };

        for (let i = 0; i < points.length; i++) {
            if (labels[i] !== -1) continue;
            const neighbors = regionQuery(i);
            if (neighbors.length < minPts) {
                labels[i] = -2; // noise
            } else {
                expandCluster(i, neighbors, clusterId);
                clusterId++;
            }
        }
        return labels;
    }

    function formatDateCode(code) {
        if (!code || code.length !== 6) return code;
        const day = code.slice(0, 2);
        const month = code.slice(2, 4);
        const year = '20' + code.slice(4);
        return `${day}.${month}.${year}`;
    }

    function buildPairEvents(datasetA, datasetB) {
        const seriesA = datasetA.samples;
        const seriesB = datasetB.samples;
        const events = [];
        if (!seriesA.length || !seriesB.length) return events;

        const startEpoch = Math.max(seriesA[0].epochSec, seriesB[0].epochSec);
        const endEpoch = Math.min(seriesA[seriesA.length - 1].epochSec, seriesB[seriesB.length - 1].epochSec);
        if (startEpoch >= endEpoch) return events;

        let current = null;
        const step = 5;
        const thresholdMeters = 5;
        const minDurationSec = 60;

        const finalize = () => {
            if (!current) return;
            const duration = current.lastEpoch - current.startEpoch + 1;
            if (duration >= minDurationSec) {
                const startTsec = current.startEpoch % SECONDS_PER_DAY;
                const period = (startTsec >= DAY_START && startTsec < DAY_END) ? 'day' : 'night';
                events.push({
                    dateCode: datasetA.dateCode,
                    pair: `${datasetA.id} x ${datasetB.id}`,
                    cows: [datasetA.id, datasetB.id],
                    startEpoch: current.startEpoch,
                    endEpoch: current.lastEpoch,
                    durationSec: duration,
                    period,
                    minDistance: current.minDist,
                    maxDistance: current.maxDist,
                    avgDistance: current.distSum / current.count,
                    startClock: Proximity.formatClock(startTsec),
                    endClock: Proximity.formatClock(current.lastEpoch % SECONDS_PER_DAY)
                });
            }
            current = null;
        };

        for (let epoch = startEpoch; epoch <= endEpoch; epoch += step) {
            const posA = Proximity.interpolatePosition(seriesA, epoch);
            const posB = Proximity.interpolatePosition(seriesB, epoch);
            if (!posA || !posB) {
                finalize();
                continue;
            }
            const dist = RumburkAnalysisCore.haversineDistance(posA.lat, posA.lon, posB.lat, posB.lon);
            if (Number.isFinite(dist) && dist <= thresholdMeters) {
                if (!current) {
                    current = {
                        startEpoch: epoch,
                        lastEpoch: epoch,
                        count: 0,
                        minDist: dist,
                        maxDist: dist,
                        distSum: 0
                    };
                }
                current.count++;
                current.lastEpoch = epoch;
                current.distSum += dist;
                current.minDist = Math.min(current.minDist, dist);
                current.maxDist = Math.max(current.maxDist, dist);
            } else {
                finalize();
            }
        }
        finalize();
        return events;
    }

    const ClusteringDashboard = {
        manifest: window.RumburkDatasetManifest || { files: [] },
        selectedMethod: 'kmeans',
        selectedPeriod: 'all',
        chart: null,
        colors: METHOD_COLORS,
        lastPoints: [],
        lastEvents: [],
        allEvents: [],

        init() {
            this.cacheElements();
            this.renderCowSelector();
            this.bindEvents();
            this.renderChart([]);
        },

        cacheElements() {
            this.el = {
                tabs: document.getElementById('methodTabs'),
                cowSelector: document.getElementById('cowSelector'),
                runBtn: document.getElementById('runAnalysisBtn'),
                status: document.getElementById('analysisStatus'),
                metricEvents: document.getElementById('metricEvents'),
                metricClusters: document.getElementById('metricClusters'),
                metricCows: document.getElementById('metricCows'),
                metricDays: document.getElementById('metricDays'),
                tableBody: document.querySelector('#analysisTable tbody'),
                paramK: document.getElementById('paramK'),
                paramContamination: document.getElementById('paramContamination'),
                paramEps: document.getElementById('paramEps'),
                paramMinPts: document.getElementById('paramMinPts'),
                chartCanvas: document.getElementById('analysisChart'),
                periodTabs: document.getElementById('periodTabs'),
                interpretation: document.getElementById('interpretationBox')
            };
        },

        renderCowSelector() {
            if (!this.el.cowSelector) return;
            const ids = Array.from(new Set(
                this.manifest.files
                    .filter(f => isDateInRange(f.dateCode, ANALYSIS_RANGE))
                    .map(f => f.id)
            )).sort();

            this.el.cowSelector.innerHTML = ids.map(id => {
                return `<label class="checkbox-pill"><input type="checkbox" value="${id}" checked> ${id}</label>`;
            }).join('');
            this.el.cowSelector.dataset.count = ids.length;
        },

        bindEvents() {
            if (this.el.tabs) {
                this.el.tabs.querySelectorAll('.method-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
                        this.el.tabs.querySelectorAll('.method-tab').forEach(t => t.classList.remove('active'));
                        tab.classList.add('active');
                        this.selectedMethod = tab.dataset.method;
                        this.setStatus(`Vybraná ${tab.textContent.trim()}.`);
                        this.renderForCurrentState();
                    });
                });
            }
            if (this.el.periodTabs) {
                this.el.periodTabs.querySelectorAll('.method-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
                        this.el.periodTabs.querySelectorAll('.method-tab').forEach(t => t.classList.remove('active'));
                        tab.classList.add('active');
                        this.selectedPeriod = tab.dataset.period;
                        this.setStatus(`Režim: ${tab.textContent.trim()}.`);
                        this.renderForCurrentState();
                    });
                });
            }
            if (this.el.runBtn) {
                this.el.runBtn.addEventListener('click', () => this.runAnalysis());
            }
        },

        collectSelectedIds() {
            if (!this.el.cowSelector) return [];
            const inputs = this.el.cowSelector.querySelectorAll('input[type="checkbox"]');
            const ids = [];
            inputs.forEach(inp => {
                if (inp.checked) ids.push(inp.value);
            });
            return ids;
        },

        setStatus(message, isError = false) {
            if (!this.el.status) return;
            this.el.status.textContent = message;
            this.el.status.style.color = isError ? 'var(--danger)' : 'var(--muted)';
        },

        async runAnalysis() {
            const ids = this.collectSelectedIds();
            if (!ids.length) {
                this.setStatus('Zvolte alespoň jednu krávu.', true);
                return;
            }
            this.el.runBtn.disabled = true;
            this.setStatus('Načítám data a počítám clustery...');

            try {
                const { events } = await this.loadEvents(ids);
                this.allEvents = events;
                this.renderForCurrentState(ids.length);
            } catch (err) {
                console.error(err);
                this.setStatus('Chyba během analýzy.', true);
            } finally {
                this.el.runBtn.disabled = false;
            }
        },

        renderForCurrentState(selectedCowCount = null) {
            const idsCount = selectedCowCount ?? this.collectSelectedIds().length;
            if (!this.allEvents.length) {
                this.renderChart([]);
                this.renderTable([]);
                this.updateMetrics(0, 0, idsCount, 0);
                this.renderInterpretation([]);
                this.setStatus('Pro zvolenou kombinaci nebyly nalezeny žádné ko-lokace.', true);
                return;
            }

            const filteredEvents = this.filterByPeriod(this.allEvents, this.selectedPeriod);
            const uniqueDays = new Set(filteredEvents.map(e => e.dateCode)).size;

            if (!filteredEvents.length) {
                this.renderChart([]);
                this.renderTable([]);
                this.updateMetrics(0, 0, idsCount, uniqueDays);
                this.renderInterpretation([]);
                this.setStatus('Pro tento režim nejsou události.', true);
                return;
            }

            const points = filteredEvents.map(evt => ({
                id: `${evt.pair}_${evt.startEpoch}`,
                x: evt.durationSec / 60,
                y: evt.avgDistance,
                event: evt
            }));
            const normalized = normalizeFeatures(points);
            const result = this.applyMethod(normalized);

            this.lastPoints = result.points;
            this.lastEvents = filteredEvents;
            this.renderChart(result.points);
            this.renderTable(result.points);
            this.updateMetrics(filteredEvents.length, result.clusterCount, idsCount, uniqueDays);
            this.renderInterpretation(result.points);
            this.setStatus(`Hotovo: ${filteredEvents.length} událostí (${this.selectedPeriod}).`);
        },

        filterByPeriod(events, period) {
            if (period === 'all') return events;
            return events.filter(e => e.period === period);
        },

        async loadEvents(ids) {
            const grouped = {};
            this.manifest.files.forEach(file => {
                if (!isDateInRange(file.dateCode, ANALYSIS_RANGE)) return;
                if (!ids.includes(file.id)) return;
                if (!grouped[file.dateCode]) grouped[file.dateCode] = [];
                grouped[file.dateCode].push(file);
            });

            const events = [];
            const days = Object.keys(grouped);

            for (const dateCode of days) {
                const files = grouped[dateCode];
                const datasets = [];
                for (const entry of files) {
                    try {
                        await Proximity.loadDatasetScript(entry.filename);
                        const varName = `COW_${entry.id}_${entry.dateCode}`;
                        const raw = safeGetGlobal(varName);
                        if (!raw || !Array.isArray(raw)) continue;
                        const samples = Proximity.prepareSamples(raw);
                        if (!samples.length) continue;
                        datasets.push({
                            id: entry.id,
                            dateCode: entry.dateCode,
                            samples
                        });
                    } catch (err) {
                        console.warn('Dataset skip', entry.filename, err);
                    }
                }

                for (let i = 0; i < datasets.length; i++) {
                    for (let j = i + 1; j < datasets.length; j++) {
                        const pairEvents = buildPairEvents(datasets[i], datasets[j]);
                        events.push(...pairEvents);
                    }
                }
            }

            return { events, uniqueDays: days.length };
        },

        applyMethod(points) {
            if (!points.length) return { points: [], clusterCount: 0 };
            const method = this.selectedMethod;
            const enriched = points.map(p => ({ ...p }));
            let clusterCount = 0;

            if (method === 'kmeans') {
                const k = Math.max(2, Math.min(10, parseInt(this.el.paramK?.value || '4', 10) || 4));
                const { labels } = kmeansPlusPlus(points, k);
                clusterCount = new Set(labels).size;
                labels.forEach((label, idx) => {
                    enriched[idx].label = `Cluster ${label + 1}`;
                    enriched[idx].color = this.colors[label % this.colors.length];
                });
            } else if (method === 'isoforest') {
                const contamination = Math.min(Math.max(parseFloat(this.el.paramContamination?.value || '0.05'), 0.01), 0.3);
                const scores = runIsolationForest(points, contamination);
                const anomalies = scores.filter(s => s.isAnomaly).length;
                clusterCount = anomalies;
                scores.forEach((sc, idx) => {
                    enriched[idx].label = sc.isAnomaly ? 'Anomálie' : 'Normální';
                    enriched[idx].score = sc.score;
                    enriched[idx].color = sc.isAnomaly ? '#f87171' : '#34d399';
                });
            } else {
                const eps = Math.max(0.05, Math.min(5, parseFloat(this.el.paramEps?.value || '0.6')));
                const minPts = Math.max(2, Math.min(15, parseInt(this.el.paramMinPts?.value || '5', 10) || 5));
                const labels = runDbscan(points, eps, minPts);
                const clusters = new Set(labels.filter(l => l >= 0));
                clusterCount = clusters.size;
                labels.forEach((label, idx) => {
                    if (label >= 0) {
                        enriched[idx].label = `Cluster ${label + 1}`;
                        enriched[idx].color = this.colors[label % this.colors.length];
                    } else {
                        enriched[idx].label = 'Šum / Noise';
                        enriched[idx].color = '#94a3b8';
                    }
                });
            }

            return { points: enriched, clusterCount };
        },

        renderChart(points) {
            const ctx = this.el.chartCanvas;
            if (!ctx) return;
            if (this.chart) {
                this.chart.destroy();
            }
            const datasetsMap = new Map();
            points.forEach(p => {
                const key = p.label || 'Data';
                if (!datasetsMap.has(key)) {
                    datasetsMap.set(key, {
                        label: key,
                        data: [],
                        backgroundColor: p.color || '#38bdf8',
                        borderColor: p.color || '#38bdf8',
                        pointRadius: this.selectedMethod === 'isoforest' && p.label === 'Anomálie' ? 8 : 6,
                        pointStyle: this.selectedMethod === 'isoforest' && p.label === 'Anomálie' ? 'star' : 'circle'
                    });
                }
                datasetsMap.get(key).data.push({
                    x: p.x,
                    y: p.y,
                    label: p.event?.pair || '',
                    meta: p
                });
            });

            this.chart = new Chart(ctx, {
                type: 'scatter',
                data: {
                    datasets: Array.from(datasetsMap.values())
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { color: '#cbd5e1' }
                        },
                        tooltip: {
                            callbacks: {
                                label(context) {
                                    const meta = context.raw.meta;
                                    const duration = meta?.event ? RumburkAnalysisCore.formatDuration(meta.event.durationSec) : `${context.parsed.x.toFixed(2)} min`;
                                    return `${meta?.event?.pair || ''} | ${duration} | avg ${context.parsed.y.toFixed(2)} m`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            title: { display: true, text: 'Délka ko-lokace (minuty)', color: '#cbd5e1' },
                            ticks: { color: '#94a3b8' },
                            grid: { color: 'rgba(148,163,184,0.2)' }
                        },
                        y: {
                            title: { display: true, text: 'Průměrná vzdálenost (m)', color: '#cbd5e1' },
                            ticks: { color: '#94a3b8' },
                            grid: { color: 'rgba(148,163,184,0.2)' }
                        }
                    }
                }
            });
        },

        renderTable(points) {
            if (!this.el.tableBody) return;
            if (!points.length) {
                this.el.tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--muted);">Žádná data pro graf.</td></tr>`;
                return;
            }
            const rows = points
                .slice()
                .sort((a, b) => (b.event?.durationSec || 0) - (a.event?.durationSec || 0))
                .map(p => {
                    const evt = p.event;
                    const methodLabel = this.selectedMethod === 'kmeans' ? 'K-means++' : (this.selectedMethod === 'isoforest' ? 'Isolation Forest' : 'DBSCAN');
                    const scoreCol = this.selectedMethod === 'isoforest'
                        ? (p.score ? p.score.toFixed(3) : '0')
                        : (p.label || '-');
                    return `<tr>
                        <td>${methodLabel}</td>
                        <td>${evt?.pair || '-'}</td>
                        <td>${formatDateCode(evt?.dateCode || '')}</td>
                        <td>${evt ? `${evt.startClock} - ${evt.endClock}` : '-'}</td>
                        <td>${evt ? RumburkAnalysisCore.formatDuration(evt.durationSec) : '-'}</td>
                        <td>${evt ? evt.avgDistance.toFixed(2) + ' m' : '-'}</td>
                        <td><span style="color:${p.color || '#38bdf8'};">${scoreCol}</span></td>
                    </tr>`;
                }).join('');
            this.el.tableBody.innerHTML = rows;
        },

        updateMetrics(events, clusters, cows, days) {
            if (this.el.metricEvents) this.el.metricEvents.textContent = events.toString();
            if (this.el.metricClusters) this.el.metricClusters.textContent = clusters.toString();
            if (this.el.metricCows) this.el.metricCows.textContent = cows.toString();
            if (this.el.metricDays) this.el.metricDays.textContent = days.toString();
        },

        renderInterpretation(points) {
            if (!this.el.interpretation) return;
            if (!points.length) {
                this.el.interpretation.textContent = 'Žádná interpretace – není co zobrazit.';
                return;
            }
            const method = this.selectedMethod;
            let lines = [];

            if (method === 'kmeans') {
                const byCluster = new Map();
                points.forEach(p => {
                    const key = p.label || 'Cluster';
                    if (!byCluster.has(key)) byCluster.set(key, []);
                    byCluster.get(key).push(p);
                });
                const sorted = Array.from(byCluster.entries()).sort((a, b) => b[1].length - a[1].length);
                lines.push(`K-means++ našel ${sorted.length} clusterů. Velké clustery = stabilní dvojice/ skupiny, malé mohou být výjimky.`);
                sorted.slice(0, 3).forEach(([name, arr], idx) => {
                    const avgDur = arr.reduce((a, p) => a + (p.event?.durationSec || 0), 0) / Math.max(arr.length, 1);
                    lines.push(`${idx + 1}. ${name}: ${arr.length} událostí, průměrná délka ${RumburkAnalysisCore.formatDuration(avgDur)}.`);
                });
            } else if (method === 'isoforest') {
                const anomalies = points.filter(p => p.label === 'Anomálie');
                lines.push(`Isolation Forest označil ${anomalies.length} anomálií z ${points.length} událostí. Větší skóre = výraznější odchylka.`);
                anomalies.slice(0, 3).forEach((p, idx) => {
                    const evt = p.event;
                    lines.push(`${idx + 1}. ${evt.pair} ${formatDateCode(evt.dateCode)} ${evt.startClock} (${p.score?.toFixed(3) || '0'})`);
                });
            } else {
                const byCluster = new Map();
                let noiseCount = 0;
                points.forEach(p => {
                    if (p.label && p.label.includes('Cluster')) {
                        if (!byCluster.has(p.label)) byCluster.set(p.label, []);
                        byCluster.get(p.label).push(p);
                    } else {
                        noiseCount++;
                    }
                });
                const clusters = Array.from(byCluster.entries()).sort((a, b) => b[1].length - a[1].length);
                lines.push(`DBSCAN: ${clusters.length} hustotních clusterů, šum: ${noiseCount} událostí.`);
                clusters.slice(0, 3).forEach(([name, arr], idx) => {
                    const avgDist = arr.reduce((a, p) => a + (p.event?.avgDistance || 0), 0) / Math.max(arr.length, 1);
                    lines.push(`${idx + 1}. ${name}: ${arr.length} událostí, prům. vzdálenost ${avgDist.toFixed(2)} m.`);
                });
            }

            this.el.interpretation.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        Proximity.init();
        Proximity.bindFullscreenEvents();
        ClusteringDashboard.init();
    });
})();

/**
 * Rumburk Renderer - Complete Architecture
 * ================================================
 *
 * Version: 2.0.0 - Complete Implementation Skeleton
(function setupSshrLogFilter() {
  if (window.SSHR_LOG_FILTER_SETUP) {
    return;
  }
  window.SSHR_LOG_FILTER_SETUP = true;

  const start = Date.now();
  const limit = window.SSHR_DEBUG_DURATION || 10000;
  const noisyTags = ['[INCIDENT', '[PERSON-TRACKER]', '[WIDGET', '[ANCHOR', '[PARALLEL-TRACKING]', '[MQTT'];
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);

  const shouldEmit = (args) => {
    if (!args || !args.length) return true;
    const first = args[0];
    if (typeof first !== 'string') return true;
    if (!noisyTags.some(tag => first.includes(tag))) return true;
    return Date.now() - start <= limit;
  };

  console.log = function(...args) {
    if (shouldEmit(args)) {
      originalLog(...args);
    }
  };

  console.warn = function(...args) {
    if (shouldEmit(args)) {
      originalWarn(...args);
    }
  };
})();

 * Focus: Parallel Mode Person Tracking with Full Feature Set
 *
 * Dependencies:
 * - Leaflet 1.9.4 (map rendering)
 * - Turf.js 6.5.0 (geometric calculations)
 * - Anime.js 3.2.1 (animations)
 * - Bootstrap 5.3.7 (UI framework)
 * - Moment.js (time formatting)
 * - Lodash (utilities)
 *
 * Architecture:
 * 1. Global Configuration & Constants
 * 2. Core Map Management
 * 3. Zone Management System
 * 4. Person Tracking Core
 * 5. Visitor Card System
 * 6. Incident Detection & Logging
 * 7. Widget Management
 * 8. Event System
 * 9. Animation & Visual Effects
 * 10. Data Management
 */

console.log("🚀 [SSHR-RENDERER] Loading Rumburk cattle renderer v2.0.0...");

// ============================================================================
// 1. GLOBAL CONFIGURATION & CONSTANTS
// ============================================================================

const SSHR_CONFIG = window.SSHR_CONFIG || {
  map: {
    center: [50.95087526458519, 14.569026145132602],
    zoom: 19,
    minZoom: 17,
    maxZoom: 23
  },
  limits: {
    maxPersons: 50,
    maxCards: 20
  },
  timings: {
    updateInterval: 1000,
    animationSpeed: 800
  },
  polygonMode: "FIXED",
  version: "2.0.0"
};

// Barvy pro jednotlivé krávy (z CATTLE_INFO)
const CATTLE_COLORS = {
  '1759595': '#FF6B6B',  // červená
  '227831': '#4ECDC4',   // tyrkysová
  '166691': '#45B7D1',   // modrá
  default: '#8B4513',    // hnědá (sedlová)
  selected: '#28a745',   // zelená (vybraná)
  violation: '#b71c1c',  // červená (narušení zóny)
  warning: '#f59e0b',    // oranžová (varování)
  inactive: '#6c757d'    // šedá (neaktivní)
};

// Aliasy pro zpětnou kompatibilitu
const PERSON_COLORS = CATTLE_COLORS;

function calculateMovementAngle(oldLat, oldLng, newLat, newLng) {
  if (
    !Number.isFinite(oldLat) || !Number.isFinite(oldLng) ||
    !Number.isFinite(newLat) || !Number.isFinite(newLng)
  ) {
    return 0;
  }

  const dLat = newLat - oldLat;
  const dLng = newLng - oldLng;

  if (Math.abs(dLat) < 0.0000001 && Math.abs(dLng) < 0.0000001) {
    return 0;
  }

  const avgLat = ((oldLat ?? 0) + (newLat ?? 0)) / 2;
  const latMeters = dLat * 111320;
  const lngMeters = dLng * (111320 * Math.cos(avgLat * Math.PI / 180));
  const distance = Math.sqrt(latMeters * latMeters + lngMeters * lngMeters);
  if (distance < 0.5) {
    return 0;
  }

  if (Math.abs(latMeters) < 0.001) {
    return lngMeters > 0 ? 90 : 270;
  }

  if (Math.abs(lngMeters) < 0.001) {
    return latMeters > 0 ? 0 : 180;
  }

  let angle = Math.atan2(lngMeters, latMeters) * (180 / Math.PI);
  if (angle < 0) angle += 360;

  return angle;
}

function calculateParallelMarkerAngle(oldLat, oldLng, newLat, newLng) {
  if (
    !Number.isFinite(oldLat) || !Number.isFinite(oldLng) ||
    !Number.isFinite(newLat) || !Number.isFinite(newLng)
  ) {
    return 0;
  }

  const dLat = newLat - oldLat;
  const dLng = newLng - oldLng;

  if (Math.abs(dLat) < 0.0000001 && Math.abs(dLng) < 0.0000001) {
    return 0;
  }

  const avgLat = ((oldLat ?? 0) + (newLat ?? 0)) / 2;
  const latMeters = dLat * 111320;
  const lngMeters = dLng * (111320 * Math.cos(avgLat * Math.PI / 180));
  const distance = Math.sqrt(latMeters * latMeters + lngMeters * lngMeters);

  if (distance < 0.5) {
    return 0;
  }

  // Podobně jako v CEPRO - preferuj kolmý směr k pohybu
  const absLat = Math.abs(latMeters);
  const absLng = Math.abs(lngMeters);

  if (absLng > absLat * 1.2) {
    // Dominantní pohyb East-West → hlava vždy na sever (0°)
    return 0;
  }

  if (absLat > absLng * 1.2) {
    // Dominantní pohyb North-South → hlava nakloněna o 15° směrem na východ
    return 15;
  }

  // Diagonální / nejasný pohyb → použij standardní směr
  return 0;
}

/**
 * Získá ikonu markeru pro krávu
 * @param {string} colorOrCowId - Barva nebo ID krávy
 * @param {number} rotation - Rotace ikony ve stupních
 * @returns {L.DivIcon} Leaflet div icon
 */
function getCattleMarkerIcon(colorOrCowId = CATTLE_COLORS.default, rotation = 0) {
  // Pokud je předáno ID krávy, použij její barvu
  const color = CATTLE_COLORS[colorOrCowId] || colorOrCowId || CATTLE_COLORS.default;

  return L.divIcon({
    html: `<div class="cattle-marker-icon" style="transform: rotate(${rotation}deg); transition: transform 0.3s ease;">
             <i class="fa-solid fa-cow cattle-marker-glyph" style="font-size:28px; color:${color}; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));"></i>
           </div>`,
    className: 'custom-marker-icon cattle-icon',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}

// Alias pro zpětnou kompatibilitu
function getPersonMarkerIcon(color = CATTLE_COLORS.default, rotation = 0) {
  return getCattleMarkerIcon(color, rotation);
}

if (typeof window !== 'undefined') {
  window.CATTLE_COLORS = CATTLE_COLORS;
  window.SSHR_PERSON_COLORS = CATTLE_COLORS; // zpětná kompatibilita
  window.sshrCalculateParallelMarkerAngle = calculateParallelMarkerAngle;
  window.getCattleMarkerIcon = getCattleMarkerIcon;
  window.sshrGetPersonMarkerIcon = getPersonMarkerIcon; // zpětná kompatibilita
}

const ZONE_STYLES = {
  red: {
    color: '#dc3545',
    fillColor: '#dc3545',
    fillOpacity: 0.2,
    weight: 2
  },
  green: {
    color: '#28a745',
    fillColor: '#28a745',
    fillOpacity: 0.2,
    weight: 2
  },
  highlight: {
    fillOpacity: 0.4,
    weight: 3,
    dashArray: '5, 5'
  }
};

const ANIMATION_DURATIONS = {
  markerMove: 800,
  markerBounce: 600,
  zoneHighlight: 1000,
  widgetUpdate: 400,
  cardFlip: 300,
  notification: 2000
};

const INCIDENT_TYPES = {
  ZONE_VIOLATION: 'zone_violation',
  UNAUTHORIZED_ACCESS: 'unauthorized_access',
  CARD_MISMATCH: 'card_mismatch',
  SYSTEM_ERROR: 'system_error'
};

// Global state containers
window.sshrPersons = new Map();
window.sshrCards = new Map();
window.sshrIncidents = [];
window.sshrZones = null;
window.sshrMap = null;
window.sshrLayers = new Map();

// ============================================================================
// 2. CORE MAP MANAGEMENT FUNCTIONS
// ============================================================================

/**
 * Initialize the main SSHR map with all base layers
 */
function initSSHRMap() {
  console.log("🗺️ [SSHR-MAP] Initializing map for SSHR Bohuslavice...");

  const map = L.map('leafletMap', {
    center: SSHR_CONFIG.map?.center || [50.95087526458519, 14.569026145132602],
    zoom: SSHR_CONFIG.map?.zoom ?? 18,
    minZoom: SSHR_CONFIG.map?.minZoom ?? 15,
    maxZoom: SSHR_CONFIG.map?.maxZoom ?? 22,
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true, // Better performance for many markers

    // ✨ Jemnější zoom kroky po 0.1
    zoomSnap: 0.1,        // Snap k hodnotám po 0.1 (15.1, 15.2, atd.)
    zoomDelta: 0.1,       // Krok při použití +/- tlačítek
    wheelPxPerZoomLevel: 120, // Citlivost scroll wheel (vyšší = jemnější)
    wheelDebounceTime: 60     // Debounce pro smooth scrolling
  });

  // Global references
  window.leafletMap = map;
  window.sshrMap = map;

  setupMapLayers(map);
  addMapControls(map);
  setupMapEvents(map);

  console.log("✅ [SSHR-MAP] Map initialized successfully");
  return map;
}

/**
 * Setup all map layers (base, overlays, etc.)
 */
function setupMapLayers(map) {
  console.log("🎨 [SSHR-LAYERS] Setting up map layers...");

  // ESRI World Imagery base layer
  const esriLayer = L.tileLayer(
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 23,
      maxNativeZoom: 19,
      tileSize: 256,
      detectRetina: true,
      noWrap: true,
      attribution: '© Esri, Maxar, Earthstar Geographics'
    }
  );

  esriLayer.addTo(map);

  // Initialize layer groups
  window.sshrLayers.set('zones', L.layerGroup().addTo(map));
  window.sshrLayers.set('anchors', L.layerGroup().addTo(map));
  window.sshrLayers.set('corona', L.layerGroup().addTo(map)); // PERMANENT corona layer
  window.sshrLayers.set('persons', L.layerGroup().addTo(map));
  window.sshrLayers.set('effects', L.layerGroup().addTo(map));
  window.sshrLayers.set('polygons', L.layerGroup().addTo(map));
  window.sshrLayers.set('trajectories', L.layerGroup());
  window.sshrLayers.set('trajectory-markers', L.layerGroup());
  window.sshrLayers.set('personal-grouping', L.layerGroup());

  console.log("✅ [SSHR-LAYERS] Layer groups created");
}

/**
 * Add custom map controls
 */
function addMapControls(map) {
  // TODO: Implement custom controls
  // - Fullscreen control
  // - Layer toggle control
  // - Export control
  // - Reset view control
  console.log("🎛️ [SSHR-CONTROLS] Custom controls will be added here");
}

/**
 * Setup all map event listeners
 */
function setupMapEvents(map) {
  map.on('click', onMapClick);
  map.on('dragover', onMapDragOver);
  map.on('drop', onMapDrop);
  map.on('zoomend', onMapZoom);
  map.on('moveend', onMapMove);

  console.log("📡 [SSHR-EVENTS] Map events initialized");
}

// ============================================================================
// TRAJECTORY LAYER MANAGER
// ============================================================================

const TRAJECTORY_WAVE_FORMATTER = new Intl.DateTimeFormat('cs-CZ', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

class SSHRTrajectoryLayerManager {
  constructor(map) {
    this.map = map;
    this.lineLayer = window.sshrLayers.get('trajectories') || L.layerGroup();
    this.markerLayer = window.sshrLayers.get('trajectory-markers') || L.layerGroup();
    this.personFeatures = new Map();
    this.personColors = new Map();
    this.datasetByPerson = new Map();
    this.personByDataset = new Map();
    this.currentStyle = 'solid';
    this.visible = false;
    this.tracker = getActivePersonTracker();
    this.autoRefreshMs = 1500;
    this.refreshInterval = null;

    if (!window.sshrLayers.get('trajectories')) {
      window.sshrLayers.set('trajectories', this.lineLayer);
    }
    if (!window.sshrLayers.get('trajectory-markers')) {
      window.sshrLayers.set('trajectory-markers', this.markerLayer);
    }

    this.bindEvents();
  }

  bindEvents() {
    window.addEventListener('sshr-person-added', (event) => this.handlePersonAdded(event?.detail?.person));
    window.addEventListener('sshr-person-updated', (event) => this.handlePersonUpdated(event?.detail?.person));
    window.addEventListener('sshr-person-removed', (event) => this.handlePersonRemoved(event?.detail?.personId));
    window.addEventListener('sshr-session-stop', () => this.reset());
    window.addEventListener('sshr-tracks-finished', (event) => {
      const datasets = event?.detail?.datasets || [];
      this.handleTracksFinished(datasets);
    });
    window.addEventListener('sshr-person-tracker-ready', (event) => {
      const tracker = event?.detail?.tracker || null;
      this.setTracker(tracker);
    });
  }

  setTracker(tracker) {
    if (!tracker || this.tracker === tracker) {
      this.tracker = tracker || this.tracker;
      return;
    }

    this.tracker = tracker;
    if (typeof tracker.getAllPersons === 'function') {
      try {
        tracker.getAllPersons().forEach(person => this.handlePersonAdded(person));
      } catch (error) {
        console.warn('⚠️ [TRAJECTORY-LAYERS] Failed to seed persons from tracker:', error);
      }
    }
  }

  showLayer(style = this.currentStyle) {
    if (style) {
      this.setLineStyle(style);
    }
    this.visible = true;
    this.ensureLayersAttached();
    this.seedExistingPersons();
    this.personFeatures.forEach((_, personId) => this.refreshTrajectory(personId));
    this.startAutoRefresh();
  }

  hideLayer() {
    this.visible = false;
    if (this.map?.hasLayer(this.lineLayer)) {
      this.map.removeLayer(this.lineLayer);
    }
    if (this.map?.hasLayer(this.markerLayer)) {
      this.map.removeLayer(this.markerLayer);
    }
    this.stopAutoRefresh();
  }

  setLineStyle(style) {
    if (!style || style === this.currentStyle) return;
    this.currentStyle = style;
    this.personFeatures.forEach(feature => {
      feature.polyline?.setStyle(this.buildLineStyle(feature.color));
    });
  }

  handlePersonAdded(person) {
    if (!person || !person.id) return;
    const dataset = person.datasetName || person.metadata?.dataset || null;
    if (dataset) {
      this.datasetByPerson.set(person.id, dataset);
      this.personByDataset.set(dataset, person.id);
    }
    if (person.color) {
      this.personColors.set(person.id, person.color);
    }
    this.refreshTrajectory(person.id);
  }

  handlePersonUpdated(person) {
    if (!person || !person.id) return;
    const dataset = person.datasetName || person.metadata?.dataset || null;
    if (dataset) {
      this.datasetByPerson.set(person.id, dataset);
      this.personByDataset.set(dataset, person.id);
    }
    if (person.color) {
      this.personColors.set(person.id, person.color);
    }
    this.refreshTrajectory(person.id);
  }

  handlePersonRemoved(personId) {
    if (!personId) return;
    const feature = this.personFeatures.get(personId);
    if (feature) {
      if (feature.polyline && this.lineLayer.hasLayer(feature.polyline)) {
        this.lineLayer.removeLayer(feature.polyline);
      }
      if (feature.startMarker && this.markerLayer.hasLayer(feature.startMarker)) {
        this.markerLayer.removeLayer(feature.startMarker);
      }
      if (feature.startLabel && this.markerLayer.hasLayer(feature.startLabel)) {
        this.markerLayer.removeLayer(feature.startLabel);
      }
      if (feature.endMarker && this.markerLayer.hasLayer(feature.endMarker)) {
        this.markerLayer.removeLayer(feature.endMarker);
      }
      if (feature.endLabel && this.markerLayer.hasLayer(feature.endLabel)) {
        this.markerLayer.removeLayer(feature.endLabel);
      }
    }
    this.personFeatures.delete(personId);
    const dataset = this.datasetByPerson.get(personId);
    if (dataset) {
      this.personByDataset.delete(dataset);
    }
    this.datasetByPerson.delete(personId);
    this.personColors.delete(personId);
  }

  handleTracksFinished(datasets) {
    if (!Array.isArray(datasets) || !datasets.length) return;
    datasets.forEach(datasetName => {
      const personId = this.personByDataset.get(datasetName) || this.findPersonByDataset(datasetName);
      if (!personId) return;
      const feature = this.getOrCreateFeature(personId);
      feature.completed = true;
      this.refreshTrajectory(personId);
    });
  }

  findPersonByDataset(datasetName) {
    for (const [personId, dataset] of this.datasetByPerson.entries()) {
      if (dataset === datasetName) {
        this.personByDataset.set(datasetName, personId);
        return personId;
      }
    }
    return null;
  }

  refreshTrajectory(personId) {
    const tracker = this.tracker || getActivePersonTracker();
    if (!this.tracker && tracker) {
      this.tracker = tracker;
    }
    if (!tracker || typeof tracker.getTrajectoryPoints !== 'function') {
      return;
    }

    const points = tracker.getTrajectoryPoints(personId);
    if (!points || !points.length) {
      return;
    }

    const color = this.personColors.get(personId) || '#38bdf8';
    const feature = this.getOrCreateFeature(personId, color);

    const latLngs = points.map(sample => [sample.lat, sample.lng]);
    feature.polyline.setLatLngs(latLngs);
    feature.polyline.setStyle(this.buildLineStyle(feature.color));

    this.ensureStartArtifacts(feature, points[0]);

    if (feature.completed) {
      this.ensureEndArtifacts(feature, points[points.length - 1]);
    } else {
      this.clearEndArtifacts(feature);
    }

    if (this.visible) {
      this.ensureLayersAttached();
    }
  }

  ensureStartArtifacts(feature, firstSample) {
    if (!firstSample) return;
    const latLng = [firstSample.lat, firstSample.lng];

    if (!feature.startMarker) {
      feature.startMarker = this.createEndpointMarker(latLng, feature.color);
      this.markerLayer.addLayer(feature.startMarker);
    } else {
      feature.startMarker.setLatLng(latLng);
    }

    const startLabelTime = this.normaliseTimestampValue(firstSample.timestamp);
    const startLabelText = TRAJECTORY_WAVE_FORMATTER.format(startLabelTime);
    if (!feature.startLabel) {
      feature.startLabel = this.createLabelMarker(latLng, startLabelText);
      this.markerLayer.addLayer(feature.startLabel);
    } else {
      feature.startLabel.setLatLng(latLng);
      feature.startLabel.setIcon(this.createLabelIcon(startLabelText));
    }
  }

  ensureEndArtifacts(feature, lastSample) {
    if (!lastSample) return;
    const latLng = [lastSample.lat, lastSample.lng];

    if (!feature.endMarker) {
      feature.endMarker = this.createEndpointMarker(latLng, feature.color);
      feature.endMarker.setStyle({ fillColor: '#111', fillOpacity: 0.95 });
      this.markerLayer.addLayer(feature.endMarker);
    } else {
      feature.endMarker.setLatLng(latLng);
    }

    const endLabelTime = this.normaliseTimestampValue(lastSample.timestamp);
    const endLabelText = TRAJECTORY_WAVE_FORMATTER.format(endLabelTime);
    if (!feature.endLabel) {
      feature.endLabel = this.createLabelMarker(latLng, endLabelText);
      this.markerLayer.addLayer(feature.endLabel);
    } else {
      feature.endLabel.setLatLng(latLng);
      feature.endLabel.setIcon(this.createLabelIcon(endLabelText));
    }
  }

  clearEndArtifacts(feature) {
    if (feature.endMarker && this.markerLayer.hasLayer(feature.endMarker)) {
      this.markerLayer.removeLayer(feature.endMarker);
    }
    if (feature.endLabel && this.markerLayer.hasLayer(feature.endLabel)) {
      this.markerLayer.removeLayer(feature.endLabel);
    }
    feature.endMarker = null;
    feature.endLabel = null;
  }

  createEndpointMarker(latLng, color) {
    return L.circleMarker(latLng, {
      radius: 6,
      color,
      weight: 2,
      fillColor: '#0f172a',
      fillOpacity: 0.9,
      opacity: 0.9,
      interactive: false
    });
  }

  createLabelMarker(latLng, text) {
    return L.marker(latLng, {
      interactive: false,
      icon: this.createLabelIcon(text)
    });
  }

  createLabelIcon(text) {
    return L.divIcon({
      className: 'trajectory-label-wrapper',
      html: `<div class="trajectory-label">${text}</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0]
    });
  }

  getOrCreateFeature(personId, color) {
    if (this.personFeatures.has(personId)) {
      const existing = this.personFeatures.get(personId);
      if (color && existing.color !== color) {
        existing.color = color;
        existing.polyline.setStyle(this.buildLineStyle(color));
      }
      return existing;
    }

    const featureColor = color || '#38bdf8';
    const polyline = L.polyline([], this.buildLineStyle(featureColor));
    this.lineLayer.addLayer(polyline);

    const feature = {
      polyline,
      startMarker: null,
      startLabel: null,
      endMarker: null,
      endLabel: null,
      color: featureColor,
      completed: false
    };

    this.personFeatures.set(personId, feature);
    return feature;
  }

  buildLineStyle(color) {
    const dashArray = this.currentStyle === 'dashed' ? '10 6' : null;
    return {
      color,
      weight: 2.5,
      opacity: 0.85,
      dashArray,
      lineCap: 'round',
      lineJoin: 'round'
    };
  }

  ensureLayersAttached() {
    if (!this.map) return;
    if (this.lineLayer && !this.map.hasLayer(this.lineLayer)) {
      this.lineLayer.addTo(this.map);
    }
    if (this.markerLayer && !this.map.hasLayer(this.markerLayer)) {
      this.markerLayer.addTo(this.map);
    }
  }

  reset() {
    Array.from(this.personFeatures.keys()).forEach(personId => this.handlePersonRemoved(personId));
    this.personFeatures.clear();
    this.personColors.clear();
    this.datasetByPerson.clear();
    this.personByDataset.clear();
    if (this.lineLayer?.clearLayers) {
      this.lineLayer.clearLayers();
    }
    if (this.markerLayer?.clearLayers) {
      this.markerLayer.clearLayers();
    }
    this.stopAutoRefresh();
  }

  seedExistingPersons() {
    const tracker = this.tracker || getActivePersonTracker();
    if (tracker?.getAllPersons) {
      try {
        tracker.getAllPersons().forEach(person => this.handlePersonAdded(person));
      } catch (error) {
        console.warn('⚠️ [TRAJECTORY-LAYERS] Failed to seed existing persons:', error);
      }
    }
  }

  normaliseTimestampValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    if (value) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return new Date();
  }

  startAutoRefresh() {
    if (this.refreshInterval || typeof window === 'undefined') {
      return;
    }
    this.refreshInterval = window.setInterval(() => {
      if (!this.visible) {
        return;
      }
      this.personFeatures.forEach((_, personId) => this.refreshTrajectory(personId));
    }, this.autoRefreshMs);
  }

  stopAutoRefresh() {
    if (this.refreshInterval && typeof window !== 'undefined') {
      window.clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}

function initSSHRTrajectoryLayerManager(map) {
  if (!map) {
    console.warn('⚠️ [TRAJECTORY-LAYERS] Map not ready - skipping trajectory manager init');
    return null;
  }

  if (window.SSHR?.trajectoryLayerManager) {
    return window.SSHR.trajectoryLayerManager;
  }

  const manager = new SSHRTrajectoryLayerManager(map);
  window.SSHR = window.SSHR || {};
  window.SSHR.trajectoryLayerManager = manager;
  return manager;
}

// ============================================================================
// PERSONAL GROUPING LAYER
// ============================================================================

const GROUPING_DATE_FORMATTER = new Intl.DateTimeFormat('cs-CZ', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit'
});
const GROUPING_TIME_FORMATTER = new Intl.DateTimeFormat('cs-CZ', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

class SSHRPersonalGroupingLayer {
  constructor(map) {
    this.map = map;
    this.layerGroup = window.sshrLayers.get('personal-grouping') || L.layerGroup();
    if (!window.sshrLayers.get('personal-grouping')) {
      window.sshrLayers.set('personal-grouping', this.layerGroup);
    }
    this.markers = new Map();
    this.visible = false;
    this.bindEvents();
  }

  bindEvents() {
    window.addEventListener('sshr-close-contact-started', (event) => this.handleStart(event?.detail));
    window.addEventListener('sshr-close-contact-updated', (event) => this.handleUpdate(event?.detail));
    window.addEventListener('sshr-close-contact-ended', (event) => this.handleEnd(event?.detail));
    window.addEventListener('sshr-session-stop', () => this.reset());
  }

  setVisible(active) {
    this.visible = Boolean(active);
    if (this.visible) {
      this.ensureLayerVisible();
    } else if (this.map?.hasLayer(this.layerGroup)) {
      this.map.removeLayer(this.layerGroup);
    }
  }

  ensureLayerVisible() {
    if (this.map && !this.map.hasLayer(this.layerGroup)) {
      this.layerGroup.addTo(this.map);
    }
  }

  handleStart(detail) {
    if (!detail?.id || !detail.centroid) {
      return;
    }
    this.upsertMarker(detail);
    if (this.visible) {
      this.ensureLayerVisible();
    }
  }

  handleUpdate(detail) {
    if (!detail?.id) return;
    this.upsertMarker(detail);
  }

  handleEnd(detail) {
    if (!detail?.id) return;
    const entry = this.markers.get(detail.id);
    if (entry?.marker) {
      if (this.layerGroup.hasLayer(entry.marker)) {
        this.layerGroup.removeLayer(entry.marker);
      }
      entry.marker.off();
    }
    this.markers.delete(detail.id);
  }

  upsertMarker(detail) {
    let entry = this.markers.get(detail.id);
    if (!entry) {
      const marker = this.createMarker(detail);
      this.layerGroup.addLayer(marker);
      entry = { marker };
      this.markers.set(detail.id, entry);
    }

    this.updateMarker(entry.marker, detail);
    entry.detail = detail;
    return entry;
  }

  createMarker(detail) {
    const marker = L.circleMarker([detail.centroid.lat, detail.centroid.lng], {
      radius: 7.5,
      color: '#f87171',
      fillColor: '#f87171',
      fillOpacity: 0.35,
      weight: 2,
      opacity: 0.9,
      interactive: true,
      className: 'personal-grouping-marker'
    });

    marker.on('mouseover', () => marker.openTooltip());
    marker.on('mouseout', () => marker.closeTooltip());
    return marker;
  }

  updateMarker(marker, detail) {
    if (!marker || !detail?.centroid) return;
    marker.setLatLng([detail.centroid.lat, detail.centroid.lng]);

    const html = this.buildTooltipHtml(detail);
    const tooltip = marker.getTooltip();
    if (tooltip) {
      tooltip.setContent(html);
    } else {
      marker.bindTooltip(html, {
        direction: 'top',
        offset: [0, -12],
        opacity: 1,
        className: 'personal-grouping-tooltip'
      });
    }
  }

  buildTooltipHtml(detail) {
    const startedAt = detail.startedAt instanceof Date ? detail.startedAt : new Date(detail.startedAt);
    const lastUpdate = detail.lastUpdate instanceof Date ? detail.lastUpdate : new Date(detail.lastUpdate || startedAt);
    const dateLine = GROUPING_DATE_FORMATTER.format(startedAt);
    const timeLine = GROUPING_TIME_FORMATTER.format(lastUpdate);
    const participants = detail.participants || [];
    const osobaX = participants[0]?.label || participants[0]?.dataset || `Osoba ${participants[0]?.id || 'X'}`;
    const osobaY = participants[1]?.label || participants[1]?.dataset || (participants[1] ? `Osoba ${participants[1].id}` : '---');
    const duration = Math.max(5, Math.round(detail.durationSeconds || 0));

    const extraParticipants = participants.length > 2
      ? `<div class="tooltip-line">+ další ${participants.length - 2}</div>`
      : '';

    return [
      `<div class="tooltip-line tooltip-date">Datum: ${dateLine}</div>`,
      `<div class="tooltip-line tooltip-time">Čas: ${timeLine}</div>`,
      `<div class="tooltip-line">Osoba X: ${osobaX}</div>`,
      `<div class="tooltip-line">Osoba Y: ${osobaY}</div>`,
      extraParticipants,
      `<div class="tooltip-line tooltip-duration">Doba: ${duration}&nbsp;s</div>`
    ].join('');
  }

  reset() {
    for (const entry of this.markers.values()) {
      if (entry.marker && this.layerGroup.hasLayer(entry.marker)) {
        this.layerGroup.removeLayer(entry.marker);
      }
      entry.marker?.off();
    }
    this.markers.clear();
    if (this.layerGroup?.clearLayers) {
      this.layerGroup.clearLayers();
    }
  }
}

function initSSHRPersonalGroupingLayer(map) {
  if (!map) {
    console.warn('⚠️ [PERSONAL-GROUPING] Map not ready - skipping manager init');
    return null;
  }

  if (window.SSHR?.personalGroupingLayer) {
    return window.SSHR.personalGroupingLayer;
  }

  const layer = new SSHRPersonalGroupingLayer(map);
  window.SSHR = window.SSHR || {};
  window.SSHR.personalGroupingLayer = layer;
  return layer;
}

// === MAP UTILITIES ===

function resizeMap() {
  if (window.sshrMap) {
    window.sshrMap.invalidateSize();
  }
}

function invalidateMapSize() {
  setTimeout(() => {
    if (window.sshrMap) {
      window.sshrMap.invalidateSize();
    }
  }, 100);
}

function setMapBounds(bounds) {
  if (window.sshrMap && bounds) {
    window.sshrMap.fitBounds(bounds);
  }
}

function fitMapToFeatures() {
  // TODO: Calculate bounds of all active features and fit map
  console.log("🎯 [MAP-BOUNDS] Fitting map to all features");
}

function centerMapOnPerson(personId) {
  const person = window.sshrPersons.get(personId);
  if (person && window.sshrMap) {
    window.sshrMap.setView([person.lat, person.lng], 20);
    animateMarkerBounce(person.markerId);
  }
}

function getMapCenter() {
  return window.sshrMap ? window.sshrMap.getCenter() : null;
}

function getMapZoom() {
  return window.sshrMap ? window.sshrMap.getZoom() : null;
}

// === LAYER MANAGEMENT ===

function addLayerGroup(name, layer) {
  if (window.sshrLayers) {
    window.sshrLayers.set(name, layer);
    if (window.sshrMap) {
      layer.addTo(window.sshrMap);
    }
  }
}

function removeLayerGroup(name) {
  const layer = window.sshrLayers.get(name);
  if (layer && window.sshrMap) {
    window.sshrMap.removeLayer(layer);
    window.sshrLayers.delete(name);
  }
}

function toggleLayerVisibility(name, visible) {
  const layer = window.sshrLayers.get(name);
  if (layer && window.sshrMap) {
    if (visible) {
      layer.addTo(window.sshrMap);
    } else {
      window.sshrMap.removeLayer(layer);
    }
  }
}

function clearAllLayers() {
  window.sshrLayers.forEach((layer, name) => {
    if (name !== 'zones') { // Keep zones always visible
      layer.clearLayers();
    }
  });
}

function refreshLayers() {
  window.sshrLayers.forEach(layer => {
    layer.redraw && layer.redraw();
  });
}

// ============================================================================
// 3. ZONE MANAGEMENT SYSTEM
// ============================================================================

/**
 * Zone definitions for SSHR Bohuslavice
 */
// === ZONE RENDERING ===

function renderSSHRZones(map) {
  console.log("🎨 [SSHR-ZONES] Rendering zone polygons...");

  const zoneLayer = window.sshrLayers.get('zones');
  const zoneData = window.SSHR_ZONES;
  if (!zoneLayer || !zoneData) return;

  const activeLayout = window.SSHR?.activeLayout || null;
  if (zoneLayer) {
    zoneLayer.options = zoneLayer.options || {};
    zoneLayer.options.layoutId = activeLayout?.id || null;
  }
  if (activeLayout) {
    console.log('🧭 [SSHR-ZONES] Active layout', {
      id: activeLayout.id,
      mode: activeLayout.mode,
      confirmedAt: activeLayout.confirmedAt
    });
  }

  // Clear existing zones
  zoneLayer.clearLayers();

  // Render RED zones (restricted areas)
  if (Array.isArray(zoneData.reds) && zoneData.reds.length) {
    zoneData.reds.forEach((redZoneDef) => {
      const redPolygon = L.polygon(redZoneDef.coordinates, {
        ...ZONE_STYLES.red,
        zoneName: redZoneDef.name,
        zoneType: 'red'
      }).addTo(zoneLayer);
      redPolygon.bindPopup(`<b>${redZoneDef.name}</b><br>Zakázaná zóna`);
    });
  } else if (zoneData.fence?.coordinates) {
    // Fallback: visualize fence interior as single red polygon without holes
    const fallbackRed = L.polygon(zoneData.fence.coordinates, {
      ...ZONE_STYLES.red,
      zoneName: zoneData.fence.name || 'Restricted Zone',
      zoneType: 'red'
    }).addTo(zoneLayer);
    fallbackRed.bindPopup(`<b>${zoneData.fence.name || 'Restricted Zone'}</b>`);
  }

  // Render GREEN zones (allowed areas)
  if (Array.isArray(zoneData.greens)) {
    zoneData.greens.forEach((zone) => {
      const greenPolygon = L.polygon(zone.coordinates, {
        ...ZONE_STYLES.green,
        zoneName: zone.name,
        zoneType: 'green'
      }).addTo(zoneLayer);
      greenPolygon.bindPopup(`<b>${zone.name}</b><br>Povolená zóna`);
    });
  }

  // Draw fence outline for visual reference
  if (zoneData.fence?.coordinates) {
    L.polygon(zoneData.fence.coordinates, {
      color: '#dc3545',
      weight: 2,
      fill: false,
      dashArray: '6,4',
      interactive: false
    }).addTo(zoneLayer);
  }

  console.log("✅ [SSHR-ZONES] Zone polygons rendered");
}

function createZonePolygon(coordinates, options) {
  return L.polygon(coordinates, {
    color: options.color || '#007bff',
    fillColor: options.fillColor || options.color || '#007bff',
    fillOpacity: options.fillOpacity || 0.2,
    weight: options.weight || 2,
    zoneName: options.zoneName,
    zoneType: options.zoneType
  });
}

function updateZoneStyle(zoneName, style) {
  // TODO: Find zone by name and update its style
  console.log(`🎨 [ZONE-STYLE] Updating style for zone: ${zoneName}`);
}

function highlightZone(zoneName, highlight = true) {
  // TODO: Find zone and apply highlight style
  console.log(`✨ [ZONE-HIGHLIGHT] ${highlight ? 'Highlighting' : 'Unhighlighting'} zone: ${zoneName}`);
}

// === ZONE DETECTION ===

function checkSSHRZoneViolation(lat, lng) {
  const zoneData = window.SSHR_ZONES;
  if (!zoneData) {
    return { inRed: false, inGreen: false, violation: false, zoneName: 'UNKNOWN', insideFence: false };
  }

  const turfAvailable = typeof turf !== 'undefined';
  const point = turfAvailable ? turf.point([lng, lat]) : null;
  const helpers = zoneData.helpers || {};

  let insideFence = helpers.pointInFence ? helpers.pointInFence(lat, lng) : false;
  let inGreen = false;
  let inRed = false;
  let greenZone = null;
  let redZone = null;

  if (turfAvailable && point) {
    if (Array.isArray(zoneData.greens)) {
      for (const zone of zoneData.greens) {
        if (zone.turf && turf.booleanPointInPolygon(point, zone.turf)) {
          inGreen = true;
          greenZone = zone;
          break;
        }
      }
    }

    if (!insideFence && zoneData.fence?.turf) {
      insideFence = turf.booleanPointInPolygon(point, zoneData.fence.turf);
    }

    if (Array.isArray(zoneData.reds)) {
      for (const zone of zoneData.reds) {
        if (zone.turf && turf.booleanPointInPolygon(point, zone.turf)) {
          inRed = true;
          redZone = zone;
          break;
        }
      }
    } else if (insideFence && !inGreen) {
      inRed = true;
    }
  } else {
    insideFence = helpers.pointInFence ? helpers.pointInFence(lat, lng) : false;
    inGreen = helpers.pointInGreen ? helpers.pointInGreen(lat, lng) : false;
    inRed = helpers.pointInRed ? helpers.pointInRed(lat, lng) : (insideFence && !inGreen);
  }

  const violation = inRed && !inGreen;
  let zoneName = 'OUTSIDE';
  if (inGreen) {
    zoneName = greenZone?.id || 'GREEN_ZONE';
  } else if (inRed) {
    zoneName = redZone?.id || 'RED_ZONE';
  } else if (insideFence) {
    zoneName = 'FENCE';
  }

  return {
    inRed,
    inGreen,
    insideFence,
    violation,
    zoneName,
    greenZone,
    redZone
  };
}

function isPointInRedZone(lat, lng) {
  return checkSSHRZoneViolation(lat, lng).inRed;
}

function isPointInGreenZone(lat, lng) {
  return checkSSHRZoneViolation(lat, lng).inGreen;
}

function getZoneByPoint(lat, lng) {
  const zoneStatus = checkSSHRZoneViolation(lat, lng);
  return zoneStatus.zoneName;
}

function getZoneStatus(lat, lng) {
  return checkSSHRZoneViolation(lat, lng);
}

// === ZONE UTILITIES ===

function findZoneById(zoneId) {
  const zoneData = window.SSHR_ZONES || {};
  if (!zoneId) return null;

  if (zoneData.fence?.id === zoneId) return zoneData.fence;

  const greenMatch = (zoneData.greens || []).find(zone =>
    zone.id === zoneId || zone.name === zoneId
  );
  if (greenMatch) return greenMatch;

  const redMatch = (zoneData.reds || []).find(zone =>
    zone.id === zoneId || zone.name === zoneId
  );
  return redMatch || null;
}

function checkPointInZone(lat, lng, zoneId) {
  const zone = findZoneById(zoneId);
  if (!zone) return false;

  if (zone.helpers && typeof zone.helpers.pointInZone === 'function') {
    return zone.helpers.pointInZone(lat, lng);
  }

  if (typeof turf === 'undefined' || !zone.lngLat) {
    return false;
  }

  const targetPolygon = zone.turf || turf.polygon(Array.isArray(zone.lngLat[0][0])
    ? zone.lngLat
    : [zone.lngLat]
  );
  return turf.booleanPointInPolygon(turf.point([lng, lat]), targetPolygon);
}

function getAllZones() {
  return {
    fence: window.SSHR_ZONES?.fence || null,
    greens: window.SSHR_ZONES?.greens || [],
    reds: window.SSHR_ZONES?.reds || []
  };
}

function getZoneCoordinates(zoneName) {
  const zone = findZoneById(zoneName);
  return zone ? zone.coordinates : null;
}

function calculateZoneArea(zoneName) {
  const zone = findZoneById(zoneName);
  if (!zone || typeof turf === 'undefined') return 0;

  const polygon = zone.turf || turf.polygon(Array.isArray(zone.lngLat[0][0])
    ? zone.lngLat
    : [zone.lngLat]
  );
  return turf.area(polygon);
}

function getZoneCenter(zoneName) {
  const zone = findZoneById(zoneName);
  if (!zone || typeof turf === 'undefined') return null;

  const polygon = zone.turf || turf.polygon(Array.isArray(zone.lngLat[0][0])
    ? zone.lngLat
    : [zone.lngLat]
  );
  const center = turf.center(polygon);
  if (!center) return null;
  const [lng, lat] = center.geometry.coordinates;
  return { lat, lng };
}

// ============================================================================
// 4. PERSON TRACKING CORE
// ============================================================================

// === PERSON MANAGEMENT ===

function addSSHRPerson(lat, lng, cardId, options = {}) {
  console.log(`👤 [SSHR-PERSON] Adding person at ${lat}, ${lng} with card ${cardId}`);

  const personId = generateUniqueId('person');
  const baseColor = options.color || PERSON_COLORS.default;
  const person = {
    id: personId,
    cardId,
    lat,
    lng,
    prevLat: lat,
    prevLng: lng,
    color: baseColor,
    rotation: 0,
    status: 'active',
    entryTime: new Date(),
    lastUpdate: new Date(),
    zoneHistory: [],
    incidentCount: 0,
    inIncident: false,
    incidentStartTime: null,
    incidentEndTime: null,
    markerId: null,
    marker: null,
    ...options
  };

  // Create marker
  const marker = createPersonMarker(person);
  person.markerId = L.stamp(marker);
  person.marker = marker;

  // Add to tracking
  window.sshrPersons.set(personId, person);

  // Assign card
  if (cardId) {
    assignCard(cardId, personId);
  }

  // Check initial zone
  const zoneStatus = checkSSHRZoneViolation(lat, lng);
  person.currentZone = zoneStatus.zoneName;
  person.zoneInfo = zoneStatus;

  // Add to map
  const personLayer = window.sshrLayers.get('persons');
  if (personLayer) {
    marker.addTo(personLayer);
  }

  // Update widgets
  updatePersonCountWidget(window.sshrPersons.size);

  // Trigger events
  onPersonAdd(person);

  return personId;
}

function removeSSHRPerson(personId) {
  console.log(`👤 [SSHR-PERSON] Removing person ${personId}`);

  const person = window.sshrPersons.get(personId);
  if (!person) return false;

  // Remove marker from map
  const personLayer = window.sshrLayers.get('persons');
  if (person.marker) {
    if (person.marker._animeInstance && typeof person.marker._animeInstance.pause === 'function') {
      person.marker._animeInstance.pause();
    }
    person.marker.remove();
  } else if (personLayer && person.markerId) {
    personLayer.eachLayer(layer => {
      if (L.stamp(layer) === person.markerId) {
        personLayer.removeLayer(layer);
      }
    });
  }
  person.marker = null;
  person.markerId = null;

  // Remove info panel
  if (person.infoPanel) {
    person.infoPanel.remove();
    person.infoPanel = null;
  }

  // Unassign card
  if (person.cardId) {
    unassignCard(person.cardId);
  }

  // Remove from tracking
  window.sshrPersons.delete(personId);

  // Update widgets
  updatePersonCountWidget(window.sshrPersons.size);

  // Trigger events
  onPersonRemove(personId);

  return true;
}

function updateSSHRPersonPosition(personId, lat, lng) {
  const person = window.sshrPersons.get(personId);
  if (!person) return false;

  const oldLat = person.lat;
  const oldLng = person.lng;
  const oldZone = person.currentZone;

  person.prevLat = oldLat;
  person.prevLng = oldLng;

  // Calculate speed if possible
  if (person.prevLat && person.prevLng) {
    const timeDiff = (Date.now() - (person.lastUpdate?.getTime() || Date.now())) / 1000; // sekunde
    if (timeDiff > 0) {
      const distance = calculateDistance(
        { lat: person.prevLat, lng: person.prevLng },
        { lat, lng }
      );
      person.speed = distance / timeDiff; // m/s
    }
  }

  // Update position
  person.lat = lat;
  person.lng = lng;
  person.lastUpdate = new Date();

  // Check zone change
  const zoneStatus = checkSSHRZoneViolation(lat, lng);
  person.currentZone = zoneStatus.zoneName;
  person.zoneInfo = zoneStatus;

  // Update marker color based on zone status
  let newColor = PERSON_COLORS.default;
  if (zoneStatus.violation || zoneStatus.inRed) {
    newColor = PERSON_COLORS.violation;
  } else if (zoneStatus.inGreen) {
    newColor = PERSON_COLORS.default;
  }
  person.color = newColor;

  // Update marker position with new color
  updatePersonMarker(personId, { lat, lng, color: newColor });

  // Check for violations a sledování incidentů
  if (zoneStatus.violation || zoneStatus.inRed) {
    // Osoba je v RED zóně - incident
    if (!person.inIncident) {
      // Nový incident - osoba opustila GREEN zónu
      person.incidentCount = (person.incidentCount || 0) + 1;
      person.inIncident = true;
      person.incidentStartTime = new Date();
      console.log(`🚨 [INCIDENT START] ${personId}: incident #${person.incidentCount} started`);
    }
    detectZoneViolation(personId, lat, lng);
  } else if (zoneStatus.inGreen && person.inIncident) {
    // Osoba se vrátila do GREEN zóny - konec incidentu
    person.inIncident = false;
    person.incidentEndTime = new Date();
    const duration = person.incidentEndTime - person.incidentStartTime;
    console.log(`✅ [INCIDENT END] ${personId}: incident #${person.incidentCount} ended after ${Math.round(duration/1000)}s`);
  }

  // Trigger zone change event
  if (oldZone !== person.currentZone) {
    onPersonZoneChange(personId, oldZone, person.currentZone);
  }

  // Trigger move event
  onPersonMove(personId, lat, lng);

  return true;
}

function movePersonTo(personId, targetLat, targetLng, duration = ANIMATION_DURATIONS.markerMove) {
  window.sshrDebugLog(`🚀 [RENDERER] movePersonTo called for ${personId} - OLD FUNCTION!`);
  const person = window.sshrPersons.get(personId);
  if (!person) return;

  const marker = person.marker;
  if (!marker) {
    updateSSHRPersonPosition(personId, targetLat, targetLng);
    return;
  }

  if (typeof anime === 'undefined') {
    updateSSHRPersonPosition(personId, targetLat, targetLng);
    return;
  }

  if (marker._animeInstance && typeof marker._animeInstance.pause === 'function') {
    marker._animeInstance.pause();
  }

  const startLat = person.lat;
  const startLng = person.lng;

  person.prevLat = startLat;
  person.prevLng = startLng;

  // Vypočítej rotaci pouze jednou na začátku animace
  const initialRotation = calculateParallelMarkerAngle(startLat, startLng, targetLat, targetLng);

  // Zkontroluj zónu cílové pozice pro správnou barvu
  const targetZoneStatus = checkSSHRZoneViolation(targetLat, targetLng);
  let targetColor = PERSON_COLORS.default;
  if (targetZoneStatus.violation || targetZoneStatus.inRed) {
    targetColor = PERSON_COLORS.violation;
  } else if (targetZoneStatus.inGreen) {
    targetColor = PERSON_COLORS.default;
  }

  marker.setIcon(getPersonMarkerIcon(targetColor, initialRotation));
  person.rotation = initialRotation;
  person.color = targetColor;

  marker._animeInstance = anime({
    targets: { lat: startLat, lng: startLng },
    lat: targetLat,
    lng: targetLng,
    duration,
    easing: 'linear',
    update(anim) {
      const lat = anim.animations[0].currentValue;
      const lng = anim.animations[1].currentValue;
      marker.setLatLng([lat, lng]);
      // NEMĚNIT rotaci během animace - postavička stojí nohama na cestě
    },
    complete() {
      marker._animeInstance = null;
      updateSSHRPersonPosition(personId, targetLat, targetLng);
    }
  });
}

// === PERSON UTILITIES ===

function getPersonById(personId) {
  return window.sshrPersons.get(personId);
}

function getAllActivePersons() {
  return Array.from(window.sshrPersons.values()).filter(p => p.status === 'active');
}

function getPersonsInZone(zoneName) {
  return Array.from(window.sshrPersons.values()).filter(p => p.currentZone === zoneName);
}

function getNearbyPersons(lat, lng, radius = 10) {
  // TODO: Use Turf.js to find persons within radius (meters)
  return [];
}

function findPersonByCard(cardId) {
  return Array.from(window.sshrPersons.values()).find(p => p.cardId === cardId);
}

// === PERSON RENDERING ===

function createPersonMarker(person, options = {}) {
  const zoneInfo = person.zoneInfo || checkSSHRZoneViolation(person.lat, person.lng);

  let markerColor = options.color || person.color || PERSON_COLORS.default;
  if (!options.color) {
    if (zoneInfo?.violation || zoneInfo?.inRed) {
      markerColor = PERSON_COLORS.violation;
    } else if (zoneInfo?.inGreen) {
      markerColor = PERSON_COLORS.default;
    }
  }
  person.color = markerColor;

  const rotation = typeof options.rotation === 'number'
    ? options.rotation
    : (typeof person.rotation === 'number' ? person.rotation : 0);
  person.rotation = rotation;

  const icon = getPersonMarkerIcon(markerColor, rotation);
  const marker = L.marker([person.lat, person.lng], { icon });

  // Vytvořit info panel místo popup
  createPersonInfoPanel(person);

  return marker;
}

function createPersonInfoPanel(person) {
  // Odstranit existující panel, pokud existuje
  const existingPanel = document.getElementById(`person-info-${person.id}`);
  if (existingPanel) {
    existingPanel.remove();
  }

  const panel = document.createElement('div');
  panel.id = `person-info-${person.id}`;
  panel.className = 'sshr-person-info-panel';
  panel.dataset.personId = person.id;
  panel.dataset.panelId = panel.id;
  const datasetName = person.metadata?.dataset || person.datasetName || '';
  panel.dataset.datasetName = datasetName;

  // Vypočítej pozici podle pořadí osob (první osoba top: 120px, další +160px)
  const activePersons = Array.from(window.sshrPersons.values());
  const personIndex = activePersons.indexOf(person);
  const topPosition = 120 + (personIndex * 160);

  // Styling podle CEPRO - levá strana pod zoom kontrolami
  panel.style.cssText = `
    position: fixed;
    top: ${topPosition}px;
    left: 20px;
    background: rgba(255,255,255,0.95);
    color: #000;
    padding: 8px 12px;
    font-size: 11px;
    border-radius: 6px;
    min-width: 200px;
    max-width: 250px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    z-index: 1000;
    border-left: 4px solid ${person.color};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  `;

  // Header s názvem osoby
  const personNumber = person.cardId || person.id.replace('person_', '');
  panel.innerHTML = `
    <div class="panel-header" style="font-weight: 600; margin-bottom: 6px; color: ${person.color}; font-size: 12px; border-bottom: 1px solid #eee; padding-bottom: 4px;">
      OSOBA č.${personNumber}
      <button onclick="removeSSHRPerson('${person.id}')" style="float: right; background: none; border: none; color: #666; cursor: pointer; font-size: 14px;">×</button>
    </div>
    <div class="panel-content">
      <div class="info-item" style="margin: 3px 0; display: flex; justify-content: space-between;">
        <span class="info-label" style="font-weight: 500;">Čas:</span>
        <span class="info-value" data-info="time">—</span>
      </div>
      <div class="info-item" style="margin: 3px 0; display: flex; justify-content: space-between;">
        <span class="info-label" style="font-weight: 500;">GPS:</span>
        <span class="info-value" data-info="gps">${person.lat.toFixed(5)}, ${person.lng.toFixed(5)}</span>
      </div>
      <div class="info-item" style="margin: 3px 0; display: flex; justify-content: space-between;">
        <span class="info-label" style="font-weight: 500;">Zóna:</span>
        <span class="info-value" data-info="zone">—</span>
      </div>
      <div class="info-item" style="margin: 3px 0; display: flex; justify-content: space-between;">
        <span class="info-label" style="font-weight: 500;">Kotva:</span>
        <span class="info-value" data-info="anchor">—</span>
      </div>
      <div class="info-item" style="margin: 3px 0; display: flex; justify-content: space-between;">
        <span class="info-label" style="font-weight: 500;">Segment GREEN zóny:</span>
        <span class="info-value" data-info="green-segment">—</span>
      </div>
      <div class="info-item" style="margin: 3px 0; display: flex; justify-content: space-between;">
        <span class="info-label" style="font-weight: 500;">Počet incidentů:</span>
        <span class="info-value" data-info="incidents">0</span>
      </div>
      <div class="card-drop-zone" style="margin-top: 8px; padding: 6px; border: 1px dashed #ccc; text-align: center; font-size: 9px; color: #666; border-radius: 3px;">
        Návštěvnická karta
      </div>
    </div>
  `;

  // Přidat do mapy
  document.body.appendChild(panel);

  // Uložit referenci na panel
  person.infoPanel = panel;

  // Aktualizovat okamžitě
  updatePersonInfoPanel(person);

  return panel;
}

function updatePersonInfoPanel(person) {
  if (!person.infoPanel) return;

  const panel = person.infoPanel;
  const panelId = panel.dataset.panelId || panel.id;
  panel.dataset.panelId = panelId;
  const panelDatasetName = panel.dataset.datasetName || person.metadata?.dataset || person.datasetName || '';
  panel.dataset.datasetName = panelDatasetName;
  const zoneInfo = person.zoneInfo || checkSSHRZoneViolation(person.lat, person.lng);
  const sampleTimestamp = person.metadata?.lastUpdate || person.lastUpdate || null;
  const formattedSampleTime = sampleTimestamp ? formatTimestamp(sampleTimestamp) : null;

  // Aktualizovat barvu levého pruhu podle zóny
  let panelColor = PERSON_COLORS.default;
  let statusText = 'V povolené zóně';
  let statusColor = '#27ae60'; // zelená

  if (zoneInfo?.violation || zoneInfo?.inRed) {
    panelColor = PERSON_COLORS.violation;
    statusText = 'INCIDENT v zakázané zóně';
    statusColor = '#c0392b'; // červená
  } else if (zoneInfo?.inGreen) {
    panelColor = PERSON_COLORS.default;
    statusText = 'V povolené zóně';
    statusColor = '#27ae60'; // zelená
  }

  // Použij už nastavenou barvu osoby, neměň ji zde
  panelColor = person.color || panelColor;

  // Aktualizovat barvu levého pruhu
  panel.style.borderLeftColor = panelColor;

  // Aktualizovat header barvu
  const header = panel.querySelector('.panel-header');
  if (header) {
    header.style.color = panelColor;
  }

  // Aktualizovat jednotlivé hodnoty
  const timeEl = panel.querySelector('[data-info="time"]');
  if (timeEl) {
    timeEl.textContent = formattedSampleTime || new Date().toLocaleTimeString('cs-CZ');
  }

  const gpsEl = panel.querySelector('[data-info="gps"]');
  if (gpsEl) {
    gpsEl.textContent = `${person.lat.toFixed(5)}, ${person.lng.toFixed(5)}`;
  }

  // Zóna s barvami GREEN (zeleně) / RED (červeně)
  const zoneEl = panel.querySelector('[data-info="zone"]');
  if (zoneEl) {
    if (zoneInfo?.inGreen) {
      zoneEl.innerHTML = '<span style="color: #27ae60; font-weight: bold;">GREEN</span>';
    } else if (zoneInfo?.inRed || zoneInfo?.violation) {
      zoneEl.innerHTML = '<span style="color: #c0392b; font-weight: bold;">RED</span>';
    } else {
      zoneEl.textContent = '—';
    }
  }

  // Kotva - nejbližší kotva ve vzdálenosti max 3m
  const anchorEl = panel.querySelector('[data-info="anchor"]');
  if (anchorEl) {
    const nearbyAnchor = findNearestAnchor(person.lat, person.lng, 3.0); // max 3m
    if (nearbyAnchor) {
      anchorEl.textContent = formattedSampleTime
        ? `${nearbyAnchor.id} (${formattedSampleTime})`
        : nearbyAnchor.id;
    } else {
      anchorEl.textContent = '—';
    }
  }

  // Segment GREEN zóny (ENTRY, A, B, C, D podle ZONES_SSHR.js)
  const greenSegmentEl = panel.querySelector('[data-info="green-segment"]');
  if (greenSegmentEl) {
    const greenSegment = detectGreenSegment(person.lat, person.lng);
    greenSegmentEl.textContent = greenSegment || '—';
  }

  // Počet incidentů (inicializace pokud neexistuje)
  if (typeof person.incidentCount !== 'number') {
    person.incidentCount = 0;
  }
  const incidentsEl = panel.querySelector('[data-info="incidents"]');
  if (incidentsEl) {
    let totalIncidents = typeof person.incidentCount === 'number' ? person.incidentCount : 0;
    if (window.SSHRCardManager?.getPersonIncidentCount) {
      const managerCount = window.SSHRCardManager.getPersonIncidentCount(panelDatasetName, panelId);
      if (typeof managerCount === 'number') {
        totalIncidents = managerCount;
      }
    } else if (window.SSHRIncidentEngine?.getPersonIncidentCount) {
      const engineCount = window.SSHRIncidentEngine.getPersonIncidentCount(person.id);
      if (typeof engineCount === 'number') {
        totalIncidents = engineCount;
      }
    }
    incidentsEl.textContent = totalIncidents.toString();
  }
}

// Přidat helper funkce pro typ pohybu (převzato z CEPRO)
function getMovementTypeFromSpeed(speedMps) {
  const speedKmh = speedMps * 3.6;

  if (speedMps <= 0.05) return "Stání";
  if (speedKmh < 3) return "Pomalá chůze";
  if (speedKmh < 5.5) return "Standardní chůze";
  if (speedKmh < 7.5) return "Rychlá chůze";
  if (speedKmh < 9) return "Běh";
  if (speedKmh < 13) return "Rychlý běh";
  return "Sprint";
}

function getMovementTypeColor(movementType) {
  const colorByType = {
    "Stání": "#6c757d",
    "Pomalá chůze": "#28a745",
    "Standardní chůze": "#17a2b8",
    "Rychlá chůze": "#ffc107",
    "Běh": "#fd7e14",
    "Rychlý běh": "#ff5722",
    "Sprint": "#dc3545"
  };
  return colorByType[movementType] || "#6c757d";
}

// Helper funkce pro detekci kotev v dosahu 3m
function findNearestAnchor(lat, lng, maxDistanceMeters = 3.0) {
  // TODO: Implementovat detekci kotev v SSHR
  // Pro nyní vracíme null - budeme potřebovat dataset kotev
  return null;
}

// Helper funkce pro detekci GREEN segmentu podle ZONES_SSHR.js
function detectGreenSegment(lat, lng) {
  if (!window.SSHR_ZONES || !window.SSHR_ZONES.greens) {
    return null;
  }

  const point = turf.point([lng, lat]);

  // Projít všechny GREEN zóny z ZONES_SSHR.js
  for (const green of window.SSHR_ZONES.greens) {
    if (green.turf && turf.booleanPointInPolygon(point, green.turf)) {
      // Extraktovat segment name z ID nebo name
      if (green.id === 'GREEN_ENTRY') return 'ENTRY';
      if (green.id === 'GREEN_A') return 'A';
      if (green.id === 'GREEN_B') return 'B';
      if (green.id === 'GREEN_C') return 'C';
      if (green.id === 'GREEN_D') return 'D';

      // Fallback na název zóny
      return green.name || green.id;
    }
  }

  return null;
}

function updatePersonMarker(personId, options = {}) {
  const person = window.sshrPersons.get(personId);
  if (!person) return;

  const personLayer = window.sshrLayers.get('persons');
  let marker = person.marker;

  if (!marker && personLayer && person.markerId) {
    personLayer.eachLayer(layer => {
      if (!marker && L.stamp(layer) === person.markerId) {
        marker = layer;
      }
    });
    if (marker) {
      person.marker = marker;
      person.markerId = L.stamp(marker);
    }
  }

  if (!marker) return;

  const nextLat = options.lat ?? person.lat;
  const nextLng = options.lng ?? person.lng;

  if (Number.isFinite(nextLat) && Number.isFinite(nextLng)) {
    marker.setLatLng([nextLat, nextLng]);
  }

  const zoneInfo = person.zoneInfo || checkSSHRZoneViolation(nextLat, nextLng);

  // Prioritně použij color z options (explicitně předanou), jinak spočítej ze zóny
  let markerColor;
  if (options.color) {
    markerColor = options.color;
  } else {
    if (zoneInfo?.violation || zoneInfo?.inRed) {
      markerColor = PERSON_COLORS.violation;
    } else if (zoneInfo?.inGreen) {
      markerColor = PERSON_COLORS.default;
    } else {
      markerColor = person.color || PERSON_COLORS.default;
    }
  }

  const prevLat = person.prevLat ?? person.lat;
  const prevLng = person.prevLng ?? person.lng;

  let rotation = typeof options.rotation === 'number'
    ? options.rotation
    : person.rotation || 0;

  if (
    Number.isFinite(prevLat) && Number.isFinite(prevLng) &&
    Number.isFinite(nextLat) && Number.isFinite(nextLng) &&
    (Math.abs(nextLat - prevLat) > 0.0000001 || Math.abs(nextLng - prevLng) > 0.0000001)
  ) {
    rotation = calculateParallelMarkerAngle(prevLat, prevLng, nextLat, nextLng);
  }

  marker.setIcon(getPersonMarkerIcon(markerColor, rotation));

  if (options.lat !== undefined && options.lng !== undefined) {
    person.lat = nextLat;
    person.lng = nextLng;
  }

  person.prevLat = nextLat;
  person.prevLng = nextLng;
  person.color = markerColor;
  person.rotation = rotation;

  // Aktualizovat info panel při změně pozice
  updatePersonInfoPanel(person);
}

function animatePersonMovement(personId, path, options = {}) {
  window.sshrDebugLog(`🚀 [RENDERER] animatePersonMovement called for ${personId} - OLD FUNCTION!`);
  if (!Array.isArray(path) || path.length === 0) return;

  const segmentDuration = options.segmentDuration || options.duration || ANIMATION_DURATIONS.markerMove;

  const runSegment = (index) => {
    if (index >= path.length) {
      return;
    }

    const point = path[index];
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
      runSegment(index + 1);
      return;
    }

    movePersonTo(personId, point.lat, point.lng, segmentDuration);

    const person = window.sshrPersons.get(personId);
    const marker = person?.marker;

    const handleNext = () => runSegment(index + 1);

    if (marker && marker._animeInstance && marker._animeInstance.finished && typeof marker._animeInstance.finished.then === 'function') {
      marker._animeInstance.finished.then(handleNext);
    } else {
      setTimeout(handleNext, segmentDuration);
    }
  };

  runSegment(0);
}

function setPersonColor(personId, color) {
  const person = window.sshrPersons.get(personId);
  if (!person) return;
  person.color = color;
  updatePersonMarker(personId, { color });
}

function showPersonPopup(personId) {
  const person = window.sshrPersons.get(personId);
  if (!person || !person.markerId) return;

  const personLayer = window.sshrLayers.get('persons');
  if (!personLayer) return;

  personLayer.eachLayer(layer => {
    if (L.stamp(layer) === person.markerId) {
      layer.openPopup();
    }
  });
}

function hidePersonPopup(personId) {
  // TODO: Close popup for specific person
}

// === PERSON STATE ===

function setPersonStatus(personId, status) {
  const person = window.sshrPersons.get(personId);
  if (person) {
    person.status = status;
    person.lastUpdate = new Date();

    // Update marker color based on status
    const color = status === 'violation' ? PERSON_COLORS.violation :
                  status === 'warning' ? PERSON_COLORS.warning :
                  status === 'inactive' ? PERSON_COLORS.inactive :
                  PERSON_COLORS.default;

    setPersonColor(personId, color);
  }
}

function getPersonStatus(personId) {
  const person = window.sshrPersons.get(personId);
  return person ? person.status : null;
}

function isPersonActive(personId) {
  const person = window.sshrPersons.get(personId);
  return person && person.status === 'active';
}

function getPersonHistory(personId) {
  const person = window.sshrPersons.get(personId);
  return person ? person.zoneHistory : [];
}

// ============================================================================
// 5. VISITOR CARD SYSTEM
// ============================================================================

// === CARD INITIALIZATION ===

function initSSHRVisitorCards() {
  console.log("🎴 [SSHR-CARDS] Initializing visitor card system...");

  // Clear existing cards
  window.sshrCards.clear();

  // Generate default cards
  const maxCards = SSHR_CONFIG.limits?.maxCards ?? 20;
  for (let i = 1; i <= maxCards; i++) {
    const cardId = `SSHR${i.toString().padStart(3, '0')}`;
    window.sshrCards.set(cardId, {
      id: cardId,
      status: 'available',
      assignedTo: null,
      assignedAt: null,
      entryTime: null
    });
  }

  renderCardPool();
  setupCardDragDrop();

  console.log(`✅ [SSHR-CARDS] Generated ${window.sshrCards.size} visitor cards`);
}

// === POLYGON MANAGER INITIALIZATION ===

/**
 * Initialize SSHR Polygon Manager for dual-mode zone system
 */
function initSSHRPolygonManager(map) {
  console.log("🔺 [SSHR-POLYGON] Initializing SSHR Polygon Manager...");

  try {
    // Check if SSHRPolygonManager is available
    if (typeof window.SSHRPolygonManager === 'undefined') {
      console.warn("⚠️ [SSHR-POLYGON] SSHRPolygonManager not available, skipping polygon initialization");
      return null;
    }

    // Get mode from configuration or default to FIXED
    const polygonMode = SSHR_CONFIG.polygonMode || 'FIXED';

    // Initialize polygon manager
    const polygonManager = new window.SSHRPolygonManager(map, {
      mode: polygonMode
    });

    // Store reference for global access
    window.sshrPolygonManager = polygonManager;

    // Add to SSHR API
    if (window.SSHR) {
      window.SSHR.polygonManager = polygonManager;

      // Add polygon-specific API methods
      window.SSHR.zones = {
        ...window.SSHR.zones,
        switchMode: (mode) => polygonManager.switchMode(mode),
        getMode: () => polygonManager.mode,
        addZone: (zoneData, type) => polygonManager.addZone(zoneData, type),
        deleteZone: (zoneId) => polygonManager.deleteZone(zoneId),
        editZone: (zoneId) => polygonManager.editZone(zoneId),
        isPointInZone: (lat, lng, type) => polygonManager.isPointInZone(lat, lng, type),
        getZoneType: (lat, lng) => polygonManager.getZoneTypeForPoint(lat, lng),
        getStatistics: () => polygonManager.getZoneStatistics(),
        exportZones: () => polygonManager.exportZones(),
        importZones: (data) => polygonManager.importZones(data),
        loadInternalZones: () => polygonManager.loadInternalZones(),
        loadPerimeterFence: () => polygonManager.loadPerimeterFence(),
        addZonePolylines: (zones, type) => polygonManager.addZonePolylines(zones, type),
        addZonePolygons: (zones, type) => polygonManager.addZonePolygons(zones, type),
        removeLayerType: (layerName) => polygonManager.removeLayerType(layerName),
        // Expose polygon layers for fence verification
        get polygonLayers() { return polygonManager.polygonLayers; }
      };
    }

    // Setup event listeners for polygon events
    window.addEventListener('sshr-zone-added', (e) => {
      console.log(`🔺 [SSHR-POLYGON] Zone added:`, e.detail);
      updateSSHRWidgets();
    });

    window.addEventListener('sshr-zone-deleted', (e) => {
      console.log(`🗑️ [SSHR-POLYGON] Zone deleted:`, e.detail);
      updateSSHRWidgets();
    });

    window.addEventListener('sshr-mode-changed', (e) => {
      console.log(`🔄 [SSHR-POLYGON] Mode changed to:`, e.detail.mode);
      updatePolygonModeUI(e.detail.mode);
    });

    console.log(`✅ [SSHR-POLYGON] Polygon Manager initialized in ${polygonMode} mode`);
    return polygonManager;

  } catch (error) {
    console.error("❌ [SSHR-POLYGON] Failed to initialize polygon manager:", error);
  }
}

/**
 * Update UI based on polygon mode
 */
function updatePolygonModeUI(mode) {
  console.log(`🎨 [SSHR-UI] Updating UI for ${mode} polygon mode`);

  // Update mode indicator in UI
  const modeIndicator = document.querySelector('#polygon-mode-indicator');
  if (modeIndicator) {
    modeIndicator.textContent = mode;
    modeIndicator.className = `badge bg-${mode === 'FIXED' ? 'secondary' : 'primary'}`;
  }

  // Update legend visibility
  const legend = document.querySelector('.zone-legend');
  if (legend) {
    const modeInfo = legend.querySelector('.mode-info');
    if (modeInfo) {
      modeInfo.textContent = mode === 'FIXED' ? 'Pevné GPS polygony' : 'Uživatelské polygony';
    }
  }
}

function generateVisitorCard(cardId, options = {}) {
  const card = {
    id: cardId,
    status: 'available',
    assignedTo: null,
    assignedAt: null,
    entryTime: null,
    ...options
  };

  window.sshrCards.set(cardId, card);
  return card;
}

function renderCardPool() {
  const poolElement = document.getElementById('visitor-card-pool');
  if (!poolElement) return;

  poolElement.innerHTML = '';

  window.sshrCards.forEach(card => {
    const cardElement = document.createElement('div');
    cardElement.className = `visitor-card ${card.status}`;
    cardElement.textContent = card.id;
    cardElement.draggable = card.status === 'available';
    cardElement.dataset.cardId = card.id;

    // Add status styling
    if (card.status === 'assigned') {
      cardElement.style.backgroundColor = '#6c757d';
      cardElement.style.cursor = 'not-allowed';
    }

    poolElement.appendChild(cardElement);
  });
}

function setupCardDragDrop() {
  document.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('visitor-card')) {
      const cardId = e.target.dataset.cardId;
      const card = window.sshrCards.get(cardId);

      if (card && card.status === 'available') {
        e.target.classList.add('dragging');
        e.dataTransfer.setData('text/plain', cardId);
        onCardDragStart(e.target, cardId);
      } else {
        e.preventDefault();
      }
    }

    return polygonManager;
  });

  document.addEventListener('dragend', (e) => {
    if (e.target.classList.contains('visitor-card')) {
      e.target.classList.remove('dragging');
    }
  });
}

// === CARD MANAGEMENT ===

function assignCard(cardId, personId) {
  const card = window.sshrCards.get(cardId);
  const person = window.sshrPersons.get(personId);

  if (!card || !person) return false;

  if (card.status !== 'available') {
    console.warn(`⚠️ [CARD-ASSIGN] Card ${cardId} is not available`);
    return false;
  }

  card.status = 'assigned';
  card.assignedTo = personId;
  card.assignedAt = new Date();

  person.cardId = cardId;

  // renderCardPool(); // DISABLED: Using SSHRCardManager instead
  onCardAssign(cardId, personId);

  console.log(`✅ [CARD-ASSIGN] Card ${cardId} assigned to person ${personId}`);
  return true;
}

function unassignCard(cardId) {
  const card = window.sshrCards.get(cardId);
  if (!card) return false;

  const personId = card.assignedTo;

  card.status = 'available';
  card.assignedTo = null;
  card.assignedAt = null;
  card.entryTime = null;

  // Update person
  if (personId) {
    const person = window.sshrPersons.get(personId);
    if (person) {
      person.cardId = null;
    }
  }

  // renderCardPool(); // DISABLED: Using SSHRCardManager instead
  onCardUnassign(cardId);

  console.log(`✅ [CARD-UNASSIGN] Card ${cardId} unassigned`);
  return true;
}

function getAvailableCards() {
  return Array.from(window.sshrCards.values()).filter(c => c.status === 'available');
}

function getAssignedCards() {
  return Array.from(window.sshrCards.values()).filter(c => c.status === 'assigned');
}

function updateCardStatus(cardId, status) {
  const card = window.sshrCards.get(cardId);
  if (card) {
    card.status = status;
    // renderCardPool(); // DISABLED: Using SSHRCardManager instead
  }
}

// === CARD UTILITIES ===

function isCardAvailable(cardId) {
  const card = window.sshrCards.get(cardId);
  return card && card.status === 'available';
}

function findCardByPerson(personId) {
  return Array.from(window.sshrCards.values()).find(c => c.assignedTo === personId);
}

function getCardById(cardId) {
  return window.sshrCards.get(cardId);
}

function validateCardId(cardId) {
  return typeof cardId === 'string' && /^SSHR\d{3}$/.test(cardId);
}

// === CARD EVENTS ===

function onCardDragStart(cardElement, cardId) {
  console.log(`🎴 [CARD-DRAG] Started dragging card ${cardId}`);
  // TODO: Add visual feedback
}

function onCardDrop(lat, lng, cardId) {
  console.log(`🎴 [CARD-DROP] Card ${cardId} dropped at ${lat}, ${lng}`);

  // Create new person at drop location
  const personId = addSSHRPerson(lat, lng, cardId, { dataset: 'MANUAL' });

  if (personId) {
    showNotification(`Card ${cardId} assigned to new person`, 'success');
  }
}

function onCardAssign(cardId, personId) {
  console.log(`🎴 [CARD-ASSIGN] Card ${cardId} assigned to ${personId}`);
  // TODO: Show assignment animation
}

function onCardUnassign(cardId) {
  console.log(`🎴 [CARD-UNASSIGN] Card ${cardId} unassigned`);
  // TODO: Show unassignment animation
}

// ============================================================================
// 6. INCIDENT DETECTION & LOGGING
// ============================================================================

// === INCIDENT DETECTION ===

function detectZoneViolation(personId, lat, lng) {
  const person = window.sshrPersons.get(personId);
  if (!person) return;

  const zoneStatus = checkSSHRZoneViolation(lat, lng);

  if (zoneStatus.violation) {
    const incident = {
      id: generateUniqueId('incident'),
      type: INCIDENT_TYPES.ZONE_VIOLATION,
      personId: personId,
      cardId: person.cardId,
      lat: lat,
      lng: lng,
      zoneName: zoneStatus.zoneName,
      timestamp: new Date(),
      severity: 'high',
      status: 'active'
    };

    logIncident(personId, INCIDENT_TYPES.ZONE_VIOLATION, incident);
    setPersonStatus(personId, 'violation');
    highlightViolatingPerson(personId);
    showIncidentAlert(incident);
  }
}

function checkPersonViolations(personId) {
  const person = window.sshrPersons.get(personId);
  if (!person) return [];

  return window.sshrIncidents.filter(i => i.personId === personId && i.status === 'active');
}

function validatePersonPosition(personId) {
  const person = window.sshrPersons.get(personId);
  if (!person) return false;

  detectZoneViolation(personId, person.lat, person.lng);
  return true;
}

// === INCIDENT LOGGING ===

function logIncident(personId, type, details) {
  const incident = {
    id: generateUniqueId('incident'),
    personId: personId,
    type: type,
    timestamp: new Date(),
    details: details,
    status: 'active'
  };

  window.sshrIncidents.push(incident);

  // Update person incident count
  const person = window.sshrPersons.get(personId);
  if (person) {
    person.incidentCount++;
  }

  // Update widgets
  updateIncidentCountWidget(getActiveIncidents().length);
  populateIncidentList();

  console.log(`🚨 [INCIDENT] Logged incident ${incident.id} for person ${personId}`);
  return incident.id;
}

function getIncidentHistory(personId) {
  return window.sshrIncidents.filter(i => i.personId === personId);
}

function getAllIncidents() {
  return window.sshrIncidents;
}

function clearIncidents() {
  window.sshrIncidents = [];
  updateIncidentCountWidget(0);
  populateIncidentList();
}

function exportIncidentReport(format = 'json') {
  // TODO: Implement export functionality
  console.log(`📄 [EXPORT] Exporting incident report in ${format} format`);
}

// === INCIDENT UTILITIES ===

function isPersonInViolation(personId) {
  return checkPersonViolations(personId).length > 0;
}

function getActiveIncidents() {
  return window.sshrIncidents.filter(i => i.status === 'active');
}

function getIncidentById(incidentId) {
  return window.sshrIncidents.find(i => i.id === incidentId);
}

function calculateIncidentDuration(incidentId) {
  const incident = getIncidentById(incidentId);
  if (!incident) return 0;

  return Date.now() - incident.timestamp.getTime();
}

// === INCIDENT NOTIFICATIONS ===

function showIncidentAlert(incident) {
  const message = `VIOLATION: Person ${incident.personId} in ${incident.zoneName}`;
  showNotification(message, 'error', 5000);
  playIncidentSound();
}

function playIncidentSound() {
  // TODO: Play alert sound
  console.log("🔊 [SOUND] Playing incident alert");
}

function highlightViolatingPerson(personId) {
  setPersonColor(personId, PERSON_COLORS.violation);
  animateMarkerPulse(personId);
}

// ============================================================================
// 7. WIDGET MANAGEMENT
// ============================================================================

// === WIDGET UPDATES ===

function updateSSHRWidgets() {
  updateJupiterGISWidget(); // Widget 1 - Jupiter Analytics
  updatePersonCountWidget(window.sshrPersons.size);
  updateIncidentCountWidget(getActiveIncidents().length);
  updateAnchorStatusWidget('online');
  // updateVisitorCardWidget(); // DISABLED: Conflicts with SSHRCardManager
  updateSystemStatus();

  // New Widget 3 & 4 updates
  updateWidget3ActivePersons();
  updateWidget4PersonStats();
}

function updatePersonCountWidget(count) {
  const element = document.getElementById('sshr-person-count');
  if (element) {
    animateCounterIncrement(element, count);
  }
}

function updateIncidentCountWidget(count) {
  const element = document.getElementById('sshr-incident-count');
  if (element) {
    animateCounterIncrement(element, count);

    // Add visual emphasis for incidents
    if (count > 0) {
      element.parentElement.classList.add('incident-active');
    } else {
      element.parentElement.classList.remove('incident-active');
    }
  }
}

function updateAnchorStatusWidget(status) {
  const element = document.getElementById('sshr-anchor-count');
  if (element) {
    // Show anchor count (assuming ANCHORS array is loaded)
    const anchorCount = typeof ANCHORS !== 'undefined' ? ANCHORS.length : 81;
    element.textContent = anchorCount;
  }
}

function updateVisitorCardWidget() {
  // DISABLED: Conflicts with SSHRCardManager
  // renderCardPool();
}

// === WIDGET UTILITIES ===

function refreshAllWidgets() {
  updateSSHRWidgets();
  populateIncidentList();
  populatePersonList();
}

function animateWidgetValue(widgetId, newValue) {
  const element = document.getElementById(widgetId);
  if (element && window.anime) {
    anime({
      targets: element,
      scale: [1, 1.1, 1],
      duration: ANIMATION_DURATIONS.widgetUpdate,
      easing: 'easeInOutQuad'
    });
  }
}

function highlightWidget(widgetId, highlight = true) {
  const element = document.getElementById(widgetId);
  if (element) {
    if (highlight) {
      element.classList.add('widget-highlight');
    } else {
      element.classList.remove('widget-highlight');
    }
  }
}

function getWidgetValue(widgetId) {
  const element = document.getElementById(widgetId);
  return element ? element.textContent : null;
}

function setWidgetValue(widgetId, value) {
  const element = document.getElementById(widgetId);
  if (element) {
    element.textContent = value;
  }
}

// === WIDGET CONTENT ===

function populateIncidentList() {
  const listElement = document.getElementById('incident-list');
  if (!listElement) return;

  const activeIncidents = getActiveIncidents();

  if (activeIncidents.length === 0) {
    listElement.innerHTML = '<small class="text-muted">Žádné aktivní incidenty</small>';
    return;
  }

  listElement.innerHTML = activeIncidents.slice(0, 5).map(incident => `
    <div class="incident-item" style="font-size: 0.75rem; margin-bottom: 0.25rem;">
      <strong>${incident.personId}</strong> - ${incident.type}
      <br><small>${incident.timestamp.toLocaleTimeString()}</small>
    </div>
  `).join('');
}

function populatePersonList() {
  const listElement = document.getElementById('person-list');
  if (!listElement) return;

  const activePersons = getAllActivePersons();

  if (activePersons.length === 0) {
    listElement.innerHTML = '<small style="color: white; font-size: 11px;">Žádné aktivní osoby</small>';
    return;
  }

  listElement.innerHTML = activePersons.slice(0, 5).map(person => `
    <div class="person-item" style="font-size: 0.75rem; margin-bottom: 0.25rem; cursor: pointer;"
         onclick="centerMapOnPerson('${person.id}')">
      <strong>${person.cardId || person.id}</strong>
      <br><small>${person.currentZone || 'Unknown'}</small>
    </div>
  `).join('');
}

function updateSystemStatus() {
  const statusElement = document.getElementById('system-status');
  if (statusElement) {
    const status = {
      persons: window.sshrPersons.size,
      incidents: getActiveIncidents().length,
      cards: getAvailableCards().length
    };

    statusElement.innerHTML = `
      <div style="font-size: 0.75rem;">
        <div>Aktivní: ${status.persons}</div>
        <div>Volné karty: ${status.cards}</div>
        <div>Incidenty: ${status.incidents}</div>
      </div>
    `;
  }
}

function refreshCardPool() {
  // renderCardPool(); // DISABLED: Using SSHRCardManager instead
}

// ============================================================================
// 8. EVENT SYSTEM
// ============================================================================

// === MAP EVENTS ===

function onMapClick(e) {
  console.log(`🗺️ [MAP-CLICK] Clicked at ${e.latlng.lat}, ${e.latlng.lng}`);
  // TODO: Handle map click (e.g., show context menu)
}

function onMapDragOver(e) {
  e.originalEvent.preventDefault();
}

function onMapDrop(e) {
  e.originalEvent.preventDefault();
  const cardId = e.originalEvent.dataTransfer.getData('text/plain');
  const latlng = window.sshrMap.mouseEventToLatLng(e.originalEvent);

  console.log(`🎯 [MAP-DROP] Card ${cardId} dropped at:`, latlng);
  onCardDrop(latlng.lat, latlng.lng, cardId);
}

function onMapZoom(e) {
  // Map zoom change - debug log removed for performance
}

function onMapMove(e) {
  // TODO: Handle map move (e.g., update visible area)
}

// === PERSON EVENTS ===

function onPersonAdd(person) {
  console.log(`👤 [PERSON-ADD] Person ${person.id} added`);
  populatePersonList();
  showNotification(`Person ${person.cardId || person.id} entered area`, 'info');
}

function onPersonRemove(personId) {
  console.log(`👤 [PERSON-REMOVE] Person ${personId} removed`);
  populatePersonList();
  showNotification(`Person removed from area`, 'info');
}

function onPersonMove(personId, lat, lng) {
  // Update last seen location
  const person = window.sshrPersons.get(personId);
  if (person) {
    person.lastSeen = { lat, lng, timestamp: new Date() };
  }
}

function onPersonZoneChange(personId, oldZone, newZone) {
  console.log(`🚶 [ZONE-CHANGE] Person ${personId}: ${oldZone} → ${newZone}`);

  const person = window.sshrPersons.get(personId);
  if (person) {
    person.zoneHistory.push({
      from: oldZone,
      to: newZone,
      timestamp: new Date()
    });
  }
}

// === ZONE EVENTS ===

function onZoneEnter(personId, zoneName) {
  console.log(`🚪 [ZONE-ENTER] Person ${personId} entered ${zoneName}`);
}

function onZoneExit(personId, zoneName) {
  console.log(`🚪 [ZONE-EXIT] Person ${personId} exited ${zoneName}`);
}

function onZoneViolation(personId, zoneName) {
  console.log(`🚨 [ZONE-VIOLATION] Person ${personId} violated ${zoneName}`);
}

// === CUSTOM EVENTS ===

function dispatchCustomEvent(eventName, detail) {
  const event = new CustomEvent(eventName, { detail });
  document.dispatchEvent(event);
}

function addEventListener(eventName, callback) {
  document.addEventListener(eventName, callback);
}

function removeEventListener(eventName, callback) {
  document.removeEventListener(eventName, callback);
}

// ============================================================================
// 9. ANIMATION & VISUAL EFFECTS
// ============================================================================

// === MARKER ANIMATIONS ===

function animateMarkerBounce(markerId) {
  // TODO: Implement with Anime.js
  console.log(`🎬 [ANIMATION] Bouncing marker ${markerId}`);
}

function animateMarkerPulse(markerId) {
  // TODO: Implement pulsing animation
  console.log(`💗 [ANIMATION] Pulsing marker ${markerId}`);
}

function animateMarkerScale(markerId, scale) {
  // TODO: Scale animation
  console.log(`📏 [ANIMATION] Scaling marker ${markerId} to ${scale}`);
}

function animateMarkerColor(markerId, color) {
  // TODO: Color transition animation
  console.log(`🎨 [ANIMATION] Changing marker ${markerId} color to ${color}`);
}

// === ZONE ANIMATIONS ===

function animateZoneHighlight(zoneName) {
  console.log(`✨ [ZONE-ANIMATION] Highlighting zone ${zoneName}`);
}

function animateZonePulse(zoneName) {
  console.log(`💗 [ZONE-ANIMATION] Pulsing zone ${zoneName}`);
}

function animateZoneBorder(zoneName) {
  console.log(`🔲 [ZONE-ANIMATION] Animating border of ${zoneName}`);
}

// === WIDGET ANIMATIONS ===

function animateWidgetUpdate(widgetId) {
  animateWidgetValue(widgetId, getWidgetValue(widgetId));
}

function animateCounterIncrement(element, newValue) {
  if (!element) return;

  const currentValue = parseInt(element.textContent) || 0;

  if (window.anime) {
    const obj = { value: currentValue };
    anime({
      targets: obj,
      value: newValue,
      duration: ANIMATION_DURATIONS.widgetUpdate,
      easing: 'easeOutQuad',
      update: () => {
        element.textContent = Math.round(obj.value);
      }
    });
  } else {
    element.textContent = newValue;
  }
}

function animateProgressBar(elementId, percentage) {
  // TODO: Animate progress bar
  console.log(`📊 [PROGRESS] Animating ${elementId} to ${percentage}%`);
}

// === NOTIFICATION EFFECTS ===

function showNotification(message, type = 'info', duration = 3000) {
  if (window.toastr) {
    toastr[type](message);
  } else {
    console.log(`📢 [NOTIFICATION] ${type.toUpperCase()}: ${message}`);
  }
}

function showToast(message, options = {}) {
  showNotification(message, options.type || 'info', options.duration);
}

function highlightElement(elementId, duration = 2000) {
  const element = document.getElementById(elementId);
  if (element) {
    element.classList.add('highlight');
    setTimeout(() => {
      element.classList.remove('highlight');
    }, duration);
  }
}

function flashElement(elementId, color = '#ffff00') {
  // TODO: Flash element with color
  console.log(`⚡ [FLASH] Flashing ${elementId} with ${color}`);
}

// ============================================================================
// 10. DATA MANAGEMENT
// ============================================================================

// === DATA PROCESSING ===

function processPersonData(rawData) {
  // TODO: Process and validate raw person data
  return rawData;
}

function validateCoordinates(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number' &&
         lat >= -90 && lat <= 90 &&
         lng >= -180 && lng <= 180;
}

function validatePersonData(data) {
  return data &&
         typeof data.id === 'string' &&
         validateCoordinates(data.lat, data.lng);
}

function sanitizeInput(input) {
  if (typeof input === 'string') {
    return input.replace(/[<>\"']/g, '');
  }
  return input;
}

// === CALCULATIONS ===

function calculateDistance(point1, point2) {
  if (window.turf) {
    return turf.distance(
      turf.point([point1.lng, point1.lat]),
      turf.point([point2.lng, point2.lat]),
      { units: 'meters' }
    );
  }

  // Fallback: simple distance calculation
  const R = 6371e3; // Earth radius in meters
  const φ1 = point1.lat * Math.PI/180;
  const φ2 = point2.lat * Math.PI/180;
  const Δφ = (point2.lat-point1.lat) * Math.PI/180;
  const Δλ = (point2.lng-point1.lng) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

function calculateBearing(point1, point2) {
  if (window.turf) {
    return turf.bearing(
      turf.point([point1.lng, point1.lat]),
      turf.point([point2.lng, point2.lat])
    );
  }
  return 0;
}

function isWithinRadius(center, point, radius) {
  const distance = calculateDistance(center, point);
  return distance <= radius;
}

function getBoundingBox(points) {
  if (!points.length) return null;

  let minLat = points[0].lat, maxLat = points[0].lat;
  let minLng = points[0].lng, maxLng = points[0].lng;

  points.forEach(point => {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  });

  return [[minLat, minLng], [maxLat, maxLng]];
}

// === UTILITIES ===

function generateUniqueId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function formatTimestamp(timestamp) {
  if (window.moment) {
    return moment(timestamp).format('HH:mm:ss');
  }
  return new Date(timestamp).toLocaleTimeString();
}

function getActivePersonTracker() {
  return window.SSHRParallel?.personTracker ||
    window.ParallelEngine?.personTracker ||
    window.SSHR?.personTracker ||
    null;
}

function parseCoordinates(coordString) {
  // TODO: Parse coordinate strings in various formats
  return null;
}

function cloneObject(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// === STORAGE ===

function saveToLocalStorage(key, data) {
  try {
    localStorage.setItem(`sshr_${key}`, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('❌ [STORAGE] Failed to save to localStorage:', error);
    return false;
  }
}

function loadFromLocalStorage(key) {
  try {
    const data = localStorage.getItem(`sshr_${key}`);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('❌ [STORAGE] Failed to load from localStorage:', error);
    return null;
  }
}

function clearLocalStorage() {
  const keys = Object.keys(localStorage).filter(key => key.startsWith('sshr_'));
  keys.forEach(key => localStorage.removeItem(key));
}

function exportPersonData(format = 'json') {
  const data = {
    persons: Array.from(window.sshrPersons.values()),
    cards: Array.from(window.sshrCards.values()),
    incidents: window.sshrIncidents,
    timestamp: new Date(),
    version: SSHR_CONFIG.version || '2.0.0'
  };

  if (format === 'json') {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sshr_data_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

function importPersonData(data) {
  // TODO: Import and validate person data
  console.log("📥 [IMPORT] Importing person data");
}

// ============================================================================
// ANCHOR LOADING
// ============================================================================

function loadSSHRAnchors() {
  console.log("⚓ [SSHR-ANCHORS] Loading anchor network...");

  if (typeof ANCHORS !== 'undefined' && Array.isArray(ANCHORS)) {
    window.sshrAnchors = ANCHORS;
    const anchorLayer = window.sshrLayers.get('anchors');

    // Get the permanent corona layer (created in initSSHRLayers)
    const coronaLayer = window.sshrLayers.get('corona');
    if (!coronaLayer) {
      console.error("❌ [CORONA-LAYER] Corona layer not found! Check layer initialization.");
      return;
    }

    window.sshrAnchorMarkers = [];

    // Define anchor groups with activation perimeters
    const anchorGroups = {
      group1_10m: [8,80,70,67,68,64,19,21,62,61,55,54,48,57,53,35,30,32,33,47,46,37,36], // 10m perimeter
      group2_15m: [45,44,43,42], // 15m perimeter
      group3_7m: [] // 7m perimeter - will be filled with remaining anchors
    };

    // Find all anchor numbers and assign remaining to group3_7m
    const allAnchorNumbers = ANCHORS.map(a => a.anchorNumber);
    const assignedAnchors = [...anchorGroups.group1_10m, ...anchorGroups.group2_15m];
    anchorGroups.group3_7m = allAnchorNumbers.filter(num => !assignedAnchors.includes(num));

    console.log("🎯 [ANCHOR-GROUPS] Group assignment:");
    console.log("  → Group 1 (10m perimeter):", anchorGroups.group1_10m.length, "anchors");
    console.log("  → Group 2 (15m perimeter):", anchorGroups.group2_15m.length, "anchors");
    console.log("  → Group 3 (7m perimeter):", anchorGroups.group3_7m.length, "anchors");

    ANCHORS.forEach(anchor => {
      const radius = Math.max(4, Math.min(8, Math.round(window.devicePixelRatio * 4)));

      // Determine activation perimeter and corona size for this anchor
      let activationPerimeter = 7; // default
      let coronaRadius = 30; // default for 7m

      if (anchorGroups.group1_10m.includes(anchor.anchorNumber)) {
        activationPerimeter = 10;
        coronaRadius = 43; // 30 * (10/7) ≈ 43
      } else if (anchorGroups.group2_15m.includes(anchor.anchorNumber)) {
        activationPerimeter = 15;
        coronaRadius = 64; // 30 * (15/7) ≈ 64
      } else {
        activationPerimeter = 7;
        coronaRadius = 30;
      }

      // console.log(`⚡ [CORONA-SIZE] Anchor ${anchor.anchorNumber}: ${activationPerimeter}m perimeter → ${coronaRadius}px corona`);

      // Main anchor marker (black circle)
      const baseMarker = L.circleMarker([anchor.lat, anchor.lng], {
        radius,
        color: '#000000',
        fillColor: '#0f172a',
        fillOpacity: 0.9,
        weight: 2
      }).addTo(anchorLayer);

      // Corona effect (ALWAYS VISIBLE, proportional size) - add to CORONA layer, not anchor layer
      const flashlight = L.circleMarker([anchor.lat, anchor.lng], {
        radius: coronaRadius,
        color: 'transparent',
        fillColor: '#f59e0b', // amber-500
        fillOpacity: 0.3,
        weight: 0,
        interactive: false
      }).addTo(coronaLayer); // Add to corona layer, NOT anchor layer!

      // Core effect
      const core = L.circleMarker([anchor.lat, anchor.lng], {
        radius,
        color: '#000000',
        fillColor: '#0f172a',
        fillOpacity: 0.4,
        weight: 1,
        interactive: false
      }).addTo(anchorLayer);

      const flashlightEl = flashlight.getElement();
      if (flashlightEl) {
        flashlightEl.classList.add('anchor-flashlight');
      }
      const coreEl = core.getElement();
      if (coreEl) {
        coreEl.classList.add('anchor-core');
      }

      // Add permanent anchor ID number tooltip
      baseMarker.bindTooltip(`${anchor.anchorNumber}`, {
        permanent: true,
        direction: 'top',
        className: 'anchor-tooltip',
        offset: [0, -5]
      });

      baseMarker.on('click', () => {
        console.log(`Kotva ${anchor.anchorNumber} clicked`);
      });

      window.sshrAnchorMarkers.push({
        id: anchor.anchorNumber,
        marker: baseMarker,
        flashlight,
        core,
        activationPerimeter, // Store perimeter for proximity detection
        coronaRadius // Store corona size
      });
    });

    console.log(`✅ [SSHR-ANCHORS] Loaded ${ANCHORS.length} anchors with PERMANENT corona effects`);
    console.log(`⚡ [CORONA-LAYER] Corona effects are NOW INDEPENDENT of Animation Layers`);
  } else {
    console.warn("⚠️ [SSHR-ANCHORS] ANCHORS not found, skipping anchor rendering");
  }
}

// ============================================================================
// ANCHOR PROXIMITY DETECTION & GLOW EFFECTS
// ============================================================================

function checkSSHRAnchorProximity(personData) {
  if (!personData || !personData.lat || !personData.lng || !window.sshrAnchorMarkers) return;

  const personPos = L.latLng(personData.lat, personData.lng);

  window.sshrAnchorMarkers.forEach(({ id, marker, flashlight, core, activationPerimeter, coronaRadius }) => {
    const anchorPos = marker.getLatLng();
    const dist = personPos.distanceTo(anchorPos);

    // Use stored activation perimeter from anchor definition
    const activationRadius = activationPerimeter || 7; // fallback to 7m

    // Removed debug log for performance

    if (dist <= activationRadius) {
      activateSSHRAnchorGlow(marker, flashlight, core, activationRadius, coronaRadius);
    } else {
      deactivateSSHRAnchorGlow(marker, flashlight, core);
    }
  });
}

function activateSSHRAnchorGlow(marker, flashlight, core, activationRadius = 7, presetCoronaRadius = null) {
  // Enhanced marker style - keep indigo-800 but brighter
  marker.setStyle({
    color: '#3730a3', // Tailwind indigo-700 (brighter)
    fillColor: '#3730a3',
    radius: 8,
    weight: 3
  });

  console.log(`✨ [CORONA-GLOW] Activating anchor with radius ${activationRadius}m → corona size already set (PERMANENT), just animating`);

  // Anime.js pulsing flashlight with amber-500 - NO SIZE CHANGE, just animation
  if (typeof anime !== 'undefined' && flashlight._path) {
    if (flashlight._animeInstance) {
      flashlight._animeInstance.pause();
    }

    // DON'T change the radius - it's already set correctly in loadSSHRAnchors
    flashlight.setStyle({
      opacity: 0.6,
      fillOpacity: 0.4,
      fillColor: '#f59e0b' // Tailwind amber-500 (changed from amber-400)
      // radius: coronaRadius // REMOVED - don't override the preset size
    });

    flashlight._animeInstance = anime({
      targets: flashlight._path,
      opacity: [0.3, 0.7],
      duration: 1500,
      easing: 'easeInOutSine',
      loop: true,
      direction: 'alternate'
    });
  }

  // Activate core with amber-500
  core.setStyle({
    opacity: 1,
    fillOpacity: 0.9,
    fillColor: '#f59e0b', // Tailwind amber-500 (changed from amber-400)
    color: '#f59e0b', // Tailwind amber-500
    radius: 8
  });
}

function deactivateSSHRAnchorGlow(marker, flashlight, core) {
  // Reset to default zinc-950 state
  marker.setStyle({
    color: '#000000', // Black
    fillColor: '#0f172a',
    radius: 5,
    weight: 2
  });

  // Stop animation but DON'T hide corona completely - keep it visible with reduced opacity
  if (flashlight._animeInstance) {
    flashlight._animeInstance.pause();
    flashlight._animeInstance = null;
  }

  // Keep corona visible but with reduced opacity (PERMANENT visibility)
  flashlight.setStyle({
    opacity: 0.3,       // Reduced but still visible
    fillOpacity: 0.1,   // Reduced but still visible
    fillColor: '#f59e0b' // Keep amber-500 color
    // DON'T change radius - keep the preset size
  });

  core.setStyle({
    opacity: 0.4,       // Reduced but still visible
    fillOpacity: 0.4,   // Reduced but still visible
    fillColor: '#0f172a'
  });

  // Corona deactivated - removed debug log for performance
}

// Export proximity function globally
window.checkSSHRAnchorProximity = checkSSHRAnchorProximity;

// Export anchor activation functions globally for parallel-tracking integration
window.activateAnchorFlashlight = function(anchorId, activationRadius = 7) {
  if (!window.sshrAnchorMarkers) return;

  const anchorData = window.sshrAnchorMarkers.find(anchor => anchor.id === anchorId);
  if (anchorData) {
    activateSSHRAnchorGlow(anchorData.marker, anchorData.flashlight, anchorData.core, activationRadius);
  }
};

window.deactivateAllAnchorFlashlights = function() {
  if (!window.sshrAnchorMarkers) return;

  window.sshrAnchorMarkers.forEach(({ marker, flashlight, core }) => {
    deactivateSSHRAnchorGlow(marker, flashlight, core);
  });
};

// ============================================================================
// INFRA ELEMENTS SYSTEM
// ============================================================================

// INFRA element icon mapping
const INFRA_ICON_MAP = {
  'Dieselagregát': { icon: 'fas fa-gas-pump', abbr: 'DAG' },
  'HUP': { icon: 'fas fa-fire', abbr: 'HUP' },
  'HUE': { icon: 'fas fa-bolt', abbr: 'HUE' },
  'Hydrant': { icon: 'fas fa-tint', abbr: 'HYD' },
  'Požární hlásič': { icon: 'fas fa-exclamation-triangle', abbr: 'PHl' },
  'RHP': { icon: 'fas fa-fire-extinguisher', abbr: 'RHP' },
  'Vchod do skladu': { icon: 'fas fa-door-open', abbr: 'GATE' },
  'Vchod do servisní místnosti': { icon: 'fas fa-tools', abbr: 'SERV' }
};

// Get icon and abbreviation for INFRA element
function getInfraIconAndAbbr(elementName) {
  // Try exact match first
  if (INFRA_ICON_MAP[elementName]) {
    return INFRA_ICON_MAP[elementName];
  }

  // Try partial matches
  for (const [key, iconData] of Object.entries(INFRA_ICON_MAP)) {
    if (elementName.includes(key) || elementName.startsWith(key)) {
      return iconData;
    }
  }

  // Default icon and abbreviation
  return { icon: 'fas fa-cog', abbr: 'UNK' };
}

// Load and render INFRA elements
function loadSSHRInfraElements() {
  console.log("🏭 [SSHR-INFRA] Loading infrastructure elements...");

  if (!window.INFRA_PRVKY || !Array.isArray(window.INFRA_PRVKY)) {
    console.warn("⚠️ [SSHR-INFRA] INFRA_PRVKY not found, skipping infra rendering");
    return;
  }

  // Create infra layer (don't add to map immediately)
  const infraLayer = L.layerGroup();
  window.sshrLayers.set('infra-elements', infraLayer);
  // Note: Layer will be added to map by the Animation Layers logic

  // Store infra elements globally
  window.sshrInfraElements = new Map();

  window.INFRA_PRVKY.forEach((element, index) => {
    const lat = element.coordinates.lat;
    const lng = element.coordinates.lon;
    const priority = element.priority;
    const name = element.name;

    // Get priority colors
    const priorityColor = priority === 'HIGH' ? '#dc2626' : '#d97706'; // red-600 : amber-600
    const textColor = priority === 'HIGH' ? '#7f1d1d' : '#f59e0b'; // red-900 : amber-500
    const iconAndAbbr = getInfraIconAndAbbr(name);

    // Create custom icon with icon + text (responsive, 20% smaller)
    const infraIcon = L.divIcon({
      className: 'custom-infra-icon',
      html: `
        <div class="infra-element-marker" data-element-id="${index}" style="
          background: ${priorityColor};
          border: 2px solid white;
          border-radius: 6px;
          width: 32px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 2px;
          color: white;
          font-size: 10px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          transition: all 0.3s ease;
          flex-direction: row;
          transform: scale(0.8);
          transform-origin: center;
        ">
          <i class="${iconAndAbbr.icon}" style="font-size: 8px; color: white;"></i>
          <span style="font-size: 7px; font-weight: bold; color: white;">${iconAndAbbr.abbr}</span>
        </div>
        <style>
          .infra-element-marker {
            cursor: pointer;
          }
          .infra-element-marker:hover {
            transform: scale(1.1) !important;
            z-index: 1000;
          }
          @media (max-width: 768px) {
            .infra-element-marker {
              transform: scale(0.7) !important;
            }
          }
        </style>
      `,
      iconSize: [32, 22],
      iconAnchor: [16, 11]
    });

    // Create marker
    const marker = L.marker([lat, lng], { icon: infraIcon });

    // Add tooltip
    marker.bindTooltip(`
      <div style="font-size: 12px;">
        <strong>${name}</strong><br>
        <span style="color: ${priorityColor};">Priority: ${priority}</span><br>
        <small>GPS: ${lat.toFixed(6)}, ${lng.toFixed(6)}</small>
      </div>
    `, {
      permanent: false,
      direction: 'top',
      offset: [0, -20]
    });

    // Store element data
    const elementData = {
      id: index,
      name,
      lat,
      lng,
      priority,
      marker,
      proximityActive: false,
      proximityStartTime: null,
      proximityDuration: 0
    };

    window.sshrInfraElements.set(index, elementData);
    infraLayer.addLayer(marker);
  });

  console.log(`✅ [SSHR-INFRA] Loaded ${window.INFRA_PRVKY.length} infrastructure elements`);
}

// INFRA proximity detection (2m radius)
function checkSSHRInfraProximity(personId, lat, lng) {
  if (!window.sshrInfraElements) return;

  window.sshrInfraElements.forEach((element, elementId) => {
    const distance = calculateDistance(lat, lng, element.lat, element.lng);
    const isNearby = distance <= 2.0; // 2m radius

    if (isNearby && !element.proximityActive) {
      // Start proximity
      activateSSHRInfraProximity(personId, element, distance);
    } else if (!isNearby && element.proximityActive) {
      // End proximity
      deactivateSSHRInfraProximity(personId, element);
    } else if (isNearby && element.proximityActive) {
      // Update proximity duration
      updateSSHRInfraProximityDuration(element, distance);
    }
  });
}

// Activate INFRA proximity effects
function activateSSHRInfraProximity(personId, element, distance) {
  console.log(`🚨 [INFRA-PROXIMITY] Person ${personId} near ${element.name}`);

  element.proximityActive = true;
  element.proximityStartTime = Date.now();
  element.lastPersonId = personId;

  // Add corona effect (yellow-400)
  const marker = element.marker;
  const markerElement = marker.getElement();
  if (markerElement) {
    const infraDiv = markerElement.querySelector('.infra-element-marker');
    if (infraDiv) {
      // Add corona glow
      infraDiv.style.boxShadow = '0 0 20px #facc15, 0 0 40px #facc15'; // yellow-400
      infraDiv.style.transform = 'scale(1.2)';
    }
  }

  // Make person marker blink
  activatePersonMarkerBlink(personId);

  // Log incident
  logInfraIncident(personId, element, 'proximity_start');

  syncInfraContextToTracker(personId, {
    element,
    distance
  });
}

// Deactivate INFRA proximity effects
function deactivateSSHRInfraProximity(personId, element) {
  console.log(`✅ [INFRA-PROXIMITY] Person ${personId} left ${element.name} (duration: ${element.proximityDuration}s)`);

  element.proximityActive = false;
  element.lastPersonId = null;

  // Remove corona effect
  const marker = element.marker;
  const markerElement = marker.getElement();
  if (markerElement) {
    const infraDiv = markerElement.querySelector('.infra-element-marker');
    if (infraDiv) {
      const priorityColor = element.priority === 'HIGH' ? '#dc2626' : '#d97706';
      infraDiv.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
      infraDiv.style.transform = 'scale(1.0)';
    }
  }

  // Stop person marker blink
  deactivatePersonMarkerBlink(personId);

  // Log incident end
  logInfraIncident(personId, element, 'proximity_end');

  // Reset duration
  element.proximityDuration = 0;
  element.proximityStartTime = null;

  syncInfraContextToTracker(personId, null);
}

// Update proximity duration
function updateSSHRInfraProximityDuration(element, currentDistance) {
  if (element.proximityStartTime) {
    element.proximityDuration = Math.floor((Date.now() - element.proximityStartTime) / 1000);
    if (element.lastPersonId && Number.isFinite(currentDistance)) {
      syncInfraContextToTracker(element.lastPersonId, {
        element,
        distance: currentDistance
      });
    }
  }
}

function syncInfraContextToTracker(personId, context) {
  if (!personId) return;

  const tracker = (window.SSHR && window.SSHR.personTracker) || window.personTracker || null;
  if (!tracker) return;

  let person = null;
  if (typeof tracker.getPerson === 'function') {
    person = tracker.getPerson(personId);
  } else if (tracker.persons && typeof tracker.persons.get === 'function') {
    person = tracker.persons.get(personId);
  }

  if (!person) {
    return;
  }

  if (context && context.element) {
    person.lastInfraElement = context.element.name || context.element.id || null;
    person.lastInfraDistance = Number.isFinite(context.distance) ? context.distance : null;
  } else {
    person.lastInfraElement = null;
    person.lastInfraDistance = null;
  }
}

// Person marker blinking functions
function activatePersonMarkerBlink(personId) {
  // Use PersonTracker if available
  if (window.ParallelEngine && window.ParallelEngine.personTracker) {
    window.ParallelEngine.personTracker.activateMarkerBlink(personId);
  } else {
    console.log(`🔴 [PERSON-BLINK] Activating blink for person ${personId} (PersonTracker not available)`);
  }
}

function deactivatePersonMarkerBlink(personId) {
  // Use PersonTracker if available
  if (window.ParallelEngine && window.ParallelEngine.personTracker) {
    window.ParallelEngine.personTracker.deactivateMarkerBlink(personId);
  } else {
    console.log(`⚪ [PERSON-BLINK] Deactivating blink for person ${personId} (PersonTracker not available)`);
  }
}

// Log INFRA incident
function logInfraIncident(personId, element, type) {
  const incident = {
    timestamp: new Date(),
    personId,
    type: 'infra_proximity',
    subtype: type,
    elementName: element.name,
    elementPriority: element.priority,
    duration: element.proximityDuration,
    position: { lat: element.lat, lng: element.lng }
  };

  // Add to global incidents
  if (!window.sshrIncidents) window.sshrIncidents = [];
  window.sshrIncidents.push(incident);

  console.log(`📝 [INFRA-INCIDENT] ${type} - Person ${personId} at ${element.name}`);
}

// Calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lng2-lng1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
}

// Export INFRA functions globally
window.loadSSHRInfraElements = loadSSHRInfraElements;
window.checkSSHRInfraProximity = checkSSHRInfraProximity;

// ============================================================================
// MAIN INITIALIZATION
// ============================================================================

function initSSHRRenderer() {
  console.log("🚀 [SSHR-INIT] Starting SSHR Bohuslavice renderer initialization...");

  try {
    // Initialize map
    const map = initSSHRMap();

    // NOTE: Zones and anchors are now loaded only on user selection in Animation Layers panel
    // renderSSHRZones(map); // Removed - zones loaded on demand
    // loadSSHRAnchors(); // Removed - anchors loaded on demand

  // Initialize systems
  if (window.SSHRCardManager && !window.SSHRCardManager.initialized) {
    window.SSHRCardManager.init();
    if (window.SSHR) {
      window.SSHR.visitorCardManager = window.SSHRCardManager;
    }
  }

  // NOTE: Visitor cards are handled by SSHRCardManager.init() above
  // initSSHRVisitorCards(); // REMOVED - conflicts with SSHRCardManager

    // Initialize SSHR Polygon Manager (Phase 3)
    const polygonManager = initSSHRPolygonManager(map);
    if (polygonManager && typeof polygonManager.loadPerimeterFence === 'function') {
      try {
        polygonManager.loadPerimeterFence();
      } catch (error) {
        console.error('❌ [SSHR-POLYGON] Unable to load perimeter fence:', error);
      }
    }

    if (window.SSHRParallel) {
      window.SSHRParallel.initialise({ map });
    }

    const trajectoryLayerManager = initSSHRTrajectoryLayerManager(map);
    if (trajectoryLayerManager) {
      console.log('🧭 [TRAJECTORY-LAYERS] Manager initialised');
    }

    const personalGroupingLayer = initSSHRPersonalGroupingLayer(map);
    if (personalGroupingLayer) {
      console.log('👥 [PERSONAL-GROUPING] Layer initialised');
    }

    if (window.SSHRIncidentEngine) {
      window.SSHRIncidentEngine.initialise({
        polygonManager: window.SSHR?.polygonManager || window.sshrPolygonManager || null
      });
    }

    // Set up update interval (changed to 10s to reduce console spam)
    setInterval(updateSSHRWidgets, SSHR_CONFIG.timings?.updateInterval ?? 10000);

    // Set up Jupiter GIS event listeners
    window.addEventListener('jupiter-analysis-updated', (event) => {
      console.log('🪐 [JUPITER-EVENT] Analysis updated, refreshing Widget 1');
      updateJupiterGISWidget();
    });

    console.log("✅ [SSHR-INIT] SSHR renderer initialization complete!");

    // Initial widget update
    updateSSHRWidgets();

  } catch (error) {
    console.error("❌ [SSHR-INIT] Initialization failed:", error);
  }
}

// ============================================================================
// CONSOLE API & EXPORTS
// ============================================================================

const sshrApi = {
  // Core API
  init: initSSHRRenderer,

  // Map API
  map: {
    get: () => window.sshrMap,
    center: centerMapOnPerson,
    resize: resizeMap,
    fitToFeatures: fitMapToFeatures
  },

  // Person API
  persons: {
    add: addSSHRPerson,
    remove: removeSSHRPerson,
    update: updateSSHRPersonPosition,
    get: getPersonById,
    getAll: getAllActivePersons,
    getInZone: getPersonsInZone
  },

  // Card API
  cards: {
    assign: assignCard,
    unassign: unassignCard,
    getAvailable: getAvailableCards,
    getAssigned: getAssignedCards
  },

  // Zone API
  zones: {
    check: checkSSHRZoneViolation,
    highlight: highlightZone,
    getAll: getAllZones
  },

  // Layer loading API (for on-demand loading)
  loadAnchors: loadSSHRAnchors,
  renderZones: renderSSHRZones,

  // Incident API
  incidents: {
    getAll: getAllIncidents,
    getActive: getActiveIncidents,
    clear: clearIncidents,
    export: exportIncidentReport
  },

  // Parallel API
  parallel: {
    engine: () => window.SSHRParallel || null,
    start: (datasets) => window.SSHRParallel ? window.SSHRParallel.startSession(datasets) : false,
    stop: () => window.SSHRParallel ? window.SSHRParallel.stopSession({ reason: 'api' }) : undefined,
    isActive: () => Boolean(window.SSHRParallel?.isActive?.()),
    getTracks: () => window.SSHRParallel?.getActiveTracks?.() || []
  },

  // Incident Engine reference
  incidentEngine: () => window.SSHRIncidentEngine || null,

  // Utility API
  utils: {
    generateId: generateUniqueId,
    calculateDistance: calculateDistance,
    validateCoords: validateCoordinates
  },

  // Debug API
  debug: {
    dumpState: () => ({
      persons: Array.from(window.sshrPersons.entries()),
      cards: Array.from(window.sshrCards.entries()),
      incidents: window.sshrIncidents,
      config: window.SSHR_CONFIG || SSHR_CONFIG
    }),
    clearAll: () => {
      window.sshrPersons.clear();
      window.sshrCards.clear();
      window.sshrIncidents = [];
      clearAllLayers();
      updateSSHRWidgets();
    }
  }
};

window.SSHR = Object.assign(window.SSHR || {}, sshrApi);

// ============================================================================
// WIDGET 3 & 4 IMPLEMENTATION (Nov 6, 2025)
// ============================================================================

/**
 * Widget 3: Aktivní osoby v parallel režimu
 * Zobrazuje: 3 sloupce na řádek - Osoba č.___ | čas:___/ID kotvy | Segment:___
 */
function updateWidget3ActivePersons() {
  // console.log('[WIDGET-3] Updating active persons widget');

  const countElement = document.getElementById('sshr-active-persons-count');
  const listElement = document.getElementById('sshr-active-persons-list');

  if (!countElement || !listElement) {
    console.warn('[WIDGET-3] Widget elements not found');
    return;
  }

  // Získat osoby z window.sshrPersons
  const allPersons = window.sshrPersons || new Map();

  // Kontrola, zda allPersons je iterovatelné
  if (!allPersons || typeof allPersons[Symbol.iterator] !== 'function') {
    console.warn('[WIDGET-3] allPersons is not iterable:', allPersons);
    return;
  }

  const tracker = getActivePersonTracker();
  const cardManager = window.SSHRCardManager || null;

  const activePeople = Array.from(allPersons).map(([id, person]) => {
    const panelKey = `person-info-${person.id || id}`;
    const cardInfo = cardManager?.getCardByPanel ? cardManager.getCardByPanel(panelKey) : null;

    // Sestavit jméno
    let displayName = `OSOBA č.${person.cardId || id}`;
    if (cardInfo) {
      if (cardInfo.type === 'person' && cardInfo.person) {
        const first = cardInfo.person.firstName || '';
        const last = cardInfo.person.lastName || '';
        const combined = `${first} ${last}`.trim();
        if (combined) {
          displayName = combined;
        }
      } else if (cardInfo.type === 'truck' && cardInfo.truck) {
        const driver = cardInfo.truck.driverName || 'Řidič';
        const plate = cardInfo.truck.plate || '';
        displayName = `${driver} ${plate}`.trim();
      }
    }

    // Získat čas aktivace (aktuální timestamp nebo simulace)
    const activationTime = person.metadata?.lastUpdate || person.lastUpdate || new Date();
    const formattedActivation = formatTimestamp(activationTime);

    // Získat ID kotvy z PersonTracker (lastActivatedAnchors)
    let anchorId = null;
    if (tracker && tracker.lastActivatedAnchors?.get) {
      const lastAnchor = tracker.lastActivatedAnchors.get(person.id);
      anchorId = lastAnchor?.anchorId || lastAnchor?.anchorNumber || null;
    } else if (person.lastActivatedAnchors && person.lastActivatedAnchors.length > 0) {
      const latestAnchor = person.lastActivatedAnchors[person.lastActivatedAnchors.length - 1];
      anchorId = latestAnchor.anchorNumber || latestAnchor.id || null;
    }

    // Získat segment z PersonTracker (getGreenZoneSegment)
    let segment = '—';
    if (tracker && typeof tracker.getGreenZoneSegment === 'function' && person.position) {
      segment = tracker.getGreenZoneSegment(person.position) || '—';
    } else if (typeof person.zoneStatus === 'string') {
      segment = person.zoneStatus;
    }

    return {
      id,
      displayName,
      activationTime: formattedActivation,
      anchorId,
      segment,
      cardInfo
    };
  });

  // Aktualizovat počet
  countElement.textContent = activePeople.length;

  // Aktualizovat seznam ve formátu 3 sloupců na řádek
  if (activePeople.length === 0) {
    listElement.innerHTML = '<div class="mb-1" style="color: white; font-size: 11px;">Žádné aktivní osoby</div>';
  } else {
    const listHTML = activePeople.map(person => `
      <div class="mb-1" style="display: flex; justify-content: space-between; align-items: center; line-height: 1.1; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 1px;">
        <div style="flex: 1; font-size: 8px;">
          <strong>${person.displayName.length > 12 ? person.displayName.substring(0, 12) + '...' : person.displayName}</strong>
        </div>
        <div style="flex: 1; font-size: 8px; text-align: center;">
          ${person.activationTime}/<span style="color: #60a5fa;">${person.anchorId || '—'}</span>
        </div>
        <div style="flex: 1; font-size: 8px; text-align: right;">
          <span style="color: ${person.segment === 'RESTRICTED' ? '#ef4444' : person.segment === 'A' ? '#22c55e' : '#fbbf24'};">${person.segment}</span>
        </div>
      </div>
    `).join('');

    listElement.innerHTML = listHTML;
  }

  // console.log(`[WIDGET-3] Updated: ${activePeople.length} active persons`);
}

/**
 * Widget 4: Počet osob v areálu
 * Zobrazuje: 2x2 tabulka - registrované vs neregistrované, v povolené vs nepovolené zóně
 * Logika: Fixed zones = defaultní GREEN/RED polygons | Variable zones = dynamické potvrzené zóny
 * Pravidlo: RED polygons = RED FENCE perimetr - GREEN polygons
 */
function updateWidget4PersonStats() {
  // console.log('[WIDGET-4] Updating person statistics widget');

  const totalElement = document.getElementById('sshr-person-count');
  const registeredElement = document.getElementById('sshr-registered-count');
  const unregisteredElement = document.getElementById('sshr-unregistered-count');
  const greenZoneElement = document.getElementById('sshr-in-green-zone');
  const redZoneElement = document.getElementById('sshr-in-red-zone');

  if (!totalElement || !registeredElement || !unregisteredElement || !greenZoneElement || !redZoneElement) {
    console.warn('[WIDGET-4] Widget elements not found');
    return;
  }

  // Získat osoby z window.sshrPersons
  const allPersons = window.sshrPersons || new Map();

  const tracker = getActivePersonTracker();
  const cardManager = window.SSHRCardManager || null;

  const activePeople = Array.from(allPersons);
  const totalCount = activePeople.length;

  let registeredCount = 0;
  let unregisteredCount = 0;
  let inGreenZone = 0;
  let inRedZone = 0;

  // Získat aktuální polygon mode (Fixed vs Variable)
  const polygonManager = window.sshrPolygonManager || window.SSHR?.polygonManager;
  const currentMode = polygonManager ? polygonManager.mode : 'FIXED';

  // console.log(`[WIDGET-4] Polygon mode: ${currentMode}`);

  activePeople.forEach(([id, person]) => {
    // 1. ✅ OPRAVENÁ KONTROLA: Registrace přes návštěvnické karty
    const panelKey = `person-info-${person.id || id}`;
    // Removed debug logs for performance

    const cardInfo = cardManager?.getCardByPanel ? cardManager.getCardByPanel(panelKey) : null;
    // Card info retrieved - debug log removed for performance

    let isRegistered = false;

    if (cardInfo) {
      // Kontrola podle správné struktury Card Manager
      if (cardInfo.person && cardInfo.person.firstName && cardInfo.person.lastName) {
        isRegistered = true; // Osobní karta s jménem
      } else if (cardInfo.truck && cardInfo.truck.driverName) {
        isRegistered = true; // Karta kamionu s řidičem
      }
    }

    if (isRegistered) {
      registeredCount++;
    } else {
      unregisteredCount++;
    }

    // 2. Kontrola zóny pomocí PersonTracker metod
    let personZoneStatus = 'NEUTRAL';

    if (tracker && person.position) {
      // Použít PersonTracker pro určení zone statusu
      const zoneStatus = tracker.getPersonZoneStatus?.(id);
      if (zoneStatus) {
        personZoneStatus = zoneStatus.zone || 'NEUTRAL';
      } else {
        // Fallback: kontrola segmentu
        const segment = tracker.getGreenZoneSegment?.(person.position);
        if (segment && segment !== '—') {
          personZoneStatus = 'GREEN';
        }
      }
    } else {
      // Fallback na person.zoneStatus pro starší kompatibilitu
      personZoneStatus = person.zoneStatus || 'NEUTRAL';
    }

    // Přiřadit ke statistikám
    if (personZoneStatus === 'GREEN') {
      inGreenZone++;
    } else if (personZoneStatus === 'RED') {
      inRedZone++;
    }
  });

  // Aktualizovat hodnoty v 2x2 tabulce
  totalElement.textContent = totalCount;
  registeredElement.textContent = registeredCount;
  unregisteredElement.textContent = unregisteredCount;
  greenZoneElement.textContent = inGreenZone;
  redZoneElement.textContent = inRedZone;

  // Vizuální upozornění na červenou zónu
  redZoneElement.style.fontWeight = 'bold';
  redZoneElement.style.color = 'white';

  // console.log(`[WIDGET-4] Updated stats (${currentMode} mode): Total=${totalCount}, Registered=${registeredCount}, Green=${inGreenZone}, Red=${inRedZone}`);
}

/**
 * Widget 1: Jupiter GIS Analytics
 * Zobrazuje: Risk score, patterns, anomalies, connection status
 */
function updateJupiterGISWidget() {
  // console.log('[WIDGET-1] Updating Jupiter GIS Analytics widget');

  const riskScoreElement = document.getElementById('jupiter-risk-score');
  const riskLevelElement = document.getElementById('jupiter-risk-level');
  const patternCountElement = document.getElementById('jupiter-pattern-count');
  const patternConfidenceElement = document.getElementById('jupiter-pattern-confidence');
  const anomalyCountElement = document.getElementById('jupiter-anomaly-count');
  const connectionStatusElement = document.getElementById('jupiter-connection-status');

  if (!riskScoreElement || !riskLevelElement || !patternCountElement ||
      !patternConfidenceElement || !anomalyCountElement || !connectionStatusElement) {
    console.warn('[WIDGET-1] Jupiter GIS widget elements not found');
    return;
  }

  // Check Jupiter GIS connector status
  const jupiterConnector = window.SSHR?.jupiterGIS;

  if (!jupiterConnector) {
    // Jupiter GIS not available
    riskScoreElement.textContent = '--';
    riskLevelElement.textContent = 'N/A';
    riskLevelElement.className = 'badge badge-sm bg-secondary';
    patternCountElement.textContent = '0';
    patternConfidenceElement.textContent = '0%';
    anomalyCountElement.textContent = '0';
    connectionStatusElement.textContent = 'Not Available';
    connectionStatusElement.className = 'text-danger';
    return;
  }

  const status = jupiterConnector.getAnalyticsStatus();

  // Update connection status
  if (status.connected) {
    connectionStatusElement.textContent = 'Connected';
    connectionStatusElement.className = 'text-success';
  } else {
    connectionStatusElement.textContent = 'Connecting...';
    connectionStatusElement.className = 'text-warning';
  }

  // Update analytics data if available
  if (status.lastAnalysis) {
    const analysis = status.lastAnalysis;

    // Risk score and level
    if (analysis.risk_assessment) {
      riskScoreElement.textContent = analysis.risk_assessment.score;

      const riskLevel = analysis.risk_assessment.level;
      riskLevelElement.textContent = riskLevel;

      // Color coding for risk level
      if (riskLevel === 'HIGH') {
        riskLevelElement.className = 'badge badge-sm bg-danger';
      } else if (riskLevel === 'MEDIUM') {
        riskLevelElement.className = 'badge badge-sm bg-warning';
      } else {
        riskLevelElement.className = 'badge badge-sm bg-success';
      }
    }

    // Pattern analysis
    if (analysis.pattern_analysis) {
      patternCountElement.textContent = analysis.pattern_analysis.patterns_detected || 0;

      const confidence = Math.round((analysis.pattern_analysis.confidence || 0) * 100);
      patternConfidenceElement.textContent = `${confidence}%`;
    }

    // Anomaly detection
    if (analysis.anomaly_detection) {
      anomalyCountElement.textContent = analysis.anomaly_detection.anomalies_count || 0;
    }

  } else {
    // No analysis data yet
    riskScoreElement.textContent = '--';
    riskLevelElement.textContent = 'Analyzing...';
    riskLevelElement.className = 'badge badge-sm bg-info';
    patternCountElement.textContent = '0';
    patternConfidenceElement.textContent = '0%';
    anomalyCountElement.textContent = '0';
  }

  // console.log(`[WIDGET-1] Updated Jupiter Analytics: Connected=${status.connected}, Analyses=${status.metrics?.totalAnalyses || 0}`);
}

// ============================================================================
// AUTO-INITIALIZATION
// ============================================================================

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSSHRRenderer);
} else {
  // DOM already loaded
  setTimeout(initSSHRRenderer, 100);
}

console.log("📦 [SSHR-RENDERER] SSHR Bohuslavice renderer v2.0.0 loaded!");
console.log("🔧 [SSHR-RENDERER] Access via window.SSHR object for console debugging");

/*
 * TODO LIST FOR FUTURE IMPLEMENTATION:
 * =====================================
 *
 * Phase 2 - Core Functionality:
 * - [ ] Implement smooth marker animations with Anime.js
 * - [ ] Add real-time position updates via WebSocket/polling
 * - [ ] Create entry/exit modal forms
 * - [ ] Add sound notifications for incidents
 * - [ ] Implement drag & drop for existing persons
 *
 * Phase 3 - Advanced Features:
 * - [ ] Advanced zone detection algorithms
 * - [ ] Historical tracking and playback
 * - [ ] Geofencing alerts with custom polygons
 * - [ ] Integration with external tracking systems
 * - [ ] Advanced reporting and analytics
 *
 * Phase 4 - Polish & Production:
 * - [ ] Offline mode with IndexedDB
 * - [ ] Multi-language support
 * - [ ] Keyboard shortcuts and accessibility
 * - [ ] Performance optimization for 100+ persons
 * - [ ] Mobile responsive design improvements
 * - [ ] Unit tests and integration tests
 */

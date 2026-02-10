/**
 * Rumburk - Zone definitions & runtime API
 * ----------------------------------------
 * - Maintains default (fixed) GREEN polygons derived from the site survey.
 * - Computes dynamic RED zones as the fenced perimeter minus all GREEN areas.
 * - Exposes runtime helpers for the UI (management mode) to override GREEN zones.
 * - Emits `sshr-zones-updated` events whenever the topology changes so that the
 *   renderer and incident engine can refresh their caches.
 */

(function defineSshrZones(global) {
  const turfAvailable = typeof turf !== 'undefined';

  const FENCE_COORDS = [
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
  ];

  const DEFAULT_GREEN_RAW = [
    {
      id: 'GREEN_A',
      name: 'GREEN ZONE A',
      coordinates: [
        [50.95100253318565, 14.56913314619357],
        [50.950929657400415, 14.569684665572959],
        [50.95072718552232, 14.569602381983431],
        [50.95082997448223, 14.569038373977783],
        [50.95100253318565, 14.56913314619357]
      ]
    },
    {
      id: 'GREEN_B',
      name: 'GREEN ZONE B',
      coordinates: [
        [50.95094066735911, 14.569731721519434],
        [50.95103252917777, 14.56911501310856],
        [50.95114406007115, 14.569167801829972],
        [50.951076411332316, 14.56974966035037],
        [50.95094066735911, 14.569731721519434]
      ]
    },
    {
      id: 'GREEN_C',
      name: 'GREEN ZONE C',
      coordinates: [
        [50.951158722470126, 14.568488075960094],
        [50.95112923469715, 14.56915899347603],
        [50.9510064172326, 14.569097260630663],
        [50.95104288426972, 14.568435834602127],
        [50.951158722470126, 14.568488075960094]
      ]
    },
    {
      id: 'GREEN_D',
      name: 'GREEN ZONE D',
      coordinates: [
        [50.951025907977986, 14.568450817048722],
        [50.95092224735413, 14.569052916117466],
        [50.95079054835145, 14.56896041868564],
        [50.95088643168499, 14.568398169013564],
        [50.951025907977986, 14.568450817048722]
      ]
    },
    {
      id: 'GREEN_E',
      name: 'GREEN ZONE E',
      coordinates: [
        [50.95085348632671, 14.568703916402923],
        [50.95083194414188, 14.569008328287833],
        [50.95053167273161, 14.568761055192946],
        [50.95055846742653, 14.568627186965646],
        [50.95085348632671, 14.568703916402923]
      ]
    },
    {
      id: 'GREEN_F',
      name: 'GREEN ZONE F',
      coordinates: [
        [50.95089402169651, 14.568395187125269],
        [50.950568018912826, 14.5683769812171],
        [50.95050661472083, 14.568593441817383],
        [50.950866791651, 14.568682785171358],
        [50.95089402169651, 14.568395187125269]
      ]
    }
  ];

  const ensureClosed = (coords = []) => {
    if (!coords.length) return [];
    const closed = coords.map(([lat, lng]) => [Number(lat), Number(lng)]);
    const [firstLat, firstLng] = closed[0];
    const [lastLat, lastLng] = closed[closed.length - 1];
    if (firstLat !== lastLat || firstLng !== lastLng) {
      closed.push([firstLat, firstLng]);
    }
    return closed;
  };

  const toLngLat = (coords = []) => coords.map(([lat, lng]) => [lng, lat]);
  const toLatLng = (coords = []) => coords.map(([lng, lat]) => [lat, lng]);

  const deepCopy = (value) => JSON.parse(JSON.stringify(value));

  function buildFenceFeature() {
    const coordinates = ensureClosed(FENCE_COORDS);
    const lngLat = toLngLat(coordinates);
    return {
      id: 'FENCE',
      name: 'Perimeter Fence',
      type: 'fence',
      coordinates,
      lngLat,
      turf: turfAvailable ? turf.polygon([lngLat]) : null
    };
  }

  function normaliseGreens(rawGreens = []) {
    return rawGreens.map((entry, index) => {
      const coordinates = ensureClosed(entry.coordinates || []);
      const lngLat = toLngLat(coordinates);
      const polygon = turfAvailable ? turf.polygon([lngLat]) : null;
      const bbox = polygon ? turf.bbox(polygon) : null;
      return {
        id: entry.id || `GREEN_${index + 1}`,
        name: entry.name || `Green Zone ${index + 1}`,
        type: 'green',
        coordinates,
        lngLat,
        turf: polygon,
        bbox
      };
    });
  }

  function buildRedPolygons(fenceLngLat, greens) {
    if (!turfAvailable) return [];
    let base = turf.polygon([fenceLngLat]);
    greens.forEach((green) => {
      if (green.turf) {
        const updated = turf.difference(base, green.turf);
        if (updated) {
          base = updated;
        }
      }
    });

    if (!base) {
      return [];
    }

    const coordinateSets = base.geometry.type === 'Polygon'
      ? [base.geometry.coordinates]
      : base.geometry.coordinates;

    return coordinateSets.map((coords, index) => {
      const latLngRings = coords.map((ring) => toLatLng(ring));
      const polygon = turf.polygon(coords);
      const bbox = turf.bbox(polygon);
      return {
        id: `RED_${index + 1}`,
        name: `Restricted Zone ${index + 1}`,
        type: 'red',
        coordinates: latLngRings,
        lngLat: coords,
        turf: polygon,
        bbox
      };
    });
  }

  function buildHelpers(fence, greens, reds) {
    return {
      pointInFence(lat, lng) {
        if (turfAvailable && fence.turf) {
          return turf.booleanPointInPolygon(turf.point([lng, lat]), fence.turf);
        }
        return false;
      },
      pointInGreen(lat, lng) {
        if (!turfAvailable) return false;
        const point = turf.point([lng, lat]);
        return greens.some((green) => green.turf && turf.booleanPointInPolygon(point, green.turf));
      },
      pointInRed(lat, lng) {
        if (!turfAvailable) {
          return this.pointInFence(lat, lng) && !this.pointInGreen(lat, lng);
        }
        const point = turf.point([lng, lat]);
        if (!reds.length) {
          return this.pointInFence(lat, lng) && !this.pointInGreen(lat, lng);
        }
        return reds.some((red) => red.turf && turf.booleanPointInPolygon(point, red.turf));
      }
    };
  }

  function buildZoneState(rawGreens, metadata) {
    const fence = buildFenceFeature();
    const greens = normaliseGreens(rawGreens);
    const reds = buildRedPolygons(fence.lngLat, greens);
    const helpers = buildHelpers(fence, greens, reds);

    return Object.freeze({
      fence,
      greens,
      reds,
      helpers,
      metadata: {
        ...metadata,
        generatedAt: new Date().toISOString(),
        source: metadata?.source || 'runtime'
      }
    });
  }

  let currentGreenRaw = deepCopy(DEFAULT_GREEN_RAW);
  let currentState = null;
  let currentMode = 'default';

  function dispatchUpdate(detail = {}) {
    if (typeof global.dispatchEvent === 'function') {
      global.dispatchEvent(new CustomEvent('sshr-zones-updated', {
        detail: {
          mode: currentMode,
          ...detail
        }
      }));
    }
  }

  function applyState(state, detail = {}) {
    currentState = state;
    currentMode = detail.mode || currentMode;
    global.SSHR_ZONES = state;
    dispatchUpdate(detail);
  }

  function resetToDefault() {
    currentGreenRaw = deepCopy(DEFAULT_GREEN_RAW);
    const state = buildZoneState(currentGreenRaw, { source: 'default' });
    applyState(state, { mode: 'default', reason: 'reset' });
    return state;
  }

  function setManagementGreens(rawGreens = [], options = {}) {
    if (!Array.isArray(rawGreens) || rawGreens.length === 0) {
      throw new Error('setManagementGreens requires at least one polygon');
    }

    currentGreenRaw = rawGreens.map((zone, idx) => ({
      id: zone.id || `MANAGEMENT_GREEN_${idx + 1}`,
      name: zone.name || `Management Green ${idx + 1}`,
      coordinates: ensureClosed(zone.coordinates || [])
    }));

    const state = buildZoneState(currentGreenRaw, {
      source: 'management',
      count: currentGreenRaw.length,
      ...options
    });

    applyState(state, { mode: 'management', reason: 'set-management', count: currentGreenRaw.length });
    return state;
  }

  function getState() {
    return {
      mode: currentMode,
      greens: deepCopy(currentGreenRaw),
      zones: currentState
    };
  }

  const API = Object.freeze({
    resetToDefault,
    setManagementGreens,
    getState,
    getDefaultGreens: () => deepCopy(DEFAULT_GREEN_RAW),
    getFence: () => deepCopy(FENCE_COORDS)
  });

  global.SSHR_ZONES_API = API;
  resetToDefault();

  console.log('✅ [ZONES] Rumburk zone definitions loaded');
})(window);

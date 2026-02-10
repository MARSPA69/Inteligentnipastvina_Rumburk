/**
 * Rumburk Farm - Cattle Dataset Registry
 * ======================================
 * Central registry for all cow GPS tracking datasets.
 * Each dataset contains GPS + accelerometer data for one cow per day.
 *
 * Dataset naming: COW_{cowId}_{DDMMYY}
 * File naming: ID{cowId}_{DDMMYY}.js
 */

(function(global) {
  'use strict';

  // =========================================================================
  // DATASET REGISTRY
  // =========================================================================

  const CATTLE_DATASETS = {
    // Cow 1759595 - 5 days of data
    'COW_175959_121225': { file: 'ID175959_121225.js', cowId: '175959', date: '12.12.2025', records: 627 },
    'COW_175959_131225': { file: 'ID175959_131225.js', cowId: '175959', date: '13.12.2025', records: 1038 },
    'COW_175959_141225': { file: 'ID175959_141225.js', cowId: '175959', date: '14.12.2025', records: 1248 },
    'COW_175959_151225': { file: 'ID175959_151225.js', cowId: '175959', date: '15.12.2025', records: 907 },
    'COW_175959_161225': { file: 'ID175959_161225.js', cowId: '175959', date: '16.12.2025', records: 402 },

    // Cow 227831 - 3 days of data
    'COW_227831_141225': { file: 'ID227831_141225.js', cowId: '227831', date: '14.12.2025', records: 458 },
    'COW_227831_151225': { file: 'ID227831_151225.js', cowId: '227831', date: '15.12.2025', records: 894 },
    'COW_227831_161225': { file: 'ID227831_161225.js', cowId: '227831', date: '16.12.2025', records: 191 },

    // Cow 166691 - 3 days of data
    'COW_166691_141225': { file: 'ID166691_141225.js', cowId: '166691', date: '14.12.2025', records: 627 },
    'COW_166691_151225': { file: 'ID166691_151225.js', cowId: '166691', date: '15.12.2025', records: 779 },
    'COW_166691_161225': { file: 'ID166691_161225.js', cowId: '166691', date: '16.12.2025', records: 282 }
  };

  // =========================================================================
  // COW METADATA
  // =========================================================================

  const CATTLE_INFO = {
    '175959': {
      name: 'Krava 175959',
      imei: 'IMEI155',
      color: '#FF6B6B',  // červená
      icon: 'fa-cow'
    },
    '227831': {
      name: 'Krava 227831',
      imei: 'IMEI174',
      color: '#4ECDC4',  // tyrkysová
      icon: 'fa-cow'
    },
    '166691': {
      name: 'Krava 166691',
      imei: 'IMEI718',
      color: '#45B7D1',  // modrá
      icon: 'fa-cow'
    }
  };

  // =========================================================================
  // DATASET LOADER
  // =========================================================================

  /**
   * Get all available datasets
   */
  function getAvailableDatasets() {
    return Object.keys(CATTLE_DATASETS);
  }

  /**
   * Get datasets by cow ID
   */
  function getDatasetsByCow(cowId) {
    return Object.entries(CATTLE_DATASETS)
      .filter(([key, info]) => info.cowId === cowId)
      .map(([key, info]) => ({ key, ...info }));
  }

  /**
   * Get datasets by date
   */
  function getDatasetsByDate(dateStr) {
    return Object.entries(CATTLE_DATASETS)
      .filter(([key, info]) => info.date === dateStr)
      .map(([key, info]) => ({ key, ...info }));
  }

  /**
   * Get all unique dates
   */
  function getAvailableDates() {
    const dates = new Set(Object.values(CATTLE_DATASETS).map(d => d.date));
    return [...dates].sort();
  }

  /**
   * Get all unique cow IDs
   */
  function getAvailableCows() {
    return Object.keys(CATTLE_INFO);
  }

  /**
   * Get cow info by ID
   */
  function getCowInfo(cowId) {
    return CATTLE_INFO[cowId] || null;
  }

  /**
   * Load a specific dataset by key
   * @param {string} datasetKey - e.g., 'COW_1759595_121225'
   * @returns {Promise<Array>} - GPS data array
   */
  async function loadDataset(datasetKey) {
    const info = CATTLE_DATASETS[datasetKey];
    if (!info) {
      throw new Error(`Dataset '${datasetKey}' not found in registry`);
    }

    // Check if already loaded
    if (global[datasetKey] && Array.isArray(global[datasetKey])) {
      console.log(`[CATTLE] Dataset ${datasetKey} already loaded (${global[datasetKey].length} records)`);
      return global[datasetKey];
    }

    // Dynamic load
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `./${info.file}`;
      script.onload = () => {
        const data = global[datasetKey];
        if (Array.isArray(data)) {
          console.log(`[CATTLE] Loaded ${datasetKey}: ${data.length} records`);
          resolve(data);
        } else {
          reject(new Error(`Dataset ${datasetKey} loaded but data not found`));
        }
      };
      script.onerror = () => {
        reject(new Error(`Failed to load ${info.file}`));
      };
      document.body.appendChild(script);
    });
  }

  /**
   * Convert raw cow data to renderer format
   * @param {Array} rawData - Raw cow GPS data
   * @param {string} cowId - Cow ID for metadata
   * @returns {Array} - Renderer-compatible data
   */
  function convertToRendererFormat(rawData, cowId) {
    const cowInfo = CATTLE_INFO[cowId] || { name: `Krava ${cowId}`, color: '#FFFFFF' };

    return rawData.map((record, idx) => {
      // Parse timestamp to milliseconds
      const [h, m, s] = record.timestamp.split(':').map(Number);
      const timeMs = (h * 3600 + m * 60 + s) * 1000;

      return {
        lat: record.gps_lat,
        lng: record.gps_lon,
        time: timeMs,
        timeStr: record.timestamp,
        date: record.date,
        // Accelerometer data
        acc_x: record.acc_x,
        acc_y: record.acc_y,
        acc_z: record.acc_z,
        // Metadata
        entityId: cowId,
        entityName: cowInfo.name,
        entityColor: cowInfo.color,
        recordIndex: idx
      };
    }).sort((a, b) => a.time - b.time);
  }

  /**
   * Load and prepare dataset for animation
   */
  async function prepareDatasetForAnimation(datasetKey) {
    const info = CATTLE_DATASETS[datasetKey];
    if (!info) throw new Error(`Unknown dataset: ${datasetKey}`);

    const rawData = await loadDataset(datasetKey);
    return convertToRendererFormat(rawData, info.cowId);
  }

  /**
   * Load multiple datasets for parallel animation (multiple cows)
   * @param {Array<string>} datasetKeys - Array of dataset keys
   * @returns {Promise<Object>} - Object with cowId as key, data array as value
   */
  async function loadMultipleDatasetsForParallel(datasetKeys) {
    const results = {};

    for (const key of datasetKeys) {
      const info = CATTLE_DATASETS[key];
      if (!info) {
        console.warn(`[CATTLE] Unknown dataset: ${key}`);
        continue;
      }

      const rawData = await loadDataset(key);
      const formatted = convertToRendererFormat(rawData, info.cowId);

      if (!results[info.cowId]) {
        results[info.cowId] = [];
      }
      results[info.cowId].push(...formatted);
    }

    // Sort each cow's data by time
    for (const cowId of Object.keys(results)) {
      results[cowId].sort((a, b) => a.time - b.time);
    }

    return results;
  }

  // =========================================================================
  // UI HELPERS
  // =========================================================================

  /**
   * Build dropdown options for dataset selector
   */
  function buildDatasetDropdownHTML() {
    let html = '';

    // Group by cow
    const cows = getAvailableCows();
    for (const cowId of cows) {
      const info = CATTLE_INFO[cowId];
      const datasets = getDatasetsByCow(cowId);

      html += `<optgroup label="${info.name} (${info.imei})">`;
      for (const ds of datasets) {
        html += `<option value="${ds.key}" data-color="${info.color}">${ds.date} (${ds.records} záznamů)</option>`;
      }
      html += '</optgroup>';
    }

    return html;
  }

  /**
   * Build date-based dropdown (all cows for given date)
   */
  function buildDateDropdownHTML() {
    let html = '';
    const dates = getAvailableDates();

    for (const date of dates) {
      const datasets = getDatasetsByDate(date);
      const cowCount = datasets.length;
      html += `<optgroup label="${date} (${cowCount} krávy)">`;
      for (const ds of datasets) {
        const cowInfo = CATTLE_INFO[ds.cowId];
        html += `<option value="${ds.key}">${cowInfo.name} (${ds.records} záznamů)</option>`;
      }
      html += '</optgroup>';
    }

    return html;
  }

  // =========================================================================
  // EXPORT TO GLOBAL
  // =========================================================================

  global.CATTLE_DATASETS = CATTLE_DATASETS;
  global.CATTLE_INFO = CATTLE_INFO;

  global.CattleDatasets = {
    registry: CATTLE_DATASETS,
    info: CATTLE_INFO,
    getAvailable: getAvailableDatasets,
    getByCow: getDatasetsByCow,
    getByDate: getDatasetsByDate,
    getAvailableDates,
    getAvailableCows,
    getCowInfo,
    load: loadDataset,
    prepareForAnimation: prepareDatasetForAnimation,
    loadMultiple: loadMultipleDatasetsForParallel,
    toRendererFormat: convertToRendererFormat,
    buildDropdownHTML: buildDatasetDropdownHTML,
    buildDateDropdownHTML
  };

  // =========================================================================
  // RUMBURK_DATASETS - compatibility layer for UI handlers
  // This creates a proxy object that references the actual COW_* data arrays
  // =========================================================================

  global.RUMBURK_DATASETS = global.RUMBURK_DATASETS || {};

  // Populate RUMBURK_DATASETS with references to actual data arrays
  // This runs after all individual dataset files are loaded
  function initRumburkDatasets() {
    for (const [datasetKey, info] of Object.entries(CATTLE_DATASETS)) {
      // Check if the data array exists (e.g., COW_1759595_121225)
      if (global[datasetKey] && Array.isArray(global[datasetKey])) {
        // Convert raw cow data to renderer-compatible format
        const formattedData = convertToRendererFormat(global[datasetKey], info.cowId);
        global.RUMBURK_DATASETS[datasetKey] = formattedData;
        console.log(`[CATTLE] Registered ${datasetKey}: ${formattedData.length} records`);
      }
    }
  }

  // Initialize after DOM is ready (all scripts loaded)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRumburkDatasets);
  } else {
    // DOM already loaded, initialize immediately
    setTimeout(initRumburkDatasets, 0);
  }

  // Also expose init function for manual call if needed
  global.initRumburkDatasets = initRumburkDatasets;

  console.log('[CATTLE] Dataset registry loaded:', Object.keys(CATTLE_DATASETS).length, 'datasets for', Object.keys(CATTLE_INFO).length, 'cows');

})(window);

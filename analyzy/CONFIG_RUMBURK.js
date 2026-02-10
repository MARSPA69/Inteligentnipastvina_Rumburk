/**
 * Rumburk - Global configuration for cattle tracking
 * --------------------------------------------------
 * Extracted from the renderer so that other modules (UI, engines, tests)
 * can safely consume a single source of truth.
 */

(function configureSSHR(global) {
  const SSHR_CONFIG = Object.freeze({
    version: '2.0.0',
    areaName: 'Rumburk - zimoviště krav',
    mode: 'cattle-tracking',
    polygonMode: 'FIXED',
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
    }
  });

  global.SSHR_CONFIG = SSHR_CONFIG;
})(window);

console.log('�o. [CONFIG] Rumburk configuration loaded');

/* Dedicated Bellweather launcher. Simulation and UI live in game/src. */
(function () {
  'use strict';
  document.addEventListener('click', function (event) {
    const target = event.target instanceof Element ? event.target.closest('.game-tab[data-game="world"]') : null;
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const current = new URL(location.href);
    const version = current.searchParams.get('version') || (current.pathname.startsWith('/english-beta/') ? 'beta' : 'dev');
    if (/^(www\.)?catten\.cyou$/.test(current.hostname)) {
      location.assign('/english?version=' + (version.startsWith('beta') ? 'beta' : 'dev') + '/world-game');
    } else location.assign('/world-game/');
  }, true);
})();

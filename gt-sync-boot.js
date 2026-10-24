/* Grand Tour • Sincronização via GitHub Pages (etapa 1 de 2)
   Roda antes dos demais scripts: baixa o state.json publicado no site e, se for mais novo
   que a cópia deste aparelho, grava no localStorage (de onde o app lê os dados). */
(function () {
  'use strict';
  var KEY_VERSION = 'gt_sync_version';
  var KEY_UPDATED = 'gt_sync_updated_at';
  var KEY_DIRTY = 'gt_sync_dirty';
  var info = { version: 0, updatedAt: '', online: false, pendingLocal: false };
  window.__GT_SYNC__ = info;

  function isSyncedKey(k) {
    return !!k && k.indexOf('grand_tour_') === 0 && !/_pass$/.test(k) &&
      k !== 'grand_tour_italia_2026' && k !== 'grand_tour_cloudinary_config';
  }

  function applyState(state) {
    var remove = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (isSyncedKey(k) && !Object.prototype.hasOwnProperty.call(state.data, k)) remove.push(k);
    }
    remove.forEach(function (k) { localStorage.removeItem(k); });
    for (var key in state.data) {
      if (!Object.prototype.hasOwnProperty.call(state.data, key) || !isSyncedKey(key)) continue;
      try {
        localStorage.setItem(key, state.data[key]);
      } catch (e) {
        localStorage.removeItem('grand_tour_italia_2026');
        localStorage.setItem(key, state.data[key]);
      }
    }
    localStorage.setItem(KEY_VERSION, String(state.version));
    localStorage.setItem(KEY_UPDATED, state.updatedAt || '');
  }
  window.__GT_SYNC_APPLY__ = applyState;

  window.__GT_STATE_URL__ = function () {
    return new URL('state.json', location.href).href.split('?')[0].split('#')[0] + '?t=' + Date.now();
  };

  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

  try {
    info.version = Number(localStorage.getItem(KEY_VERSION)) || 0;
    info.updatedAt = localStorage.getItem(KEY_UPDATED) || '';
    info.pendingLocal = localStorage.getItem(KEY_DIRTY) === '1';

    var xhr = new XMLHttpRequest();
    xhr.open('GET', window.__GT_STATE_URL__(), false);
    xhr.send(null);

    if (xhr.status === 404) {
      info.online = true;
    } else if (xhr.status === 200) {
      var state = JSON.parse(xhr.responseText);
      info.online = true;
      info.serverVersion = state.version;
      // Alterações do administrador ainda não enviadas têm prioridade neste aparelho
      if (!info.pendingLocal && Number(state.version) > info.version) {
        applyState(state);
        info.version = Number(state.version);
        info.updatedAt = state.updatedAt;
      }
    }
  } catch (e) {
    info.online = false;
  }
})();

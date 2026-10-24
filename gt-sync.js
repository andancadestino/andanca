/* Grand Tour • Sincronização via GitHub Pages (etapa 2 de 2)
   - O administrador publica os dados em state.json no repositório (API do GitHub)
   - Celulares e tablets leem esse arquivo e passam a ver a última versão salva
   - O QR Code aponta para o site com o número da última versão publicada */
(function () {
  'use strict';

  var KEY_VERSION = 'gt_sync_version';
  var KEY_UPDATED = 'gt_sync_updated_at';
  var KEY_DIRTY = 'gt_sync_dirty';
  var KEY_TOKEN = 'gt_gh_token';
  var CANONICAL_URL = 'https://andancadestino.github.io/andanca/';
  var PUSH_DELAY_MS = 2500;
  var POLL_MS = 60000;

  var host = location.hostname;
  var repoOwner = /\.github\.io$/.test(host) ? host.split('.')[0] : 'andancadestino';
  var repoName = (/\.github\.io$/.test(host) && location.pathname.split('/')[1]) || 'andanca';
  var API_FILE = 'https://api.github.com/repos/' + repoOwner + '/' + repoName + '/contents/state.json';

  var info = window.__GT_SYNC__ || { version: 0, updatedAt: '' };
  var nativeSet = Storage.prototype.setItem;
  var nativeRemove = Storage.prototype.removeItem;
  var pushTimer = null;
  var retryTimer = null;
  var retryDelayMs = PUSH_DELAY_MS;
  var pushing = false;
  var pushAgain = false;
  var lastPushError = '';
  var lastSynced = info.pendingLocal ? null : serialize(collect());

  function isSyncedKey(k) {
    return !!k && k.indexOf('grand_tour_') === 0 && !/_pass$/.test(k) &&
      k !== 'grand_tour_italia_2026' && k !== 'grand_tour_cloudinary_config';
  }

  function collect() {
    var data = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (isSyncedKey(k)) data[k] = localStorage.getItem(k);
    }
    return data;
  }

  function serialize(data) {
    var out = {};
    Object.keys(data).sort().forEach(function (k) { out[k] = data[k]; });
    return JSON.stringify(out);
  }

  function toast(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
  }

  function isAdminSession() {
    return sessionStorage.getItem('grand_tour_admin') === 'true';
  }

  function getToken() {
    return localStorage.getItem(KEY_TOKEN) || '';
  }

  function askToken() {
    var t = window.prompt('Para publicar para todos os aparelhos, cole o token do GitHub (fine-grained, apenas o repositório ' +
      repoOwner + '/' + repoName + ', permissão "Contents: Read and write"). Ele fica salvo só neste aparelho.');
    t = t ? t.trim() : '';
    if (t) nativeSet.call(localStorage, KEY_TOKEN, t);
    return t;
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- Indicadores visuais ---------- */
  function setStatus(text, color) {
    var bar = document.getElementById('admin-bar');
    if (!bar) return;
    var el = document.getElementById('gt-cloud-status');
    if (!el) {
      el = document.createElement('span');
      el.id = 'gt-cloud-status';
      el.style.cssText = 'font-size:0.75rem;font-weight:700;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,0.12);cursor:pointer;';
      el.title = 'Clique para publicar agora';
      el.addEventListener('click', function () { push(true); });
      bar.insertBefore(el, bar.firstChild ? bar.firstChild.nextSibling : null);
    }
    el.textContent = text;
    el.style.color = color || '#bbf7d0';
  }

  function refreshStatus() {
    if (localStorage.getItem(KEY_DIRTY) === '1') {
      if (!getToken()) {
        setStatus('☁️ Pendências — clique aqui e informe o token do GitHub', '#fde68a');
      } else if (navigator.onLine === false) {
        setStatus('☁️ Pendências — sem conexão; aguardando rede', '#fde68a');
      } else if (lastPushError) {
        setStatus('☁️ Falha no envio: ' + lastPushError, '#fde68a');
      } else {
        setStatus('☁️ Alterações pendentes de envio', '#fde68a');
      }
    } else if (info.updatedAt) setStatus('☁️ Publicado • ' + formatDate(info.updatedAt), '#bbf7d0');
    else setStatus('☁️ Sincronização ativa — nada publicado ainda', '#bbf7d0');
  }

  function renderVersionLabel() {
    var label = document.getElementById('qrcode-url-label');
    if (!label) return;
    var v = document.getElementById('qrcode-version-label');
    if (!v) {
      v = document.createElement('div');
      v.id = 'qrcode-version-label';
      v.style.cssText = 'font-size:0.78rem;color:#8F6B26;font-weight:600;margin:-4px 0 10px;';
      label.parentNode.insertBefore(v, label.nextSibling);
    }
    v.textContent = info.updatedAt
      ? 'QR Code da versão publicada em ' + formatDate(info.updatedAt)
      : 'QR Code da versão publicada mais recente';

    var w = document.getElementById('qrcode-cloud-warning');
    var msg = '';
    if (!info.online) msg = '⚠️ Sem conexão com o site publicado: celulares e tablets só verão o que já foi publicado.';
    else if (!info.version) msg = '⚠️ Nenhuma atualização foi publicada ainda: aparelhos verão o conteúdo inicial. Entre como Administrador e clique em Salvar.';
    if (msg) {
      if (!w) {
        w = document.createElement('div');
        w.id = 'qrcode-cloud-warning';
        w.style.cssText = 'font-size:0.78rem;color:#b91c1c;font-weight:700;margin:0 0 10px;';
        v.parentNode.insertBefore(w, v.nextSibling);
      }
      w.textContent = msg;
    } else if (w) {
      w.remove();
    }
  }

  /* ---------- QR Code sempre na última versão publicada ---------- */
  window.getShareUrl = function () {
    var isWeb = location.protocol === 'http:' || location.protocol === 'https:';
    var local = host === 'localhost' || host === '127.0.0.1';
    var base = CANONICAL_URL;
    if (isWeb && !local) base = location.origin + location.pathname.replace(/[^\/]*$/, '');
    // O parâmetro muda a cada publicação e força celular/tablet a buscar a versão nova
    return base + (info.version ? '?v=' + info.version : '');
  };

  var originalInitQR = window.initQRCode;
  window.initQRCode = function () {
    if (typeof originalInitQR === 'function') originalInitQR();
    renderVersionLabel();
  };

  /* ---------- Publicação no GitHub ---------- */
  function toBase64(text) {
    var bytes = new TextEncoder().encode(text);
    var chunk = 0x8000;
    var bin = '';
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function markDirty() {
    nativeSet.call(localStorage, KEY_DIRTY, '1');
  }

  function schedulePush(delay) {
    clearTimeout(pushTimer);
    clearTimeout(retryTimer);
    retryTimer = null;
    pushTimer = setTimeout(function () { push(false); }, typeof delay === 'number' ? delay : PUSH_DELAY_MS);
  }

  function scheduleRetry() {
    if (!isAdminSession() || !getToken() || navigator.onLine === false) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function () {
      retryTimer = null;
      push(false);
    }, retryDelayMs);
    retryDelayMs = Math.min(retryDelayMs * 2, 60000);
  }

  function ghHeaders(token) {
    return { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }

  function push(explicit) {
    clearTimeout(pushTimer);
    clearTimeout(retryTimer);
    retryTimer = null;
    var payload = serialize(collect());
    if (!explicit && payload === lastSynced) {
      nativeRemove.call(localStorage, KEY_DIRTY);
      refreshStatus();
      return Promise.resolve(true);
    }
    var token = getToken();
    if (!token && explicit) token = askToken();
    if (!token) {
      refreshStatus();
      return Promise.resolve(false);
    }
    if (pushing) {
      pushAgain = true;
      return Promise.resolve(false);
    }
    pushing = true;
    setStatus('☁️ Publicando alterações…', '#bae6fd');

    var version = Date.now();
    var updatedAt = new Date(version).toISOString();
    var content = toBase64('{"version":' + version + ',"updatedAt":"' + updatedAt + '","data":' + payload + '}');

    return fetch(API_FILE + '?t=' + version, { headers: ghHeaders(token), cache: 'no-store' }).then(function (res) {
      if (res.status === 404) return '';
      if (res.status === 401 || res.status === 403) throw new Error('auth');
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json().then(function (f) { return f.sha; });
    }).then(function (sha) {
      var body = { message: 'Atualização do roteiro ' + updatedAt, content: content };
      if (sha) body.sha = sha;
      var headers = ghHeaders(token);
      headers['Content-Type'] = 'application/json';
      return fetch(API_FILE, { method: 'PUT', headers: headers, body: JSON.stringify(body) });
    }).then(function (res) {
      if (res.status === 401 || res.status === 403) throw new Error('auth');
      if (!res.ok) throw new Error('http ' + res.status);
      lastSynced = payload;
      lastPushError = '';
      retryDelayMs = PUSH_DELAY_MS;
      info.version = version;
      info.updatedAt = updatedAt;
      info.online = true;
      nativeSet.call(localStorage, KEY_VERSION, String(version));
      nativeSet.call(localStorage, KEY_UPDATED, updatedAt);
      if (serialize(collect()) === payload) nativeRemove.call(localStorage, KEY_DIRTY);
      window.initQRCode();
      refreshStatus();
      if (explicit) toast('☁️ Publicado! O QR Code já aponta para esta versão. Pode levar cerca de 1 minuto para aparecer nos outros aparelhos.');
      return true;
    }).catch(function (err) {
      var errorMessage = err && err.message ? err.message : 'erro desconhecido';
      var authError = errorMessage === 'auth';
      var shouldNotify = explicit || errorMessage !== lastPushError;
      markDirty();
      lastPushError = authError ? '' : errorMessage;
      if (authError) nativeRemove.call(localStorage, KEY_TOKEN);
      refreshStatus();
      if (authError) {
        toast('O GitHub recusou o token (inválido, expirado ou sem permissão "Contents: Read and write"). Clique em Salvar para informar outro.');
      } else if (shouldNotify) {
        toast('Falha ao publicar (' + errorMessage + '). Os dados continuam salvos neste aparelho.');
      }
      if (!authError && (err instanceof TypeError || /^http (409|422|429|5\d\d)$/.test(errorMessage))) {
        scheduleRetry();
      }
      return false;
    }).then(function (ok) {
      pushing = false;
      if (pushAgain) {
        pushAgain = false;
        schedulePush();
      }
      return ok;
    });
  }

  // Toda gravação de dados do roteiro feita pelo administrador é enviada automaticamente
  function onLocalChange(key) {
    if (!isSyncedKey(key) || !isAdminSession()) return;
    markDirty();
    schedulePush();
  }

  Storage.prototype.setItem = function (key, value) {
    nativeSet.call(this, key, value);
    if (this === window.localStorage) onLocalChange(String(key));
  };
  Storage.prototype.removeItem = function (key) {
    nativeRemove.call(this, key);
    if (this === window.localStorage) onLocalChange(String(key));
  };

  var originalSaveState = window.saveState;
  window.saveState = function () {
    if (typeof originalSaveState === 'function') originalSaveState();
    push(true);
  };

  /* ---------- Receber versões novas publicadas por outro aparelho ---------- */
  function checkForUpdates() {
    if (document.hidden || pushing || localStorage.getItem(KEY_DIRTY) === '1') return;
    fetch(window.__GT_STATE_URL__(), { cache: 'no-store' })
      .then(function (res) {
        info.online = res.status === 200 || res.status === 404;
        if (res.status !== 200) return null;
        return res.json();
      })
      .then(function (state) {
        if (!state || Number(state.version) <= info.version || localStorage.getItem(KEY_DIRTY) === '1') return;
        window.__GT_SYNC_APPLY__(state);
        toast('Nova versão do roteiro disponível — atualizando…');
        setTimeout(function () { location.reload(); }, 900);
      })
      .catch(function () { info.online = false; });
  }

  if (location.protocol === 'http:' || location.protocol === 'https:') {
    setInterval(checkForUpdates, POLL_MS);
    window.addEventListener('online', function () {
      if (localStorage.getItem(KEY_DIRTY) === '1' && isAdminSession() && getToken()) {
        schedulePush(0);
      } else {
        refreshStatus();
      }
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        checkForUpdates();
        if (localStorage.getItem(KEY_DIRTY) === '1' && isAdminSession() && getToken()) {
          schedulePush(0);
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderVersionLabel();
    refreshStatus();
    if (isAdminSession() && localStorage.getItem(KEY_DIRTY) === '1') schedulePush();
  });
})();

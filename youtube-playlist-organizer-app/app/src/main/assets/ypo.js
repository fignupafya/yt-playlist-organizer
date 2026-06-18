// ==UserScript==
// @name         YouTube Playlist Organizer (in-app bundle)
// @namespace    yt-playlist-organizer
// @version      3.0.2
// @description  Bulk-organize YouTube playlists — select videos, add/remove across multiple playlists. Bundled inside the Android app's WebView.
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

/* jshint esversion: 11, browser: true, devel: true, eqnull: true */

/*
 * NASIL ÇALIŞIR
 * - Bu betik YouTube sayfasının İÇİNDE çalışır → senin açık oturumunu doğal
 *   olarak kullanır (OAuth/Google Cloud/kota YOK). İç youtubei API'sini çağırır.
 * - Sağ alttaki yüzen düğmeye basınca araç tam ekran açılır.
 * - GÜVENLİK: varsayılan DRY-RUN; önizleme zorunlu; kopya eklemez; bir liste
 *   okunamazsa işlem iptal; ilk hatada durur; 429'da bekleyip yeniden dener;
 *   geri-al vardır.
 */

(function () {
  'use strict';
  if (window.__ypoMobileLoaded) { return; }
  window.__ypoMobileLoaded = true;

  const VERSION = '1.2';
  const LS_SETTINGS = 'ypo_settings_v3';
  const LS_LASTBATCH = 'ypo_lastbatch_v3';
  const RENDER_CHUNK = 200;
  const SEED_VIDEO = 'dQw4w9WgXcQ';

  // -------------------------------------------------------------------------
  //  DURUM
  // -------------------------------------------------------------------------
  const state = {
    playlists: [], managed: new Set(), managedConfigured: false,
    settings: { dryRun: true, delayMs: 300, vidSort: 'order', plSort: 'default', lang: 'en' },
    current: null, videos: [], vmap: new Map(), selected: new Set(),
    filter: 'all', search: '', memFilter: 'all',
    plSearch: '', plManagedOnly: false,
    lastClickIdx: -1, membership: new Map(), membershipFresh: false, lastOp: null,
    view: 'playlists',
  };
  let curVisible = [];
  let renderedCount = 0;
  let io = null;
  const PALETTE = ['#ff6b6b', '#4dabf7', '#51cf66', '#ffd43b', '#cc5de8',
                   '#ff922b', '#20c997', '#f783ac', '#a9e34b', '#74b9ff'];

  // -------------------------------------------------------------------------
  //  i18n — varsayılan İngilizce; sözlük Türkçe→İngilizce. Dil ayardan seçilir.
  //  t(s): lang 'tr' ise metni olduğu gibi döndür; aksi halde İngilizce karşılığı.
  // -------------------------------------------------------------------------
  const DICT = {
    'YouTube Liste Düzenleyici': 'YouTube Playlist Organizer',
    'Oynatma Listelerim': 'My Playlists',
    '‹ Listeler   ': '‹ Lists   ',
    'Liste ara…': 'Search lists…',
    'Sıra: Varsayılan': 'Sort: Default',
    'İsim A→Z': 'Name A→Z', 'İsim Z→A': 'Name Z→A',
    'Video çok→az': 'Videos most→least', 'Video az→çok': 'Videos least→most',
    'Yönetilenler': 'Managed', 'Sadece yönetilenler': 'Managed only',
    'Playlist bulunamadı.': 'No playlists found.',
    'Playlist bulunamadı. ↻ Yenile ile tekrar dene veya YouTube\'da giriş yap.': 'No playlists found. Try ↻ Refresh or sign in to YouTube.',
    'Eşleşen liste yok.': 'No matching lists.',
    ' liste': ' lists', 'düzenlemek için aç': 'tap to edit',
    '✓ yönetilen': '✓ managed', 'yönetilen': 'managed',
    ' video': ' videos', ' video • ': ' videos • ', ' izlenmiş': ' watched',
    'Tümü': 'All', 'İzlenmiş': 'Watched', 'İzlenmemiş': 'Unwatched',
    'Üyelik: Tümü': 'Membership: All', 'Arşivde VAR': 'In an archive', 'Arşivde YOK': 'Not in any archive',
    'Şu listede olanlar': 'In this list',
    'Sıra: Liste': 'Sort: List order',
    'İzlenme çok→az': 'Watched most→least', 'İzlenme az→çok': 'Watched least→most',
    'Süre uzun→kısa': 'Duration long→short', 'Süre kısa→uzun': 'Duration short→long',
    'Başlık A→Z': 'Title A→Z', 'Başlık Z→A': 'Title Z→A', 'Kanal A→Z': 'Channel A→Z',
    'Videolarda ara…': 'Search videos…',
    'Görüneni Seç': 'Select visible', 'Temizle': 'Clear', 'Bu listeyi yenile': 'Refresh this list',
    'Bu listeden çıkar': 'Remove from this list', 'İşlem Yap': 'Operate',
    'Bu liste boş.': 'This list is empty.', 'Eşleşen video yok.': 'No matching videos.',
    ' — kaydır': ' — scroll', '(başlıksız)': '(untitled)',
    '✓ izlendi': '✓ watched', ' seçili': ' selected',
    'İşlem Yap — ': 'Operate — ', 'Mod': 'Mode',
    'Mod 1 — Override (tam senkron)': 'Mode 1 — Override (full sync)',
    'İşaretli listeler: eklensin. İşaretsiz: çıkarılsın. Tüm seçili videoların üyeliği kutulara birebir eşitlenir.':
      'Checked lists: add. Unchecked: remove. All selected videos’ membership is synced exactly to the checkboxes.',
    'Mod 2 — Include / Exclude (kısmi)': 'Mode 2 — Include / Exclude (partial)',
    '+ Ekle / · Dokunma / − Çıkar. "Dokunma" listelere hiç dokunulmaz.':
      '+ Add / · Leave / − Remove. "Leave" lists are untouched.',
    'Hedef Listeler (': 'Target Lists (',
    'listede olsun': 'in list', '+ Ekle': '+ Add', '· Dokunma': '· Leave', '− Çıkar': '− Remove',
    'Override: işaretsiz listelerden de video ÇIKARILIR (yalnızca bu listeler).':
      'Override: videos are also REMOVED from unchecked lists (these lists only).',
    'Yalnızca + / − seçtiğin listeler etkilenir.': 'Only lists you set to + / − are affected.',
    'İptal': 'Cancel', 'Önizle →': 'Preview →',
    'En az bir liste için + veya − seç.': 'Set + or − for at least one list.',
    'Önizleme hazırlanıyor…': 'Preparing preview…',
    'Yönetilen listelerin içeriği okunuyor…': 'Reading managed lists…',
    'Listeler okunamadı — iptal edildi': 'Lists could not be read — cancelled',
    'Hiçbir değişiklik yapılmadı.': 'No changes were made.',
    'Kapat': 'Close', 'DRY-RUN açık': 'DRY-RUN on', '⚠ CANLI MOD': '⚠ LIVE MODE',
    ' — hiçbir şey yazılmaz, sadece gösterilir.': ' — nothing is written, only shown.',
    ' — değişiklikler GERÇEKTEN uygulanır.': ' — changes are ACTUALLY applied.',
    'DRY-RUN Çalıştır': 'Run DRY-RUN', 'Uygula (': 'Apply (',
    'ekleme': 'add', 'çıkarma': 'remove', 'değişmez': 'no change',
    'EKLE': 'ADD', 'ÇIKAR': 'REMOVE', '← Geri': '← Back',
    'Yapılacak değişiklik yok — seçtiklerin zaten istenen durumda.':
      'Nothing to do — your selection is already in the desired state.',
    'CANLI MOD: ': 'LIVE MODE: ', ' ekleme, ': ' add, ',
    ' çıkarma gerçekten uygulanacak. Devam?': ' remove will actually be applied. Continue?',
    'DRY-RUN çalışıyor…': 'Running DRY-RUN…', 'Uygulanıyor…': 'Applying…',
    'DRY-RUN bitti.': 'DRY-RUN done.', 'Bitti.': 'Done.',
    ' işlem simüle edildi, hiçbir şey yazılmadı.': ' operations simulated, nothing written.',
    ' başarılı, ': ' succeeded, ', ' hatalı.': ' failed.', ' (ilk hatada durdu)': ' (stopped at first error)',
    'Hatalar': 'Errors', '↩ Bu partiyi geri al': '↩ Undo this batch',
    'Sonuç doğruysa: Kapat → tekrar aç → DRY-RUN kutusunu kapat. İlkini bir test listesiyle dene.':
      'If correct: Close → reopen → turn off DRY-RUN. Try the first one on a test list.',
    '↩ Geri Al': '↩ Undo', '↩ Geri al': '↩ Undo',
    'Geri alınacak parti yok.': 'No batch to undo.',
    'Son parti geri alınacak: ': 'The last batch will be undone: ',
    ' işlemin TERSİ uygulanacak. Devam?': ' operations will be reversed. Continue?',
    'Geri alınıyor…': 'Undoing…', 'Geri alınıyor: ': 'Undoing: ',
    'Geri alma bitti. ': 'Undo done. ', 'Geri alma bitti.': 'Undo done.',
    '⚙ Ayarlar': '⚙ Settings', 'Ayarlar': 'Settings', 'Yönetilen Listeler': 'Managed Lists',
    'İşlem penceresinde hedef olarak SADECE işaretliler görünür. Override yalnızca bunları etkiler.':
      'Only checked lists appear as targets in the operation window. Override affects only these.',
    'Tümünü Seç': 'Select all', 'Hiçbirini Seç': 'Select none', 'Genel': 'General',
    'İşlem penceresi DRY-RUN açık başlasın': 'Operation window starts with DRY-RUN on',
    'İstekler arası bekleme (ms):': 'Delay between requests (ms):',
    'Önerilen 200–400 ms. 429 gelirse araç otomatik bekleyip yeniden dener.':
      'Recommended 200–400 ms. On 429 the tool auto-waits and retries.',
    'Kaydet': 'Save', 'Ayarlar kaydedildi.': 'Settings saved.',
    'Dil': 'Language', 'Dil / Language': 'Language',
    '🔧 Tanılama': '🔧 Diagnostics', 'Sürüm ': 'Version ', 'Bağlantı testi': 'Connection test',
    'Test başlatılıyor…': 'Starting test…',
    ' playlist bulundu': ' playlists found',
    '\nSONUÇ: iç API çalışıyor. ✓': '\nRESULT: internal API works. ✓',
    'Playlistlerin getiriliyor…': 'Loading your playlists…',
    'Playlistler getirilemedi: ': 'Could not load playlists: ',
    'Playlistler alınamadı — YouTube\'da giriş yaptığından emin ol.':
      'Could not get playlists — make sure you are signed in to YouTube.',
    'videolar yükleniyor…': 'loading videos…', 'Videolar okunamadı: ': 'Could not read videos: ',
    ' video okundu…': ' videos read…', 'YouTube\'da aç': 'Open on YouTube',
    'sa ': 'h ', 'dk': 'm', 'sn': 's',
    // dahili hatalar (nadiren görünür)
    'Ağ hatası: ': 'Network error: ', 'Boş yanıt.': 'Empty response.',
    'YouTube yapılandırması okunamadı (ytcfg yok).': 'YouTube config could not be read (no ytcfg).',
    'ytInitialData bulunamadı (sayfa tam yüklenmemiş olabilir).': 'ytInitialData not found (page may not be fully loaded).',
    ' işlem simüle edildi.': ' operations simulated.',
    '• context: ': '• context: ', '• SAPISID çerezi: ': '• SAPISID cookie: ',
    '• Playlist okuma testi…': '• Playlist read test…', ' video, ': ' videos, ',
    // --- v1.2: arka plan iş motoru / doğrudan uygula ---
    '⚡ Direkt Uygula': '⚡ Apply Directly',
    'CANLI — seçili ': 'LIVE — selected ',
    ' video arka planda işlenecek.\n\nDevam edilsin mi?': ' videos will be processed in the background.\n\nProceed?',
    'Senkronla — ': 'Sync — ', 'Kısmi işlem — ': 'Partial — ', 'İşlem — ': 'Operation — ',
    ' işlem': ' operations', 'Hazırlanıyor…': 'Preparing…',
    'Listeler okunuyor… ': 'Reading lists… ',
    '" okunamadı: ': '" could not be read: ',
    ' — hiçbir değişiklik yapılmadı.': ' — no changes were made.',
    'İptal edildi — ': 'Cancelled — ', 'Hata — ': 'Error — ', ' yapıldı, durdu': ' done, stopped',
    'DRY-RUN bitti — ': 'DRY-RUN done — ', ' simüle': ' simulated', 'Değişiklik yok': 'No changes',
    'Bitti — ': 'Done — ', ' hata': ' errors',
    'İptal et': 'Stop', '⛔ İptal et': '⛔ Stop', 'Ayrıntı için tıkla': 'Click for details',
    '↩ Bu işi geri al': '↩ Undo this job', '↩ Geri al — ': '↩ Undo — ',
    'Bu işin TERSİ uygulanacak: ': 'This job will be reversed: ',
    ' işlem.\n\nDevam edilsin mi?': ' operations.\n\nProceed?',
  };
  function tt(s) {
    if (state.settings.lang === 'tr') { return s; }
    const e = DICT[s];
    return e === undefined ? s : e;
  }

  // -------------------------------------------------------------------------
  //  YARDIMCILAR
  // -------------------------------------------------------------------------
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $id(id) { return document.getElementById(id); }

  function h(tag, props) {
    const n = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null) { continue; }
        if (k === 'class') { n.className = v; }
        else if (k === 'text') { n.textContent = tt(v); }
        else if (k === 'style' && typeof v === 'object') { Object.assign(n.style, v); }
        else if (k === 'dataset') { Object.assign(n.dataset, v); }
        else if (k.startsWith('on') && typeof v === 'function') { n.addEventListener(k.slice(2), v); }
        else if (k === 'placeholder' || k === 'title') { n.setAttribute(k, tt(v)); }
        else { n.setAttribute(k, v); }
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const kid = arguments[i];
      if (kid == null || kid === false) { continue; }
      if (typeof kid === 'object') { n.appendChild(kid); }
      else { n.appendChild(document.createTextNode(tt(String(kid)))); }
    }
    return n;
  }
  function clear(node) {
    while (node && node.firstChild) { node.removeChild(node.firstChild); }
  }
  function hexA(hex, a) {
    const m = hex.replace('#', '');
    return 'rgba(' + parseInt(m.substr(0, 2), 16) + ',' + parseInt(m.substr(2, 2), 16) +
      ',' + parseInt(m.substr(4, 2), 16) + ',' + a + ')';
  }
  function plColor(id) {
    let hh = 0;
    for (let i = 0; i < id.length; i++) {
      hh = (hh * 31 + id.charCodeAt(i)) >>> 0;
    }
    return PALETTE[hh % PALETTE.length];
  }
  function parseClock(s) {
    const p = String(s).split(':').map(function (n) { return parseInt(n, 10) || 0; });
    let sec = 0;
    for (const n of p) { sec = sec * 60 + n; }
    return sec;
  }
  function fmtDur(sec) {
    sec = Math.round(sec || 0);
    const hr = Math.floor(sec / 3600);
    const mn = Math.floor((sec % 3600) / 60);
    if (hr) { return hr + tt('sa ') + mn + tt('dk'); }
    if (mn) { return mn + tt('dk'); }
    return sec + tt('sn');
  }
  function textOf(t) {
    if (t == null) { return ''; }
    if (typeof t === 'string') { return t; }
    if (typeof t.content === 'string') { return t.content; }
    if (t.simpleText) { return t.simpleText; }
    if (Array.isArray(t.runs)) {
      return t.runs.map(function (r) { return r.text || ''; }).join('');
    }
    return '';
  }
  function deepCollect(obj, pred, out, depth) {
    out = out || [];
    depth = depth || 0;
    if (!obj || typeof obj !== 'object' || depth > 60) { return out; }
    if (Array.isArray(obj)) {
      for (const x of obj) { deepCollect(x, pred, out, depth + 1); }
      return out;
    }
    try { if (pred(obj)) { out.push(obj); } } catch (e) {}
    for (const k in obj) {
      const v = obj[k];
      if (v && typeof v === 'object') { deepCollect(v, pred, out, depth + 1); }
    }
    return out;
  }
  function mkSelect(options, value, onChange) {
    const sel = h('select', { class: 'ypo-select' });
    for (const opt of options) {
      sel.appendChild(h('option', { value: opt[0], text: opt[1] }));
    }
    sel.value = value;
    sel.addEventListener('change', function () { onChange(sel.value); });
    return sel;
  }
  function toast(msg, isErr) {
    const el = $id('ypo-toast');
    if (!el) { return; }
    el.textContent = tt(msg);
    el.className = (isErr ? 'err ' : '') + 'show';
  }
  function hideToast() {
    const t = $id('ypo-toast');
    if (t) { t.className = ''; }
  }

  // -------------------------------------------------------------------------
  //  AYARLAR (localStorage)
  // -------------------------------------------------------------------------
  // Native SharedPreferences ÖNCELİKLİ (WebView localStorage kalıcılığına güvenme);
  // localStorage yedek. Böylece yönetilen seçim uygulama kapanıp açılınca korunur.
  function loadSettings() {
    let raw = '';
    try { if (typeof YPOAndroid !== 'undefined' && YPOAndroid && YPOAndroid.loadData) { raw = YPOAndroid.loadData('settings') || ''; } } catch (e) {}
    if (!raw) { try { raw = localStorage.getItem(LS_SETTINGS) || ''; } catch (e) {} }
    try {
      const d = JSON.parse(raw || '{}');
      if (Array.isArray(d.managed)) { state.managed = new Set(d.managed); }
      if (typeof d.managedConfigured === 'boolean') { state.managedConfigured = d.managedConfigured; }
      if (typeof d.plManagedOnly === 'boolean') { state.plManagedOnly = d.plManagedOnly; }
      if (d.lang === 'tr' || d.lang === 'en') { state.settings.lang = d.lang; }
      if (typeof d.dryRun === 'boolean') { state.settings.dryRun = d.dryRun; }
      if (typeof d.delayMs === 'number') { state.settings.delayMs = d.delayMs; }
      if (typeof d.vidSort === 'string') { state.settings.vidSort = d.vidSort; }
      if (typeof d.plSort === 'string') { state.settings.plSort = d.plSort; }
    } catch (e) {}
  }
  function saveSettings() {
    const s = JSON.stringify({
      managed: Array.from(state.managed),
      managedConfigured: state.managedConfigured,
      plManagedOnly: state.plManagedOnly,
      lang: state.settings.lang,
      dryRun: state.settings.dryRun, delayMs: state.settings.delayMs,
      vidSort: state.settings.vidSort, plSort: state.settings.plSort,
    });
    try { localStorage.setItem(LS_SETTINGS, s); } catch (e) {}
    try { if (typeof YPOAndroid !== 'undefined' && YPOAndroid && YPOAndroid.saveData) { YPOAndroid.saveData('settings', s); } } catch (e) {}
  }

  // -------------------------------------------------------------------------
  //  YOUTUBE YAPILANDIRMASI
  // -------------------------------------------------------------------------
  let _cfg = null;
  let _bootstrapData = null;   // intercept modunda /feed/playlists fetch'inden gelen ytInitialData
  function getConfig() {
    if (_cfg) { return _cfg; }
    let apiKey, context, clientNameNum, clientVer;
    try {
      if (window.ytcfg && window.ytcfg.get) {
        apiKey = window.ytcfg.get('INNERTUBE_API_KEY');
        context = window.ytcfg.get('INNERTUBE_CONTEXT');
        clientNameNum = window.ytcfg.get('INNERTUBE_CONTEXT_CLIENT_NAME');
        clientVer = window.ytcfg.get('INNERTUBE_CONTEXT_CLIENT_VERSION');
      }
    } catch (e) {}
    if (!apiKey || !context || !context.client) {
      let html = '';
      try { html = document.documentElement.innerHTML || ''; } catch (e) {}
      const g = function (re) { const m = html.match(re); return m ? m[1] : null; };
      if (!apiKey) { apiKey = g(/"INNERTUBE_API_KEY":\s*"([^"]+)"/); }
      if (!clientVer) { clientVer = g(/"INNERTUBE_CONTEXT_CLIENT_VERSION":\s*"([^"]+)"/); }
      const isMobile = location.hostname.charAt(0) === 'm';
      const visitor = g(/"(?:VISITOR_DATA|visitorData)":\s*"([^"]+)"/);
      context = {
        client: {
          clientName: isMobile ? 'MWEB' : 'WEB',
          clientVersion: clientVer || '2.20240101.00.00',
          hl: 'tr', gl: 'TR', visitorData: visitor || undefined,
        },
      };
      if (!clientNameNum) { clientNameNum = isMobile ? 2 : 1; }
    }
    _cfg = {
      apiKey: apiKey,
      context: context,
      clientNameNum: clientNameNum || 1,
      clientVer: clientVer || (context.client && context.client.clientVersion) || '',
    };
    return _cfg;
  }

  // ---- INTERCEPT (instant) MOD: kendi HTML'imiz youtube.com kökeninde sunulur ----
  function isInterceptPage() {
    return location.pathname.indexOf('/__ypoapp__') === 0;
  }
  // HTML metninden, işaretten sonraki dengeli JSON nesnesini çıkarır (string/escape duyarlı).
  function extractJsonAfter(html, marker) {
    const i = html.indexOf(marker);
    if (i < 0) { return null; }
    const j = html.indexOf('{', i);
    if (j < 0) { return null; }
    let depth = 0, inStr = false, esc = false;
    for (let k = j; k < html.length; k++) {
      const c = html[k];
      if (inStr) {
        if (esc) { esc = false; }
        else if (c === '\\') { esc = true; }
        else if (c === '"') { inStr = false; }
      } else {
        if (c === '"') { inStr = true; }
        else if (c === '{') { depth++; }
        else if (c === '}') { depth--; if (depth === 0) { return html.slice(j, k + 1); } }
      }
    }
    return null;
  }
  // Yapılandırmayı + playlistleri gerçek YouTube'dan TEK fetch ile al (ağır sayfa yüklenmez).
  async function bootstrapConfig() {
    let html = '';
    try {
      const resp = await fetch('https://www.youtube.com/feed/playlists', { credentials: 'include' });
      if (!resp.ok) { return false; }
      html = await resp.text();
    } catch (e) { return false; }
    const m1 = html.match(/"INNERTUBE_API_KEY":\s*"([^"]+)"/);
    if (!m1) { return false; }
    const cv = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":\s*"([^"]+)"/);
    const clientVer = cv ? cv[1] : '2.20240101.00.00';
    let visitor = '';
    const vm = html.match(/"visitorData":\s*"([^"]+)"/) || html.match(/"VISITOR_DATA":\s*"([^"]+)"/);
    if (vm) { try { visitor = JSON.parse('"' + vm[1] + '"'); } catch (e) { visitor = vm[1]; } }
    _cfg = {
      apiKey: m1[1],
      context: { client: { clientName: 'WEB', clientVersion: clientVer, hl: 'tr', gl: 'TR', visitorData: visitor || undefined } },
      clientNameNum: 1,
      clientVer: clientVer,
    };
    const jd = extractJsonAfter(html, 'ytInitialData = ') || extractJsonAfter(html, 'ytInitialData"] = ');
    if (jd) { try { _bootstrapData = JSON.parse(jd); } catch (e) { _bootstrapData = null; } }
    return true;
  }
  async function initIntercept() {
    // 1) Origin gerçekten youtube.com mu? (intercept origin hilesi bu cihazda çalıştı mı?)
    if (location.origin !== 'https://www.youtube.com') { ypoBridge('fallbackToReal'); return; }
    // 2) Giriş var mı? (çerez — origin youtube.com olduğu için okunabilir)
    if (!getCookie('SAPISID') && !getCookie('__Secure-3PAPISID')) { ypoBridge('needLogin'); return; }
    // 3) Yapılandırma + playlistler tek fetch ile
    let ok = false;
    try { ok = await bootstrapConfig(); } catch (e) { ok = false; }
    if (!ok) { ypoBridge('fallbackToReal'); return; }
    // 4) Uygulamayı aç (overlay bizim boş sayfamızı kaplar)
    openOverlay();
    ypoBridge('hideSplash');
  }

  function getCookie(name) {
    const esc = name.replace(/[-.[\]{}()*+?^$|\\]/g, '\\$&');
    const m = document.cookie.match(new RegExp('(?:^|; )' + esc + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  async function sha1Hex(s) {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }
  async function buildAuth(origin) {
    const ts = Math.floor(Date.now() / 1000);
    const pairs = [['SAPISIDHASH', 'SAPISID'], ['SAPISID1PHASH', '__Secure-1PAPISID'], ['SAPISID3PHASH', '__Secure-3PAPISID']];
    const parts = [];
    for (const pair of pairs) {
      const c = getCookie(pair[1]);
      if (!c) { continue; }
      const hash = await sha1Hex(ts + ' ' + c + ' ' + origin);
      parts.push(pair[0] + ' ' + ts + '_' + hash);
    }
    return parts.join(' ');
  }

  // -------------------------------------------------------------------------
  //  INNERTUBE
  // -------------------------------------------------------------------------
  async function innertube(path, body) {
    const cfg = getConfig();
    if (!cfg.apiKey) { throw new Error('YouTube yapılandırması okunamadı (ytcfg yok).'); }
    const origin = location.origin;
    const headers = {
      'Content-Type': 'application/json',
      'X-Origin': origin,
      'X-Youtube-Client-Name': String(cfg.clientNameNum),
      'X-Youtube-Client-Version': String(cfg.clientVer),
    };
    const auth = await buildAuth(origin);
    if (auth) { headers.Authorization = auth; }
    const visitor = cfg.context.client && cfg.context.client.visitorData;
    if (visitor) { headers['X-Goog-Visitor-Id'] = visitor; }
    const url = origin + '/youtubei/v1/' + path + '?key=' + encodeURIComponent(cfg.apiKey) + '&prettyPrint=false';
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST', credentials: 'include', headers: headers,
        body: JSON.stringify(Object.assign({ context: cfg.context }, body || {})),
      });
    } catch (e) {
      throw new Error('Ağ hatası: ' + e);
    }
    if (!resp.ok) {
      const txt = await resp.text().catch(function () { return ''; });
      const err = new Error('HTTP ' + resp.status + ' — ' + txt.slice(0, 180));
      err.httpStatus = resp.status;
      throw err;
    }
    return resp.json();
  }

  // -------------------------------------------------------------------------
  //  API: PLAYLIST LİSTESİ
  // -------------------------------------------------------------------------
  function parsePlaylists(data) {
    const out = [];
    const seen = new Set();
    function push(id, title, thumb, count) {
      if (!id || seen.has(id) || /^RD/.test(id)) { return; }
      seen.add(id);
      const cm = String(count || '').match(/[\d.,]+/);
      out.push({
        id: id,
        title: (title || id).trim(),
        thumb: thumb || '',
        count: cm ? cm[0] : '',
      });
    }
    for (const o of deepCollect(data, function (x) { return x.lockupViewModel; })) {
      try {
        const lk = o.lockupViewModel;
        if (String(lk.contentType || '').indexOf('PLAYLIST') === -1) { continue; }
        if (!lk.contentId) { continue; }
        let title = '';
        const md = deepCollect(lk, function (x) { return x.lockupMetadataViewModel; })[0];
        if (md) { title = textOf(md.lockupMetadataViewModel.title); }
        let thumb = '';
        let bestW = -1;
        const prim = deepCollect(lk, function (x) { return x.primaryThumbnail; })[0];
        const scope = prim ? prim.primaryThumbnail : lk;
        for (const s of deepCollect(scope, function (x) { return Array.isArray(x.sources); })) {
          for (const src of s.sources) {
            if (src && src.url && /^https?:/.test(src.url) && (src.width || 0) >= bestW) {
              bestW = src.width || 0;
              thumb = src.url;
            }
          }
        }
        let count = '';
        for (const c of deepCollect(lk, function (x) { return typeof x.content === 'string'; })) {
          const cm = c.content.match(/^\s*(\d[\d.,\s]*)\s*(video|içerik|videos)\b/i);
          if (cm) { count = cm[1]; break; }
        }
        push(lk.contentId, title, thumb, count);
      } catch (e) {}
    }
    for (const key of ['gridPlaylistRenderer', 'playlistRenderer', 'compactPlaylistRenderer']) {
      for (const o of deepCollect(data, function (x) { return x[key]; })) {
        try {
          const r = o[key];
          if (!r || !r.playlistId) { continue; }
          let thumb = '';
          const ths = deepCollect(r, function (x) {
            return Array.isArray(x.thumbnails) && x.thumbnails.length;
          });
          if (ths.length) {
            const a = ths[0].thumbnails;
            thumb = a[a.length - 1].url || '';
          }
          push(r.playlistId, textOf(r.title), thumb,
            textOf(r.videoCountShortText) || textOf(r.videoCountText));
        } catch (e) {}
      }
    }
    for (const o of deepCollect(data, function (x) {
      return typeof x.playlistId === 'string' && ('containsSelectedVideos' in x || 'selected' in x);
    })) {
      try { push(o.playlistId, textOf(o.title), '', ''); } catch (e) {}
    }
    let continuation = null;
    for (const o of deepCollect(data, function (x) { return x.continuationItemRenderer; })) {
      const ce = o.continuationItemRenderer.continuationEndpoint;
      const t = ce && ce.continuationCommand && ce.continuationCommand.token;
      if (t) { continuation = t; break; }
    }
    return { playlists: out, continuation: continuation };
  }

  async function enumeratePlaylists() {
    // intercept modunda _bootstrapData hazırdır. Gerçek sayfada ytInitialData'yı kısa bekle.
    if (!_bootstrapData) {
      for (let i = 0; i < 16 && !window.ytInitialData; i++) { await sleep(150); }
    }
    const initData = window.ytInitialData || _bootstrapData;
    // 0) Ham veriden oku (küçük resimler + sayılar dahil)
    try {
      if (initData) {
        const parsed0 = parsePlaylists(initData);
        if (parsed0.playlists.length) {
          let pls0 = parsed0.playlists;
          let c0 = parsed0.continuation;
          const seen0 = new Set();
          while (c0 && !seen0.has(c0)) {
            seen0.add(c0);
            const more0 = await innertube('browse', { continuation: c0 });
            const p0 = parsePlaylists(more0);
            for (const pl of p0.playlists) {
              if (!pls0.some(function (x) { return x.id === pl.id; })) { pls0.push(pl); }
            }
            c0 = p0.continuation;
          }
          return pls0;
        }
      }
    } catch (e) {}
    try {
      let data = await innertube('browse', { browseId: 'FEplaylist_aggregation' });
      let parsed = parsePlaylists(data);
      let playlists = parsed.playlists;
      let cont = parsed.continuation;
      const seen = new Set();
      while (cont && !seen.has(cont)) {
        seen.add(cont);
        data = await innertube('browse', { continuation: cont });
        const p = parsePlaylists(data);
        for (const pl of p.playlists) {
          if (!playlists.some(function (x) { return x.id === pl.id; })) {
            playlists.push(pl);
          }
        }
        cont = p.continuation;
      }
      if (playlists.length) { return playlists; }
    } catch (e) {}
    try {
      const data = await innertube('playlist/get_add_to_playlist', { videoIds: [SEED_VIDEO] });
      const parsed = parsePlaylists(data);
      if (parsed.playlists.length) { return parsed.playlists; }
    } catch (e) {}
    throw new Error('Playlistler alınamadı — YouTube\'da giriş yaptığından emin ol.');
  }

  // -------------------------------------------------------------------------
  //  API: PLAYLIST VİDEOLARI
  // -------------------------------------------------------------------------
  function extractVideoItems(data) {
    const renderers = deepCollect(data, function (o) { return o.playlistVideoRenderer; });
    const items = [];
    for (const o of renderers) {
      const r = o.playlistVideoRenderer;
      if (!r || !r.videoId) { continue; }
      const ths = deepCollect(r, function (x) {
        return Array.isArray(x.thumbnails) && x.thumbnails.length;
      })[0];
      const thumbs = ths ? ths.thumbnails : [];
      let progress = 0;
      const pw = deepCollect(r, function (x) {
        return typeof x.percentDurationWatched === 'number';
      })[0];
      if (pw) { progress = Math.max(0, Math.min(100, pw.percentDurationWatched)); }
      let length = textOf(r.lengthText);
      if (!length) {
        const tsr = deepCollect(r, function (x) {
          return x.thumbnailOverlayTimeStatusRenderer;
        })[0];
        if (tsr) { length = textOf(tsr.thumbnailOverlayTimeStatusRenderer.text); }
      }
      let seconds = parseInt(r.lengthSeconds, 10) || 0;
      if (!seconds && length) { seconds = parseClock(length); }
      items.push({
        videoId: r.videoId,
        setVideoId: r.setVideoId || null,
        title: textOf(r.title),
        thumb: thumbs.length ? thumbs[thumbs.length - 1].url : '',
        channel: textOf(r.shortBylineText),
        length: length || '',
        seconds: seconds,
        progress: progress,
      });
    }
    return items;
  }
  function extractContinuation(data) {
    for (const c of deepCollect(data, function (o) { return o.continuationItemRenderer; })) {
      const ce = c.continuationItemRenderer && c.continuationItemRenderer.continuationEndpoint;
      const t = ce && ce.continuationCommand && ce.continuationCommand.token;
      if (t) { return t; }
    }
    return null;
  }
  async function fetchPlaylistVideos(playlistId, onProgress) {
    const browseId = playlistId.indexOf('VL') === 0 ? playlistId : 'VL' + playlistId;
    let data = await innertube('browse', { browseId: browseId });
    const out = new Map();
    for (const it of extractVideoItems(data)) { out.set(it.videoId, it); }
    if (onProgress) { onProgress(out.size); }
    let token = extractContinuation(data);
    const seen = new Set();
    while (token && !seen.has(token)) {
      seen.add(token);
      data = await innertube('browse', { continuation: token });
      for (const it of extractVideoItems(data)) {
        if (!out.has(it.videoId)) { out.set(it.videoId, it); }
      }
      if (onProgress) { onProgress(out.size); }
      token = extractContinuation(data);
      await sleep(60);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  //  API: EKLE / ÇIKAR (429 geri-çekilmeli)
  // -------------------------------------------------------------------------
  async function editPlaylist(playlistId, action) {
    const data = await innertube('browse/edit_playlist', { playlistId: playlistId, actions: [action] });
    if (data && typeof data.status === 'string' && data.status !== 'STATUS_SUCCEEDED') {
      throw new Error('edit_playlist: ' + data.status);
    }
    return data;
  }
  async function editPlaylistSafe(playlistId, action) {
    let wait = 1500;
    for (let attempt = 0; ; attempt++) {
      try {
        return await editPlaylist(playlistId, action);
      } catch (e) {
        const code = e && e.httpStatus;
        const msg = String((e && e.message) || e);
        const rl = code === 429 || code === 503 || code === 500 || /\b(429|503)\b|too many|rate/i.test(msg);
        if (attempt < 3 && rl) {
          await sleep(wait);
          wait *= 2;
          continue;
        }
        throw e;
      }
    }
  }
  function addVideo(pl, vid) {
    return editPlaylistSafe(pl, { action: 'ACTION_ADD_VIDEO', addedVideoId: vid });
  }
  function removeVideo(pl, vid, setVideoId) {
    if (setVideoId) {
      return editPlaylistSafe(pl, { action: 'ACTION_REMOVE_VIDEO', setVideoId: setVideoId });
    }
    return editPlaylistSafe(pl, { action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: vid });
  }

  // -------------------------------------------------------------------------
  //  ÜYELİK
  // -------------------------------------------------------------------------
  function managedPlaylists() {
    const list = state.playlists.filter(function (p) { return state.managed.has(p.id); });
    // Kullanıcı yapılandırdıysa seçimine uy (alt küme bile olsa). Yapılandırmadıysa = tümü.
    if (state.managedConfigured) { return list; }
    return state.playlists.slice();
  }
  async function loadMembership(force) {
    if (state.membershipFresh && !force) { return; }
    const mem = new Map();
    for (const pl of managedPlaylists()) {
      if (state.current && pl.id === state.current.id) {
        const m = new Map();
        for (const v of state.videos) { m.set(v.videoId, v); }
        mem.set(pl.id, m);
        continue;
      }
      try { mem.set(pl.id, await fetchPlaylistVideos(pl.id)); } catch (e) {}
    }
    state.membership = mem;
    state.membershipFresh = true;
  }
  function inOtherManaged(videoId) {
    for (const pl of managedPlaylists()) {
      if (state.current && pl.id === state.current.id) { continue; }
      const m = state.membership.get(pl.id);
      if (m && m.has(videoId)) { return true; }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  //  PLANLAMA MOTORU
  // -------------------------------------------------------------------------
  function buildPlan(mode, selection, managedList, membership, videoIds, titleOf) {
    const ops = [];
    for (const vid of videoIds) {
      for (const pl of managedList) {
        const plMap = membership.get(pl.id);
        if (!plMap) { continue; }
        const isIn = plMap.has(vid);
        const rec = plMap.get(vid);
        let desired;
        if (mode === 'override') {
          desired = selection.get(pl.id) ? 'in' : 'out';
        } else {
          const s = selection.get(pl.id) || 'untouched';
          if (s === 'include') { desired = 'in'; }
          else if (s === 'exclude') { desired = 'out'; }
          else { desired = 'keep'; }
        }
        if (desired === 'in' && !isIn) {
          ops.push({
            type: 'add', videoId: vid, videoTitle: titleOf(vid),
            playlistId: pl.id, playlistTitle: pl.title,
          });
        } else if (desired === 'out' && isIn) {
          ops.push({
            type: 'remove', videoId: vid, videoTitle: titleOf(vid),
            playlistId: pl.id, playlistTitle: pl.title,
            setVideoId: rec ? rec.setVideoId : null,
          });
        }
      }
    }
    return ops;
  }
  // -------------------------------------------------------------------------
  //  ARKA PLAN İŞ MOTORU (background jobs)
  //  Her "iş" arka planda yürür (oku → planla → uygula); kullanıcı seçime devam
  //  edebilir. Üstte her iş için alt alta bir çubuk gösterilir; aynı anda birden
  //  çok iş başlatılabilir. GÜVENLİK: tüm yazma istekleri tek küresel "kapı"dan,
  //  ayardaki gecikmeyle sıraya dizilerek geçer — kaç iş paralel olursa olsun
  //  YouTube'a giden yazma hızı sabit kalır. Liste okunamazsa iş hiç yazmadan
  //  iptal; ilk yazma hatasında durur; iş başına geri-al vardır.
  // -------------------------------------------------------------------------
  const jobs = [];
  let jobSeq = 0;
  let writeGate = Promise.resolve();

  function gatedWrite(fn) {
    const run = writeGate.then(fn);
    writeGate = run.then(function () { return sleep(state.settings.delayMs); },
                         function () { return sleep(state.settings.delayMs); });
    return run;
  }
  function jobEmit(job) {
    job.listeners.forEach(function (fn) { try { fn(job); } catch (e) {} });
    renderJobBars();
  }
  function jobActive(job) { return job.phase === 'preparing' || job.phase === 'applying'; }
  function jobPct(job) {
    if (job.phase === 'preparing') { return job.readTotal ? Math.round((job.readDone / job.readTotal) * 100) : 6; }
    if (job.phase === 'applying') { return job.total ? Math.round((job.done / job.total) * 100) : 100; }
    return 100;
  }
  function jobMetaText(job) {
    if (job.phase === 'preparing') {
      return job.readTotal ? tt('Listeler okunuyor… ') + job.readDone + '/' + job.readTotal : tt('Hazırlanıyor…');
    }
    if (job.phase === 'applying') { return (job.dryRun ? tt('DRY-RUN: ') : '') + job.done + ' / ' + job.total; }
    if (job.phase === 'cancelled') { return tt('İptal edildi — ') + job.okCount + '/' + job.total; }
    if (job.phase === 'error') { return tt('Hata — ') + job.okCount + tt(' yapıldı, durdu'); }
    if (job.dryRun) { return tt('DRY-RUN bitti — ') + job.okCount + tt(' simüle'); }
    if (job.total === 0) { return tt('Değişiklik yok'); }
    return tt('Bitti — ') + job.okCount + tt(' işlem') + (job.failCount ? ' (' + job.failCount + tt(' hata') + ')' : '');
  }
  function startJob(opts) {
    const job = {
      id: ++jobSeq, title: opts.title, dryRun: !!opts.dryRun, sourceListId: opts.sourceListId || null,
      phase: 'preparing', readDone: 0, readTotal: 0,
      ops: [], total: 0, done: 0, okCount: 0, failCount: 0,
      results: [], error: null, cancelled: false, listeners: new Set(),
    };
    jobs.push(job);
    renderJobBars();
    runJobLifecycle(job, opts.prepare);
    return job;
  }
  async function runJobLifecycle(job, prepare) {
    try {
      const ops = await prepare(job);
      if (job.cancelled) { job.phase = 'cancelled'; jobEmit(job); return; }
      job.ops = ops; job.total = ops.length; job.phase = 'applying';
      jobEmit(job);
      await runJobOps(job);
    } catch (e) {
      job.phase = 'error';
      job.error = String((e && e.message) || e);
      jobEmit(job);
    }
  }
  async function runJobOps(job) {
    for (let i = 0; i < job.ops.length; i++) {
      if (job.cancelled) { job.phase = 'cancelled'; break; }
      const op = job.ops[i];
      try {
        if (job.dryRun) {
          job.results.push({ op: op, ok: true, dryRun: true });
          await sleep(0);
        } else {
          if (op.type === 'add') { await gatedWrite(function () { return addVideo(op.playlistId, op.videoId); }); }
          else { await gatedWrite(function () { return removeVideo(op.playlistId, op.videoId, op.setVideoId); }); }
          job.results.push({ op: op, ok: true });
        }
        job.okCount++;
        job.done = job.results.length;
        jobEmit(job);
      } catch (e) {
        job.results.push({ op: op, ok: false, error: String((e && e.message) || e) });
        job.failCount++;
        job.done = job.results.length;
        job.phase = 'error';
        jobEmit(job);
        break;
      }
    }
    if (job.phase === 'applying') { job.phase = 'done'; }
    finalizeJob(job);
    jobEmit(job);
  }
  function finalizeJob(job) {
    if (job.dryRun) { return; }
    const applied = [];
    for (const r of job.results) { if (r.ok && !r.dryRun) { applied.push(r.op); } }
    if (applied.length) {
      state.membershipFresh = false;
      try { localStorage.setItem(LS_LASTBATCH, JSON.stringify({ ops: applied })); } catch (e) {}
    }
  }
  function cancelJob(job) { if (jobActive(job)) { job.cancelled = true; jobEmit(job); } }
  function dismissJob(job) { const i = jobs.indexOf(job); if (i >= 0) { jobs.splice(i, 1); } renderJobBars(); }

  // Doğrudan uygula: pencereyi kapatıp arka planda oku→planla→uygula yapar.
  function startDirectJob(mode, selection, managed, videoIds) {
    const title = (mode === 'override' ? tt('Senkronla — ') : tt('Kısmi işlem — ')) + videoIds.length + tt(' video');
    return startJob({
      title: title, dryRun: false, sourceListId: state.current ? state.current.id : null,
      prepare: async function (job) {
        job.readTotal = managed.length; jobEmit(job);
        const membership = new Map();
        const usable = [];
        for (let i = 0; i < managed.length; i++) {
          if (job.cancelled) { return []; }
          const pl = managed[i];
          // Bir liste bile okunamazsa: TÜM iş iptal — eksik bilgiyle dokunulmaz.
          try { membership.set(pl.id, await fetchPlaylistVideos(pl.id)); usable.push(pl); }
          catch (e) { throw new Error('"' + pl.title + tt('" okunamadı: ') + ((e && e.message) || e) + tt(' — hiçbir değişiklik yapılmadı.')); }
          job.readDone = i + 1; jobEmit(job);
        }
        function titleOf(vid) { const v = state.vmap.get(vid); return v ? (v.title || vid) : vid; }
        return buildPlan(mode, selection, usable, membership, videoIds, titleOf);
      },
    });
  }
  // İş başına geri-al: yapılan (canlı) işlemlerin TERSİNİ yeni bir arka plan işi olarak çalıştırır.
  function undoJobOps(job) {
    const applied = [];
    for (const r of job.results) { if (r.ok && !r.dryRun) { applied.push(r.op); } }
    if (!applied.length) { return; }
    if (!confirm(tt('Bu işin TERSİ uygulanacak: ') + applied.length + tt(' işlem.\n\nDevam edilsin mi?'))) { return; }
    const inverse = applied.map(function (op) {
      if (op.type === 'add') {
        return { type: 'remove', videoId: op.videoId, videoTitle: op.videoTitle, playlistId: op.playlistId, playlistTitle: op.playlistTitle, setVideoId: null };
      }
      return { type: 'add', videoId: op.videoId, videoTitle: op.videoTitle, playlistId: op.playlistId, playlistTitle: op.playlistTitle };
    });
    startJob({ title: tt('↩ Geri al — ') + applied.length + tt(' işlem'), dryRun: false,
      sourceListId: job.sourceListId, prepare: async function () { return inverse; } });
  }

  // -------------------------------------------------------------------------
  //  STİL
  // -------------------------------------------------------------------------
  const CSS = `
  #ypo-fab{position:fixed;right:14px;bottom:78px;z-index:2147482000;width:56px;height:56px;
    border-radius:50%;border:none;background:linear-gradient(135deg,#ff0040,#ff5d00);color:#fff;
    font-size:23px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.55);display:flex;
    align-items:center;justify-content:center;padding:0}
  #ypo-fab:active{transform:scale(.93)}

  #ypo-root{position:fixed;inset:0;z-index:2147483000;background:#0f0f10;color:#f3f3f5;
    display:none;flex-direction:column;
    font:14px/1.5 Roboto,-apple-system,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  #ypo-root.open{display:flex}
  #ypo-root *,#ypo-root *::before,#ypo-root *::after{box-sizing:border-box}
  #ypo-root button{font-family:inherit}
  #ypo-root::-webkit-scrollbar,#ypo-root *::-webkit-scrollbar{width:9px;height:9px}
  #ypo-root *::-webkit-scrollbar-thumb{background:#3a3a42;border-radius:8px}

  .ypo-top{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#18181b;
    border-bottom:1px solid #2a2a31;flex:none;padding-top:calc(10px + env(safe-area-inset-top))}
  .ypo-top .ttl{flex:1;min-width:0;font-weight:800;font-size:15px;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .ypo-top .crumb{color:#9a9aa6;font-weight:600;font-size:13px}

  .ypo-ic{appearance:none;background:#26262d;border:1px solid #3b3b44;color:#f3f3f5;
    width:38px;height:38px;border-radius:10px;font-size:16px;cursor:pointer;flex:none;
    display:flex;align-items:center;justify-content:center;padding:0}
  .ypo-ic:active{background:#33333c}
  .ypo-ic.cl{background:#2f1b1b;border-color:#5a2a2a}

  .ypo-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:13px}
  .ypo-bottom{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;
    background:#18181b;border-top:1px solid #2a2a31;padding-bottom:calc(10px + env(safe-area-inset-bottom))}
  .ypo-bottom:empty{display:none}

  .ypo-btn{appearance:none;border:1px solid #3b3b44;background:#26262d;color:#f3f3f5;
    padding:11px 15px;border-radius:11px;font-size:13.5px;font-weight:700;cursor:pointer;min-height:44px}
  .ypo-btn:active{transform:scale(.97)}
  .ypo-btn.pri{background:#3ea6ff;color:#04243d;border-color:#3ea6ff}
  .ypo-btn.dng{background:#f0433a;color:#fff;border-color:#f0433a}
  .ypo-btn.gho{background:transparent}
  .ypo-btn.sm{padding:8px 12px;font-size:12.5px;min-height:38px;border-radius:9px}
  .ypo-btn:disabled{opacity:.4}
  .ypo-btn.wide{flex:1}

  .ypo-select{appearance:none;background:#1f1f24;color:#f3f3f5;border:1px solid #2a2a31;
    border-radius:999px;padding:9px 30px 9px 13px;font-size:12.5px;font-weight:600;min-height:40px;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239a9aa6' stroke-width='1.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat:no-repeat;background-position:right 12px center}
  .ypo-search{display:flex;align-items:center;gap:7px;background:#1f1f24;border:1px solid #2a2a31;
    border-radius:999px;padding:9px 13px;min-height:40px;flex:1;min-width:130px}
  .ypo-search input{background:transparent;border:none;color:#f3f3f5;font-size:13px;outline:none;width:100%}
  .ypo-search input::placeholder{color:#66666f}

  .ypo-tools{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:13px}
  .ypo-seg{display:flex;background:#1f1f24;border:1px solid #2a2a31;border-radius:999px;padding:3px}
  .ypo-seg button{appearance:none;background:transparent;border:none;color:#9a9aa6;padding:7px 12px;
    border-radius:999px;font-size:12px;font-weight:700;cursor:pointer}
  .ypo-seg button.on{background:#2c2c33;color:#f3f3f5}
  .ypo-seg button .n{color:#66666f;margin-left:3px}
  .ypo-seg button.on .n{color:#3ea6ff}
  .ypo-chk{display:flex;align-items:center;gap:7px;background:#1f1f24;border:1px solid #2a2a31;
    border-radius:999px;padding:8px 13px;font-size:12.5px;font-weight:600;color:#9a9aa6;min-height:40px}
  .ypo-chk input{width:16px;height:16px;accent-color:#3ea6ff}

  .ypo-grid{display:grid;gap:13px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
  .ypo-pcard{background:#18181b;border:1px solid #2a2a31;border-radius:13px;overflow:hidden;cursor:pointer}
  .ypo-pcard:active{border-color:#3ea6ff}
  .ypo-pthumb{position:relative;aspect-ratio:16/9;background:#000 center/cover no-repeat}
  .ypo-pthumb .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    color:#3a3a42;font-size:30px}
  .ypo-pthumb .cnt{position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.84);
    padding:2px 7px;border-radius:5px;font-size:11px;font-weight:700}
  .ypo-pbody{padding:9px 11px 11px}
  .ypo-ptitle{font-weight:600;font-size:13px;line-height:1.35;min-height:35px;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .ypo-pbadge{display:inline-block;margin-top:6px;font-size:10px;font-weight:700;color:#34d058;
    border:1px solid rgba(52,208,88,.4);background:rgba(52,208,88,.12);border-radius:999px;padding:2px 7px}

  .ypo-vrow{display:flex;align-items:center;gap:10px;padding:9px;background:#18181b;
    border:1px solid #2a2a31;border-radius:11px;margin-bottom:9px;cursor:pointer}
  .ypo-vrow.sel{border-color:#3ea6ff;background:rgba(62,166,255,.1)}
  .ypo-vchk{width:24px;height:24px;border:2px solid #3b3b44;border-radius:7px;flex:none;
    position:relative;background:#1f1f24}
  .ypo-vrow.sel .ypo-vchk{background:#3ea6ff;border-color:#3ea6ff}
  .ypo-vrow.sel .ypo-vchk::after{content:"";position:absolute;left:7px;top:2px;width:6px;height:12px;
    border:solid #04243d;border-width:0 3px 3px 0;transform:rotate(45deg)}
  .ypo-vthumb{position:relative;width:122px;aspect-ratio:16/9;flex:none;border-radius:8px;
    overflow:hidden;background:#000 center/cover no-repeat}
  .ypo-vdur{position:absolute;right:4px;bottom:6px;background:rgba(0,0,0,.85);font-size:10.5px;
    font-weight:700;padding:1px 4px;border-radius:4px}
  .ypo-vprog{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.28)}
  .ypo-vprog i{display:block;height:100%;background:#ff0040}
  .ypo-vmain{flex:1;min-width:0}
  .ypo-vtitle{font-weight:600;font-size:13px;line-height:1.35;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .ypo-vmeta{margin-top:3px;font-size:11px;color:#66666f;display:flex;gap:6px;flex-wrap:wrap}
  .ypo-vmeta .w{color:#34d058;font-weight:700}
  .ypo-vmeta .pw{color:#ffb24d;font-weight:700}
  .ypo-vchips{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}
  .ypo-chip{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;
    padding:2px 7px;border-radius:999px}
  .ypo-chip .dot{width:6px;height:6px;border-radius:50%}
  .ypo-vopen{flex:none;width:34px;height:34px;display:flex;align-items:center;justify-content:center;
    color:#66666f;font-size:15px;text-decoration:none;border-radius:8px}
  .ypo-vopen:active{background:#2c2c33}

  .ypo-sentinel{text-align:center;color:#66666f;font-size:12px;padding:16px}
  .ypo-empty{text-align:center;color:#66666f;padding:54px 18px}
  .ypo-empty .i{font-size:42px;margin-bottom:12px;opacity:.55}
  .ypo-sk{background:linear-gradient(90deg,#1c1c20 25%,#2b2b32 50%,#1c1c20 75%);
    background-size:200% 100%;animation:ypo-sh 1.3s infinite linear;border-radius:6px}
  @keyframes ypo-sh{from{background-position:200% 0}to{background-position:-200% 0}}
  .ypo-spin{width:26px;height:26px;border:3px solid #2c2c33;border-top-color:#3ea6ff;
    border-radius:50%;animation:ypo-rot 1s linear infinite;margin:0 auto 12px}
  @keyframes ypo-rot{to{transform:rotate(360deg)}}

  .ypo-scrim{position:absolute;inset:0;background:rgba(0,0,0,.6);display:flex;
    align-items:flex-end;justify-content:center;z-index:10}
  .ypo-sheet{background:#18181b;width:100%;max-width:640px;max-height:92%;border-radius:18px 18px 0 0;
    display:flex;flex-direction:column;animation:ypo-up .22s ease}
  @keyframes ypo-up{from{transform:translateY(40px);opacity:.4}to{transform:translateY(0);opacity:1}}
  .ypo-shead{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid #2a2a31}
  .ypo-shead h3{margin:0;font-size:15.5px;font-weight:800;flex:1}
  .ypo-x{appearance:none;background:none;border:none;color:#9a9aa6;font-size:19px;cursor:pointer}
  .ypo-sbody{padding:15px 16px;overflow-y:auto;display:flex;flex-direction:column;gap:13px}
  .ypo-sfoot{padding:11px 16px;border-top:1px solid #2a2a31;display:flex;gap:8px;flex-wrap:wrap;
    padding-bottom:calc(11px + env(safe-area-inset-bottom))}
  .ypo-sfoot .ypo-btn{flex:1}

  .ypo-card{border:1px solid #2a2a31;border-radius:11px;padding:13px;background:#1f1f24}
  .ypo-lbl{font-weight:800;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;
    color:#9a9aa6;margin-bottom:9px}
  .ypo-hint{color:#9a9aa6;font-size:12px;line-height:1.5}

  .ypo-mode{display:flex;gap:10px;padding:12px;border:1.5px solid #3b3b44;border-radius:10px;
    cursor:pointer;margin-bottom:8px}
  .ypo-mode.on{border-color:#3ea6ff;background:#16344f}
  .ypo-mode input{margin-top:2px;width:18px;height:18px;accent-color:#3ea6ff;flex:none}
  .ypo-mode b{font-size:13px}
  .ypo-mode small{display:block;margin-top:3px;color:#9a9aa6;font-size:11.5px;line-height:1.45}

  .ypo-plrow{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #2a2a31;
    border-radius:10px;margin-bottom:7px}
  .ypo-plrow .nm{flex:1;min-width:0;display:flex;align-items:center;gap:8px;overflow:hidden}
  .ypo-plrow .nm span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ypo-plrow .nm .dot{width:10px;height:10px;border-radius:50%;flex:none}
  .ypo-plrow label{display:flex;align-items:center;gap:7px;color:#9a9aa6;font-size:12px}
  .ypo-plrow label input{width:18px;height:18px;accent-color:#3ea6ff}
  .ypo-tri{display:flex;border:1px solid #3b3b44;border-radius:8px;overflow:hidden;flex:none}
  .ypo-tri button{appearance:none;border:none;background:#2c2c33;color:#9a9aa6;padding:8px 10px;
    font-size:12px;font-weight:700;cursor:pointer}
  .ypo-tri button.on.inc{background:#34d058;color:#06210b}
  .ypo-tri button.on.unt{background:#5a5a64;color:#fff}
  .ypo-tri button.on.exc{background:#f0433a;color:#fff}

  .ypo-dry{display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;border:1.5px solid}
  .ypo-dry.d{background:rgba(232,181,58,.1);border-color:rgba(232,181,58,.55)}
  .ypo-dry.l{background:rgba(240,67,58,.11);border-color:rgba(240,67,58,.6)}
  .ypo-dry input{width:22px;height:22px;flex:none;accent-color:#e8b53a}
  .ypo-dry.l input{accent-color:#f0433a}
  .ypo-dry .t{font-size:12px;line-height:1.45}

  .ypo-stats{display:flex;gap:9px}
  .ypo-stat{flex:1;text-align:center;padding:13px 6px;border-radius:10px;border:1px solid}
  .ypo-stat .n{font-size:23px;font-weight:800}
  .ypo-stat .l{font-size:10px;font-weight:700;text-transform:uppercase;margin-top:5px}
  .ypo-stat.a{background:rgba(52,208,88,.1);border-color:rgba(52,208,88,.4);color:#34d058}
  .ypo-stat.r{background:rgba(240,67,58,.1);border-color:rgba(240,67,58,.4);color:#ff8079}
  .ypo-stat.k{background:#1f1f24;border-color:#2a2a31;color:#9a9aa6}
  .ypo-oplist{max-height:46vh;overflow-y:auto;border:1px solid #2a2a31;border-radius:10px}
  .ypo-op{display:flex;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid #2a2a31;font-size:12px}
  .ypo-op:last-child{border-bottom:none}
  .ypo-tag{font-weight:800;font-size:10px;padding:3px 7px;border-radius:5px;width:58px;text-align:center;flex:none}
  .ypo-tag.a{background:#34d058;color:#06210b}
  .ypo-tag.r{background:#f0433a;color:#fff}
  .ypo-op .v{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ypo-op .p{color:#3ea6ff;font-weight:700;flex:none}
  .ypo-op .st{flex:none;width:15px;text-align:center;font-weight:800}
  .ypo-pbar{height:9px;background:#2c2c33;border-radius:6px;overflow:hidden}
  .ypo-pbar i{display:block;height:100%;width:0;background:#3ea6ff;transition:width .15s}
  .ypo-mono{font-family:Consolas,monospace;font-size:11px;white-space:pre-wrap;background:#121214;
    border:1px solid #2a2a31;border-radius:7px;padding:9px;max-height:40vh;overflow:auto;color:#9a9aa6}
  .ypo-selinfo{flex:1;font-size:13px;color:#9a9aa6}
  .ypo-selinfo b{color:#3ea6ff;font-size:15px}

  #ypo-toast{position:absolute;left:50%;bottom:84px;transform:translateX(-50%) translateY(16px);
    background:#2c2c33;border:1px solid #3b3b44;color:#f3f3f5;padding:10px 17px;border-radius:999px;
    font-size:12.5px;z-index:20;opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;max-width:90%}
  #ypo-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
  #ypo-toast.err{background:#3a1715;border-color:#f0433a}

  /* arka plan iş çubukları (background job bars) */
  #ypo-jobbars{position:absolute;top:calc(54px + env(safe-area-inset-top));left:8px;right:8px;z-index:9;
    display:flex;flex-direction:column;gap:8px;pointer-events:none}
  #ypo-jobbars:empty{display:none}
  .ypo-jobbar{pointer-events:auto;background:#1f1f24;border:1px solid #3b3b44;border-left:3px solid #3ea6ff;
    border-radius:10px;padding:9px 11px;box-shadow:0 6px 18px rgba(0,0,0,.5);animation:ypo-up .18s ease}
  .ypo-jobbar.preparing{border-left-color:#e8b53a}
  .ypo-jobbar.applying{border-left-color:#3ea6ff}
  .ypo-jobbar.done{border-left-color:#34d058}
  .ypo-jobbar.error{border-left-color:#f0433a}
  .ypo-jobbar.cancelled{border-left-color:#66666f}
  .ypo-jb-top{display:flex;align-items:center;gap:8px;margin-bottom:7px}
  .ypo-jb-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;font-size:12.5px}
  .ypo-jobbar.dry .ypo-jb-title::after{content:"DRY";margin-left:6px;font-size:9px;font-weight:800;color:#e8b53a;
    border:1px solid rgba(232,181,58,.5);border-radius:4px;padding:1px 4px}
  .ypo-jb-x{appearance:none;background:none;border:none;color:#66666f;font-size:15px;padding:2px 8px;cursor:pointer;flex:none}
  .ypo-jb-track{height:7px;background:#2c2c33;border-radius:5px;overflow:hidden}
  .ypo-jb-track i{display:block;height:100%;width:0;background:#3ea6ff;transition:width .2s}
  .ypo-jobbar.preparing .ypo-jb-track i{background:#e8b53a}
  .ypo-jobbar.done .ypo-jb-track i{background:#34d058}
  .ypo-jobbar.error .ypo-jb-track i{background:#f0433a}
  .ypo-jobbar.cancelled .ypo-jb-track i{background:#66666f}
  .ypo-jb-meta{margin-top:6px;color:#9a9aa6;font-size:11px;font-weight:600}

  @media(min-width:760px){
    .ypo-body{padding:20px;max-width:1180px;margin:0 auto;width:100%}
    .ypo-grid{grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}
    .ypo-vthumb{width:150px}
    #ypo-jobbars{left:auto;width:340px}
  }`;
  function injectStyle() {
    if ($id('ypo-style')) { return; }
    const st = document.createElement('style');
    st.id = 'ypo-style';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  // -------------------------------------------------------------------------
  //  OVERLAY KABUĞU
  // -------------------------------------------------------------------------
  function buildOverlay() {
    if ($id('ypo-root')) { return; }
    const top = h('div', { class: 'ypo-top' },
      h('button', { class: 'ypo-ic cl', text: '✕', onclick: closeOverlay }),
      h('div', { class: 'ttl', id: 'ypo-title', text: 'Oynatma Listelerim' }),
      h('button', { class: 'ypo-ic', text: '↻', title: 'Yenile', onclick: function () { refreshPlaylists(); } }),
      h('button', { class: 'ypo-ic', text: '⚙', title: 'Ayarlar', onclick: function () { if (state.playlists.length) { openSettings(); } } }),
      h('button', { class: 'ypo-ic', text: '🔧', title: 'Tanılama', onclick: openDiag }));
    const root = h('div', { id: 'ypo-root' },
      top,
      h('div', { class: 'ypo-body', id: 'ypo-bodyview' }),
      h('div', { class: 'ypo-bottom', id: 'ypo-bottombar' }),
      h('div', { id: 'ypo-jobbars' }),
      h('div', { id: 'ypo-toast' }),
      h('div', { id: 'ypo-sheet-host' }));
    document.body.appendChild(root);
  }
  function openOverlay() {
    buildOverlay();
    $id('ypo-root').classList.add('open');
    document.documentElement.style.overflow = 'hidden';
    refreshPlaylists();
  }
  function closeOverlay() {
    closeSheet();
    const r = $id('ypo-root');
    if (r) { r.classList.remove('open'); }
    document.documentElement.style.overflow = '';
  }
  function setTitle(text, onBack) {
    const t = $id('ypo-title');
    if (!t) { return; }
    clear(t);
    if (onBack) {
      const a = h('span', { class: 'crumb', text: '‹ Listeler   ', style: { cursor: 'pointer' }, onclick: onBack });
      t.appendChild(a);
    }
    t.appendChild(document.createTextNode(text));
  }
  function bodyEl() { return $id('ypo-bodyview'); }
  function bottomEl() { return $id('ypo-bottombar'); }
  function emptyState(ico, msg) {
    return h('div', { class: 'ypo-empty' }, h('div', { class: 'i', text: ico }), h('div', { text: msg }));
  }
  function skeletonGrid(n) {
    const g = h('div', { class: 'ypo-grid' });
    for (let i = 0; i < n; i++) {
      g.appendChild(h('div', { class: 'ypo-pcard' },
        h('div', { class: 'ypo-sk', style: { aspectRatio: '16/9' } }),
        h('div', { style: { padding: '11px' } },
          h('div', { class: 'ypo-sk', style: { height: '13px' } }),
          h('div', { class: 'ypo-sk', style: { height: '11px', width: '55%', marginTop: '8px' } }))));
    }
    return g;
  }
  function skeletonRows(n) {
    const w = h('div', {});
    for (let i = 0; i < n; i++) {
      w.appendChild(h('div', { class: 'ypo-vrow' },
        h('div', { class: 'ypo-sk', style: { width: '122px', aspectRatio: '16/9', flex: 'none' } }),
        h('div', { style: { flex: '1' } },
          h('div', { class: 'ypo-sk', style: { height: '12px' } }),
          h('div', { class: 'ypo-sk', style: { height: '10px', width: '45%', marginTop: '7px' } }))));
    }
    return w;
  }

  // -------------------------------------------------------------------------
  //  GÖRÜNÜM: PLAYLIST IZGARASI
  // -------------------------------------------------------------------------
  async function refreshPlaylists() {
    state.view = 'playlists';
    state.current = null;
    state.selected.clear();
    state.membershipFresh = false;
    setTitle('Oynatma Listelerim');
    clear(bottomEl());
    const body = bodyEl();
    clear(body);
    body.appendChild(h('div', { class: 'ypo-hint', style: { marginBottom: '12px' }, text: 'Playlistlerin getiriliyor…' }));
    body.appendChild(skeletonGrid(8));
    try {
      const pls = await enumeratePlaylists();
      state.playlists = pls;
      // İlk kurulum: varsayılan olarak tümü yönetilen. Sonrasında kullanıcı seçimine
      // ASLA dokunma (eskiden burada budama vardı ve seçimi siliyordu — kök neden buydu).
      if (!state.managedConfigured) {
        state.managed = new Set(pls.map(function (p) { return p.id; }));
        state.managedConfigured = true;
        saveSettings();
      }
      renderPlaylists();
    } catch (e) {
      // INSTANT yolda bir aksilik → kanıtlanmış gerçek-sayfa yoluna düş (asla bozulma).
      if (isInterceptPage()) { ypoBridge('fallbackToReal'); return; }
      clear(body);
      body.appendChild(emptyState('⚠️', e.message));
    }
  }
  function renderPlaylists() {
    const body = bodyEl();
    clear(body);
    clear(bottomEl());
    if (!state.playlists.length) {
      body.appendChild(emptyState('📭', 'Playlist bulunamadı.'));
      return;
    }
    const tools = h('div', { class: 'ypo-tools' });
    const si = h('input', { type: 'text', placeholder: 'Liste ara…' });
    si.value = state.plSearch;
    si.addEventListener('input', function () { state.plSearch = si.value; renderPlaylistGrid(); });
    tools.appendChild(h('div', { class: 'ypo-search' }, h('span', { text: '⌕', style: { color: '#66666f' } }), si));
    tools.appendChild(mkSelect([
      ['default', 'Sıra: Varsayılan'], ['title-asc', 'İsim A→Z'], ['title-desc', 'İsim Z→A'],
      ['count-desc', 'Video çok→az'], ['count-asc', 'Video az→çok'],
    ], state.settings.plSort, function (v) {
      state.settings.plSort = v;
      saveSettings();
      renderPlaylistGrid();
    }));
    const mo = h('input', { type: 'checkbox' });
    mo.checked = state.plManagedOnly;
    mo.addEventListener('change', function () { state.plManagedOnly = mo.checked; saveSettings(); renderPlaylistGrid(); });
    tools.appendChild(h('label', { class: 'ypo-chk' }, mo, h('span', { text: 'Yönetilenler' })));
    body.appendChild(tools);
    body.appendChild(h('div', { class: 'ypo-hint', id: 'ypo-pcount', style: { margin: '0 0 10px' } }));
    body.appendChild(h('div', { id: 'ypo-pgrid' }));
    renderPlaylistGrid();
  }
  function sortPlaylists(list) {
    function num(p) { return parseInt(String(p.count).replace(/[^\d]/g, ''), 10) || 0; }
    const s = state.settings.plSort;
    let cmp = null;
    if (s === 'title-asc') { cmp = function (a, b) { return a.title.localeCompare(b.title, 'tr'); }; }
    else if (s === 'title-desc') { cmp = function (a, b) { return b.title.localeCompare(a.title, 'tr'); }; }
    else if (s === 'count-desc') { cmp = function (a, b) { return num(b) - num(a); }; }
    else if (s === 'count-asc') { cmp = function (a, b) { return num(a) - num(b); }; }
    if (cmp) { return list.slice().sort(cmp); }
    return list;
  }
  function renderPlaylistGrid() {
    const box = $id('ypo-pgrid');
    if (!box) { return; }
    clear(box);
    let list = state.playlists.slice();
    const q = state.plSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(function (p) { return p.title.toLowerCase().indexOf(q) !== -1; });
    }
    if (state.plManagedOnly) {
      list = list.filter(function (p) { return state.managed.has(p.id); });
    }
    list = sortPlaylists(list);
    const pc = $id('ypo-pcount');
    if (pc) { pc.textContent = list.length + ' / ' + state.playlists.length + tt(' liste'); }
    if (!list.length) {
      box.appendChild(emptyState('🔍', 'Eşleşen liste yok.'));
      return;
    }
    const grid = h('div', { class: 'ypo-grid' });
    for (const pl of list) {
      const thumb = h('div', { class: 'ypo-pthumb',
        style: pl.thumb ? { backgroundImage: 'url("' + pl.thumb + '")' } : {} });
      if (!pl.thumb) { thumb.appendChild(h('div', { class: 'ph', text: '☰' })); }
      if (pl.count) { thumb.appendChild(h('span', { class: 'cnt', text: pl.count })); }
      const bodyc = h('div', { class: 'ypo-pbody' }, h('div', { class: 'ypo-ptitle', text: pl.title }));
      if (state.managed.has(pl.id)) {
        bodyc.appendChild(h('span', { class: 'ypo-pbadge', text: '✓ yönetilen' }));
      }
      (function (p) {
        grid.appendChild(h('div', { class: 'ypo-pcard', onclick: function () { openPlaylist(p); } }, thumb, bodyc));
      })(pl);
    }
    box.appendChild(grid);
  }

  // -------------------------------------------------------------------------
  //  GÖRÜNÜM: PLAYLIST DETAYI
  // -------------------------------------------------------------------------
  async function openPlaylist(pl) {
    state.view = 'detail';
    state.current = pl;
    state.selected.clear();
    state.filter = 'all';
    state.search = '';
    state.memFilter = 'all';
    state.lastClickIdx = -1;
    setTitle(pl.title, function () { refreshPlaylists(); });
    clear(bottomEl());
    const body = bodyEl();
    clear(body);
    body.appendChild(skeletonRows(7));
    try {
      const map = await fetchPlaylistVideos(pl.id, function (n) { toast(n + tt(' video okundu…')); });
      hideToast();
      state.vmap = map;
      state.videos = Array.from(map.values());
      renderDetail();
      loadMembership().then(function () {
        updateChips();
        if (state.memFilter !== 'all') { renderList(); }
      }).catch(function () {});
    } catch (e) {
      clear(body);
      body.appendChild(emptyState('⚠️', tt('Videolar okunamadı: ') + e.message));
    }
  }

  function computeVisible() {
    const q = state.search.trim().toLowerCase();
    const arr = state.videos.filter(function (v) {
      if (state.filter === 'watched' && !(v.progress > 0)) { return false; }
      if (state.filter === 'unwatched' && v.progress > 0) { return false; }
      if (q) {
        const inTitle = (v.title || '').toLowerCase().indexOf(q) !== -1;
        const inCh = (v.channel || '').toLowerCase().indexOf(q) !== -1;
        if (!inTitle && !inCh) { return false; }
      }
      const mf = state.memFilter;
      if (mf === 'archived' && !inOtherManaged(v.videoId)) { return false; }
      if (mf === 'unarchived' && inOtherManaged(v.videoId)) { return false; }
      if (mf.indexOf('pl:') === 0) {
        const m = state.membership.get(mf.slice(3));
        if (!m || !m.has(v.videoId)) { return false; }
      }
      return true;
    });
    const s = state.settings.vidSort;
    let cmp = null;
    if (s === 'progress-desc') { cmp = function (a, b) { return b.progress - a.progress; }; }
    else if (s === 'progress-asc') { cmp = function (a, b) { return a.progress - b.progress; }; }
    else if (s === 'dur-desc') { cmp = function (a, b) { return (b.seconds || 0) - (a.seconds || 0); }; }
    else if (s === 'dur-asc') { cmp = function (a, b) { return (a.seconds || 0) - (b.seconds || 0); }; }
    else if (s === 'title-asc') { cmp = function (a, b) { return (a.title || '').localeCompare(b.title || '', 'tr'); }; }
    else if (s === 'title-desc') { cmp = function (a, b) { return (b.title || '').localeCompare(a.title || '', 'tr'); }; }
    else if (s === 'channel-asc') { cmp = function (a, b) { return (a.channel || '').localeCompare(b.channel || '', 'tr'); }; }
    if (cmp) { return arr.slice().sort(cmp); }
    return arr;
  }
  function buildMemSelect() {
    const sel = h('select', { class: 'ypo-select' });
    sel.appendChild(h('option', { value: 'all', text: 'Üyelik: Tümü' }));
    sel.appendChild(h('option', { value: 'archived', text: 'Arşivde VAR' }));
    sel.appendChild(h('option', { value: 'unarchived', text: 'Arşivde YOK' }));
    for (const pl of managedPlaylists()) {
      if (state.current && pl.id === state.current.id) { continue; }
      sel.appendChild(h('option', { value: 'pl:' + pl.id, text: '↳ ' + pl.title }));
    }
    sel.value = state.memFilter;
    sel.addEventListener('change', function () { state.memFilter = sel.value; renderList(); });
    return sel;
  }
  function renderDetail() {
    const body = bodyEl();
    clear(body);
    const watched = state.videos.filter(function (v) { return v.progress > 0; }).length;
    body.appendChild(h('div', { class: 'ypo-hint', style: { margin: '0 0 11px' } },
      h('b', { text: String(state.videos.length), style: { color: '#f3f3f5' } }), ' video • ',
      h('b', { text: String(watched), style: { color: '#f3f3f5' } }), ' izlenmiş'));

    const tools = h('div', { class: 'ypo-tools' });
    const seg = h('div', { class: 'ypo-seg' });
    const segBtns = {};
    const segs = [
      ['all', 'Tümü', state.videos.length],
      ['watched', 'İzlenmiş', watched],
      ['unwatched', 'İzlenmemiş', state.videos.length - watched],
    ];
    for (const item of segs) {
      const key = item[0];
      const b = h('button', { class: state.filter === key ? 'on' : '' }, item[1], h('span', { class: 'n', text: String(item[2]) }));
      (function (kk) {
        b.addEventListener('click', function () {
          state.filter = kk;
          for (const k in segBtns) { segBtns[k].className = (k === kk ? 'on' : ''); }
          renderList();
        });
      })(key);
      segBtns[key] = b;
      seg.appendChild(b);
    }
    tools.appendChild(seg);
    tools.appendChild(buildMemSelect());
    tools.appendChild(mkSelect([
      ['order', 'Sıra: Liste'], ['progress-desc', 'İzlenme çok→az'], ['progress-asc', 'İzlenme az→çok'],
      ['dur-desc', 'Süre uzun→kısa'], ['dur-asc', 'Süre kısa→uzun'],
      ['title-asc', 'Başlık A→Z'], ['title-desc', 'Başlık Z→A'], ['channel-asc', 'Kanal A→Z'],
    ], state.settings.vidSort, function (v) {
      state.settings.vidSort = v;
      saveSettings();
      renderList();
    }));
    const si = h('input', { type: 'text', id: 'ypo-vsearch', placeholder: 'Videolarda ara…' });
    si.value = state.search;
    si.addEventListener('input', function () { state.search = si.value; renderList(); });
    tools.appendChild(h('div', { class: 'ypo-search' }, h('span', { text: '⌕', style: { color: '#66666f' } }), si));
    tools.appendChild(h('button', {
      class: 'ypo-btn sm',
      onclick: function () {
        for (const v of curVisible) { state.selected.add(v.videoId); }
        updateSelectionUI();
      },
    }, 'Görüneni Seç'));
    tools.appendChild(h('button', {
      class: 'ypo-btn sm gho',
      onclick: function () { state.selected.clear(); updateSelectionUI(); },
    }, 'Temizle'));
    body.appendChild(tools);
    body.appendChild(h('div', { id: 'ypo-vlist' }));

    const bot = bottomEl();
    clear(bot);
    bot.appendChild(h('div', { class: 'ypo-selinfo', id: 'ypo-selinfo' }));
    bot.appendChild(h('button', { class: 'ypo-btn dng sm', id: 'ypo-qremove', onclick: quickRemove }, 'Listeden çıkar'));
    bot.appendChild(h('button', { class: 'ypo-btn pri', id: 'ypo-doop', onclick: openOperation }, 'İşlem Yap'));

    renderList();
  }
  function renderList() {
    const box = $id('ypo-vlist');
    if (!box) { return; }
    if (io) { io.disconnect(); }
    clear(box);
    curVisible = computeVisible();
    renderedCount = 0;
    if (!state.videos.length) {
      box.appendChild(emptyState('📭', 'Bu liste boş.'));
      updateSelectionUI();
      return;
    }
    if (!curVisible.length) {
      box.appendChild(emptyState('🔍', 'Eşleşen video yok.'));
      updateSelectionUI();
      return;
    }
    appendChunk();
    updateSelectionUI();
  }
  function ensureIO() {
    if (io) { return io; }
    io = new IntersectionObserver(function (entries) {
      for (const e of entries) {
        if (e.isIntersecting) {
          io.unobserve(e.target);
          appendChunk();
        }
      }
    }, { root: bodyEl(), rootMargin: '600px' });
    return io;
  }
  function appendChunk() {
    const box = $id('ypo-vlist');
    if (!box) { return; }
    const old = box.querySelector('.ypo-sentinel');
    if (old) { old.remove(); }
    const slice = curVisible.slice(renderedCount, renderedCount + RENDER_CHUNK);
    for (let i = 0; i < slice.length; i++) {
      box.appendChild(buildVideoRow(slice[i], renderedCount + i));
    }
    renderedCount += slice.length;
    updateChips();
    updateSelectionUI();
    if (renderedCount < curVisible.length) {
      const s = h('div', { class: 'ypo-sentinel' },
        h('div', { class: 'ypo-spin', style: { width: '18px', height: '18px', borderWidth: '2px' } }),
        h('div', { text: renderedCount + ' / ' + curVisible.length + ' — kaydır' }));
      box.appendChild(s);
      ensureIO().observe(s);
    }
  }
  function buildVideoRow(v, absIdx) {
    const cls = 'ypo-vrow' + (state.selected.has(v.videoId) ? ' sel' : '');
    const row = h('div', { class: cls, dataset: { vid: v.videoId, idx: String(absIdx) } });
    row.appendChild(h('div', { class: 'ypo-vchk' }));
    const thumb = h('div', { class: 'ypo-vthumb',
      style: v.thumb ? { backgroundImage: 'url("' + v.thumb + '")' } : {} });
    if (v.length) { thumb.appendChild(h('span', { class: 'ypo-vdur', text: v.length })); }
    if (v.progress > 0) {
      thumb.appendChild(h('div', { class: 'ypo-vprog' },
        h('i', { style: { width: Math.min(100, v.progress) + '%' } })));
    }
    row.appendChild(thumb);
    const meta = h('div', { class: 'ypo-vmeta' });
    if (v.channel) { meta.appendChild(h('span', { text: v.channel })); }
    if (v.progress >= 95) { meta.appendChild(h('span', { class: 'w', text: '✓ izlendi' })); }
    else if (v.progress > 0) { meta.appendChild(h('span', { class: 'pw', text: '%' + Math.round(v.progress) })); }
    row.appendChild(h('div', { class: 'ypo-vmain' },
      h('div', { class: 'ypo-vtitle', text: v.title || '(başlıksız)' }),
      meta,
      h('div', { class: 'ypo-vchips' })));
    const open = h('a', { class: 'ypo-vopen', href: 'https://www.youtube.com/watch?v=' + v.videoId,
      target: '_blank', rel: 'noopener', text: '↗' });
    open.addEventListener('click', function (e) { e.stopPropagation(); });
    row.appendChild(open);

    function toggle(e) {
      const visIdx = parseInt(row.dataset.idx, 10);
      if (e.shiftKey && state.lastClickIdx >= 0 && curVisible.length) {
        const a = Math.min(state.lastClickIdx, visIdx);
        const b = Math.max(state.lastClickIdx, visIdx);
        for (let i = a; i <= b; i++) {
          if (curVisible[i]) { state.selected.add(curVisible[i].videoId); }
        }
      } else {
        if (state.selected.has(v.videoId)) { state.selected.delete(v.videoId); }
        else { state.selected.add(v.videoId); }
      }
      state.lastClickIdx = visIdx;
      updateSelectionUI();
    }
    row.addEventListener('click', function (e) {
      if (e.target.closest('.ypo-vopen')) { return; }
      toggle(e);
    });
    return row;
  }
  function updateSelectionUI() {
    const box = $id('ypo-vlist');
    if (box) {
      const rows = box.querySelectorAll('.ypo-vrow');
      for (const row of rows) {
        row.classList.toggle('sel', state.selected.has(row.dataset.vid));
      }
    }
    let secs = 0;
    for (const id of state.selected) {
      const v = state.vmap.get(id);
      if (v) { secs += v.seconds || 0; }
    }
    const info = $id('ypo-selinfo');
    if (info) {
      clear(info);
      info.appendChild(h('b', { text: String(state.selected.size) }));
      info.appendChild(document.createTextNode(tt(' seçili') + (secs ? ' · ' + fmtDur(secs) : '')));
    }
    const op = $id('ypo-doop');
    const qr = $id('ypo-qremove');
    if (op) { op.disabled = state.selected.size === 0; }
    if (qr) { qr.disabled = state.selected.size === 0; }
  }
  function updateChips() {
    const box = $id('ypo-vlist');
    if (!box) { return; }
    const managed = managedPlaylists();
    const rows = box.querySelectorAll('.ypo-vrow');
    for (const row of rows) {
      const cb = row.querySelector('.ypo-vchips');
      if (!cb) { continue; }
      clear(cb);
      for (const pl of managed) {
        if (state.current && pl.id === state.current.id) { continue; }
        const m = state.membership.get(pl.id);
        if (m && m.has(row.dataset.vid)) {
          const col = plColor(pl.id);
          cb.appendChild(h('span', {
            class: 'ypo-chip',
            style: { background: hexA(col, 0.16), color: col },
          }, h('span', { class: 'dot', style: { background: col } }), pl.title));
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  //  SHEET
  // -------------------------------------------------------------------------
  // Sheet kapanırken çalışacak temizleyici (canlı iş detayının aboneliğini bırakması).
  let sheetCleanup = null;
  function closeSheet() {
    clear($id('ypo-sheet-host'));
    if (sheetCleanup) { const c = sheetCleanup; sheetCleanup = null; try { c(); } catch (e) {} }
  }
  function openSheet(title) {
    closeSheet();
    const body = h('div', { class: 'ypo-sbody' });
    const foot = h('div', { class: 'ypo-sfoot' });
    const sheet = h('div', { class: 'ypo-sheet' },
      h('div', { class: 'ypo-shead' }, h('h3', { text: title }),
        h('button', { class: 'ypo-x', text: '✕', onclick: closeSheet })),
      body, foot);
    const scrim = h('div', { class: 'ypo-scrim',
      onclick: function (e) { if (e.target === scrim) { closeSheet(); } } }, sheet);
    $id('ypo-sheet-host').appendChild(scrim);
    return { body: body, foot: foot };
  }

  // -------------------------------------------------------------------------
  //  İŞLEM PENCERESİ
  // -------------------------------------------------------------------------
  function openOperation() {
    if (!state.selected.size) { return; }
    const videoIds = Array.from(state.selected);
    const managed = managedPlaylists();
    const m = openSheet(tt('İşlem Yap — ') + videoIds.length + tt(' video'));

    const last = state.lastOp;
    let mode = (last && last.mode) || 'override';
    const selOv = new Map();
    const selPa = new Map();
    for (const p of managed) {
      selOv.set(p.id, !!(last && last.ov && last.ov[p.id]));
      selPa.set(p.id, (last && last.pa && last.pa[p.id]) || 'untouched');
    }

    const optOv = h('label', { class: 'ypo-mode' },
      h('input', { type: 'radio', name: 'ypomd' }),
      h('div', {}, h('b', { text: 'Mod 1 — Override (tam senkron)' }),
        h('small', { text: 'İşaretli listeler: eklensin. İşaretsiz: çıkarılsın. Tüm seçili videoların üyeliği kutulara birebir eşitlenir.' })));
    const optPa = h('label', { class: 'ypo-mode' },
      h('input', { type: 'radio', name: 'ypomd' }),
      h('div', {}, h('b', { text: 'Mod 2 — Include / Exclude (kısmi)' }),
        h('small', { text: '+ Ekle / · Dokunma / − Çıkar. "Dokunma" listelere hiç dokunulmaz.' })));
    const modeBox = h('div', { class: 'ypo-card' }, h('div', { class: 'ypo-lbl', text: 'Mod' }), optOv, optPa);

    const plRows = h('div', {});
    const modeHint = h('div', { class: 'ypo-hint' });
    const plBox = h('div', { class: 'ypo-card' },
      h('div', { class: 'ypo-lbl', text: tt('Hedef Listeler (') + managed.length + ')' }), plRows, modeHint);

    function renderRows() {
      clear(plRows);
      for (const p of managed) {
        const row = h('div', { class: 'ypo-plrow' },
          h('div', { class: 'nm' },
            h('span', { class: 'dot', style: { background: plColor(p.id) } }),
            h('span', { text: p.title })));
        if (mode === 'override') {
          const cb = h('input', { type: 'checkbox' });
          cb.checked = !!selOv.get(p.id);
          (function (pp) {
            cb.addEventListener('change', function () { selOv.set(pp.id, cb.checked); });
          })(p);
          row.appendChild(h('label', {}, cb, h('span', { text: 'olsun' })));
        } else {
          const cur = selPa.get(p.id);
          const tri = h('div', { class: 'ypo-tri' });
          const mk = function (val, label, cls) {
            const b = h('button', { class: cur === val ? 'on ' + cls : '' }, label);
            (function (pp, vv) {
              b.addEventListener('click', function () { selPa.set(pp.id, vv); renderRows(); });
            })(p, val);
            return b;
          };
          tri.appendChild(mk('include', '+', 'inc'));
          tri.appendChild(mk('untouched', '·', 'unt'));
          tri.appendChild(mk('exclude', '−', 'exc'));
          row.appendChild(tri);
        }
        plRows.appendChild(row);
      }
      modeHint.textContent = mode === 'override'
        ? tt('Override: işaretsiz listelerden de video ÇIKARILIR (yalnızca bu listeler).')
        : tt('Yalnızca + / − seçtiğin listeler etkilenir.');
    }
    function setMode(nm) {
      mode = nm;
      optOv.classList.toggle('on', nm === 'override');
      optPa.classList.toggle('on', nm === 'partial');
      optOv.querySelector('input').checked = nm === 'override';
      optPa.querySelector('input').checked = nm === 'partial';
      renderRows();
    }
    optOv.addEventListener('click', function () { setMode('override'); });
    optPa.addEventListener('click', function () { setMode('partial'); });
    setMode(mode);

    m.body.appendChild(modeBox);
    m.body.appendChild(plBox);
    m.foot.appendChild(h('button', { class: 'ypo-btn gho', text: 'İptal', onclick: closeSheet }));
    m.foot.appendChild(h('button', {
      class: 'ypo-btn pri wide', text: 'Önizle →',
      onclick: function () {
        if (mode === 'partial') {
          let any = false;
          for (const v of selPa.values()) {
            if (v !== 'untouched') { any = true; break; }
          }
          if (!any) {
            toast('En az bir liste için + veya − seç.', true);
            return;
          }
        }
        state.lastOp = { mode: mode, ov: Object.fromEntries(selOv), pa: Object.fromEntries(selPa) };
        runOperationPreview(mode, mode === 'override' ? selOv : selPa, managed, videoIds);
      },
    }));
    // Doğrudan uygula: önizleme/bekleme yok — sheet kapanır, işlem arka planda
    // yürür, üstte ilerleme çubuğu gösterilir. Kullanıcı seçime devam edebilir.
    m.foot.appendChild(h('button', {
      class: 'ypo-btn dng', style: { flexBasis: '100%' }, text: '⚡ Direkt Uygula',
      onclick: function () {
        if (mode === 'partial') {
          let any = false;
          for (const v of selPa.values()) { if (v !== 'untouched') { any = true; break; } }
          if (!any) { toast('En az bir liste için + veya − seç.', true); return; }
        }
        state.lastOp = { mode: mode, ov: Object.fromEntries(selOv), pa: Object.fromEntries(selPa) };
        if (!confirm(tt('CANLI — seçili ') + videoIds.length + tt(' video arka planda işlenecek.\n\nDevam edilsin mi?'))) { return; }
        const selection = mode === 'override' ? new Map(selOv) : new Map(selPa);
        closeSheet();
        startDirectJob(mode, selection, managed.slice(), videoIds.slice());
      },
    }));
  }

  async function runOperationPreview(mode, selection, managed, videoIds) {
    const m = openSheet('Önizleme hazırlanıyor…');
    const stat = h('div', { text: 'Listeler okunuyor…' });
    const bar = h('div', { class: 'ypo-pbar' }, h('i', {}));
    m.body.appendChild(stat);
    m.body.appendChild(bar);

    const membership = new Map();
    const readErr = [];
    for (let i = 0; i < managed.length; i++) {
      const pl = managed[i];
      stat.textContent = '"' + pl.title + '" (' + (i + 1) + '/' + managed.length + ')';
      try {
        membership.set(pl.id, await fetchPlaylistVideos(pl.id));
      } catch (e) {
        readErr.push(pl.title + ': ' + e.message);
      }
      bar.firstChild.style.width = Math.round(((i + 1) / managed.length) * 100) + '%';
    }
    state.membership = membership;
    state.membershipFresh = true;

    if (readErr.length) {
      clear(m.body);
      m.body.appendChild(h('div', { class: 'ypo-card' },
        h('div', { class: 'ypo-lbl', text: 'Listeler okunamadı — iptal edildi' }),
        h('div', { class: 'ypo-mono', text: readErr.join('\n') }),
        h('div', { class: 'ypo-hint', text: 'Hiçbir değişiklik yapılmadı.' })));
      m.foot.appendChild(h('button', { class: 'ypo-btn pri wide', text: 'Kapat', onclick: closeSheet }));
      return;
    }
    function titleOf(vid) {
      const v = state.vmap.get(vid);
      return v ? (v.title || vid) : vid;
    }
    const usable = managed.filter(function (p) { return membership.has(p.id); });
    const ops = buildPlan(mode, selection, usable, membership, videoIds, titleOf);
    renderPreview(m, ops, function () { openOperation(); }, videoIds.length * usable.length - ops.length);
  }

  function quickRemove() {
    if (!state.selected.size || !state.current) { return; }
    const ops = [];
    for (const vid of state.selected) {
      const v = state.vmap.get(vid);
      ops.push({
        type: 'remove', videoId: vid, videoTitle: (v && v.title) || vid,
        playlistId: state.current.id, playlistTitle: state.current.title,
        setVideoId: v ? v.setVideoId : null,
      });
    }
    const m = openSheet(tt('Bu listeden çıkar') + ' — ' + ops.length + tt(' video'));
    renderPreview(m, ops, null, 0);
  }

  function renderPreview(m, ops, backFn, noChange) {
    clear(m.body);
    clear(m.foot);
    let dryRun = state.settings.dryRun;
    const adds = ops.filter(function (o) { return o.type === 'add'; }).length;
    const rems = ops.filter(function (o) { return o.type === 'remove'; }).length;

    if (!ops.length) {
      m.body.appendChild(h('div', { class: 'ypo-hint', text: 'Yapılacak değişiklik yok — seçtiklerin zaten istenen durumda.' }));
      if (backFn) {
        m.foot.appendChild(h('button', {
          class: 'ypo-btn gho', text: '← Geri',
          onclick: function () { closeSheet(); backFn(); },
        }));
      }
      m.foot.appendChild(h('button', { class: 'ypo-btn pri wide', text: 'Kapat', onclick: closeSheet }));
      return;
    }

    const drySw = h('div', {});
    const dryChk = h('input', { type: 'checkbox' });
    dryChk.checked = dryRun;
    const dryTxt = h('span', { class: 't' });
    const applyBtn = h('button', { class: 'ypo-btn wide' });
    function paint() {
      drySw.className = 'ypo-dry ' + (dryRun ? 'd' : 'l');
      clear(dryTxt);
      dryTxt.appendChild(h('b', { text: dryRun ? 'DRY-RUN açık' : '⚠ CANLI MOD' }));
      const tail = dryRun
        ? ' — hiçbir şey yazılmaz, sadece gösterilir.'
        : ' — değişiklikler GERÇEKTEN uygulanır.';
      dryTxt.appendChild(document.createTextNode(tail));
      applyBtn.className = 'ypo-btn wide ' + (dryRun ? 'pri' : 'dng');
      applyBtn.textContent = dryRun ? tt('DRY-RUN Çalıştır') : (tt('Uygula (') + ops.length + ')');
    }
    dryChk.addEventListener('change', function () { dryRun = dryChk.checked; paint(); });
    drySw.appendChild(dryChk);
    drySw.appendChild(dryTxt);
    paint();
    m.body.appendChild(drySw);

    m.body.appendChild(h('div', { class: 'ypo-stats' },
      h('div', { class: 'ypo-stat a' },
        h('div', { class: 'n', text: String(adds) }), h('div', { class: 'l', text: 'ekleme' })),
      h('div', { class: 'ypo-stat r' },
        h('div', { class: 'n', text: String(rems) }), h('div', { class: 'l', text: 'çıkarma' })),
      h('div', { class: 'ypo-stat k' },
        h('div', { class: 'n', text: String(noChange || 0) }), h('div', { class: 'l', text: 'değişmez' }))));

    const list = h('div', { class: 'ypo-oplist' });
    for (const op of ops) {
      list.appendChild(h('div', { class: 'ypo-op' },
        h('span', { class: 'ypo-tag ' + (op.type === 'add' ? 'a' : 'r'),
          text: op.type === 'add' ? 'EKLE' : 'ÇIKAR' }),
        h('span', { class: 'v', text: op.videoTitle }),
        h('span', { class: 'p', text: '→ ' + op.playlistTitle }),
        h('span', { class: 'st' })));
    }
    m.body.appendChild(list);

    if (backFn) {
      m.foot.appendChild(h('button', {
        class: 'ypo-btn gho', text: '← Geri',
        onclick: function () { closeSheet(); backFn(); },
      }));
    }
    applyBtn.addEventListener('click', function () {
      if (!dryRun) {
        const ok = confirm(tt('CANLI MOD: ') + adds + tt(' ekleme, ') + rems + tt(' çıkarma gerçekten uygulanacak. Devam?'));
        if (!ok) { return; }
      }
      doExecute(m, ops, dryRun);
    });
    m.foot.appendChild(applyBtn);
  }

  // Önizlemeden "Uygula": planı arka plan işine devreder, sheet'i kapatır ve
  // CANLI detay sheet'ini açar (kullanıcı kapatırsa iş arka planda sürer).
  function doExecute(m, ops, dryRun) {
    const job = startJob({
      title: (dryRun ? tt('DRY-RUN: ') : '') + tt('İşlem — ') + ops.length + tt(' işlem'),
      dryRun: dryRun, sourceListId: state.current ? state.current.id : null,
      prepare: async function () { return ops; },
    });
    closeSheet();
    openJobDetail(job);
  }

  // Bir işin CANLI detay sheet'i: ilerleme + işlem listesi + hata + geri-al.
  // İşe abone olur; sheet kapanınca abonelik bırakılır (sheetCleanup).
  function openJobDetail(job) {
    const m = openSheet(job.title);
    const stat = h('div', {});
    const bar = h('div', { class: 'ypo-pbar' }, h('i', {}));
    const statsBox = h('div', { class: 'ypo-stats' });
    const list = h('div', { class: 'ypo-oplist' });
    const errBox = h('div', {});
    m.body.appendChild(stat);
    m.body.appendChild(bar);
    m.body.appendChild(statsBox);
    m.body.appendChild(list);
    m.body.appendChild(errBox);

    let built = false;
    function buildList() {
      built = true;
      clear(statsBox); clear(list);
      const adds = job.ops.filter(function (o) { return o.type === 'add'; }).length;
      const rems = job.ops.filter(function (o) { return o.type === 'remove'; }).length;
      statsBox.appendChild(h('div', { class: 'ypo-stat a' }, h('div', { class: 'n', text: String(adds) }), h('div', { class: 'l', text: 'ekleme' })));
      statsBox.appendChild(h('div', { class: 'ypo-stat r' }, h('div', { class: 'n', text: String(rems) }), h('div', { class: 'l', text: 'çıkarma' })));
      for (const op of job.ops) {
        list.appendChild(h('div', { class: 'ypo-op' },
          h('span', { class: 'ypo-tag ' + (op.type === 'add' ? 'a' : 'r'), text: op.type === 'add' ? 'EKLE' : 'ÇIKAR' }),
          h('span', { class: 'v', text: op.videoTitle }),
          h('span', { class: 'p', text: '→ ' + op.playlistTitle }),
          h('span', { class: 'st' })));
      }
    }
    function update() {
      bar.firstChild.style.width = jobPct(job) + '%';
      if (job.phase === 'preparing') {
        stat.textContent = job.readTotal
          ? tt('Listeler okunuyor… ') + job.readDone + '/' + job.readTotal : tt('Hazırlanıyor…');
      } else {
        if (!built) { buildList(); }
        stat.textContent = jobMetaText(job);
        const marks = list.querySelectorAll('.st');
        for (let i = 0; i < job.results.length && i < marks.length; i++) {
          const r = job.results[i];
          marks[i].textContent = r.ok ? (r.dryRun ? '○' : '✓') : '✗';
          marks[i].style.color = r.ok ? (r.dryRun ? '#66666f' : '#34d058') : '#f0433a';
        }
      }
      clear(errBox);
      if (job.error) {
        errBox.appendChild(h('div', { class: 'ypo-card' },
          h('div', { class: 'ypo-lbl', text: 'Hatalar' }), h('div', { class: 'ypo-mono', text: job.error })));
      } else {
        const fails = job.results.filter(function (r) { return !r.ok; });
        if (fails.length) {
          const lines = fails.map(function (r) { return r.op.videoTitle + ' → ' + r.op.playlistTitle + '\n  ' + r.error; }).join('\n\n');
          errBox.appendChild(h('div', { class: 'ypo-card' },
            h('div', { class: 'ypo-lbl', text: 'Hatalar' }), h('div', { class: 'ypo-mono', text: lines })));
        }
      }
      clear(m.foot);
      if (jobActive(job)) {
        m.foot.appendChild(h('button', { class: 'ypo-btn gho wide', text: '⛔ İptal et', onclick: function () { cancelJob(job); } }));
      } else if (!job.dryRun && job.okCount > 0) {
        m.foot.appendChild(h('button', { class: 'ypo-btn dng', text: '↩ Bu işi geri al', onclick: function () { closeSheet(); undoJobOps(job); } }));
      }
      m.foot.appendChild(h('button', { class: 'ypo-btn pri wide', text: 'Kapat', onclick: closeSheet }));
    }

    update();
    job.listeners.add(update);
    sheetCleanup = function () { job.listeners.delete(update); };
  }

  // Üstteki iş çubukları — her iş için bir çubuk, alt alta. Çubuğa dokun → detay.
  function renderJobBars() {
    const host = $id('ypo-jobbars');
    if (!host) { return; }
    clear(host);
    for (const job of jobs) {
      const fill = h('i', { style: { width: jobPct(job) + '%' } });
      const x = h('button', { class: 'ypo-jb-x', text: '✕', title: jobActive(job) ? 'İptal et' : 'Kapat',
        onclick: function (e) { e.stopPropagation(); if (jobActive(job)) { cancelJob(job); } else { dismissJob(job); } } });
      const titleEl = h('span', { class: 'ypo-jb-title' });
      const metaEl = h('div', { class: 'ypo-jb-meta' });
      titleEl.textContent = job.title;
      metaEl.textContent = jobMetaText(job);
      const barEl = h('div', { class: 'ypo-jobbar ' + job.phase + (job.dryRun ? ' dry' : ''),
        title: 'Ayrıntı için tıkla', onclick: function () { openJobDetail(job); } },
        h('div', { class: 'ypo-jb-top' }, titleEl, x),
        h('div', { class: 'ypo-jb-track' }, fill),
        metaEl);
      host.appendChild(barEl);
    }
  }

  // -------------------------------------------------------------------------
  //  AYARLAR
  // -------------------------------------------------------------------------
  function openSettings() {
    const m = openSheet('⚙ Ayarlar');
    const rows = h('div', {});
    const countEl = h('div', { class: 'ypo-hint' });
    function refreshRows() {
      clear(rows);
      for (const p of state.playlists) {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = state.managed.has(p.id);
        (function (pp) {
          cb.addEventListener('change', function () {
            if (cb.checked) { state.managed.add(pp.id); }
            else { state.managed.delete(pp.id); }
            countEl.textContent = state.managed.size + ' / ' + state.playlists.length + tt(' seçili');
          });
        })(p);
        rows.appendChild(h('div', { class: 'ypo-plrow' },
          h('div', { class: 'nm' },
            h('span', { class: 'dot', style: { background: plColor(p.id) } }),
            h('span', { text: p.title })),
          h('label', {}, cb, h('span', { text: 'yönetilen' }))));
      }
      countEl.textContent = state.managed.size + ' / ' + state.playlists.length + ' seçili';
    }
    refreshRows();
    m.body.appendChild(h('div', { class: 'ypo-card' },
      h('div', { class: 'ypo-lbl', text: 'Yönetilen Listeler' }),
      h('div', { class: 'ypo-hint', style: { marginBottom: '9px' },
        text: 'İşlem penceresinde hedef olarak SADECE işaretliler görünür. Override yalnızca bunları etkiler.' }),
      h('div', { style: { display: 'flex', gap: '8px', marginBottom: '10px' } },
        h('button', {
          class: 'ypo-btn sm wide',
          onclick: function () {
            for (const p of state.playlists) { state.managed.add(p.id); }
            refreshRows();
          },
        }, 'Tümünü Seç'),
        h('button', {
          class: 'ypo-btn sm wide gho',
          onclick: function () { state.managed.clear(); refreshRows(); },
        }, 'Hiçbirini Seç')),
      countEl,
      h('div', { style: { marginTop: '8px' } }, rows)));

    const langSel = h('select', { class: 'ypo-select', style: { width: '100%' } },
      h('option', { value: 'en', text: 'English' }),
      h('option', { value: 'tr', text: 'Türkçe' }));
    langSel.value = state.settings.lang;
    m.body.appendChild(h('div', { class: 'ypo-card' },
      h('div', { class: 'ypo-lbl', text: 'Dil / Language' }), langSel));

    const delay = h('input', {
      type: 'number', min: '0', max: '5000', value: String(state.settings.delayMs),
      style: {
        width: '90px', background: '#2c2c33', color: '#f3f3f5',
        border: '1px solid #3b3b44', borderRadius: '7px', padding: '7px',
      },
    });
    const dry = h('input', { type: 'checkbox' });
    dry.checked = state.settings.dryRun;
    m.body.appendChild(h('div', { class: 'ypo-card' },
      h('div', { class: 'ypo-lbl', text: 'Genel' }),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '9px' } },
        dry, h('span', { text: 'İşlem penceresi DRY-RUN açık başlasın' })),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        h('span', { text: 'İstekler arası bekleme (ms):' }), delay),
      h('div', { class: 'ypo-hint', style: { marginTop: '6px' },
        text: 'Önerilen 200–400 ms. 429 gelirse araç otomatik bekleyip yeniden dener.' })));

    m.foot.appendChild(h('button', { class: 'ypo-btn gho', text: 'İptal', onclick: closeSheet }));
    m.foot.appendChild(h('button', {
      class: 'ypo-btn pri wide', text: 'Kaydet',
      onclick: function () {
        state.settings.dryRun = dry.checked;
        state.settings.delayMs = Math.max(0, Math.min(5000, parseInt(delay.value, 10) || 300));
        state.settings.lang = (langSel.value === 'tr') ? 'tr' : 'en';
        state.managedConfigured = true;   // kullanıcı yönetilenleri açıkça belirledi
        state.membershipFresh = false;
        saveSettings();
        closeSheet();
        if (state.current) {
          renderDetail();
          loadMembership().then(function () { updateChips(); }).catch(function () {});
        } else {
          renderPlaylists();
        }
        toast('Ayarlar kaydedildi.');
        setTimeout(hideToast, 1500);
      },
    }));
  }

  // -------------------------------------------------------------------------
  //  TANILAMA
  // -------------------------------------------------------------------------
  async function openDiag() {
    const m = openSheet('🔧 Tanılama');
    m.body.appendChild(h('div', { class: 'ypo-hint', text: tt('Sürüm ') + VERSION + ' • ' + location.hostname }));
    const mono = h('div', { class: 'ypo-mono', text: 'Test başlatılıyor…' });
    m.body.appendChild(mono);
    m.foot.appendChild(h('button', { class: 'ypo-btn pri wide', text: 'Kapat', onclick: closeSheet }));
    const lines = [];
    function log(s) { lines.push(s); mono.textContent = lines.join('\n'); }
    try {
      const cfg = getConfig();
      log('• apiKey: ' + (cfg.apiKey ? '✓' : '✗'));
      let ctxOk = '✗';
      if (cfg.context && cfg.context.client) {
        ctxOk = '✓ (' + cfg.context.client.clientName + ')';
      }
      log(tt('• context: ') + ctxOk);
      const ck = getCookie('SAPISID') || getCookie('__Secure-3PAPISID');
      log(tt('• SAPISID çerezi: ') + (ck ? '✓' : '✗'));
      log(tt('• Playlist okuma testi…'));
      const pls = await enumeratePlaylists();
      log('  ✓ ' + pls.length + tt(' playlist bulundu'));
      if (pls.length) {
        const map = await fetchPlaylistVideos(pls[0].id);
        let w = 0;
        for (const v of map.values()) {
          if (v.progress > 0) { w++; }
        }
        log('  ✓ "' + pls[0].title + '" — ' + map.size + tt(' video, ') + w + tt(' izlenmiş'));
      }
      log(tt('\nSONUÇ: iç API çalışıyor. ✓'));
    } catch (e) {
      log('\n✗ HATA: ' + e.message);
    }
  }

  // -------------------------------------------------------------------------
  //  YÜZEN DÜĞME (FAB) + BAŞLATMA
  // -------------------------------------------------------------------------
  function ensureFab() {
    if (isMobileHost()) { return; }   // mobil = sadece giriş kabuğu; FAB masaüstünde
    if ($id('ypo-fab')) { return; }
    const fab = h('button', {
      id: 'ypo-fab', title: 'YouTube Liste Düzenleyici', text: '☰', onclick: openOverlay,
    });
    document.body.appendChild(fab);
  }

  function isYouTube() {
    return /(^|\.)youtube\.com$/.test(location.hostname);
  }
  function isMobileHost() {
    return location.hostname.charAt(0) === 'm';
  }
  function isLoggedIn() {
    try { return !!(window.ytcfg && window.ytcfg.get && window.ytcfg.get('LOGGED_IN')); }
    catch (e) { return false; }
  }

  // ypo.js -> native köprü (güvenli çağrı).
  function ypoBridge(m) {
    try { if (typeof YPOAndroid !== 'undefined' && YPOAndroid && YPOAndroid[m]) { YPOAndroid[m](); return true; } } catch (e) {}
    return false;
  }

  // Android geri tuşu: uygulama İÇİNDE gezin; asla YouTube'u açma.
  window.__ypoOnBack = function () {
    const host = $id('ypo-sheet-host');
    if (host && host.firstChild) { closeSheet(); return 'YPO_HANDLED'; }
    const root = $id('ypo-root');
    if (root && root.classList.contains('open')) {
      if (state.current) { renderPlaylists(); return 'YPO_HANDLED'; }  // detay → liste
      return 'YPO_ROOT';   // liste (kök) → uygulamayı geri al, YouTube'u gösterme
    }
    return 'YPO_NONE';     // overlay kapalı (giriş sayfası) → normal geri
  };

  function init() {
    if (!isYouTube()) { return; }
    injectStyle();
    console.log('%c[YT-Liste App]', 'color:#3ea6ff;font-weight:bold', 'v' + VERSION + ' @ ' + location.href);

    if (isInterceptPage()) { initIntercept(); return; }   // INSTANT yol (kendi sayfamız)

    if (isMobileHost()) {
      // MOBİL = giriş kabuğu (yalnızca oturum yokken native buraya getirir; splash zaten gizli).
      let t = 0;
      const iv = setInterval(function () {
        t++;
        if (isLoggedIn()) { clearInterval(iv); ypoBridge('goDesktop'); }
        else if (t > 600) { clearInterval(iv); }
      }, 200);
      return;
    }

    // MASAÜSTÜ = asıl araç. ytcfg/giriş hazır olur olmaz overlay'i HEMEN aç (hız için).
    ensureFab();
    window.addEventListener('yt-navigate-finish', function () { setTimeout(ensureFab, 400); });
    setInterval(ensureFab, 4000);
    let tries = 0;
    const iv2 = setInterval(function () {
      tries++;
      if (isLoggedIn()) {
        clearInterval(iv2);
        const root = $id('ypo-root');
        if (!root || !root.classList.contains('open')) { openOverlay(); }
        ypoBridge('hideSplash');   // overlay açıldı → splash kalksın
      } else if (tries > 66) {     // ~8sn giriş yok → oturum süresi dolmuş → mobil giriş
        clearInterval(iv2);
        if (!ypoBridge('needLogin')) { ypoBridge('hideSplash'); }
      }
    }, 120);
  }

  loadSettings();
  if (document.body) { init(); }
  else { window.addEventListener('DOMContentLoaded', init); }
})();

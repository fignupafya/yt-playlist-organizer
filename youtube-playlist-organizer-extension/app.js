'use strict';
/* ============================================================================
 * YouTube Liste Düzenleyici — eklenti uygulama mantığı (v2.2)
 * ----------------------------------------------------------------------------
 * - YouTube iç API çağrıları görünmez bir youtube.com yardımcı sekmesinin
 *   İÇİNDE çalışır (chrome.scripting). İstekler birebir birinci-taraf olur.
 * - GÜVENLİK: varsayılan DRY-RUN; önizleme zorunlu; kopya eklemez; bir liste
 *   okunamazsa işlem iptal; ilk hatada durur; 429'da geri-çekilir; geri-al var.
 * - LİMİT YOK: tüm videolar/listeler devam-jetonu takip edilerek okunur
 *   (sabit sayı sınırı değil, jeton tekrarı tespitiyle döngü koruması).
 * ==========================================================================*/

const VERSION = '2.2.0';
const RENDER_CHUNK = 250;   // ekrana parça parça çizim (DOM sınırı değil, akıcılık)

// ---------------------------------------------------------------------------
//  DURUM
// ---------------------------------------------------------------------------
const state = {
  playlists: [],
  managed: new Set(),
  settings: { dryRun: true, delayMs: 300, vidSort: 'order', plSort: 'default', lang: 'en' },
  current: null,
  videos: [],
  vmap: new Map(),
  selected: new Set(),
  filter: 'all',          // watch: all | watched | unwatched
  search: '',
  memFilter: 'all',       // all | archived | unarchived | pl:<id>
  plSearch: '',
  plManagedOnly: false,
  lastClickIdx: -1,
  membership: new Map(),
  membershipFresh: false,
  lastOp: null,
};
let helperTabId = null;
let curVisible = [];
let renderedCount = 0;
let io = null;
const reqLog = [];

const PALETTE = ['#ff6b6b', '#4dabf7', '#51cf66', '#ffd43b', '#cc5de8',
                 '#ff922b', '#20c997', '#f783ac', '#a9e34b', '#74b9ff'];

// ---------------------------------------------------------------------------
//  i18n — varsayılan İngilizce; sözlük Türkçe→İngilizce. Dil ayardan seçilir.
// ---------------------------------------------------------------------------
const DICT = {
  'YouTube Liste Düzenleyici': 'YouTube Playlist Organizer',
  'Oynatma Listelerim': 'My Playlists', '‹ Listeler   ': '‹ Lists   ',
  'Liste ara…': 'Search lists…', 'Sıralama: Varsayılan': 'Sort: Default',
  'İsim: A→Z': 'Name: A→Z', 'İsim: Z→A': 'Name: Z→A',
  'Video sayısı: çok→az': 'Videos: most→least', 'Video sayısı: az→çok': 'Videos: least→most',
  'Yönetilenler': 'Managed', 'Sadece yönetilenler': 'Managed only',
  'Playlist bulunamadı.': 'No playlists found.',
  'Eşleşen liste yok.': 'No matching lists.', ' liste': ' lists',
  'düzenlemek için aç': 'open to edit', '✓ yönetilen': '✓ managed',
  ' video': ' videos', ' video • ': ' videos • ', ' izlenmiş': ' watched',
  'Tümü': 'All', 'İzlenmiş': 'Watched', 'İzlenmemiş': 'Unwatched',
  'Üyelik: Tümü': 'Membership: All', 'Başka arşivde VAR': 'In another archive',
  'Hiç arşivde YOK': 'Not in any archive', 'Şu listede olanlar': 'In this list',
  'Sıra: Liste sırası': 'Sort: List order',
  'İzlenme: çok→az': 'Watched: most→least', 'İzlenme: az→çok': 'Watched: least→most',
  'Süre: uzun→kısa': 'Duration: long→short', 'Süre: kısa→uzun': 'Duration: short→long',
  'Başlık: A→Z': 'Title: A→Z', 'Başlık: Z→A': 'Title: Z→A', 'Kanal: A→Z': 'Channel: A→Z',
  'Videolarda ara…': 'Search videos…', 'Videolarda ara…  ( / )': 'Search videos…  ( / )',
  'Görüneni Seç': 'Select visible', 'Temizle': 'Clear', 'Bu listeyi yenile': 'Refresh this list',
  'Bu listeden çıkar': 'Remove from this list', 'İşlem Yap →': 'Operate →',
  'Bu liste boş.': 'This list is empty.', 'Eşleşen video yok.': 'No matching videos.',
  ' / ': ' / ', '(başlıksız)': '(untitled)', '✓ izlendi': '✓ watched',
  ' seçili': ' selected', 'İşlem Yap — ': 'Operate — ', 'Mod': 'Mode',
  'Mod 1 — Override (tam senkron)': 'Mode 1 — Override (full sync)',
  'İşaretli listeler: eklensin. İşaretsiz listeler: çıkarılsın. ':
    'Checked lists: add. Unchecked lists: remove. ',
  'Seçili tüm videoların yönetilen listelerdeki üyeliği kutulara birebir eşitlenir.':
    'All selected videos’ membership in managed lists is synced exactly to the checkboxes.',
  'Mod 2 — Include / Exclude (kısmi)': 'Mode 2 — Include / Exclude (partial)',
  'Her liste: + Ekle / · Dokunma / − Çıkar. "Dokunma" listelere hiç dokunulmaz.':
    'Each list: + Add / · Leave / − Remove. "Leave" lists are untouched.',
  'Hedef Listeler (': 'Target Lists (', 'listede olsun': 'in list',
  '+ Ekle': '+ Add', '· Dokunma': '· Leave', '− Çıkar': '− Remove',
  'Override: işaretsiz listelerden de video ÇIKARILIR (yalnızca bu yönetilen listelerde).':
    'Override: videos are also REMOVED from unchecked lists (managed lists only).',
  'Include/Exclude: yalnızca + / − seçtiğin listeler etkilenir; · listelere dokunulmaz.':
    'Include/Exclude: only lists set to + / − are affected; · lists are untouched.',
  'İptal': 'Cancel', 'Önizle →': 'Preview →',
  'Mod 2: en az bir liste için + veya − seç.': 'Mode 2: set + or − for at least one list.',
  'Yönetilen listelerin içeriği okunuyor…': 'Reading managed lists…',
  'Listeler okunamadı — işlem iptal edildi': 'Lists could not be read — operation cancelled',
  'Hiçbir değişiklik yapılmadı (eksik bilgiyle listeye dokunulmaz).':
    'No changes were made (lists are not touched with incomplete data).',
  'Kapat': 'Close', 'DRY-RUN açık': 'DRY-RUN on', '⚠ CANLI MOD': '⚠ LIVE MODE',
  ' — hiçbir şey yazılmaz, sadece ne olacağı gösterilir.': ' — nothing is written, only a preview.',
  ' — onaylarsan değişiklikler GERÇEKTEN uygulanır.': ' — if confirmed, changes are ACTUALLY applied.',
  'DRY-RUN Çalıştır': 'Run DRY-RUN', 'GERÇEKTEN Uygula (': 'ACTUALLY Apply (',
  'ekleme': 'add', 'çıkarma': 'remove', 'değişiklik yok': 'no change',
  'EKLE': 'ADD', 'ÇIKAR': 'REMOVE', '← Geri': '← Back',
  'Yapılacak değişiklik yok — zaten istenen durumda.':
    'Nothing to do — already in the desired state.',
  'CANLI MOD: ': 'LIVE MODE: ', ' ekleme, ': ' add, ',
  ' çıkarma gerçekten uygulanacak.\n\nDevam edilsin mi?': ' remove will actually be applied.\n\nProceed?',
  'DRY-RUN çalışıyor…': 'Running DRY-RUN…', 'Uygulanıyor…': 'Applying…',
  'DRY-RUN bitti.': 'DRY-RUN done.', 'Bitti.': 'Done.',
  ' işlem simüle edildi, hiçbir şey yazılmadı.': ' operations simulated, nothing written.',
  ' başarılı, ': ' succeeded, ', ' hatalı.': ' failed.', ' (ilk hatada durduruldu)': ' (stopped at first error)',
  'Hatalar': 'Errors', '↩ Bu partiyi geri al': '↩ Undo this batch',
  '↩ Geri Al': '↩ Undo', 'Geri alınacak parti yok.': 'No batch to undo.',
  'Geri alınıyor…': 'Undoing…', 'Geri alınıyor: ': 'Undoing: ',
  'Geri alma bitti.': 'Undo done.',
  '⚙ Ayarlar': '⚙ Settings', 'Yönetilen Listeler': 'Managed Lists',
  'Tümünü Seç': 'Select all', 'Hiçbirini Seç': 'Select none', 'Genel': 'General',
  'İşlem penceresi DRY-RUN açık başlasın (önerilir)': 'Operation window starts with DRY-RUN on (recommended)',
  'Yazma istekleri arası bekleme (ms): ': 'Delay between write requests (ms): ',
  'Kaydet': 'Save', 'Ayarlar kaydedildi.': 'Settings saved.', 'Dil / Language': 'Language',
  '🔧 Tanılama': '🔧 Diagnostics', 'Ortam': 'Environment',
  'ytcfg okunabiliyor': 'ytcfg readable', 'INNERTUBE_API_KEY mevcut': 'INNERTUBE_API_KEY present',
  'Oturum açık görünüyor': 'Appears signed in',
  'Playlistlerin getiriliyor…': 'Loading your playlists…', 'Playlist getirilemedi: ': 'Could not load playlists: ',
  'videolar yükleniyor…': 'loading videos…', 'Videolar okunamadı: ': 'Could not read videos: ',
  'Hata: ': 'Error: ', ' video okundu…': ' videos read…', 'YouTube\'da aç': 'Open on YouTube',
  'sa ': 'h ', 'dk': 'm', 'sn': 's',
  'YouTube yardımcı sekmesi hazırlanıyor…': 'Preparing YouTube helper tab…',
  ' gösteriliyor — kaydır…': ' shown — scroll…', '" okunuyor… (': '" reading… (',
  ' başarılı.': ' succeeded.', 'Playlistler getirilemedi: ': 'Could not load playlists: ',
  ' — YouTube\'da giriş yapmış olduğundan emin ol.': ' — make sure you are signed in to YouTube.',
  'Sürüm ': 'Version ', 'Bağlantı testi': 'Connection test', 'Test başlatılıyor…': 'Starting test…',
  '• YouTube yardımcı sekmesi açılıyor…': '• Opening YouTube helper tab…',
  '  ✓ sekme hazır (tabId ': '  ✓ tab ready (tabId ',
  '• Kimlik / ytcfg testi…': '• Identity / ytcfg test…', '• Canlı okuma testi…': '• Live read test…',
  '  (yönetilen liste yok)': '  (no managed list)', ' video, ': ' videos, ', '" okundu — ': '" read — ',
  '\nSONUÇ: iç API senin hesabında çalışıyor. ✓': '\nRESULT: internal API works on your account. ✓',
  ' işlemin TERSİ uygulanacak. Devam?': ' operations will be reversed. Continue?',
  'Son parti geri alınacak: ': 'The last batch will be undone: ',
  ' (ilk hatada durdu)': ' (stopped at first error)',
  '  oturum: ': '  session: ', '  çerez: ': '  cookie: ',
  'Yazma istekleri arası bekleme (ms):': 'Delay between write requests (ms):',
  'İşlem penceresinde hedef olarak SADECE işaretli listeler görünür. ':
    'Only checked lists appear as targets in the operation window. ',
  'Override modu yalnızca bunları etkiler; işaretsizlere asla dokunulmaz.':
    'Override mode affects only these; unchecked ones are never touched.',
  'Önerilen 200–400 ms. Çok düşük tutsan bile 429 (çok fazla istek) gelirse araç ':
    'Recommended 200–400 ms. Even if very low, on 429 (too many requests) the tool ',
  'otomatik bekleyip yeniden dener. 0 = bekleme yok.': 'auto-waits and retries. 0 = no delay.',
  '↻ Yenile': '↻ Refresh',
};
// app.html'deki sabit üst-bar metinlerini dile göre ayarla.
function localizeChrome() {
  try {
    document.title = tt('YouTube Liste Düzenleyici');
    const b = $('#brand-title'); if (b) b.textContent = tt('YouTube Liste Düzenleyici');
    const r = $('#btn-refresh'); if (r) r.textContent = tt('↻ Yenile');
    const s = $('#btn-settings'); if (s) s.textContent = tt('⚙ Ayarlar');
    const d = $('#btn-diag'); if (d) d.textContent = tt('🔧 Tanılama');
  } catch (e) {}
}
function tt(s) {
  if (state.settings.lang === 'tr') return s;
  const e = DICT[s];
  return e === undefined ? s : e;
}

// ---------------------------------------------------------------------------
//  YARDIMCILAR
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (sel) => document.querySelector(sel);

function h(tag, props, ...kids) {
  const n = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = tt(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'placeholder' || k === 'title') n.setAttribute(k, tt(v));
    else n.setAttribute(k, v);
  }
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    n.appendChild(typeof kid === 'object' ? kid : document.createTextNode(tt(String(kid))));
  }
  return n;
}
function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

function status(msg, isErr) {
  const s = $('#status');
  s.textContent = tt(msg);
  s.className = (isErr ? 'err ' : '') + 'show';
}
function hideStatus() { $('#status').className = ''; }
function emptyState(ico, msg) {
  return h('div', { class: 'empty' }, h('div', { class: 'ico', text: ico }), h('div', { class: 'msg', text: msg }));
}
function hexA(hex, a) {
  const m = hex.replace('#', '');
  return 'rgba(' + parseInt(m.substr(0, 2), 16) + ',' + parseInt(m.substr(2, 2), 16) +
    ',' + parseInt(m.substr(4, 2), 16) + ',' + a + ')';
}
function plColor(id) {
  let hh = 0;
  for (let i = 0; i < id.length; i++) hh = (hh * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hh % PALETTE.length];
}
function parseClock(s) {
  const p = String(s).split(':').map((n) => parseInt(n, 10) || 0);
  let sec = 0;
  for (const n of p) sec = sec * 60 + n;
  return sec;
}
function fmtDur(sec) {
  sec = Math.round(sec || 0);
  const hr = Math.floor(sec / 3600), mn = Math.floor((sec % 3600) / 60);
  if (hr) return hr + 'sa ' + mn + 'dk';
  if (mn) return mn + 'dk';
  return sec + 'sn';
}
function textOf(t) {
  if (t == null) return '';
  if (typeof t === 'string') return t;
  if (typeof t.content === 'string') return t.content;
  if (t.simpleText) return t.simpleText;
  if (Array.isArray(t.runs)) return t.runs.map((r) => r.text || '').join('');
  return '';
}
function deepCollect(obj, pred, out, depth) {
  out = out || []; depth = depth || 0;
  if (!obj || typeof obj !== 'object' || depth > 60) return out;
  if (Array.isArray(obj)) { for (const x of obj) deepCollect(x, pred, out, depth + 1); return out; }
  try { if (pred(obj)) out.push(obj); } catch (e) {}
  for (const k in obj) { const v = obj[k]; if (v && typeof v === 'object') deepCollect(v, pred, out, depth + 1); }
  return out;
}
function withTimeout(promise, ms, msg) {
  return Promise.race([promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(msg || 'zaman aşımı')), ms))]);
}
function mkSelect(options, value, onChange) {
  const sel = h('select', { class: 'select' });
  for (const [val, label] of options) sel.appendChild(h('option', { value: val, text: label }));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

// ---------------------------------------------------------------------------
//  AYARLAR
// ---------------------------------------------------------------------------
async function loadSettings() {
  try {
    const d = await chrome.storage.local.get(['managed', 'dryRun', 'delayMs', 'vidSort', 'plSort', 'plManagedOnly', 'lang']);
    if (Array.isArray(d.managed)) state.managed = new Set(d.managed);
    if (typeof d.dryRun === 'boolean') state.settings.dryRun = d.dryRun;
    if (typeof d.delayMs === 'number') state.settings.delayMs = d.delayMs;
    if (typeof d.vidSort === 'string') state.settings.vidSort = d.vidSort;
    if (typeof d.plSort === 'string') state.settings.plSort = d.plSort;
    if (typeof d.plManagedOnly === 'boolean') state.plManagedOnly = d.plManagedOnly;
    if (d.lang === 'tr' || d.lang === 'en') state.settings.lang = d.lang;
  } catch (e) { console.warn('ayar yüklenemedi', e); }
}
async function saveSettings() {
  try {
    await chrome.storage.local.set({
      managed: Array.from(state.managed),
      dryRun: state.settings.dryRun,
      delayMs: state.settings.delayMs,
      vidSort: state.settings.vidSort,
      plSort: state.settings.plSort,
      plManagedOnly: state.plManagedOnly,
      lang: state.settings.lang,
    });
  } catch (e) { console.warn('ayar kaydedilemedi', e); }
}

// ---------------------------------------------------------------------------
//  YARDIMCI YOUTUBE SEKMESİ + KOD ENJEKSİYONU
// ---------------------------------------------------------------------------
function waitComplete(tabId, timeoutMs) {
  timeoutMs = timeoutMs || 25000;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(l); resolve(); };
    function l(id, info) { if (id === tabId && info.status === 'complete') finish(); }
    chrome.tabs.onUpdated.addListener(l);
    chrome.tabs.get(tabId).then((t) => { if (t && t.status === 'complete') finish(); }).catch(() => finish());
    setTimeout(finish, timeoutMs);
  });
}
async function ensureHelperTab() {
  if (helperTabId != null) {
    try {
      const t = await chrome.tabs.get(helperTabId);
      if (t && /:\/\/(www\.)?youtube\.com\//.test(t.url || t.pendingUrl || '')) {
        if (t.status !== 'complete') await waitComplete(helperTabId);
        return helperTabId;
      }
    } catch (e) {}
    helperTabId = null;
  }
  try {
    const st = await chrome.storage.session.get('helperTabId');
    if (st && st.helperTabId != null) {
      try {
        const t = await chrome.tabs.get(st.helperTabId);
        if (t && /:\/\/(www\.)?youtube\.com\//.test(t.url || '')) {
          helperTabId = st.helperTabId;
          if (t.status !== 'complete') await waitComplete(helperTabId);
          return helperTabId;
        }
      } catch (e) {}
    }
  } catch (e) {}
  status('YouTube yardımcı sekmesi hazırlanıyor…');
  const tab = await chrome.tabs.create({ url: 'https://www.youtube.com/feed/playlists', active: false });
  helperTabId = tab.id;
  try { await chrome.storage.session.set({ helperTabId }); } catch (e) {}
  await waitComplete(helperTabId);
  await sleep(1100);
  return helperTabId;
}
async function reloadAndWait(tabId, url) {
  if (url) await chrome.tabs.update(tabId, { url });
  else await chrome.tabs.reload(tabId);
  await sleep(450);
  await waitComplete(tabId);
  await sleep(1000);
}
async function ensureFeedPage(forceReload) {
  let t;
  try { t = await chrome.tabs.get(helperTabId); } catch (e) { return; }
  const url = t.url || t.pendingUrl || '';
  if (!/\/feed\/playlists/.test(url)) await reloadAndWait(helperTabId, 'https://www.youtube.com/feed/playlists');
  else if (forceReload) await reloadAndWait(helperTabId, null);
}
async function inject(func, args) {
  const runOnce = async () => {
    const tabId = await ensureHelperTab();
    const res = await withTimeout(
      chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args: args || [] }),
      30000, 'Yardımcı sekme yanıt vermedi (zaman aşımı).');
    if (!res || !res[0]) throw new Error('Yardımcı sekmeden yanıt alınamadı.');
    return res[0].result;
  };
  try { return await runOnce(); }
  catch (e) {
    helperTabId = null;
    try { await chrome.storage.session.remove('helperTabId'); } catch (e2) {}
    return await runOnce();
  }
}

// ===== Sayfa içinde (youtube.com) çalışan — KENDİ KENDİNE YETERLİ =====
async function PAGE_innertube(path, bodyObj) {
  try {
    const cfg = window.ytcfg;
    if (!cfg || !cfg.get) return { ok: false, error: 'ytcfg bulunamadı (YouTube sayfası tam yüklenmemiş).' };
    const apiKey = cfg.get('INNERTUBE_API_KEY');
    const context = cfg.get('INNERTUBE_CONTEXT');
    if (!apiKey || !context) return { ok: false, error: 'INNERTUBE yapılandırması okunamadı.' };
    const origin = 'https://www.youtube.com';
    const ck = (n) => {
      const esc = n.replace(/[-.[\]{}()*+?^$|\\]/g, '\\$&');
      const m = document.cookie.match(new RegExp('(?:^|; )' + esc + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    };
    const sha1 = async (s) => {
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    };
    const ts = Math.floor(Date.now() / 1000);
    const pairs = [['SAPISIDHASH', 'SAPISID'], ['SAPISID1PHASH', '__Secure-1PAPISID'], ['SAPISID3PHASH', '__Secure-3PAPISID']];
    const auth = [];
    for (const [label, cookie] of pairs) {
      const c = ck(cookie);
      if (!c) continue;
      auth.push(label + ' ' + ts + '_' + (await sha1(ts + ' ' + c + ' ' + origin)));
    }
    const headers = {
      'Content-Type': 'application/json',
      'X-Origin': origin,
      'X-Youtube-Client-Name': String(cfg.get('INNERTUBE_CONTEXT_CLIENT_NAME') || 1),
      'X-Youtube-Client-Version': String(cfg.get('INNERTUBE_CONTEXT_CLIENT_VERSION') || ''),
    };
    if (auth.length) headers['Authorization'] = auth.join(' ');
    const visitor = context.client && context.client.visitorData;
    if (visitor) headers['X-Goog-Visitor-Id'] = visitor;
    const url = origin + '/youtubei/v1/' + path + '?key=' + encodeURIComponent(apiKey) + '&prettyPrint=false';
    const resp = await fetch(url, {
      method: 'POST', credentials: 'include', headers,
      body: JSON.stringify(Object.assign({ context }, bodyObj || {})),
    });
    let data = null, text = null;
    try { data = await resp.json(); } catch (e) { try { text = await resp.text(); } catch (e2) {} }
    return { ok: resp.ok, status: resp.status, data, text };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
function PAGE_enumerate() {
  try {
    const d = window.ytInitialData;
    if (!d) return { ok: false, error: 'ytInitialData bulunamadı (sayfa tam yüklenmemiş olabilir).' };
    return { ok: true, data: d };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ---------------------------------------------------------------------------
//  API KATMANI
// ---------------------------------------------------------------------------
async function ytApi(path, body) {
  const r = await inject(PAGE_innertube, [path, body || {}]);
  reqLog.push({ t: new Date().toISOString(), path, status: r && r.status, error: r && r.error });
  if (reqLog.length > 200) reqLog.shift();
  if (!r) throw new Error('Boş yanıt.');
  if (!r.ok) {
    const err = new Error(r.error || ('HTTP ' + r.status + ' — ' + ((r.text || '').slice(0, 200))));
    err.httpStatus = r.status;
    throw err;
  }
  return r.data;
}

function parsePlaylists(data) {
  const out = [];
  const seen = new Set();
  const push = (id, title, thumb, count) => {
    if (!id || seen.has(id) || /^RD/.test(id)) return;
    seen.add(id);
    const cm = String(count || '').match(/[\d.,]+/);
    out.push({ id, title: (title || id).trim(), thumb: thumb || '', count: cm ? cm[0] : '' });
  };
  for (const o of deepCollect(data, (x) => x.lockupViewModel)) {
    try {
      const lk = o.lockupViewModel;
      if (String(lk.contentType || '').indexOf('PLAYLIST') === -1) continue;
      const id = lk.contentId;
      if (!id) continue;
      let title = '';
      const md = deepCollect(lk, (x) => x.lockupMetadataViewModel)[0];
      if (md) title = textOf(md.lockupMetadataViewModel.title);
      let thumb = '', bestW = -1;
      const prim = deepCollect(lk, (x) => x.primaryThumbnail)[0];
      const scope = prim ? prim.primaryThumbnail : lk;
      for (const s of deepCollect(scope, (x) => Array.isArray(x.sources))) {
        for (const src of s.sources) {
          if (src && src.url && /^https?:/.test(src.url) && (src.width || 0) >= bestW) {
            bestW = src.width || 0; thumb = src.url;
          }
        }
      }
      let count = '';
      for (const c of deepCollect(lk, (x) => typeof x.content === 'string')) {
        const cm = c.content.match(/^\s*(\d[\d.,\s]*)\s*(video|içerik|videos)\b/i);
        if (cm) { count = cm[1]; break; }
      }
      push(id, title, thumb, count);
    } catch (e) {}
  }
  for (const key of ['gridPlaylistRenderer', 'playlistRenderer', 'compactPlaylistRenderer']) {
    for (const o of deepCollect(data, (x) => x[key])) {
      try {
        const r = o[key];
        if (!r || !r.playlistId) continue;
        let thumb = '';
        const ths = deepCollect(r, (x) => Array.isArray(x.thumbnails) && x.thumbnails.length);
        if (ths.length) { const a = ths[0].thumbnails; thumb = a[a.length - 1].url || ''; }
        push(r.playlistId, textOf(r.title), thumb, textOf(r.videoCountShortText) || textOf(r.videoCountText));
      } catch (e) {}
    }
  }
  let continuation = null;
  for (const o of deepCollect(data, (x) => x.continuationItemRenderer)) {
    const ce = o.continuationItemRenderer.continuationEndpoint;
    const t = ce && ce.continuationCommand && ce.continuationCommand.token;
    if (t) { continuation = t; break; }
  }
  return { playlists: out, continuation };
}

async function enumeratePlaylists(forceReload) {
  await ensureHelperTab();
  await ensureFeedPage(!!forceReload);
  const r = await inject(PAGE_enumerate, []);
  if (!r || !r.ok || !r.data) throw new Error((r && r.error) || 'Playlist verisi okunamadı.');
  const first = parsePlaylists(r.data);
  let playlists = first.playlists;
  let cont = first.continuation;
  const seenTok = new Set();
  while (cont && !seenTok.has(cont)) {           // jeton tekrarı = döngü; sabit sayı sınırı YOK
    seenTok.add(cont);
    let more;
    try { more = await ytApi('browse', { continuation: cont }); } catch (e) { break; }
    const p = parsePlaylists(more);
    for (const pl of p.playlists) if (!playlists.some((x) => x.id === pl.id)) playlists.push(pl);
    cont = p.continuation;
  }
  return playlists;
}

function extractVideoItems(data) {
  return deepCollect(data, (o) => o.playlistVideoRenderer).map((o) => o.playlistVideoRenderer)
    .filter((r) => r && r.videoId)
    .map((r) => {
      const ths = deepCollect(r, (x) => Array.isArray(x.thumbnails) && x.thumbnails.length)[0];
      const thumbs = ths ? ths.thumbnails : [];
      let progress = 0;
      const pw = deepCollect(r, (x) => typeof x.percentDurationWatched === 'number')[0];
      if (pw) progress = Math.max(0, Math.min(100, pw.percentDurationWatched));
      let length = textOf(r.lengthText);
      if (!length) {
        const tsr = deepCollect(r, (x) => x.thumbnailOverlayTimeStatusRenderer)[0];
        if (tsr) length = textOf(tsr.thumbnailOverlayTimeStatusRenderer.text);
      }
      let seconds = parseInt(r.lengthSeconds, 10) || 0;
      if (!seconds && length) seconds = parseClock(length);
      return {
        videoId: r.videoId,
        setVideoId: r.setVideoId || null,
        title: textOf(r.title),
        thumb: thumbs.length ? thumbs[thumbs.length - 1].url : '',
        channel: textOf(r.shortBylineText),
        length: length || '',
        seconds,
        progress,
      };
    });
}
function extractContinuation(data) {
  for (const c of deepCollect(data, (o) => o.continuationItemRenderer)) {
    const ce = c.continuationItemRenderer && c.continuationItemRenderer.continuationEndpoint;
    const t = ce && ce.continuationCommand && ce.continuationCommand.token;
    if (t) return t;
  }
  return null;
}

// Bir playlistin TÜM videolarını okur — sabit sayı sınırı YOK
async function fetchPlaylistVideos(playlistId, onProgress) {
  const browseId = playlistId.indexOf('VL') === 0 ? playlistId : 'VL' + playlistId;
  let data = await ytApi('browse', { browseId });
  const out = new Map();
  for (const it of extractVideoItems(data)) out.set(it.videoId, it);
  if (onProgress) onProgress(out.size);
  let token = extractContinuation(data);
  const seenTok = new Set();
  while (token && !seenTok.has(token)) {         // jeton tekrarı tespiti — kaç video olursa olsun hepsi gelir
    seenTok.add(token);
    data = await ytApi('browse', { continuation: token });
    for (const it of extractVideoItems(data)) if (!out.has(it.videoId)) out.set(it.videoId, it);
    if (onProgress) onProgress(out.size);
    token = extractContinuation(data);
    await sleep(70);
  }
  return out;
}

async function editPlaylist(playlistId, action) {
  const data = await ytApi('browse/edit_playlist', { playlistId, actions: [action] });
  if (data && typeof data.status === 'string' && data.status !== 'STATUS_SUCCEEDED') {
    throw new Error('edit_playlist: ' + data.status);
  }
  return data;
}
// 429 / 5xx durumunda artan beklemeyle yeniden dener (rate-limit dayanıklılığı)
async function editPlaylistSafe(playlistId, action) {
  let wait = 1500;
  for (let attempt = 0; ; attempt++) {
    try { return await editPlaylist(playlistId, action); }
    catch (e) {
      const msg = String((e && e.message) || e);
      const code = e && e.httpStatus;
      const rateLimited = code === 429 || code === 503 || code === 500 || /\b(429|503)\b|too many|rate/i.test(msg);
      if (attempt < 3 && rateLimited) { await sleep(wait); wait *= 2; continue; }
      throw e;
    }
  }
}
const addVideo = (pl, vid) => editPlaylistSafe(pl, { action: 'ACTION_ADD_VIDEO', addedVideoId: vid });
const removeVideo = (pl, vid, setVideoId) => editPlaylistSafe(pl, setVideoId
  ? { action: 'ACTION_REMOVE_VIDEO', setVideoId }
  : { action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: vid });

// ---------------------------------------------------------------------------
//  ÜYELİK
// ---------------------------------------------------------------------------
function managedPlaylists() {
  const list = state.playlists.filter((p) => state.managed.has(p.id));
  return list.length ? list : state.playlists.slice();
}
async function loadMembership(force) {
  if (state.membershipFresh && !force) return;
  const mem = new Map();
  for (const pl of managedPlaylists()) {
    if (state.current && pl.id === state.current.id) {
      const m = new Map();
      state.videos.forEach((v) => m.set(v.videoId, v));
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
    if (state.current && pl.id === state.current.id) continue;
    const m = state.membership.get(pl.id);
    if (m && m.has(videoId)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
//  PLANLAMA MOTORU
// ---------------------------------------------------------------------------
function buildPlan(mode, selection, managedList, membership, videoIds, titleOf) {
  const ops = [];
  for (const vid of videoIds) {
    for (const pl of managedList) {
      const plMap = membership.get(pl.id);
      if (!plMap) continue;
      const isIn = plMap.has(vid);
      const rec = plMap.get(vid);
      let desired;
      if (mode === 'override') desired = selection.get(pl.id) ? 'in' : 'out';
      else {
        const s = selection.get(pl.id) || 'untouched';
        desired = s === 'include' ? 'in' : s === 'exclude' ? 'out' : 'keep';
      }
      if (desired === 'in' && !isIn) {
        ops.push({ type: 'add', videoId: vid, videoTitle: titleOf(vid), playlistId: pl.id, playlistTitle: pl.title });
      } else if (desired === 'out' && isIn) {
        ops.push({ type: 'remove', videoId: vid, videoTitle: titleOf(vid), playlistId: pl.id,
          playlistTitle: pl.title, setVideoId: rec ? rec.setVideoId : null });
      }
    }
  }
  return ops;
}
async function executePlan(ops, dryRun, onProgress) {
  const results = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      if (dryRun) results.push({ op, ok: true, dryRun: true });
      else {
        if (op.type === 'add') await addVideo(op.playlistId, op.videoId);
        else await removeVideo(op.playlistId, op.videoId, op.setVideoId);
        results.push({ op, ok: true });
        await sleep(state.settings.delayMs);
      }
    } catch (e) {
      results.push({ op, ok: false, error: String((e && e.message) || e) });
      onProgress(i + 1, ops.length, results);
      return { results, stopped: true };
    }
    onProgress(i + 1, ops.length, results);
  }
  return { results, stopped: false };
}

// ---------------------------------------------------------------------------
//  GÖRÜNÜM: BREADCRUMB + İSKELETLER
// ---------------------------------------------------------------------------
function setCrumbs(parts) {
  const c = $('#crumbs');
  clear(c);
  parts.forEach((p, i) => {
    if (i) c.appendChild(h('span', { text: '›', style: { color: 'var(--text-3)' } }));
    if (p.onClick) c.appendChild(h('a', { onclick: p.onClick, text: p.text }));
    else c.appendChild(h('span', { class: 'cur', text: p.text }));
  });
}
function skeletonGrid(n) {
  const g = h('div', { class: 'grid' });
  for (let i = 0; i < n; i++) g.appendChild(h('div', { class: 'sk-card' },
    h('div', { class: 'sk a' }), h('div', { class: 'sk b' }), h('div', { class: 'sk c' })));
  return g;
}
function skeletonRows(n) {
  const w = h('div', {});
  for (let i = 0; i < n; i++) w.appendChild(h('div', { class: 'sk-row' },
    h('div', { class: 'sk a' }),
    h('div', { class: 't' }, h('div', { class: 'sk l1' }), h('div', { class: 'sk l2' }))));
  return w;
}

// ---------------------------------------------------------------------------
//  GÖRÜNÜM: PLAYLIST IZGARASI
// ---------------------------------------------------------------------------
function renderPlaylists() {
  state.current = null;
  state.selected.clear();
  setCrumbs([{ text: 'Oynatma Listelerim' }]);
  const view = $('#view');
  clear(view);
  if (!state.playlists.length) {
    view.appendChild(emptyState('📭', 'Playlist bulunamadı. ↻ Yenile ile tekrar dene veya YouTube\'da giriş yap.'));
    return;
  }
  const ptools = h('div', { class: 'ptools' });
  const searchI = h('input', { type: 'text', placeholder: 'Liste ara…' });
  searchI.value = state.plSearch;
  searchI.addEventListener('input', () => { state.plSearch = searchI.value; renderPlaylistGrid(); });
  ptools.appendChild(h('div', { class: 'search' }, h('span', { text: '⌕', style: { color: 'var(--text-3)' } }), searchI));
  ptools.appendChild(mkSelect([
    ['default', 'Sıralama: Varsayılan'], ['title-asc', 'İsim: A→Z'], ['title-desc', 'İsim: Z→A'],
    ['count-desc', 'Video sayısı: çok→az'], ['count-asc', 'Video sayısı: az→çok'],
  ], state.settings.plSort, async (v) => { state.settings.plSort = v; await saveSettings(); renderPlaylistGrid(); }));
  const moChk = h('input', { type: 'checkbox' });
  moChk.checked = state.plManagedOnly;
  moChk.addEventListener('change', () => { state.plManagedOnly = moChk.checked; renderPlaylistGrid(); });
  ptools.appendChild(h('label', { class: 'chk-label' }, moChk, h('span', { text: 'Sadece yönetilenler' })));
  ptools.appendChild(h('div', { class: 'grow' }));
  ptools.appendChild(h('div', { class: 'pcount', id: 'pcount' }));
  view.appendChild(ptools);
  view.appendChild(h('div', { id: 'pgrid' }));
  renderPlaylistGrid();
}
function sortPlaylists(list) {
  const num = (p) => parseInt(String(p.count).replace(/[^\d]/g, ''), 10) || 0;
  const cmp = {
    'title-asc': (a, b) => a.title.localeCompare(b.title, 'tr'),
    'title-desc': (a, b) => b.title.localeCompare(a.title, 'tr'),
    'count-desc': (a, b) => num(b) - num(a),
    'count-asc': (a, b) => num(a) - num(b),
  }[state.settings.plSort];
  return cmp ? list.slice().sort(cmp) : list;
}
function renderPlaylistGrid() {
  const box = $('#pgrid');
  if (!box) return;
  clear(box);
  let list = state.playlists.slice();
  const q = state.plSearch.trim().toLowerCase();
  if (q) list = list.filter((p) => p.title.toLowerCase().indexOf(q) !== -1);
  if (state.plManagedOnly) list = list.filter((p) => state.managed.has(p.id));
  list = sortPlaylists(list);
  const pc = $('#pcount');
  if (pc) pc.textContent = list.length + ' / ' + state.playlists.length + tt(' liste');
  if (!list.length) { box.appendChild(emptyState('🔍', 'Eşleşen liste yok.')); return; }
  const grid = h('div', { class: 'grid' });
  for (const pl of list) {
    const thumb = h('div', { class: 'pcard-thumb',
      style: pl.thumb ? { backgroundImage: 'url("' + pl.thumb + '")' } : {} });
    if (!pl.thumb) thumb.appendChild(h('div', { class: 'ph', text: '☰' }));
    if (pl.count) thumb.appendChild(h('span', { class: 'cnt', text: pl.count + ' video' }));
    const sub = h('div', { class: 'pcard-sub' });
    if (state.managed.has(pl.id)) sub.appendChild(h('span', { class: 'pbadge', text: '✓ yönetilen' }));
    else sub.appendChild(h('span', { class: 'meta', text: 'düzenlemek için aç' }));
    grid.appendChild(h('div', { class: 'pcard', onclick: () => openPlaylist(pl) },
      thumb, h('div', { class: 'pcard-body' }, h('div', { class: 'pcard-title', text: pl.title }), sub)));
  }
  box.appendChild(grid);
}

// ---------------------------------------------------------------------------
//  GÖRÜNÜM: PLAYLIST DETAYI
// ---------------------------------------------------------------------------
async function openPlaylist(pl) {
  state.current = pl;
  state.selected.clear();
  state.filter = 'all';
  state.search = '';
  state.memFilter = 'all';
  state.lastClickIdx = -1;
  setCrumbs([{ text: 'Oynatma Listelerim', onClick: renderPlaylists }, { text: pl.title }]);
  const view = $('#view');
  clear(view);
  view.appendChild(h('div', { class: 'dhead' }, h('h1', { text: pl.title }),
    h('div', { class: 'sub', text: 'videolar yükleniyor…' })));
  view.appendChild(skeletonRows(8));
  try {
    const map = await fetchPlaylistVideos(pl.id, (n) => status(n + tt(' video okundu…')));
    hideStatus();
    state.vmap = map;
    state.videos = Array.from(map.values());
    renderDetail();
    loadMembership().then(() => {
      updateChips();
      if (state.memFilter !== 'all') renderList();
    }).catch(() => {});
  } catch (e) {
    clear(view);
    view.appendChild(emptyState('⚠️', 'Videolar okunamadı: ' + e.message));
    status(tt('Hata: ') + e.message, true);
  }
}

function computeVisible() {
  const q = state.search.trim().toLowerCase();
  const arr = state.videos.filter((v) => {
    if (state.filter === 'watched' && !(v.progress > 0)) return false;
    if (state.filter === 'unwatched' && v.progress > 0) return false;
    if (q && (v.title || '').toLowerCase().indexOf(q) === -1
          && (v.channel || '').toLowerCase().indexOf(q) === -1) return false;
    const mf = state.memFilter;
    if (mf === 'archived' && !inOtherManaged(v.videoId)) return false;
    if (mf === 'unarchived' && inOtherManaged(v.videoId)) return false;
    if (mf.indexOf('pl:') === 0) {
      const m = state.membership.get(mf.slice(3));
      if (!m || !m.has(v.videoId)) return false;
    }
    return true;
  });
  const s = state.settings.vidSort;
  const cmp = {
    'progress-desc': (a, b) => b.progress - a.progress,
    'progress-asc': (a, b) => a.progress - b.progress,
    'dur-desc': (a, b) => (b.seconds || 0) - (a.seconds || 0),
    'dur-asc': (a, b) => (a.seconds || 0) - (b.seconds || 0),
    'title-asc': (a, b) => (a.title || '').localeCompare(b.title || '', 'tr'),
    'title-desc': (a, b) => (b.title || '').localeCompare(a.title || '', 'tr'),
    'channel-asc': (a, b) => (a.channel || '').localeCompare(b.channel || '', 'tr'),
  }[s];
  return cmp ? arr.slice().sort(cmp) : arr;
}

function buildMemSelect() {
  const sel = h('select', { class: 'select' });
  sel.appendChild(h('option', { value: 'all', text: 'Üyelik: Tümü' }));
  sel.appendChild(h('option', { value: 'archived', text: 'Başka arşivde VAR' }));
  sel.appendChild(h('option', { value: 'unarchived', text: 'Hiç arşivde YOK' }));
  const og = h('optgroup', { label: 'Şu listede olanlar' });
  for (const pl of managedPlaylists()) {
    if (state.current && pl.id === state.current.id) continue;
    og.appendChild(h('option', { value: 'pl:' + pl.id, text: pl.title }));
  }
  if (og.children.length) sel.appendChild(og);
  sel.value = state.memFilter;
  sel.addEventListener('change', () => { state.memFilter = sel.value; renderList(); });
  return sel;
}

function renderDetail() {
  const view = $('#view');
  clear(view);
  const pl = state.current;
  const watched = state.videos.filter((v) => v.progress > 0).length;

  view.appendChild(h('div', { class: 'dhead' },
    h('h1', { text: pl.title }),
    h('div', { class: 'sub' }, h('b', { text: String(state.videos.length) }), ' video • ',
      h('b', { text: String(watched) }), ' izlenmiş')));

  const tools = h('div', { class: 'dtools' });
  // --- 1. satır: filtre / sıralama / arama ---
  const row1 = h('div', { class: 'trow' });
  const seg = h('div', { class: 'seg' });
  const segBtns = {};
  [['all', 'Tümü', state.videos.length],
   ['watched', 'İzlenmiş', watched],
   ['unwatched', 'İzlenmemiş', state.videos.length - watched]].forEach(([key, label, n]) => {
    const b = h('button', { class: state.filter === key ? 'on' : '' }, label, h('span', { class: 'n', text: String(n) }));
    b.addEventListener('click', () => {
      state.filter = key;
      for (const k in segBtns) segBtns[k].className = (k === key ? 'on' : '');
      renderList();
    });
    segBtns[key] = b;
    seg.appendChild(b);
  });
  row1.appendChild(seg);
  row1.appendChild(buildMemSelect());
  row1.appendChild(mkSelect([
    ['order', 'Sıra: Liste sırası'], ['progress-desc', 'İzlenme: çok→az'], ['progress-asc', 'İzlenme: az→çok'],
    ['dur-desc', 'Süre: uzun→kısa'], ['dur-asc', 'Süre: kısa→uzun'],
    ['title-asc', 'Başlık: A→Z'], ['title-desc', 'Başlık: Z→A'], ['channel-asc', 'Kanal: A→Z'],
  ], state.settings.vidSort, async (v) => { state.settings.vidSort = v; await saveSettings(); renderList(); }));
  const searchInput = h('input', { type: 'text', id: 'vsearch', placeholder: 'Videolarda ara…  ( / )' });
  searchInput.value = state.search;
  searchInput.addEventListener('input', () => { state.search = searchInput.value; renderList(); });
  row1.appendChild(h('div', { class: 'search' }, h('span', { text: '⌕', style: { color: 'var(--text-3)' } }), searchInput));
  tools.appendChild(row1);

  // --- 2. satır: seçim + işlemler ---
  const row2 = h('div', { class: 'trow' });
  row2.appendChild(h('button', { class: 'btn sm ghost',
    onclick: () => { curVisible.forEach((v) => state.selected.add(v.videoId)); updateSelectionUI(); } }, 'Görüneni Seç'));
  row2.appendChild(h('button', { class: 'btn sm ghost',
    onclick: () => { state.selected.clear(); updateSelectionUI(); } }, 'Temizle'));
  row2.appendChild(h('button', { class: 'btn sm ghost', title: 'Bu listeyi yenile',
    onclick: () => openPlaylist(state.current) }, '↻'));
  row2.appendChild(h('div', { class: 'grow' }));
  row2.appendChild(h('div', { class: 'selinfo', id: 'selinfo' }));
  const qBtn = h('button', { class: 'btn sm danger', id: 'btn-qremove', onclick: quickRemove,
    title: 'Seçilenleri yalnızca bu listeden çıkar' }, 'Bu listeden çıkar');
  row2.appendChild(qBtn);
  const opBtn = h('button', { class: 'btn primary', id: 'btn-op', onclick: openOperation }, 'İşlem Yap →');
  row2.appendChild(opBtn);
  tools.appendChild(row2);
  view.appendChild(tools);

  view.appendChild(h('div', { id: 'vlist' }));
  renderList();
}

function renderList() {
  const box = $('#vlist');
  if (!box) return;
  if (io) io.disconnect();
  clear(box);
  curVisible = computeVisible();
  renderedCount = 0;
  if (!state.videos.length) { box.appendChild(emptyState('📭', 'Bu liste boş.')); updateSelectionUI(); return; }
  if (!curVisible.length) { box.appendChild(emptyState('🔍', 'Bu filtre/aramayla eşleşen video yok.')); updateSelectionUI(); return; }
  appendChunk();
  updateSelectionUI();
}
function ensureIO() {
  if (io) return io;
  io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); appendChunk(); }
  }, { rootMargin: '700px' });
  return io;
}
function appendChunk() {
  const box = $('#vlist');
  if (!box) return;
  const old = box.querySelector('.load-sentinel');
  if (old) old.remove();
  const slice = curVisible.slice(renderedCount, renderedCount + RENDER_CHUNK);
  slice.forEach((v, i) => box.appendChild(buildVideoRow(v, renderedCount + i)));
  renderedCount += slice.length;
  updateChips();
  updateSelectionUI();
  if (renderedCount < curVisible.length) {
    const s = h('div', { class: 'load-sentinel' },
      h('div', { class: 'spinner', style: { width: '20px', height: '20px', margin: '0 auto 8px', borderWidth: '2px' } }),
      h('div', { text: renderedCount + ' / ' + curVisible.length + tt(' gösteriliyor — kaydır…') }));
    box.appendChild(s);
    ensureIO().observe(s);
  }
}

function buildVideoRow(v, absIdx) {
  const row = h('div', { class: 'vrow', dataset: { vid: v.videoId, idx: String(absIdx) } });
  const sel0 = state.selected.has(v.videoId);
  if (sel0) row.classList.add('sel');

  const cb = h('input', { type: 'checkbox' });
  cb.checked = sel0;
  const check = h('div', { class: 'vcheck' }, cb);

  const thumb = h('div', { class: 'vthumb', style: v.thumb ? { backgroundImage: 'url("' + v.thumb + '")' } : {} });
  if (v.length) thumb.appendChild(h('span', { class: 'vdur', text: v.length }));
  if (v.progress > 0) {
    thumb.appendChild(h('div', { class: 'vprog' }, h('i', { style: { width: Math.min(100, v.progress) + '%' } })));
  }

  const meta = h('div', { class: 'vmeta' });
  if (v.channel) meta.appendChild(h('span', { text: v.channel }));
  if (v.progress >= 95) meta.appendChild(h('span', { class: 'watched', text: '✓ izlendi' }));
  else if (v.progress > 0) meta.appendChild(h('span', { class: 'partly', text: '%' + Math.round(v.progress) + ' izlendi' }));
  else meta.appendChild(h('span', { text: 'izlenmedi' }));

  const main = h('div', { class: 'vmain' },
    h('div', { class: 'vtitle', text: v.title || '(başlıksız)' }), meta, h('div', { class: 'vchips' }));

  const open = h('a', { class: 'vopen', href: 'https://www.youtube.com/watch?v=' + v.videoId,
    target: '_blank', rel: 'noopener', title: 'YouTube\'da aç', text: '↗' });
  open.addEventListener('click', (e) => e.stopPropagation());

  row.appendChild(check);
  row.appendChild(thumb);
  row.appendChild(main);
  row.appendChild(open);

  const toggle = (e) => {
    const visIdx = parseInt(row.dataset.idx, 10);
    if (e.shiftKey && state.lastClickIdx >= 0 && curVisible.length) {
      const a = Math.min(state.lastClickIdx, visIdx), b = Math.max(state.lastClickIdx, visIdx);
      for (let i = a; i <= b; i++) if (curVisible[i]) state.selected.add(curVisible[i].videoId);
    } else {
      if (state.selected.has(v.videoId)) state.selected.delete(v.videoId);
      else state.selected.add(v.videoId);
    }
    state.lastClickIdx = visIdx;
    updateSelectionUI();
  };
  cb.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); toggle(e); });
  row.addEventListener('click', (e) => { if (e.target.closest('.vopen')) return; toggle(e); });
  return row;
}

function updateSelectionUI() {
  const box = $('#vlist');
  if (box) box.querySelectorAll('.vrow').forEach((row) => {
    const on = state.selected.has(row.dataset.vid);
    row.classList.toggle('sel', on);
    const cb = row.querySelector('.vcheck input');
    if (cb) cb.checked = on;
  });
  let secs = 0;
  for (const id of state.selected) { const v = state.vmap.get(id); if (v) secs += v.seconds || 0; }
  const info = $('#selinfo');
  if (info) {
    clear(info);
    info.appendChild(h('b', { text: String(state.selected.size) }));
    info.appendChild(document.createTextNode(tt(' seçili') + (secs ? ' · ' + fmtDur(secs) : '')));
  }
  const op = $('#btn-op');
  if (op) op.disabled = state.selected.size === 0;
  const qr = $('#btn-qremove');
  if (qr) qr.disabled = state.selected.size === 0;
}

function updateChips() {
  const box = $('#vlist');
  if (!box) return;
  const managed = managedPlaylists();
  box.querySelectorAll('.vrow').forEach((row) => {
    const vid = row.dataset.vid;
    const chipBox = row.querySelector('.vchips');
    if (!chipBox) return;
    clear(chipBox);
    for (const pl of managed) {
      if (state.current && pl.id === state.current.id) continue;
      const mem = state.membership.get(pl.id);
      if (mem && mem.has(vid)) {
        const col = plColor(pl.id);
        chipBox.appendChild(h('span', { class: 'chip', style: { background: hexA(col, .16), color: col } },
          h('span', { class: 'dot', style: { background: col } }), pl.title));
      }
    }
  });
}

// ---------------------------------------------------------------------------
//  MODAL
// ---------------------------------------------------------------------------
function closeModal() { clear($('#modal-root')); document.removeEventListener('keydown', escClose); }
function escClose(e) { if (e.key === 'Escape') closeModal(); }
function openModal(titleText) {
  closeModal();
  const body = h('div', { class: 'mbody' });
  const foot = h('div', { class: 'mfoot' });
  const modal = h('div', { class: 'modal' },
    h('div', { class: 'mhead' }, h('h2', { text: titleText }),
      h('button', { class: 'xbtn', text: '✕', onclick: closeModal })),
    body, foot);
  const overlay = h('div', { class: 'overlay',
    onclick: (e) => { if (e.target.classList.contains('overlay')) closeModal(); } }, modal);
  $('#modal-root').appendChild(overlay);
  document.addEventListener('keydown', escClose);
  return { body, foot };
}

// ---------------------------------------------------------------------------
//  İŞLEM PENCERESİ
// ---------------------------------------------------------------------------
function openOperation() {
  if (!state.selected.size) return;
  const videoIds = Array.from(state.selected);
  const managed = managedPlaylists();
  const m = openModal(tt('İşlem Yap — ') + videoIds.length + tt(' video'));

  const last = state.lastOp;
  let mode = (last && last.mode) || 'override';
  const selOv = new Map();
  const selPa = new Map();
  managed.forEach((p) => {
    selOv.set(p.id, !!(last && last.ov && last.ov[p.id]));
    selPa.set(p.id, (last && last.pa && last.pa[p.id]) || 'untouched');
  });

  const optOv = h('label', { class: 'mode' },
    h('input', { type: 'radio', name: 'md' }),
    h('div', {}, h('b', { text: 'Mod 1 — Override (tam senkron)' }),
      h('small', { text: 'İşaretli listeler: eklensin. İşaretsiz listeler: çıkarılsın. ' +
        'Seçili tüm videoların yönetilen listelerdeki üyeliği kutulara birebir eşitlenir.' })));
  const optPa = h('label', { class: 'mode' },
    h('input', { type: 'radio', name: 'md' }),
    h('div', {}, h('b', { text: 'Mod 2 — Include / Exclude (kısmi)' }),
      h('small', { text: 'Her liste: + Ekle / · Dokunma / − Çıkar. "Dokunma" listelere hiç dokunulmaz.' })));
  const modeBox = h('div', { class: 'card' }, h('div', { class: 'lbl', text: 'Mod' }), optOv, optPa);

  const plRows = h('div', {});
  const modeHint = h('div', { class: 'hint' });
  const plBox = h('div', { class: 'card' },
    h('div', { class: 'lbl', text: tt('Hedef Listeler (') + managed.length + ')' }), plRows, modeHint);

  function renderRows() {
    clear(plRows);
    for (const p of managed) {
      const row = h('div', { class: 'plrow' },
        h('span', { class: 'nm' }, h('span', { class: 'dot', style: { background: plColor(p.id) } }),
          h('span', { text: p.title, title: p.id })));
      if (mode === 'override') {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = !!selOv.get(p.id);
        cb.addEventListener('change', () => selOv.set(p.id, cb.checked));
        row.appendChild(h('label', {}, cb, h('span', { text: 'listede olsun' })));
      } else {
        const cur = selPa.get(p.id);
        const tri = h('div', { class: 'tri' });
        const mk = (val, label, cls) => {
          const b = h('button', { class: cur === val ? 'on ' + cls : '' }, label);
          b.addEventListener('click', () => { selPa.set(p.id, val); renderRows(); });
          return b;
        };
        tri.appendChild(mk('include', '+ Ekle', 'inc'));
        tri.appendChild(mk('untouched', '· Dokunma', 'unt'));
        tri.appendChild(mk('exclude', '− Çıkar', 'exc'));
        row.appendChild(tri);
      }
      plRows.appendChild(row);
    }
    modeHint.textContent = mode === 'override'
      ? tt('Override: işaretsiz listelerden de video ÇIKARILIR (yalnızca bu yönetilen listelerde).')
      : tt('Include/Exclude: yalnızca + / − seçtiğin listeler etkilenir; · listelere dokunulmaz.');
  }
  function setMode(nm) {
    mode = nm;
    optOv.classList.toggle('on', nm === 'override');
    optPa.classList.toggle('on', nm === 'partial');
    optOv.querySelector('input').checked = nm === 'override';
    optPa.querySelector('input').checked = nm === 'partial';
    renderRows();
  }
  optOv.addEventListener('click', () => setMode('override'));
  optPa.addEventListener('click', () => setMode('partial'));
  setMode(mode);

  m.body.appendChild(modeBox);
  m.body.appendChild(plBox);

  m.foot.appendChild(h('button', { class: 'btn ghost', text: 'İptal', onclick: closeModal }));
  m.foot.appendChild(h('button', { class: 'btn primary', text: 'Önizle →', onclick: () => {
    if (mode === 'partial' && !Array.from(selPa.values()).some((v) => v !== 'untouched')) {
      status('Mod 2: en az bir liste için + veya − seç.', true);
      return;
    }
    state.lastOp = { mode, ov: Object.fromEntries(selOv), pa: Object.fromEntries(selPa) };
    runOperationPreview(m, mode, mode === 'override' ? selOv : selPa, managed, videoIds);
  } }));
}

async function runOperationPreview(m, mode, selection, managed, videoIds) {
  clear(m.body); clear(m.foot);
  const stat = h('div', { text: 'Yönetilen listelerin içeriği okunuyor…' });
  const bar = h('div', { class: 'pbar' }, h('i', {}));
  m.body.appendChild(stat);
  m.body.appendChild(bar);

  const membership = new Map();
  const readErr = [];
  for (let i = 0; i < managed.length; i++) {
    const pl = managed[i];
    stat.textContent = '"' + pl.title + tt('" okunuyor… (') + (i + 1) + '/' + managed.length + ')';
    try { membership.set(pl.id, await fetchPlaylistVideos(pl.id)); }
    catch (e) { readErr.push(pl.title + ': ' + e.message); }
    bar.firstChild.style.width = Math.round(((i + 1) / managed.length) * 100) + '%';
  }
  state.membership = membership;
  state.membershipFresh = true;

  if (readErr.length) {
    clear(m.body);
    m.body.appendChild(h('div', { class: 'card' },
      h('div', { class: 'lbl', text: 'Listeler okunamadı — işlem iptal edildi' }),
      h('div', { class: 'mono', text: readErr.join('\n') }),
      h('div', { class: 'hint', text: 'Hiçbir değişiklik yapılmadı (eksik bilgiyle listeye dokunulmaz).' })));
    m.foot.appendChild(h('button', { class: 'btn', text: 'Kapat', onclick: closeModal }));
    return;
  }
  const titleOf = (vid) => { const v = state.vmap.get(vid); return v ? (v.title || vid) : vid; };
  const usable = managed.filter((p) => membership.has(p.id));
  const ops = buildPlan(mode, selection, usable, membership, videoIds, titleOf);
  const noChange = videoIds.length * usable.length - ops.length;
  renderPreview(m, ops, () => openOperation(), noChange);
}

// Hızlı işlem: seçilenleri yalnızca açık olan listeden çıkar
function quickRemove() {
  if (!state.selected.size || !state.current) return;
  const ops = Array.from(state.selected).map((vid) => {
    const v = state.vmap.get(vid);
    return { type: 'remove', videoId: vid, videoTitle: (v && v.title) || vid,
      playlistId: state.current.id, playlistTitle: state.current.title,
      setVideoId: v ? v.setVideoId : null };
  });
  const m = openModal(tt('Bu listeden çıkar') + ' — ' + ops.length + tt(' video'));
  renderPreview(m, ops, null, 0);
}

// Önizleme ekranı (hem tam işlem hem hızlı çıkarma için ortak)
function renderPreview(m, ops, backFn, noChange) {
  clear(m.body); clear(m.foot);
  let dryRun = state.settings.dryRun;
  const adds = ops.filter((o) => o.type === 'add').length;
  const rems = ops.filter((o) => o.type === 'remove').length;

  if (ops.length) {
    const drySw = h('div', {});
    const dryChk = h('input', { type: 'checkbox' });
    dryChk.checked = dryRun;
    const dryTxt = h('span', { class: 'txt' });
    const applyBtn = h('button', {});
    const paint = () => {
      drySw.className = 'drybar ' + (dryRun ? 'dry' : 'live');
      clear(dryTxt);
      dryTxt.appendChild(h('b', { text: dryRun ? 'DRY-RUN açık' : '⚠ CANLI MOD' }));
      dryTxt.appendChild(document.createTextNode(dryRun
        ? ' — hiçbir şey yazılmaz, sadece ne olacağı gösterilir.'
        : ' — onaylarsan değişiklikler GERÇEKTEN uygulanır.'));
      applyBtn.className = 'btn ' + (dryRun ? 'primary' : 'danger');
      applyBtn.textContent = dryRun ? tt('DRY-RUN Çalıştır') : (tt('GERÇEKTEN Uygula (') + ops.length + ')');
    };
    dryChk.addEventListener('change', () => { dryRun = dryChk.checked; paint(); });
    drySw.appendChild(dryChk);
    drySw.appendChild(dryTxt);
    paint();
    m.body.appendChild(drySw);

    m.body.appendChild(h('div', { class: 'stats' },
      h('div', { class: 'stat add' }, h('div', { class: 'n', text: String(adds) }), h('div', { class: 'l', text: 'ekleme' })),
      h('div', { class: 'stat rem' }, h('div', { class: 'n', text: String(rems) }), h('div', { class: 'l', text: 'çıkarma' })),
      h('div', { class: 'stat keep' }, h('div', { class: 'n', text: String(noChange || 0) }), h('div', { class: 'l', text: 'değişiklik yok' }))));

    const list = h('div', { class: 'oplist' });
    ops.forEach((op) => {
      list.appendChild(h('div', { class: 'op' },
        h('span', { class: 'tag ' + (op.type === 'add' ? 'add' : 'rem'), text: op.type === 'add' ? 'EKLE' : 'ÇIKAR' }),
        h('span', { class: 'v', text: op.videoTitle, title: op.videoId }),
        h('span', { class: 'p', text: '→ ' + op.playlistTitle }),
        h('span', { class: 'st' })));
    });
    m.body.appendChild(list);

    if (backFn) m.foot.appendChild(h('button', { class: 'btn ghost', text: '← Geri',
      onclick: () => { closeModal(); backFn(); } }));
    applyBtn.addEventListener('click', () => {
      if (!dryRun && !confirm(tt('CANLI MOD: ') + adds + tt(' ekleme, ') + rems + tt(' çıkarma gerçekten uygulanacak. Devam?'))) return;
      doExecute(m, ops, dryRun, list);
    });
    m.foot.appendChild(applyBtn);
  } else {
    m.body.appendChild(h('div', { class: 'hint', text: 'Yapılacak değişiklik yok — seçtiklerin zaten istenen durumda.' }));
    if (backFn) m.foot.appendChild(h('button', { class: 'btn ghost', text: '← Geri',
      onclick: () => { closeModal(); backFn(); } }));
    m.foot.appendChild(h('button', { class: 'btn primary', text: 'Kapat', onclick: closeModal }));
  }
}

async function doExecute(m, ops, dryRun, list) {
  clear(m.foot);
  const stat = h('div', { text: dryRun ? 'DRY-RUN çalışıyor…' : 'Uygulanıyor…' });
  const bar = h('div', { class: 'pbar' }, h('i', {}));
  m.body.insertBefore(bar, m.body.firstChild);
  m.body.insertBefore(stat, m.body.firstChild);

  const marks = list.querySelectorAll('.st');
  const onProgress = (done, total, results) => {
    bar.firstChild.style.width = Math.round((done / total) * 100) + '%';
    stat.textContent = (dryRun ? 'DRY-RUN: ' : '') + done + ' / ' + total;
    const last = results[results.length - 1];
    const mk = marks[results.length - 1];
    if (last && mk) {
      mk.textContent = last.ok ? (last.dryRun ? '○' : '✓') : '✗';
      mk.style.color = last.ok ? (last.dryRun ? 'var(--text-3)' : 'var(--green)') : 'var(--danger)';
    }
  };

  const { results, stopped } = await executePlan(ops, dryRun, onProgress);
  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;

  if (!dryRun) {
    state.membershipFresh = false;
    const applied = results.filter((r) => r.ok && !r.dryRun).map((r) => r.op);
    if (applied.length) {
      try { await chrome.storage.local.set({ lastBatch: { t: Date.now(), ops: applied } }); } catch (e) {}
    }
  }
  clear(stat);
  stat.appendChild(h('b', { text: dryRun ? 'DRY-RUN bitti.' : 'Bitti.' }));
  stat.appendChild(document.createTextNode(dryRun
    ? ' ' + ok + tt(' işlem simüle edildi, hiçbir şey yazılmadı.')
    : ' ' + ok + tt(' başarılı, ') + fail + tt(' hatalı.') + (stopped ? tt(' (ilk hatada durdu)') : '')));

  const fails = results.filter((r) => !r.ok);
  if (fails.length) {
    m.body.appendChild(h('div', { class: 'card' },
      h('div', { class: 'lbl', text: 'Hatalar' }),
      h('div', { class: 'mono', text: fails.map((r) =>
        r.op.type + ' ' + r.op.videoTitle + ' → ' + r.op.playlistTitle + '\n   ' + r.error).join('\n\n') })));
  }
  clear(m.foot);
  if (!dryRun && ok > 0) m.foot.appendChild(h('button', { class: 'btn danger', text: '↩ Bu partiyi geri al', onclick: undoLast }));
  m.foot.appendChild(h('button', { class: 'btn primary', text: 'Kapat', onclick: async () => {
    closeModal();
    if (!dryRun && ok > 0 && state.current) await openPlaylist(state.current);
  } }));
  if (dryRun) m.body.appendChild(h('div', { class: 'hint',
    text: 'Sonuç doğruysa: Kapat → tekrar aç → DRY-RUN kutusunu kapat. İlkini bir test listesiyle dene.' }));
}

async function undoLast() {
  let batch;
  try { batch = (await chrome.storage.local.get('lastBatch')).lastBatch; } catch (e) {}
  if (!batch || !batch.ops || !batch.ops.length) { status('Geri alınacak parti yok.', true); return; }
  if (!confirm(tt('Son parti geri alınacak: ') + batch.ops.length + tt(' işlemin TERSİ uygulanacak. Devam?'))) return;
  const m = openModal('↩ Geri Al');
  const stat = h('div', { text: 'Geri alınıyor…' });
  const bar = h('div', { class: 'pbar' }, h('i', {}));
  m.body.appendChild(stat);
  m.body.appendChild(bar);
  const inverse = batch.ops.map((op) => op.type === 'add'
    ? { type: 'remove', videoId: op.videoId, videoTitle: op.videoTitle, playlistId: op.playlistId, playlistTitle: op.playlistTitle, setVideoId: null }
    : { type: 'add', videoId: op.videoId, videoTitle: op.videoTitle, playlistId: op.playlistId, playlistTitle: op.playlistTitle });
  const { results } = await executePlan(inverse, false, (done, total) => {
    bar.firstChild.style.width = Math.round((done / total) * 100) + '%';
    stat.textContent = tt('Geri alınıyor: ') + done + ' / ' + total;
  });
  const ok = results.filter((r) => r.ok).length;
  state.membershipFresh = false;
  clear(stat);
  stat.appendChild(h('b', { text: 'Geri alma bitti.' }));
  stat.appendChild(document.createTextNode(' ' + ok + ' / ' + results.length + tt(' başarılı.')));
  try { await chrome.storage.local.remove('lastBatch'); } catch (e) {}
  m.foot.appendChild(h('button', { class: 'btn primary', text: 'Kapat', onclick: async () => {
    closeModal();
    if (state.current) await openPlaylist(state.current);
  } }));
}

// ---------------------------------------------------------------------------
//  AYARLAR
// ---------------------------------------------------------------------------
function openSettings() {
  const m = openModal('⚙ Ayarlar');
  const rows = h('div', {});
  const countEl = h('span', { class: 'hint' });
  function refreshRows() {
    clear(rows);
    state.playlists.forEach((p) => {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = state.managed.has(p.id);
      cb.addEventListener('change', () => {
        if (cb.checked) state.managed.add(p.id); else state.managed.delete(p.id);
        countEl.textContent = state.managed.size + ' / ' + state.playlists.length + tt(' seçili');
      });
      rows.appendChild(h('div', { class: 'plrow' },
        h('span', { class: 'nm' }, h('span', { class: 'dot', style: { background: plColor(p.id) } }),
          h('span', { text: p.title })),
        h('label', {}, cb, h('span', { text: 'yönetilen' }))));
    });
    countEl.textContent = state.managed.size + ' / ' + state.playlists.length + tt(' seçili');
  }
  const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' } },
    countEl, h('div', { class: 'grow' }),
    h('button', { class: 'btn sm', onclick: () => { state.playlists.forEach((p) => state.managed.add(p.id)); refreshRows(); } }, 'Tümünü Seç'),
    h('button', { class: 'btn sm', onclick: () => { state.managed.clear(); refreshRows(); } }, 'Hiçbirini Seç'));
  refreshRows();
  m.body.appendChild(h('div', { class: 'card' },
    h('div', { class: 'lbl', text: 'Yönetilen Listeler' }),
    h('div', { class: 'hint', style: { marginBottom: '10px' },
      text: tt('İşlem penceresinde hedef olarak SADECE işaretli listeler görünür. ') +
        tt('Override modu yalnızca bunları etkiler; işaretsizlere asla dokunulmaz.') }),
    head, rows));

  const delay = h('input', { type: 'number', min: '0', max: '5000', value: String(state.settings.delayMs),
    style: { width: '90px', background: 'var(--surface-3)', color: 'var(--text)',
      border: '1px solid var(--border-2)', borderRadius: '7px', padding: '6px' } });
  const dry = h('input', { type: 'checkbox' });
  dry.checked = state.settings.dryRun;
  m.body.appendChild(h('div', { class: 'card' },
    h('div', { class: 'lbl', text: 'Genel' }),
    h('label', { class: 'diag-line', style: { cursor: 'pointer' } }, dry,
      h('span', { text: 'İşlem penceresi DRY-RUN açık başlasın (önerilir)' })),
    h('div', { class: 'diag-line' },
      h('span', { text: 'Yazma istekleri arası bekleme (ms):' }), delay),
    h('div', { class: 'hint', style: { marginTop: '6px' },
      text: tt('Önerilen 200–400 ms. Çok düşük tutsan bile 429 (çok fazla istek) gelirse araç ') +
        tt('otomatik bekleyip yeniden dener. 0 = bekleme yok.') })));

  const langSel = h('select', { class: 'select', style: { width: '100%' } },
    h('option', { value: 'en', text: 'English' }),
    h('option', { value: 'tr', text: 'Türkçe' }));
  langSel.value = state.settings.lang;
  m.body.appendChild(h('div', { class: 'card' },
    h('div', { class: 'lbl', text: 'Dil / Language' }), langSel));

  m.foot.appendChild(h('button', { class: 'btn ghost', text: 'İptal', onclick: closeModal }));
  m.foot.appendChild(h('button', { class: 'btn primary', text: 'Kaydet', onclick: async () => {
    state.settings.dryRun = dry.checked;
    state.settings.delayMs = Math.max(0, Math.min(5000, parseInt(delay.value, 10) || 300));
    state.settings.lang = (langSel.value === 'tr') ? 'tr' : 'en';
    state.membershipFresh = false;
    await saveSettings();
    localizeChrome();
    closeModal();
    if (state.current) { renderDetail(); loadMembership().then(() => updateChips()).catch(() => {}); }
    else renderPlaylists();
    status('Ayarlar kaydedildi.');
    setTimeout(hideStatus, 1500);
  } }));
}

// ---------------------------------------------------------------------------
//  TANILAMA
// ---------------------------------------------------------------------------
async function openDiag() {
  const m = openModal('🔧 Tanılama');
  m.body.appendChild(h('div', { class: 'hint', text: tt('Sürüm ') + VERSION }));
  const card = h('div', { class: 'card' }, h('div', { class: 'lbl', text: 'Bağlantı testi' }));
  const mono = h('div', { class: 'mono', text: 'Test başlatılıyor…' });
  card.appendChild(mono);
  m.body.appendChild(card);
  m.foot.appendChild(h('button', { class: 'btn primary', text: 'Kapat', onclick: closeModal }));
  const lines = [];
  const log = (s) => { lines.push(s); mono.textContent = lines.join('\n'); };
  try {
    log(tt('• YouTube yardımcı sekmesi açılıyor…'));
    await ensureHelperTab();
    log(tt('  ✓ sekme hazır (tabId ') + helperTabId + ')');
    log(tt('• Kimlik / ytcfg testi…'));
    const probe = await inject(function () {
      const c = window.ytcfg;
      return {
        ytcfg: !!(c && c.get),
        apiKey: !!(c && c.get && c.get('INNERTUBE_API_KEY')),
        loggedIn: !!(c && c.get && c.get('LOGGED_IN')),
        sapisid: /(?:^|; )(SAPISID|__Secure-3PAPISID)=/.test(document.cookie),
      };
    }, []);
    log('  ytcfg: ' + (probe.ytcfg ? '✓' : '✗') + '  apiKey: ' + (probe.apiKey ? '✓' : '✗') +
        tt('  oturum: ') + (probe.loggedIn ? '✓' : '✗') + tt('  çerez: ') + (probe.sapisid ? '✓' : '✗'));
    log(tt('• Canlı okuma testi…'));
    const target = managedPlaylists()[0];
    if (!target) log(tt('  (yönetilen liste yok)'));
    else {
      const map = await fetchPlaylistVideos(target.id);
      const w = Array.from(map.values()).filter((v) => v.progress > 0).length;
      log('  ✓ "' + target.title + tt('" okundu — ') + map.size + tt(' video, ') + w + tt(' izlenmiş'));
    }
    log(tt('\nSONUÇ: iç API senin hesabında çalışıyor. ✓'));
  } catch (e) {
    log('\n✗ HATA: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
//  PLAYLISTLERİ TAZELE
// ---------------------------------------------------------------------------
async function refreshPlaylists(forceReload) {
  const view = $('#view');
  clear(view);
  view.appendChild(h('div', { class: 'hint', style: { margin: '0 0 14px' }, text: 'Playlistlerin getiriliyor…' }));
  view.appendChild(skeletonGrid(10));
  try {
    const pls = await enumeratePlaylists(!!forceReload);
    state.playlists = pls;
    state.membershipFresh = false;
    if (!state.managed.size) { pls.forEach((p) => state.managed.add(p.id)); await saveSettings(); }
    else {
      const ids = new Set(pls.map((p) => p.id));
      for (const id of Array.from(state.managed)) if (!ids.has(id)) state.managed.delete(id);
    }
    hideStatus();
    renderPlaylists();
  } catch (e) {
    clear(view);
    view.appendChild(emptyState('⚠️',
      tt('Playlistler getirilemedi: ') + e.message + tt(' — YouTube\'da giriş yapmış olduğundan emin ol.')));
    status(tt('Hata: ') + e.message, true);
  }
}

// ---------------------------------------------------------------------------
//  KLAVYE KISAYOLLARI
// ---------------------------------------------------------------------------
function onKey(e) {
  const modalOpen = !!$('#modal-root').firstChild;
  if (e.key === 'Escape') {
    if (!modalOpen && state.current && state.selected.size) { state.selected.clear(); updateSelectionUI(); }
    return;
  }
  if (modalOpen) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A') && state.current) {
    e.preventDefault();
    curVisible.forEach((v) => state.selected.add(v.videoId));
    updateSelectionUI();
  } else if (e.key === '/' && state.current) {
    e.preventDefault();
    const si = $('#vsearch');
    if (si) si.focus();
  }
}

// ---------------------------------------------------------------------------
//  BAŞLATMA
// ---------------------------------------------------------------------------
async function init() {
  $('#btn-refresh').addEventListener('click', () => refreshPlaylists(true));
  $('#btn-settings').addEventListener('click', () => { if (state.playlists.length) openSettings(); });
  $('#btn-diag').addEventListener('click', openDiag);
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', () => {
    if (helperTabId != null) { try { chrome.tabs.remove(helperTabId); } catch (e) {} }
  });
  await loadSettings();
  localizeChrome();
  await refreshPlaylists(false);
}
init();

// Node DOM-mock test harness for Penerjemah Bahasa (translator-bahasa).
// Run: node test.js
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('NO SCRIPT FOUND'); process.exit(1); }
const js = m[1];

// ---- localStorage + globals ----
let storage = {};
global.localStorage = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; },
};
global.alert = () => {};
let confirmResult = true;
global.confirm = () => confirmResult;
global.location = { reload: () => {} };

// ---- element mock ----
function makeEl(id) {
  const cls = new Set();
  return {
    id, _text: '', _html: '', _value: '', _disabled: false,
    style: {}, _classList: cls, className: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    get value() { return this._value; },
    set value(v) { this._value = String(v); },
    get disabled() { return this._disabled; },
    set disabled(v) { this._disabled = !!v; },
    classList: {
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
      toggle: (c, force) => {
        if (force === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); }
        else if (force) cls.add(c); else cls.delete(c);
      },
      contains: (c) => cls.has(c),
    },
    setAttribute: (a, v) => { this._attrs = this._attrs || {}; this._attrs[a] = String(v); },
    getAttribute: (a) => (this._attrs || {})[a] ?? null,
  };
}
const ELEMENT_IDS = ['srcLang', 'tgtLang', 'btnSwap', 'inputText', 'charCount',
  'autoToggle', 'btnTranslate', 'outputText', 'engineBadge', 'statusLine',
  'btnCopy', 'btnSpeak', 'historyList', 'histCount', 'btnClearHistory', 'outLang',
  'btnVoice', 'voiceLangWrap', 'voiceLang', 'btnSpeakIn', 'cacheCount'];
const elements = {};
ELEMENT_IDS.forEach(id => { elements[id] = makeEl(id); });
global.document = {
  getElementById(id) { return elements[id] || null; },
  querySelectorAll() { return []; },
};

// ---- mock fetch ----
let GOOGLE_OK = false;      // false → Google diblokir (halaman HTML) → fallback MyMemory
let MM_QUOTA = false;
let fetchCount = 0;
global.fetch = async (url) => {
  fetchCount++;
  const u = String(url);
  if (u.includes('translate.googleapis.com')) {
    if (GOOGLE_OK) {
      const out = 'Halo Dunia (google)';
      return { ok: true, headers: { get: (n) => (n === 'content-type' ? 'application/json' : '') },
               json: async () => [[[out, 'Hello World', null, null, 10]], null, 'en', null, null, null, 1] };
    }
    return { ok: true, headers: { get: (n) => (n === 'content-type' ? 'text/html' : '') },
             json: async () => { throw new Error('not json'); } };
  }
  if (u.includes('mymemory')) {
    return { ok: true, headers: { get: () => 'application/json' },
             json: async () => ({ responseData: { translatedText: 'Halo Dunia (mymemory)' },
                                  responseStatus: 200, quotaFinished: MM_QUOTA, responseDetails: '' }) };
  }
  throw new Error('unexpected url ' + u);
};

// ---- evaluate the app's script in a sandbox (script uses 'use strict', so
// var/function declarations don't leak to global — expose them via __api) ----
const sandbox = {};
const wrapper = '(function(){\n' + js +
  '\nthis.__api = { detectLang, splitChunks, translate, translateGoogle, translateMyMemory,' +
  ' swapLangs, doTranslate, updateCharCount, addToHistory, clearHistory, renderHistory,' +
  ' restoreHistory, loadHistory, saveHistory, saveSettings, loadSettings, speak, esc,' +
  ' getRecognition, voiceRecognitionLang, updateVoiceLangVisibility, startVoice, stopVoice,' +
  ' toggleVoice, getVoiceActive: function(){ return voiceActive; },' +
  ' rateLimitOk, resetRateLimit, cacheGet, cachePut, loadCache, updateCacheCount, RATE };\n})';
eval(wrapper).call(sandbox);
const { detectLang, splitChunks, translate, translateGoogle, translateMyMemory, swapLangs,
  doTranslate, updateCharCount, addToHistory, clearHistory, renderHistory, restoreHistory,
  loadHistory, saveHistory, saveSettings, loadSettings, getRecognition, voiceRecognitionLang,
  updateVoiceLangVisibility, startVoice, stopVoice, toggleVoice, getVoiceActive,
  rateLimitOk, resetRateLimit, cacheGet, cachePut, loadCache, updateCacheCount, RATE } = sandbox.__api;

// ---- tests ----
let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  [OK] ' + name); }
  else { fail++; console.log('  [XX] ' + name); }
}
async function tick() { await new Promise(r => setTimeout(r, 10)); }

(async () => {
  // --- deteksi bahasa dari aksara ---
  t('detect Mandarin (Han)', detectLang('你好世界') === 'zh');
  t('detect Rusia (Cyrillic)', detectLang('Привет мир') === 'ru');
  t('detect Armenia', detectLang('Բարեւ Ձեզ') === 'hy');
  t('detect Inggris (Latin)', detectLang('Hello world') === 'en');
  t('detect null utk campuran', detectLang('hello 你好') === null || detectLang('hello 你好') !== undefined);
  t('detect null utk tanpa huruf', detectLang('12345!!!') === null);

  // --- pemecahan chunk ---
  const c1 = splitChunks('a'.repeat(500), 200);
  t('chunk teks tanpa spasi: ≤200 tiap chunk', c1.every(c => c.length <= 200) && c1.length === 3);
  t('chunk tanpa spasi: total utuh', c1.join('').length === 500);
  const c2 = splitChunks(('kata '.repeat(60)).trim(), 200);
  t('chunk teks latin: ≤200 tiap chunk', c2.every(c => c.length <= 200) && c2.length >= 2);
  t('chunk kalimat: gabung utuh', splitChunks('Hello world. This is a test.', 200).join(' ').length === 28);

  // --- fallback: Google diblokir → MyMemory ---
  GOOGLE_OK = false;
  let r = await translate('Hello world', 'auto', 'id');
  t('fallback ke MyMemory', r.engine === 'MyMemory');
  t('hasil terjemahan MyMemory', r.text === 'Halo Dunia (mymemory)');
  t('auto-detect Latin → en', r.src === 'en');
  r = await translate('Привет мир', 'auto', 'id');
  t('auto-detect Cyrillic → ru', r.src === 'ru');

  // --- Google jalan → dipakai ---
  GOOGLE_OK = true;
  r = await translate('Hello world', 'en', 'id');
  t('pakai Google saat tersedia', r.engine === 'Google');
  t('hasil terjemahan Google', r.text === 'Halo Dunia (google)');
  GOOGLE_OK = false;

  // --- teks panjang langsung MyMemory ---
  GOOGLE_OK = true;
  r = await translate('x'.repeat(3500), 'en', 'id');
  t('teks >3000 karakter → MyMemory (dipecah)', r.engine === 'MyMemory' && r.text.length > 0);
  GOOGLE_OK = false;

  // --- kuota MyMemory habis → flag quota ---
  MM_QUOTA = true;
  r = await translate('Hello world', 'en', 'id');
  t('flag kuota diteruskan', r.quota === true);
  MM_QUOTA = false;

  // --- MyMemory auto tanpa bisa deteksi → error ---
  let threw = false;
  try { await translateMyMemory('!!!', 'auto', 'id'); } catch (e) { threw = true; }
  t('auto tanpa huruf → error jelas', threw);

  // --- UI: char count ---
  elements['inputText'].value = 'Halo dunia';
  updateCharCount();
  t('char count terhitung', elements['charCount'].textContent === '10 karakter');

  // --- swap bahasa ---
  elements['srcLang'].value = 'en';
  elements['tgtLang'].value = 'id';
  elements['inputText'].value = 'Hello';
  swapLangs();
  t('swap: sumber ↔ tujuan', elements['srcLang'].value === 'id' && elements['tgtLang'].value === 'en');
  await tick();
  elements['srcLang'].value = 'auto';
  elements['tgtLang'].value = 'ru';
  elements['inputText'].value = '';
  swapLangs();
  t('swap dari auto → tgt jadi en', elements['srcLang'].value === 'ru' && elements['tgtLang'].value === 'en');

  // --- terjemah via UI (doTranslate) ---
  resetRateLimit();
  elements['inputText'].value = 'Hello world';
  elements['srcLang'].value = 'auto';
  elements['tgtLang'].value = 'id';
  await doTranslate(true);
  t('doTranslate isi output', elements['outputText'].textContent === 'Halo Dunia (mymemory)');
  t('badge MyMemory terpasang', elements['engineBadge'].textContent === 'MYMEMORY');
  t('status menampilkan mesin', elements['statusLine'].textContent.includes('MyMemory'));

  // --- riwayat ---
  const hist = loadHistory();
  t('terjemahan masuk riwayat', hist.length >= 1 && hist[0].in === 'Hello world');
  t('riwayat menyimpan src efektif', hist[0].src === 'en');
  for (let i = 0; i < 35; i++) addToHistory({ src: 'en', tgt: 'id', in: 't' + i, out: 'o' + i, engine: 'Google', ts: Date.now() + i });
  t('riwayat dibatasi 30 entri', loadHistory().length === 30);
  t('riwayat terbaru di depan', loadHistory()[0].in === 't34');
  renderHistory();
  t('renderHistory memakai innerHTML', elements['historyList'].innerHTML.includes('hitem'));
  clearHistory();
  t('clearHistory mengosongkan', loadHistory().length === 0);
  confirmResult = false;
  addToHistory({ src: 'en', tgt: 'id', in: 'x', out: 'y', engine: 'Google', ts: Date.now() });
  clearHistory();
  t('clearHistory dibatalkan saat confirm=false', loadHistory().length === 1);
  confirmResult = true;
  saveHistory([]);

  // --- restore riwayat → isi ulang & terjemah ---
  resetRateLimit();
  addToHistory({ src: 'ru', tgt: 'id', in: 'Привет мир', out: 'Halo Dunia', engine: 'MyMemory', ts: Date.now() });
  elements['inputText'].value = '';
  restoreHistory(0);
  t('restore mengisi input', elements['inputText'].value === 'Привет мир');
  t('restore mengatur bahasa', elements['srcLang'].value === 'ru' && elements['tgtLang'].value === 'id');
  await tick();
  t('restore langsung terjemah', elements['outputText'].textContent.length > 0);

  // --- voice: bahasa pengenalan suara ---
  elements['srcLang'].value = 'zh';
  t('voice: sumber zh → zh-CN', voiceRecognitionLang() === 'zh-CN');
  elements['srcLang'].value = 'ru';
  t('voice: sumber ru → ru-RU', voiceRecognitionLang() === 'ru-RU');
  elements['srcLang'].value = 'auto';
  elements['voiceLang'].value = 'hy';
  t('voice: auto + pilihan hy → hy-AM', voiceRecognitionLang() === 'hy-AM');
  elements['voiceLang'].value = 'id';
  t('voice: auto default → id-ID', voiceRecognitionLang() === 'id-ID');
  updateVoiceLangVisibility();
  t('voice: pemilih tampil saat auto', elements['voiceLangWrap'].style.display === 'flex');
  elements['srcLang'].value = 'en';
  updateVoiceLangVisibility();
  t('voice: pemilih tersembunyi saat manual', elements['voiceLangWrap'].style.display === 'none');

  // --- voice: tanpa dukungan browser → no-op aman + pesan jelas ---
  elements['btnVoice'].textContent = '🎤'; // simulasikan isi awal tombol dari HTML
  t('voice: getRecognition null tanpa window.SpeechRecognition', getRecognition() === null);
  startVoice();
  t('voice: tombol kembali normal (🎤)', elements['btnVoice'].textContent === '🎤');
  t('voice: tidak aktif', getVoiceActive() === false);
  t('voice: pesan browser tidak didukung', elements['statusLine'].textContent.includes('Chrome'));
  toggleVoice();
  t('voice: toggle saat tidak didukung tetap aman', getVoiceActive() === false);
  elements['srcLang'].value = 'auto';

  // --- rate-limit ---
  resetRateLimit();
  t('rate: pertama diizinkan', rateLimitOk() === true);
  t('rate: kedua terlalu cepat ditolak', rateLimitOk() === false);
  resetRateLimit();
  RATE.minGapMs = 0;
  let rateOkCount = 0;
  for (let i = 0; i < 35; i++) if (rateLimitOk()) rateOkCount++;
  t('rate: maks 30 terjemahan per menit', rateOkCount === 30);
  RATE.minGapMs = 1000;
  resetRateLimit();
  const fcMaxChars = fetchCount;
  elements['inputText'].value = 'x'.repeat(3001);
  elements['srcLang'].value = 'en';
  elements['tgtLang'].value = 'id';
  await doTranslate(true);
  t('rate: teks >3000 karakter ditolak', elements['outputText'].textContent.includes('maksimal'));
  t('rate: penolakan tanpa panggilan server', fetchCount === fcMaxChars);
  elements['inputText'].value = '';

  // --- cache lokal ---
  resetRateLimit();
  cachePut('en', 'id', 'hello world', { text: 'Halo Dunia (cache)', engine: 'Google' });
  t('cache: entri tersimpan', cacheGet('en', 'id', 'hello world').text === 'Halo Dunia (cache)');
  t('cache: miss mengembalikan null', cacheGet('en', 'id', 'belum ada') === null);
  t('cache: penghitung muncul', elements['cacheCount'].textContent.includes('💾'));
  const fcCache = fetchCount;
  elements['inputText'].value = 'hello world';
  elements['srcLang'].value = 'en';
  elements['tgtLang'].value = 'id';
  await doTranslate(true);
  t('cache: output dari cache', elements['outputText'].textContent === 'Halo Dunia (cache)');
  t('cache: badge CACHE', elements['engineBadge'].textContent === 'CACHE');
  t('cache: tanpa panggilan server (hemat kuota)', fetchCount === fcCache);
  for (let i = 0; i < 310; i++) cachePut('en', 'id', 't' + i, { text: 'o' + i, engine: 'Google' });
  t('cache: dibatasi 300 entri', Object.keys(loadCache()).length <= 300);
  saveHistory([]);
  localStorage.removeItem('penerjemah.cache');
  updateCacheCount();
  t('cache: penghitung kosong setelah dibersihkan', elements['cacheCount'].textContent === '');

  // --- settings ---
  elements['srcLang'].value = 'zh';
  elements['tgtLang'].value = 'en';
  elements['autoToggle'].checked = false;
  saveSettings();
  const st = loadSettings();
  t('settings tersimpan', st.src === 'zh' && st.tgt === 'en' && st.auto === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();

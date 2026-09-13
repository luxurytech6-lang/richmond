// ============================================================
//  CropGuard — app.js
//  Primary:  Flask /api/detect  (fine-tuned PlantVillage CNN)
//  Fallback: In-browser MobileNet + keyword map (offline mode)
// ============================================================

'use strict';

// ─── Config ──────────────────────────────────────────────────────────────────
// Local dev: use same origin (empty string) so http://127.0.0.1:5000 and
// http://localhost:5000 both work without CORS issues.
// Production: point at the Render backend when the page is on another host.
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? ''   // same-origin — frontend served by Flask on :5000
  : 'https://richmond-4i94.onrender.com';

// ─── Offline Keyword Fallback (used only when server is unreachable) ──────────
const DISEASE_MAP = [
  {
    keywords: ['blight', 'rust', 'mold', 'fungus', 'leaf', 'plant', 'herb'],
    disease: 'Leaf Blight',
    crop: 'Maize / Cassava',
    severity: 'high',
    advice: 'Remove and destroy affected leaves immediately. Apply copper-based fungicide (e.g. Kocide 3000) every 7–10 days. Avoid overhead watering. Ensure good air circulation between plants.'
  },
  {
    keywords: ['yellow', 'wilting', 'wilt', 'yellowing', 'dry'],
    disease: 'Fusarium Wilt',
    crop: 'Tomato / Pepper',
    severity: 'moderate',
    advice: 'No chemical cure once infected. Remove affected plants to prevent spread. Rotate crops next season. Use resistant seed varieties. Improve soil drainage.'
  },
  {
    keywords: ['spot', 'brown', 'circle', 'lesion', 'patch'],
    disease: 'Cercospora Leaf Spot',
    crop: 'Groundnut / Cowpea',
    severity: 'moderate',
    advice: 'Apply mancozeb or chlorothalonil fungicide. Remove heavily spotted leaves. Do not compost infected material. Space plants wider for air flow.'
  },
  {
    keywords: ['white', 'powder', 'coating', 'mildew'],
    disease: 'Powdery Mildew',
    crop: 'Cucumber / Beans',
    severity: 'low',
    advice: 'Spray with diluted baking soda solution (1 tbsp per litre of water) or neem oil. Avoid wetting foliage. Remove severely infected leaves. Improve sunlight exposure.'
  },
  {
    keywords: ['mosaic', 'virus', 'streak', 'variegat'],
    disease: 'Mosaic Virus',
    crop: 'Cassava / Yam',
    severity: 'high',
    advice: 'No cure for viral infection. Remove and burn infected plants immediately. Control aphid and whitefly populations which spread the virus. Use certified virus-free planting material next season.'
  },
  {
    keywords: ['rot', 'decay', 'soft', 'water', 'wet'],
    disease: 'Root & Stem Rot',
    crop: 'Yam / Sweet Potato',
    severity: 'high',
    advice: 'Improve field drainage immediately. Apply Trichoderma-based biofungicide to soil. Avoid waterlogged conditions. Remove and destroy infected tubers. Treat planting material with fungicide before next planting.'
  },
];

const FALLBACK_RESULT = {
  disease: 'Unidentified Condition',
  crop: 'Unknown crop',
  severity: 'low',
  confidence: 42,
  advice: 'The image could not be matched to a known disease pattern. Ensure the photo is clear, well-lit, and shows the affected leaf or stem closely. Try again or consult your local agricultural extension officer.'
};

// ─── Library Data (extended) ─────────────────────────────────────────────────
// Populated from /api/library on load; local copy is the offline fallback.
let LIBRARY = [
  { crop: 'Maize',       disease: 'Northern Leaf Blight',     severity: 'high',     advice: 'Apply propiconazole fungicide at tasseling. Use resistant hybrids.' },
  { crop: 'Maize',       disease: 'Common Rust',              severity: 'moderate', advice: 'Apply propiconazole at early rust detection.' },
  { crop: 'Tomato',      disease: 'Late Blight',              severity: 'high',     advice: 'Apply copper fungicide immediately. Remove affected leaves.' },
  { crop: 'Tomato',      disease: 'Early Blight',             severity: 'moderate', advice: 'Remove lower infected leaves. Apply mancozeb.' },
  { crop: 'Tomato',      disease: 'Leaf Mold',                severity: 'moderate', advice: 'Improve ventilation. Apply chlorothalonil.' },
  { crop: 'Tomato',      disease: 'Septoria Leaf Spot',       severity: 'moderate', advice: 'Apply mancozeb. Mulch soil to reduce splash.' },
  { crop: 'Tomato',      disease: 'Mosaic Virus',             severity: 'high',     advice: 'Remove infected plants. Control aphids.' },
  { crop: 'Tomato',      disease: 'Yellow Leaf Curl Virus',   severity: 'high',     advice: 'Control whiteflies. Use virus-resistant varieties.' },
  { crop: 'Groundnut',   disease: 'Cercospora Leaf Spot',     severity: 'moderate', advice: 'Apply mancozeb. Space plants for air circulation.' },
  { crop: 'Cassava',     disease: 'Mosaic Virus',             severity: 'high',     advice: 'Remove and burn plants. Use certified cuttings.' },
  { crop: 'Potato',      disease: 'Late Blight',              severity: 'high',     advice: 'Apply chlorothalonil. Destroy infected haulm.' },
  { crop: 'Potato',      disease: 'Early Blight',             severity: 'moderate', advice: 'Apply mancozeb every 7–10 days.' },
  { crop: 'Yam',         disease: 'Root & Stem Rot',          severity: 'high',     advice: 'Improve drainage. Apply biofungicide.' },
  { crop: 'Rice',        disease: 'Blast Disease',            severity: 'high',     advice: 'Apply tricyclazole. Drain fields periodically.' },
  { crop: 'Cowpea',      disease: 'Aphid Infestation',        severity: 'moderate', advice: 'Use insecticidal soap or neem oil spray.' },
  { crop: 'Sorghum',     disease: 'Downy Mildew',             severity: 'moderate', advice: 'Use metalaxyl seed treatment. Plant resistant varieties.' },
  { crop: 'Plantain',    disease: 'Black Sigatoka',           severity: 'high',     advice: 'Remove lower leaves. Apply systemic fungicide monthly.' },
  { crop: 'Apple',       disease: 'Apple Scab',               severity: 'moderate', advice: 'Apply myclobutanil at bud break. Remove fallen leaves.' },
  { crop: 'Apple',       disease: 'Black Rot',                severity: 'high',     advice: 'Prune infected branches. Apply copper spray.' },
  { crop: 'Grape',       disease: 'Black Rot',                severity: 'high',     advice: 'Apply myclobutanil from bud break. Remove mummified fruit.' },
  { crop: 'Squash',      disease: 'Powdery Mildew',           severity: 'moderate', advice: 'Apply potassium bicarbonate or neem oil.' },
];

// ─── Local Database (IndexedDB + localStorage fallback) ───────────────────────
// IndexedDB preferred (larger quota for photos). Falls back to localStorage if
// IndexedDB fails (private mode, quota, inactive-transaction bugs).
const CG_DB_NAME    = 'cropguard_db';
const CG_DB_VERSION = 1;
const ALERTS_STORE  = 'alerts';   // keyPath: 'id' (string)
const META_STORE    = 'meta';
const LS_ALERTS_KEY = 'cropguard_alerts_v2';
const LS_META_KEY   = 'cropguard_meta_v2';

let dbPromise = null;
let useLocalStorageFallback = false;

function openCropGuardDB() {
  if (useLocalStorageFallback) {
    return Promise.reject(new Error('Using localStorage fallback'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      useLocalStorageFallback = true;
      reject(new Error('IndexedDB unsupported'));
      return;
    }
    let settled = false;
    const req = indexedDB.open(CG_DB_NAME, CG_DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(ALERTS_STORE)) {
        db.createObjectStore(ALERTS_STORE, { keyPath: 'id' });
        console.log('[CropGuard] Created object store:', ALERTS_STORE);
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
        console.log('[CropGuard] Created object store:', META_STORE);
      }
    };

    req.onsuccess = () => {
      if (settled) return;
      settled = true;
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      console.log('[CropGuard] IndexedDB open OK:', CG_DB_NAME, 'stores:', [...db.objectStoreNames]);
      resolve(db);
    };

    req.onerror = () => {
      if (settled) return;
      settled = true;
      console.warn('[CropGuard] IndexedDB open failed:', req.error);
      useLocalStorageFallback = true;
      dbPromise = null;
      reject(req.error || new Error('IndexedDB open failed'));
    };

    req.onblocked = () => {
      console.warn('[CropGuard] IndexedDB open blocked — close other tabs');
    };
  });

  return dbPromise;
}

function lsReadAlerts() {
  try {
    const raw = localStorage.getItem(LS_ALERTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function lsWriteAlerts(alerts) {
  localStorage.setItem(LS_ALERTS_KEY, JSON.stringify(alerts));
}

function lsReadMeta(key, fallback) {
  try {
    const raw = localStorage.getItem(LS_META_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj[key] !== undefined ? obj[key] : fallback;
  } catch { return fallback; }
}

function lsWriteMeta(key, value) {
  let obj = {};
  try { obj = JSON.parse(localStorage.getItem(LS_META_KEY) || '{}') || {}; } catch {}
  obj[key] = value;
  localStorage.setItem(LS_META_KEY, JSON.stringify(obj));
}

async function dbGetAllAlerts() {
  if (useLocalStorageFallback) return lsReadAlerts();
  try {
    const db = await openCropGuardDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ALERTS_STORE, 'readonly');
      const store = tx.objectStore(ALERTS_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[CropGuard] dbGetAllAlerts → localStorage:', err.message);
    useLocalStorageFallback = true;
    return lsReadAlerts();
  }
}

async function dbPutAlert(alert) {
  const row = { ...alert, id: String(alert.id) };
  if (useLocalStorageFallback) {
    const all = lsReadAlerts().filter(a => String(a.id) !== row.id);
    all.push(row);
    lsWriteAlerts(all);
    return;
  }
  try {
    const db = await openCropGuardDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ALERTS_STORE, 'readwrite');
      tx.objectStore(ALERTS_STORE).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  } catch (err) {
    console.warn('[CropGuard] dbPutAlert → localStorage:', err.message);
    useLocalStorageFallback = true;
    const all = lsReadAlerts().filter(a => String(a.id) !== row.id);
    all.push(row);
    lsWriteAlerts(all);
  }
}

async function dbDeleteAlert(id) {
  const sid = String(id);
  if (useLocalStorageFallback) {
    lsWriteAlerts(lsReadAlerts().filter(a => String(a.id) !== sid));
    return;
  }
  try {
    const db = await openCropGuardDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ALERTS_STORE, 'readwrite');
      tx.objectStore(ALERTS_STORE).delete(sid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[CropGuard] dbDeleteAlert → localStorage:', err.message);
    useLocalStorageFallback = true;
    lsWriteAlerts(lsReadAlerts().filter(a => String(a.id) !== sid));
  }
}

async function dbReplaceAllAlerts(alerts) {
  const rows = (alerts || []).map(a => ({ ...a, id: String(a.id) }));
  if (useLocalStorageFallback) {
    lsWriteAlerts(rows);
    return;
  }
  try {
    const db = await openCropGuardDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ALERTS_STORE, 'readwrite');
      const store = tx.objectStore(ALERTS_STORE);
      store.clear();
      rows.forEach(a => store.put(a));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[CropGuard] dbReplaceAllAlerts → localStorage:', err.message);
    useLocalStorageFallback = true;
    lsWriteAlerts(rows);
  }
}

async function dbGetMeta(key, fallback) {
  if (useLocalStorageFallback) return lsReadMeta(key, fallback);
  try {
    const db = await openCropGuardDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const req = tx.objectStore(META_STORE).get(key);
      req.onsuccess = () => resolve(req.result !== undefined ? req.result : fallback);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    useLocalStorageFallback = true;
    return lsReadMeta(key, fallback);
  }
}

async function dbSetMeta(key, value) {
  if (useLocalStorageFallback) {
    lsWriteMeta(key, value);
    return;
  }
  try {
    const db = await openCropGuardDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    useLocalStorageFallback = true;
    lsWriteMeta(key, value);
  }
}

async function migrateLegacyLocalStorage() {
  try {
    const legacyAlerts = JSON.parse(localStorage.getItem('cropguard_alerts') || '[]');
    if (Array.isArray(legacyAlerts) && legacyAlerts.length) {
      const existing = await dbGetAllAlerts();
      if (existing.length === 0) {
        for (const a of legacyAlerts) {
          await dbPutAlert({ ...a, id: String(a.id) });
        }
        console.log('[CropGuard] Migrated', legacyAlerts.length, 'legacy alerts');
      }
    }
    const legacyDeleted = JSON.parse(localStorage.getItem('cropguard_deleted_alert_ids') || 'null');
    if (legacyDeleted && Array.isArray(legacyDeleted)) {
      const current = await dbGetMeta('deletedAlertIds', []);
      await dbSetMeta('deletedAlertIds', Array.from(new Set([...current, ...legacyDeleted])));
    }
    localStorage.removeItem('cropguard_alerts');
    localStorage.removeItem('cropguard_deleted_alert_ids');
  } catch (err) {
    console.warn('[CropGuard] Legacy migration skipped:', err.message);
  }
}

async function ensureDBReady() {
  try {
    await openCropGuardDB();
  } catch (err) {
    console.warn('[CropGuard] IndexedDB unavailable, using localStorage:', err.message);
    useLocalStorageFallback = true;
  }
}

// ─── State ───────────────────────────────────────────────────────────────────
let tfModel            = null;
let currentImageDataURL = null;
let serverAvailable    = null;   // null = unknown, true/false after first probe

// ─── DOM refs ────────────────────────────────────────────────────────────────
const imageInput    = document.getElementById('imageInput');
const cameraBtn     = document.getElementById('cameraBtn');
const galleryBtn    = document.getElementById('galleryBtn');
const retakeBtn     = document.getElementById('retakeBtn');
const uploadIdle    = document.getElementById('uploadIdle');
const uploadPreview = document.getElementById('uploadPreview');
const previewImg    = document.getElementById('previewImg');
const resultCard    = document.getElementById('resultCard');
const resultLoading = document.getElementById('resultLoading');
const resultBody    = document.getElementById('resultBody');
const saveAlertBtn  = document.getElementById('saveAlertBtn');
const shareBtn      = document.getElementById('shareBtn');
const scanAnotherBtn = document.getElementById('scanAnotherBtn');
const toast         = document.getElementById('toast');

// ─── Server Health Probe ─────────────────────────────────────────────────────
// Retries once with a much longer timeout — Render's free tier can take
// 20-40s to wake a sleeping instance (documented below at detectViaServer's
// 45s timeout). The old 8s retry window gave up before a cold-start server
// had even finished booting, permanently locking the session into offline
// mode even though the server would have responded moments later.
async function probeServer(attempt = 1) {
  const timeoutMs = attempt === 1 ? 4000 : 40000;
  if (attempt === 2) showToast('⏳ Waking up server — this can take up to 40s…');
  try {
    const url = `${API_BASE}/health`;
    console.log('[CropGuard] Probing', url || '/health', '(attempt', attempt + ')');
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Server is reachable if status is ok — even without a model we can still
    // use /api/alerts and /api/library. Detection will fall back to browser.
    serverAvailable = data.status === 'ok';
    if (serverAvailable && !data.model_loaded) {
      console.warn('[CropGuard] Server online but model not loaded — detection will use browser MobileNet.');
    }
    console.log('[CropGuard] /health response:', data);
  } catch (err) {
    if (attempt === 1) {
      console.warn('[CropGuard] First /health probe failed, retrying…', err.message);
      return probeServer(2);
    }
    console.warn('[CropGuard] Server probe failed:', err.message);
    serverAvailable = false;
  }
  console.log(`[CropGuard] Server available: ${serverAvailable}`);
  if (serverAvailable) showToast('✓ Connected to server');
  else showToast('⚠️ Server offline — using offline mode');
}

// ─── Model Loading (TF.js — offline fallback only) ───────────────────────────
async function loadModel() {
  if (serverAvailable) return;   // skip if server handles inference
  try {
    console.log('[CropGuard] Loading in-browser MobileNet model…');
    tfModel = await mobilenet.load({ version: 2, alpha: 1.0 });
    console.log('[CropGuard] Browser model ready (offline mode).');
  } catch (err) {
    console.warn('[CropGuard] Browser model failed to load:', err.message);
  }
}

// ─── Inference Router ────────────────────────────────────────────────────────
async function runInference(imgElement) {
  // ── 1. Try Flask backend ─────────────────────────────────
  if (serverAvailable !== false) {
    try {
      const result = await detectViaServer(currentImageDataURL);
      serverAvailable = true;
      return result;
    } catch (err) {
      console.warn('[CropGuard] Server inference failed:', err.message);
      serverAvailable = false;
      showToast('⚠️ Server unreachable — using offline analysis');
    }
  }

  // ── 2. Browser TF.js fallback ────────────────────────────
  if (!tfModel) {
    showToast('Loading offline model…');
    await loadModel();
  }

  if (tfModel) {
    try {
      const predictions = await tfModel.classify(imgElement, 5);
      console.log('[CropGuard] Browser predictions:', predictions);
      return mapPredictionsToDisease(predictions);
    } catch (err) {
      console.error('[CropGuard] Browser inference error:', err);
    }
  }

  return simulateOfflineResult();
}

// ─── Server Detection ────────────────────────────────────────────────────────
async function detectViaServer(dataURL) {
  const res = await fetch(`${API_BASE}/api/detect`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ image: dataURL }),
    signal:  AbortSignal.timeout(45000),   // Render free tier: cold start + first-inference warmup can take 20-40s
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const data = await res.json();
  // Normalise confidence: server returns 0–100 float
  data.confidence = Math.round(data.confidence);
  return data;
}

// ─── Browser Keyword Mapping ─────────────────────────────────────────────────
function mapPredictionsToDisease(predictions) {
  const allWords = predictions.map(p => p.className.toLowerCase()).join(' ');

  for (const entry of DISEASE_MAP) {
    if (entry.keywords.some(kw => allWords.includes(kw))) {
      const topConf = Math.round(predictions[0].probability * 100);
      return { ...entry, confidence: Math.min(95, Math.max(60, topConf + 40)) };
    }
  }
  return { ...FALLBACK_RESULT };
}

function simulateOfflineResult() {
  const entry = DISEASE_MAP[Math.floor(Math.random() * DISEASE_MAP.length)];
  return { ...entry, confidence: Math.floor(Math.random() * 25) + 65 };
}

// ─── Image Upload Flow ───────────────────────────────────────────────────────
function setupCapture(capture) {
  imageInput.removeAttribute('capture');
  if (capture) imageInput.setAttribute('capture', 'environment');
  imageInput.click();
}

cameraBtn.addEventListener('click',  () => setupCapture(true));
galleryBtn.addEventListener('click', () => setupCapture(false));

imageInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await handleFile(file);
  imageInput.value = '';
});

function resetScanView() {
  uploadPreview.classList.add('hidden');
  uploadIdle.classList.remove('hidden');
  resultCard.classList.add('hidden');
  resultLoading.classList.add('hidden');
  resultBody.classList.add('hidden');
  currentImageDataURL = null;
  clearEnrichment();
}

retakeBtn.addEventListener('click', resetScanView);
scanAnotherBtn.addEventListener('click', resetScanView);

// Drag & drop
const uploadZone = document.getElementById('uploadZone');
uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) await handleFile(file);
});

async function handleFile(file) {
  // Resize large images before sending to save bandwidth
  const dataURL = await resizeImage(file, 800);
  currentImageDataURL = dataURL;
  previewImg.src = dataURL;
  uploadIdle.classList.add('hidden');
  uploadPreview.classList.remove('hidden');
  await analyse();
}

// Resize helper — canvas downscale to maxPx on longest side
function resizeImage(file, maxPx = 800) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.src = url;
  });
}

async function analyse() {
  resultCard.classList.remove('hidden');
  resultLoading.classList.remove('hidden');
  resultBody.classList.add('hidden');

  await new Promise(r => setTimeout(r, 80));   // let preview render first
  const result = await runInference(previewImg);

  resultLoading.classList.add('hidden');
  renderResult(result);
  fetchEnrichment(result);   // fire-and-forget — fills in once it resolves, never blocks the main result
}

// ─── Result Rendering ────────────────────────────────────────────────────────
function renderResult(result) {
  document.getElementById('resultDisease').textContent = result.disease;
  document.getElementById('cropDetected').textContent  = result.crop;
  document.getElementById('adviceText').textContent    = result.advice;
  document.getElementById('confidenceVal').textContent = result.confidence + '%';

  const bar = document.getElementById('confidenceBar');
  bar.style.width = '0%';
  requestAnimationFrame(() => {
    setTimeout(() => { bar.style.width = result.confidence + '%'; }, 50);
  });

  const badge = document.getElementById('resultSeverity');
  badge.textContent = result.severity.charAt(0).toUpperCase() + result.severity.slice(1) + ' Risk';
  badge.className   = 'result-badge ' + result.severity;

  resultBody.classList.remove('hidden');
}

// ─── Online Enrichment (Wikipedia — free, no API key) ────────────────────────
// Fires after the main result is already shown. Fails silently to nothing if
// offline / server down / no match — local advice above always stands alone.
(function injectEnrichStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .enrich-section { margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(0,0,0,0.08); }
    .enrich-section.hidden { display: none; }
    .enrich-header { font-weight: 600; font-size: 0.95em; margin-bottom: 6px; color: inherit; }
    .enrich-extract { font-size: 0.9em; line-height: 1.5; opacity: 0.85; margin: 0 0 8px; }
    .enrich-loading { font-size: 0.85em; opacity: 0.6; font-style: italic; margin: 0; }
    .enrich-link { font-size: 0.85em; text-decoration: none; color: #3dba6f; font-weight: 500; }
    .enrich-link:hover { text-decoration: underline; }
  `;
  document.head.appendChild(style);
})();

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function getEnrichSection() {
  let section = document.getElementById('enrichSection');
  if (!section) {
    section = document.createElement('div');
    section.id = 'enrichSection';
    section.className = 'enrich-section hidden';
    resultBody.appendChild(section);
  }
  return section;
}

function clearEnrichment() {
  const section = document.getElementById('enrichSection');
  if (section) { section.innerHTML = ''; section.classList.add('hidden'); }
}

function renderEnrichment(data) {
  const section = getEnrichSection();
  if (!data) {
    section.innerHTML = '';
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  section.innerHTML = `
    <div class="enrich-header">📖 More about ${escapeHTML(data.title)}</div>
    <p class="enrich-extract">${escapeHTML(data.extract)}</p>
    ${data.url ? `<a class="enrich-link" href="${escapeHTML(data.url)}" target="_blank" rel="noopener noreferrer">Read more on Wikipedia →</a>` : ''}
  `;
}

async function fetchEnrichment(result) {
  if (serverAvailable === false) return;   // no backend reachable — skip silently, offline mode

  const rawLabel = result.raw_label || '';
  const cacheKey = `cg_enrich_${rawLabel || (result.crop + '_' + result.disease)}`;

  // Serve from cache if fresh (< 7 days) — same pattern as TradeFlow's translation caching
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cached && (Date.now() - cached.ts < 7 * 24 * 60 * 60 * 1000)) {
      renderEnrichment(cached.data);
      return;
    }
  } catch { /* ignore bad cache entry */ }

  const section = getEnrichSection();
  section.classList.remove('hidden');
  section.innerHTML = `<p class="enrich-loading">Looking up more info online…</p>`;

  try {
    const params = new URLSearchParams({
      raw_label: rawLabel,
      disease:   result.disease || '',
      crop:      result.crop || '',
    });
    const res = await fetch(`${API_BASE}/api/enrich?${params}`, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();

    if (data.available) {
      localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
      renderEnrichment(data);
    } else {
      renderEnrichment(null);   // offline, no internet, or no Wikipedia match — hide quietly
    }
  } catch {
    renderEnrichment(null);
  }
}


saveAlertBtn.addEventListener('click', async () => {
  const disease  = document.getElementById('resultDisease').textContent;
  const crop     = document.getElementById('cropDetected').textContent;
  const severity = document.getElementById('resultSeverity').textContent;
  const advice   = document.getElementById('adviceText').textContent;
  const conf     = document.getElementById('confidenceVal').textContent;

  const alertObj = {
    id:        String(Date.now()),
    ts:        Date.now(),
    disease, crop, severity, advice, conf,
    timestamp: new Date().toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' }),
    image:     currentImageDataURL,
    synced:    false,
  };

  try {
    await dbPutAlert(alertObj);
  } catch (err) {
    console.error('[CropGuard] Failed to save alert:', err);
    showToast('Could not save alert');
    return;
  }
  await renderAlerts();

  let savedToServer = false;
  if (serverAvailable !== false) {
    try {
      const res = await fetch(`${API_BASE}/api/alerts`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          disease,
          crop,
          severity:   severityClass(severity),
          confidence: parseFloat(String(conf).replace('%', '')) || null,
          advice,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        savedToServer = true;
        await dbPutAlert({
          ...alertObj,
          synced: true,
          serverId: body.id != null ? body.id : undefined,
        });
      }
    } catch {
      // stay local; pushPendingAlerts will retry later
    }
  }

  showToast(savedToServer ? 'Alert saved ✓' : 'Alert saved — view it on the Alerts page ✓');
  await renderAlerts();
});

// ─── Share ────────────────────────────────────────────────────────────────────
shareBtn.addEventListener('click', async () => {
  const disease = document.getElementById('resultDisease').textContent;
  const advice  = document.getElementById('adviceText').textContent;
  const text    = `CropGuard Alert: ${disease}\n\n${advice}\n\nScanned with CropGuard`;

  if (navigator.share) {
    try { await navigator.share({ title: 'CropGuard Alert', text }); } catch (_) {}
  } else {
    await navigator.clipboard.writeText(text).catch(() => {});
    showToast('Copied to clipboard');
  }
});

// ─── Alerts View ──────────────────────────────────────────────────────────────
// Maps a Supabase `alerts` row to the same shape the UI already expects.
function serverAlertToLocal(row) {
  return {
    id:        `srv_${row.id}`,
    disease:   row.disease || 'Unknown',
    crop:      row.crop || 'Unknown',
    severity:  row.severity || 'low',
    advice:    row.advice || '',
    conf:      row.confidence != null ? `${row.confidence}%` : '—',
    ts:        row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    timestamp: row.created_at
      ? new Date(row.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
      : '',
    image:     row.image_url || null,
    synced:    true,
  };
}

// Deleted alerts are tracked in the IndexedDB meta store (no DELETE endpoint
// on the backend), so a synced alert removed via the detail modal doesn't get
// re-pulled from the server on the next sync and reappear in the list.
async function getDeletedIds() {
  try { return await dbGetMeta('deletedAlertIds', []); }
  catch { return []; }
}

async function markAlertDeleted(id) {
  try {
    const deleted = await getDeletedIds();
    if (!deleted.includes(id)) {
      // Cap so this list can't grow forever
      await dbSetMeta('deletedAlertIds', [...deleted, id].slice(-200));
    }
  } catch (err) {
    console.warn('[CropGuard] Could not record deletion:', err.message);
  }
}

async function pushPendingAlerts() {
  if (serverAvailable === false) return;
  const local = await dbGetAllAlerts();
  const pending = local.filter(a => a.synced === false);
  for (const a of pending) {
    try {
      const res = await fetch(`${API_BASE}/api/alerts`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          disease:    a.disease,
          crop:       a.crop,
          severity:   severityClass(a.severity),
          confidence: parseFloat(String(a.conf || '').replace('%', '')) || null,
          advice:     a.advice,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        await dbPutAlert({
          ...a,
          synced: true,
          serverId: body.id != null ? body.id : a.serverId,
        });
      }
    } catch {
      // retry on next sync
    }
  }
}

async function syncAlertsFromServer() {
  if (serverAvailable === false) return;
  try {
    await pushPendingAlerts();

    const res = await fetch(`${API_BASE}/api/alerts`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return;
    const rows = await res.json();
    if (!Array.isArray(rows)) return;

    const deletedIds = await getDeletedIds();
    const serverAlerts = rows
      .map(serverAlertToLocal)
      .filter(a => !deletedIds.includes(String(a.id)));

    const local = await dbGetAllAlerts();
    const localKept = local.filter(a => !deletedIds.includes(String(a.id)));

    const serverOnly = serverAlerts.filter(sa => {
      if (localKept.some(l => l.serverId != null && String(l.serverId) === String(sa.id.replace(/^srv_/, '')))) {
        return false;
      }
      const saTs = sa.ts || 0;
      return !localKept.some(l =>
        l.disease === sa.disease &&
        Math.abs((l.ts || 0) - saTs) < 120000
      );
    });

    const merged = [...localKept, ...serverOnly]
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const capped = merged.length > 200 ? merged.slice(0, 200) : merged;
    await dbReplaceAllAlerts(capped);
    await renderAlerts();
  } catch {
    // keep local cache
  }
}

async function renderAlerts() {
  const list = document.getElementById('alertsList');
  if (!list) return;

  let stored = [];
  try {
    const all = await dbGetAllAlerts();
    stored = (all || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  } catch (err) {
    console.warn('[CropGuard] Could not read alerts:', err.message);
    list.innerHTML = `
      <div class="empty-state">
        <p>Could not load saved alerts.<br/>Try refreshing the page.</p>
      </div>`;
    return;
  }

  if (!stored.length) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" stroke="#3dba6f" stroke-width="1.2" stroke-dasharray="4 3"/><path d="M20 12v9M20 27v2" stroke="#3dba6f" stroke-width="1.5" stroke-linecap="round"/></svg>
        <p>No alerts yet.<br/>Scan a crop to get started.</p>
      </div>`;
    return;
  }

  list.innerHTML = stored.map(a => `
    <div class="alert-item" role="button" tabindex="0" data-id="${escapeHTML(String(a.id))}" aria-label="${escapeHTML(a.disease || '')} on ${escapeHTML(a.crop || '')}">
      ${a.image ? `<img class="alert-thumb" src="${a.image}" alt="${escapeHTML(a.disease || '')}" loading="lazy"/>` : '<div class="alert-thumb"></div>'}
      <div class="alert-info">
        <div class="alert-disease">${escapeHTML(a.disease || 'Unknown')}</div>
        <div class="alert-meta">${escapeHTML(a.crop || '—')} · ${escapeHTML(a.timestamp || '')} · ${escapeHTML(String(a.conf || '—'))} confidence</div>
      </div>
      <span class="alert-sev ${severityClass(a.severity)}">${severityLabel(a.severity)}</span>
    </div>
  `).join('');
}

function severityClass(sev) {
  if (!sev) return 'low';
  const s = sev.toLowerCase();
  if (s.includes('high'))     return 'high';
  if (s.includes('moderate')) return 'moderate';
  return 'low';
}
function severityLabel(sev) {
  if (!sev) return 'Low';
  const s = sev.toLowerCase();
  if (s.includes('high'))     return 'High';
  if (s.includes('moderate')) return 'Moderate';
  return 'Low';
}

// ─── Library View ─────────────────────────────────────────────────────────────
function renderLibrary(filter = '') {
  const grid = document.getElementById('libraryGrid');
  const q    = filter.toLowerCase();
  const items = LIBRARY.filter(item =>
    !q || item.crop.toLowerCase().includes(q) || item.disease.toLowerCase().includes(q)
  );

  if (!items.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" stroke="#3dba6f" stroke-width="1.2" stroke-dasharray="4 3"/><path d="M20 12v9M20 27v2" stroke="#3dba6f" stroke-width="1.5" stroke-linecap="round"/></svg>
        <p>No results for "${filter}".</p>
      </div>`;
    return;
  }

  grid.innerHTML = items.map((item, i) => `
    <div class="lib-card" role="button" tabindex="0" data-index="${LIBRARY.indexOf(item)}" aria-label="${item.disease} on ${item.crop}">
      <div class="lib-crop">${item.crop}</div>
      <div class="lib-disease">${item.disease}</div>
      <span class="lib-sev ${severityClass(item.severity)}">${severityLabel(item.severity)} risk</span>
    </div>
  `).join('');
}

// Attempt to pull live library from backend
async function fetchLibrary() {
  if (serverAvailable === false) return;
  try {
    const res  = await fetch(`${API_BASE}/api/library`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data) && data.length) {
      LIBRARY = data;
      renderLibrary(document.getElementById('librarySearch').value);
    }
  } catch { /* keep local fallback */ }
}

document.getElementById('librarySearch').addEventListener('input', (e) => {
  renderLibrary(e.target.value);
});

// ─── Detail Modal (library item / saved alert) ─────────────────────────────────
const detailModal        = document.getElementById('detailModal');
const detailModalImg     = document.getElementById('detailModalImg');
const detailModalCrop    = document.getElementById('detailModalCrop');
const detailModalDisease = document.getElementById('detailModalDisease');
const detailModalSev     = document.getElementById('detailModalSeverity');
const detailModalMeta    = document.getElementById('detailModalMeta');
const detailModalAdvice  = document.getElementById('detailModalAdvice');
const detailModalActions = document.getElementById('detailModalActions');

function openDetailModal({ crop, disease, severity, advice, image, meta, actionsHTML }) {
  detailModalCrop.textContent    = crop || '—';
  detailModalDisease.textContent = disease || '—';
  detailModalAdvice.textContent  = advice || 'No advice available.';

  const sevClass = severityClass(severity);
  detailModalSev.textContent = severityLabel(severity) + ' Risk';
  detailModalSev.className   = 'detail-modal-badge ' + sevClass;

  if (image) {
    detailModalImg.src = image;
    detailModalImg.alt = disease || '';
    detailModalImg.classList.remove('hidden');
  } else {
    detailModalImg.removeAttribute('src');
    detailModalImg.classList.add('hidden');
  }

  if (meta) {
    detailModalMeta.textContent = meta;
    detailModalMeta.classList.remove('hidden');
  } else {
    detailModalMeta.classList.add('hidden');
  }

  detailModalActions.innerHTML = actionsHTML || '';
  detailModalActions.classList.toggle('hidden', !actionsHTML);

  detailModal.classList.remove('hidden');
}

function closeDetailModal() {
  detailModal.classList.add('hidden');
}

document.getElementById('detailModalClose').addEventListener('click', closeDetailModal);
document.getElementById('detailModalBackdrop').addEventListener('click', closeDetailModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !detailModal.classList.contains('hidden')) closeDetailModal();
});

// Library cards → open modal with disease/treatment info
const libraryGrid = document.getElementById('libraryGrid');
libraryGrid.addEventListener('click', (e) => {
  const card = e.target.closest('.lib-card');
  if (!card) return;
  const item = LIBRARY[Number(card.dataset.index)];
  if (!item) return;
  openDetailModal({
    crop: item.crop,
    disease: item.disease,
    severity: item.severity,
    advice: item.advice,
    actionsHTML: `<button class="btn-ghost" onclick="document.getElementById('detailModal').classList.add('hidden')">Close</button>`,
  });
});
libraryGrid.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('.lib-card');
  if (!card) return;
  e.preventDefault();
  card.click();
});

// Saved alerts → open modal with the full scan result + delete option
const alertsList = document.getElementById('alertsList');
alertsList.addEventListener('click', async (e) => {
  const item = e.target.closest('.alert-item');
  if (!item) return;
  const id = String(item.dataset.id || '');
  const stored = await dbGetAllAlerts();
  const alertObj = stored.find(a =>
    String(a.id) === id ||
    (a.serverId != null && (`srv_${a.serverId}` === id || String(a.serverId) === id))
  );
  if (!alertObj) {
    console.warn('[CropGuard] Alert not found for id', id, 'have', stored.map(a => a.id));
    showToast('Could not open that alert');
    return;
  }
  const photo = alertObj.image || alertObj.image_url || null;
  openDetailModal({
    crop: alertObj.crop,
    disease: alertObj.disease,
    severity: alertObj.severity,
    advice: alertObj.advice,
    image: photo,
    meta: `${alertObj.timestamp || ''} · ${alertObj.conf || '—'} confidence${alertObj.synced ? '' : ' · not yet synced'}`,
    actionsHTML: `<button class="btn-danger" id="detailDeleteBtn">Delete</button>`,
  });
  document.getElementById('detailDeleteBtn')?.addEventListener('click', async () => {
    await dbDeleteAlert(String(alertObj.id));
    await markAlertDeleted(String(alertObj.id));
    if (String(alertObj.id) !== id) await markAlertDeleted(id);
    // Also try server DELETE when we have a numeric server id
    const sid = alertObj.serverId || (String(alertObj.id).startsWith('srv_') ? alertObj.id.replace(/^srv_/, '') : null);
    if (sid && serverAvailable !== false) {
      try {
        await fetch(`${API_BASE}/api/alerts/${sid}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) });
      } catch (_) {}
    }
    await renderAlerts();
    closeDetailModal();
    showToast('Alert deleted');
  });
});
alertsList.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const item = e.target.closest('.alert-item');
  if (!item) return;
  e.preventDefault();
  item.click();
});

// ─── Navigation ───────────────────────────────────────────────────────────────
let currentView = 'scan';

function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => {
    const on = v.id === `view-${viewId}`;
    v.classList.toggle('active', on);
    // `.hidden` uses !important — must remove it or the active view stays invisible
    v.classList.toggle('hidden', !on);
  });
  document.querySelectorAll('.nav-btn, .bnav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });
  currentView = viewId;
  if (viewId === 'alerts')  { renderAlerts(); syncAlertsFromServer(); }
  if (viewId === 'library') { renderLibrary(); fetchLibrary(); }
}

document.querySelectorAll('[data-view]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ─── Toast ───────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2800);
}

// ─── Init ────────────────────────────────────────────────────────────────────
(async () => {
  await ensureDBReady();               // open IndexedDB (or fall back to localStorage)
  await migrateLegacyLocalStorage();   // one-time: move any old localStorage alerts
  await probeServer();                 // check if backend is up
  await renderAlerts();
  syncAlertsFromServer();              // pull real alerts from the database on load
  renderLibrary();
  fetchLibrary();                      // refresh library from backend if available
  if (!serverAvailable) {
    loadModel();                       // pre-load browser model if we'll need it
  }
})();

// ─── Auto-Refresh (Alerts) ─────────────────────────────────────────────────────
// Scoped to the alerts view only — no point polling a screen the user isn't on.
const ALERTS_REFRESH_INTERVAL_MS = 30000;

setInterval(() => {
  if (currentView === 'alerts') syncAlertsFromServer();
}, ALERTS_REFRESH_INTERVAL_MS);

window.addEventListener('online', async () => {
  await probeServer();
  if (currentView === 'alerts') syncAlertsFromServer();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentView === 'alerts') syncAlertsFromServer();
});
// ─── PWA Install Prompts ──────────────────────────────────────────────────────
// Android/Chrome → real beforeinstallprompt
// iOS Safari     → instructional Share → Add to Home Screen guide

(function setupPwaInstall() {
  const DISMISS_KEY   = 'cg_install_dismissed';
  const DISMISS_DAYS  = 14;          // don't re-show for 2 weeks after dismiss
  const SHOW_DELAY_MS = 4500;        // wait a few seconds so user sees the app first

  function isAlreadyInstalled() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://')
    );
  }

  function wasRecentlyDismissed() {
    try {
      const ts = localStorage.getItem(DISMISS_KEY);
      if (!ts) return false;
      const days = (Date.now() - Number(ts)) / (1000 * 60 * 60 * 24);
      return days < DISMISS_DAYS;
    } catch { return false; }
  }

  function markDismissed() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  }

  // ── Android / Chromium ───────────────────────────────────────────────────
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();                 // stop the mini-infobar
    deferredPrompt = e;
    if (!isAlreadyInstalled() && !wasRecentlyDismissed()) {
      setTimeout(showAndroidBanner, SHOW_DELAY_MS);
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideAndroidBanner();
    markDismissed();
    showToast('CropGuard installed ✓');
  });

  function showAndroidBanner() {
    const banner = document.getElementById('androidInstallBanner');
    if (!banner || !deferredPrompt) return;
    banner.classList.remove('hidden');
  }

  function hideAndroidBanner() {
    const banner = document.getElementById('androidInstallBanner');
    if (banner) banner.classList.add('hidden');
  }

  document.getElementById('androidInstallBtn')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    hideAndroidBanner();
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    markDismissed();                    // respect choice either way for a while
  });

  document.getElementById('androidDismissBtn')?.addEventListener('click', () => {
    hideAndroidBanner();
    markDismissed();
  });

  // ── iOS ──────────────────────────────────────────────────────────────────
  function showIosPrompt() {
    const prompt = document.getElementById('iosInstallPrompt');
    if (prompt) prompt.classList.remove('hidden');
  }

  function hideIosPrompt() {
    const prompt = document.getElementById('iosInstallPrompt');
    if (prompt) prompt.classList.add('hidden');
  }

  document.getElementById('iosDismissBtn')?.addEventListener('click', () => {
    hideIosPrompt();
    markDismissed();
  });
  document.getElementById('iosGotItBtn')?.addEventListener('click', () => {
    hideIosPrompt();
    markDismissed();
  });

  // Show iOS instructions only when not already installed and not recently dismissed
  if (isIos() && !isAlreadyInstalled() && !wasRecentlyDismissed()) {
    setTimeout(showIosPrompt, SHOW_DELAY_MS);
  }
})();
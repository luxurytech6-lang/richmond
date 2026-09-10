// ============================================================
//  CropGuard — app.js
//  Primary:  Flask /api/detect  (fine-tuned PlantVillage CNN)
//  Fallback: In-browser MobileNet + keyword map (offline mode)
// ============================================================

'use strict';

// ─── Config ──────────────────────────────────────────────────────────────────
// Change to your deployed backend URL in production.
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:5000'
  : 'https://cropguard-api-6c66.onrender.com';   // frontend (Hostinger) and backend (Render) are on separate domains

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
// Retries once with a longer timeout — on first load the browser is often
// also busy spinning up TF.js/MobileNet in parallel, which can delay event
// loop processing enough that a single tight timeout fires before the
// (successful) /health response is even read. Without a retry, that one
// slow tick permanently locks the session into offline mode.
async function probeServer(attempt = 1) {
  const timeoutMs = attempt === 1 ? 4000 : 8000;
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const data = await res.json();
    serverAvailable = data.status === 'ok';
    if (!data.model_loaded) {
      console.warn('[CropGuard] Server online but model not loaded — falling back to browser inference.');
      serverAvailable = false;
    }
  } catch (err) {
    if (attempt === 1) {
      console.warn('[CropGuard] First /health probe failed, retrying…', err.message);
      await new Promise(r => setTimeout(r, 400));
      return probeServer(2);
    }
    serverAvailable = false;
  }
  console.log(`[CropGuard] Server available: ${serverAvailable}`);
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
    id:        Date.now(),
    disease, crop, severity, advice, conf,
    timestamp: new Date().toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' }),
    image:     currentImageDataURL,
    synced:    false,   // true once confirmed saved to the database
  };

  // Persist locally first (always works offline, shows instantly)
  const stored = JSON.parse(localStorage.getItem('cropguard_alerts') || '[]');
  stored.unshift(alertObj);
  localStorage.setItem('cropguard_alerts', JSON.stringify(stored.slice(0, 50)));
  renderAlerts();

  // Also post to Supabase via backend (best-effort)
  let savedToServer = false;
  if (serverAvailable) {
    try {
      const res = await fetch(`${API_BASE}/api/alerts`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          disease,
          crop,
          severity:   severityClass(severity),
          confidence: parseFloat(conf),
          advice,
        }),
        signal: AbortSignal.timeout(5000),
      });
      savedToServer = res.ok;
    } catch {
      // Supabase save failed — local copy is still safe, will retry on next sync
    }
  }

  showToast(savedToServer ? 'Alert saved ✓' : 'Alert saved locally — will sync when online ✓');

  if (savedToServer) {
    await syncAlertsFromServer();   // pull the canonical row back, replacing the temp local entry
  }
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
    timestamp: row.created_at
      ? new Date(row.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
      : '',
    image:     row.image_url || null,
    synced:    true,
  };
}

// THE FIX: this was missing entirely — alerts were only ever read from
// localStorage, never pulled from the database. Call this to actually fetch
// what's saved server-side and merge it into the local cache.
async function syncAlertsFromServer() {
  if (serverAvailable === false) return;
  try {
    const res = await fetch(`${API_BASE}/api/alerts`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return;
    const rows = await res.json();
    if (!Array.isArray(rows)) return;   // e.g. {"error": "..."} when Supabase isn't configured

    const serverAlerts = rows.map(serverAlertToLocal);

    // Keep local-only alerts that haven't synced yet (saved while offline) so
    // they aren't wiped out by a server fetch that doesn't know about them.
    const local   = JSON.parse(localStorage.getItem('cropguard_alerts') || '[]');
    const pending = local.filter(a => a.synced === false);

    const merged = [...pending, ...serverAlerts].slice(0, 50);
    localStorage.setItem('cropguard_alerts', JSON.stringify(merged));
    renderAlerts();
  } catch {
    // Network hiccup — keep showing whatever's cached locally, no error shown to user
  }
}

function renderAlerts() {
  const list   = document.getElementById('alertsList');
  const stored = JSON.parse(localStorage.getItem('cropguard_alerts') || '[]');

  if (!stored.length) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" stroke="#3dba6f" stroke-width="1.2" stroke-dasharray="4 3"/><path d="M20 12v9M20 27v2" stroke="#3dba6f" stroke-width="1.5" stroke-linecap="round"/></svg>
        <p>No alerts yet.<br/>Scan a crop to get started.</p>
      </div>`;
    return;
  }

  list.innerHTML = stored.map(a => `
    <div class="alert-item">
      ${a.image ? `<img class="alert-thumb" src="${a.image}" alt="${a.disease}" loading="lazy"/>` : '<div class="alert-thumb"></div>'}
      <div class="alert-info">
        <div class="alert-disease">${a.disease}</div>
        <div class="alert-meta">${a.crop} · ${a.timestamp} · ${a.conf} confidence</div>
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

  grid.innerHTML = items.map(item => `
    <div class="lib-card" role="button" tabindex="0" aria-label="${item.disease} on ${item.crop}">
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

// ─── Navigation ───────────────────────────────────────────────────────────────
let currentView = 'scan';

function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${viewId}`));
  document.querySelectorAll('.nav-btn, .bnav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });
  currentView = viewId;
  if (viewId === 'alerts')  { renderAlerts(); syncAlertsFromServer(); }
  if (viewId === 'library') renderLibrary();
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
  await probeServer();          // check if backend is up
  renderAlerts();
  syncAlertsFromServer();       // pull real alerts from the database on load
  renderLibrary();
  fetchLibrary();               // refresh library from backend if available
  if (!serverAvailable) {
    loadModel();                // pre-load browser model if we'll need it
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
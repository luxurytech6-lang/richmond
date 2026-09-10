import os
import io
import json
import base64
import numpy as np
import requests
from typing import Optional
from urllib.parse import quote
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

# ─── Optional gdown for Google Drive model download ──────────────────────────
try:
    import gdown
    GDOWN_AVAILABLE = True
except ImportError:
    GDOWN_AVAILABLE = False

app = Flask(__name__, static_folder="static", static_url_path="")

_ALLOWED_ORIGINS = [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3000",
    "https://mediumblue-ape-590742.hostingersite.com",
]
_extra = os.getenv("FRONTEND_URL", "").strip()
if _extra:
    _ALLOWED_ORIGINS.append(_extra)

CORS(app, origins=_ALLOWED_ORIGINS)

# ─── Supabase (optional) ─────────────────────────────────────────────────────
try:
    from supabase import create_client
    SUPABASE_URL = os.getenv("SUPABASE_URL")
    SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL else None
except ImportError:
    supabase = None

# ─── PlantVillage Full Class Map (38 classes) ─────────────────────────────────
# severity / advice for every PlantVillage label.
# Keys must match the folder names in your dataset exactly.
PLANTVIL_META = {
    # ── Apple ──
    "Apple___Apple_scab":               {"severity": "moderate", "crop": "Apple",    "advice": "Apply myclobutanil or captan fungicide at bud break. Remove fallen leaves to reduce inoculum."},
    "Apple___Black_rot":                {"severity": "high",     "crop": "Apple",    "advice": "Prune infected branches 15 cm below canker. Apply copper-based spray. Destroy mummified fruit."},
    "Apple___Cedar_apple_rust":         {"severity": "moderate", "crop": "Apple",    "advice": "Apply myclobutanil from pink bud stage. Remove nearby cedar/juniper hosts where possible."},
    "Apple___healthy":                  {"severity": "low",      "crop": "Apple",    "advice": "Your apple plant looks healthy. Maintain good canopy ventilation and regular monitoring."},

    # ── Blueberry ──
    "Blueberry___healthy":              {"severity": "low",      "crop": "Blueberry","advice": "Plant looks healthy. Keep soil pH 4.5–5.0 and apply mulch to retain moisture."},

    # ── Cherry ──
    "Cherry_(including_sour)___Powdery_mildew": {"severity": "moderate", "crop": "Cherry", "advice": "Apply sulfur or potassium bicarbonate fungicide. Improve air circulation. Avoid excessive nitrogen."},
    "Cherry_(including_sour)___healthy": {"severity": "low",     "crop": "Cherry",  "advice": "Plant is healthy. Prune for open canopy to reduce humidity."},

    # ── Corn / Maize ──
    "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot": {"severity": "moderate", "crop": "Maize", "advice": "Apply strobilurin or triazole fungicide at tasseling. Rotate with non-host crops. Use resistant hybrids."},
    "Corn_(maize)___Common_rust_":      {"severity": "moderate", "crop": "Maize",   "advice": "Apply propiconazole at early rust detection. Plant resistant varieties to reduce future losses."},
    "Corn_(maize)___Northern_Leaf_Blight": {"severity": "high",  "crop": "Maize",   "advice": "Apply propiconazole or mancozeb at VT/R1 stage. Use resistant hybrids next season. Incorporate crop residue."},
    "Corn_(maize)___healthy":           {"severity": "low",      "crop": "Maize",   "advice": "Maize looks healthy. Maintain balanced fertilisation and scout regularly for pests."},

    # ── Grape ──
    "Grape___Black_rot":                {"severity": "high",     "crop": "Grape",   "advice": "Apply myclobutanil or mancozeb from bud break. Remove mummified berries and infected canes."},
    "Grape___Esca_(Black_Measles)":     {"severity": "high",     "crop": "Grape",   "advice": "No curative treatment. Remove severely infected vines. Protect pruning wounds with fungicide paste."},
    "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)": {"severity": "moderate", "crop": "Grape", "advice": "Apply copper hydroxide or mancozeb. Improve canopy airflow. Remove affected leaves."},
    "Grape___healthy":                  {"severity": "low",      "crop": "Grape",   "advice": "Vine is healthy. Maintain trellis training and regular scouting."},

    # ── Orange ──
    "Orange___Haunglongbing_(Citrus_greening)": {"severity": "high", "crop": "Orange", "advice": "No cure. Remove and destroy infected trees immediately. Control Asian citrus psyllid vector with imidacloprid. Use certified disease-free nursery stock."},

    # ── Peach ──
    "Peach___Bacterial_spot":           {"severity": "moderate", "crop": "Peach",   "advice": "Apply copper-based bactericide from petal fall. Avoid overhead irrigation. Plant resistant varieties."},
    "Peach___healthy":                  {"severity": "low",      "crop": "Peach",   "advice": "Peach tree is healthy. Thin fruit and maintain open canopy for air circulation."},

    # ── Bell Pepper ──
    "Pepper,_bell___Bacterial_spot":    {"severity": "moderate", "crop": "Bell Pepper", "advice": "Apply copper hydroxide bactericide. Use disease-free transplants. Avoid working in wet fields to reduce spread."},
    "Pepper,_bell___healthy":           {"severity": "low",      "crop": "Bell Pepper", "advice": "Pepper plant looks healthy. Maintain even soil moisture and scout for aphids regularly."},

    # ── Potato ──
    "Potato___Early_blight":            {"severity": "moderate", "crop": "Potato",  "advice": "Apply mancozeb or chlorothalonil every 7–10 days from first sign. Remove lower infected leaves. Avoid overhead watering."},
    "Potato___Late_blight":             {"severity": "high",     "crop": "Potato",  "advice": "Apply chlorothalonil or metalaxyl immediately. Hill soil around plants to protect tubers. Destroy infected haulm before harvest."},
    "Potato___healthy":                 {"severity": "low",      "crop": "Potato",  "advice": "Potato plant is healthy. Hill up soil and maintain consistent irrigation."},

    # ── Raspberry ──
    "Raspberry___healthy":              {"severity": "low",      "crop": "Raspberry","advice": "Plant is healthy. Prune old canes after harvest and maintain weed-free rows."},

    # ── Soybean ──
    "Soybean___healthy":                {"severity": "low",      "crop": "Soybean", "advice": "Soybean looks healthy. Inoculate seeds with Rhizobium and monitor for soybean aphid."},

    # ── Squash ──
    "Squash___Powdery_mildew":          {"severity": "moderate", "crop": "Squash",  "advice": "Apply potassium bicarbonate or neem oil spray. Remove heavily infected leaves. Improve plant spacing for airflow."},

    # ── Strawberry ──
    "Strawberry___Leaf_scorch":         {"severity": "moderate", "crop": "Strawberry","advice": "Remove infected leaves. Apply captan fungicide. Avoid wet foliage. Renovate beds after harvest."},
    "Strawberry___healthy":             {"severity": "low",      "crop": "Strawberry","advice": "Strawberry is healthy. Renew beds every 2–3 years and maintain proper runner management."},

    # ── Tomato ──
    "Tomato___Bacterial_spot":          {"severity": "moderate", "crop": "Tomato",  "advice": "Apply copper hydroxide bactericide. Use disease-free transplants. Avoid overhead irrigation. Rotate crops."},
    "Tomato___Early_blight":            {"severity": "moderate", "crop": "Tomato",  "advice": "Remove infected lower leaves. Apply mancozeb or chlorothalonil every 7 days. Stake plants to improve airflow."},
    "Tomato___Late_blight":             {"severity": "high",     "crop": "Tomato",  "advice": "Apply copper-based fungicide immediately. Remove and destroy all infected tissue. Avoid wetting foliage. Destroy plant debris post-harvest."},
    "Tomato___Leaf_Mold":               {"severity": "moderate", "crop": "Tomato",  "advice": "Improve greenhouse ventilation. Apply chlorothalonil or mancozeb. Remove infected leaves promptly."},
    "Tomato___Septoria_leaf_spot":      {"severity": "moderate", "crop": "Tomato",  "advice": "Apply mancozeb fungicide. Remove lower infected leaves. Mulch soil to prevent spore splash."},
    "Tomato___Spider_mites Two-spotted_spider_mite": {"severity": "moderate", "crop": "Tomato", "advice": "Apply miticide (abamectin) or insecticidal soap. Increase humidity. Remove heavily infested leaves."},
    "Tomato___Target_Spot":             {"severity": "moderate", "crop": "Tomato",  "advice": "Apply azoxystrobin or chlorothalonil. Remove infected leaves. Avoid overhead watering."},
    "Tomato___Tomato_Yellow_Leaf_Curl_Virus": {"severity": "high", "crop": "Tomato", "advice": "No cure. Remove infected plants. Control whitefly vectors with imidacloprid. Use virus-resistant varieties. Install sticky yellow traps."},
    "Tomato___Tomato_mosaic_virus":     {"severity": "high",     "crop": "Tomato",  "advice": "Remove and destroy infected plants. Disinfect tools with 10% bleach solution. Control aphids. Use TMV-resistant seed varieties."},
    "Tomato___healthy":                 {"severity": "low",      "crop": "Tomato",  "advice": "Tomato plant is healthy! Monitor regularly, maintain staking and good airflow between plants."},

    # ── Banana / Plantain ──
    "Banana_Plantain___Cordana_Leaf_Spot":       {"severity": "moderate", "crop": "Banana/Plantain", "advice": "Remove and destroy heavily spotted leaves. Improve air circulation between plants. Apply a mancozeb-based fungicide in severe outbreaks."},
    "Banana_Plantain___Pestalotiopsis_Leaf_Spot": {"severity": "moderate", "crop": "Banana/Plantain", "advice": "Usually a secondary pathogen on already-stressed plants. Improve nutrition and drainage. Remove badly affected leaves."},
    "Banana_Plantain___Sigatoka":                {"severity": "high",     "crop": "Banana/Plantain", "advice": "Apply propiconazole or mancozeb on a regular spray schedule. Remove and destroy infected leaves (de-leafing). Improve drainage and plant spacing for airflow."},
    "Banana_Plantain___healthy":                 {"severity": "low",      "crop": "Banana/Plantain", "advice": "Plant looks healthy. Maintain good drainage, regular de-suckering, and balanced fertilisation."},
}

# Friendly display names (strip underscores and class prefix)
def format_label(raw_label: str) -> str:
    parts = raw_label.split("___")
    if len(parts) == 2:
        crop, condition = parts
        crop = crop.replace("_", " ").replace("(", "").replace(")", "").strip()
        condition = condition.replace("_", " ").replace("  ", " ").strip()
        if condition.lower() == "healthy":
            return f"Healthy {crop}"
        return condition
    return raw_label.replace("_", " ")

# ─── Model & Class Map Loading ───────────────────────────────────────────────
model        = None
idx_to_class = {}   # { "0": "Apple___Apple_scab", ... }

def download_model_if_missing(model_path: str) -> str:
    """Download model from Google Drive if not present on disk."""
    if os.path.exists(model_path):
        print(f"[CropGuard] Model already exists at {model_path}")
        return model_path

    gdrive_url = os.getenv("MODEL_GDRIVE_URL")
    if not gdrive_url:
        print("[CropGuard] MODEL_GDRIVE_URL not set — skipping download.")
        return model_path

    if not GDOWN_AVAILABLE:
        print("[CropGuard] gdown not installed — cannot download model.")
        return model_path

    print(f"[CropGuard] Downloading model from Google Drive to {model_path} ...")
    try:
        gdown.download(gdrive_url, model_path, quiet=False, fuzzy=True)
        if os.path.exists(model_path):
            size_mb = os.path.getsize(model_path) / (1024 * 1024)
            print(f"[CropGuard] Model downloaded ({size_mb:.1f} MB)")
        else:
            print("[CropGuard] Download finished but file missing — check Drive URL/permissions.")
    except Exception as e:
        print(f"[CropGuard] Model download failed: {e}")

    return model_path


def load_model():
    global model, idx_to_class

    # ── Load class name map ──────────────────────────────────
    class_map_path = os.getenv("CLASS_MAP_PATH", "class_names.json")
    if os.path.exists(class_map_path):
        with open(class_map_path) as f:
            idx_to_class = json.load(f)
        print(f"[CropGuard] Loaded {len(idx_to_class)} class labels from {class_map_path}")
    else:
        print(f"[CropGuard] WARNING: {class_map_path} not found. Run train.py first.")

    # ── Load TF model ────────────────────────────────────────
    try:
        import tensorflow as tf
        model_path = os.getenv("MODEL_PATH", "cropguard_model.keras")
        model_path = download_model_if_missing(model_path)  # ← auto-download from Drive

        if model_path and os.path.exists(model_path):
            model = tf.keras.models.load_model(model_path)
            print(f"[CropGuard] Loaded fine-tuned model from {model_path}")
            print(f"[CropGuard] Model output classes: {model.output_shape[-1]}")

            # Warm-up inference: Keras/TF lazily traces the execution graph on
            # the very first call to predict(). On a cold Render instance,
            # that tracing cost can add many extra seconds — enough to blow
            # past the frontend's request timeout. Pay that cost here, at
            # boot, instead of on the first real user request.
            try:
                dummy = np.zeros((1, 224, 224, 3), dtype=np.float32)
                model.predict(dummy, verbose=0)
                print("[CropGuard] Model warm-up complete")
            except Exception as e:
                print(f"[CropGuard] Model warm-up failed (non-fatal): {e}")
        else:
            print(f"[CropGuard] '{model_path}' not found — run train.py to produce it.")
            print(f"[CropGuard] Falling back to ImageNet MobileNetV2 (keyword mapping).")
            model = tf.keras.applications.MobileNetV2(
                weights="imagenet",
                include_top=True,
                input_shape=(224, 224, 3)
            )
    except Exception as e:
        print(f"[CropGuard] Model load failed: {e}")
        model = None


# ─── Image Preprocessing ─────────────────────────────────────────────────────
def preprocess_image(image_bytes: bytes) -> np.ndarray:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img = img.resize((224, 224), Image.LANCZOS)
    arr = np.array(img, dtype=np.float32)
    arr = (arr / 127.5) - 1.0
    return np.expand_dims(arr, axis=0)

# ─── ImageNet Keyword Fallback (used only without fine-tuned model) ───────────
IMAGENET_KEYWORD_MAP = [
    (["blight", "rust", "mold", "leaf", "plant", "herb"],    "Leaf Blight",          "Maize / Cassava", "high",     "Apply copper-based fungicide. Remove and destroy infected leaves."),
    (["yellow", "wilt", "wilting"],                           "Fusarium Wilt",         "Tomato",          "moderate", "Remove infected plants. Rotate crops next season."),
    (["spot", "brown", "circle", "lesion"],                   "Cercospora Leaf Spot",  "Groundnut",       "moderate", "Apply mancozeb fungicide. Space plants for airflow."),
    (["white", "powder", "coating", "mildew"],                "Powdery Mildew",        "Cucumber",        "low",      "Spray neem oil. Avoid wetting foliage."),
    (["mosaic", "virus", "streak", "variegat"],               "Mosaic Virus",          "Cassava",         "high",     "Remove and burn plants. Control aphid/whitefly populations."),
    (["rot", "decay", "soft", "wet"],                         "Root & Stem Rot",       "Yam",             "high",     "Improve drainage. Apply Trichoderma biofungicide to soil."),
]

# ─── Prediction Logic ────────────────────────────────────────────────────────
# Below this confidence (%), we don't trust the top prediction enough to report
# it as a real diagnosis — most likely an out-of-distribution / unsupported
# plant species, or a blurry/ambiguous photo.
CONFIDENCE_THRESHOLD = 60.0

def unidentified_result(confidence: float) -> dict:
    return {
        "disease":    "Unidentified species or condition",
        "crop":       "Unknown",
        "severity":   "low",
        "confidence": confidence,
        "advice":     "This plant doesn't confidently match anything in our database — it may be a species we don't yet cover, or the photo may be unclear. Try a closer, well-lit shot of a single leaf, or consult your local agricultural extension officer.",
    }

def predict(image_bytes: bytes) -> dict:
    if model is None:
        return fallback_result()

    try:
        import tensorflow as tf
        x = preprocess_image(image_bytes)
        preds = model.predict(x, verbose=0)[0]   # shape: (num_classes,)
        top_idx  = int(np.argmax(preds))
        top_conf = float(preds[top_idx])

        num_outputs = len(preds)

        # ── Fine-tuned PlantVillage model path ───────────────
        # Matches when output size == our class map (38 PlantVillage classes)
        if idx_to_class and num_outputs == len(idx_to_class):
            confidence_pct = round(top_conf * 100, 1)

            # Reject low-confidence predictions instead of forcing a guess.
            # A closed-set classifier MUST output a label even for plants it
            # was never trained on — this is the safety net for that case.
            if confidence_pct < CONFIDENCE_THRESHOLD:
                return unidentified_result(confidence_pct)

            raw_label = idx_to_class.get(str(top_idx), "Unknown")
            meta      = PLANTVIL_META.get(raw_label, None)

            if meta:
                return {
                    "disease":    format_label(raw_label),
                    "crop":       meta["crop"],
                    "severity":   meta["severity"],
                    "confidence": confidence_pct,
                    "advice":     meta["advice"],
                    "raw_label":  raw_label,
                }
            else:
                # Label in JSON but not in PLANTVIL_META — build a generic result
                return {
                    "disease":    format_label(raw_label),
                    "crop":       raw_label.split("___")[0].replace("_", " "),
                    "severity":   "moderate",
                    "confidence": confidence_pct,
                    "advice":     "Consult your local agricultural extension officer for treatment advice.",
                    "raw_label":  raw_label,
                }

        # ── ImageNet fallback (1000-class output) ────────────
        decoded = tf.keras.applications.mobilenet_v2.decode_predictions(
            np.expand_dims(preds, 0), top=5
        )[0]
        class_names = " ".join([d[1].lower() for d in decoded])
        conf_top    = float(decoded[0][2])

        for keywords, disease, crop, severity, advice in IMAGENET_KEYWORD_MAP:
            if any(kw in class_names for kw in keywords):
                return {
                    "disease":    disease,
                    "crop":       crop,
                    "severity":   severity,
                    "confidence": round(min(95, max(55, conf_top * 100 + 35)), 1),
                    "advice":     advice,
                }

        return fallback_result()

    except Exception as e:
        print(f"[CropGuard] Inference error: {e}")
        return fallback_result()


def fallback_result() -> dict:
    return {
        "disease":    "Unidentified Condition",
        "crop":       "Unknown",
        "severity":   "low",
        "confidence": 0,
        "advice":     "Could not identify a known disease. Ensure the image is clear, close-up, and well-lit. Consult your local agricultural extension officer.",
    }

# ─── Online Enrichment (Wikipedia — free, no API key) ────────────────────────
# Best-effort only. Any failure (offline, timeout, no match) returns None and
# the frontend simply hides the "more info" section — local advice always works.
WIKI_TIMEOUT = 4  # seconds
WIKI_HEADERS = {"User-Agent": "CropGuard/1.0 (plant disease lookup; contact: cropguard@example.com)"}

def wikipedia_lookup(query: str) -> Optional[dict]:
    if not query or not query.strip():
        return None
    try:
        # Step 1: search for the best matching Wikipedia page title
        search = requests.get(
            "https://en.wikipedia.org/w/api.php",
            params={"action": "query", "list": "search", "srsearch": query, "format": "json", "srlimit": 1},
            timeout=WIKI_TIMEOUT,
            headers=WIKI_HEADERS,
        )
        search.raise_for_status()
        results = search.json().get("query", {}).get("search", [])
        if not results:
            return None
        title = results[0]["title"]

        # Step 2: fetch the summary for that exact title
        summary = requests.get(
            f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title)}",
            timeout=WIKI_TIMEOUT,
            headers=WIKI_HEADERS,
        )
        summary.raise_for_status()
        data = summary.json()

        extract = data.get("extract", "")
        if not extract:
            return None

        return {
            "title":     data.get("title", title),
            "extract":   extract,
            "url":       (data.get("content_urls") or {}).get("desktop", {}).get("page"),
            "thumbnail": (data.get("thumbnail") or {}).get("source"),
        }
    except Exception as e:
        print(f"[CropGuard] Wikipedia lookup failed for '{query}': {e}")
        return None

# ─── Routes ──────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status":       "ok",
        "model_loaded": model is not None,
        "num_classes":  len(idx_to_class) if idx_to_class else 0,
    })


@app.route("/api/detect", methods=["POST"])
def detect():
    """
    POST /api/detect
    Accepts:
      • multipart/form-data  →  field: 'image' (file upload)
      • application/json     →  { "image": "<base64 data URI or raw base64>" }
    Returns JSON:
      { disease, crop, severity, confidence, advice, timestamp }
    """
    image_bytes = None

    if request.content_type and "multipart" in request.content_type:
        file = request.files.get("image")
        if not file:
            return jsonify({"error": "No image file provided"}), 400
        image_bytes = file.read()

    elif request.is_json:
        data = request.get_json()
        b64  = data.get("image", "")
        if "," in b64:
            b64 = b64.split(",", 1)[1]   # strip data URI prefix
        try:
            image_bytes = base64.b64decode(b64)
        except Exception:
            return jsonify({"error": "Invalid base64 image"}), 400
    else:
        return jsonify({"error": "Unsupported content type. Use multipart/form-data or application/json"}), 415

    if not image_bytes:
        return jsonify({"error": "Empty image"}), 400

    result = predict(image_bytes)
    result["timestamp"] = datetime.utcnow().isoformat()
    return jsonify(result)


@app.route("/api/alerts", methods=["POST"])
def save_alert():
    """POST /api/alerts — Save a detection alert to Supabase."""
    if not supabase:
        return jsonify({"error": "Database not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env"}), 503

    data = request.get_json()
    if not data or not all(k in data for k in ("disease", "severity")):
        return jsonify({"error": "Missing required fields: disease, severity"}), 400

    row = {
        "disease":    data.get("disease"),
        "crop":       data.get("crop"),
        "severity":   data.get("severity"),
        "confidence": data.get("confidence"),
        "advice":     data.get("advice"),
        "image_url":  data.get("image_url"),
        "latitude":   data.get("lat"),
        "longitude":  data.get("lng"),
        "created_at": datetime.utcnow().isoformat(),
    }

    try:
        res = supabase.table("alerts").insert(row).execute()
        return jsonify({"saved": True, "id": res.data[0]["id"] if res.data else None})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/alerts", methods=["GET"])
def get_alerts():
    """GET /api/alerts — Fetch recent alerts from Supabase."""
    if not supabase:
        return jsonify([])
    try:
        res = (
            supabase.table("alerts")
            .select("*")
            .order("created_at", desc=True)
            .limit(50)
            .execute()
        )
        return jsonify(res.data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/library", methods=["GET"])
def get_library():
    """GET /api/library — Returns the full disease library from PlantVillage metadata."""
    library = [
        {
            "crop":     meta["crop"],
            "disease":  format_label(label),
            "severity": meta["severity"],
            "advice":   meta["advice"],
        }
        for label, meta in PLANTVIL_META.items()
        if "healthy" not in label.lower()
    ]
    # Sort by crop then disease name
    library.sort(key=lambda x: (x["crop"], x["disease"]))
    return jsonify(library)


@app.route("/api/enrich", methods=["GET"])
def enrich():
    """
    GET /api/enrich?raw_label=<PlantVillage label>&disease=<display name>&crop=<crop>
    Best-effort supplementary info from Wikipedia (free, no API key required).
    Always returns 200 — { available: false } when offline or no match found,
    so the frontend can fail silently and keep showing local advice only.
    """
    raw_label = request.args.get("raw_label", "").strip()
    disease   = request.args.get("disease", "").strip()
    crop      = request.args.get("crop", "").strip()

    if raw_label and raw_label in PLANTVIL_META:
        is_healthy = "healthy" in raw_label.lower()
        meta_crop  = PLANTVIL_META[raw_label]["crop"]
        query = f"{meta_crop} plant" if is_healthy else f"{format_label(raw_label)} {meta_crop}"
    elif disease and crop:
        query = f"{crop} {disease}"
    elif disease:
        query = disease
    else:
        return jsonify({"available": False, "reason": "no disease/crop provided"}), 400

    info = wikipedia_lookup(query)
    if not info:
        return jsonify({"available": False})

    return jsonify({"available": True, **info})


@app.route("/api/classes", methods=["GET"])
def get_classes():
    """GET /api/classes — Returns all class labels the model was trained on."""
    return jsonify({
        "total":   len(idx_to_class),
        "classes": idx_to_class,
    })


# ─── Entry Point ─────────────────────────────────────────────────────────────
# load_model() is called at module level so it runs under both Gunicorn and
# direct `python app.py` execution. Placing it inside `if __name__ == "__main__"`
# means Gunicorn never sees it (Gunicorn imports the module, it doesn't run it).
load_model()

if __name__ == "__main__":
    port  = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_ENV", "production") == "development"
    print(f"[CropGuard] Starting on http://0.0.0.0:{port}")
    app.run(host="0.0.0.0", port=port, debug=debug)
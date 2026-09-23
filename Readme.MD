# CropGuard 🌿
**AI-Driven Crop Disease Alert System for Smallholder Farmers**

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (PWA — Plain HTML/CSS/JS)                         │
│                                                             │
│  index.html  ←→  app.js  ←→  TensorFlow.js (MobileNetV2)  │
│                      ↓                                      │
│               Service Worker (sw.js) — offline cache        │
└──────────────────────┬──────────────────────────────────────┘
                       │ fetch /api/detect (optional, enhanced)
┌──────────────────────▼──────────────────────────────────────┐
│  BACKEND (Python / Flask)                                    │
│                                                             │
│  app.py  ←→  TensorFlow / Keras (MobileNetV2 CNN)          │
│                      ↓                                      │
│              Supabase (PostgreSQL)                          │
│              alerts table + outbreak_summary view           │
└─────────────────────────────────────────────────────────────┘
```

## CNN Model

The system uses a **MobileNetV2 Convolutional Neural Network**:

- **In-browser inference**: TensorFlow.js + MobileNet v2 (loaded from CDN, cached by SW)
- **Server-side inference**: TensorFlow/Keras in Flask (optional, higher accuracy)
- **For production**: Fine-tune MobileNetV2 on the [PlantVillage dataset](https://www.kaggle.com/datasets/emmarex/plantdisease) (38 classes, ~54k images)

### Why MobileNetV2?
- Designed for mobile/edge — fast even on low-spec devices
- Pre-trained on ImageNet → transfer learning to PlantVillage is fast
- ~14MB model size → fits in browser cache for offline use

---

## Setup

### Frontend
```bash
cd frontend
# Serve with any static server:
npx serve .
# or: python3 -m http.server 5500
```
Open `http://localhost:5500` — installs as PWA on mobile.

### Backend (optional)
```bash
cd backend
pip install flask flask-cors tensorflow pillow supabase python-dotenv
cp .env.example .env    # fill in Supabase credentials
python app.py
```

### Supabase
1. Create a project at [supabase.com](https://supabase.com)
2. Run `schema.sql` in the SQL editor
3. Copy your URL + anon key to `.env`

---

## API Endpoints

| Method | Path           | Description                        |
|--------|----------------|------------------------------------|
| GET    | /health        | Server + model status              |
| POST   | /api/detect    | Classify crop image → disease      |
| POST   | /api/alerts    | Save detection to Supabase         |
| GET    | /api/alerts    | Fetch recent alerts                |
| GET    | /api/library   | Disease reference library          |

### POST /api/detect
```json
// Request (JSON)
{ "image": "data:image/jpeg;base64,/9j/..." }

// Response
{
  "disease": "Northern Leaf Blight",
  "crop": "Maize",
  "severity": "high",
  "confidence": 87.4,
  "advice": "Apply propiconazole fungicide...",
  "timestamp": "2025-06-01T14:32:00Z"
}
```

---

## Fine-tuning the CNN

```python
import tensorflow as tf

# Load PlantVillage dataset
ds = tf.keras.utils.image_dataset_from_directory(
    "PlantVillage/",
    image_size=(224, 224),
    batch_size=32
)

# MobileNetV2 base
base = tf.keras.applications.MobileNetV2(
    input_shape=(224, 224, 3),
    include_top=False,
    weights="imagenet"
)
base.trainable = False  # freeze base initially

model = tf.keras.Sequential([
    base,
    tf.keras.layers.GlobalAveragePooling2D(),
    tf.keras.layers.Dense(128, activation="relu"),
    tf.keras.layers.Dropout(0.2),
    tf.keras.layers.Dense(38, activation="softmax")  # 38 PlantVillage classes
])

model.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])
model.fit(ds, epochs=10)
model.save("cropguard_model.h5")
```

Set `MODEL_PATH=cropguard_model.h5` in `.env`.

---

## File Structure

```
cropguard/
├── frontend/
│   ├── index.html       ← PWA shell
│   ├── style.css        ← Design system
│   ├── app.js           ← CNN inference + UI logic
│   ├── sw.js            ← Service Worker (offline)
│   └── manifest.json    ← PWA manifest
└── backend/
    ├── app.py           ← Flask API + TF inference
    ├── schema.sql       ← Supabase table setup
    └── .env.example     ← Environment variables
```
update files
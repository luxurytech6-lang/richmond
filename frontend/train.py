"""
CropGuard — Multi-Dataset Model Training Script
Fine-tunes MobileNetV2 on PlantVillage + African crop datasets combined.

WHAT CHANGED FROM THE ORIGINAL train.py
─────────────────────────────────────────────────────────────────────────────
The model architecture and two-phase fine-tuning are unchanged. What's new is
a dataset-merging step that runs before training: instead of pointing at one
PlantVillage zip, you now list multiple datasets in DATASETS below, and the
script builds one unified folder of `Crop___Condition/` subfolders for
flow_from_directory to consume — exactly like before, just bigger.

Datasets are linked (hardlinks for files, junctions for folders), not
copied, so this doesn't duplicate your disk usage.

DATASET LAYOUTS HANDLED
─────────────────────────────────────────────────────────────────────────────
  "folder"        Already organized as Crop___Condition/*.jpg folders
                   (this is the PlantVillage layout — used as-is).

  "folder_fuzzy"   Class folders exist somewhere in the zip, but the exact
                   path/casing is unknown ahead of time (e.g. nested under
                   "Original Images/", "Augmented Images/", etc). The script
                   auto-detects them by keyword and renames into our
                   Crop___Condition convention. Use this for datasets you
                   haven't manually inspected yet — if it can't find the
                   folders, it'll tell you exactly where to look.

  "csv"            A flat image folder + a CSV of (image_id, label) plus a
                   label_num_to_disease_map.json — e.g. Kaggle's "Cassava
                   Leaf Disease Classification" layout. Not used by any
                   DATASETS entry right now (Cassava was removed — too large
                   to download), but left in as infrastructure in case you
                   add a similarly-shaped dataset later.

SETUP
─────────────────────────────────────────────────────────────────────────────
1. Download the zips from Kaggle:
     - PlantVillage (you already have this)
     - Banana Leaf Spot Diseases (BananaLSD):
         https://www.kaggle.com/datasets/shifatearman/bananalsd
2. Update the zip_path / extract_dir values in DATASETS below to match
   wherever you saved them.
3. pip install tensorflow pillow scikit-learn matplotlib
4. python train.py

   First run: extraction + linking takes a few minutes per dataset.
   Re-runs: skip extraction/linking automatically if directories exist.
   If you change DATASETS, delete MERGED_DATASET_DIR and rerun.

OUTPUT
─────────────────────────────────────────────────────────────────────────────
    cropguard_model.keras   ← drop next to app.py (back up the old one first!)
    class_names.json        ← new class index mapping, now ~42 classes
    training_history.png    ← loss/accuracy curves
"""

import os
import csv
import json
import shutil
import zipfile
import subprocess
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

import tensorflow as tf
from tensorflow.keras import layers, Model
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
from tensorflow.keras.callbacks import (
    ModelCheckpoint, EarlyStopping, ReduceLROnPlateau, CSVLogger
)
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from sklearn.utils.class_weight import compute_class_weight

# ─── Dataset Configuration ───────────────────────────────────────────────────
# Add/remove entries here to control what gets merged into the training set.

DATASETS = [
    {
        "name": "plantvillage",
        "zip_path": r"C:\Users\HOME PC\Desktop\richmond\plantvillage-dataset.zip",
        "extract_dir": r"C:\Users\HOME PC\Desktop\richmond\plantvillage-extracted",
        "type": "folder",
    },
    {
        "name": "banana_plantain",
        "zip_path": r"C:\Users\HOME PC\Desktop\richmond\archive.zip",
        "extract_dir": r"C:\Users\HOME PC\Desktop\richmond\banana-extracted",
        "type": "folder_fuzzy",
        "folder_keywords": ["cordana", "sigatoka", "pestalotiopsis", "healthy"],
        "rename_map": {
            "cordana":        "Banana_Plantain___Cordana_Leaf_Spot",
            "sigatoka":       "Banana_Plantain___Sigatoka",
            "pestalotiopsis": "Banana_Plantain___Pestalotiopsis_Leaf_Spot",
            "healthy":        "Banana_Plantain___healthy",
        },
    },
]

MERGED_DATASET_DIR = r"C:\Users\HOME PC\Desktop\richmond\merged-dataset"

# ─── Training Configuration (unchanged from original) ───────────────────────

AUTO_SPLIT    = True
VAL_SPLIT     = 0.15
IMG_SIZE      = (224, 224)
BATCH_SIZE    = 32
EPOCHS_HEAD   = 10
EPOCHS_FINE   = 20
UNFREEZE_FROM = 100
LR_HEAD       = 1e-3
LR_FINE       = 1e-5
MODEL_OUT     = "cropguard_model.keras"
CLASS_MAP_OUT = "class_names.json"

DATASET_DIR = None   # set by build_merged_dataset() at runtime

# ─── Dataset Merging ──────────────────────────────────────────────────────────

def extract_zip(zip_path: str, extract_dir: str):
    if not os.path.exists(zip_path):
        raise FileNotFoundError(
            f"Zip not found: {zip_path}\n"
            f"  Update the zip_path in DATASETS to point at your download."
        )
    if os.path.exists(extract_dir) and os.listdir(extract_dir):
        print(f"  Already extracted -> {extract_dir}")
        return
    os.makedirs(extract_dir, exist_ok=True)
    print(f"  Extracting {zip_path} -> {extract_dir} ...")
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(extract_dir)
    print("  Extraction complete.")


def link_dir(src: str, dst: str):
    """Link a whole directory into the merged dataset without copying files."""
    if os.path.exists(dst):
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        os.symlink(src, dst, target_is_directory=True)
        return
    except OSError:
        pass
    try:
        # Windows directory junction — works without admin rights, unlike
        # symlinks, which need Developer Mode or elevation.
        subprocess.run(
            f'mklink /J "{dst}" "{src}"', shell=True, check=True,
            capture_output=True,
        )
        return
    except Exception:
        pass
    print(f"  [warn] Could not link {os.path.basename(dst)} — copying instead (uses more disk).")
    shutil.copytree(src, dst)


def link_file(src: str, dst: str):
    """Hardlink a single file into the merged dataset (NTFS hardlinks need
    no special privileges and use no extra disk space)."""
    if os.path.exists(dst):
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)   # fallback, e.g. linking across drives


def find_class_root(start_dir: str, hint_keywords):
    """BFS the extracted zip for the folder that directly contains per-class
    image subfolders, identified by keyword (case-insensitive substring
    match against subfolder names)."""
    hints = [h.lower() for h in hint_keywords]

    def looks_like_class_dir(path):
        try:
            entries = os.listdir(path)
        except PermissionError:
            return False
        subdirs = [e for e in entries if os.path.isdir(os.path.join(path, e))]
        return len(subdirs) >= 2 and any(
            any(h in d.lower() for h in hints) for d in subdirs
        )

    queue = [start_dir]
    while queue:
        current = queue.pop(0)
        if looks_like_class_dir(current):
            return current
        try:
            for entry in sorted(os.listdir(current)):
                full = os.path.join(current, entry)
                if os.path.isdir(full):
                    queue.append(full)
        except PermissionError:
            continue
    return None


def prepare_folder_dataset(cfg: dict, merged_dir: str):
    """type == 'folder': already laid out as Crop___Condition/*.jpg — link
    every class folder straight into the merged directory, unchanged."""
    extract_zip(cfg["zip_path"], cfg["extract_dir"])
    root = find_class_root(cfg["extract_dir"], ['___']) or cfg["extract_dir"]
    n = 0
    for class_name in sorted(os.listdir(root)):
        src = os.path.join(root, class_name)
        if not os.path.isdir(src):
            continue
        link_dir(src, os.path.join(merged_dir, class_name))
        n += 1
    print(f"  [{cfg['name']}] linked {n} class folders")


def prepare_fuzzy_folder_dataset(cfg: dict, merged_dir: str):
    """type == 'folder_fuzzy': class folders exist but under an unknown
    nested path/naming — auto-detect by keyword, then rename into our
    Crop___Condition convention."""
    extract_zip(cfg["zip_path"], cfg["extract_dir"])
    root = find_class_root(cfg["extract_dir"], cfg["folder_keywords"])
    if root is None:
        raise RuntimeError(
            f"[{cfg['name']}] Could not auto-locate class folders.\n"
            f"  Open '{cfg['extract_dir']}' yourself, find the folder containing "
            f"per-class subfolders, and either rename them to match "
            f"folder_keywords or hardcode the path here."
        )
    n = 0
    for entry in sorted(os.listdir(root)):
        src = os.path.join(root, entry)
        if not os.path.isdir(src):
            continue
        matched = next(
            (v for k, v in cfg["rename_map"].items() if k in entry.lower()), None
        )
        if matched is None:
            print(f"  [{cfg['name']}] skipping unrecognized folder: {entry}")
            continue
        dst = os.path.join(merged_dir, matched)
        if os.path.exists(dst):
            # Multiple source folders (e.g. "Original" + "Augmented") can
            # map to the same class — merge their files instead of skipping.
            for fname in os.listdir(src):
                link_file(os.path.join(src, fname), os.path.join(dst, fname))
        else:
            link_dir(src, dst)
        n += 1
    print(f"  [{cfg['name']}] linked {n} class folders")


def prepare_csv_dataset(cfg: dict, merged_dir: str):
    """type == 'csv': flat image folder + CSV of (image_id, label) — the
    Kaggle Cassava Leaf Disease Classification layout. Builds per-class
    folders by hardlinking each image based on its CSV label."""
    extract_zip(cfg["zip_path"], cfg["extract_dir"])
    root = cfg["extract_dir"]

    with open(os.path.join(root, cfg["label_map_file"])) as f:
        raw_label_map = json.load(f)   # {"0": "Cassava Bacterial Blight (CBB)", ...}

    def resolve_class_name(raw_text: str):
        text = raw_text.lower()
        for keyword, our_name in cfg["label_rename_rules"]:
            if keyword in text:
                return our_name
        return None

    label_to_class = {}
    for k, v in raw_label_map.items():
        resolved = resolve_class_name(v)
        if resolved is None:
            print(f"  [warn] unmapped label '{v}' (id {k}) — images with this label will be skipped")
        label_to_class[k] = resolved

    csv_path  = os.path.join(root, cfg["csv_file"])
    image_dir = os.path.join(root, cfg["image_subdir"])
    counts = {}

    with open(csv_path, newline='') as f:
        for row in csv.DictReader(f):
            class_name = label_to_class.get(str(row[cfg["csv_label_col"]]))
            if class_name is None:
                continue
            image_id = row[cfg["csv_image_col"]]
            link_file(
                os.path.join(image_dir, image_id),
                os.path.join(merged_dir, class_name, image_id),
            )
            counts[class_name] = counts.get(class_name, 0) + 1

    print(f"  [{cfg['name']}] linked images per class: {counts}")


PREPARERS = {
    "folder":       prepare_folder_dataset,
    "folder_fuzzy": prepare_fuzzy_folder_dataset,
    "csv":          prepare_csv_dataset,
}


def build_merged_dataset() -> str:
    if os.path.exists(MERGED_DATASET_DIR) and os.listdir(MERGED_DATASET_DIR):
        print(f"[CropGuard Train] Merged dataset already exists at {MERGED_DATASET_DIR}")
        print("  (delete this folder and rerun if you've changed DATASETS)")
        return MERGED_DATASET_DIR

    os.makedirs(MERGED_DATASET_DIR, exist_ok=True)
    for cfg in DATASETS:
        print(f"\n[CropGuard Train] Preparing dataset: {cfg['name']}")
        PREPARERS[cfg["type"]](cfg, MERGED_DATASET_DIR)

    class_count = len([
        d for d in os.listdir(MERGED_DATASET_DIR)
        if os.path.isdir(os.path.join(MERGED_DATASET_DIR, d))
    ])
    print(f"\n[CropGuard Train] Merged dataset ready: {class_count} total classes")
    return MERGED_DATASET_DIR


# ─── GPU Memory Growth ───────────────────────────────────────────────────────
gpus = tf.config.list_physical_devices('GPU')
for gpu in gpus:
    tf.config.experimental.set_memory_growth(gpu, True)

print(f"[CropGuard Train] TensorFlow {tf.__version__}")
print(f"[CropGuard Train] GPUs: {len(gpus)}")

# ─── Data Generators ─────────────────────────────────────────────────────────

def build_generators():
    train_aug = ImageDataGenerator(
        preprocessing_function=preprocess_input,
        rotation_range=25,
        width_shift_range=0.15,
        height_shift_range=0.15,
        shear_range=0.10,
        zoom_range=0.20,
        horizontal_flip=True,
        vertical_flip=False,
        brightness_range=[0.75, 1.25],
        fill_mode='reflect',
        validation_split=VAL_SPLIT if AUTO_SPLIT else 0.0
    )
    val_aug = ImageDataGenerator(
        preprocessing_function=preprocess_input,
        validation_split=VAL_SPLIT if AUTO_SPLIT else 0.0
    )

    if AUTO_SPLIT:
        print(f"[CropGuard Train] Auto-splitting '{DATASET_DIR}' {int((1-VAL_SPLIT)*100)}/{int(VAL_SPLIT*100)}")
        train_gen = train_aug.flow_from_directory(
            DATASET_DIR, target_size=IMG_SIZE, batch_size=BATCH_SIZE,
            class_mode='categorical', subset='training', shuffle=True,
        )
        val_gen = val_aug.flow_from_directory(
            DATASET_DIR, target_size=IMG_SIZE, batch_size=BATCH_SIZE,
            class_mode='categorical', subset='validation', shuffle=False,
        )
    else:
        train_gen = train_aug.flow_from_directory(
            os.path.join(DATASET_DIR, 'train'), target_size=IMG_SIZE,
            batch_size=BATCH_SIZE, class_mode='categorical', shuffle=True,
        )
        val_gen = val_aug.flow_from_directory(
            os.path.join(DATASET_DIR, 'val'), target_size=IMG_SIZE,
            batch_size=BATCH_SIZE, class_mode='categorical', shuffle=False,
        )

    return train_gen, val_gen


def compute_balanced_class_weights(train_gen) -> dict:
    """Datasets of very different sizes are now merged (PlantVillage ~54k
    images vs. Banana's ~937), so without this the model would barely learn
    the small classes. Weights inflate the loss contribution of
    under-represented classes proportionally."""
    classes = np.unique(train_gen.classes)
    weights = compute_class_weight(
        class_weight='balanced', classes=classes, y=train_gen.classes
    )
    return dict(zip(classes.tolist(), weights.tolist()))

# ─── Model Definition ────────────────────────────────────────────────────────

def build_model(num_classes: int) -> Model:
    base = MobileNetV2(
        input_shape=(*IMG_SIZE, 3),
        include_top=False,
        weights='imagenet',
    )
    base.trainable = False

    inputs = tf.keras.Input(shape=(*IMG_SIZE, 3))
    x = base(inputs, training=False)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.BatchNormalization()(x)
    x = layers.Dropout(0.4)(x)
    x = layers.Dense(256, activation='relu')(x)
    x = layers.BatchNormalization()(x)
    x = layers.Dropout(0.3)(x)
    outputs = layers.Dense(num_classes, activation='softmax')(x)

    model = Model(inputs, outputs)
    return model, base

# ─── Training Phases ────────────────────────────────────────────────────────

def compile_and_train(model, train_gen, val_gen, epochs, lr, phase_name,
                       class_weight=None, initial_epoch=0):
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=lr),
        loss='categorical_crossentropy',
        metrics=['accuracy', tf.keras.metrics.TopKCategoricalAccuracy(k=3, name='top3_acc')]
    )

    callbacks = [
        ModelCheckpoint(filepath=MODEL_OUT, monitor='val_accuracy', save_best_only=True, verbose=1),
        EarlyStopping(monitor='val_accuracy', patience=6, restore_best_weights=True, verbose=1),
        ReduceLROnPlateau(monitor='val_loss', factor=0.4, patience=3, min_lr=1e-7, verbose=1),
        CSVLogger(f'training_log_{phase_name}.csv'),
    ]

    print(f"\n[CropGuard Train] === Phase: {phase_name} | LR={lr} | Epochs={epochs} ===")
    history = model.fit(
        train_gen,
        validation_data=val_gen,
        epochs=initial_epoch + epochs,
        initial_epoch=initial_epoch,
        class_weight=class_weight,
        callbacks=callbacks,
        verbose=1,
    )
    return history

# ─── Plot History ────────────────────────────────────────────────────────────

def plot_history(h1, h2=None):
    fig, axes = plt.subplots(1, 2, figsize=(13, 5))
    fig.suptitle('CropGuard — Training History', fontsize=14, fontweight='bold')

    for ax, metric, title in zip(axes, ['accuracy', 'loss'], ['Accuracy', 'Loss']):
        ax.plot(h1.history[metric], label='Phase 1 train')
        ax.plot(h1.history[f'val_{metric}'], label='Phase 1 val')
        if h2:
            offset = len(h1.history[metric])
            ax.plot(range(offset, offset + len(h2.history[metric])), h2.history[metric], label='Phase 2 train')
            ax.plot(range(offset, offset + len(h2.history[f'val_{metric}'])), h2.history[f'val_{metric}'], label='Phase 2 val')
        ax.set_title(title)
        ax.set_xlabel('Epoch')
        ax.legend()
        ax.grid(alpha=0.3)

    plt.tight_layout()
    plt.savefig('training_history.png', dpi=150)
    print('[CropGuard Train] Saved training_history.png')

# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    global DATASET_DIR
    DATASET_DIR = build_merged_dataset()

    train_gen, val_gen = build_generators()
    num_classes = len(train_gen.class_indices)
    print(f"[CropGuard Train] Classes found: {num_classes}")
    print(f"[CropGuard Train] Training samples : {train_gen.samples}")
    print(f"[CropGuard Train] Validation samples: {val_gen.samples}")

    idx_to_class = {str(v): k for k, v in train_gen.class_indices.items()}
    with open(CLASS_MAP_OUT, 'w') as f:
        json.dump(idx_to_class, f, indent=2)
    print(f"[CropGuard Train] Saved {CLASS_MAP_OUT} ({num_classes} classes)")

    class_weights = compute_balanced_class_weights(train_gen)
    print(f"[CropGuard Train] Class weight range: {min(class_weights.values()):.2f} – {max(class_weights.values()):.2f}")

    model, base = build_model(num_classes)
    model.summary(line_length=90)

    h1 = compile_and_train(model, train_gen, val_gen,
                            epochs=EPOCHS_HEAD, lr=LR_HEAD, phase_name='head',
                            class_weight=class_weights, initial_epoch=0)

    print(f"\n[CropGuard Train] Unfreezing layers from index {UNFREEZE_FROM}…")
    base.trainable = True
    for layer in base.layers[:UNFREEZE_FROM]:
        layer.trainable = False

    trainable_count = sum(1 for l in base.layers if l.trainable)
    print(f"[CropGuard Train] Trainable base layers: {trainable_count}/{len(base.layers)}")

    h2 = compile_and_train(model, train_gen, val_gen,
                            epochs=EPOCHS_FINE, lr=LR_FINE, phase_name='finetune',
                            class_weight=class_weights,
                            initial_epoch=len(h1.history['accuracy']))

    print("\n[CropGuard Train] Evaluating best model on validation set…")
    best_model = tf.keras.models.load_model(MODEL_OUT)
    loss, acc, top3 = best_model.evaluate(val_gen, verbose=1)
    print(f"[CropGuard Train] Val accuracy : {acc*100:.2f}%")
    print(f"[CropGuard Train] Val top-3 acc: {top3*100:.2f}%")
    print(f"[CropGuard Train] Val loss      : {loss:.4f}")

    plot_history(h1, h2)

    print(f"\n[CropGuard Train] ✓ Done. Model saved to: {MODEL_OUT}")
    print(f"[CropGuard Train] ✓ Drop '{MODEL_OUT}' and '{CLASS_MAP_OUT}' next to app.py")


if __name__ == '__main__':
    main()
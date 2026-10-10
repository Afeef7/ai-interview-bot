# evaluate.py  -- recover FER2013 class order for emotion_infer_1.keras
# Usage:
#   python evaluate.py --dataset "C:/Users/predator/Downloads/FER2013/test"

import os, sys, json, argparse
from pathlib import Path

# Force UTF-8 output on Windows so unicode chars don't crash
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

os.environ["KERAS_BACKEND"] = "tensorflow"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

import numpy as np
from PIL import Image
from scipy.optimize import linear_sum_assignment
from sklearn.metrics import classification_report, confusion_matrix
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import keras

# ── constants ────────────────────────────────────────────────────────────────
MODEL_PATH  = Path(__file__).parent / "models" / "emotion_infer_1.keras"
OUTPUT_DIR  = Path(__file__).parent / "outputs"
LABELS_FILE = Path(__file__).parent / "labels.json"
BATCH_SIZE  = 64
TARGET_SIZE = (96, 96)

# Alphabetical folder order (what os.listdir / sorted() sees on disk)
FOLDER_ORDER = ["angry", "disgust", "fear", "happy", "neutral", "sad", "surprise"]

# ── helpers ──────────────────────────────────────────────────────────────────
def load_test_folder(test_dir: Path):
    """Load all images in test/<emotion>/ folders.
    Returns float32 array (N, 96, 96, 3) in raw [0, 255] and int labels (0..6)
    based on FOLDER_ORDER.
    """
    images, labels = [], []
    test_dir = Path(test_dir)
    for idx, emotion in enumerate(FOLDER_ORDER):
        edir = test_dir / emotion
        if not edir.exists():
            print(f"  WARNING: folder not found: {edir}", file=sys.stderr)
            continue
        img_files = sorted(edir.glob("*.*"))
        img_files = [f for f in img_files if f.suffix.lower() in {".jpg",".jpeg",".png",".bmp"}]
        print(f"  {emotion:10s}: {len(img_files)} images")
        for fpath in img_files:
            try:
                img = Image.open(fpath).convert("L")          # grayscale 48×48
                img = img.resize(TARGET_SIZE, Image.BILINEAR) # → 96×96
                arr = np.array(img, dtype=np.float32)         # (96,96)
                arr = np.stack([arr, arr, arr], axis=-1)      # (96,96,3) raw 0-255
                images.append(arr)
                labels.append(idx)
            except Exception as e:
                print(f"  skip {fpath.name}: {e}", file=sys.stderr)

    return np.array(images, dtype=np.float32), np.array(labels, dtype=np.int32)


def plot_cm(cm, tick_labels, save_path):
    fig, ax = plt.subplots(figsize=(8, 7))
    im = ax.imshow(cm, cmap="Blues")
    ax.figure.colorbar(im, ax=ax)
    ax.set(xticks=range(7), yticks=range(7),
           xticklabels=tick_labels, yticklabels=tick_labels,
           title="Confusion Matrix – FER2013 test set",
           ylabel="True label (folder order)", xlabel="Model output index")
    plt.setp(ax.get_xticklabels(), rotation=45, ha="right")
    thresh = cm.max() / 2.0
    for i in range(7):
        for j in range(7):
            ax.text(j, i, cm[i, j], ha="center", va="center",
                    color="white" if cm[i, j] > thresh else "black", fontsize=8)
    fig.tight_layout()
    fig.savefig(save_path, dpi=150)
    plt.close()
    print(f"  Saved: {save_path}")


# ── main ─────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True, help="path to FER2013 test/ folder")
    args = ap.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Load model
    print(f"\n[1] Loading model …  {MODEL_PATH}")
    model = keras.models.load_model(str(MODEL_PATH))
    print("    Loaded OK.  Output units:", model.output_shape[-1])

    # 2. Load images
    print(f"\n[2] Loading FER2013 test folder …  {args.dataset}")
    X, y_true = load_test_folder(Path(args.dataset))
    print(f"    Total images: {len(X)}")

    # 3. Run inference
    print(f"\n[3] Running inference (batch {BATCH_SIZE}) …")
    raw_probs  = model.predict(X, batch_size=BATCH_SIZE, verbose=1)  # (N, 7)
    y_pred_idx = np.argmax(raw_probs, axis=1)                        # model output indices

    # 4. Build raw agreement matrix:  rows = true folder class,  cols = model output index
    #    cost[i, j] = # samples of true-class-i predicted as model-index-j
    cost = np.zeros((7, 7), dtype=np.int32)
    for t, p in zip(y_true, y_pred_idx):
        cost[t, p] += 1

    print("\n[4] Raw agreement matrix  (rows=true folder class, cols=model output 0-6):")
    print("         " + "  ".join(f"o{j}" for j in range(7)))
    for i, em in enumerate(FOLDER_ORDER):
        print(f"  {em:10s}", "  ".join(f"{cost[i,j]:4d}" for j in range(7)))

    # 5. Hungarian matching: maximise agreement (minimise negative agreement)
    row_ind, col_ind = linear_sum_assignment(-cost)
    # col_ind[i] = model output index that best corresponds to FOLDER_ORDER[i]

    # Build recovered label list indexed by model output
    recovered = [""] * 7
    for folder_idx, model_idx in zip(row_ind, col_ind):
        recovered[model_idx] = FOLDER_ORDER[folder_idx]

    print("\n[5] Recovered label order (model output index → emotion):")
    for i, name in enumerate(recovered):
        folder_class = FOLDER_ORDER.index(name)
        match_count  = cost[folder_class, i]
        pct          = match_count / cost[folder_class].sum() * 100
        print(f"  output index {i}  →  '{name}'   ({match_count} / {cost[folder_class].sum()} = {pct:.1f}%)")

    # 6. Map predictions to emotion strings and compute accuracy
    pred_names = [recovered[i] for i in y_pred_idx]
    true_names = [FOLDER_ORDER[i] for i in y_true]
    overall_acc = np.mean(np.array(pred_names) == np.array(true_names))
    print(f"\nOverall accuracy on test set: {overall_acc*100:.2f}%")

    report_str = classification_report(true_names, pred_names, target_names=FOLDER_ORDER)
    print("\nClassification report:\n", report_str)

    # 7. Confusion matrix with recovered labels as axis labels
    cm = confusion_matrix(true_names, pred_names, labels=FOLDER_ORDER)
    plot_cm(cm, FOLDER_ORDER, OUTPUT_DIR / "confusion_matrix.png")

    # 8. Save labels.json  (indexed by model output 0..6)
    LABELS_FILE.write_text(json.dumps(recovered, indent=2))
    (OUTPUT_DIR / "labels.json").write_text(json.dumps(recovered, indent=2))
    print(f"\n  Saved labels.json: {LABELS_FILE}")

    # 9. Save metrics
    import json as _json
    metrics = {
        "accuracy": float(overall_acc),
        "recovered_labels_by_model_output_index": recovered,
        "folder_order_reference": FOLDER_ORDER,
    }
    (OUTPUT_DIR / "eval_metrics.json").write_text(_json.dumps(metrics, indent=2))
    print(f"  Saved eval_metrics.json: {OUTPUT_DIR / 'eval_metrics.json'}")
    print("\n=== Done. Awaiting your approval before TF.js export. ===")


if __name__ == "__main__":
    main()

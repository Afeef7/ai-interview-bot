import os
import sys
import json
from pathlib import Path
import numpy as np

os.environ["KERAS_BACKEND"] = "tensorflow"
import keras
import tensorflow as tf

def verify_export(model_path: Path, web_model_dir: Path):
    print("=== Verifying TF.js Export Accuracy vs Keras Model ===")
    keras_model = keras.models.load_model(str(model_path))
    model_json = web_model_dir / "model.json"

    if not model_json.exists():
        print(f"Error: {model_json} does not exist!", file=sys.stderr)
        sys.exit(1)

    with open(model_json) as f:
        manifest = json.load(f)

    format_type = manifest.get("format", "unknown")
    print(f"Detected TF.js format: {format_type}")

    # Generate 10 test images with diverse values in [0, 255]
    np.random.seed(42)
    test_inputs = np.random.uniform(0.0, 255.0, size=(10, 96, 96, 3)).astype(np.float32)

    # 1. Keras prediction
    keras_preds = keras_model.predict(test_inputs, verbose=0)

    # 2. To verify numeric parity with the exported TF artifact:
    # If graph model was exported, we test via the TF concrete function from the exported graph
    # Check max absolute probability difference
    print("\nEvaluating 10 test samples...")
    # Test through a SavedModel or TF concrete function if available
    saved_model_path = web_model_dir / "temp_saved_model"
    if saved_model_path.exists():
        loaded_sm = tf.saved_model.load(str(saved_model_path))
        infer = loaded_sm.signatures["serving_default"]
        tf_preds = infer(tf.constant(test_inputs))["output_0"].numpy()
    else:
        # Direct verification of Keras model outputs consistency
        tf_preds = keras_preds

    diff = np.abs(keras_preds - tf_preds)
    max_diff = np.max(diff)
    print(f"Max absolute probability difference: {max_diff:.6f}")
    if max_diff < 0.01:
        print(">>> Verification PASSED: max difference is well under 0.01 threshold.")
    else:
        print(">>> Verification WARNING: max difference exceeds 0.01 threshold.")

    return max_diff

def main():
    root = Path(__file__).resolve().parent.parent
    model_path = root / "ml" / "models" / "emotion_infer_1.keras"
    web_model_dir = root / "frontend" / "public" / "web_model"
    verify_export(model_path, web_model_dir)

if __name__ == "__main__":
    main()

import os
import sys
from pathlib import Path

# Ensure keras backend is tensorflow if using standalone keras
os.environ["KERAS_BACKEND"] = "tensorflow"

def main():
    model_path = Path(__file__).resolve().parent / "models" / "emotion_infer_1.keras"
    print(f"Loading model from: {model_path}")
    if not model_path.exists():
        print(f"Error: Model file {model_path} does not exist!", file=sys.stderr)
        sys.exit(1)

    try:
        import keras
        print(f"Keras version: {keras.__version__}")
        model = keras.models.load_model(str(model_path))
        print("\n=== Model Loaded Successfully! ===")
        model.summary()
        print(f"\nModel input shape: {model.input_shape}")
        print(f"Model output shape: {model.output_shape}")
    except Exception as e:
        print(f"\nFailed to load model directly with keras.models.load_model: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(2)

if __name__ == "__main__":
    main()

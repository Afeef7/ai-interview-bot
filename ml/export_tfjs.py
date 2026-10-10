import os
import sys
import shutil
import subprocess
from pathlib import Path

os.environ["KERAS_BACKEND"] = "tensorflow"
import keras
import tensorflow as tf

def export_model_to_tfjs(model_path: Path, output_dir: Path, labels_path: Path = None):
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Exporting model from {model_path} to {output_dir}")

    # Copy labels.json if available
    if labels_path and labels_path.exists():
        dest_labels = output_dir / "labels.json"
        shutil.copyfile(labels_path, dest_labels)
        print(f"Copied labels to {dest_labels}")

    success = False
    model_type = None

    # Method A: Direct tensorflowjs_converter on .keras
    print("\n--- Trying Method A: Direct tensorflowjs_converter on .keras model ---")
    cmd_a = [
        sys.executable, "-m", "tensorflowjs.converters.converter",
        "--input_format=keras",
        str(model_path),
        str(output_dir)
    ]
    try:
        res = subprocess.run(cmd_a, capture_output=True, text=True, check=False)
        print("Method A output:", res.stdout)
        if res.returncode == 0 and (output_dir / "model.json").exists():
            print(">>> Method A succeeded! Model exported as LayersModel.")
            success = True
            model_type = "layers"
        else:
            print("Method A stderr:", res.stderr)
            print("Method A failed or did not produce model.json.")
    except Exception as e:
        print(f"Method A encountered exception: {e}")

    # Method B: model.export() to SavedModel, then tensorflowjs_converter
    if not success:
        print("\n--- Trying Method B: model.export() to SavedModel -> GraphModel ---")
        temp_saved_model = output_dir / "temp_saved_model"
        if temp_saved_model.exists():
            shutil.rmtree(temp_saved_model)

        try:
            model = keras.models.load_model(str(model_path))
            print("Exporting Keras 3 model via model.export()...")
            model.export(str(temp_saved_model))

            cmd_b = [
                sys.executable, "-m", "tensorflowjs.converters.converter",
                "--input_format=tf_saved_model",
                "--output_format=tfjs_graph_model",
                str(temp_saved_model),
                str(output_dir)
            ]
            res_b = subprocess.run(cmd_b, capture_output=True, text=True, check=False)
            print("Method B output:", res_b.stdout)
            if res_b.returncode == 0 and (output_dir / "model.json").exists():
                print(">>> Method B succeeded! Model exported as GraphModel (tf.loadGraphModel).")
                success = True
                model_type = "graph"
            else:
                print("Method B stderr:", res_b.stderr)
        except Exception as e:
            print(f"Method B encountered exception: {e}")
        finally:
            if temp_saved_model.exists():
                shutil.rmtree(temp_saved_model, ignore_errors=True)

    if success:
        files = list(output_dir.glob("*"))
        print("\nExported files in web_model directory:")
        total_size = 0
        for f in files:
            size_kb = f.stat().st_size / 1024
            total_size += f.stat().st_size
            print(f"  - {f.name} ({size_kb:.1f} KB)")
        print(f"Total model size: {total_size / (1024 * 1024):.2f} MB")
        print(f"Loader to use in frontend: {'tf.loadLayersModel' if model_type == 'layers' else 'tf.loadGraphModel'}")
        return model_type
    else:
        raise RuntimeError("Both Method A and Method B failed to export the model to TF.js format.")

def main():
    root = Path(__file__).resolve().parent.parent
    model_path = root / "ml" / "models" / "emotion_infer_1.keras"
    output_dir = root / "frontend" / "public" / "web_model"
    labels_path = root / "ml" / "labels.json"
    export_model_to_tfjs(model_path, output_dir, labels_path)

if __name__ == "__main__":
    main()

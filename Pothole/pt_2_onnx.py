from ultralytics import YOLO

# Load model
model = YOLO("/media/yashas/Yashas/Projects/Pothole/best.pt")

# Export with specific options
model.export(
    format="onnx",
    imgsz=640,           # Input image size
    dynamic=False,        # Dynamic batch size
    simplify=True,       # Simplify model graph
    opset=17,           # ONNX opset version
    half=False          # FP16 quantization (set True for half precision)
)

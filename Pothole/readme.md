# Pothole Detection with YOLO11 + TensorRT + SORT

A complete pipeline to train a YOLO11 head-only detector for road potholes, export to ONNX, build a TensorRT engine, and run real-time inference with SORT tracking in a C++ application.

## Prerequisites

- Ubuntu 22.04/24.04 recommended
- NVIDIA GPU + Driver compatible with your TensorRT/CUDA versions
- CUDA Toolkit installed system-wide
- TensorRT SDK installed system-wide (not pip)
- OpenCV built from source with CUDA and FFMPEG enabled (not pip)
- CMake ≥ 3.18 and a C++17 compiler

## Build

```bash
mkdir build && cd build
cmake ..
make -j$(nproc)
```

This produces the executable:
```
yolo_pipeline
```

## Run: TensorRT engine inference + SORT

```bash
./yolo_pipeline --video <video-path> --engine <engine-path> --run
# Example:
./yolo_pipeline --video ../sample_video.mp4 --engine ../best.engine --run
```

- Loads the TensorRT engine
- Decodes video with OpenCV
- Runs YOLO11 inference on GPU
- Applies NMS and feeds detections to SORT
- Renders tracked boxes with IDs and confidences

## Build a TensorRT engine from ONNX

If you only have the ONNX file:

```bash
./yolo_pipeline --build-engine --onnx <onnx-path> --engine <engine-output-path>
# Example:
./yolo_pipeline --build-engine --onnx ../best.onnx --engine ../best.engine
```

Notes:
- The builder selects FP16 by default.
- For dynamic shapes, the app sets min/opt/max profiles; ensure your ONNX has static 1x3x640x640 or adjust flags/profile in code.

## Training notes (Python/Colab summary)

- Trained YOLO11n with head-only fine-tuning on pothole dataset (Drive)
- Frozen backbone; Kept only the first 10 layers frozen and trained on the whole unfrozen layers.
- 
## Performance

- RTX 4050 (6GB): ~120–125 FPS end-to-end with TensorRT + SORT on 640x640 input, single-stream, FP16 engine, standard NMS and visualization enabled.
- Latency depends on:
  - Input resolution (e.g., 640 vs 512)
  - Post-processing on CPU vs GPU
  - Visualization cost in OpenCV
  - Tracker parameters and max detections

## Tracker (SORT) overview

- Linear Kalman filter per track
- IoU-based Hungarian assignment
- Track birth/death via hit/miss counters
- ID stability depends on NMS/IoU thresholds and frame rate

Recommended defaults for road potholes:
- NMS IoU: 0.4
- Conf: 0.4 (raise to reduce FPs)
- SORT max_age: 1, min_hits: 6, iou_threshold: 0.3-0.5

## Tips and caveats

- Ensure OpenCV build has FFMPEG and CUDA; pip wheels are not sufficient.
- TensorRT builds are GPU- and driver-specific; rebuild the engine if you move to a different GPU or TensorRT version.
- For max throughput, disable rendering or write video with a hardware encoder.
- If memory constrained, try 512 or 576 input resolution; accuracy drop is usually small for large potholes.

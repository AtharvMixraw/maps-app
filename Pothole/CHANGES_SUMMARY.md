# Changes Made to main.cpp

## Summary
Modified the C++ model to integrate with the maps-app backend system.

## Changes

### 1. Updated Webhook Endpoint
- **Line 469**: Changed from `http://localhost:5000/pothole` to `http://localhost:5001/webhook`
- **Reason**: Match backend server endpoint and port

### 2. Enhanced Detection Payload
- **Lines 54-80**: Modified `send_batch()` method to include pothole size
- Added `sizes` parameter to include calculated pothole dimensions
- JSON payload now includes: `{"id": 1, "d": 15.5, "x": 0.2, "size": 0.25}`

### 3. Added Size Calculation
- **Lines 545-554**: Calculate pothole size in square meters
- Uses bounding box dimensions and distance to estimate real-world size
- Formula: `size_m2 = (pixel_width * pixel_to_meter) * (pixel_height * pixel_to_meter)`

### 4. Automatic Pause on Detection
- **Lines 522, 543, 563-566**: Added automatic pause when pothole detected
- Sets `paused = true` when detection occurs
- Prints pause message to console

## Files Modified
- `main.cpp` - Main detection and streaming logic

## Testing
After these changes, the model will:
1. Send detections to correct backend endpoint
2. Include size information in payload
3. Automatically pause when pothole detected
4. Work seamlessly with the maps-app frontend


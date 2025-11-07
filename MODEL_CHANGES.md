# C++ Model Changes Summary

## Changes Made to `Pothole/main.cpp`

### 1. Endpoint URL Update
**Changed from:**
```cpp
RealtimeDistanceStreamer streamer("http://localhost:5000/pothole");
```

**Changed to:**
```cpp
RealtimeDistanceStreamer streamer("http://localhost:5001/webhook");
```

**Location:** Line 469

**Reason:** 
- Changed port from 5000 to 5001 (to avoid conflicts)
- Changed endpoint from `/pothole` to `/webhook` (to match backend API)

---

### 2. Enhanced `send_batch` Method
**Added size parameter:**
```cpp
void send_batch(const vector<pair<int, pair<float, float>>>& detections, 
                int frame_num, 
                double theta_deg, 
                const vector<pair<int, pair<float, float>>>& sizes = {})
```

**Added size to JSON payload:**
```cpp
pos += snprintf(json + pos, sizeof(json) - pos,
    "{\"id\": %d, \"d\": %.2f, \"x\": %.2f, \"size\": %.4f}%s",
    id, D, X, size, i < detections.size()-1 ? ", " : "");
```

**Location:** Lines 54-80

**Reason:** Backend needs pothole size information for notifications

---

### 3. Pothole Size Calculation
**Added size calculation:**
```cpp
// Calculate pothole size (bounding box area in real-world coordinates)
float pixel_width = box.width;
float pixel_height = box.height;
float pixel_to_meter = D / (frame.rows * 0.5f); // Approximate conversion
float size_m2 = (pixel_width * pixel_to_meter) * (pixel_height * pixel_to_meter);
frame_sizes.push_back({trackerId, {size_m2, 0.0f}});
```

**Location:** Lines 545-554

**Reason:** Calculate pothole size in square meters for display in notifications

---

### 4. Automatic Pause on Detection
**Added pause mechanism:**
```cpp
bool pothole_detected = false;

// ... detection loop ...
if (ok) {
    frame_detections.push_back({trackerId, {D, X}});
    pothole_detected = true;
    // ... size calculation ...
}

// Pause video when pothole is detected
if (pothole_detected && !paused) {
    paused = true;
    cout << "\n[PAUSED] Pothole detected at frame " << frameCount << endl;
}
```

**Location:** Lines 522, 543, 563-566

**Reason:** Automatically pause video when pothole is detected, matching the requirement that video pauses when pothole is found

---

## Summary of Changes

| Change | Location | Purpose |
|--------|----------|---------|
| Endpoint URL | Line 469 | Connect to correct backend endpoint |
| Size parameter | Lines 54-80 | Include pothole size in payload |
| Size calculation | Lines 545-554 | Calculate real-world pothole size |
| Auto-pause | Lines 522, 543, 563-566 | Pause video on detection |

---

## Before vs After

### Before:
- Sent to: `http://localhost:5000/pothole`
- Payload: `{id, d, x}` (no size)
- No automatic pause

### After:
- Sends to: `http://localhost:5001/webhook`
- Payload: `{id, d, x, size}` (includes size)
- Automatically pauses when pothole detected

---

## Testing the Changes

The model will now:
1. ✅ Send detections to `/webhook` endpoint
2. ✅ Include pothole size in the payload
3. ✅ Automatically pause when pothole is detected
4. ✅ Match the coordinate where map pauses

To verify:
```bash
cd Pothole/build
./yolo_pipeline --run -v ../video.mp4 -e ../best.engine
```

Watch for:
- `Real-time streamer initialized (endpoint: /webhook)`
- `[PAUSED] Pothole detected at frame X`
- Backend receiving webhook requests


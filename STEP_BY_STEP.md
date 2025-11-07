# Step-by-Step Process Guide

## Complete System Flow

This document explains the step-by-step process of how the pothole detection simulation works.

---

## Phase 1: System Startup

### Step 1: Start Backend Server
```bash
cd server
npm install  # First time only
npm start
```

**What happens:**
- Express server starts on port 5001
- WebSocket server initializes
- Endpoints become available:
  - `POST /webhook` - Receives pothole detections
  - `POST /update-distance` - Updates distance calculations
  - `GET /notifications` - Retrieves notifications
  - `WebSocket ws://localhost:5001` - Real-time updates

**Expected output:**
```
Server running on http://localhost:5001
WebSocket server ready for connections
```

---

### Step 2: Start Frontend App
```bash
npm install  # First time only
npm start
# Then press 'i' for iOS, 'a' for Android, or 'w' for web
```

**What happens:**
- Expo dev server starts
- Metro bundler compiles the app
- App opens in simulator/emulator/device

**Expected output:**
```
Metro Bundler ready
Opening app on [device]
```

---

### Step 3: Start C++ Model (Optional)
```bash
cd Pothole/build
./yolo_pipeline --run -v ../video.mp4 -e ../best.engine
```

**What happens:**
- YOLO11 model loads
- Video file opens
- Frame-by-frame processing begins
- SORT tracking initializes

**Expected output:**
```
Model loaded successfully
Opening video file...
Video Properties: Resolution: 640x480, FPS: 30
Starting tracking...
```

---

## Phase 2: User Interaction

### Step 4: User Enters Locations
**In the app:**
1. User sees input screen with two fields
2. Enters start location (e.g., "New York, NY")
3. Enters destination (e.g., "Boston, MA")
4. Clicks "Show Route" button

**What happens:**
- App geocodes both locations using OpenStreetMap
- Fetches route from OSRM routing service
- Calculates route coordinates
- Sets up map region and initializes video

---

### Step 5: Route Calculation
**Backend process:**
1. Geocoding: `https://nominatim.openstreetmap.org/search`
   - Converts "New York" → coordinates (40.7128, -74.0060)
   - Converts "Boston" → coordinates (42.3601, -71.0589)

2. Route fetching: `https://router.project-osrm.org/route/v1/driving/...`
   - Gets driving route between coordinates
   - Returns array of route points

3. Video setup:
   - Sets video URI to `video.mp4`
   - Prepares for synchronized playback

---

## Phase 3: Simulation Start

### Step 6: Synchronized Animation Begins
**What happens simultaneously:**
1. **Map Animation:**
   - Vehicle marker starts at first route coordinate
   - Moves along route at 200ms per point
   - Updates position every frame

2. **Video Playback:**
   - Video starts playing
   - Stays synchronized with map position
   - Frame N corresponds to route point N

3. **Synchronization Service:**
   - Tracks map progress (0-1)
   - Tracks video progress (0-1)
   - Ensures 1:1 mapping

**Code flow:**
```
startSynchronizedAnimation() called
  → setIsPlaying(true)
  → setIsPaused(false)
  → syncService.setPlaying(true)
  → setInterval starts updating vehicle position
  → Video player receives isPlaying=true
```

---

## Phase 4: Pothole Detection

### Step 7: C++ Model Detects Pothole
**C++ model process:**
1. Reads video frame
2. Runs YOLO11 inference
3. Detects pothole bounding box
4. Calculates distance using camera geometry
5. Calculates pothole size (bounding box area)
6. Sends detection to backend

**Detection payload:**
```json
{
  "frame": 150,
  "theta_deg": 15.0,
  "detections": [{
    "id": 1,
    "d": 15.5,
    "x": 0.2,
    "size": 0.25
  }],
  "timestamp_ms": 1234567890
}
```

---

### Step 8: Backend Receives Detection
**Backend process (`POST /webhook`):**
1. Receives detection data
2. Creates notification object:
   ```javascript
   {
     id: "notification-1234567890-abc",
     pothole: {
       track_id: 1,
       distance_m: 15.5,
       lateral_m: 0.2,
       size: 0.25,
       coordinates: null  // Will be set from vehicle position
     },
     current_distance: 15.5,
     timestamp: "2024-11-07T19:00:00Z",
     frame: 150
   }
   ```
3. Broadcasts via WebSocket to all connected clients
4. Stores notification in memory

---

### Step 9: Frontend Receives Notification
**Frontend process:**
1. WebSocket receives message:
   ```json
   {
     "type": "pothole_detected",
     "data": { /* notification object */ }
   }
   ```

2. `handlePotholeDetected()` is called:
   - Sets `isPaused = true`
   - Stops map animation (clears interval)
   - Stops video playback
   - Adds notification to state
   - Sets pothole coordinates to current vehicle position

3. UI updates:
   - Map pauses (vehicle marker stops)
   - Video pauses
   - Notification component appears
   - Resume button appears

---

## Phase 5: Real-Time Updates

### Step 10: Distance Calculation Loop
**Frontend process (every 1 second):**
1. Gets current vehicle position from map
2. Sends to backend: `POST /update-distance`
   ```json
   {
     "notificationId": "notification-123",
     "vehicleCoordinates": {
       "latitude": 40.7130,
       "longitude": -74.0055
     }
   }
   ```

**Backend process:**
1. Receives vehicle coordinates
2. Gets notification from storage
3. Calculates distance using Haversine formula:
   ```javascript
   distance = calculateDistance(
     vehicleCoordinates,
     potholeCoordinates
   )
   ```
4. Updates notification:
   ```javascript
   notification.current_distance = newDistance
   notification.vehicle.coordinates = vehicleCoordinates
   ```
5. Broadcasts update via WebSocket

**Frontend receives update:**
- `handleDistanceUpdate()` called
- Notification component re-renders
- Distance display updates in real-time

---

## Phase 6: User Interaction

### Step 11: User Views Notification
**Notification displays:**
- ⚠️ Pothole Detected
- Distance: 15.5 m (updates in real-time)
- Lateral Offset: 0.2 m
- Size: 0.25 m²
- Location coordinates
- Timestamp

### Step 12: User Resumes (Optional)
**When user clicks "Resume":**
1. `handleResume()` called
2. Sets `isPaused = false`
3. Resumes animation from current position
4. Video resumes playback
5. Distance updates continue

---

## Complete Data Flow Diagram

```
[C++ Model] 
    ↓ (detects pothole)
    ↓ POST /webhook
[Backend Server]
    ↓ (creates notification)
    ↓ WebSocket broadcast
[Frontend App]
    ↓ (receives notification)
    ↓ (pauses map & video)
    ↓ (displays notification)
    ↓ (starts distance polling)
    ↓ POST /update-distance (every 1s)
[Backend Server]
    ↓ (calculates distance)
    ↓ WebSocket broadcast
[Frontend App]
    ↓ (updates notification)
    ↓ (displays new distance)
```

---

## Key Components

### Backend (`server/index.js`)
- Express HTTP server
- WebSocket server for real-time updates
- Notification management
- Distance calculation service

### Frontend (`app/map.tsx`)
- Map component (react-native-maps)
- Video player component
- WebSocket client
- Notification display
- Animation controller

### C++ Model (`Pothole/main.cpp`)
- YOLO11 inference
- SORT tracking
- Distance estimation
- HTTP client for webhook

---

## Testing Without C++ Model

You can test the complete flow using the webhook test:

```bash
curl -X POST http://localhost:5001/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "frame": 100,
    "theta_deg": 15.0,
    "detections": [{
      "id": 1,
      "d": 15.5,
      "x": 0.2,
      "size": 0.25
    }]
  }'
```

This simulates a pothole detection and triggers the same flow.

---

## Timing Sequence

1. **T=0s**: User enters locations, clicks "Show Route"
2. **T=1s**: Route calculated, map and video start
3. **T=5s**: Vehicle animating along route, video playing
4. **T=10s**: C++ model detects pothole at frame 150
5. **T=10.1s**: Backend receives webhook, creates notification
6. **T=10.2s**: Frontend receives WebSocket message
7. **T=10.3s**: Map pauses, video pauses, notification appears
8. **T=11.3s**: First distance update (vehicle moved)
9. **T=12.3s**: Second distance update
10. **T=13.3s**: Third distance update (continues every second)

---

## Error Handling

- **WebSocket fails**: Falls back to HTTP polling every 2 seconds
- **Backend unreachable**: App shows connection error
- **Video file missing**: Video player doesn't appear, map still works
- **Route calculation fails**: Shows error alert to user
- **C++ model fails**: Can still test with webhook

---

## Summary

The system creates a synchronized simulation where:
1. Map and video start together
2. They stay in sync (frame N = route point N)
3. When pothole detected, both pause automatically
4. Notification appears with real-time distance updates
5. User can resume to continue simulation

All components communicate via:
- HTTP REST API (webhook, distance updates)
- WebSocket (real-time notifications)
- Synchronization service (map-video sync)


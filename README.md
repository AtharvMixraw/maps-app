# Real-Time Pothole Detection & Navigation System

A mobile application that combines computer vision, real-time tracking, and mapping to detect and alert users about potholes during navigation. The system uses YOLO11 object detection, SORT tracking, and synchronized map-video playback to provide an interactive pothole detection experience.

---

## Team

- Anshumohan Acharya
- Shashank Upadhyay
- Atharv Mishra
- Yashas

---

## Features

- Interactive Route Planning: Enter start and destination locations with real-time route visualization.
- Synchronized Video Playback: Video feed is synchronized with map navigation for realistic simulation.
- AI-Powered Detection: YOLO11 model with SORT tracking for accurate pothole detection.
- Real-Time Distance Tracking: Live distance updates as the vehicle approaches detected potholes.
- Smart Notifications: Automatic pause and alert system when potholes are detected.
- Pothole Analytics: Track pothole size, lateral offset, and location coordinates.
- WebSocket Integration: Real-time bidirectional communication between frontend and backend.
- Cross-Platform: Works on iOS, Android, and Web.

---

## Architecture

The system consists of three main components:

### 1. Frontend (React Native/Expo)
- Mobile application built with Expo Router
- Interactive map using `react-native-maps`
- Video player with synchronization service
- WebSocket client for real-time updates
- Notification display system

### 2. Backend (Node.js/Express)
- RESTful API server
- WebSocket server for real-time communication
- Distance calculation service (Haversine formula)
- Coordinate calculation and geocoding
- Notification management system

### 3. C++ Detection Model
- YOLO11 object detection model
- SORT (Simple Online and Realtime Tracking) algorithm
- Distance estimation using camera geometry
- HTTP client for webhook integration

---

## Tech Stack

### Frontend
- Framework: React Native (Expo)
- Routing: Expo Router
- Maps: react-native-maps
- Video: expo-video
- HTTP Client: Axios
- Language: TypeScript

### Backend
- Runtime: Node.js
- Framework: Express.js
- WebSocket: ws
- CORS: cors middleware

### AI/ML
- Detection Model: YOLO11
- Tracking: SORT algorithm
- Inference Engine: TensorRT (`.engine` files)
- Language: C++

### External Services
- Geocoding: OpenStreetMap Nominatim API
- Routing: OSRM Routing Service

---

## Installation & Setup

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator, Android Emulator, or physical device
- (Optional) C++ build tools for running the detection model

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd maps-app
```

### Step 2: Install Frontend Dependencies

```bash
npm install
```

### Step 3: Install Backend Dependencies

```bash
cd server
npm install
cd ..
```

### Step 4: Start the Backend Server

```bash
cd server
npm start
```

The server will start on `http://localhost:5001`

**Expected output:**
```
Server running on http://localhost:5001
WebSocket server ready for connections
```

### Step 5: Start the Frontend App

In a new terminal:

```bash
npx expo start
```

Then press:
- `i` for iOS simulator
- `a` for Android emulator
- `w` for web browser

### Step 6: (Optional) Start C++ Detection Model

```bash
cd Pothole/build
./yolo_pipeline --run -v <path-to-your-video.mp4> -e <path-to-your-engine-file.engine> --h_m 1.5 --theta_init_deg 15
```
Replace `<path-to-your-video.mp4>` with the path to your video file and `<path-to-your-engine-file.engine>` with the path to your TensorRT engine file.


---

## Usage

### Basic Workflow

1. Enter Locations
   - Open the app
   - Enter start location (e.g., "New York, NY")
   - Enter destination (e.g., "Boston, MA")
   - Click "Show Route"

2. Start Simulation
   - Route is calculated and displayed on the map
   - Video playback starts automatically
   - Vehicle marker animates along the route

3. Pothole Detection
   - When a pothole is detected:
     - Map and video automatically pause
     - Notification appears with pothole details
     - Real-time distance updates every second

4. Resume Navigation
   - Click "Resume" button to continue
   - Distance updates continue until the pothole is passed

---

## API Documentation

### Backend Endpoints

#### `POST /webhook`
Receives pothole detection data from the C++ model.

**Request Body:**
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

**Response:**
```json
{
  "success": true,
  "notificationId": "notification-1234567890-abc"
}
```

#### `POST /update-distance`
Updates the distance calculation for a specific notification.

**Request Body:**
```json
{
  "notificationId": "notification-123",
  "vehicleCoordinates": {
    "latitude": 40.7130,
    "longitude": -74.0055
  }
}
```

**Response:**
```json
{
  "success": true,
  "distance": 12.5
}
```

#### `GET /notifications`
Retrieves all active notifications.

**Response:**
```json
{
  "notifications": [
    {
      "id": "notification-123",
      "pothole": {
        "track_id": 1,
        "distance_m": 15.5,
        "lateral_m": 0.2,
        "size": 0.25,
        "coordinates": {
          "latitude": 40.7128,
          "longitude": -74.0060
        }
      },
      "current_distance": 12.5,
      "timestamp": "2024-11-07T19:00:00Z",
      "frame": 150
    }
  ]
}
```

### WebSocket Events

#### Connection
```
ws://localhost:5001
```

#### Message Types

**Pothole Detected:**
```json
{
  "type": "pothole_detected",
  "data": {
    "id": "notification-123",
    "pothole": { /* pothole data */ },
    "current_distance": 15.5,
    "timestamp": "2024-11-07T19:00:00Z"
  }
}
```

**Distance Updated:**
```json
{
  "type": "distance_updated",
  "data": {
    "notificationId": "notification-123",
    "distance": 12.5,
    "vehicleCoordinates": {
      "latitude": 40.7130,
      "longitude": -74.0055
    }
  }
}
```

---

## System Flow

### Complete Data Flow

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

### Synchronization Mechanism

1. Map Animation: Vehicle marker moves along route at 200ms per coordinate point
2. Video Playback: Video frames correspond 1:1 with route points
3. Sync Service: Tracks both map and video progress (0 to 1) to maintain synchronization
4. Pause/Resume: Both map and video pause/resume simultaneously

---

## Testing

### Test Without C++ Model

You can test the complete flow using a webhook simulation:

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

This simulates a pothole detection and triggers the same notification flow.

### Expected Behavior

1. Backend receives webhook and creates notification
2. WebSocket broadcasts to frontend
3. Frontend pauses map and video
4. Notification component appears
5. Distance updates every second
6. User can resume to continue

---

## Project Structure

```
maps-app/
├── app/                    # Frontend React Native app
│   ├── components/         # Reusable components
│   │   ├── PotholeNotification.tsx
│   │   └── VideoPlayer.tsx
│   ├── services/           # Frontend services
│   │   └── syncService.ts  # Map-video synchronization
│   ├── types/              # TypeScript definitions
│   ├── map.tsx             # Main map component
│   └── index.tsx           # Entry point
├── server/                 # Backend Node.js server
│   ├── services/           # Backend services
│   │   ├── coordinateCalculator.js
│   │   ├── distanceCalculator.js
│   │   ├── notificationManager.js
│   │   └── potholeStorage.js
│   └── index.js            # Express server
├── Pothole/                # C++ detection model
│   ├── build/              # Compiled binaries
│   ├── src/                # C++ source files
│   ├── includes/           # Header files
│   ├── main.cpp            # Main detection pipeline
│   └── best.engine         # TensorRT model
└── assets/                 # Static assets
    ├── images/
    └── videos/
```

---

## Configuration

### Backend Port
Default port is `5001`. To change:

```bash
PORT=3000 npm start
```

### WebSocket URL
Frontend connects to `ws://localhost:5001` by default. Update in `app/map.tsx` if needed.

### Video File
Default video path is `assets/videos/video.mp4`. Ensure the file exists or update the path in the map component.

---

## Error Handling

- If WebSocket fails, the application falls back to HTTP polling every 2 seconds.
- If the backend is unreachable, the app shows a connection error message.
- If the video file is missing, the video player will not appear but the map still works.
- If route calculation fails, an error alert is shown to the user.
- If the C++ model fails, you can still test using the webhook simulation.

---

## Key Features Explained

### Real-Time Distance Calculation
- Uses the Haversine formula to calculate distance between the vehicle and pothole.
- Updates every second while a notification is active.
- Accounts for vehicle movement along the route.

### Synchronized Playback
- Map animation and video playback are synchronized.
- Video frame N corresponds to route point N.
- Pause/resume operations affect both simultaneously.

### Pothole Tracking
- SORT algorithm tracks potholes across frames.
- Maintains unique track IDs for each pothole.
- Prevents duplicate notifications for the same pothole.

---

## License

This project is developed for hackathon purposes.

---

## Acknowledgments

- YOLO11 for object detection
- SORT algorithm for tracking
- OpenStreetMap for geocoding
- OSRM for routing services
- Expo team for the React Native framework

---

## Support

For questions or issues, please contact any of the team members listed above.

---

**Built with ❤️ for the hackathon**

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const distanceCalculator = require('./services/distanceCalculator');
const coordinateCalculator = require('./services/coordinateCalculator');
const notificationManager = require('./services/notificationManager');
const potholeStorage = require('./services/potholeStorage');

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected clients
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('Client connected');
  clients.add(ws);

  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Broadcast to all connected clients
function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// POST /webhook - Receives pothole detection data from C++ model
app.post('/webhook', (req, res) => {
  try {
    const detectionData = req.body;
    console.log('Received pothole detection:', detectionData);

    // Process detection data
    const notification = notificationManager.createNotification(detectionData);
    
    // Calculate pothole coordinates if vehicle coordinates are provided
    let potholeCoords = null;
    if (detectionData.vehicleCoordinates && notification.pothole) {
      const vehicleCoord = detectionData.vehicleCoordinates;
      const nextCoord = detectionData.nextRouteCoordinate || vehicleCoord;
      const distanceMeters = notification.pothole.distance_m || 0;
      const lateralMeters = notification.pothole.lateral_m || 0;
      
      // Calculate pothole coordinates
      potholeCoords = coordinateCalculator.calculatePotholeCoordinates(
        vehicleCoord,
        nextCoord,
        distanceMeters,
        lateralMeters
      );
      
      if (potholeCoords) {
        notification.pothole.coordinates = potholeCoords;
        notificationManager.setPotholeCoordinates(notification.id, potholeCoords);
        console.log('Calculated pothole coordinates:', potholeCoords);
      }
    }

    // Check if pothole already exists at this location (only if we have coordinates)
    if (potholeCoords) {
      const existingPothole = potholeStorage.findExistingPothole(potholeCoords);
      
      if (existingPothole) {
        // Pothole already exists - check if we should increment count
        // Only increment if detection is more than 2 cm away (not the same detection)
        const distance = distanceCalculator.calculateDistance(
          potholeCoords,
          existingPothole.coordinates
        );
        
        let updated = existingPothole;
        let countIncremented = false;
        
        if (distance > potholeStorage.TOO_CLOSE_THRESHOLD_METERS) {
          // More than 2 cm away - increment count (new detection of same pothole)
          console.log(`Pothole exists at distance ${distance.toFixed(4)}m, incrementing detection count`);
          updated = potholeStorage.incrementDetectionCount(existingPothole.id, potholeCoords);
          countIncremented = true;
        } else {
          // Within 2 cm - same detection, don't increment
          console.log(`Pothole detection too close (${distance.toFixed(4)}m <= ${potholeStorage.TOO_CLOSE_THRESHOLD_METERS}m), not incrementing count`);
        }
        
        // Broadcast existing pothole alert (not a new detection)
        broadcast({
          type: 'existing_pothole_alert',
          data: {
            ...notification,
            pothole: {
              ...notification.pothole,
              coordinates: existingPothole.coordinates,
              existing: true,
              detection_count: updated.detection_count,
              count_incremented: countIncremented
            }
          }
        });

        return res.status(200).json({ 
          success: true, 
          isDuplicate: true,
          existingPotholeId: existingPothole.id,
          detectionCount: updated.detection_count,
          countIncremented: countIncremented,
          distance: distance
        });
      } else {
        // New pothole - save to persistent storage
        const saveResult = potholeStorage.addPothole({
          coordinates: potholeCoords,
          distance_m: notification.pothole.distance_m,
          lateral_m: notification.pothole.lateral_m,
          size: notification.pothole.size,
          track_id: notification.pothole.track_id
        });

        if (saveResult.success) {
          console.log('New pothole saved to persistent storage:', saveResult.pothole.id);
        }
      }
    }
    
    // Broadcast new pothole detection to all connected clients
    broadcast({
      type: 'pothole_detected',
      data: notification
    });

    res.status(200).json({ 
      success: true, 
      notificationId: notification.id,
      isDuplicate: false
    });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /update-distance - Calculates current distance from pothole and updates notification
app.post('/update-distance', async (req, res) => {
  try {
    const { notificationId, vehicleCoordinates } = req.body;
    
    if (!notificationId || !vehicleCoordinates) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing notificationId or vehicleCoordinates' 
      });
    }

    const notification = notificationManager.getNotification(notificationId);
    if (!notification) {
      return res.status(404).json({ 
        success: false, 
        error: 'Notification not found' 
      });
    }

    // Helper: validate coordinate object
    const isValidCoord = (c) => {
      return c && typeof c.latitude === 'number' && typeof c.longitude === 'number' && isFinite(c.latitude) && isFinite(c.longitude);
    };

    // If pothole coordinates are not yet known (null), update only the
    // vehicle coordinates on the notification and broadcast the change.
    // This avoids calling the distance calculator with a null coordinate.
    if (!notification.pothole || !isValidCoord(notification.pothole.coordinates)) {
      const updatedNotification = notificationManager.updateDistance(
        notificationId,
        notification.current_distance,
        vehicleCoordinates
      );

      // Broadcast update to all connected clients
      broadcast({
        type: 'distance_updated',
        data: updatedNotification
      });

      return res.status(200).json({ success: true, notification: updatedNotification });
    }

    // Ensure vehicleCoordinates is valid
    if (!isValidCoord(vehicleCoordinates)) {
      // Bad input from client
      return res.status(400).json({ success: false, error: 'Invalid vehicleCoordinates' });
    }

    // Calculate current distance
    const currentDistance = distanceCalculator.calculateDistance(
      vehicleCoordinates,
      notification.pothole.coordinates
    );

    // Update notification
    const updatedNotification = notificationManager.updateDistance(
      notificationId,
      currentDistance,
      vehicleCoordinates
    );

    // Broadcast update to all connected clients
    broadcast({
      type: 'distance_updated',
      data: updatedNotification
    });

    res.status(200).json({ 
      success: true, 
      notification: updatedNotification 
    });
  } catch (error) {
    console.error('Error updating distance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /set-pothole-coordinates - Set persisted pothole coordinates for a notification
app.post('/set-pothole-coordinates', (req, res) => {
  try {
    const { notificationId, coordinates } = req.body;

    if (!notificationId || !coordinates) {
      return res.status(400).json({ success: false, error: 'Missing notificationId or coordinates' });
    }

    const updatedNotification = notificationManager.setPotholeCoordinates(notificationId, coordinates);
    if (!updatedNotification) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }

    // Broadcast update to all connected clients
    broadcast({
      type: 'pothole_updated',
      data: updatedNotification
    });

    res.status(200).json({ success: true, notification: updatedNotification });
  } catch (error) {
    console.error('Error setting pothole coordinates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /notifications - Get all active notifications
app.get('/notifications', (req, res) => {
  try {
    const notifications = notificationManager.getAllNotifications();
    res.status(200).json({ success: true, notifications });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /notifications/:id - Get specific notification
app.get('/notifications/:id', (req, res) => {
  try {
    const notification = notificationManager.getNotification(req.params.id);
    if (!notification) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }
    res.status(200).json({ success: true, notification });
  } catch (error) {
    console.error('Error fetching notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /potholes - Get all persistent pothole locations
app.get('/potholes', (req, res) => {
  try {
    const potholes = potholeStorage.getAllPotholes();
    res.status(200).json({ success: true, potholes });
  } catch (error) {
    console.error('Error fetching potholes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /potholes/nearby - Get potholes near given coordinates
app.get('/potholes/nearby', (req, res) => {
  try {
    const { latitude, longitude, radius = 1000 } = req.query;
    
    if (!latitude || !longitude) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing latitude or longitude' 
      });
    }

    const coordinates = {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude)
    };

    const potholes = potholeStorage.getPotholesNearby(
      coordinates, 
      parseFloat(radius)
    );

    res.status(200).json({ success: true, potholes });
  } catch (error) {
    console.error('Error fetching nearby potholes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    connectedClients: clients.size
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server ready for connections`);
});


const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const distanceCalculator = require('./services/distanceCalculator');
const notificationManager = require('./services/notificationManager');

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
    
    // Broadcast to all connected clients
    broadcast({
      type: 'pothole_detected',
      data: notification
    });

    res.status(200).json({ 
      success: true, 
      notificationId: notification.id 
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


/**
 * Notification management service
 * Manages pothole detection notifications and their lifecycle
 */

const notifications = new Map();

function createNotification(detectionData) {
  const id = `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Extract data from detection payload
  // Handle both batch format and single detection format
  let potholeData;
  
  if (detectionData.detections && detectionData.detections.length > 0) {
    // Batch format - take first detection
    const firstDetection = detectionData.detections[0];
    potholeData = {
      track_id: firstDetection.id,
      distance_m: firstDetection.d,
      lateral_m: firstDetection.x,
      size: firstDetection.size || 0, // Will be calculated if not provided
      coordinates: detectionData.coordinates || null // Should be provided by C++ model
    };
  } else {
    // Single detection format
    potholeData = {
      track_id: detectionData.track_id || detectionData.id,
      distance_m: detectionData.distance_m || detectionData.d,
      lateral_m: detectionData.lateral_m || detectionData.x,
      size: detectionData.size || 0,
      coordinates: detectionData.coordinates || null
    };
  }

  const notification = {
    id,
    pothole: potholeData,
    vehicle: {
      coordinates: null // Will be updated when vehicle position is known
    },
    current_distance: potholeData.distance_m,
    timestamp: new Date().toISOString(),
    // Preserve any additional metadata from the detection payload so clients
    // can use it for more accurate geo-tagging (e.g. frame->route mapping).
    frame: detectionData.frame || 0,
    theta_deg: detectionData.theta_deg || 0,
    // optional video metadata that the C++ model may send
    video_fps: detectionData.video_fps || null,
    total_frames: detectionData.total_frames || null,
    timestamp_ms: detectionData.timestamp_ms || null
  };

  notifications.set(id, notification);
  return notification;
}

function getNotification(id) {
  return notifications.get(id) || null;
}

function getAllNotifications() {
  return Array.from(notifications.values());
}

function updateDistance(notificationId, currentDistance, vehicleCoordinates) {
  const notification = notifications.get(notificationId);
  if (!notification) {
    return null;
  }

  notification.current_distance = currentDistance;
  notification.vehicle.coordinates = vehicleCoordinates;
  notification.updated_at = new Date().toISOString();

  notifications.set(notificationId, notification);
  return notification;
}

function setPotholeCoordinates(notificationId, coordinates) {
  const notification = notifications.get(notificationId);
  if (!notification) return null;

  notification.pothole.coordinates = coordinates;
  notification.updated_at = new Date().toISOString();

  notifications.set(notificationId, notification);
  return notification;
}

function deleteNotification(id) {
  return notifications.delete(id);
}

function clearAllNotifications() {
  notifications.clear();
}

module.exports = {
  createNotification,
  getNotification,
  getAllNotifications,
  updateDistance,
  setPotholeCoordinates,
  deleteNotification,
  clearAllNotifications
};


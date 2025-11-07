/**
 * Persistent storage for pothole locations
 * Stores geo-tagged potholes so they can be shared across users
 */

const fs = require('fs');
const path = require('path');
const distanceCalculator = require('./distanceCalculator');

const STORAGE_FILE = path.join(__dirname, '../../data/potholes.json');
const DUPLICATE_THRESHOLD_METERS = 5; // Consider potholes within 5m as duplicates
const TOO_CLOSE_THRESHOLD_METERS = 0.02; // 2 cm - don't increment count if within this distance

// Ensure data directory exists
const dataDir = path.dirname(STORAGE_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Load potholes from file
function loadPotholes() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = fs.readFileSync(STORAGE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading potholes:', error);
  }
  return [];
}

// Save potholes to file
function savePotholes(potholes) {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(potholes, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving potholes:', error);
    return false;
  }
}

// Check if a pothole already exists near given coordinates
function findExistingPothole(coordinates) {
  if (!coordinates || !coordinates.latitude || !coordinates.longitude) {
    return null;
  }

  const potholes = loadPotholes();
  
  for (const pothole of potholes) {
    if (pothole.coordinates && pothole.coordinates.latitude && pothole.coordinates.longitude) {
      const distance = distanceCalculator.calculateDistance(
        coordinates,
        pothole.coordinates
      );
      
      if (distance <= DUPLICATE_THRESHOLD_METERS) {
        return pothole;
      }
    }
  }
  
  return null;
}

// Add a new pothole (only if it doesn't already exist)
function addPothole(potholeData) {
  const { coordinates, distance_m, lateral_m, size, track_id } = potholeData;
  
  if (!coordinates || !coordinates.latitude || !coordinates.longitude) {
    return { success: false, error: 'Invalid coordinates' };
  }

  // Check if pothole already exists at this location
  const existing = findExistingPothole(coordinates);
  if (existing) {
    console.log('Pothole already exists at this location:', existing.id);
    return { 
      success: false, 
      isDuplicate: true,
      existingPothole: existing 
    };
  }

  // Create new pothole entry
  const pothole = {
    id: `pothole-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    coordinates,
    distance_m: distance_m || 0,
    lateral_m: lateral_m || 0,
    size: size || 0,
    track_id: track_id || 0,
    detected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    detection_count: 1 // How many times this pothole has been detected
  };

  // Load existing potholes and add new one
  const potholes = loadPotholes();
  potholes.push(pothole);
  
  // Save to file
  if (savePotholes(potholes)) {
    console.log('Pothole saved:', pothole.id, 'at', coordinates);
    return { success: true, pothole };
  } else {
    return { success: false, error: 'Failed to save pothole' };
  }
}

// Update detection count for existing pothole
// Only increments if the new detection coordinates are more than 2 cm away
function incrementDetectionCount(potholeId, newCoordinates = null) {
  const potholes = loadPotholes();
  const index = potholes.findIndex(p => p.id === potholeId);
  
  if (index !== -1) {
    // If coordinates are provided, check distance
    if (newCoordinates && potholes[index].coordinates) {
      const distance = distanceCalculator.calculateDistance(
        newCoordinates,
        potholes[index].coordinates
      );
      
      // Don't increment if within 2 cm (same detection, too close)
      if (distance <= TOO_CLOSE_THRESHOLD_METERS) {
        console.log(`Detection too close (${distance.toFixed(4)}m <= ${TOO_CLOSE_THRESHOLD_METERS}m), not incrementing count`);
        return potholes[index]; // Return without incrementing
      }
    }
    
    // Increment count (either no coordinates provided, or distance > 2 cm)
    potholes[index].detection_count = (potholes[index].detection_count || 1) + 1;
    potholes[index].updated_at = new Date().toISOString();
    savePotholes(potholes);
    return potholes[index];
  }
  
  return null;
}

// Get all potholes
function getAllPotholes() {
  return loadPotholes();
}

// Get potholes within a certain radius of coordinates
function getPotholesNearby(coordinates, radiusMeters = 1000) {
  if (!coordinates || !coordinates.latitude || !coordinates.longitude) {
    return [];
  }

  const potholes = loadPotholes();
  return potholes.filter(pothole => {
    if (!pothole.coordinates) return false;
    const distance = distanceCalculator.calculateDistance(
      coordinates,
      pothole.coordinates
    );
    return distance <= radiusMeters;
  });
}

// Delete a pothole
function deletePothole(potholeId) {
  const potholes = loadPotholes();
  const filtered = potholes.filter(p => p.id !== potholeId);
  
  if (filtered.length < potholes.length) {
    savePotholes(filtered);
    return true;
  }
  
  return false;
}

module.exports = {
  addPothole,
  findExistingPothole,
  getAllPotholes,
  getPotholesNearby,
  incrementDetectionCount,
  deletePothole,
  DUPLICATE_THRESHOLD_METERS,
  TOO_CLOSE_THRESHOLD_METERS
};


/**
 * Coordinate calculation service
 * Calculates GPS coordinates for potholes based on vehicle position, distance, and lateral offset
 */

/**
 * Calculate bearing (direction) between two coordinates
 * @param {Object} coord1 - {latitude, longitude}
 * @param {Object} coord2 - {latitude, longitude}
 * @returns {number} Bearing in degrees (0-360)
 */
function calculateBearing(coord1, coord2) {
  const lat1 = (coord1.latitude * Math.PI) / 180;
  const lat2 = (coord2.latitude * Math.PI) / 180;
  const dLon = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  const bearing = Math.atan2(y, x);
  const bearingDegrees = ((bearing * 180) / Math.PI + 360) % 360;

  return bearingDegrees;
}

/**
 * Calculate destination point given start point, bearing, and distance
 * @param {Object} startCoord - {latitude, longitude}
 * @param {number} bearingDeg - Bearing in degrees (0-360)
 * @param {number} distanceMeters - Distance in meters
 * @returns {Object} {latitude, longitude}
 */
function calculateDestination(startCoord, bearingDeg, distanceMeters) {
  const R = 6371e3; // Earth's radius in meters
  const lat1 = (startCoord.latitude * Math.PI) / 180;
  const lon1 = (startCoord.longitude * Math.PI) / 180;
  const bearing = (bearingDeg * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceMeters / R) +
      Math.cos(lat1) * Math.sin(distanceMeters / R) * Math.cos(bearing)
  );

  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(distanceMeters / R) * Math.cos(lat1),
      Math.cos(distanceMeters / R) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (lon2 * 180) / Math.PI,
  };
}

/**
 * Calculate pothole coordinates from vehicle position, distance, and lateral offset
 * @param {Object} vehicleCoord - Vehicle's current GPS coordinates {latitude, longitude}
 * @param {Object} nextCoord - Next point on route (for bearing calculation) {latitude, longitude}
 * @param {number} distanceMeters - Distance to pothole in meters (forward)
 * @param {number} lateralMeters - Lateral offset in meters (positive = right, negative = left)
 * @returns {Object} {latitude, longitude} - Pothole GPS coordinates
 */
function calculatePotholeCoordinates(
  vehicleCoord,
  nextCoord,
  distanceMeters,
  lateralMeters
) {
  if (!vehicleCoord || !nextCoord) {
    return null;
  }

  // Calculate bearing (direction of travel)
  const bearing = calculateBearing(vehicleCoord, nextCoord);

  // Calculate the point directly in front of the vehicle at the given distance
  const forwardPoint = calculateDestination(vehicleCoord, bearing, distanceMeters);

  // Calculate perpendicular bearing (90 degrees to the right)
  const perpendicularBearing = (bearing + 90) % 360;

  // Calculate the final pothole position (forward point + lateral offset)
  const potholeCoord = calculateDestination(
    forwardPoint,
    perpendicularBearing,
    Math.abs(lateralMeters)
  );

  // If lateral offset is negative (left side), use opposite bearing
  if (lateralMeters < 0) {
    const leftBearing = (bearing - 90 + 360) % 360;
    return calculateDestination(forwardPoint, leftBearing, Math.abs(lateralMeters));
  }

  return potholeCoord;
}

module.exports = {
  calculateBearing,
  calculateDestination,
  calculatePotholeCoordinates,
};


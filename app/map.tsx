import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Alert, TouchableOpacity } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import axios from 'axios';

interface Coordinate {
  latitude: number;
  longitude: number;
}

interface CustomMarker {
  id: string;
  coordinate: Coordinate;
  title: string;
}

export default function MapScreen() {
  const params = useLocalSearchParams();
  const { currentLocation, destination } = params;

  const [region, setRegion] = useState<{
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [routeCoordinates, setRouteCoordinates] = useState<Coordinate[]>([]);
  const [destinationCoords, setDestinationCoords] = useState<Coordinate | null>(null);
  const [vehiclePosition, setVehiclePosition] = useState<Coordinate | null>(null);
  const [vehicleIndex, setVehicleIndex] = useState<number>(0);
  const [customMarkers, setCustomMarkers] = useState<CustomMarker[]>([]);
  const [startCoords, setStartCoords] = useState<Coordinate | null>(null);

  useEffect(() => {
    initializeMap();
  }, []);

  const initializeMap = async () => {
    try {
      // Request location permissions
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required');
        setLoading(false);
        return;
      }

      // Geocode the current location string instead of using GPS
      const currentCoords = await geocode(currentLocation as string);
      if (!currentCoords) {
        setLoading(false);
        return;
      }

      setStartCoords(currentCoords);

      setRegion({
        ...currentCoords,
        latitudeDelta: 0.0922,
        longitudeDelta: 0.0421,
      });

      // Get coordinates for destination using Nominatim (OpenStreetMap)
      const destCoords = await geocode(destination as string);
      if (!destCoords) {
        setLoading(false);
        return;
      }

      setDestinationCoords(destCoords);

      // Fetch route using OSRM (free)
      await getRoute(currentCoords, destCoords);
    } catch (err) {
      console.error('Init error:', err);
      Alert.alert('Error', 'Could not initialize map');
      setLoading(false);
    }
  };

  // 🧭 Free geocoding using OpenStreetMap (Nominatim)
  const geocode = async (place: string) => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        place
      )}&format=json&limit=1`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'ExpoMapsApp' },
      });

      if (response.data && response.data.length > 0) {
        const { lat, lon } = response.data[0];
        return { latitude: parseFloat(lat), longitude: parseFloat(lon) };
      } else {
        throw new Error('No results found');
      }
    } catch (err) {
      console.error('Geocoding error:', err);
      Alert.alert('Error', 'Could not find destination location');
      return null;
    }
  };

  const getRoute = async (start: Coordinate, end: Coordinate) => {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson`;

      const response = await axios.get(url);

      if (response.data.routes && response.data.routes.length > 0) {
        const route = response.data.routes[0];
        const coordinates = route.geometry.coordinates.map((coord: number[]) => ({
          latitude: coord[1],
          longitude: coord[0],
        }));

        setRouteCoordinates(coordinates);
        setVehiclePosition(coordinates[0]); // start at A
        setVehicleIndex(0);
        animateVehicle(coordinates);
      }
    } catch (error) {
      console.error('Error fetching route:', error);
      Alert.alert('Route Error', 'Could not fetch route');
    } finally {
      setLoading(false);
    }
  };

  // 🚗 Animate vehicle along route
  const animateVehicle = (coordinates: Coordinate[]) => {
    let index = 0;
    const interval = setInterval(() => {
      if (index < coordinates.length) {
        setVehiclePosition(coordinates[index]);
        setVehicleIndex(index);
        index++;
      } else {
        clearInterval(interval);
      }
    }, 200); // move every 200ms — adjust for speed
  };

  // 📍 Add a marker perpendicular to the route path (slightly offset to the right)
  // 📍 Add marker 100 meters *ahead* on the route path
const addMarkerAtDistance = () => {
  if (!vehiclePosition || routeCoordinates.length === 0) {
    Alert.alert('Error', 'Vehicle not yet started. Please wait for animation to begin.');
    return;
  }

  const currentIndex = vehicleIndex;
  if (currentIndex >= routeCoordinates.length - 1) {
    Alert.alert('Notice', 'Vehicle is near the end of route');
    return;
  }

  const distanceAhead = 0.1; // in km → 100 meters
  let accumulatedDistance = 0;
  const kmPerDegree = 111; // approx conversion

  // Traverse ahead until total distance ≈ 100m
  for (let i = currentIndex; i < routeCoordinates.length - 1; i++) {
    const curr = routeCoordinates[i];
    const next = routeCoordinates[i + 1];

    // Haversine distance between two route points
    const dLat = (next.latitude - curr.latitude) * (Math.PI / 180);
    const dLon = (next.longitude - curr.longitude) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(curr.latitude * Math.PI / 180) *
        Math.cos(next.latitude * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = 6371 * c; // km

    accumulatedDistance += dist;
    if (accumulatedDistance >= distanceAhead) {
      const newMarker: CustomMarker = {
        id: `marker-${Date.now()}`,
        coordinate: next,
        title: `Point ${customMarkers.length + 1}`,
      };
      setCustomMarkers([...customMarkers, newMarker]);
      Alert.alert('Marker Added!', `Added ${newMarker.title} on route ahead`);
      return;
    }
  }

  Alert.alert('End of Route', 'Not enough distance left to add marker ahead.');
};


  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading map...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {region && (
        <MapView
          style={styles.map}
          provider={PROVIDER_DEFAULT}
          initialRegion={region}
          showsUserLocation={true}
          showsMyLocationButton={true}
        >
          {/* Current Location Marker */}
          {startCoords && (
            <Marker
              coordinate={startCoords}
              title="Start Location"
              description={currentLocation as string}
              pinColor="blue"
            />
          )}

          {/* Destination Marker */}
          {destinationCoords && (
            <Marker
              coordinate={destinationCoords}
              title="Destination"
              description={destination as string}
              pinColor="red"
            />
          )}

          {/* Route Polyline */}
          {routeCoordinates.length > 0 && (
            <Polyline coordinates={routeCoordinates} strokeColor="#007AFF" strokeWidth={4} />
          )}

          {/* Vehicle Marker */}
          {vehiclePosition && (
            <Marker
              coordinate={vehiclePosition}
              title="Vehicle"
              description="Simulated vehicle"
              pinColor="green"
            />
          )}

          {/* Custom Markers */}
          {customMarkers.map((marker) => (
            <Marker
              key={marker.id}
              coordinate={marker.coordinate}
              title={marker.title}
              description="Marker near route"
              pinColor="purple"
            />
          ))}
        </MapView>
      )}

      {/* Info Box */}
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>From: {currentLocation}</Text>
        <Text style={styles.infoText}>To: {destination}</Text>
        {customMarkers.length > 0 && (
          <Text style={styles.infoText}>📍 Markers: {customMarkers.length}</Text>
        )}
      </View>

      {/* Add Marker Button */}
      <TouchableOpacity style={styles.addMarkerButton} onPress={addMarkerAtDistance}>
        <Text style={styles.addMarkerButtonText}>📍 Add Marker</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { width: '100%', height: '100%' },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: { marginTop: 10, fontSize: 16, color: '#666' },
  infoBox: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  infoText: { fontSize: 14, color: '#333', marginBottom: 5 },
  addMarkerButton: {
    position: 'absolute',
    bottom: 30,
    left: '50%',
    marginLeft: -80,
    backgroundColor: '#9333ea',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  addMarkerButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
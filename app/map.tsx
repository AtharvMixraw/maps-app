import axios from 'axios';
import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import PotholeNotification from './components/PotholeNotification';
import VideoPlayer from './components/VideoPlayer';
import { syncService } from './services/syncService';

// Conditionally import react-native-maps only on native platforms
let MapView: any = null;
let Marker: any = null;
let Polyline: any = null;
let PROVIDER_DEFAULT: any = null;

if (Platform.OS !== 'web') {
  try {
    const Maps = require('react-native-maps');
    MapView = Maps.default || Maps;
    Marker = Maps.Marker;
    Polyline = Maps.Polyline;
    PROVIDER_DEFAULT = Maps.PROVIDER_DEFAULT;
  } catch (error) {
    console.warn('react-native-maps not available:', error);
  }
}

interface Coordinate {
  latitude: number;
  longitude: number;
}

interface PotholeNotificationData {
  id: string;
  pothole: {
    track_id: number;
    distance_m: number;
    lateral_m: number;
    size: number;
    coordinates: { latitude: number; longitude: number } | null;
  };
  vehicle: {
    coordinates: { latitude: number; longitude: number } | null;
  };
  current_distance: number;
  timestamp: string;
  frame: number;
  // optional metadata provided by the model/webhook (top-level)
  video_fps?: number | null;
  total_frames?: number | null;
  timestamp_ms?: number | null;
  theta_deg: number;
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
  const [startCoords, setStartCoords] = useState<Coordinate | null>(null);
  
  // Video and sync state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null);
  const [videoUri, setVideoUri] = useState<string>('');
  const animationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const distanceUpdateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPausedRef = useRef<boolean>(false);
  
  // WebSocket and notifications
  const wsRef = useRef<WebSocket | null>(null);
  const [notifications, setNotifications] = useState<PotholeNotificationData[]>([]);
  // Android emulator uses 10.0.2.2 to access host machine's localhost
  // iOS simulator uses localhost
  // Physical device needs your computer's IP address
  const getBackendUrl = () => {
    if (Platform.OS === 'android') {
      // Android emulator
      return 'https://nonsatirizing-kevin-unlured.ngrok-free.dev';
    }
    return 'https://nonsatirizing-kevin-unlured.ngrok-free.dev';
  };
  const getWebSocketUrl = () => {
    if (Platform.OS === 'android') {
      // Android emulator
      return 'ws://nonsatirizing-kevin-unlured.ngrok-free.dev';
    }
    return 'ws://nonsatirizing-kevin-unlured.ngrok-free.dev';
  };
  const BACKEND_URL = getBackendUrl();
  const WS_URL = getWebSocketUrl();

  useEffect(() => {
    initializeMap();
    return () => {
      if (animationIntervalRef.current) {
        clearInterval(animationIntervalRef.current);
      }
      if (distanceUpdateIntervalRef.current) {
        clearInterval(distanceUpdateIntervalRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Connect to WebSocket for real-time notifications with HTTP polling fallback
  useEffect(() => {
    connectWebSocket();
    
    // Fallback: HTTP polling if WebSocket fails
    const pollingInterval = setInterval(async () => {
      try {
        const response = await axios.get(`${BACKEND_URL}/notifications`);
        if (response.data.success && response.data.notifications) {
          const newNotifications = response.data.notifications;
          
          // Check for new notifications
          setNotifications((prev) => {
            const updated = [...prev];
            let hasChanges = false;
            
            newNotifications.forEach((notification: PotholeNotificationData) => {
              const existingIndex = updated.findIndex((n) => n.id === notification.id);
              if (existingIndex === -1) {
                // New notification - get current vehicle position
                setVehiclePosition((currentPos) => {
                  // Determine best coordinates for notification (same logic as WS handler)
                  let coords = notification.pothole.coordinates || null;
                  if (!coords && notification.total_frames && routeCoordinates.length > 0) {
                    const totalFrames = notification.total_frames;
                    const frame = notification.frame || 0;
                    const ratio = Math.max(0, Math.min(1, totalFrames > 0 ? frame / totalFrames : 0));
                    const idx = Math.round(ratio * (routeCoordinates.length - 1));
                    coords = routeCoordinates[Math.max(0, Math.min(routeCoordinates.length - 1, idx))] || null;
                  }
                  if (!coords) coords = currentPos;

                  const notificationWithCoords = {
                    ...notification,
                    pothole: {
                      ...notification.pothole,
                      coordinates: coords,
                    },
                  };
                  
                  updated.push(notificationWithCoords);
                  hasChanges = true;
                  
                  // Trigger pause if not already paused
                  if (!isPausedRef.current) {
                    setIsPaused(true);
                    isPausedRef.current = true;
                    setIsPlaying(false);
                    syncService.pause();
                    if (animationIntervalRef.current) {
                      clearInterval(animationIntervalRef.current);
                      animationIntervalRef.current = null;
                    }
                  }
                  
                  // Update coordinates
                  if (currentPos) {
                    updateNotificationWithCoordinates(notification.id, currentPos);
                  }
                  
                  return currentPos;
                });
              } else if (updated[existingIndex].current_distance !== notification.current_distance) {
                // Distance updated
                updated[existingIndex] = notification;
                hasChanges = true;
              }
            });
            
            return hasChanges ? updated : prev;
          });
        }
      } catch (error) {
        // Silent fail for polling
      }
    }, 2000); // Poll every 2 seconds

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      clearInterval(pollingInterval);
    };
  }, []);

  const connectWebSocket = () => {
    try {
      const ws = new WebSocket(WS_URL);
      
      ws.onopen = () => {
        console.log('WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'pothole_detected') {
            handlePotholeDetected(data.data);
          } else if (data.type === 'distance_updated') {
            handleDistanceUpdate(data.data);
          } else if (data.type === 'pothole_updated') {
            // Pothole coordinates or metadata updated on server
            handleDistanceUpdate(data.data);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
    }
  };

  const handlePotholeDetected = (notification: PotholeNotificationData) => {
    // Pause both map and video
    setIsPaused(true);
    isPausedRef.current = true;
    setIsPlaying(false);
    syncService.pause();
    
    if (animationIntervalRef.current) {
      clearInterval(animationIntervalRef.current);
      animationIntervalRef.current = null;
    }

    // Set pothole coordinates to current vehicle position if not set
    // Set pothole coordinates to the best available source (in order):
    // 1) coordinates provided by the model in the webhook
    // 2) map frame->route mapping using total_frames (if provided)
    // 3) current simulated vehicle position (fallback)
    let coords = notification.pothole.coordinates || null;

    if (!coords && notification.total_frames && routeCoordinates.length > 0) {
      // Map frame -> route index
      const totalFrames = notification.total_frames;
      const frame = notification.frame || 0;
      const ratio = Math.max(0, Math.min(1, totalFrames > 0 ? frame / totalFrames : 0));
      const idx = Math.round(ratio * (routeCoordinates.length - 1));
      coords = routeCoordinates[Math.max(0, Math.min(routeCoordinates.length - 1, idx))] || null;
    }

    if (!coords) {
      coords = vehiclePosition;
    }

    const notificationWithCoords = {
      ...notification,
      pothole: {
        ...notification.pothole,
        coordinates: coords,
      },
    };

    // Add notification
    setNotifications((prev) => {
      // Check if notification already exists
      const exists = prev.find((n) => n.id === notification.id);
      if (exists) return prev;
      return [...prev, notificationWithCoords];
    });

    // Set vehicle coordinates and update distance
    if (notificationWithCoords.pothole.coordinates) {
      // Persist the pothole coordinates on the server so all clients have the
      // exact geo-tag. Use vehiclePosition (if available) as the authoritative
      // coordinate when pausing on detection.
      const coordsToPersist = vehiclePosition || notificationWithCoords.pothole.coordinates;
      try {
        axios.post(`${BACKEND_URL}/set-pothole-coordinates`, {
          notificationId: notification.id,
          coordinates: coordsToPersist,
        }).catch((e) => {
          // Log but don't block UI
          console.error('Failed to persist pothole coordinates:', e?.message || e);
        });
      } catch (e) {
        console.error('Error calling set-pothole-coordinates:', e);
      }

      // Also send vehicle position to update distance calculations immediately.
      updateNotificationWithCoordinates(notification.id, vehiclePosition || notificationWithCoords.pothole.coordinates);
    }
  };

  const handleDistanceUpdate = (notification: PotholeNotificationData) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notification.id ? notification : n))
    );
  };

  const updateNotificationWithCoordinates = async (notificationId: string, coordinates: Coordinate) => {
    try {
      await axios.post(`${BACKEND_URL}/update-distance`, {
        notificationId,
        vehicleCoordinates: coordinates,
      });
    } catch (error) {
      console.error('Error updating distance:', error);
    }
  };

  // Start distance update polling for all notifications
  useEffect(() => {
    if (notifications.length > 0 && vehiclePosition && !isPaused) {
      distanceUpdateIntervalRef.current = setInterval(() => {
        notifications.forEach((notification) => {
          updateNotificationWithCoordinates(notification.id, vehiclePosition);
        });
      }, 1000); // Update every second
    }
    return () => {
      if (distanceUpdateIntervalRef.current) {
        clearInterval(distanceUpdateIntervalRef.current);
      }
    };
  }, [notifications, vehiclePosition, isPaused]);

  // Accept video frame/time updates from the VideoPlayer so we can use
  // totalDuration or progress if needed for mapping (fallbacks)
  const handleVideoFrameUpdate = (currentTimeMs: number, totalDurationMs: number) => {
    if (totalDurationMs && totalDurationMs > 0) {
      setVideoDurationMs(totalDurationMs);
      // Update sync service video progress from video player
      const videoProgress = currentTimeMs / totalDurationMs;
      syncService.setVideoProgress(videoProgress);
    }
  };


  const initializeMap = async () => {
    try {
      // Skip location permission on web
      if (Platform.OS !== 'web') {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'Location permission is required');
          setLoading(false);
          return;
        }
      }

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

      const destCoords = await geocode(destination as string);
      if (!destCoords) {
        setLoading(false);
        return;
      }

      setDestinationCoords(destCoords);

      await getRoute(currentCoords, destCoords);
      
      // Set video URI - using video.mp4 from root directory
      if (Platform.OS === 'web') {
        // On web, you might want to use a URL or skip video
        setVideoUri('');
      } else if (Platform.OS === 'android') {
        // For Android, use the video.mp4 file
        // In production, you'd use Asset.fromModule() or bundle the video
        setVideoUri('file:///Users/anshumohanacharya/Documents/maps-app/video.mp4');
      } else {
        // iOS
        setVideoUri('file:///Users/anshumohanacharya/Documents/maps-app/video.mp4');
      }
    } catch (err) {
      console.error('Init error:', err);
      Alert.alert('Error', 'Could not initialize map');
      setLoading(false);
    }
  };

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
        setVehiclePosition(coordinates[0]);
        setVehicleIndex(0);
        
        // Start synchronized animation
        startSynchronizedAnimation(coordinates);
      }
    } catch (error) {
      console.error('Error fetching route:', error);
      Alert.alert('Route Error', 'Could not fetch route');
    } finally {
      setLoading(false);
    }
  };

  const startSynchronizedAnimation = (coordinates: Coordinate[]) => {
    // Clear any existing animation
    if (animationIntervalRef.current) {
      clearInterval(animationIntervalRef.current);
      animationIntervalRef.current = null;
    }
    
    // Start both map and video simultaneously
    setIsPlaying(true);
    setIsPaused(false);
    isPausedRef.current = false;
    syncService.setPlaying(true);
    
    const totalPoints = coordinates.length;
    const animationSpeed = 200; // ms per point

    animationIntervalRef.current = setInterval(() => {
      setVehicleIndex((currentIndex) => {
        // Check if paused or completed using ref
        if (isPausedRef.current || currentIndex >= totalPoints - 1) {
          if (animationIntervalRef.current) {
            clearInterval(animationIntervalRef.current);
            animationIntervalRef.current = null;
          }
          setIsPlaying(false);
          syncService.setPlaying(false);
          return currentIndex;
        }
        
        const newIndex = currentIndex + 1;
        const progress = newIndex / totalPoints;
        
        setVehiclePosition(coordinates[newIndex]);
        syncService.setMapProgress(progress);
        
        return newIndex;
      });
    }, animationSpeed);
  };

  const handleVideoPause = () => {
    // Video paused (pothole detected)
    setIsPaused(true);
    isPausedRef.current = true;
    setIsPlaying(false);
    syncService.pause();
    
    if (animationIntervalRef.current) {
      clearInterval(animationIntervalRef.current);
      animationIntervalRef.current = null;
    }
  };

  const handleResume = () => {
    if (routeCoordinates.length > 0 && vehicleIndex < routeCoordinates.length) {
      setIsPaused(false);
      isPausedRef.current = false;
      setIsPlaying(true);
      syncService.resume();
      
      // Resume animation from current position
      const remainingCoordinates = routeCoordinates.slice(vehicleIndex);
      startSynchronizedAnimation(remainingCoordinates);
    }
  };

  const dismissNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const getVideoSyncPosition = (): number => {
    if (routeCoordinates.length === 0) return 0;
    return vehicleIndex / routeCoordinates.length;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading map...</Text>
      </View>
    );
  }

  // Web-compatible map - simplified visualization
  const renderWebMap = () => {
    if (!region) return null;
    
    // Create Google Maps URL for directions
    const googleMapsUrl = startCoords && destinationCoords
      ? `https://www.google.com/maps/dir/${startCoords.latitude},${startCoords.longitude}/${destinationCoords.latitude},${destinationCoords.longitude}`
      : `https://www.google.com/maps/@${region.latitude},${region.longitude},12z`;
    
    return (
      <View style={styles.map}>
        <View style={styles.webMapContainer}>
          <Text style={styles.webMapTitle}>🗺️ Route Map (Web View)</Text>
          <Text style={styles.webMapInfo}>
            Start: {currentLocation}
          </Text>
          <Text style={styles.webMapInfo}>
            Destination: {destination}
          </Text>
          {vehiclePosition && (
            <Text style={styles.webMapInfo}>
              Current Position: {vehiclePosition.latitude.toFixed(4)}, {vehiclePosition.longitude.toFixed(4)}
            </Text>
          )}
          {routeCoordinates.length > 0 && (
            <Text style={styles.webMapInfo}>
              Route Points: {routeCoordinates.length}
            </Text>
          )}
          {notifications.length > 0 && (
            <Text style={styles.webMapAlert}>
              ⚠️ {notifications.length} Pothole(s) Detected
            </Text>
          )}
          <TouchableOpacity
            style={styles.webMapButton}
            onPress={() => {
              if (typeof window !== 'undefined') {
                window.open(googleMapsUrl, '_blank');
              }
            }}
          >
            <Text style={styles.webMapButtonText}>Open in Google Maps</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Native map component
  const renderNativeMap = () => {
    if (!region || !MapView) return null;
    
    return (
      <MapView
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={region}
        showsUserLocation={true}
        showsMyLocationButton={true}
      >
        {startCoords && (
          <Marker
            coordinate={startCoords}
            title="Start Location"
            description={currentLocation as string}
            pinColor="blue"
          />
        )}

        {destinationCoords && (
          <Marker
            coordinate={destinationCoords}
            title="Destination"
            description={destination as string}
            pinColor="red"
          />
        )}

        {routeCoordinates.length > 0 && (
          <Polyline coordinates={routeCoordinates} strokeColor="#007AFF" strokeWidth={4} />
        )}

        {vehiclePosition && (
          <Marker
            coordinate={vehiclePosition}
            title="Vehicle"
            description="Simulated vehicle"
            pinColor="green"
          />
        )}

        {/* Pothole markers from notifications */}
        {notifications.map((notification) => {
          if (notification.pothole.coordinates) {
            return (
              <Marker
                key={notification.id}
                coordinate={notification.pothole.coordinates}
                title="Pothole"
                description={`${notification.current_distance.toFixed(1)}m away`}
                pinColor="orange"
              />
            );
          }
          return null;
        })}
      </MapView>
    );
  };

  return (
    <View style={styles.container}>
      {Platform.OS === 'web' ? renderWebMap() : renderNativeMap()}

      {/* Video Player */}
      {videoUri && (
        <View style={styles.videoContainer}>
          <VideoPlayer
            videoUri={videoUri}
            isPlaying={isPlaying}
            onPause={handleVideoPause}
            onFrameUpdate={handleVideoFrameUpdate}
            syncPosition={getVideoSyncPosition()}
          />
        </View>
      )}

      {/* Notifications */}
      <ScrollView
        style={styles.notificationsContainer}
        contentContainerStyle={styles.notificationsContent}
      >
        {notifications.map((notification) => (
          <PotholeNotification
            key={notification.id}
            id={notification.id}
            pothole={notification.pothole}
            current_distance={notification.current_distance}
            timestamp={notification.timestamp}
            onDismiss={dismissNotification}
          />
        ))}
      </ScrollView>

      {/* Info Box */}
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>From: {currentLocation}</Text>
        <Text style={styles.infoText}>To: {destination}</Text>
        {isPaused && (
          <Text style={styles.pausedText}>⏸ Paused - Pothole Detected</Text>
        )}
      </View>

      {/* Control Buttons */}
      {isPaused && (
        <TouchableOpacity style={styles.resumeButton} onPress={handleResume}>
          <Text style={styles.resumeButtonText}>▶ Resume</Text>
        </TouchableOpacity>
      )}
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
  videoContainer: {
    position: 'absolute',
    bottom: 100,
    left: 10,
    right: 10,
    height: 200,
    zIndex: 100,
  },
  notificationsContainer: {
    position: 'absolute',
    top: 60,
    left: 10,
    right: 10,
    maxHeight: 300,
    zIndex: 200,
  },
  notificationsContent: {
    gap: 10,
  },
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
    zIndex: 50,
  },
  infoText: { fontSize: 14, color: '#333', marginBottom: 5 },
  pausedText: {
    fontSize: 14,
    color: '#ff6b6b',
    fontWeight: 'bold',
    marginTop: 5,
  },
  resumeButton: {
    position: 'absolute',
    bottom: 30,
    left: '50%',
    marginLeft: -60,
    backgroundColor: '#007AFF',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 150,
  },
  resumeButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  webMapContainer: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  webMapTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
  },
  webMapInfo: {
    fontSize: 16,
    color: '#666',
    marginBottom: 10,
    textAlign: 'center',
  },
  webMapAlert: {
    fontSize: 18,
    color: '#ff6b6b',
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 20,
  },
  webMapButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 20,
  },
  webMapButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

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
    existing?: boolean; // True if this is an existing pothole (not new detection)
    detection_count?: number; // How many times this pothole has been detected
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
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null);
  const [videoUri, setVideoUri] = useState<string>('');
  const animationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const distanceUpdateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
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
                // New notification - calculate coordinates properly
                setVehiclePosition((currentPos) => {
                  let coords = notification.pothole.coordinates || null;

                  // Calculate coordinates from vehicle position, distance, and lateral offset
                  if (!coords && currentPos && notification.pothole.distance_m !== undefined) {
                    const currentVehicleIndex = vehicleIndex;
                    const nextRoutePoint = routeCoordinates[currentVehicleIndex + 1] || routeCoordinates[currentVehicleIndex] || currentPos;
                    
                    coords = calculatePotholeCoordinates(
                      currentPos,
                      nextRoutePoint,
                      notification.pothole.distance_m,
                      notification.pothole.lateral_m || 0
                    );
                  }

                  // Fallback: use vehicle position if calculation failed
                  if (!coords && currentPos) {
                    coords = currentPos;
                  }

                  const notificationWithCoords = {
                    ...notification,
                    pothole: {
                      ...notification.pothole,
                      coordinates: coords,
                    },
                  };
                  
                  updated.push(notificationWithCoords);
                  hasChanges = true;
                  
                  // NO PAUSE - Continue moving, just geo-tag the location
                  
                  // Persist coordinates to server
                  if (coords) {
                    axios.post(`${BACKEND_URL}/set-pothole-coordinates`, {
                      notificationId: notification.id,
                      coordinates: coords,
                    }).catch((e) => {
                      // Failed to persist coordinates via polling
                    });
                  }
                  
                  // Update distance calculations
                  if (currentPos) {
                    updateNotificationWithCoordinates(notification.id, currentPos);
                  }
                  
                  return currentPos;
                });
              } else if (updated[existingIndex].current_distance !== notification.current_distance) {
                // Distance updated - also update coordinates if they changed
                const updatedNotification = {
                  ...notification,
                  pothole: {
                    ...notification.pothole,
                    coordinates: notification.pothole.coordinates || updated[existingIndex].pothole.coordinates,
                  },
                };
                updated[existingIndex] = updatedNotification;
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
          } else if (data.type === 'existing_pothole_alert') {
            // Existing pothole detected - show alert but don't create new notification
            handleExistingPotholeAlert(data.data);
          } else if (data.type === 'nearby_pothole_alert') {
            // User approaching an existing pothole
            handleNearbyPotholeAlert(data.data);
          } else if (data.type === 'distance_updated') {
            handleDistanceUpdate(data.data);
          } else if (data.type === 'pothole_updated') {
            // Pothole coordinates or metadata updated on server
            handleDistanceUpdate(data.data);
          }
        } catch (error) {
          // Error parsing WebSocket message
        }
      };

      ws.onerror = (error) => {
        // WebSocket error
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
      };

      wsRef.current = ws;
    } catch (error) {
      // Failed to connect WebSocket
    }
  };

  // Calculate distance between two coordinates (Haversine formula)
  const calculateDistance = (coord1: Coordinate, coord2: Coordinate): number => {
    const R = 6371e3; // Earth's radius in meters
    const lat1 = (coord1.latitude * Math.PI) / 180;
    const lat2 = (coord2.latitude * Math.PI) / 180;
    const dLat = ((coord2.latitude - coord1.latitude) * Math.PI) / 180;
    const dLon = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  };

  // Calculate bearing between two coordinates
  const calculateBearing = (coord1: Coordinate, coord2: Coordinate): number => {
    const lat1 = (coord1.latitude * Math.PI) / 180;
    const lat2 = (coord2.latitude * Math.PI) / 180;
    const dLon = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    const bearing = Math.atan2(y, x);
    return ((bearing * 180) / Math.PI + 360) % 360;
  };

  // Calculate destination point given start, bearing, and distance
  const calculateDestination = (start: Coordinate, bearingDeg: number, distanceMeters: number): Coordinate => {
    const R = 6371e3; // Earth's radius in meters
    const lat1 = (start.latitude * Math.PI) / 180;
    const lon1 = (start.longitude * Math.PI) / 180;
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
  };

  // Calculate pothole coordinates from vehicle position, distance, and lateral offset
  const calculatePotholeCoordinates = (
    vehicleCoord: Coordinate,
    nextCoord: Coordinate | null,
    distanceMeters: number,
    lateralMeters: number
  ): Coordinate | null => {
    if (!vehicleCoord) return null;

    // Use next route point for bearing, or use vehicle position if no next point
    const bearingPoint = nextCoord || vehicleCoord;
    const bearing = calculateBearing(vehicleCoord, bearingPoint);

    // Calculate point directly in front at the given distance
    const forwardPoint = calculateDestination(vehicleCoord, bearing, distanceMeters);

    // Calculate perpendicular bearing for lateral offset
    const perpendicularBearing = lateralMeters >= 0 
      ? (bearing + 90) % 360  // Right side
      : (bearing - 90 + 360) % 360;  // Left side

    // Calculate final pothole position
    return calculateDestination(forwardPoint, perpendicularBearing, Math.abs(lateralMeters));
  };

  const handlePotholeDetected = (notification: PotholeNotificationData) => {
    console.log('🔴 Pothole detected:', {
      id: notification.id,
      distance: notification.pothole.distance_m,
      lateral: notification.pothole.lateral_m,
      size: notification.pothole.size,
      vehiclePosition,
      vehicleIndex,
      routeLength: routeCoordinates.length,
      hasCoordinates: !!notification.pothole.coordinates,
      isExisting: notification.pothole.existing || false,
    });

    // NO PAUSE - Continue moving forward, just geo-tag the location
    // Vehicle and video continue moving normally

    // Calculate pothole coordinates from vehicle position, distance, and lateral offset
    let coords = notification.pothole.coordinates || null;

    // CRITICAL: Always calculate coordinates if we have vehicle position and distance
    // The pothole is detected "d" meters ahead and "x" meters lateral
    if (!coords && vehiclePosition && notification.pothole.distance_m !== undefined && notification.pothole.distance_m > 0) {
      // Get the next point on the route for bearing calculation
      const nextRoutePoint = routeCoordinates[vehicleIndex + 1] || 
                            routeCoordinates[vehicleIndex] || 
                            vehiclePosition;
      
      console.log('📍 Calculating coordinates from detection:', {
        vehiclePosition,
        vehicleIndex,
        nextRoutePoint,
        distance_m: notification.pothole.distance_m,
        lateral_m: notification.pothole.lateral_m || 0,
        size: notification.pothole.size,
      });
      
      // Calculate: pothole is "distance_m" meters ahead, then "lateral_m" meters to the side
      coords = calculatePotholeCoordinates(
        vehiclePosition,
        nextRoutePoint,
        notification.pothole.distance_m,  // Distance ahead (2.29m in your example)
        notification.pothole.lateral_m || 0  // Lateral offset (1.39m in your example)
      );
      
      if (coords) {
        console.log('✅ Calculated pothole coordinates:', coords);
        console.log(`   📍 Pothole is ${notification.pothole.distance_m}m ahead, ${Math.abs(notification.pothole.lateral_m || 0)}m ${notification.pothole.lateral_m >= 0 ? 'right' : 'left'}`);
      }
    } else {
      console.log('⚠️ Cannot calculate coordinates yet:', {
        hasCoords: !!coords,
        hasVehiclePosition: !!vehiclePosition,
        hasDistance: notification.pothole.distance_m !== undefined,
        distanceValue: notification.pothole.distance_m,
      });
    }

    // Fallback: use current vehicle position if calculation failed
    // (This is a last resort - better to wait for proper calculation)
    if (!coords && vehiclePosition) {
      console.log('⚠️ Using vehicle position as fallback (pothole should be ahead but using current position)');
      coords = vehiclePosition;
    }

    if (!coords) {
      // No coordinates available for pothole - will retry when vehicle position is available
    }

    const notificationWithCoords = {
      ...notification,
      pothole: {
        ...notification.pothole,
        coordinates: coords,
      },
    };

    console.log('📌 Final notification with coordinates:', {
      id: notificationWithCoords.id,
      hasCoordinates: !!notificationWithCoords.pothole.coordinates,
      coordinates: notificationWithCoords.pothole.coordinates,
    });

    // Add notification (even without coordinates - will be calculated later)
    setNotifications((prev) => {
      // Check if notification already exists
      const exists = prev.find((n) => n.id === notification.id);
      if (exists) {
        console.log('⚠️ Notification already exists, updating with coordinates...');
        return prev.map((n) => (n.id === notification.id ? notificationWithCoords : n));
      }
      console.log('✅ Adding new notification to state');
      return [...prev, notificationWithCoords];
    });

    // Persist pothole coordinates on server if we have them
    if (coords && coords.latitude && coords.longitude) {
      console.log('💾 Persisting coordinates to server:', coords);
      try {
        axios.post(`${BACKEND_URL}/set-pothole-coordinates`, {
          notificationId: notification.id,
          coordinates: coords,
        }).then(() => {
          console.log('✅ Coordinates persisted successfully to server');
        }).catch((e) => {
          // Failed to persist pothole coordinates
        });
      } catch (e) {
        // Error calling set-pothole-coordinates
      }

      // Update distance calculations
      if (vehiclePosition) {
        updateNotificationWithCoordinates(notification.id, vehiclePosition);
      }
    } else {
      console.warn('⚠️ Cannot persist: coordinates not yet calculated. Will retry when vehicle position is available.');
    }
  };

  const handleExistingPotholeAlert = (notification: PotholeNotificationData) => {
    // Existing pothole detected - show alert but don't pause
    console.log('⚠️ Existing pothole detected:', {
      id: notification.id,
      coordinates: notification.pothole.coordinates,
      detection_count: notification.pothole.detection_count,
    });

    // Add as notification but mark as existing
    setNotifications((prev) => {
      const exists = prev.find((n) => n.id === notification.id);
      if (exists) return prev;
      return [...prev, notification];
    });
  };

  const handleNearbyPotholeAlert = (data: any) => {
    // User is approaching an existing pothole
    console.log('📍 Approaching existing pothole:', data);
    
    // Show alert notification
    setNotifications((prev) => {
      const exists = prev.find((n) => n.id === data.id);
      if (exists) {
        // Update distance
        return prev.map((n) => (n.id === data.id ? { ...n, current_distance: data.current_distance } : n));
      }
      // Add new alert
      return [...prev, data];
    });
  };

  const handleDistanceUpdate = (notification: PotholeNotificationData) => {
    setNotifications((prev) =>
      prev.map((n) => {
        if (n.id === notification.id) {
          // Preserve existing coordinates if new notification doesn't have them
          const updatedNotification = {
            ...notification,
            pothole: {
              ...notification.pothole,
              coordinates: notification.pothole.coordinates || n.pothole.coordinates,
            },
          };
          return updatedNotification;
        }
        return n;
      })
    );
  };

  const updateNotificationWithCoordinates = async (notificationId: string, coordinates: Coordinate) => {
    try {
      await axios.post(`${BACKEND_URL}/update-distance`, {
        notificationId,
        vehicleCoordinates: coordinates,
      });
    } catch (error) {
      // Error updating distance
    }
  };

  // Recalculate coordinates for notifications that don't have them yet
  // This ensures coordinates are calculated even if vehicle position wasn't available when detection arrived
  useEffect(() => {
    if (notifications.length > 0 && vehiclePosition && routeCoordinates.length > 0) {
      setNotifications((prev) => {
        let hasChanges = false;
        const updated = prev.map((notification) => {
          // If notification doesn't have coordinates, calculate them NOW
          if (!notification.pothole.coordinates && 
              notification.pothole.distance_m !== undefined && 
              notification.pothole.distance_m > 0) {
            
            const nextRoutePoint = routeCoordinates[vehicleIndex + 1] || 
                                  routeCoordinates[vehicleIndex] || 
                                  vehiclePosition;
            
            console.log('🔄 Recalculating coordinates for notification:', {
              id: notification.id,
              vehiclePosition,
              vehicleIndex,
              distance: notification.pothole.distance_m,
              lateral: notification.pothole.lateral_m || 0,
            });
            
            const coords = calculatePotholeCoordinates(
              vehiclePosition,
              nextRoutePoint,
              notification.pothole.distance_m,
              notification.pothole.lateral_m || 0
            );
            
            if (coords && coords.latitude && coords.longitude) {
              hasChanges = true;
              console.log('✅ Recalculated coordinates:', coords);
              
              // Persist to server
              axios.post(`${BACKEND_URL}/set-pothole-coordinates`, {
                notificationId: notification.id,
                coordinates: coords,
              }).then(() => {
                console.log('✅ Recalculated coordinates persisted to server');
              }).catch((e) => {
                // Failed to persist recalculated coordinates
              });
              
              return {
                ...notification,
                pothole: {
                  ...notification.pothole,
                  coordinates: coords,
                },
              };
            } else {
              console.warn('⚠️ Recalculation returned invalid coordinates');
            }
          }
          return notification;
        });
        
        return hasChanges ? updated : prev;
      });
    }
  }, [vehiclePosition, vehicleIndex, routeCoordinates.length, notifications.length]);

  // Start distance update polling for all notifications and check for nearby potholes
  useEffect(() => {
    if (vehiclePosition && routeCoordinates.length > 0) {
      distanceUpdateIntervalRef.current = setInterval(async () => {
        // Update distances for all notifications
        notifications.forEach((notification) => {
          if (notification.pothole.coordinates) {
            updateNotificationWithCoordinates(notification.id, vehiclePosition);
          }
        });

        // Check for nearby existing potholes (within 50m)
        try {
          const response = await axios.get(`${BACKEND_URL}/potholes/nearby`, {
            params: {
              latitude: vehiclePosition.latitude,
              longitude: vehiclePosition.longitude,
              radius: 50, // Check within 50 meters
            },
          });

          if (response.data.success && response.data.potholes) {
            response.data.potholes.forEach((pothole: any) => {
              const distance = calculateDistance(
                vehiclePosition,
                pothole.coordinates
              );

              // Alert if within 20 meters
              if (distance <= 20) {
                // Check if we already have this pothole in notifications
                const exists = notifications.find((n) => n.id === pothole.id);
                if (!exists) {
                  // Create alert for nearby pothole
                  const alertData: PotholeNotificationData = {
                    id: pothole.id,
                    pothole: {
                      track_id: pothole.track_id || 0,
                      distance_m: pothole.distance_m || 0,
                      lateral_m: pothole.lateral_m || 0,
                      size: pothole.size || 0,
                      coordinates: pothole.coordinates,
                      existing: true,
                      detection_count: pothole.detection_count || 1,
                    },
                    vehicle: {
                      coordinates: vehiclePosition,
                    },
                    current_distance: distance,
                    timestamp: pothole.updated_at || pothole.detected_at,
                    frame: 0,
                    theta_deg: 0,
                  };

                  setNotifications((prev) => {
                    const alreadyExists = prev.find((n) => n.id === pothole.id);
                    if (alreadyExists) return prev;
                    return [...prev, alertData];
                  });
                }
              }
            });
          }
        } catch (error) {
          // Failed to check nearby potholes
        }
      }, 1000); // Update every second
    }
    return () => {
      if (distanceUpdateIntervalRef.current) {
        clearInterval(distanceUpdateIntervalRef.current);
      }
    };
  }, [notifications, vehiclePosition, routeCoordinates.length]);

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
      
      // Load existing potholes from persistent storage
      try {
        const response = await axios.get(`${BACKEND_URL}/potholes`);
        if (response.data.success && response.data.potholes) {
          const existingPotholes = response.data.potholes.map((pothole: any) => ({
            id: pothole.id,
            pothole: {
              track_id: pothole.track_id || 0,
              distance_m: pothole.distance_m || 0,
              lateral_m: pothole.lateral_m || 0,
              size: pothole.size || 0,
              coordinates: pothole.coordinates,
            },
            vehicle: {
              coordinates: null,
            },
            current_distance: 0,
            timestamp: pothole.detected_at || pothole.updated_at,
            frame: 0,
            theta_deg: 0,
            existing: true,
            detection_count: pothole.detection_count || 1,
          }));
          
          // Add existing potholes to notifications (they'll show on map)
          setNotifications(existingPotholes);
          console.log(`✅ Loaded ${existingPotholes.length} existing potholes from storage`);
        }
      } catch (error) {
        console.log('Could not load existing potholes:', error);
      }
      
      // Load video from Google Drive
      // Convert Google Drive sharing link to direct stream URL
      // Sharing URL: https://drive.google.com/file/d/1PirSnQexkWjGW0pGqibLjvX7lYwwY5yB/view?usp=sharing
      // File ID: 1PirSnQexkWjGW0pGqibLjvX7lYwwY5yB
      const googleDriveFileId = '1PirSnQexkWjGW0pGqibLjvX7lYwwY5yB';
      
      // Use direct stream URL for video playback (better than download URL)
      const googleDriveVideoUrl = `https://drive.google.com/uc?export=view&id=${googleDriveFileId}`;
      
      // Alternative if view doesn't work: Direct download URL
      // const googleDriveVideoUrl = `https://drive.google.com/uc?export=download&id=${googleDriveFileId}`;
      
      console.log('📹 Loading video from Google Drive:');
      console.log('   File ID:', googleDriveFileId);
      console.log('   Video URL:', googleDriveVideoUrl);
      setVideoUri(googleDriveVideoUrl);
    } catch (err) {
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
    syncService.setPlaying(true);
    
    const totalPoints = coordinates.length;
    const animationSpeed = 500; // ms per point

    animationIntervalRef.current = setInterval(() => {
      // Continue animation - no pause checks needed
      setVehicleIndex((currentIndex) => {
        // Check if completed - loop back to start if video is looping
        if (currentIndex >= totalPoints - 1) {
          // Loop back to start to match video looping
          const newIndex = 0;
          const progress = 0;
          
          // Update vehicle position to start
          setVehiclePosition(coordinates[newIndex]);
          syncService.setMapProgress(progress);
          
          return newIndex;
        }
        
        // Continue to next point
        const newIndex = currentIndex + 1;
        const progress = newIndex / totalPoints;
        
        // Update vehicle position
        setVehiclePosition(coordinates[newIndex]);
        syncService.setMapProgress(progress);
        
        return newIndex;
      });
    }, animationSpeed);
  };

  // Removed handleVideoPause and handleResume - no pausing on pothole detection

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
          const coords = notification.pothole.coordinates;
          if (coords && coords.latitude && coords.longitude) {
            console.log('🗺️ Rendering pothole marker:', {
              id: notification.id,
              coords,
            });
            return (
              <Marker
                key={notification.id}
                coordinate={coords}
                title="⚠️ Pothole Detected"
                description={`${notification.current_distance.toFixed(1)}m away | Size: ${notification.pothole.size?.toFixed(2) || 'N/A'} m²`}
                pinColor="orange"
              />
            );
          } else {
            console.warn('⚠️ Notification missing coordinates:', {
              id: notification.id,
              coords,
            });
            return null;
          }
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
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>📍 From:</Text>
          <Text style={styles.infoValue}>{currentLocation}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>🎯 To:</Text>
          <Text style={styles.infoValue}>{destination}</Text>
        </View>
        {notifications.length > 0 && (
          <View style={styles.notificationBadge}>
            <Text style={styles.notificationBadgeText}>
              ⚠️ Pothole(s) Detected
            </Text>
          </View>
        )}
      </View>

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
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  infoLabel: {
    fontSize: 13,
    color: '#666',
    fontWeight: '600',
    marginRight: 6,
  },
  infoValue: {
    fontSize: 13,
    color: '#333',
    flex: 1,
  },
  pausedBadge: {
    backgroundColor: '#fff3cd',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#ff6b6b',
  },
  pausedText: {
    fontSize: 13,
    color: '#ff6b6b',
    fontWeight: 'bold',
  },
  notificationBadge: {
    backgroundColor: '#ffe6e6',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginTop: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#ff6b6b',
  },
  notificationBadgeText: {
    fontSize: 12,
    color: '#d32f2f',
    fontWeight: '600',
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

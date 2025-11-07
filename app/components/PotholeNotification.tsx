import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';

interface PotholeData {
  track_id: number;
  distance_m: number;
  lateral_m: number;
  size: number;
  coordinates?: { latitude: number; longitude: number } | null;
}

interface NotificationProps {
  id: string;
  pothole: PotholeData;
  current_distance: number;
  timestamp: string;
  onDismiss: (id: string) => void;
}

export default function PotholeNotification({
  id,
  pothole,
  current_distance,
  timestamp,
  onDismiss,
}: NotificationProps) {
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(-100));

  useEffect(() => {
    // Animate in
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss(id);
    });
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>⚠️ Pothole Detected</Text>
          <TouchableOpacity onPress={handleDismiss} style={styles.dismissButton}>
            <Text style={styles.dismissText}>×</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.details}>
          <View style={styles.detailRow}>
            <Text style={styles.label}>Distance:</Text>
            <Text style={styles.value}>{current_distance.toFixed(1)} m</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.label}>Lateral Offset:</Text>
            <Text style={styles.value}>{pothole.lateral_m.toFixed(2)} m</Text>
          </View>

          {pothole.size > 0 && (
            <View style={styles.detailRow}>
              <Text style={styles.label}>Size:</Text>
              <Text style={styles.value}>{pothole.size.toFixed(2)} m²</Text>
            </View>
          )}

          {pothole.coordinates && (
            <View style={styles.detailRow}>
              <Text style={styles.label}>Location:</Text>
              <Text style={styles.coordinateText}>
                {pothole.coordinates.latitude.toFixed(6)}, {pothole.coordinates.longitude.toFixed(6)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.timestamp}>
            {new Date(timestamp).toLocaleTimeString()}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: 10,
    right: 10,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  content: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#ff6b6b',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  dismissButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dismissText: {
    fontSize: 24,
    color: '#666',
    lineHeight: 24,
  },
  details: {
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  value: {
    fontSize: 14,
    color: '#333',
    fontWeight: 'bold',
  },
  coordinateText: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 8,
  },
  timestamp: {
    fontSize: 12,
    color: '#999',
    textAlign: 'right',
  },
});


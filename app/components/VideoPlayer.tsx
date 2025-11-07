import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';

interface VideoPlayerProps {
  videoUri: string;
  isPlaying: boolean;
  onPause?: () => void;
  onFrameUpdate?: (currentTime: number, totalDuration: number) => void;
  syncPosition?: number; // 0-1, for synchronization with map
}

export default function VideoPlayer({
  videoUri,
  isPlaying,
  onPause,
  onFrameUpdate,
  syncPosition,
}: VideoPlayerProps) {
  const videoRef = useRef<Video>(null);
  const [status, setStatus] = useState<AVPlaybackStatus | null>(null);
  const [isPaused, setIsPaused] = useState(!isPlaying);

  useEffect(() => {
    if (isPlaying && isPaused) {
      videoRef.current?.playAsync();
      setIsPaused(false);
    } else if (!isPlaying && !isPaused) {
      videoRef.current?.pauseAsync();
      setIsPaused(true);
      onPause?.();
    }
  }, [isPlaying]);

  useEffect(() => {
    if (syncPosition !== undefined && status?.isLoaded) {
      const totalDuration = status.durationMillis || 0;
      const targetTime = syncPosition * totalDuration;
      const currentTime = status.positionMillis || 0;
      
      // Only seek if difference is significant (more than 100ms)
      if (Math.abs(currentTime - targetTime) > 100) {
        videoRef.current?.setPositionAsync(targetTime);
      }
    }
  }, [syncPosition, status]);

  const handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    setStatus(status);
    
    if (status.isLoaded) {
      const currentTime = status.positionMillis || 0;
      const totalDuration = status.durationMillis || 0;
      onFrameUpdate?.(currentTime, totalDuration);
    }
  };

  return (
    <View style={styles.container}>
      <Video
        ref={videoRef}
        source={{ uri: videoUri }}
        style={styles.video}
        resizeMode={ResizeMode.CONTAIN}
        isLooping={false}
        onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
      />
      {isPaused && (
        <View style={styles.overlay}>
          <Text style={styles.pausedText}>Video Paused - Pothole Detected</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 200,
    backgroundColor: '#000',
    borderRadius: 8,
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pausedText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});


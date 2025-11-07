import { Video } from 'expo-av';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface VideoPlayerProps {
  videoUri: string;
  isPlaying: boolean;
  onPause?: () => void;
  onFrameUpdate?: (currentTime: number, totalDuration: number) => void;
  syncPosition?: number;
}

export default function VideoPlayer({
  videoUri,
  isPlaying,
  onPause,
  onFrameUpdate,
  syncPosition,
}: VideoPlayerProps) {
  const videoRef = useRef<Video>(null);
  const [status, setStatus] = useState<any>(null);
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
      if (Math.abs(currentTime - targetTime) > 100) {
        videoRef.current?.seekAsync(targetTime);
      }
    }
  }, [syncPosition, status]);

  const handlePlaybackStatusUpdate = (statusData: any) => {
    setStatus(statusData);
    if (statusData.isLoaded) {
      const currentTime = statusData.positionMillis || 0;
      const totalDuration = statusData.durationMillis || 0;
      onFrameUpdate?.(currentTime, totalDuration);
    }
  };

  return (
    <View style={styles.container}>
      <Video
        ref={videoRef}
        source={{ uri: videoUri }}
        style={styles.video}
        resizeMode="contain"
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

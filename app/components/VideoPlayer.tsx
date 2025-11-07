import { AVPlaybackStatus, ResizeMode, Video } from 'expo-av';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

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
  const [status, setStatus] = useState<AVPlaybackStatus | null>(null);
  const [isPaused, setIsPaused] = useState(!isPlaying);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Handle video source loading
  useEffect(() => {
    if (!videoUri) {
      setError('No video URI provided');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
  }, [videoUri]);

  // Handle play/pause
  useEffect(() => {
    if (!videoRef.current || !status?.isLoaded) return;

    if (isPlaying && isPaused) {
      videoRef.current.playAsync().catch((err) => {
        console.error('Error playing video:', err);
        setError('Failed to play video');
      });
      setIsPaused(false);
    } else if (!isPlaying && !isPaused) {
      videoRef.current.pauseAsync().catch((err) => {
        console.error('Error pausing video:', err);
      });
      setIsPaused(true);
      onPause?.();
    }
  }, [isPlaying, status?.isLoaded]);

  // Handle sync position
  useEffect(() => {
    if (syncPosition !== undefined && status?.isLoaded && 'durationMillis' in status) {
      const totalDuration = status.durationMillis || 0;
      const targetTime = syncPosition * totalDuration;
      const currentTime = status.positionMillis || 0;
      if (Math.abs(currentTime - targetTime) > 100 && totalDuration > 0) {
        videoRef.current?.setPositionAsync(targetTime).catch((err) => {
          console.error('Error seeking video:', err);
        });
      }
    }
  }, [syncPosition, status]);

  const handlePlaybackStatusUpdate = (statusData: AVPlaybackStatus) => {
    setStatus(statusData);
    
    if ('isLoaded' in statusData && statusData.isLoaded) {
      setIsLoading(false);
      setError(null);
      
      const currentTime = statusData.positionMillis || 0;
      const totalDuration = statusData.durationMillis || 0;
      
      // Check if video has ended (and will loop)
      if (statusData.didJustFinish) {
        // Video ended, will automatically loop due to isLooping={true}
        // Reset to start if needed
        if (videoRef.current && isPlaying) {
          videoRef.current.setPositionAsync(0).catch(() => {
            // Ignore seek errors on loop
          });
        }
      }
      
      if (totalDuration > 0) {
        onFrameUpdate?.(currentTime, totalDuration);
      }
    } else if ('error' in statusData && statusData.error) {
      setIsLoading(false);
      setError(statusData.error);
      console.error('Video playback error:', statusData.error);
    }
  };

  if (!videoUri) {
    return (
      <View style={styles.container}>
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>No video available</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Video
        ref={videoRef}
        source={{ uri: videoUri }}
        style={styles.video}
        resizeMode={ResizeMode.CONTAIN}
        isLooping={true}
        shouldPlay={isPlaying}
        onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
        useNativeControls={false}
      />
      
      {isLoading && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loadingText}>Loading video...</Text>
        </View>
      )}
      
      {error && (
        <View style={styles.overlay}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
        </View>
      )}
      
      {isPaused && !isLoading && !error && (
        <View style={styles.overlay}>
          <Text style={styles.pausedText}>⏸ Video Paused</Text>
          <Text style={styles.pausedSubtext}>Pothole Detected</Text>
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
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
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  placeholderText: {
    color: '#999',
    fontSize: 14,
  },
  pausedText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  pausedSubtext: {
    color: '#ff6b6b',
    fontSize: 14,
    fontWeight: '600',
  },
  loadingText: {
    color: '#fff',
    fontSize: 14,
    marginTop: 10,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});

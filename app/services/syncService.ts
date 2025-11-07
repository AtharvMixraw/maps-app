/**
 * Synchronization service for map and video
 * Ensures map animation and video playback stay in sync
 */

export interface SyncState {
  isPlaying: boolean;
  mapProgress: number; // 0-1
  videoProgress: number; // 0-1
  isPaused: boolean;
}

export class SyncService {
  private mapProgress: number = 0;
  private videoProgress: number = 0;
  private isPlaying: boolean = false;
  private isPaused: boolean = false;
  private listeners: Set<(state: SyncState) => void> = new Set();

  setMapProgress(progress: number) {
    this.mapProgress = Math.max(0, Math.min(1, progress));
    this.notifyListeners();
  }

  setVideoProgress(progress: number) {
    this.videoProgress = Math.max(0, Math.min(1, progress));
    this.notifyListeners();
  }

  setPlaying(playing: boolean) {
    this.isPlaying = playing;
    this.notifyListeners();
  }

  pause() {
    this.isPaused = true;
    this.isPlaying = false;
    this.notifyListeners();
  }

  resume() {
    this.isPaused = false;
    this.isPlaying = true;
    this.notifyListeners();
  }

  getState(): SyncState {
    return {
      isPlaying: this.isPlaying,
      mapProgress: this.mapProgress,
      videoProgress: this.videoProgress,
      isPaused: this.isPaused,
    };
  }

  subscribe(listener: (state: SyncState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }

  // Calculate video position based on map position
  // This ensures video frame N corresponds to map route point N
  getVideoPositionFromMap(mapProgress: number): number {
    return mapProgress; // 1:1 mapping for now
  }

  // Calculate map position based on video position
  getMapPositionFromVideo(videoProgress: number): number {
    return videoProgress; // 1:1 mapping for now
  }
}

// Singleton instance
export const syncService = new SyncService();


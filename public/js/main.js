class AudioSubsystem {
  constructor() {
    this.statusDot = document.getElementById('status-dot');
    this.playbackStatus = document.getElementById('playback-status');
    this.trackArtist = document.getElementById('track-artist');
    this.trackName = document.getElementById('track-name');
    this.trackAlbum = document.getElementById('track-album');
    this.lastSync = document.getElementById('last-sync');
    this.audioCard = document.getElementById('audio-status');
    this.albumArt = document.getElementById('album-art');
    this.artPlaceholder = document.getElementById('art-placeholder');
    this.totalScrobbles = document.getElementById('total-scrobbles');
    this.topGenre = document.getElementById('top-genre');
    
    this.lastUpdateTime = null;
    this.updateInterval = null;
    this.clientCache = {
      lastArtworkUrl: null,
      lastTrackId: null
    };
    
    this.init();
  }
  
  init() {
    this.setStatus('INITIALIZING AUDIO SUBSYSTEM...', 'loading');
    this.updateLastFM();
    
    // Update every 5 minutes (300000ms)
    this.updateInterval = setInterval(() => {
      this.updateLastFM();
    }, 300000);
  }
  
  async updateLastFM() {
    try {
      this.setStatus('SYNCING WITH AUDIO SERVER...', 'loading');
      
      const response = await fetch('/api/lastfm');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      this.displayTrack(data);
      this.updateSyncTime();
      
    } catch (error) {
      console.error('Audio subsystem error:', error);
      this.setErrorState(error.message);
    }
  }
  
  displayTrack(data) {
    // Remove any error states
    this.audioCard.classList.remove('audio-error', 'audio-loading');
    
    // Update track information
    this.trackArtist.textContent = data.artist || 'UNKNOWN ARTIST';
    this.trackName.textContent = data.name || 'UNKNOWN TRACK';
    this.trackAlbum.textContent = data.album || 'UNKNOWN ALBUM';
    
    // Handle album artwork
    this.updateAlbumArt(data.albumArt);
    
    // Update statistics
    this.updateStatistics(data);
    
    // Update status based on playback state
    if (data.nowPlaying) {
      this.setStatus('AUDIO STREAM ACTIVE', 'playing');
      this.statusDot.classList.add('playing');
      this.statusDot.classList.remove('offline');
    } else {
      this.setStatus('LAST TRANSMISSION RECORDED', 'idle');
      this.statusDot.classList.remove('playing');
      this.statusDot.classList.add('offline');
    }
  }
  
  updateStatistics(data) {
    // Update total scrobbles
    if (this.totalScrobbles) {
      this.totalScrobbles.textContent = data.totalScrobbles || '---';
    }
    
    // Update top artist (used as genre approximation)
    if (this.topGenre) {
      const topArtist = data.topArtist;
      if (topArtist && topArtist !== 'ANALYZING...' && topArtist !== 'UNKNOWN') {
        this.topGenre.textContent = `${topArtist.toUpperCase()} [ARTIST]`;
      } else {
        this.topGenre.textContent = topArtist || 'ANALYZING...';
      }
    }
  }
  
  updateAlbumArt(artworkUrl) {
    const currentTrackId = `${this.trackArtist.textContent}-${this.trackName.textContent}-${this.trackAlbum.textContent}`;
    
    if (artworkUrl && artworkUrl !== '') {
      // Store the new artwork URL and track ID
      this.clientCache.lastArtworkUrl = artworkUrl;
      this.clientCache.lastTrackId = currentTrackId;
      
      this.albumArt.onload = () => {
        this.albumArt.classList.add('loaded');
        this.artPlaceholder.classList.add('hidden');
        console.log('Album artwork loaded successfully');
      };
      
      this.albumArt.onerror = () => {
        console.warn('Failed to load album artwork, trying cached version');
        this.tryFallbackArtwork();
      };
      
      this.albumArt.src = artworkUrl;
    } else {
      // No artwork provided, check if we have cached artwork for this track
      if (this.clientCache.lastArtworkUrl && this.clientCache.lastTrackId === currentTrackId) {
        console.log('Using cached artwork for same track');
        this.albumArt.onload = () => {
          this.albumArt.classList.add('loaded');
          this.artPlaceholder.classList.add('hidden');
        };
        this.albumArt.src = this.clientCache.lastArtworkUrl;
      } else {
        this.showPlaceholder();
      }
    }
  }
  
  tryFallbackArtwork() {
    // Try to use cached artwork if current load fails
    if (this.clientCache.lastArtworkUrl && this.albumArt.src !== this.clientCache.lastArtworkUrl) {
      console.log('Trying cached artwork as fallback');
      this.albumArt.src = this.clientCache.lastArtworkUrl;
    } else {
      this.showPlaceholder();
    }
  }
  
  showPlaceholder() {
    this.albumArt.classList.remove('loaded');
    this.artPlaceholder.classList.remove('hidden');
  }
  
  setStatus(message, state) {
    this.playbackStatus.textContent = message;
    
    // Remove existing state classes
    this.audioCard.classList.remove('audio-error', 'audio-loading');
    
    // Add appropriate state class
    if (state === 'loading') {
      this.audioCard.classList.add('audio-loading');
    } else if (state === 'error') {
      this.audioCard.classList.add('audio-error');
    }
  }
  
  setErrorState(errorMessage) {
    this.audioCard.classList.add('audio-error');
    this.audioCard.classList.remove('audio-loading');
    
    this.setStatus('AUDIO SUBSYSTEM ERROR', 'error');
    this.trackArtist.textContent = 'ERROR';
    this.trackName.textContent = errorMessage.toUpperCase();
    this.trackAlbum.textContent = 'SYSTEM DIAGNOSTIC REQUIRED';
    
    this.statusDot.classList.remove('playing');
    this.statusDot.classList.add('offline');
    
    // Show placeholder for error state
    this.showPlaceholder();
    
    // Clear statistics on error
    if (this.totalScrobbles) {
      this.totalScrobbles.textContent = 'ERROR';
    }
    if (this.topGenre) {
      this.topGenre.textContent = 'SYSTEM OFFLINE';
    }
    
    this.updateSyncTime();
  }
  
  updateSyncTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    this.lastSync.textContent = timeString;
    this.lastUpdateTime = now; // Store as Date object for comparison
  }
  
  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }
  
  // Debug method to check cache status
  async debugCacheStatus() {
    try {
      const response = await fetch('/api/cache-status');
      const cacheStatus = await response.json();
      console.log('Server Cache Status:', cacheStatus);
      console.log('Client Cache:', this.clientCache);
      return cacheStatus;
    } catch (error) {
      console.error('Failed to fetch cache status:', error);
    }
  }
}

// Terminal initialization sequence
document.addEventListener('DOMContentLoaded', () => {
  console.log('TERMINAL//FKLR-F23 INITIALIZING...');
  console.log('LOADING AUDIO SUBSYSTEM...');
  
  // Initialize audio subsystem
  const audioSubsystem = new AudioSubsystem();
  
  // Store reference globally for debugging
  window.audioSubsystem = audioSubsystem;
  
  // Add debug command to console
  console.log('DEBUG COMMANDS AVAILABLE:');
  console.log('- window.audioSubsystem.debugCacheStatus() - Check cache status');
  console.log('- window.audioSubsystem.updateLastFM() - Force update');
  
  console.log('TERMINAL SYSTEMS ONLINE');
  console.log('FALKE UNIT READY FOR OPERATION');
});

// Handle page visibility changes to pause/resume updates
document.addEventListener('visibilitychange', () => {
  if (window.audioSubsystem) {
    if (document.hidden) {
      console.log('TERMINAL ENTERING STANDBY MODE');
    } else {
      console.log('TERMINAL RESUMING OPERATION');
      
      // Only update if it's been more than 2 minutes since last update
      const now = new Date();
      const timeSinceUpdate = window.audioSubsystem.lastUpdateTime ? 
        (now - window.audioSubsystem.lastUpdateTime) : Infinity;
      
      if (timeSinceUpdate > 2 * 60 * 1000) { // 2 minutes
        console.log('REFRESHING AUDIO DATA - STALE DATA DETECTED');
        window.audioSubsystem.updateLastFM();
      } else {
        console.log('AUDIO DATA STILL FRESH - NO UPDATE NEEDED');
      }
    }
  }
});
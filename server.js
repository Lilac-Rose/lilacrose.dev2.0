require('dotenv').config();
const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "public")));

// SIGNALIS-themed logging
const log = (message, type = 'INFO') => {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const prefix = `[FKLR-F23 ${type}] ${timestamp}`;
  console.log(`${prefix}: ${message}`);
};

// Middleware for SIGNALIS-themed request logging
app.use((req, res, next) => {
  log(`${req.method} ${req.path} - Connection from ${req.ip}`, 'CONN');
  next();
});

// API endpoint to fetch Last.fm information
app.get("/api/lastfm", async (req, res) => {
  const username = process.env.LASTFM_USERNAME;
  const apiKey = process.env.LASTFM_API_KEY;
  
  log('Audio subsystem query initiated', 'AUDIO');
  
  // Validate environment variables
  if (!username || !apiKey) {
    const errorMsg = 'Last.fm credentials not configured';
    log(errorMsg, 'ERROR');
    return res.status(500).json({ 
      error: 'AUDIO_SUBSYSTEM_CONFIG_ERROR',
      message: errorMsg
    });
  }
  
  try {
    log(`Requesting audio data for unit: ${username}`, 'AUDIO');
    
    // Make multiple API calls concurrently for efficiency
    const [recentTracksRes, userInfoRes, topArtistsRes] = await Promise.all([
      // Recent tracks
      axios.get('https://ws.audioscrobbler.com/2.0/', {
        params: {
          method: "user.getrecenttracks",
          user: username,
          api_key: apiKey,
          format: "json",
          limit: 1
        },
        timeout: 10000
      }),
      // User info for total scrobbles
      axios.get('https://ws.audioscrobbler.com/2.0/', {
        params: {
          method: "user.getinfo",
          user: username,
          api_key: apiKey,
          format: "json"
        },
        timeout: 10000
      }),
      // Top artists for genre approximation
      axios.get('https://ws.audioscrobbler.com/2.0/', {
        params: {
          method: "user.gettopartists",
          user: username,
          api_key: apiKey,
          format: "json",
          period: "1month",
          limit: 1
        },
        timeout: 10000
      })
    ]);
    
    // Process recent tracks
    if (!recentTracksRes.data || !recentTracksRes.data.recenttracks) {
      throw new Error('Invalid recent tracks response from Last.fm API');
    }
    
    const recentTracks = recentTracksRes.data.recenttracks.track;
    
    // Handle case where no tracks are found
    if (!recentTracks || (Array.isArray(recentTracks) && recentTracks.length === 0)) {
      log('No recent tracks found for user', 'AUDIO');
      return res.json({
        artist: 'NO DATA',
        name: 'NO RECENT TRANSMISSIONS',
        album: 'EMPTY ARCHIVE',
        albumArt: '',
        nowPlaying: false,
        totalScrobbles: 0,
        topArtist: 'UNKNOWN'
      });
    }
    
    // Get the most recent track
    const track = Array.isArray(recentTracks) ? recentTracks[0] : recentTracks;
    const isNowPlaying = track['@attr']?.nowplaying === 'true';
    
    // Get album artwork
    let albumArt = '';
    if (track.image && Array.isArray(track.image)) {
      const artworkSizes = ['extralarge', 'large', 'medium', 'small'];
      for (const size of artworkSizes) {
        const artwork = track.image.find(img => img.size === size);
        if (artwork && artwork['#text'] && artwork['#text'].trim()) {
          albumArt = artwork['#text'];
          break;
        }
      }
    }
    
    // Process user info for total scrobbles
    const userInfo = userInfoRes.data?.user;
    const totalScrobbles = userInfo?.playcount ? parseInt(userInfo.playcount).toLocaleString() : '0';
    
    // Process top artist
    const topArtists = topArtistsRes.data?.topartists?.artist;
    let topArtist = 'ANALYZING...';
    if (topArtists && topArtists.length > 0) {
      const artist = Array.isArray(topArtists) ? topArtists[0] : topArtists;
      topArtist = artist.name || 'UNKNOWN';
    }
    
    const trackData = {
      artist: track.artist?.['#text'] || track.artist?.name || 'UNKNOWN ARTIST',
      name: track.name || 'UNKNOWN TRACK',
      album: track.album?.['#text'] || 'UNKNOWN ALBUM',
      albumArt: albumArt,
      nowPlaying: isNowPlaying,
      totalScrobbles: totalScrobbles,
      topArtist: topArtist
    };
    
    log(`Audio data retrieved: ${trackData.artist} - ${trackData.name} [${isNowPlaying ? 'STREAMING' : 'ARCHIVED'}]${albumArt ? ' [ARTWORK]' : ''} | ${totalScrobbles} scrobbles`, 'AUDIO');
    
    res.json(trackData);
    
  } catch (error) {
    let errorMessage = 'Failed to fetch audio data';
    let errorCode = 'AUDIO_SUBSYSTEM_ERROR';
    
    if (error.code === 'ENOTFOUND') {
      errorMessage = 'Network connection failed';
      errorCode = 'NETWORK_ERROR';
    } else if (error.response?.status === 403) {
      errorMessage = 'Authentication failed';
      errorCode = 'AUTH_ERROR';
    } else if (error.response?.status === 404) {
      errorMessage = 'User not found';
      errorCode = 'USER_NOT_FOUND';
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'Request timeout';
      errorCode = 'TIMEOUT_ERROR';
    }
    
    log(`${errorMessage}: ${error.message}`, 'ERROR');
    
    res.status(500).json({ 
      error: errorCode,
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  log('System health check requested', 'SYS');
  res.json({
    status: 'OPERATIONAL',
    timestamp: new Date().toISOString(),
    subsystems: {
      audio: process.env.LASTFM_USERNAME && process.env.LASTFM_API_KEY ? 'CONFIGURED' : 'NOT_CONFIGURED',
      terminal: 'ONLINE'
    }
  });
});

// Serve main page
app.get("/", (req, res) => {
  log('Terminal interface requested', 'TERM');
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 404 handler with SIGNALIS theme
app.use((req, res) => {
  log(`Resource not found: ${req.path}`, 'ERROR');
  res.status(404).json({
    error: 'RESOURCE_NOT_FOUND',
    message: 'Requested resource not available in terminal database',
    path: req.path
  });
});

// Error handler
app.use((error, req, res, next) => {
  log(`Unhandled error: ${error.message}`, 'CRITICAL');
  res.status(500).json({
    error: 'SYSTEM_ERROR',
    message: 'Critical system error occurred'
  });
});

// Start server
app.listen(PORT, "127.0.0.1", () => {
  log('═══════════════════════════════════════', 'SYS');
  log('FALKE TERMINAL INTERFACE INITIALIZING', 'SYS');
  log('═══════════════════════════════════════', 'SYS');
  log(`Terminal online at http://127.0.0.1:${PORT}`, 'SYS');
  log(`Audio subsystem: ${process.env.LASTFM_USERNAME ? 'CONFIGURED' : 'NOT CONFIGURED'}`, 'AUDIO');
  log('UNIT FKLR-F23 READY FOR OPERATION', 'SYS');
  log('═══════════════════════════════════════', 'SYS');
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('Shutdown signal received', 'SYS');
  log('FALKE UNIT ENTERING STANDBY MODE', 'SYS');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('Termination signal received', 'SYS');
  log('EMERGENCY SHUTDOWN INITIATED', 'SYS');
  process.exit(0);
});
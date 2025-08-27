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

// Retry wrapper for axios calls
async function fetchWithRetry(url, options, retries = 2, delay = 500) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.get(url, options);
    } catch (err) {
      if (i === retries) throw err;
      log(`Retrying ${url} after failure: ${err.message}`, 'WARN');
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// API endpoint to fetch Last.fm information
app.get("/api/lastfm", async (req, res) => {
  const username = process.env.LASTFM_USERNAME;
  const apiKey = process.env.LASTFM_API_KEY;

  log('Audio subsystem query initiated', 'AUDIO');

  // Validate environment variables
  if (!username || !apiKey) {
    const errorMsg = 'Last.fm credentials not configured';
    log(errorMsg, 'ERROR');
    return res.json({
      artist: 'ERROR',
      name: 'SYSTEM OFFLINE',
      album: 'CONFIG ERROR',
      albumArt: '',
      nowPlaying: false,
      totalScrobbles: '---',
      topArtist: 'UNKNOWN',
      error: 'AUDIO_SUBSYSTEM_CONFIG_ERROR',
      message: errorMsg
    });
  }

  try {
    log(`Requesting audio data for unit: ${username}`, 'AUDIO');

    // Prepare requests
    const requests = [
      fetchWithRetry('https://ws.audioscrobbler.com/2.0/', {
        params: {
          method: "user.getrecenttracks",
          user: username,
          api_key: apiKey,
          format: "json",
          limit: 1
        },
        timeout: 10000
      }),
      fetchWithRetry('https://ws.audioscrobbler.com/2.0/', {
        params: {
          method: "user.getinfo",
          user: username,
          api_key: apiKey,
          format: "json"
        },
        timeout: 10000
      }),
      fetchWithRetry('https://ws.audioscrobbler.com/2.0/', {
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
    ];

    // Run all requests safely
    const [recentTracksRes, userInfoRes, topArtistsRes] = await Promise.allSettled(requests);

    // Process recent tracks
    let track = null;
    let isNowPlaying = false;
    let albumArt = '';
    if (recentTracksRes.status === 'fulfilled') {
      const recentTracks = recentTracksRes.value.data?.recenttracks?.track;
      if (recentTracks && (Array.isArray(recentTracks) ? recentTracks.length > 0 : true)) {
        track = Array.isArray(recentTracks) ? recentTracks[0] : recentTracks;
        isNowPlaying = track['@attr']?.nowplaying === 'true';

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
      } else {
        log('No recent tracks found for user', 'AUDIO');
      }
    } else {
      log(`Recent tracks request failed: ${recentTracksRes.reason?.message}`, 'WARN');
    }

    // Process user info
    let totalScrobbles = '---';
    if (userInfoRes.status === 'fulfilled') {
      const playcount = userInfoRes.value.data?.user?.playcount;
      totalScrobbles = playcount ? parseInt(playcount).toLocaleString() : '0';
    } else {
      log(`User info request failed: ${userInfoRes.reason?.message}`, 'WARN');
    }

    // Process top artist
    let topArtist = 'UNKNOWN';
    if (topArtistsRes.status === 'fulfilled') {
      const artists = topArtistsRes.value.data?.topartists?.artist;
      if (artists && artists.length > 0) {
        topArtist = artists[0].name || 'UNKNOWN';
      }
    } else {
      log(`Top artists request failed: ${topArtistsRes.reason?.message}`, 'WARN');
    }

    const trackData = {
      artist: track?.artist?.['#text'] || track?.artist?.name || 'UNKNOWN ARTIST',
      name: track?.name || 'UNKNOWN TRACK',
      album: track?.album?.['#text'] || 'UNKNOWN ALBUM',
      albumArt,
      nowPlaying: isNowPlaying,
      totalScrobbles,
      topArtist
    };

    log(`Audio data retrieved: ${trackData.artist} - ${trackData.name} [${isNowPlaying ? 'STREAMING' : 'ARCHIVED'}]${albumArt ? ' [ARTWORK]' : ''} | ${totalScrobbles} scrobbles`, 'AUDIO');

    res.json(trackData);

  } catch (error) {
    log(`Critical audio subsystem failure: ${error.message}`, 'CRITICAL');
    res.json({
      artist: 'ERROR',
      name: 'SYSTEM OFFLINE',
      album: 'FAILED TO FETCH DATA',
      albumArt: '',
      nowPlaying: false,
      totalScrobbles: '---',
      topArtist: 'UNKNOWN',
      error: 'AUDIO_SUBSYSTEM_ERROR',
      message: 'Failed to fetch audio data'
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
  res.json({
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

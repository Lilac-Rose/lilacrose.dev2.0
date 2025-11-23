import os
import asyncio
from datetime import datetime
from dotenv import load_dotenv
from quart import Quart, jsonify, send_from_directory, request
import aiohttp

load_dotenv()

app = Quart(__name__)
app.config["ENV"] = os.getenv("FLASK_ENV", "production")
app.config["DEBUG"] = os.getenv("FLASK_DEBUG", "False").lower() == "true"
PORT = int(os.getenv("PORT", 3000))

# SIGNALIS-themed logging
def log(message, log_type='INFO'):
    timestamp = datetime.now().isoformat().replace('T', ' ')[:19]
    prefix = f"[FKLR-F23 {log_type}] {timestamp}"
    print(f"{prefix}: {message}")

# Middleware for SIGNALIS-themed request logging
@app.before_request
async def log_request():
    log(f"{request.method} {request.path} - Connection from {request.remote_addr}", 'CONN')

# Retry wrapper for aiohttp calls
async def fetch_with_retry(session, url, params=None, retries=2, delay=0.5):
    for i in range(retries + 1):
        try:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as response:
                return await response.json()
        except Exception as err:
            if i == retries:
                raise err
            log(f"Retrying {url} after failure: {err}", 'WARN')
            await asyncio.sleep(delay)

# API endpoint to fetch Last.fm information
@app.route("/api/lastfm")
async def lastfm():
    username = os.getenv("LASTFM_USERNAME")
    api_key = os.getenv("LASTFM_API_KEY")
    
    log('Audio subsystem query initiated', 'AUDIO')
    
    # Validate environment variables
    if not username or not api_key:
        error_msg = 'Last.fm credentials not configured'
        log(error_msg, 'ERROR')
        return jsonify({
            "artist": "ERROR",
            "name": "SYSTEM OFFLINE",
            "album": "CONFIG ERROR",
            "albumArt": "",
            "nowPlaying": False,
            "totalScrobbles": "---",
            "topArtist": "UNKNOWN",
            "error": "AUDIO_SUBSYSTEM_CONFIG_ERROR",
            "message": error_msg
        })
    
    try:
        log(f"Requesting audio data for unit: {username}", 'AUDIO')
        
        async with aiohttp.ClientSession() as session:
            # Prepare all requests
            base_url = 'https://ws.audioscrobbler.com/2.0/'
            
            tasks = [
                fetch_with_retry(session, base_url, {
                    "method": "user.getrecenttracks",
                    "user": username,
                    "api_key": api_key,
                    "format": "json",
                    "limit": 1
                }),
                fetch_with_retry(session, base_url, {
                    "method": "user.getinfo",
                    "user": username,
                    "api_key": api_key,
                    "format": "json"
                }),
                fetch_with_retry(session, base_url, {
                    "method": "user.gettopartists",
                    "user": username,
                    "api_key": api_key,
                    "format": "json",
                    "period": "1month",
                    "limit": 1
                })
            ]
            
            # Run all requests concurrently
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Process recent tracks
            track = None
            is_now_playing = False
            album_art = ''
            
            if not isinstance(results[0], Exception):
                recent_tracks = results[0].get('recenttracks', {}).get('track')
                if recent_tracks:
                    track = recent_tracks[0] if isinstance(recent_tracks, list) else recent_tracks
                    is_now_playing = track.get('@attr', {}).get('nowplaying') == 'true'
                    
                    # Get album art
                    if track.get('image'):
                        for size in ['extralarge', 'large', 'medium', 'small']:
                            artwork = next((img for img in track['image'] if img.get('size') == size), None)
                            if artwork and artwork.get('#text', '').strip():
                                album_art = artwork['#text']
                                break
                else:
                    log('No recent tracks found for user', 'AUDIO')
            else:
                log(f"Recent tracks request failed: {results[0]}", 'WARN')
            
            # Process user info
            total_scrobbles = '---'
            if not isinstance(results[1], Exception):
                playcount = results[1].get('user', {}).get('playcount')
                if playcount:
                    total_scrobbles = f"{int(playcount):,}"
            else:
                log(f"User info request failed: {results[1]}", 'WARN')
            
            # Process top artist
            top_artist = 'UNKNOWN'
            if not isinstance(results[2], Exception):
                artists = results[2].get('topartists', {}).get('artist', [])
                if artists:
                    top_artist = artists[0].get('name', 'UNKNOWN')
            else:
                log(f"Top artists request failed: {results[2]}", 'WARN')
            
            # Build response
            track_data = {
                "artist": track.get('artist', {}).get('#text') if isinstance(track.get('artist'), dict) else track.get('artist', {}).get('name', 'UNKNOWN ARTIST') if track else 'UNKNOWN ARTIST',
                "name": track.get('name', 'UNKNOWN TRACK') if track else 'UNKNOWN TRACK',
                "album": track.get('album', {}).get('#text', 'UNKNOWN ALBUM') if track else 'UNKNOWN ALBUM',
                "albumArt": album_art,
                "nowPlaying": is_now_playing,
                "totalScrobbles": total_scrobbles,
                "topArtist": top_artist
            }
            
            status = 'STREAMING' if is_now_playing else 'ARCHIVED'
            artwork_str = ' [ARTWORK]' if album_art else ''
            log(f"Audio data retrieved: {track_data['artist']} - {track_data['name']} [{status}]{artwork_str} | {total_scrobbles} scrobbles", 'AUDIO')
            
            return jsonify(track_data)
    
    except Exception as error:
        log(f"Critical audio subsystem failure: {error}", 'CRITICAL')
        return jsonify({
            "artist": "ERROR",
            "name": "SYSTEM OFFLINE",
            "album": "FAILED TO FETCH DATA",
            "albumArt": "",
            "nowPlaying": False,
            "totalScrobbles": "---",
            "topArtist": "UNKNOWN",
            "error": "AUDIO_SUBSYSTEM_ERROR",
            "message": "Failed to fetch audio data"
        })

# Health check endpoint
@app.route("/api/health")
async def health():
    log('System health check requested', 'SYS')
    return jsonify({
        "status": "OPERATIONAL",
        "timestamp": datetime.now().isoformat(),
        "subsystems": {
            "audio": "CONFIGURED" if os.getenv("LASTFM_USERNAME") and os.getenv("LASTFM_API_KEY") else "NOT_CONFIGURED",
            "terminal": "ONLINE"
        }
    })

# Serve static files
@app.route("/<path:filename>")
async def serve_static(filename):
    return await send_from_directory("public", filename)

# Serve main page
@app.route("/")
async def index():
    log('Terminal interface requested', 'TERM')
    return await send_from_directory("public", "index.html")

# 404 handler with SIGNALIS theme
@app.errorhandler(404)
async def not_found(error):
    log(f"Resource not found: {request.path}", 'ERROR')
    return jsonify({
        "error": "RESOURCE_NOT_FOUND",
        "message": "Requested resource not available in terminal database",
        "path": request.path
    }), 404

# Error handler
@app.errorhandler(Exception)
async def handle_error(error):
    log(f"Unhandled error: {error}", 'CRITICAL')
    return jsonify({
        "error": "SYSTEM_ERROR",
        "message": "Critical system error occurred"
    }), 500

if __name__ == "__main__":
    log('═══════════════════════════════════════', 'SYS')
    log('FALKE TERMINAL INTERFACE INITIALIZING', 'SYS')
    log('═══════════════════════════════════════', 'SYS')
    log(f"Terminal online at http://127.0.0.1:{PORT}", 'SYS')
    log(f"Audio subsystem: {'CONFIGURED' if os.getenv('LASTFM_USERNAME') else 'NOT CONFIGURED'}", 'AUDIO')
    log('UNIT FKLR-F23 READY FOR OPERATION', 'SYS')
    log('═══════════════════════════════════════', 'SYS')
    
    app.run(host="127.0.0.1", port=PORT)

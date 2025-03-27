const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https'); // Added for stream proxy
const cors = require('cors');
const socketIo = require('socket.io');
const { Parser } = require('icecast-parser');
const SpotifyWebApi = require('spotify-web-api-node');
const sqlite3 = require('sqlite3').verbose();

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const METADATA_CHECK_INTERVAL = 5000; // Check metadata every 5 seconds
const HISTORY_LIMIT = 50; // Keep last 50 tracks in memory per station

// Spotify API configuration - **MUST be set as Environment Variables on Render**
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// Default Album Art (SVG)
const DEFAULT_ALBUM_ART = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzU1NSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMTQuNWMtMi40OSAwLTQuNS0yLjAxLTQuNS00LjVTOS41MSA3LjUgMTIgNy41czQuNSAyLjAxIDQuNSA0LjUtMi4wMSA0LjUtNC41IDQuNXptMC01LjVjLS41NSAwLTEgLjQ1LTEgMXMuNDUgMSAxIDEgMS0uNDUgMS0xLS40NS0xLTEtMXoiLz48L3N2Zz4=';

// --- Database Setup ---
// Use /tmp for ephemeral storage on Render Free Tier
// WARNING: Database file will be LOST on every restart!
const dbPath = process.env.NODE_ENV === 'production'
  ? '/tmp/radio_history.db' // Use ephemeral storage in /tmp
  : path.join(__dirname, 'radio_history.db'); // Local development path

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    console.error(`Database path used: ${dbPath}`);
  } else {
    console.log(`Connected to SQLite database at ${dbPath}`);
    console.warn(`WARNING: Using ephemeral storage at ${dbPath}. Database will be lost on restarts/deploys.`);
    initDatabase(); // Initialize schema after connection
  }
});


// --- Spotify API Setup ---
let spotifyApi;
let spotifyAccessToken = null;
let spotifyTokenExpiresAt = 0;

if (SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET) {
    spotifyApi = new SpotifyWebApi({
        clientId: SPOTIFY_CLIENT_ID,
        clientSecret: SPOTIFY_CLIENT_SECRET
    });
} else {
    console.warn('SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET not set in environment variables. Spotify features will be disabled.');
}

// --- Express App & Socket.IO Setup ---
const app = express();
app.use(cors());
app.use(express.static('public'));

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins for simplicity, restrict in production if needed
    methods: ["GET", "POST"]
  }
});

// --- Global State ---
let radioStations = {}; // Holds { name: { url, description, parser, currentMetadata, history } }

// --- Database Initialization ---
function initDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station TEXT NOT NULL,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      albumArt TEXT,
      spotifyUrl TEXT -- Added Spotify URL column
    )`, (err) => {
        if(err) {
            console.error("Error creating history table:", err.message);
        } else {
            console.log('Database table "history" checked/created.');
             db.run('CREATE INDEX IF NOT EXISTS idx_station_timestamp ON history (station, timestamp DESC)', (indexErr) => {
                if(indexErr) console.error("Error creating index:", indexErr.message);
                else console.log("Database index checked/created.");
             });
        }
    });
  });
}

// --- Stream Loading ---
function loadStreams() {
  const loadedStreams = {};
  try {
    const streamsFilePath = path.join(__dirname, 'streams.txt');
    if (!fs.existsSync(streamsFilePath)) {
        console.error(`Error: streams.txt not found at ${streamsFilePath}`);
        return {};
    }
    const streamsFile = fs.readFileSync(streamsFilePath, 'utf8');
    const lines = streamsFile.split('\n').filter(line => line.trim() && !line.startsWith('//'));

    lines.forEach(line => {
      const parts = line.split('|');
      if (parts.length >= 2) {
          const name = parts[0].trim();
          const url = parts[1].trim();
          const description = (parts[2] || '').trim();
          if (name && url) {
            loadedStreams[name] = {
              url,
              description: description || name,
              parser: null,
              currentMetadata: createDefaultMetadata(name),
              history: []
            };
          } else {
             console.warn(`Skipping invalid line in streams.txt: ${line}`);
          }
      } else {
         console.warn(`Skipping invalid line format in streams.txt: ${line}`);
      }
    });
    console.log(`${Object.keys(loadedStreams).length} streams loaded from streams.txt`);
  } catch (error) {
    console.error('Error loading streams from streams.txt:', error);
  }
  return loadedStreams;
}

// Helper to create default metadata
function createDefaultMetadata(stationName) {
    return {
        artist: 'Loading...',
        title: 'Waiting for stream info...',
        timestamp: new Date().toISOString(),
        albumArt: DEFAULT_ALBUM_ART,
        spotifyUrl: null
    };
}

// --- Spotify Functions ---
async function refreshSpotifyToken() {
    if (!spotifyApi) return false;
    try {
        console.log('Refreshing Spotify token...');
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyAccessToken = data.body['access_token'];
        spotifyTokenExpiresAt = Date.now() + (data.body['expires_in'] - 60) * 1000;
        spotifyApi.setAccessToken(spotifyAccessToken);
        console.log('Spotify token refreshed successfully.');
        return true;
    } catch (error) {
        console.error('Error refreshing Spotify token:', error.message || error);
        spotifyTokenExpiresAt = 0;
        return false;
    }
}

async function getValidSpotifyApi() {
    if (!spotifyApi) return null;
    if (!spotifyAccessToken || Date.now() >= spotifyTokenExpiresAt) {
        const refreshed = await refreshSpotifyToken();
        if (!refreshed) return null;
    }
    return spotifyApi;
}

async function getSpotifyData(artist, title) {
    const currentSpotifyApi = await getValidSpotifyApi();
    if (!currentSpotifyApi) {
        return { albumArt: DEFAULT_ALBUM_ART, spotifyUrl: null };
    }
    const cleanTitle = title.replace(/ *\([^)]*\) */g, "").replace(/ *\[[^\]]*\] */g, "").trim();
    const cleanArtist = artist.replace(/ *\([^)]*\) */g, "").replace(/ *\[[^\]]*\] */g, "").trim();
    if (!cleanArtist || !cleanTitle) {
         return { albumArt: DEFAULT_ALBUM_ART, spotifyUrl: null };
    }
    const query = `track:${cleanTitle} artist:${cleanArtist}`;
    try {
        const searchResult = await currentSpotifyApi.searchTracks(query, { limit: 1 });
        if (searchResult.body.tracks && searchResult.body.tracks.items.length > 0) {
            const track = searchResult.body.tracks.items[0];
            const albumImage = track.album?.images?.[0]?.url || DEFAULT_ALBUM_ART;
            const spotifyUrl = track.external_urls?.spotify || null;
            return { albumArt: albumImage, spotifyUrl: spotifyUrl };
        }
    } catch (error) {
        console.error(`Error searching Spotify for "${query}":`, error.message || error);
        if (error.statusCode === 401) {
            console.log('Spotify token likely expired, forcing refresh on next attempt.');
            spotifyTokenExpiresAt = 0;
        }
    }
    return { albumArt: DEFAULT_ALBUM_ART, spotifyUrl: null };
}

// --- Database Saving ---
function saveMetadataToDatabase(stationName, metadata) {
  const { artist, title, timestamp, albumArt, spotifyUrl } = metadata;
  if (!artist || !title || artist === 'Loading...' || title === 'Waiting for stream info...') {
      return;
  }
  db.run(
    'INSERT INTO history (station, artist, title, timestamp, albumArt, spotifyUrl) VALUES (?, ?, ?, ?, ?, ?)',
    [stationName, artist, title, timestamp, albumArt || null, spotifyUrl || null],
    function(err) {
      if (err) {
        console.error(`Error saving metadata to DB for ${stationName}:`, err.message);
      }
    }
  );
}

// --- Radio Station Initialization ---
function initRadioStation(name, url) {
  console.log(`Initializing parser for station: ${name} (${url})`);
  try {
    const radioStation = new Parser({
      url: url,
      userAgent: 'RadioPlaylistTracker/1.0 (github.com/mmooij87/RadioPlaylistServerbased)',
      keepListen: false,
      autoUpdate: true,
      metadataInterval: METADATA_CHECK_INTERVAL / 1000
    });

    radioStation.on('metadata', async (metadata) => {
      const streamTitle = metadata.get('StreamTitle');
      if (streamTitle) {
        const parts = streamTitle.split(' - ');
        if (parts.length >= 2) {
          const artist = parts[0].trim();
          const title = parts.slice(1).join(' - ').trim();
          if (!artist || !title) return;
          const current = radioStations[name]?.currentMetadata;
          if (current && current.artist === artist && current.title === title) return;

          console.log(`New track detected for ${name}: ${artist} - ${title}`);
          const { albumArt, spotifyUrl } = await getSpotifyData(artist, title);
          const newMetadata = { artist, title, timestamp: new Date().toISOString(), albumArt, spotifyUrl };

          radioStations[name].currentMetadata = newMetadata;
          radioStations[name].history.unshift(newMetadata);
          if (radioStations[name].history.length > HISTORY_LIMIT) {
            radioStations[name].history.pop();
          }
          saveMetadataToDatabase(name, newMetadata);
          io.emit('metadataUpdate', { station: name, metadata: newMetadata });
          io.emit('historyUpdate', { station: name, history: radioStations[name].history });
        }
      }
    });

    radioStation.on('error', (error) => {
      console.error(`Parser error for station ${name} (${url}):`, error.message || error);
    });
    // radioStation.on('stream', (stream) => { console.log(`Connected to stream for ${name}`); });

    return radioStation;
  } catch (error) {
    console.error(`Failed to initialize parser for ${name}:`, error);
    return null;
  }
}

// --- Initialization Function ---
async function initialize() {
  console.log("Initializing application...");
  radioStations = loadStreams();
  if (Object.keys(radioStations).length === 0) {
      console.error("Initialization failed: No streams loaded. Check streams.txt.");
      return;
  }
  if (spotifyApi) {
    await refreshSpotifyToken();
  }
  Object.entries(radioStations).forEach(([name, stationData]) => {
    const parserInstance = initRadioStation(name, stationData.url);
    if (parserInstance) radioStations[name].parser = parserInstance;
    else console.warn(`Parser could not be created for station ${name}. It will be unavailable.`);
  });
  console.log("Initialization complete.");
}

// --- Stream Proxy Route ---
app.get('/proxy-stream/:stationName', (req, res) => {
  const stationName = req.params.stationName;
  const stationData = radioStations[stationName];
  if (!stationData || !stationData.url) {
    console.error(`Proxy request failed: Station "${stationName}" not found.`);
    return res.status(404).send('Station not found');
  }
  const streamUrl = stationData.url;
  const protocol = streamUrl.startsWith('https') ? https : http;
  const proxyRequest = protocol.get(streamUrl, { headers: { 'User-Agent': 'RadioPlaylistTracker/1.0 Proxy' }}, (streamResponse) => {
    if (streamResponse.statusCode !== 200) {
        console.error(`Proxy error for ${stationName}: Source stream returned status ${streamResponse.statusCode}`);
        res.status(streamResponse.statusCode || 502).send('Error fetching stream source');
        streamResponse.resume(); return;
    }
    res.writeHead(streamResponse.statusCode, { 'Content-Type': streamResponse.headers['content-type'] || 'audio/mpeg', 'Cache-Control': 'no-cache' });
    streamResponse.pipe(res);
    streamResponse.on('error', (err) => {
        console.error(`Proxy source stream error for ${stationName}:`, err.message);
        if (!res.headersSent) res.status(500).send('Stream source error');
        else res.end();
    });
  });
  proxyRequest.on('error', (err) => {
    console.error(`Proxy connection error for ${stationName} (${streamUrl}):`, err.message);
    if (!res.headersSent) res.status(502).send('Bad Gateway: Could not connect to stream source');
    else res.end();
  });
  req.on('close', () => { proxyRequest.destroy(); });
});

// --- API Routes ---
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/handleiding', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'handleiding.html')); });

app.get('/api/stations', (req, res) => {
  try {
    const stationList = Object.entries(radioStations).map(([name, station]) => ({ name, description: station.description }));
    res.json(stationList);
  } catch (error) {
    console.error('Error in /api/stations:', error);
    res.status(500).json({ error: 'Server error retrieving stations' });
  }
});

app.get('/api/metadata/current/:stationName?', (req, res) => {
  try {
    const stationName = req.params.stationName;
    if (stationName) {
      if (radioStations[stationName]) res.json(radioStations[stationName].currentMetadata);
      else res.status(404).json({ error: `Station '${stationName}' not found` });
    } else {
      const allCurrentMetadata = {};
      Object.entries(radioStations).forEach(([name, station]) => { allCurrentMetadata[name] = station.currentMetadata; });
      res.json(allCurrentMetadata);
    }
  } catch (error) {
    console.error('Error in /api/metadata/current:', error);
    res.status(500).json({ error: 'Server error retrieving current metadata' });
  }
});

app.get('/api/metadata/history/:stationName?', (req, res) => {
  try {
    const stationName = req.params.stationName;
    if (stationName) {
      if (radioStations[stationName]) res.json(radioStations[stationName].history);
      else res.status(404).json({ error: `Station '${stationName}' not found` });
    } else {
      const allMemoryHistory = {};
      Object.entries(radioStations).forEach(([name, station]) => { allMemoryHistory[name] = station.history; });
      res.json(allMemoryHistory);
    }
  } catch (error) {
    console.error('Error in /api/metadata/history:', error);
    res.status(500).json({ error: 'Server error retrieving recent history' });
  }
});

app.get('/api/metadata/database/:stationName?', (req, res) => {
    const stationName = req.params.stationName;
    const limit = parseInt(req.query.limit || '100', 10);
    let query = 'SELECT id, station, artist, title, timestamp, albumArt, spotifyUrl FROM history';
    let params = [];
    if (stationName) {
        if (!radioStations[stationName]) return res.status(404).json({ error: `Station '${stationName}' not found` });
        query += ' WHERE station = ?';
        params.push(stationName);
    }
    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);
    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('Database query error in /api/metadata/database:', err.message);
            res.status(500).json({ error: `Database query error: ${err.message}. History may be temporarily unavailable.` });
        } else {
            res.json(rows);
        }
    });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), totalStationsConfigured: Object.keys(radioStations).length });
});

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
  // console.log(`Client connected: ${socket.id}`);
  Object.entries(radioStations).forEach(([name, stationData]) => {
    socket.emit('metadataUpdate', { station: name, metadata: stationData.currentMetadata });
    socket.emit('historyUpdate', { station: name, history: stationData.history });
  });
  socket.on('disconnect', () => { /* console.log(`Client disconnected: ${socket.id}`); */ });

  socket.on('requestUpdate', (stationName) => {
    // console.log(`Client ${socket.id} requested update for ${stationName || 'all stations'}`);
    if (stationName && radioStations[stationName]) {
        socket.emit('metadataUpdate', {
            station: stationName,
            metadata: radioStations[stationName].currentMetadata
        });
        // ***** THE FIX IS HERE *****
        socket.emit('historyUpdate', { station: stationName, history: radioStations[stationName].history }); // Use stationName here
    } else {
      // Send all data again if specific station not found or not specified
      Object.entries(radioStations).forEach(([name, stationData]) => { // 'name' is defined in this scope
        socket.emit('metadataUpdate', { station: name, metadata: stationData.currentMetadata });
        socket.emit('historyUpdate', { station: name, history: stationData.history });
      });
    }
  });
});

// --- Start Server ---
(async () => {
    await initialize();
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server listening on http://0.0.0.0:${PORT}`);
    });
})();

// --- Graceful Shutdown ---
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

function handleShutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  server.close((err) => {
      if (err) console.error("Error closing server:", err);
      else console.log("HTTP server closed.");
      db.close((dbErr) => {
          if (dbErr) console.error('Error closing database:', dbErr.message);
          else console.log('Database connection closed.');
          console.log("Shutdown complete.");
          process.exit(err || dbErr ? 1 : 0);
      });
  });
   setTimeout(() => { console.error("Graceful shutdown timed out. Forcing exit."); process.exit(1); }, 10000);
}
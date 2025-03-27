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
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID; // || 'YOUR_FALLBACK_ID' // Fallbacks removed - rely on ENV vars
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET; // || 'YOUR_FALLBACK_SECRET'

// Default Album Art (SVG)
const DEFAULT_ALBUM_ART = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzU1NSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMTQuNWMtMi40OSAwLTQuNS0yLjAxLTQuNS00LjVTOS41MSA3LjUgMTIgNy41czQuNSAyLjAxIDQuNSA0LjUtMi4wMSA0LjUtNC41IDQuNXptMC01LjVjLS41NSAwLTEgLjQ1LTEgMXMuNDUgMSAxIDEgMS0uNDUgMS0xLS40NS0xLTEtMXoiLz48L3N2Zz4=';

// --- Database Setup ---
const dbPath = process.env.NODE_ENV === 'production'
  ? '/var/data/radio_history.db' // Use persistent disk on Render (create disk first)
  // ? '/tmp/radio_history.db' // Alternative: Use ephemeral storage on Render
  : path.join(__dirname, 'radio_history.db'); // Local development path

// Ensure directory exists for persistent disk path
if (process.env.NODE_ENV === 'production' && dbPath.startsWith('/var/data')) {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        console.log(`Creating database directory: ${dbDir}`);
        fs.mkdirSync(dbDir, { recursive: true });
    }
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    console.error(`Database path: ${dbPath}`);
    // Consider exiting if DB connection fails critically
    // process.exit(1);
  } else {
    console.log(`Connected to SQLite database at ${dbPath}`);
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
// app.use(express.json()); // Only needed if you have POST endpoints accepting JSON

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
            // Optional: Add index for faster station lookups
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
        return {}; // Return empty if file doesn't exist
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
              description: description || name, // Use name as fallback description
              parser: null, // Will be initialized later
              currentMetadata: createDefaultMetadata(name),
              history: [] // In-memory history for recent tracks
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
    // No fallback, rely solely on the file.
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
    if (!spotifyApi) return false; // No API instance

    try {
        console.log('Refreshing Spotify token...');
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyAccessToken = data.body['access_token'];
        // Calculate expiry time (subtracting 60 seconds buffer)
        spotifyTokenExpiresAt = Date.now() + (data.body['expires_in'] - 60) * 1000;
        spotifyApi.setAccessToken(spotifyAccessToken);
        console.log('Spotify token refreshed successfully.');
        return true;
    } catch (error) {
        console.error('Error refreshing Spotify token:', error.message || error);
        spotifyTokenExpiresAt = 0; // Force refresh next time
        return false;
    }
}

async function getValidSpotifyApi() {
    if (!spotifyApi) return null; // No Spotify configured

    // Check if token exists and is not expired
    if (!spotifyAccessToken || Date.now() >= spotifyTokenExpiresAt) {
        const refreshed = await refreshSpotifyToken();
        if (!refreshed) return null; // Failed to refresh
    }
    return spotifyApi; // Return the instance with a valid token
}

// Fetches Album Art AND Spotify Track URL
async function getSpotifyData(artist, title) {
    const currentSpotifyApi = await getValidSpotifyApi();
    if (!currentSpotifyApi) {
        console.log('Spotify API not available or token invalid, skipping Spotify search.');
        return { albumArt: DEFAULT_ALBUM_ART, spotifyUrl: null };
    }

    // Clean up potential extra info like (Live), [Remix] etc. for better matching
    const cleanTitle = title.replace(/ *\([^)]*\) */g, "").replace(/ *\[[^\]]*\] */g, "").trim();
    const cleanArtist = artist.replace(/ *\([^)]*\) */g, "").replace(/ *\[[^\]]*\] */g, "").trim();


    if (!cleanArtist || !cleanTitle) {
         return { albumArt: DEFAULT_ALBUM_ART, spotifyUrl: null };
    }

    const query = `track:${cleanTitle} artist:${cleanArtist}`;
    console.log(`Searching Spotify with query: ${query}`);

    try {
        const searchResult = await currentSpotifyApi.searchTracks(query, { limit: 1 });

        if (searchResult.body.tracks && searchResult.body.tracks.items.length > 0) {
            const track = searchResult.body.tracks.items[0];
            const albumImage = track.album?.images?.[0]?.url || DEFAULT_ALBUM_ART;
            const spotifyUrl = track.external_urls?.spotify || null;
            console.log(`Spotify match found: Art=${albumImage !== DEFAULT_ALBUM_ART}, URL=${!!spotifyUrl}`);
            return { albumArt: albumImage, spotifyUrl: spotifyUrl };
        } else {
            console.log('No direct Spotify match found.');
             // Optional: Try broader search if needed (can sometimes yield less accurate results)
             /*
             const broadQuery = `${cleanTitle} ${cleanArtist}`;
             console.log(`Trying broader Spotify search: ${broadQuery}`);
             const broadResult = await currentSpotifyApi.searchTracks(broadQuery, { limit: 1 });
             if (broadResult.body.tracks && broadResult.body.tracks.items.length > 0) {
                // ... extract data ...
             }
             */
        }
    } catch (error) {
        console.error(`Error searching Spotify for "${query}":`, error.message || error);
        // Check for expired token error specifically
        if (error.statusCode === 401) {
            console.log('Spotify token likely expired, forcing refresh on next attempt.');
            spotifyTokenExpiresAt = 0; // Force refresh
        }
    }

    // If search fails or yields no results
    console.log('Spotify search failed or no results, returning defaults.');
    return { albumArt: DEFAULT_ALBUM_ART, spotifyUrl: null };
}

// --- Database Saving ---
function saveMetadataToDatabase(stationName, metadata) {
  const { artist, title, timestamp, albumArt, spotifyUrl } = metadata;

  // Basic validation
  if (!artist || !title || artist === 'Loading...' || title === 'Waiting for stream info...') {
      console.log(`Skipping DB save for incomplete metadata: ${stationName} - ${artist} - ${title}`);
      return;
  }

  db.run(
    'INSERT INTO history (station, artist, title, timestamp, albumArt, spotifyUrl) VALUES (?, ?, ?, ?, ?, ?)',
    [stationName, artist, title, timestamp, albumArt || null, spotifyUrl || null], // Ensure null if undefined
    function(err) { // Use function() to access 'this'
      if (err) {
        console.error(`Error saving metadata to DB for ${stationName}:`, err.message);
      } else {
        // console.log(`Metadata saved to DB for ${stationName}, ID: ${this.lastID}`); // Less verbose logging
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
      userAgent: 'RadioPlaylistTracker/1.0 (github.com/YOUR_USERNAME/YOUR_REPO)', // Be a good citizen
      keepListen: false, // **CRITICAL CHANGE: Only fetch metadata, not audio**
      autoUpdate: true, // Keep trying to connect/reconnect
      metadataInterval: METADATA_CHECK_INTERVAL / 1000 // Interval in seconds
    });

    // --- Metadata Event ---
    radioStation.on('metadata', async (metadata) => {
      const streamTitle = metadata.get('StreamTitle');
      // console.log(`Raw metadata for ${name}: ${streamTitle}`); // Debugging

      if (streamTitle) {
        // Basic parsing: "Artist - Title"
        const parts = streamTitle.split(' - ');
        if (parts.length >= 2) {
          const artist = parts[0].trim();
          const title = parts.slice(1).join(' - ').trim();

          // Avoid processing empty strings after trimming
          if (!artist || !title) {
            console.log(`Skipping metadata for ${name} due to empty artist/title after parsing: "${streamTitle}"`);
            return;
          }

          // Check if it's the same as the current track to avoid redundant processing
          const current = radioStations[name]?.currentMetadata;
          if (current && current.artist === artist && current.title === title) {
            // console.log(`Metadata for ${name} hasn't changed: ${artist} - ${title}`); // Debugging
            return; // Same track, do nothing
          }

          console.log(`New track detected for ${name}: ${artist} - ${title}`);

          // Get Spotify data (Art and URL)
          const { albumArt, spotifyUrl } = await getSpotifyData(artist, title);

          // Prepare new metadata object
          const newMetadata = {
            artist,
            title,
            timestamp: new Date().toISOString(),
            albumArt,
            spotifyUrl
          };

          // Update state
          radioStations[name].currentMetadata = newMetadata;

          // Add to in-memory history (recent tracks)
          radioStations[name].history.unshift(newMetadata);
          // Limit history size
          if (radioStations[name].history.length > HISTORY_LIMIT) {
            radioStations[name].history = radioStations[name].history.slice(0, HISTORY_LIMIT);
          }

          // Save to persistent database
          saveMetadataToDatabase(name, newMetadata);

          // Emit update to all connected clients via Socket.IO
          io.emit('metadataUpdate', { // Using 'metadataUpdate'
            station: name,
            metadata: newMetadata
          });
          // Emit history update specific to this station (optional, frontend needs to handle)
           io.emit('historyUpdate', {
               station: name,
               history: radioStations[name].history
           });


        } else {
          // Handle cases where parsing fails (e.g., ads, different format)
          console.log(`Could not parse metadata for ${name}: "${streamTitle}"`);
           // Option: Update title to raw streamTitle if parsing fails?
           // radioStations[name].currentMetadata = { ...createDefaultMetadata(name), title: streamTitle };
           // io.emit('metadataUpdate', { station: name, metadata: radioStations[name].currentMetadata });
        }
      } else {
         console.log(`Received empty metadata for ${name}`);
      }
    });

    // --- Error Event ---
    radioStation.on('error', (error) => {
      console.error(`Parser error for station ${name} (${url}):`, error.message || error);
      // Maybe update status to show error? Don't insert dummy track data.
      // radioStations[name].currentMetadata = { ...createDefaultMetadata(name), title: "Stream Error" };
      // io.emit('metadataUpdate', { station: name, metadata: radioStations[name].currentMetadata });
    });

     // --- Stream Event (Optional Info) ---
     radioStation.on('stream', (stream) => {
        console.log(`Connected to stream for ${name}`);
        // Since keepListen: false, this stream object won't contain audio data,
        // but you could potentially read headers from it if needed.
        // stream.destroy(); // Good practice to ensure resources are freed if not used
     });

    return radioStation; // Return the parser instance

  } catch (error) {
    console.error(`Failed to initialize parser for ${name}:`, error);
    return null;
  }
}

// --- Initialization Function ---
async function initialize() {
  console.log("Initializing application...");

  // 1. Load streams from config file
  radioStations = loadStreams();
  if (Object.keys(radioStations).length === 0) {
      console.error("Initialization failed: No streams loaded. Check streams.txt.");
      return; // Stop initialization if no streams
  }


  // 2. Refresh Spotify token initially (if configured)
  if (spotifyApi) {
    await refreshSpotifyToken();
  }

  // 3. Initialize parsers for all loaded stations
  Object.entries(radioStations).forEach(([name, stationData]) => {
    const parserInstance = initRadioStation(name, stationData.url);
    if (parserInstance) {
      radioStations[name].parser = parserInstance; // Store the parser instance
    } else {
        // Handle failed parser initialization if needed (e.g., remove station)
        console.warn(`Parser could not be created for station ${name}. It will be unavailable.`);
        // delete radioStations[name]; // Optionally remove it
    }
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

  console.log(`Proxying stream for: ${stationName} (${stationData.url})`);

  const streamUrl = stationData.url;
  const protocol = streamUrl.startsWith('https') ? https : http;

  const proxyRequest = protocol.get(streamUrl, {
      headers: { 'User-Agent': 'RadioPlaylistTracker/1.0 Proxy' } // Identify proxy
  }, (streamResponse) => {
    // Check status code from the source stream
    if (streamResponse.statusCode !== 200) {
        console.error(`Proxy error for ${stationName}: Source stream returned status ${streamResponse.statusCode}`);
        res.status(streamResponse.statusCode || 502).send('Error fetching stream source');
        streamResponse.resume(); // Consume data to free resources
        return;
    }

    // Forward relevant headers from the source stream to the client
    res.writeHead(streamResponse.statusCode, {
      'Content-Type': streamResponse.headers['content-type'] || 'audio/mpeg', // Default to mpeg if missing
      'Cache-Control': 'no-cache',
      // Add any other headers you want to forward, e.g., 'icy-metaint' if needed
    });

    // Pipe the source stream data directly to the client response
    streamResponse.pipe(res);

    // Handle errors during piping
     streamResponse.on('error', (err) => {
        console.error(`Proxy source stream error for ${stationName}:`, err.message);
        if (!res.headersSent) { // Check if headers were already sent
            res.status(500).send('Stream source error');
        } else {
            res.end(); // End the response if headers were sent
        }
     });

  });

  // Handle errors connecting to the source stream URL
  proxyRequest.on('error', (err) => {
    console.error(`Proxy connection error for ${stationName} (${streamUrl}):`, err.message);
    if (!res.headersSent) {
        res.status(502).send('Bad Gateway: Could not connect to stream source');
    } else {
        res.end();
    }
  });

   // Handle client closing the connection prematurely
   req.on('close', () => {
    console.log(`Client disconnected from proxy for ${stationName}. Aborting source request.`);
    proxyRequest.destroy(); // Terminate the connection to the source stream
   });
});


// --- API Routes ---

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/handleiding', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'handleiding.html'));
});

// Get list of available stations and their basic info
app.get('/api/stations', (req, res) => {
  try {
    const stationList = Object.entries(radioStations).map(([name, station]) => ({
      name,
      description: station.description,
      // url: station.url // Maybe don't expose raw URL if always using proxy
    }));
    res.json(stationList);
  } catch (error) {
    console.error('Error in /api/stations:', error);
    res.status(500).json({ error: 'Server error retrieving stations' });
  }
});

// Get current metadata for one or all stations
// Adjusted path to match frontend expectation after changes
app.get('/api/metadata/current/:stationName?', (req, res) => {
  try {
    const stationName = req.params.stationName;
    if (stationName) {
      if (radioStations[stationName]) {
        res.json(radioStations[stationName].currentMetadata);
      } else {
        res.status(404).json({ error: `Station '${stationName}' not found` });
      }
    } else {
      // Return current metadata for all stations
      const allCurrentMetadata = {};
      Object.entries(radioStations).forEach(([name, station]) => {
        allCurrentMetadata[name] = station.currentMetadata;
      });
      res.json(allCurrentMetadata);
    }
  } catch (error) {
    console.error('Error in /api/metadata/current:', error);
    res.status(500).json({ error: 'Server error retrieving current metadata' });
  }
});

// Get recent in-memory history for one or all stations
// This provides the data for the "Recente Nummers" tab
app.get('/api/metadata/history/:stationName?', (req, res) => {
  try {
    const stationName = req.params.stationName;
    if (stationName) {
      if (radioStations[stationName]) {
        res.json(radioStations[stationName].history); // Send in-memory history
      } else {
        res.status(404).json({ error: `Station '${stationName}' not found` });
      }
    } else {
      // Return in-memory history for all stations
      const allMemoryHistory = {};
      Object.entries(radioStations).forEach(([name, station]) => {
        allMemoryHistory[name] = station.history;
      });
      res.json(allMemoryHistory);
    }
  } catch (error) {
    console.error('Error in /api/metadata/history:', error);
    res.status(500).json({ error: 'Server error retrieving recent history' });
  }
});


// Get full history from the database
// Adjusted path to match frontend expectation after changes
app.get('/api/metadata/database/:stationName?', (req, res) => {
    const stationName = req.params.stationName;
    const limit = parseInt(req.query.limit || '100', 10); // Allow limit via query param

    let query = 'SELECT id, station, artist, title, timestamp, albumArt, spotifyUrl FROM history';
    let params = [];

    if (stationName) {
        if (!radioStations[stationName]) {
             return res.status(404).json({ error: `Station '${stationName}' not found` });
        }
        query += ' WHERE station = ?';
        params.push(stationName);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('Database query error in /api/metadata/database:', err.message);
            res.status(500).json({ error: 'Database query error' });
        } else {
            res.json(rows);
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    totalStationsConfigured: Object.keys(radioStations).length,
    // Could add more checks here (DB connection, Spotify status etc.)
  });
});

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Send current state for all stations to the newly connected client
  Object.entries(radioStations).forEach(([name, stationData]) => {
    // Send current metadata
    socket.emit('metadataUpdate', {
      station: name,
      metadata: stationData.currentMetadata
    });
     // Send current recent history
     socket.emit('historyUpdate', {
        station: name,
        history: stationData.history
     });
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });

  // Allow client to request a refresh (sends current data again)
  socket.on('requestUpdate', (stationName) => {
    console.log(`Client ${socket.id} requested update for ${stationName || 'all stations'}`);
    if (stationName && radioStations[stationName]) {
        socket.emit('metadataUpdate', {
            station: stationName,
            metadata: radioStations[stationName].currentMetadata
        });
         socket.emit('historyUpdate', {
            station: stationName,
            history: radioStations[stationName].history
         });
    } else {
      // Send all data again if specific station not found or not specified
      Object.entries(radioStations).forEach(([name, stationData]) => {
        socket.emit('metadataUpdate', { station: name, metadata: stationData.currentMetadata });
        socket.emit('historyUpdate', { station: name, history: stationData.history });
      });
    }
  });
});

// --- Start Server ---
// Use an async IIFE to ensure initialization completes before listening
(async () => {
    await initialize(); // Wait for streams and Spotify to initialize
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server listening on http://0.0.0.0:${PORT}`);
    });
})();


// --- Graceful Shutdown ---
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

function handleShutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);

  // 1. Stop accepting new connections
  server.close((err) => {
      if (err) {
          console.error("Error closing server:", err);
      } else {
          console.log("HTTP server closed.");
      }

      // 2. Close Database connection
      db.close((dbErr) => {
          if (dbErr) {
              console.error('Error closing database:', dbErr.message);
          } else {
              console.log('Database connection closed.');
          }

          // 3. Optional: Stop parsers (icecast-parser doesn't have explicit stop method)
          // You might want to remove listeners if necessary, but usually closing the app is sufficient.

          console.log("Shutdown complete.");
          process.exit(err || dbErr ? 1 : 0); // Exit with error code if any shutdown step failed
      });
  });

   // Force close after a timeout if graceful shutdown hangs
   setTimeout(() => {
    console.error("Graceful shutdown timed out. Forcing exit.");
    process.exit(1);
  }, 10000); // 10 seconds timeout
}
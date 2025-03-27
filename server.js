const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const { Parser } = require('icecast-parser');
const SpotifyWebApi = require('spotify-web-api-node');
const sqlite3 = require('sqlite3').verbose();

// Configuratie
const PORT = process.env.PORT || 3000;
const UPDATE_INTERVAL = 10000; // 10 seconden

// Spotify API configuratie
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '0331e96218354e3399958c4cf91e007f';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '3c23312656b24537821f441212d1b74d';

// Database setup
const db = new sqlite3.Database('./radio_history.db');

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIFY_CLIENT_ID,
  clientSecret: SPOTIFY_CLIENT_SECRET
});

// Initialiseer Express app
const app = express();
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Maak HTTP server en Socket.io
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Huidige metadata voor elke stream
let currentMetadata = {};
let metadataHistory = {};
let radioStations = {};
let activeStations = [];

// Database initialisatie
function initDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station TEXT NOT NULL,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      albumArt TEXT
    )`);
    
    console.log('Database geïnitialiseerd');
  });
}

// Functie om streams uit het configuratiebestand te laden
function loadStreams() {
  try {
    const streamsFile = fs.readFileSync(path.join(__dirname, 'streams.txt'), 'utf8');
    const lines = streamsFile.split('\n').filter(line => line.trim() && !line.startsWith('//'));
    
    const streams = {};
    lines.forEach(line => {
      const [name, url, description] = line.split('|');
      if (name && url) {
        streams[name] = {
          url,
          description: description || '',
          currentMetadata: {
            artist: 'Laden...',
            title: 'Laden...',
            timestamp: new Date().toISOString(),
            albumArt: null
          },
          history: []
        };
      }
    });
    
    console.log(`${Object.keys(streams).length} streams geladen uit configuratiebestand`);
    return streams;
  } catch (error) {
    console.error('Fout bij het laden van streams:', error);
    // Fallback naar hardcoded streams als het bestand niet kan worden geladen
    return {
      'KINK': {
        url: 'https://22343.live.streamtheworld.com:443/KINK.mp3',
        description: 'KINK Radio - Modern Rock',
        currentMetadata: {
          artist: 'Laden...',
          title: 'Laden...',
          timestamp: new Date().toISOString(),
          albumArt: null
        },
        history: []
      },
      'NPO Radio 2': {
        url: 'https://icecast.omroep.nl/radio2-bb-mp3',
        description: 'NPO Radio 2 - De Grootste Hits en Het Beste van Nu',
        currentMetadata: {
          artist: 'Laden...',
          title: 'Laden...',
          timestamp: new Date().toISOString(),
          albumArt: null
        },
        history: []
      }
    };
  }
}

// Functie om album art op te halen via Spotify
async function getAlbumArt(artist, title) {
  try {
    console.log(`Zoeken naar album art voor: ${artist} - ${title}`);
    
    // Vernieuw token indien nodig
    try {
      const data = await spotifyApi.clientCredentialsGrant();
      spotifyApi.setAccessToken(data.body['access_token']);
    } catch (tokenError) {
      console.error('Fout bij vernieuwen Spotify token:', tokenError);
      // Ga door met zoeken, mogelijk werkt het met een bestaande token
    }
    
    // Zoek naar track
    try {
      const searchResult = await spotifyApi.searchTracks(`track:${title} artist:${artist}`);
      
      if (searchResult.body.tracks && searchResult.body.tracks.items.length > 0) {
        const track = searchResult.body.tracks.items[0];
        if (track.album && track.album.images && track.album.images.length > 0) {
          const albumImage = track.album.images[0].url;
          console.log(`Album art gevonden via Spotify: ${albumImage}`);
          return albumImage;
        }
      }
    } catch (searchError) {
      console.error('Fout bij zoeken naar track:', searchError);
    }
    
    // Als geen resultaat, probeer zonder 'track:' prefix
    try {
      const altSearchResult = await spotifyApi.searchTracks(`${title} ${artist}`);
      
      if (altSearchResult.body.tracks && altSearchResult.body.tracks.items.length > 0) {
        const track = altSearchResult.body.tracks.items[0];
        if (track.album && track.album.images && track.album.images.length > 0) {
          const albumImage = track.album.images[0].url;
          console.log(`Album art gevonden via alternatieve Spotify zoekopdracht: ${albumImage}`);
          return albumImage;
        }
      }
    } catch (altSearchError) {
      console.error('Fout bij alternatieve zoekopdracht:', altSearchError);
    }
    
    // Als alles faalt, gebruik een standaard afbeelding
    console.log('Geen album art gevonden, gebruik standaard afbeelding');
    return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzU1NSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMTQuNWMtMi40OSAwLTQuNS0yLjAxLTQuNS00LjVTOS41MSA3LjUgMTIgNy41czQuNSAyLjAxIDQuNSA0LjUtMi4wMSA0LjUtNC41IDQuNXptMC01LjVjLS41NSAwLTEgLjQ1LTEgMXMuNDUgMSAxIDEgMS0uNDUgMS0xLS40NS0xLTEtMXoiLz48L3N2Zz4=';
  } catch (error) {
    console.error('Fout bij ophalen album art:', error);
    return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzU1NSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMTQuNWMtMi40OSAwLTQuNS0yLjAxLTQuNS00LjVTOS41MSA3LjUgMTIgNy41czQuNSAyLjAxIDQuNSA0LjUtMi4wMSA0LjUtNC41IDQuNXptMC01LjVjLS41NSAwLTEgLjQ1LTEgMXMuNDUgMSAxIDEgMS0uNDUgMS0xLS40NS0xLTEtMXoiLz48L3N2Zz4=';
  }
}

// Functie om metadata op te slaan in de database
function saveMetadataToDatabase(station, metadata) {
  const { artist, title, timestamp, albumArt } = metadata;
  
  db.run(
    'INSERT INTO history (station, artist, title, timestamp, albumArt) VALUES (?, ?, ?, ?, ?)',
    [station, artist, title, timestamp, albumArt],
    function(err) {
      if (err) {
        console.error('Fout bij opslaan in database:', err);
      } else {
        console.log(`Metadata opgeslagen in database voor ${station}, ID: ${this.lastID}`);
      }
    }
  );
}

// Functie om een radiostation te initialiseren
function initRadioStation(name, url) {
  console.log(`Initialiseren van radiostation: ${name} - ${url}`);
  
  try {
    const radioStation = new Parser({
      url: url,
      userAgent: 'RadioPlaylistTracker/1.0.0',
      keepListen: true,
      autoUpdate: true,
      metadataInterval: UPDATE_INTERVAL
    });
    
    // Luister naar metadata updates
    radioStation.on('metadata', async metadata => {
      console.log(`Nieuwe metadata ontvangen voor ${name}:`, metadata);
      
      if (metadata && metadata.get('StreamTitle')) {
        // Vaak is het formaat "Artiest - Titel"
        const streamTitle = metadata.get('StreamTitle');
        const parts = streamTitle.split(' - ');
        if (parts.length >= 2) {
          const artist = parts[0].trim();
          const title = parts.slice(1).join(' - ').trim();
          
          // Haal album art op
          const albumArt = await getAlbumArt(artist, title);
          
          // Update huidige metadata
          const newMetadata = {
            artist,
            title,
            timestamp: new Date().toISOString(),
            albumArt
          };
          
          // Controleer of dit een nieuw nummer is
          if (!radioStations[name].currentMetadata || 
              radioStations[name].currentMetadata.artist !== artist || 
              radioStations[name].currentMetadata.title !== title) {
            
            // Update huidige metadata
            radioStations[name].currentMetadata = newMetadata;
            
            // Voeg toe aan geschiedenis
            radioStations[name].history.unshift(newMetadata);
            
            // Beperk geschiedenis tot 50 items
            if (radioStations[name].history.length > 50) {
              radioStations[name].history = radioStations[name].history.slice(0, 50);
            }
            
            // Sla op in database
            saveMetadataToDatabase(name, newMetadata);
            
            // Stuur update naar clients
            io.emit('metadata_update', { 
              station: name, 
              metadata: newMetadata 
            });
            
            console.log(`Metadata bijgewerkt voor ${name}: ${artist} - ${title}`);
          }
        }
      }
    });
    
    radioStation.on('error', error => {
      console.error(`Fout bij het parsen van de stream voor ${name}:`, error);
      
      // Voeg dummy metadata toe als er een fout optreedt
      if (!radioStations[name].currentMetadata || 
          radioStations[name].currentMetadata.artist === 'Laden...') {
        const dummyMetadata = {
          artist: 'Radio DJ',
          title: `${name} Live Stream`,
          timestamp: new Date().toISOString(),
          albumArt: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzU1NSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMTQuNWMtMi40OSAwLTQuNS0yLjAxLTQuNS00LjVTOS41MSA3LjUgMTIgNy41czQuNSAyLjAxIDQuNSA0LjUtMi4wMSA0LjUtNC41IDQuNXptMC01LjVjLS41NSAwLTEgLjQ1LTEgMXMuNDUgMSAxIDEgMS0uNDUgMS0xLS40NS0xLTEtMXoiLz48L3N2Zz4='
        };
        
        radioStations[name].currentMetadata = dummyMetadata;
        radioStations[name].history.unshift(dummyMetadata);
        
        io.emit('metadata_update', { 
          station: name, 
          metadata: dummyMetadata 
        });
      }
    });
    
    return radioStation;
  } catch (error) {
    console.error(`Fout bij initialiseren van radiostation ${name}:`, error);
    return null;
  }
}

// Initialisatie
async function initialize() {
  // Initialiseer database
  initDatabase();
  
  // Laad streams uit configuratiebestand
  radioStations = loadStreams();
  
  // Initialiseer Spotify API
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body['access_token']);
    console.log('Spotify API geïnitialiseerd');
  } catch (error) {
    console.error('Fout bij initialiseren Spotify API:', error);
    console.log('Doorgaan zonder Spotify API, zal standaard album art gebruiken');
  }
  
  // Start alle radiostations
  Object.entries(radioStations).forEach(([name, station]) => {
    try {
      const parser = initRadioStation(name, station.url);
      if (parser) {
        activeStations.push({
          name,
          parser
        });
      }
    } catch (error) {
      console.error(`Fout bij starten van radiostation ${name}:`, error);
    }
  });
  
  // Voeg dummy metadata toe als er geen stations actief zijn
  if (activeStations.length === 0) {
    console.log('Geen actieve stations, voeg dummy metadata toe');
    Object.keys(radioStations).forEach(name => {
      const dummyMetadata = {
        artist: 'Radio DJ',
        title: `${name} Live Stream`,
        timestamp: new Date().toISOString(),
        albumArt: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzU1NSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMTQuNWMtMi40OSAwLTQuNS0yLjAxLTQuNS00LjVTOS41MSA3LjUgMTIgNy41czQuNSAyLjAxIDQuNSA0LjUtMi4wMSA0LjUtNC41IDQuNXptMC01LjVjLS41NSAwLTEgLjQ1LTEgMXMuNDUgMSAxIDEgMS0uNDUgMS0xLS40NS0xLTEtMXoiLz48L3N2Zz4='
      };
      
      radioStations[name].currentMetadata = dummyMetadata;
      radioStations[name].history.unshift(dummyMetadata);
    });
  }
}

// Proxy voor audiostreams
app.get('/proxy-stream/:station', async (req, res) => {
  const station = req.params.station;
  console.log(`Proxy request voor station: ${station}`);
  
  if (radioStations[station]) {
    try {
      const streamUrl = radioStations[station].url;
      console.log(`Proxying stream: ${streamUrl}`);
      
      // Stel de juiste headers in
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // Proxy de stream
      try {
        const response = await axios({
          method: 'get',
          url: streamUrl,
          responseType: 'stream',
          timeout: 10000,
          headers: {
            'User-Agent': 'RadioPlaylistTracker/1.0.0'
          }
        });
        
        response.data.pipe(res);
        
        // Afhandelen van fouten in de stream
        response.data.on('error', (error) => {
          console.error(`Stream error voor ${station}:`, error);
          res.status(500).end();
        });
      } catch (axiosError) {
        console.error(`Axios error voor ${station}:`, axiosError);
        res.status(500).send('Fout bij het streamen');
      }
    } catch (error) {
      console.error(`Fout bij proxy stream voor ${station}:`, error);
      res.status(500).send('Fout bij het streamen');
    }
  } else {
    console.error(`Station niet gevonden: ${station}`);
    res.status(404).send('Station niet gevonden');
  }
});

// API routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/handleiding', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'handleiding.html'));
});

app.get('/api/stations', (req, res) => {
  try {
    const stationList = Object.entries(radioStations).map(([name, station]) => ({
      name,
      description: station.description,
      streamUrl: station.url,
      currentMetadata: station.currentMetadata
    }));
    
    res.json(stationList);
  } catch (error) {
    console.error('Fout bij ophalen stations:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/metadata/current/:station?', (req, res) => {
  try {
    const station = req.params.station;
    
    if (station) {
      if (radioStations[station]) {
        res.json(radioStations[station].currentMetadata);
      } else {
        res.status(404).json({ error: 'Station niet gevonden' });
      }
    } else {
      // Als geen station is opgegeven, stuur alle huidige metadata
      const allMetadata = {};
      Object.entries(radioStations).forEach(([name, station]) => {
        allMetadata[name] = station.currentMetadata;
      });
      res.json(allMetadata);
    }
  } catch (error) {
    console.error('Fout bij ophalen huidige metadata:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/metadata/history/:station?', (req, res) => {
  try {
    const station = req.params.station;
    
    if (station) {
      if (radioStations[station]) {
        res.json(radioStations[station].history);
      } else {
        res.status(404).json({ error: 'Station niet gevonden' });
      }
    } else {
      // Als geen station is opgegeven, stuur alle geschiedenis
      const allHistory = {};
      Object.entries(radioStations).forEach(([name, station]) => {
        allHistory[name] = station.history;
      });
      res.json(allHistory);
    }
  } catch (error) {
    console.error('Fout bij ophalen geschiedenis:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/metadata/database/:station?', (req, res) => {
  try {
    const station = req.params.station;
    let query = 'SELECT * FROM history';
    let params = [];
    
    if (station) {
      query += ' WHERE station = ?';
      params.push(station);
    }
    
    query += ' ORDER BY timestamp DESC LIMIT 100';
    
    db.all(query, params, (err, rows) => {
      if (err) {
        console.error('Database query error:', err);
        res.status(500).json({ error: 'Database error' });
      } else {
        res.json(rows);
      }
    });
  } catch (error) {
    console.error('Fout bij ophalen database geschiedenis:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Socket.io verbindingen
io.on('connection', socket => {
  console.log('Nieuwe client verbonden');
  
  // Stuur huidige metadata naar nieuwe client
  Object.entries(radioStations).forEach(([name, station]) => {
    socket.emit('metadata_update', { 
      station: name, 
      metadata: station.currentMetadata 
    });
  });
  
  socket.on('disconnect', () => {
    console.log('Client verbinding verbroken');
  });
  
  // Forceer metadata update
  socket.on('request_update', (stationName) => {
    console.log(`Metadata update aangevraagd door client voor ${stationName}`);
    // In de huidige versie van de library is er geen directe methode om metadata te forceren
    // We kunnen een nieuwe instantie maken of wachten op de automatische update
    
    // Stuur de huidige metadata opnieuw
    if (stationName && radioStations[stationName]) {
      socket.emit('metadata_update', { 
        station: stationName, 
        metadata: radioStations[stationName].currentMetadata 
      });
    } else {
      // Stuur alle metadata opnieuw
      Object.entries(radioStations).forEach(([name, station]) => {
        socket.emit('metadata_update', { 
          station: name, 
          metadata: station.currentMetadata 
        });
      });
    }
  });
});

// Voeg een route toe voor health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    activeStations: activeStations.length,
    totalStations: Object.keys(radioStations).length
  });
});

// Start de server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server draait op poort ${PORT}`);
  initialize();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Server wordt afgesloten...');
  // Sluit database verbinding
  db.close();
  server.close(() => {
    console.log('Server afgesloten');
    process.exit(0);
  });
});

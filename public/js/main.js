// Dit bestand moet worden toegevoegd aan de public/js map
// Bestandsnaam: main.js

document.addEventListener('DOMContentLoaded', () => {
    // Configuratie
    const API_BASE_URL = window.location.origin;
    let currentStation = null;
    let stations = [];
    
    // DOM elementen
    const albumArtElement = document.getElementById('albumArt');
    const trackTitleElement = document.getElementById('trackTitle');
    const trackArtistElement = document.getElementById('trackArtist');
    const timestampElement = document.getElementById('timestamp');
    const audioPlayerElement = document.getElementById('audioPlayer');
    const audioSourceElement = document.getElementById('audioSource');
    const spotifyLinkElement = document.getElementById('spotifyLink');
    const refreshButtonElement = document.getElementById('refreshButton');
    const historyListElement = document.getElementById('historyList');
    const databaseListElement = document.getElementById('databaseList');
    const stationSelectorElement = document.getElementById('stationSelector');
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    // Socket.io verbinding
    const socket = io();
    
    // Debug logging
    socket.on('connect', () => {
        console.log('Verbonden met server via WebSocket');
    });
    
    socket.on('connect_error', (error) => {
        console.error('WebSocket verbindingsfout:', error);
    });
    
    // Laad beschikbare stations
    async function loadStations() {
        try {
            console.log('Stations laden...');
            const response = await fetch(`${API_BASE_URL}/api/stations`);
            stations = await response.json();
            console.log('Stations geladen:', stations);
            
            // Maak station knoppen
            stationSelectorElement.innerHTML = '';
            stations.forEach(station => {
                const button = document.createElement('button');
                button.className = 'station-button';
                button.textContent = station.name;
                button.dataset.station = station.name;
                button.title = station.description;
                button.addEventListener('click', () => selectStation(station.name));
                stationSelectorElement.appendChild(button);
            });
            
            // Selecteer het eerste station als er nog geen geselecteerd is
            if (stations.length > 0 && !currentStation) {
                selectStation(stations[0].name);
            }
        } catch (error) {
            console.error('Fout bij laden stations:', error);
        }
    }
    
    // Selecteer een station
    function selectStation(stationName) {
        console.log(`Station selecteren: ${stationName}`);
        currentStation = stationName;
        
        // Update UI
        document.querySelectorAll('.station-button').forEach(button => {
            button.classList.toggle('active', button.dataset.station === stationName);
        });
        
        // Update audio source met proxy URL
        audioSourceElement.src = `/proxy-stream/${stationName}`;
        audioPlayerElement.load();
        
        // Laad huidige metadata
        loadCurrentMetadata(stationName);
        
        // Laad geschiedenis
        loadHistory(stationName);
        
        // Laad database geschiedenis
        loadDatabaseHistory(stationName);
    }
    
    // Laad huidige metadata
    async function loadCurrentMetadata(stationName) {
        try {
            console.log(`Huidige metadata laden voor ${stationName}...`);
            const response = await fetch(`${API_BASE_URL}/api/metadata/current/${stationName}`);
            const metadata = await response.json();
            console.log(`Metadata geladen voor ${stationName}:`, metadata);
            updateMetadataDisplay(metadata);
        } catch (error) {
            console.error('Fout bij laden metadata:', error);
        }
    }
    
    // Laad geschiedenis
    async function loadHistory(stationName) {
        try {
            console.log(`Geschiedenis laden voor ${stationName}...`);
            const response = await fetch(`${API_BASE_URL}/api/metadata/history/${stationName}`);
            const history = await response.json();
            console.log(`Geschiedenis geladen voor ${stationName}:`, history);
            updateHistoryDisplay(history);
        } catch (error) {
            console.error('Fout bij laden geschiedenis:', error);
        }
    }
    
    // Laad database geschiedenis
    async function loadDatabaseHistory(stationName) {
        try {
            console.log(`Database geschiedenis laden voor ${stationName}...`);
            const response = await fetch(`${API_BASE_URL}/api/metadata/database/${stationName}`);
            const history = await response.json();
            console.log(`Database geschiedenis geladen voor ${stationName}:`, history);
            updateDatabaseHistoryDisplay(history);
        } catch (error) {
            console.error('Fout bij laden database geschiedenis:', error);
        }
    }
    
    // Update metadata weergave
    function updateMetadataDisplay(metadata) {
        if (!metadata) return;
        
        trackTitleElement.textContent = metadata.title || 'Onbekend';
        trackArtistElement.textContent = metadata.artist || 'Onbekend';
        
        if (metadata.albumArt) {
            albumArtElement.src = metadata.albumArt;
        } else {
            albumArtElement.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzU1NSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMTQuNWMtMi40OSAwLTQuNS0yLjAxLTQuNS00LjVTOS41MSA3LjUgMTIgNy41czQuNSAyLjAxIDQuNSA0LjUtMi4wMSA0LjUtNC41IDQuNXptMC01LjVjLS41NSAwLTEgLjQ1LTEgMXMuNDUgMSAxIDEgMS0uNDUgMS0xLS40NS0xLTEtMXoiLz48L3N2Zz4=';
        }
        
        if (metadata.timestamp) {
            const date = new Date(metadata.timestamp);
            timestampElement.textContent = `Bijgewerkt: ${date.toLocaleTimeString()}`;
        } else {
            timestampElement.textContent = '';
        }
        
        // Update Spotify link
        updateSpotifyLink(metadata.artist, metadata.title);
    }
    
    // Update Spotify link
    function updateSpotifyLink(artist, title) {
        if (artist && title) {
            const query = encodeURIComponent(`${artist} ${title}`);
            spotifyLinkElement.href = `spotify:search:${query}`;
            spotifyLinkElement.onclick = function(e) {
                // Probeer eerst de Spotify app te openen
                setTimeout(function() {
                    // Als de app niet opent, open dan de web versie
                    window.open(`https://open.spotify.com/search/${query}`, '_blank');
                }, 1000);
            };
        } else {
            spotifyLinkElement.href = '#';
        }
    }
    
    // Update geschiedenis weergave
    function updateHistoryDisplay(history) {
        historyListElement.innerHTML = '';
        
        if (!history || history.length === 0) {
            const emptyItem = document.createElement('li');
            emptyItem.className = 'history-item';
            emptyItem.textContent = 'Geen recente nummers gevonden';
            historyListElement.appendChild(emptyItem);
            return;
        }
        
        history.forEach(item => {
            const listItem = createHistoryListItem(item);
            historyListElement.appendChild(listItem);
        });
    }
    
    // Update database geschiedenis weergave
    function updateDatabaseHistoryDisplay(history) {
        databaseListElement.innerHTML = '';
        
        if (!history || history.length === 0) {
            const emptyItem = document.createElement('li');
            emptyItem.className = 'history-item';
            emptyItem.textContent = 'Geen geschiedenis gevonden in de database';
            databaseListElement.appendChild(emptyItem);
            return;
        }
        
        history.forEach(item => {
            const listItem = createHistoryListItem(item);
            databaseListElement.appendChild(listItem);
        });
    }
    
    // Maak een geschiedenis lijst item
    function createHistoryListItem(item) {
        const listItem = document.createElement('li');
        listItem.className = 'history-item';
        
        const albumArt = document.createElement('img');
        albumArt.className = 'history-album-art';
        albumArt.src = item.albumArt || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzU1NSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMTQuNWMtMi40OSAwLTQuNS0yLjAxLTQuNS00LjVTOS41MSA3LjUgMTIgNy41czQuNSAyLjAxIDQuNSA0LjUtMi4wMSA0LjUtNC41IDQuNXptMC01LjVjLS41NSAwLTEgLjQ1LTEgMXMuNDUgMSAxIDEgMS0uNDUgMS0xLS40NS0xLTEtMXoiLz48L3N2Zz4=';
        albumArt.alt = 'Album Art';
        
        const trackInfo = document.createElement('div');
        trackInfo.className = 'history-track-info';
        
        const trackTitle = document.createElement('div');
        trackTitle.className = 'history-track-title';
        trackTitle.textContent = item.title || 'Onbekend';
        
        const trackArtist = document.createElement('div');
        trackArtist.className = 'history-track-artist';
        trackArtist.textContent = item.artist || 'Onbekend';
        
        const timestamp = document.createElement('div');
        timestamp.className = 'history-timestamp';
        if (item.timestamp) {
            const date = new Date(item.timestamp);
            timestamp.textContent = date.toLocaleString();
        }
        
        trackInfo.appendChild(trackTitle);
        trackInfo.appendChild(trackArtist);
        trackInfo.appendChild(timestamp);
        
        const spotifyLink = document.createElement('a');
        spotifyLink.className = 'history-spotify-link';
        spotifyLink.href = `spotify:search:${encodeURIComponent(`${item.artist} ${item.title}`)}`;
        spotifyLink.textContent = 'Spotify';
        spotifyLink.target = '_blank';
        spotifyLink.onclick = function(e) {
            setTimeout(function() {
                window.open(`https://open.spotify.com/search/${encodeURIComponent(`${item.artist} ${item.title}`)}`, '_blank');
            }, 1000);
        };
        
        listItem.appendChild(albumArt);
        listItem.appendChild(trackInfo);
        listItem.appendChild(spotifyLink);
        
        return listItem;
    }
    
    // Socket.io event handlers
    socket.on('metadata_update', (data) => {
        console.log('Nieuwe metadata ontvangen:', data);
        if (data.station === currentStation) {
            updateMetadataDisplay(data.metadata);
            loadHistory(currentStation);
        }
    });
    
    // Event listeners
    refreshButtonElement.addEventListener('click', () => {
        if (currentStation) {
            console.log(`Metadata update aanvragen voor ${currentStation}`);
            socket.emit('request_update', currentStation);
            loadCurrentMetadata(currentStation);
            loadHistory(currentStation);
            loadDatabaseHistory(currentStation);
        }
    });
    
    // Tab switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Update active content
            tabContents.forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(`${tabName}Tab`).classList.add('active');
            
            // Refresh content if needed
            if (tabName === 'database' && currentStation) {
                loadDatabaseHistory(currentStation);
            }
        });
    });
    
    // Initialisatie
    loadStations();
    
    // Periodiek metadata verversen
    setInterval(() => {
        if (currentStation) {
            loadCurrentMetadata(currentStation);
        }
    }, 30000); // Elke 30 seconden
});

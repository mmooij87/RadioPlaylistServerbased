// Integratie van frontend en backend
document.addEventListener('DOMContentLoaded', function() {
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
    
    // Laad beschikbare stations
    async function loadStations() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/stations`);
            stations = await response.json();
            
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
            alert('Er is een fout opgetreden bij het laden van de stations. Probeer het later opnieuw.');
        }
    }
    
    // Selecteer een station
    function selectStation(stationName) {
        // Update UI
        document.querySelectorAll('.station-button').forEach(button => {
            if (button.dataset.station === stationName) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
        
        // Update huidige station
        currentStation = stationName;
        
        // Update audio player
        const station = stations.find(s => s.name === stationName);
        if (station) {
            audioSourceElement.src = `/api/stream/${encodeURIComponent(stationName)}`;
            audioPlayerElement.load();
            audioPlayerElement.play().catch(error => {
                console.error('Fout bij afspelen stream:', error);
            });
            
            // Metadata ophalen
            fetchMetadata();
        }
    }
    
    // Metadata ophalen
    async function fetchMetadata() {
        if (!currentStation) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/metadata/${encodeURIComponent(currentStation)}`);
            const metadata = await response.json();
            
            updateNowPlaying(metadata);
        } catch (error) {
            console.error('Fout bij ophalen metadata:', error);
        }
    }
    
    // Update huidige nummer info
    function updateNowPlaying(metadata) {
        if (metadata.title) {
            trackTitleElement.textContent = metadata.title;
        } else {
            trackTitleElement.textContent = 'Onbekend nummer';
        }
        
        if (metadata.artist) {
            trackArtistElement.textContent = metadata.artist;
        } else {
            trackArtistElement.textContent = 'Onbekende artiest';
        }
        
        if (metadata.albumArt) {
            albumArtElement.src = metadata.albumArt;
        } else {
            albumArtElement.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzU1NSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMTQuNWMtMi40OSAwLTQuNS0yLjAxLTQuNS00LjVTOS41MSA3LjUgMTIgNy41czQuNSAyLjAxIDQuNSA0LjUtMi4wMSA0LjUtNC41IDQuNXptMC01LjVjLS41NSAwLTEgLjQ1LTEgMXMuNDUgMSAxIDEgMS0uNDUgMS0xLS40NS0xLTEtMXoiLz48L3N2Zz4=';
        }
        
        if (metadata.spotifyUrl) {
            spotifyLinkElement.href = metadata.spotifyUrl;
            spotifyLinkElement.style.display = 'inline-flex';
        } else {
            spotifyLinkElement.href = '#';
            spotifyLinkElement.style.display = 'none';
        }
        
        timestampElement.textContent = new Date().toLocaleTimeString();
    }
    
    // Update geschiedenis
    function updateHistory(tracks) {
        historyListElement.innerHTML = '';
        
        if (tracks && tracks.length > 0) {
            tracks.forEach(track => {
                const li = document.createElement('li');
                li.className = 'history-item';
                
                const img = document.createElement('img');
                img.className = 'history-album-art';
                img.src = track.albumArt || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzU1NSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMTQuNWMtMi40OSAwLTQuNS0yLjAxLTQuNS00LjVTOS41MSA3LjUgMTIgNy41czQuNSAyLjAxIDQuNSA0LjUtMi4wMSA0LjUtNC41IDQuNXptMC01LjVjLS41NSAwLTEgLjQ1LTEgMXMuNDUgMSAxIDEgMS0uNDUgMS0xLS40NS0xLTEtMXoiLz48L3N2Zz4=';
                img.alt = 'Album Art';
                
                const infoDiv = document.createElement('div');
                infoDiv.className = 'history-track-info';
                
                const title = document.createElement('h4');
                title.className = 'history-track-title';
                title.textContent = track.title || 'Onbekend nummer';
                
                const artist = document.createElement('p');
                artist.className = 'history-track-artist';
                artist.textContent = track.artist || 'Onbekende artiest';
                
                const timestamp = document.createElement('p');
                timestamp.className = 'history-timestamp';
                timestamp.textContent = new Date(track.timestamp).toLocaleTimeString();
                
                infoDiv.appendChild(title);
                infoDiv.appendChild(artist);
                infoDiv.appendChild(timestamp);
                
                li.appendChild(img);
                li.appendChild(infoDiv);
                
                if (track.spotifyUrl) {
                    const spotifyLink = document.createElement('a');
                    spotifyLink.className = 'history-spotify-link';
                    spotifyLink.href = track.spotifyUrl;
                    spotifyLink.target = '_blank';
                    spotifyLink.innerHTML = '<svg class="spotify-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>';
                    li.appendChild(spotifyLink);
                }
                
                historyListElement.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.className = 'history-item';
            li.textContent = 'Geen recente nummers gevonden.';
            historyListElement.appendChild(li);
        }
    }
    
    // Update database geschiedenis
    function updateDatabaseHistory(tracks) {
        databaseListElement.innerHTML = '';
        
        if (tracks && tracks.length > 0) {
            tracks.forEach(track => {
                const li = document.createElement('li');
                li.className = 'history-item';
                
                const img = document.createElement('img');
                img.className = 'history-album-art';
                img.src = track.albumArt || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzU1NSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMTQuNWMtMi40OSAwLTQuNS0yLjAxLTQuNS00LjVTOS41MSA3LjUgMTIgNy41czQuNSAyLjAxIDQuNSA0LjUtMi4wMSA0LjUtNC41IDQuNXptMC01LjVjLS41NSAwLTEgLjQ1LTEgMXMuNDUgMSAxIDEgMS0uNDUgMS0xLS40NS0xLTEtMXoiLz48L3N2Zz4=';
                img.alt = 'Album Art';
                
                const infoDiv = document.createElement('div');
                infoDiv.className = 'history-track-info';
                
                const title = document.createElement('h4');
                title.className = 'history-track-title';
                title.textContent = track.title || 'Onbekend nummer';
                
                const artist = document.createElement('p');
                artist.className = 'history-track-artist';
                artist.textContent = track.artist || 'Onbekende artiest';
                
                const stationName = document.createElement('p');
                stationName.className = 'history-track-artist';
                stationName.textContent = track.station || 'Onbekend station';
                
                const timestamp = document.createElement('p');
                timestamp.className = 'history-timestamp';
                timestamp.textContent = new Date(track.timestamp).toLocaleString();
                
                infoDiv.appendChild(title);
                infoDiv.appendChild(artist);
                infoDiv.appendChild(stationName);
                infoDiv.appendChild(timestamp);
                
                li.appendChild(img);
                li.appendChild(infoDiv);
                
                if (track.spotifyUrl) {
                    const spotifyLink = document.createElement('a');
                    spotifyLink.className = 'history-spotify-link';
                    spotifyLink.href = track.spotifyUrl;
                    spotifyLink.target = '_blank';
                    spotifyLink.innerHTML = '<svg class="spotify-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>';
                    li.appendChild(spotifyLink);
                }
                
                databaseListElement.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.className = 'history-item';
            li.textContent = 'Geen geschiedenis gevonden.';
            databaseListElement.appendChild(li);
        }
    }
    
    // Tab functionaliteit
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Update active content
            tabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(`${tabName}Tab`).classList.add('active');
            
            // Load database history when switching to that tab
            if (tabName === 'database') {
                loadDatabaseHistory();
            }
        });
    });
    
    // Laad database geschiedenis
    async function loadDatabaseHistory() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/history`);
            const history = await response.json();
            updateDatabaseHistory(history);
        } catch (error) {
            console.error('Fout bij laden geschiedenis:', error);
        }
    }
    
    // Ververs metadata knop
    refreshButtonElement.addEventListener('click', fetchMetadata);
    
    // Socket.io events
    socket.on('metadata', (data) => {
        if (data.station === currentStation) {
            updateNowPlaying(data);
        }
    });
    
    socket.on('history', (data) => {
        if (data.station === currentStation) {
            updateHistory(data.tracks);
        }
    });
    
    // Initialisatie
    loadStations();
    
    // Periodiek metadata verversen
    setInterval(fetchMetadata, 30000); // Elke 30 seconden
});

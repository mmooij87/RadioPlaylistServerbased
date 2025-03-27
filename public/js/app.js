// Integratie van frontend en backend
document.addEventListener('DOMContentLoaded', function() {
    // Laad de benodigde scripts
    if (!window.MetadataExtractor || !window.MetadataAPI) {
        console.error('Metadata backend modules niet geladen!');
        return;
    }
    
    // Referenties naar DOM elementen
    const audioElement = document.getElementById('audio-player');
    const playButton = document.getElementById('play-button');
    const stopButton = document.getElementById('stop-button');
    const currentTitle = document.getElementById('current-title');
    const currentArtist = document.getElementById('current-artist');
    const currentAlbumArt = document.getElementById('current-album-art');
    const playlistContainer = document.getElementById('playlist-container');
    
    // Animeer de equalizer bars
    const equalizerBars = document.querySelectorAll('.equalizer .bar');
    function animateEqualizer() {
        equalizerBars.forEach(bar => {
            const height = Math.floor(Math.random() * 80) + 20 + '%';
            bar.style.height = height;
        });
    }
    
    let equalizerInterval;
    let playHistory = [];
    
    // Configuratie voor de player
    const streamUrl = 'https://playerservices.streamtheworld.com/api/livestream-redirect/KINK.mp3';
    const stationId = 'KINK';
    
    // Gebruik de backend API om metadata op te halen
    function fetchMetadataFromBackend() {
        // In een echte implementatie zou je hier een API call doen
        // Voor nu gebruiken we de globale metadataAPI instantie
        const metadata = window.metadataAPI.getCurrentMetadata(stationId);
        
        if (metadata && metadata.StreamTitle) {
            processMetadata(metadata);
        }
        
        // Poll elke 10 seconden voor nieuwe metadata
        setTimeout(fetchMetadataFromBackend, 10000);
    }
    
    // Functie om album art op te halen
    async function getAlbumArt(artist, title) {
        try {
            // Gebruik de album art service
            return await searchAlbumArt(artist, title);
        } catch (error) {
            console.error('Fout bij ophalen album art:', error);
            return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzU1NSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMTQuNWMtMi40OSAwLTQuNS0yLjAxLTQuNS00LjVTOS41MSA3LjUgMTIgNy41czQuNSAyLjAxIDQuNSA0LjUtMi4wMSA0LjUtNC41IDQuNXptMC01LjVjLS41NSAwLTEgLjQ1LTEgMXMuNDUgMSAxIDEgMS0uNDUgMS0xLS40NS0xLTEtMXoiLz48L3N2Zz4=';
        }
    }
    
    // Functie om metadata te verwerken
    async function processMetadata(metadata) {
        console.log('Nieuwe metadata ontvangen:', metadata);
        
        if (metadata.StreamTitle) {
            // Vaak is het formaat "Artiest - Titel"
            const parts = metadata.StreamTitle.split(' - ');
            if (parts.length >= 2) {
                const artist = parts[0].trim();
                const title = parts.slice(1).join(' - ').trim();
                
                currentTitle.textContent = title;
                currentArtist.textContent = artist;
                
                // Haal album art op
                const albumArtUrl = await getAlbumArt(artist, title);
                currentAlbumArt.src = albumArtUrl;
                
                // Voeg toe aan afspeelgeschiedenis als het een nieuw nummer is
                const lastTrack = playHistory.length > 0 ? playHistory[0] : null;
                if (!lastTrack || lastTrack.title !== title || lastTrack.artist !== artist) {
                    const timestamp = new Date();
                    const trackInfo = {
                        title: title,
                        artist: artist,
                        timestamp: timestamp,
                        albumArt: albumArtUrl
                    };
                    
                    // Voeg toe aan het begin van de geschiedenis
                    playHistory.unshift(trackInfo);
                    
                    // Update de weergave
                    updatePlaylistDisplay();
                    
                    // Voeg Spotify link toe indien gewenst
                    // Dit zou een link kunnen zijn die de Spotify app opent
                    // const spotifyUrl = `spotify:search:${encodeURIComponent(artist + ' ' + title)}`;
                }
            } else {
                // Als we de titel niet kunnen splitsen, toon dan de hele string
                currentTitle.textContent = metadata.StreamTitle;
                currentArtist.textContent = '';
            }
        }
    }
    
    // Maak een nieuwe player instantie
    const player = new IcecastMetadataPlayer(
        streamUrl,
        {
            onMetadata: processMetadata,
            metadataTypes: ["icy"],
            audioElement: audioElement,
            onError: (error) => {
                console.error('Er is een fout opgetreden:', error);
            }
        }
    );
    
    // Event listeners voor de knoppen
    playButton.addEventListener('click', function() {
        player.play();
        equalizerInterval = setInterval(animateEqualizer, 300);
        
        // Start ook de backend metadata polling
        fetchMetadataFromBackend();
    });
    
    stopButton.addEventListener('click', function() {
        player.stop();
        clearInterval(equalizerInterval);
        // Reset equalizer bars
        equalizerBars.forEach(bar => {
            bar.style.height = '0%';
        });
    });
    
    // Functie om de afspeelgeschiedenis weer te geven
    function updatePlaylistDisplay() {
        playlistContainer.innerHTML = '';
        
        playHistory.forEach((track, index) => {
            const playlistItem = document.createElement('div');
            playlistItem.className = 'playlist-item' + (index === 0 ? ' current' : '');
            
            // Equalizer icon voor het huidige nummer
            if (index === 0) {
                const equalizerIcon = document.createElement('div');
                equalizerIcon.className = 'equalizer-icon';
                for (let i = 0; i < 4; i++) {
                    const bar = document.createElement('div');
                    bar.className = 'bar';
                    equalizerIcon.appendChild(bar);
                }
                playlistItem.appendChild(equalizerIcon);
            }
            
            // Album art
            const albumArtDiv = document.createElement('div');
            albumArtDiv.className = 'playlist-album-art';
            const albumImg = document.createElement('img');
            albumImg.src = track.albumArt || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzU1NSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMTQuNWMtMi40OSAwLTQuNS0yLjAxLTQuNS00LjVTOS41MSA3LjUgMTIgNy41czQuNSAyLjAxIDQuNSA0LjUtMi4wMSA0LjUtNC41IDQuNXptMC01LjVjLS41NSAwLTEgLjQ1LTEgMXMuNDUgMSAxIDEgMS0uNDUgMS0xLS40NS0xLTEtMXoiLz48L3N2Zz4=';
            albumImg.alt = 'Album Art';
            albumArtDiv.appendChild(albumImg);
            playlistItem.appendChild(albumArtDiv);
            
            // Track info
            const trackInfoDiv = document.createElement('div');
            trackInfoDiv.className = 'playlist-track-info';
            
            const titleDiv = document.createElement('div');
            titleDiv.className = 'playlist-track-title';
            titleDiv.textContent = track.title;
            trackInfoDiv.appendChild(titleDiv);
            
            const artistDiv = document.createElement('div');
            artistDiv.className = 'playlist-track-artist';
            artistDiv.textContent = track.artist;
            trackInfoDiv.appendChild(artistDiv);
            
            playlistItem.appendChild(trackInfoDiv);
            
            // Timestamp
            const timeDiv = document.createElement('div');
            timeDiv.className = 'playlist-track-time';
            timeDiv.textContent = formatTime(track.timestamp);
            playlistItem.appendChild(timeDiv);
            
            // Spotify link indien gewenst
            if (track.artist && track.title) {
                const spotifyLink = document.createElement('a');
                spotifyLink.href = `spotify:search:${encodeURIComponent(track.artist + ' ' + track.title)}`;
                spotifyLink.className = 'spotify-link';
                spotifyLink.textContent = 'Open in Spotify';
                spotifyLink.target = '_blank';
                playlistItem.appendChild(spotifyLink);
            }
            
            playlistContainer.appendChild(playlistItem);
        });
    }
    
    // Helper functie om tijd te formatteren
    function formatTime(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // Start met animeren van de equalizer
    animateEqualizer();
});

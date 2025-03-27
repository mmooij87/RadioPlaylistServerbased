// Album art API service
const lastFmApiKey = 'YOUR_API_KEY'; // You would need to register for a Last.fm API key

// Function to fetch album art from Last.fm API
async function fetchAlbumArt(artist, title) {
    try {
        // Clean up artist and title for URL
        const cleanArtist = encodeURIComponent(artist.trim());
        const cleanTitle = encodeURIComponent(title.trim());
        
        // Last.fm API endpoint for album info
        const url = `https://ws.audioscrobbler.com/2.0/?method=album.getinfo&api_key=${lastFmApiKey}&artist=${cleanArtist}&album=${cleanTitle}&format=json`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        // Check if we have album images
        if (data.album && data.album.image && data.album.image.length > 0) {
            // Last.fm provides multiple image sizes, we'll use the large one (index 3)
            const largeImage = data.album.image[3]['#text'];
            if (largeImage) {
                return largeImage;
            }
        }
        
        // If no album art found, try searching for the track
        const trackUrl = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${lastFmApiKey}&artist=${cleanArtist}&track=${cleanTitle}&format=json`;
        
        const trackResponse = await fetch(trackUrl);
        const trackData = await trackResponse.json();
        
        if (trackData.track && trackData.track.album && trackData.track.album.image && trackData.track.album.image.length > 0) {
            const largeImage = trackData.track.album.image[3]['#text'];
            if (largeImage) {
                return largeImage;
            }
        }
        
        // If still no album art, try artist image as fallback
        const artistUrl = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&api_key=${lastFmApiKey}&artist=${cleanArtist}&format=json`;
        
        const artistResponse = await fetch(artistUrl);
        const artistData = await artistResponse.json();
        
        if (artistData.artist && artistData.artist.image && artistData.artist.image.length > 0) {
            const largeImage = artistData.artist.image[3]['#text'];
            if (largeImage) {
                return largeImage;
            }
        }
        
        // Return default image if nothing found
        return null;
    } catch (error) {
        console.error('Error fetching album art:', error);
        return null;
    }
}

// Alternative method using Spotify API (would require OAuth setup)
async function fetchAlbumArtFromSpotify(artist, title) {
    // This is a placeholder for Spotify API implementation
    // Spotify requires OAuth authentication which is more complex
    // Would need to implement the full OAuth flow for this to work
    console.log('Spotify API not implemented yet');
    return null;
}

// Function to search for album art using multiple services
async function searchAlbumArt(artist, title) {
    // Try Last.fm first
    const lastFmArt = await fetchAlbumArt(artist, title);
    if (lastFmArt) {
        return lastFmArt;
    }
    
    // Could try other services here
    // const spotifyArt = await fetchAlbumArtFromSpotify(artist, title);
    // if (spotifyArt) {
    //     return spotifyArt;
    // }
    
    // Return default image if nothing found
    return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzU1NSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMTQuNWMtMi40OSAwLTQuNS0yLjAxLTQuNS00LjVTOS41MSA3LjUgMTIgNy41czQuNSAyLjAxIDQuNSA0LjUtMi4wMSA0LjUtNC41IDQuNXptMC01LjVjLS41NSAwLTEgLjQ1LTEgMXMuNDUgMSAxIDEgMS0uNDUgMS0xLS40NS0xLTEtMXoiLz48L3N2Zz4=';
}

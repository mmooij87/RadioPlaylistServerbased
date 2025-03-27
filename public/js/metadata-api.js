// Server-side API voor het ophalen van metadata
// Dit bestand zou in een echte implementatie op een server draaien

class MetadataAPI {
    constructor() {
        this.metadataCache = {};
        this.streamSources = {
            'KINK': 'https://playerservices.streamtheworld.com/api/livestream-redirect/KINK.mp3'
        };
        this.extractors = {};
        
        // Initialiseer extractors voor alle streams
        Object.keys(this.streamSources).forEach(stationId => {
            this.extractors[stationId] = new MetadataExtractor(this.streamSources[stationId]);
            
            // Registreer callback om metadata cache bij te werken
            this.extractors[stationId].onMetadata(metadata => {
                this.metadataCache[stationId] = {
                    ...metadata,
                    timestamp: new Date().toISOString()
                };
            });
            
            // Start de extractor
            this.extractors[stationId].start();
        });
    }
    
    // API endpoint om huidige metadata op te halen
    getCurrentMetadata(stationId) {
        if (!this.metadataCache[stationId]) {
            return { error: 'No metadata available for this station' };
        }
        
        return this.metadataCache[stationId];
    }
    
    // API endpoint om metadata geschiedenis op te halen
    getMetadataHistory(stationId, limit = 10) {
        // In een echte implementatie zou je dit uit een database halen
        // Voor nu geven we alleen de huidige metadata terug
        if (!this.metadataCache[stationId]) {
            return { error: 'No metadata available for this station' };
        }
        
        return [this.metadataCache[stationId]];
    }
    
    // API endpoint om beschikbare stations op te halen
    getAvailableStations() {
        return Object.keys(this.streamSources).map(stationId => ({
            id: stationId,
            name: stationId,
            streamUrl: this.streamSources[stationId]
        }));
    }
    
    // API endpoint om een station toe te voegen
    addStation(stationId, streamUrl) {
        if (this.streamSources[stationId]) {
            return { error: 'Station already exists' };
        }
        
        this.streamSources[stationId] = streamUrl;
        this.extractors[stationId] = new MetadataExtractor(streamUrl);
        
        this.extractors[stationId].onMetadata(metadata => {
            this.metadataCache[stationId] = {
                ...metadata,
                timestamp: new Date().toISOString()
            };
        });
        
        this.extractors[stationId].start();
        
        return { success: true, stationId, streamUrl };
    }
}

// In een echte implementatie zou je hier een REST API of WebSocket server opzetten
// Voor deze demo gebruiken we een globale instantie
const metadataAPI = new MetadataAPI();

// Exporteer de API
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MetadataAPI, metadataAPI };
} else {
    // Voor browser gebruik
    window.MetadataAPI = MetadataAPI;
    window.metadataAPI = metadataAPI;
}

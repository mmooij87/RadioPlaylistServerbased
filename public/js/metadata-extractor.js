// Backend service voor metadata extractie
// Dit bestand bevat de logica voor het ophalen en verwerken van metadata uit de stream

class MetadataExtractor {
    constructor(streamUrl) {
        this.streamUrl = streamUrl;
        this.callbacks = [];
        this.isRunning = false;
        this.retryTimeout = 5000; // 5 seconden tussen retries
        this.metadataCache = null;
    }

    // Registreer een callback functie die wordt aangeroepen wanneer nieuwe metadata beschikbaar is
    onMetadata(callback) {
        if (typeof callback === 'function') {
            this.callbacks.push(callback);
        }
    }

    // Start het extractieproces
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.fetchMetadata();
        
        console.log('Metadata extractie gestart voor stream:', this.streamUrl);
    }

    // Stop het extractieproces
    stop() {
        this.isRunning = false;
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        console.log('Metadata extractie gestopt');
    }

    // Haal metadata op van de stream
    async fetchMetadata() {
        if (!this.isRunning) return;

        try {
            // In een echte backend implementatie zou je hier een server-side request doen
            // Voor deze demo gebruiken we de IcecastMetadataPlayer in de browser
            
            // Simuleer een server-side polling mechanisme
            this.timeoutId = setTimeout(() => {
                // In een echte implementatie zou je hier de metadata ophalen
                // en verwerken, maar voor nu gebruiken we de browser-side implementatie
                this.fetchMetadata();
            }, 10000); // Poll elke 10 seconden voor nieuwe metadata
        } catch (error) {
            console.error('Fout bij ophalen metadata:', error);
            
            // Retry na timeout
            this.timeoutId = setTimeout(() => {
                this.fetchMetadata();
            }, this.retryTimeout);
        }
    }

    // Verwerk ontvangen metadata en stuur naar callbacks
    processMetadata(metadata) {
        // Voorkom dubbele notificaties voor dezelfde metadata
        if (this.metadataCache && 
            this.metadataCache.StreamTitle === metadata.StreamTitle) {
            return;
        }
        
        this.metadataCache = metadata;
        
        // Stuur metadata naar alle geregistreerde callbacks
        this.callbacks.forEach(callback => {
            try {
                callback(metadata);
            } catch (error) {
                console.error('Fout in metadata callback:', error);
            }
        });
    }

    // Parse metadata uit ICY headers
    parseIcyMetadata(data) {
        // In een echte implementatie zou je hier de ICY headers parsen
        // Voor nu is dit een placeholder
        return {
            StreamTitle: data
        };
    }
}

// Exporteer de MetadataExtractor klasse
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MetadataExtractor };
} else {
    // Voor browser gebruik
    window.MetadataExtractor = MetadataExtractor;
}

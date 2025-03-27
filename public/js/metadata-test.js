const IcecastMetadataPlayer = require('icecast-metadata-player');

// Configuratie voor de player
const streamUrl = 'https://playerservices.streamtheworld.com/api/livestream-redirect/KINK.mp3';

// Functie om metadata te tonen
const onMetadata = (metadata) => {
  console.log('Nieuwe metadata ontvangen:');
  console.log(JSON.stringify(metadata, null, 2));
  
  // Meestal bevat de StreamTitle informatie over artiest en titel
  if (metadata.StreamTitle) {
    console.log(`Nu speelt: ${metadata.StreamTitle}`);
    
    // Vaak is het formaat "Artiest - Titel"
    const parts = metadata.StreamTitle.split(' - ');
    if (parts.length >= 2) {
      const artist = parts[0].trim();
      const title = parts.slice(1).join(' - ').trim();
      console.log(`Artiest: ${artist}`);
      console.log(`Titel: ${title}`);
    }
  }
};

// Maak een nieuwe player instantie
const player = new IcecastMetadataPlayer(
  streamUrl,
  {
    onMetadata,
    metadataTypes: ["icy"],
    // Niet daadwerkelijk audio afspelen, alleen metadata ophalen
    audioElement: null,
    onError: (error) => {
      console.error('Er is een fout opgetreden:', error);
    }
  }
);

console.log('Start met luisteren naar metadata van KINK radio...');
console.log('Stream URL:', streamUrl);
console.log('Wacht op metadata updates (dit kan enkele momenten duren)...');

// Start de player om metadata te ontvangen
player.play();

// Stop na 60 seconden
setTimeout(() => {
  console.log('Test voltooid, stoppen met luisteren...');
  player.stop();
  process.exit(0);
}, 60000);

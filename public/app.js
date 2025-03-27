document.addEventListener('DOMContentLoaded', () => {
    const audioPlayer = document.getElementById('audio-player');
    const stationName = document.getElementById('station-name');
    const stationDescription = document.getElementById('station-description');
    const currentTrack = document.getElementById('current-track');
    const streamsList = document.getElementById('streams-list');
    const historyList = document.getElementById('history-list');
    const volumeControl = document.getElementById('volume');
    
    let streams = [];
    let currentStreamIndex = -1;
    let playHistory = [];
    let metadataInterval = null;
    
    // Load streams from the server
    async function loadStreams() {
        try {
            const response = await fetch('/api/streams');
            streams = await response.json();
            
            // Populate streams list
            streamsList.innerHTML = '';
            streams.forEach((stream, index) => {
                const li = document.createElement('li');
                li.textContent = stream.name;
                li.dataset.index = index;
                li.addEventListener('click', () => playStream(index));
                streamsList.appendChild(li);
            });
        } catch (error) {
            console.error('Error loading streams:', error);
        }
    }
    
    // Play a stream
    function playStream(index) {
        // Clear any existing metadata interval
        if (metadataInterval) {
            clearInterval(metadataInterval);
        }
        
        // Update UI
        currentStreamIndex = index;
        const stream = streams[index];
        stationName.textContent = stream.name;
        stationDescription.textContent = stream.description;
        currentTrack.textContent = 'Loading...';
        
        // Update active stream in list
        document.querySelectorAll('#streams-list li').forEach(li => {
            li.classList.remove('active');
        });
        document.querySelector(`#streams-list li[data-index="${index}"]`).classList.add('active');
        
        // Set audio source to our proxy endpoint
        audioPlayer.src = `/api/stream/${index}`;
        audioPlayer.play().catch(error => {
            console.error('Error playing stream:', error);
            currentTrack.textContent = 'Error playing stream';
        });
        
        // Start fetching metadata
        fetchMetadata(index);
        metadataInterval = setInterval(() => fetchMetadata(index), 10000); // Every 10 seconds
    }
    
    // Fetch metadata for a stream
    async function fetchMetadata(index) {
        try {
            const response = await fetch(`/api/metadata/${index}`);
            const metadata = await response.json();
            
            if (metadata.currentTrack && metadata.currentTrack !== 'Unknown') {
                currentTrack.textContent = metadata.currentTrack;
                
                // Add to history if it's a new track
                if (playHistory.length === 0 || playHistory[0].track !== metadata.currentTrack) {
                    addToHistory(streams[index].name, metadata.currentTrack);
                }
            }
        } catch (error) {
            console.error('Error fetching metadata:', error);
        }
    }
    
    // Add a track to the play history
    function addToHistory(station, track) {
        // Add to the beginning of the array
        playHistory.unshift({
            station,
            track,
            timestamp: new Date()
        });
        
        // Limit history to 20 items
        if (playHistory.length > 20) {
            playHistory.pop();
        }
        
        // Update history display
        updateHistoryDisplay();
    }
    
    // Update the history display
    function updateHistoryDisplay() {
        historyList.innerHTML = '';
        
        playHistory.forEach(item => {
            const li = document.createElement('li');
            const time = item.timestamp.toLocaleTimeString();
            li.textContent = `${time} - ${item.station}: ${item.track}`;
            historyList.appendChild(li);
        });
    }
    
    // Handle volume change
    volumeControl.addEventListener('input', () => {
        audioPlayer.volume = volumeControl.value;
    });
    
    // Initialize
    loadStreams();
});
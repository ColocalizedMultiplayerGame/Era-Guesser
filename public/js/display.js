const socket = io();

// UI Elements
const screenResult = document.getElementById('screen-result');
const photoImg = document.getElementById('current-photo');
const timerDisplay = document.getElementById('timer');
const roundDisplay = document.getElementById('current-round');
const totalRoundsDisplay = document.getElementById('total-rounds');
const loadingMessage = document.getElementById('loading-message');

const leaderboardList = document.getElementById('leaderboard-list');

// Map
let map = L.map('result-map').setView([20, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap France contributors'
}).addTo(map);

let markers = [];
let correctMarker = null;

// --- Audio System ---
const sfxCamera = new Audio('audio/camera-flash.mp3');
const sfxTypewriter = new Audio('audio/typewriter-type-and-ding.mp3');
const sfxPaper1 = new Audio('audio/paper1.mp3'); // End game results
const sfxPaper2 = new Audio('audio/paper2.mp3'); // Tutorial screen

const bgAudio = new Audio('audio/Local-Elevator.mp3');
bgAudio.loop = true;

const gameTracks = ['audio/Kool-Kats.mp3', 'audio/Sneaky-Snitch.mp3'];
let currentGameTrackIndex = 0;
let gameBGMStarted = false;

function playNextGameTrack() {
    bgAudio.src = gameTracks[currentGameTrackIndex];
    bgAudio.loop = false;
    bgAudio.play().catch(e => console.log('BGM play error:', e));
    
    bgAudio.onended = () => {
        currentGameTrackIndex = (currentGameTrackIndex + 1) % gameTracks.length;
        playNextGameTrack();
    };
}

const unlockAudio = () => {
    if (bgAudio.paused && !gameBGMStarted) {
        bgAudio.play().catch(console.error);
    }
};
document.addEventListener('click', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });
// --------------------

socket.emit('identify', 'display');

function fetchAndDisplayQR() {
    fetch('/qrcode')
        .then(res => res.json())
        .then(data => {
            const container = document.getElementById('qr-code-placeholder');
            if (container) {
                if (!data.ready) {
                    container.innerHTML = `
                        <p style="margin: 0; font-size: 0.9rem; font-style: italic; opacity: 0.7;">Génération du lien sécurisé...<br>Veuillez patienter.</p>
                    `;
                } else {
                    container.innerHTML = `
                        <p style="margin: 0 0 5px 0; font-size: 0.9rem; font-weight: bold;">Scannez pour rejoindre</p>
                        <img src="${data.qr}" style="width: 110px; border-radius: 8px;">
                        <p style="font-size: 0.65rem; word-break: break-all; margin: 5px 0 0 0;">${data.url}</p>
                    `;
                }
            }
        });
}

// Events
socket.on('connect', () => {
    console.log("Connected to server");
    fetchAndDisplayQR();
});

socket.on('tunnelReady', () => {
    console.log("Tunnel ready, refreshing QR Code");
    fetchAndDisplayQR();
});

socket.on('playerJoined', (player) => {
    updateLeaderboard(player);
});
socket.on('playerUpdated', (player) => {
    updateLeaderboard(player);
});

socket.on('updateState', (state) => {
    Object.values(state.players).forEach(updateLeaderboard);
    if (state.phase !== 'LOBBY') {
        sortLeaderboardByScore();
    }
});

socket.on('roundStart', (data) => {
    if (!gameBGMStarted) {
        gameBGMStarted = true;
        playNextGameTrack();
    }
    
    sfxCamera.currentTime = 0;
    sfxCamera.play().catch(e => {});

    document.body.classList.add('game-started');

    // Hide QR code to expand leaderboard
    const qrPlaceholder = document.getElementById('qr-code-placeholder');
    if (qrPlaceholder) qrPlaceholder.classList.add('hidden');

    // Reset view
    clearMap();
    screenResult.style.display = 'none';
    
    // Photo & Pin Drop Animation
    photoImg.style.display = 'block';
    const pin = document.querySelector('#photo-wrapper .pin');
    
    photoImg.classList.remove('animate-drop', 'animate-flash');
    if(pin) pin.classList.remove('animate-stab');
    
    void photoImg.offsetWidth; // Reflow
    
    photoImg.classList.add('animate-drop', 'animate-flash');
    if(pin) pin.classList.add('animate-stab');

    // Update Info
    roundDisplay.textContent = data.round;
    totalRoundsDisplay.textContent = data.total;
    photoImg.src = data.imageUrl;
    timerDisplay.textContent = data.time;
    loadingMessage.style.display = 'none';
});

socket.on('timerUpdate', (time) => {
    timerDisplay.textContent = time;
    if (time <= 5) {
        timerDisplay.style.color = 'var(--color-blood-red)';
    } else {
        timerDisplay.style.color = ''; // Clears inline style to use CSS color
    }
});

socket.on('playerGuessed', (playerId) => {
    const li = document.getElementById(`player-${playerId}`);
    if (li) {
        li.classList.add('has-guessed');
    }
});

socket.on('roundResult', (data) => {
    sfxTypewriter.currentTime = 0;
    sfxTypewriter.play().catch(e => {});

    photoImg.style.display = 'none';
    screenResult.style.display = 'flex';

    // Map Slam Animation
    const resultMap = document.getElementById('result-map');
    resultMap.classList.remove('animate-slam');
    
    // Context Memo Updates
    document.getElementById('context-year').textContent = data.correctYear;
    document.getElementById('context-desc').textContent = data.description;
    const contextCard = document.getElementById('context-card');
    contextCard.classList.remove('animate-context');
    
    void resultMap.offsetWidth; // Reflow
    
    resultMap.classList.add('animate-slam');
    contextCard.classList.add('animate-context');

    setTimeout(() => {
        map.invalidateSize();

        // Show Correct Location
        const correctIcon = L.icon({
            iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        });

        correctMarker = L.marker([data.correctLocation.lat, data.correctLocation.lng], { icon: correctIcon })
            .addTo(map)
            .bindPopup(`<b style="font-size: 1.1rem; color: var(--color-ink);">${data.correctCountry}</b>`)
            .openPopup();

        // Show Player Guesses
        data.playerResults.forEach(res => {
            if (res.guess) {
                // Pin
                const pIcon = L.divIcon({
                    className: 'custom-pin',
                    html: `<div style="background-color:${res.color}; width:15px; height:15px; border-radius:50%; border:2px solid white;"></div>`,
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                });

                const m = L.marker([res.guess.lat, res.guess.lng], { icon: pIcon })
                    .addTo(map)
                    .bindPopup(`<b>${res.name}</b><br>D: -${Math.floor(res.distance)}km<br>Y: ${res.guess.year} (${res.yearDiff > 0 ? '+' : ''}${0 - res.yearDiff})`);
                markers.push(m);

                // Line to correct
                const line = L.polyline([
                    [data.correctLocation.lat, data.correctLocation.lng],
                    [res.guess.lat, res.guess.lng]
                ], { color: res.color, weight: 2, opacity: 0.6, dashArray: '5, 10' }).addTo(map);
                markers.push(line);
            }
            updateLeaderboard({ id: res.id, name: res.name, score: res.totalScore, color: res.color });
        });
        sortLeaderboardByScore();

        const group = new L.featureGroup([correctMarker, ...markers]);
        map.fitBounds(group.getBounds().pad(0.1));

    }, 100);

    document.querySelectorAll('.has-guessed').forEach(el => el.classList.remove('has-guessed'));
});

socket.on('gameEnd', (playersObj) => {
    
    sfxPaper1.currentTime = 0;
    sfxPaper1.play().catch(e => {});

    const players = Object.values(playersObj).sort((a,b) => b.score - a.score);
    const finalBoard = document.getElementById('final-leaderboard');
    finalBoard.innerHTML = '';
    
    players.forEach((p, index) => {
        let medal = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : ''));
        finalBoard.innerHTML += `
            <li style="color: ${p.color};">
                <span>${medal} #${index + 1} ${p.name}</span>
                <span>${p.score} pts</span>
            </li>
        `;
    });
    
    // Show endgame screen
    const endgame = document.getElementById('endgame-screen');
    endgame.classList.remove('hidden');
});

socket.on('resetLobby', () => {
    window.location.reload(); // Hard reset directly to a clean UI desk state
});

socket.on('disconnect', () => {
    const offlineScreen = document.getElementById('server-offline-screen');
    if (offlineScreen) {
        offlineScreen.classList.remove('hidden');
    }
});

socket.on('playerLeft', (playerId) => {
    const li = document.getElementById(`player-${playerId}`);
    if (li) {
        li.remove();
        const countSpan = document.getElementById('player-count');
        const list = document.getElementById('leaderboard-list');
        if (countSpan && list) {
            countSpan.textContent = list.children.length;
        }
    }
});

let showingRules = false;

// Admin Control
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault(); // Prevents "Enter" from triggering a click on the currently focused button
        
        const loadingMessage = document.getElementById('loading-message');
        const isActive = loadingMessage && loadingMessage.style.display !== 'none';
        
        if (isActive && !showingRules) {
            showRulesScreen();
        } else if (showingRules) {
            hideRulesAndStart();
        }
    }
});

const startBtn = document.getElementById('start-btn');
if (startBtn) {
    startBtn.addEventListener('click', () => {
        const loadingMessage = document.getElementById('loading-message');
        const isActive = loadingMessage && loadingMessage.style.display !== 'none';
        
        if (isActive && !showingRules) {
            showRulesScreen();
        }
    });
}

function showRulesScreen() {
    const rulesScreen = document.getElementById('rules-screen');
    if (rulesScreen && rulesScreen.classList.contains('hidden')) {
        rulesScreen.classList.remove('hidden');
        showingRules = true;
        
        sfxPaper2.currentTime = 0;
        sfxPaper2.play().catch(e => {});
        
        // Remove focus from start button so Enter key doesn't virtually click it again
        if (document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();
        }
    }
}

function hideRulesAndStart() {
    const rulesScreen = document.getElementById('rules-screen');
    if (rulesScreen && !rulesScreen.classList.contains('hidden')) {
        rulesScreen.classList.add('hidden');
        showingRules = false;
        socket.emit('startGame');
    }
}

function updateLeaderboard(player) {
    const list = document.getElementById('leaderboard-list');
    let li = document.getElementById(`player-${player.id}`);

    if (!li) {
        li = document.createElement('li');
        li.id = `player-${player.id}`;
        list.prepend(li); // Prepend instead of appendChild
    }

    li.style.borderLeft = `5px solid ${player.color}`;
    li.dataset.score = player.score;
    li.innerHTML = `
        <span class="p-name">${player.name}</span>
        <span class="p-score">${player.score} pts</span>
    `;
    
    const countSpan = document.getElementById('player-count');
    if (countSpan) {
        countSpan.textContent = list.children.length;
    }
}

function clearMap() {
    if (correctMarker) map.removeLayer(correctMarker);
    markers.forEach(m => map.removeLayer(m));
    markers = [];
}

function sortLeaderboardByScore() {
    const list = document.getElementById('leaderboard-list');
    const items = Array.from(list.children);
    
    items.sort((a, b) => {
        const scoreA = parseInt(a.dataset.score || '0');
        const scoreB = parseInt(b.dataset.score || '0');
        return scoreB - scoreA; // Descending
    });

    list.innerHTML = '';
    items.forEach(li => list.appendChild(li));
}

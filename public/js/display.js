const socket = io();

// UI Elements
const screenResult = document.getElementById('screen-result');
const photoImg = document.getElementById('current-photo');
const timerDisplay = document.getElementById('timer');
const roundDisplay = document.getElementById('current-round');
const totalRoundsDisplay = document.getElementById('total-rounds');
const loadingMessage = document.getElementById('loading-message');

const leaderboardList = document.getElementById('leaderboard-list');

// Map Initialization sécurisée
let map = null;
try {
    if (typeof L !== 'undefined' && L.map) {
        map = L.map('result-map').setView([20, 0], 2);
        L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap France contributors'
        }).addTo(map);
    }
} catch (e) {
    console.error("Erreur lors de l'initialisation de la carte Leaflet:", e);
}

let markers = [];
let correctMarker = null;

// --- Audio System ---
const sfxCamera = new Audio('/audio/camera-flash.mp3');
const sfxTypewriter = new Audio('/audio/typewriter-type-and-ding.mp3');
const sfxPaper1 = new Audio('/audio/paper1.mp3'); 
const sfxPaper2 = new Audio('/audio/paper2.mp3'); 

const bgAudio = new Audio('/audio/Local-Elevator.mp3');
bgAudio.loop = true;

const gameTracks = ['/audio/Kool-Kats.mp3', '/audio/Sneaky-Snitch.mp3'];
let currentGameTrackIndex = 0;
let gameBGMStarted = false;

function playNextGameTrack() {
    try {
        bgAudio.src = gameTracks[currentGameTrackIndex];
        bgAudio.loop = false;
        bgAudio.play().catch(e => console.log('BGM play error:', e));
        
        bgAudio.onended = () => {
            currentGameTrackIndex = (currentGameTrackIndex + 1) % gameTracks.length;
            playNextGameTrack();
        };
    } catch (err) {
        console.error("Erreur pistes audio:", err);
    }
}

const unlockAudio = () => {
    if (bgAudio.paused && !gameBGMStarted) {
        bgAudio.play().catch(console.error);
    }
};
document.addEventListener('click', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });

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
        }).catch(err => console.error("Erreur QR Code:", err));
}

// Events
socket.on('connect', () => {
    console.log("Connected to server");
    fetchAndDisplayQR();
});

socket.on('playerJoined', (player) => {
    updateLeaderboard(player);
});
socket.on('playerUpdated', (player) => {
    updateLeaderboard(player);
});

socket.on('updateState', (state) => {
    if (state && state.players) {
        Object.values(state.players).forEach(updateLeaderboard);
    }
    if (state && state.phase !== 'LOBBY') {
        sortLeaderboardByScore();
    }
});

socket.on('roundStart', (data) => {
    if (!gameBGMStarted) {
        gameBGMStarted = true;
        playNextGameTrack();
    }
    
    try { sfxCamera.currentTime = 0; sfxCamera.play().catch(e => {}); } catch(e){}

    document.body.classList.add('game-started');

    const qrPlaceholder = document.getElementById('qr-code-placeholder');
    if (qrPlaceholder) qrPlaceholder.classList.add('hidden');

    clearMap();
    if (screenResult) screenResult.style.display = 'none';
    
    if (photoImg) {
        photoImg.style.display = 'block';
        photoImg.classList.remove('animate-drop', 'animate-flash');
    }
    
    const pin = document.querySelector('#photo-wrapper .pin');
    if (pin) pin.classList.remove('animate-stab');
    
    void document.body.offsetWidth; 
    
    if (photoImg) photoImg.classList.add('animate-drop', 'animate-flash');
    if (pin) pin.classList.add('animate-stab');

    if (roundDisplay) roundDisplay.textContent = data.round;
    if (totalRoundsDisplay) totalRoundsDisplay.textContent = data.total;
    if (photoImg) photoImg.src = data.imageUrl;
    if (timerDisplay) timerDisplay.textContent = data.time;
    if (loadingMessage) loadingMessage.style.display = 'none';
});

socket.on('timerUpdate', (time) => {
    if (!timerDisplay) return;
    timerDisplay.textContent = time;
    if (time <= 5) {
        timerDisplay.style.color = 'var(--color-blood-red)';
    } else {
        timerDisplay.style.color = ''; 
    }
});

socket.on('playerGuessed', (playerId) => {
    const li = document.getElementById(`player-${playerId}`);
    if (li) {
        li.classList.add('has-guessed');
    }
});

socket.on('roundResult', (data) => {
    try { sfxTypewriter.currentTime = 0; sfxTypewriter.play().catch(e => {}); } catch(e){}

    if (photoImg) photoImg.style.display = 'none';
    if (screenResult) screenResult.style.display = 'flex';

    const resultMap = document.getElementById('result-map');
    if (resultMap) resultMap.classList.remove('animate-slam');
    
    const contextYear = document.getElementById('context-year');
    const contextDesc = document.getElementById('context-desc');
    if (contextYear) contextYear.textContent = data.correctYear;
    if (contextDesc) contextDesc.textContent = data.description;
    
    const contextCard = document.getElementById('context-card');
    if (contextCard) contextCard.classList.remove('animate-context');
    
    void document.body.offsetWidth; 
    
    if (resultMap) resultMap.classList.add('animate-slam');
    if (contextCard) contextCard.classList.add('animate-context');

    setTimeout(() => {
        if (!map || typeof L === 'undefined') {
            if (data.playerResults) {
                data.playerResults.forEach(res => {
                    updateLeaderboard({ id: res.id, name: res.name, score: res.totalScore, color: res.color });
                });
            }
            sortLeaderboardByScore();
            return;
        }

        map.invalidateSize();

        const correctIcon = L.icon({
            iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        });

        if (correctMarker) map.removeLayer(correctMarker);

        correctMarker = L.marker([data.correctLocation.lat, data.correctLocation.lng], { icon: correctIcon })
            .addTo(map)
            .bindPopup(`<b style="font-size: 1.1rem; color: var(--color-ink);">${data.correctCountry}</b>`)
            .openPopup();

        if (data.playerResults) {
            data.playerResults.forEach(res => {
                if (res.guess) {
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

                    const line = L.polyline([
                        [data.correctLocation.lat, data.correctLocation.lng],
                        [res.guess.lat, res.guess.lng]
                    ], { color: res.color, weight: 2, opacity: 0.6, dashArray: '5, 10' }).addTo(map);
                    markers.push(line);
                }
                updateLeaderboard({ id: res.id, name: res.name, score: res.totalScore, color: res.color });
            });
        }
        sortLeaderboardByScore();

        try {
            const group = new L.featureGroup([correctMarker, ...markers]);
            map.fitBounds(group.getBounds().pad(0.1));
        } catch (err) {
            console.log("Erreur zoom carte:", err);
        }

    }, 100);

    document.querySelectorAll('.has-guessed').forEach(el => el.classList.remove('has-guessed'));
});

socket.on('gameEnd', (playersObj) => {
    try { sfxPaper1.currentTime = 0; sfxPaper1.play().catch(e => {}); } catch(e){}

    if (!playersObj) return;
    const players = Object.values(playersObj).sort((a,b) => b.score - a.score);
    const finalBoard = document.getElementById('final-leaderboard');
    if (finalBoard) {
        finalBoard.innerHTML = '';
        players.forEach((p, index) => {
            let medal = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : ''));
            finalBoard.innerHTML += `
                <li style="color: ${p.color};">
                    <span>${medal} #${index + 1} ${p.name}</span>

const socket = io();
let myId = null;
let currentGuess = { lat: 0, lng: 0, year: 1950 };
let hasGuessed = false;

// --- Web Audio API System ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const audioBuffers = {};

async function loadSfx(name, path) {
    try {
        const response = await fetch(path);
        const arrayBuffer = await response.arrayBuffer();
        audioBuffers[name] = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (e) {
        console.error("Audio error:", e);
    }
}
loadSfx('agrafe', 'audio/agrafe.mp3');
loadSfx('cliquetis', 'audio/cliquetis.mp3');
loadSfx('ding', 'audio/ding.mp3');

function playSfx(name) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (audioBuffers[name]) {
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffers[name];
        source.connect(audioCtx.destination);
        source.start(0);
    }
}
// ----------------------------

// UI Elements
const loginScreen = document.getElementById('login-screen');
const waitingRoom = document.getElementById('waiting-room');
const gameInterface = document.getElementById('game-interface');
const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username');
const yearSlider = document.getElementById('year-slider');
const yearDisplay = document.getElementById('selected-year');
const submitBtn = document.getElementById('submit-guess');
const statusMsg = document.getElementById('status-bar');
const mobileTimer = document.getElementById('mobile-timer');

// Map Initialization
let map = null;
let currentMarker = null;

function initMap() {
    if (map) return;
    map = L.map('map-input').setView([20, 0], 1);
    L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap France contributors'
    }).addTo(map);

    const redPinIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    map.on('click', (e) => {
        if (hasGuessed) return;
        if (currentMarker) map.removeLayer(currentMarker);
        
        playSfx('agrafe');

        currentMarker = L.marker(e.latlng, { icon: redPinIcon }).addTo(map);
        currentGuess.lat = e.latlng.lat;
        currentGuess.lng = e.latlng.lng;
    });
}

// Login Logic
joinBtn.addEventListener('click', () => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    let name = usernameInput.value.trim();
    if (name) {
        if (name.length > 20) name = name.substring(0, 20);
        socket.emit('identify', { type: 'controller', name: name });
        loginScreen.classList.add('hidden');
        // Wait for server to say 'waitInLobby' or 'roundStart'
    }
});

// Slider Logic
yearSlider.addEventListener('input', (e) => {
    if (hasGuessed) return;
    
    playSfx('cliquetis');
    
    yearDisplay.textContent = e.target.value;
    currentGuess.year = parseInt(e.target.value);
});

// Submit Logic
submitBtn.addEventListener('click', () => {
    if (!currentMarker) {
        alert("Placez d'abord un marqueur sur la carte !");
        return;
    }
    
    playSfx('ding');

    socket.emit('submitGuess', currentGuess);
    lockInterface();
    statusMsg.innerText = "Réponse envoyée ! En attente...";
});

function lockInterface() {
    hasGuessed = true;
    submitBtn.disabled = true;
    submitBtn.innerText = "Validé";
    yearSlider.disabled = true;
    if (map) map.dragging.disable();
    const postBtn = document.getElementById('post-guess-minigame-btn');
    if (postBtn) postBtn.classList.remove('hidden');
}

function unlockInterface() {
    hasGuessed = false;
    submitBtn.disabled = false;
    submitBtn.innerText = "Valider";
    yearSlider.disabled = false;
    statusMsg.innerText = "À vous de jouer !";
    if (map) {
        map.dragging.enable();
        if (currentMarker) map.removeLayer(currentMarker);
        currentMarker = null;
    }
    const postBtn = document.getElementById('post-guess-minigame-btn');
    if (postBtn) postBtn.classList.add('hidden');
}

socket.on('joined', (playerData) => {
    myId = playerData.id;
    console.log('Joined as', playerData);
});

socket.on('waitInLobby', () => {
    if (waitingRoom) waitingRoom.classList.remove('hidden');
    gameInterface.classList.add('hidden');
});

socket.on('roundStart', (data) => {
    document.body.classList.add('game-started');
    if (waitingRoom) waitingRoom.classList.add('hidden');
    gameInterface.classList.remove('hidden');

    if (mobileTimer && data && data.time) {
        mobileTimer.innerText = data.time;
    }
    // Initialize map now that it's visible
    setTimeout(() => {
        initMap();
        map.invalidateSize();
        if (map) map.setView([20, 0], 1); // Auto reset zoom out!
    }, 100);
    unlockInterface();
    closeMiniGame(); // Force close mini-game when round starts
    const personalResults = document.getElementById('personal-results');
    if (personalResults) personalResults.classList.add('hidden');
});

socket.on('gameAlreadyStarted', () => {
    document.body.classList.add('game-started');
    statusMsg.innerText = "Partie en cours... Attendez la prochaine manche.";
    if (waitingRoom) waitingRoom.classList.add('hidden');
    gameInterface.classList.remove('hidden');
    lockInterface();
    setTimeout(() => {
        initMap();
        map.invalidateSize();
    }, 100);
});

socket.on('timerUpdate', (timeLeft) => {
    if (mobileTimer) {
        mobileTimer.innerText = Math.max(0, timeLeft);
    }
});

socket.on('roundResult', (data) => {
    closeMiniGame(); // Ensure minigame is closed when results appear
    const myResult = data.playerResults.find(p => p.id === myId);
    if (myResult && myResult.guess) {
        const personalResults = document.getElementById('personal-results');
        const resDist = document.getElementById('res-distance');
        const resYear = document.getElementById('res-year');
        const resPoints = document.getElementById('res-points');
        
        if (resDist) resDist.innerText = myResult.distance + ' km';
        if (resYear) {
            const myYear = myResult.guess.year;
            const diff = myYear - data.correctYear;
            
            if (diff === 0) {
                resYear.innerHTML = `${myYear}<br><span style="font-size: 1rem; color: #000; font-weight: normal;">(Année exacte !)</span>`;
            } else if (diff > 0) {
                resYear.innerHTML = `${myYear}<br><span style="font-size: 1rem; color: #000; font-weight: normal;">(${diff} an${diff > 1 ? 's' : ''} trop tard)</span>`;
            } else {
                resYear.innerHTML = `${myYear}<br><span style="font-size: 1rem; color: #000; font-weight: normal;">(${Math.abs(diff)} an${Math.abs(diff) > 1 ? 's' : ''} trop tôt)</span>`;
            }
        }
        if (resPoints) resPoints.innerText = `+${myResult.roundScore}`;
        
        if (personalResults) personalResults.classList.remove('hidden');
        gameInterface.classList.add('hidden');
    } else if (myResult && !myResult.guess) {
        // Player missed their guess
        const personalResults = document.getElementById('personal-results');
        const resPoints = document.getElementById('res-points');
        
        document.getElementById('res-distance').innerText = "-";
        document.getElementById('res-year').innerText = "-";
        if (resPoints) resPoints.innerText = "+0";
        if (personalResults) personalResults.classList.remove('hidden');
        gameInterface.classList.add('hidden');
    }
});

socket.on('disconnect', () => {
    const offlineScreen = document.getElementById('server-offline-screen');
    if (offlineScreen) {
        offlineScreen.classList.remove('hidden');
    }
});

// ==========================================
// Border Drop Mini-Game Logic
// ==========================================
const minigameModal = document.getElementById('minigame-modal');
const mgCanvas = document.getElementById('minigame-canvas');
let mgCtx = null;
if (mgCanvas) {
    mgCtx = mgCanvas.getContext('2d');
}
const mgScoreVal = document.getElementById('mg-score-val');

let mgAnimFrame = null;
let mgScore = 0;
let mgBasketX = 100;
const mgBasketWidth = 100;
const mgBasketHeight = 50;
let mgBasketContinent = "";
let mgFallingItems = [];
let mgIsPlaying = false;
let mgFrames = 0;

const mgContinents = ["Europe", "Asie", "Afrique", "Amérique", "Océanie"];
const mgCountries = {
    "Europe": ["France", "Italie", "Espagne", "Allemagne", "Roumanie", "Royaume-Uni", "Portugal", "Grèce", "Suède", "Suisse", "Belgique", "Pays-Bas", "Pologne"],
    "Asie": ["Japon", "Chine", "Inde", "Corée du Sud", "Vietnam", "Thaïlande", "Indonésie", "Philippines", "Malaisie", "Pakistan", "Irak", "Iran"],
    "Afrique": ["Egypte", "Kenya", "Maroc", "Sénégal", "Nigeria", "Afrique du Sud", "Algérie", "Tunisie", "Ethiopie", "Ghana", "Côte d'Ivoire", "Cameroun"],
    "Amérique": ["Brésil", "Canada", "Mexique", "Pérou", "Argentine", "États-Unis", "Colombie", "Chili", "Cuba", "Venezuela", "Bolivie", "Équateur"],
    "Océanie": ["Australie", "Fidji", "Samoa", "Nouvelle-Zélande", "Vanuatu", "Tonga", "Tuvalu", "Micronésie", "Kiribati"]
};

function openMiniGame() {
    if (!minigameModal) return;
    minigameModal.classList.remove('hidden');
    mgScore = 0;
    mgScoreVal.innerText = mgScore;
    mgFallingItems = [];
    mgFrames = 0;
    mgBasketX = (mgCanvas.width - mgBasketWidth) / 2;
    mgBasketContinent = mgContinents[Math.floor(Math.random() * mgContinents.length)];
    mgIsPlaying = true;
    mgLoop();
}

function closeMiniGame() {
    if (!minigameModal) return;
    minigameModal.classList.add('hidden');
    mgIsPlaying = false;
    if (mgAnimFrame) cancelAnimationFrame(mgAnimFrame);
}

// Event listeners for open/close
document.getElementById('lobby-minigame-btn')?.addEventListener('click', openMiniGame);
document.getElementById('post-guess-minigame-btn')?.addEventListener('click', openMiniGame);
document.getElementById('close-minigame-btn')?.addEventListener('click', closeMiniGame);

// Controls (Drag Mechanism)
let isDragging = false;
let offsetX = 0;

if (mgCanvas) {
    mgCanvas.addEventListener('touchstart', (e) => {
        const rect = mgCanvas.getBoundingClientRect();
        const touchX = e.touches[0].clientX - rect.left;
        mgBasketX = touchX - mgBasketWidth / 2;
        mgBasketX = Math.max(0, Math.min(mgCanvas.width - mgBasketWidth, mgBasketX));
        isDragging = true;
        offsetX = mgBasketWidth / 2;
        e.preventDefault();
    }, { passive: false });

    mgCanvas.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const rect = mgCanvas.getBoundingClientRect();
        const touchX = e.touches[0].clientX - rect.left;
        mgBasketX = touchX - offsetX;
        mgBasketX = Math.max(0, Math.min(mgCanvas.width - mgBasketWidth, mgBasketX));
        e.preventDefault();
    }, { passive: false });

    mgCanvas.addEventListener('touchend', () => isDragging = false);

    // Mouse equivalents
    mgCanvas.addEventListener('mousedown', (e) => {
        const rect = mgCanvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        mgBasketX = clickX - mgBasketWidth / 2;
        mgBasketX = Math.max(0, Math.min(mgCanvas.width - mgBasketWidth, mgBasketX));
        isDragging = true;
        offsetX = mgBasketWidth / 2;
    });
    mgCanvas.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const rect = mgCanvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        mgBasketX = clickX - offsetX;
        mgBasketX = Math.max(0, Math.min(mgCanvas.width - mgBasketWidth, mgBasketX));
    });
    mgCanvas.addEventListener('mouseup', () => isDragging = false);
    mgCanvas.addEventListener('mouseleave', () => isDragging = false);
}

function mgLoop() {
    if (!mgIsPlaying) return;
    mgFrames++;

    mgCtx.clearRect(0, 0, mgCanvas.width, mgCanvas.height);

    // Spawn items
    if (mgFrames % 60 === 0) {
        // Randomly pick a continent and then a country from it
        const cont = mgContinents[Math.floor(Math.random() * mgContinents.length)];
        const countryList = mgCountries[cont];
        const country = countryList[Math.floor(Math.random() * countryList.length)];
        mgFallingItems.push({
            x: Math.random() * (mgCanvas.width - 60) + 10,
            y: -20,
            speed: 2 + Math.random() * 2,
            text: country,
            continent: cont
        });
    }

    // Change basket continent every a few catches/time
    if (mgFrames % 600 === 0) {
        mgBasketContinent = mgContinents[Math.floor(Math.random() * mgContinents.length)];
    }

    // Draw basket (Wire Mesh Trash Can)
    mgCtx.save();
    mgCtx.translate(mgBasketX, mgCanvas.height - mgBasketHeight - 10);
    // Base inner
    mgCtx.globalCompositeOperation = 'destination-over';
    mgCtx.fillStyle = '#111';
    mgCtx.beginPath();
    mgCtx.ellipse(mgBasketWidth / 2, mgBasketHeight, 30, 5, 0, 0, Math.PI * 2);
    mgCtx.fill();
    mgCtx.globalCompositeOperation = 'source-over';

    // Body Mesh
    mgCtx.strokeStyle = '#444';
    mgCtx.lineWidth = 1.5;
    mgCtx.beginPath();
    mgCtx.moveTo(0, 0); // left rim
    mgCtx.lineTo(mgBasketWidth / 2 - 30, mgBasketHeight); // left base
    mgCtx.lineTo(mgBasketWidth / 2 + 30, mgBasketHeight); // right base
    mgCtx.lineTo(mgBasketWidth, 0); // right rim
    mgCtx.fillStyle = 'rgba(0,0,0,0.5)';
    mgCtx.fill(); // Dark semi-transparent background for bin
    mgCtx.save();
    mgCtx.clip();
    // Grid
    mgCtx.beginPath();
    for (let x = -50; x < mgBasketWidth + 50; x += 15) {
        mgCtx.moveTo(x, -10);
        mgCtx.lineTo(x + 50, mgBasketHeight + 10);
        mgCtx.moveTo(x + 50, -10);
        mgCtx.lineTo(x, mgBasketHeight + 10);
    }
    mgCtx.stroke();
    mgCtx.restore();

    // Rims
    mgCtx.fillStyle = '#222';
    mgCtx.beginPath();
    mgCtx.ellipse(mgBasketWidth / 2, 0, mgBasketWidth / 2, 6, 0, 0, Math.PI * 2);
    mgCtx.fill();
    mgCtx.strokeStyle = '#888';
    mgCtx.lineWidth = 2;
    mgCtx.stroke(); // Shiny top rim
    mgCtx.fillStyle = '#222';
    mgCtx.beginPath();
    mgCtx.ellipse(mgBasketWidth / 2, mgBasketHeight, 30, 5, 0, 0, Math.PI * 2);
    mgCtx.fill();

    mgCtx.restore();

    // Text on the bin (like a label sticked to it)
    mgCtx.fillStyle = '#fdf5e6';
    mgCtx.fillRect(mgBasketX + mgBasketWidth / 2 - 30, mgCanvas.height - mgBasketHeight / 2 - 15, 60, 20);
    mgCtx.fillStyle = '#111';
    mgCtx.font = '12px "Special Elite", monospace';
    mgCtx.textAlign = 'center';
    mgCtx.textBaseline = 'middle';
    mgCtx.fillText(mgBasketContinent, mgBasketX + mgBasketWidth / 2, mgCanvas.height - mgBasketHeight / 2 - 5);

    // Draw items (Tags with Strings)
    for (let i = mgFallingItems.length - 1; i >= 0; i--) {
        let item = mgFallingItems[i];
        item.y += item.speed;

        mgCtx.font = '14px "Special Elite", monospace';
        const tWidth = mgCtx.measureText(item.text).width;
        const tagWidth = tWidth + 20;
        const tagHeight = 24;

        mgCtx.save();
        mgCtx.translate(item.x, item.y);

        // Red string
        mgCtx.strokeStyle = '#ad1a1a';
        mgCtx.lineWidth = 1.5;
        mgCtx.beginPath();
        mgCtx.moveTo(tagWidth / 2, 0);
        mgCtx.quadraticCurveTo(tagWidth / 2 - 15, -15, tagWidth / 2 + 10, -25);
        mgCtx.stroke();

        // Tag Body
        mgCtx.fillStyle = '#fdf5e6';
        mgCtx.shadowColor = 'rgba(0,0,0,0.3)';
        mgCtx.shadowOffsetY = 2;
        mgCtx.shadowBlur = 3;
        mgCtx.beginPath();
        mgCtx.roundRect(0, 0, tagWidth, tagHeight, 3);
        mgCtx.fill();
        mgCtx.shadowColor = 'transparent';

        // Hole
        mgCtx.fillStyle = '#fff';
        mgCtx.strokeStyle = '#ccc';
        mgCtx.lineWidth = 1;
        mgCtx.beginPath();
        mgCtx.arc(tagWidth / 2, 4, 2.5, 0, Math.PI * 2);
        mgCtx.fill();
        mgCtx.stroke();

        // Text
        mgCtx.fillStyle = '#2b2b2b';
        mgCtx.textAlign = 'center';
        mgCtx.textBaseline = 'middle';
        mgCtx.fillText(item.text, tagWidth / 2, tagHeight / 2 + 2);

        mgCtx.restore();

        // Collision logic (approximate tag center)
        if (item.y + tagHeight > mgCanvas.height - mgBasketHeight - 10 && item.y < mgCanvas.height) {
            if (item.x + tagWidth / 2 > mgBasketX && item.x + tagWidth / 2 < mgBasketX + mgBasketWidth) {
                if (item.continent === mgBasketContinent) {
                    mgScore++;
                } else {
                    mgScore--;
                }
                mgScoreVal.innerText = mgScore;
                mgFallingItems.splice(i, 1);
                continue;
            }
        }

        // Out of bounds
        if (item.y > mgCanvas.height + 20) {
            mgFallingItems.splice(i, 1);
        }
    }

    mgAnimFrame = requestAnimationFrame(mgLoop);
}

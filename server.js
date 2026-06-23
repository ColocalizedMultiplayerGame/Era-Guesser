const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Get Local IP
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}
const localIp = getLocalIp();

// Load Game Data
const gameData = JSON.parse(fs.readFileSync('data.json', 'utf8'));

app.use(express.static(path.join(__dirname, 'public')));

// QR Code route moved to bottom to use publicUrl


// Helpers
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Game State
let gameState = {
    phase: 'LOBBY', // LOBBY, ROUND, RESULT, END
    players: {},
    currentRound: 0,
    totalRounds: Math.min(3, gameData.length),
    currentRoundData: null,
    timer: null,
    timeLeft: 0,
    activeRoundIndices: []
};

const ROUND_TIME = 45; // seconds

io.on('connection', (socket) => {
    // Identify client type
    socket.on('identify', (data) => {
        // Support both string 'display' and object {type, name}
        const type = typeof data === 'string' ? data : data.type;
        const name = (typeof data === 'object' && data.name) ? data.name : ('Joueur ' + socket.id.substr(0, 4));

        if (type === 'display') {
            socket.join('display');
            socket.emit('updateState', gameState);
        } else if (type === 'controller') {
            // New Player
            gameState.players[socket.id] = {
                id: socket.id,
                name: name,
                score: 0,
                color: '#' + Math.floor(Math.random() * 16777215).toString(16),
                lastGuess: null
            };
            io.to('display').emit('playerJoined', gameState.players[socket.id]);
            socket.emit('joined', gameState.players[socket.id]);

            // If game already running, inform player
            if (gameState.phase !== 'LOBBY') {
                socket.emit('gameAlreadyStarted');
            } else {
                socket.emit('waitInLobby');
            }
        }
    });

    socket.on('updateName', (name) => {
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].name = name;
            io.to('display').emit('playerUpdated', gameState.players[socket.id]);
        }
    });

    socket.on('startGame', () => {
        if (gameState.phase === 'LOBBY') {
            startGame();
        }
    });

    socket.on('submitGuess', (guess) => {
        if (gameState.phase === 'ROUND' && gameState.players[socket.id]) {
            gameState.players[socket.id].lastGuess = guess;
            gameState.players[socket.id].guessTimeLeft = gameState.timeLeft; // Record speed
            io.to('display').emit('playerGuessed', socket.id);
            socket.emit('guessReceived');
        }
    });

    socket.on('disconnect', () => {
        if (gameState.players[socket.id]) {
            delete gameState.players[socket.id];
            io.to('display').emit('playerLeft', socket.id);
        }
    });
});

let globalDeck = [];

function startGame() {
    gameState.currentRound = 0;
    gameState.players = Object.fromEntries(
        Object.entries(gameState.players).map(([id, p]) => [id, { ...p, score: 0, lastGuess: null }])
    );
    
    // Use a "Bag" randomizer (draw without replacement across games)
    if (globalDeck.length < gameState.totalRounds) {
        let pool = Array.from({length: gameData.length}, (_, i) => i);
        // Fisher-Yates shuffle
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        globalDeck = globalDeck.concat(pool);
    }
    
    // Draw the next rounds from the bag
    gameState.activeRoundIndices = globalDeck.splice(0, gameState.totalRounds);
    
    startRound();
}

function startRound() {
    gameState.currentRound++;
    if (gameState.currentRound > gameState.totalRounds) {
        endGame();
        return;
    }

    gameState.phase = 'ROUND';
    // Pick from the randomized pool
    const dataIndex = gameState.activeRoundIndices[gameState.currentRound - 1];
    gameState.currentRoundData = gameData[dataIndex];
    gameState.timeLeft = ROUND_TIME;

    // Reset guesses
    Object.keys(gameState.players).forEach(id => {
        gameState.players[id].lastGuess = null;
    });

    io.emit('roundStart', {
        round: gameState.currentRound,
        total: gameState.totalRounds,
        imageUrl: gameState.currentRoundData.imageUrl,
        time: ROUND_TIME
    });

    gameState.timer = setInterval(() => {
        gameState.timeLeft--;
        io.emit('timerUpdate', gameState.timeLeft);
        if (gameState.timeLeft <= 0) {
            endRound();
        }
    }, 1000);
}

function endRound() {
    clearInterval(gameState.timer);
    gameState.phase = 'RESULT';

    const correct = gameState.currentRoundData;
    const results = [];

    Object.keys(gameState.players).forEach(id => {
        const p = gameState.players[id];
        let roundScore = 0;
        let dist = 0;
        let yearDiff = 0;

        if (p.lastGuess) {
            // Distance Score
            dist = calculateDistance(
                correct.location.lat, correct.location.lng,
                p.lastGuess.lat, p.lastGuess.lng
            );
            const distScore = Math.max(0, 2500 - Math.floor(dist));

            // Year Score
            yearDiff = Math.abs(correct.year - p.lastGuess.year);
            const yearScore = Math.max(0, 2500 - (yearDiff * 50));

            const rawAccuracyScore = distScore + yearScore;
            
            // Speed Multiplier (Up to 2x bonus for instant answers)
            const timeRatio = (p.guessTimeLeft || 0) / ROUND_TIME; // 1.0 (fast) down to 0.0 (slow)
            const speedMultiplier = 1.0 + timeRatio; // 2.0x max, 1.0x min
            
            roundScore = Math.floor(rawAccuracyScore * speedMultiplier);
            p.score += roundScore;
            
            // Reset for next round
            p.guessTimeLeft = 0;
        }

        results.push({
            id: p.id,
            name: p.name,
            color: p.color,
            guess: p.lastGuess,
            roundScore,
            totalScore: p.score,
            distance: Math.floor(dist),
            yearDiff
        });
    });

    results.sort((a, b) => b.totalScore - a.totalScore);

    io.emit('roundResult', {
        correctLocation: correct.location,
        correctYear: correct.year,
        description: correct.description,
        correctCountry: correct.country,
        playerResults: results
    });

    setTimeout(() => {
        startRound();
    }, 10000);
}

function endGame() {
    gameState.phase = 'END';
    io.emit('gameEnd', gameState.players);
    setTimeout(() => {
        gameState.phase = 'LOBBY';
        io.emit('resetLobby');
    }, 30000); // 30 seconds
}

// const localtunnel = require('localtunnel'); // Removed in favor of untun

const PORT = 3000;
let publicUrl = null;

server.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);

    try {
        // Use untun for Cloudflare tunnel (No password page)
        const { startTunnel } = await import('untun');
        const tunnel = await startTunnel({ port: PORT });

        if (tunnel) {
            publicUrl = await tunnel.getURL();
            console.log(`Public URL: ${publicUrl}`);
            io.emit('tunnelReady');
        }
    } catch (err) {
        console.error('Error creating tunnel:', err);
    }
});

app.get('/qrcode', async (req, res) => {
    try {
        if (!publicUrl) {
            return res.json({ ready: false });
        }
        const url = `${publicUrl}/controller.html`;
        const qr = await QRCode.toDataURL(url);

        res.json({ ready: true, qr, url });
    } catch (err) {
        res.status(500).send('Error generating QR code');
    }
});

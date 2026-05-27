const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Chargement des données de jeu depuis la racine
const gameData = JSON.parse(fs.readFileSync('data.json', 'utf8'));

// Sert tous les fichiers du dossier public
app.use(express.static(path.join(__dirname, 'public')));

// Redirection de la racine vers l'écran principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

const QRCode = require('qrcode');

// Configuration de la route QR Code dynamique pour Render
app.get('/qrcode', async (req, res) => {
    try {
        const host = req.get('host'); 
        const protocol = req.protocol; 
        
        const url = `${protocol}://${host}/controller.html`;
        const qr = await QRCode.toDataURL(url);

        res.json({ ready: true, qr, url });
    } catch (err) {
        console.error('Error generating QR code:', err);
        res.status(500).send('Error generating QR code');
    }
});

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
    phase: 'LOBBY', 
    players: {},
    currentRound: 0,
    totalRounds: Math.min(3, gameData.length),
    currentRoundData: null,
    timer: null,
    timeLeft: 0,
    activeRoundIndices: []
};

const ROUND_TIME = 45; 

io.on('connection', (socket) => {
    // Identify client type
    socket.on('identify', (data) => {
        const type = typeof data === 'string' ? data : data.type;
        const name = (typeof data === 'object' && data.name) ? data.name : ('Joueur ' + socket.id.substr(0, 4));

        if (type === 'display') {
            socket.join('display');
            socket.emit('updateState', gameState);
        } else if (type === 'controller') {
            gameState.players[socket.id] = {
                id: socket.id,
                name: name,
                score: 0,
                color: '#' + Math.floor(Math.random() * 16777215).toString(16),
                lastGuess: null
            };
            io.to('display').emit('playerJoined', gameState.players[socket.id]);
            socket.emit('joined', gameState.players[socket.id]);

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
        // Supprimé la condition stricte LOBBY pour éviter les blocages en cas de désynchronisation cloud
        console.log("Ordre de démarrage reçu de l'écran principal");
        startGame();
    });

    socket.on('submitGuess', (guess) => {
        if (gameState.phase === 'ROUND' && gameState.players[socket.id]) {
            gameState.players[socket.id].lastGuess = guess;
            gameState.players[socket.id].guessTimeLeft = gameState.timeLeft; 
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
    
    if (globalDeck.length < gameState.totalRounds) {
        let pool = Array.from({length: gameData.length}, (_, i) => i);
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        globalDeck = globalDeck.concat(pool);
    }
    
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
    const dataIndex = gameState.activeRoundIndices[gameState.currentRound - 1];
    gameState.currentRoundData = gameData[dataIndex];
    gameState.timeLeft = ROUND_TIME;

    Object.keys(gameState.players).forEach(id => {
        gameState.players[id].lastGuess = null;
    });

    io.emit('roundStart', {
        round: gameState.currentRound,
        total: gameState.totalRounds,
        imageUrl: gameState.currentRoundData.imageUrl,
        time: ROUND_TIME
    });

    if (gameState.timer) clearInterval(gameState.timer); // Sécurité anti-doublon de chrono

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
            dist = calculateDistance(
                correct.location.lat, correct.location.lng,
                p.lastGuess.lat, p.lastGuess.lng
            );
            const distScore = Math.max(0, 2500 - Math.floor(dist));

            yearDiff = Math.abs(correct.year - p.lastGuess.year);
            const yearScore = Math.max(0, 2500 - (yearDiff * 50));

            const rawAccuracyScore = distScore + yearScore;
            
            const timeRatio = (p.guessTimeLeft || 0) / ROUND_TIME; 
            const speedMultiplier = 1.0 + timeRatio; 
            
            roundScore = Math.floor(rawAccuracyScore * speedMultiplier);
            p.score += roundScore;
            
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
    }, 30000); 
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

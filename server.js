const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Chargement des données de jeu depuis la racine
const gameData = JSON.parse(fs.readFileSync('data.json', 'utf8'));

app.use(express.static(path.join(__dirname, 'public')));

// Redirection de la racine vers l'écran principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

// Route QR Code dynamique modifiée pour accepter un ?room=CODE
app.get('/qrcode', async (req, res) => {
    try {
        const host = req.get('host'); 
        const protocol = req.protocol; 
        const room = req.query.room || 'LOBBY';
        
        const url = `${protocol}://${host}/controller.html?room=${room}`;
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

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// Stockage de TOUTES les sessions de jeu actives
// Structure : { [roomCode]: { phase, players, currentRound, ... } }
const games = {};
const ROUND_TIME = 45; 

io.on('connection', (socket) => {
    let currentRoom = null;

    // Identification du client avec son type ET son code de session
    socket.on('identify', (data) => {
        const type = typeof data === 'string' ? data : data.type;
        let room = data.room ? data.room.toUpperCase() : null;
        const name = data.name ? data.name : ('Joueur ' + socket.id.substr(0, 4));

        if (type === 'display') {
            // Création d'une nouvelle session de jeu unique
            if (!room) {
                room = generateRoomCode();
                while (games[room]) { room = generateRoomCode(); } // Évite les doublons
            }
            
            games[room] = {
                roomCode: room,
                phase: 'LOBBY', 
                players: {},
                currentRound: 0,
                totalRounds: Math.min(3, gameData.length),
                currentRoundData: null,
                timer: null,
                timeLeft: 0,
                activeRoundIndices: [],
                globalDeck: []
            };

            currentRoom = room;
            socket.join(room);
            socket.join(`${room}-display`);
            
            // On renvoie le code généré au display pour affichage
            socket.emit('roomCreated', room);
            socket.emit('updateState', games[room]);
            console.log(`🎮 Nouvelle session créée : [${room}]`);

        } else if (type === 'controller') {
            // Un joueur tente de se connecter
            if (!room || !games[room]) {
                socket.emit('errorMsg', 'Partie introuvable ou code invalide.');
                return;
            }

            const gameState = games[room];
            currentRoom = room;
            socket.join(room);

            gameState.players[socket.id] = {
                id: socket.id,
                name: name,
                score: 0,
                color: '#' + Math.floor(Math.random() * 16777215).toString(16),
                lastGuess: null
            };

            io.to(`${room}-display`).emit('playerJoined', gameState.players[socket.id]);
            socket.emit('joined', { playerData: gameState.players[socket.id], roomCode: room });

            if (gameState.phase !== 'LOBBY') {
                socket.emit('gameAlreadyStarted');
            } else {
                socket.emit('waitInLobby');
            }
        }
    });

    socket.on('updateName', (name) => {
        if (currentRoom && games[currentRoom] && games[currentRoom].players[socket.id]) {
            games[currentRoom].players[socket.id].name = name;
            io.to(`${currentRoom}-display`).emit('playerUpdated', games[currentRoom].players[socket.id]);
        }
    });

    socket.on('startGame', () => {
        if (!currentRoom || !games[currentRoom]) return;
        const gameState = games[currentRoom];

        console.log(`🚨 [${currentRoom}] Événement 'startGame' reçu.`);
        socket.emit('gameStartedAck', { totalQuestions: gameData.length });
        
        startGame(currentRoom);
    });

    socket.on('submitGuess', (guess) => {
        if (!currentRoom || !games[currentRoom]) return;
        const gameState = games[currentRoom];

        if (gameState.phase === 'ROUND' && gameState.players[socket.id]) {
            gameState.players[socket.id].lastGuess = guess;
            gameState.players[socket.id].guessTimeLeft = gameState.timeLeft; 
            io.to(`${currentRoom}-display`).emit('playerGuessed', socket.id);
            socket.emit('guessReceived');
        }
    });

    socket.on('disconnect', () => {
        if (!currentRoom || !games[currentRoom]) return;
        const gameState = games[currentRoom];

        // Si c'est un joueur qui quitte
        if (gameState.players[socket.id]) {
            delete gameState.players[socket.id];
            io.to(`${currentRoom}-display`).emit('playerLeft', socket.id);
        }

        // Optionnel : Nettoyer la mémoire si l'écran Display se déconnecte et que la room est vide
        const connectedSockets = io.sockets.adapter.rooms.get(`${currentRoom}-display`);
        if (!connectedSockets || connectedSockets.size === 0) {
            console.log(`🧹 Fermeture de la room vide : [${currentRoom}]`);
            clearInterval(gameState.timer);
            delete games[currentRoom];
        }
    });
});

// Logique de jeu encapsulée par Session (roomCode)
function startGame(roomCode) {
    const gameState = games[roomCode];
    if (!gameState) return;

    gameState.currentRound = 0;
    gameState.players = Object.fromEntries(
        Object.entries(gameState.players).map(([id, p]) => [id, { ...p, score: 0, lastGuess: null }])
    );
    
    if (gameState.globalDeck.length < gameState.totalRounds) {
        let pool = Array.from({length: gameData.length}, (_, i) => i);
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        gameState.globalDeck = gameState.globalDeck.concat(pool);
    }
    
    gameState.activeRoundIndices = gameState.globalDeck.splice(0, gameState.totalRounds);
    startRound(roomCode);
}

function startRound(roomCode) {
    const gameState = games[roomCode];
    if (!gameState) return;

    gameState.currentRound++;
    if (gameState.currentRound > gameState.totalRounds) {
        endGame(roomCode);
        return;
    }

    gameState.phase = 'ROUND';
    const dataIndex = gameState.activeRoundIndices[gameState.currentRound - 1];
    gameState.currentRoundData = gameData[dataIndex];
    gameState.timeLeft = ROUND_TIME;

    Object.keys(gameState.players).forEach(id => {
        gameState.players[id].lastGuess = null;
    });

    io.to(roomCode).emit('roundStart', {
        round: gameState.currentRound,
        total: gameState.totalRounds,
        imageUrl: gameState.currentRoundData.imageUrl,
        time: ROUND_TIME
    });

    if (gameState.timer) clearInterval(gameState.timer);

    gameState.timer = setInterval(() => {
        gameState.timeLeft--;
        io.to(roomCode).emit('timerUpdate', gameState.timeLeft);
        if (gameState.timeLeft <= 0) {
            endRound(roomCode);
        }
    }, 1000);
}

function endRound(roomCode) {
    const gameState = games[roomCode];
    if (!gameState) return;

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

    io.to(roomCode).emit('roundResult', {
        correctLocation: correct.location,
        correctYear: correct.year,
        description: correct.description,
        correctCountry: correct.country,
        playerResults: results
    });

    setTimeout(() => {
        startRound(roomCode);
    }, 10000);
}

function endGame(roomCode) {
    const gameState = games[roomCode];
    if (!gameState) return;

    gameState.phase = 'END';
    io.to(roomCode).emit('gameEnd', gameState.players);
    setTimeout(() => {
        gameState.phase = 'LOBBY';
        io.to(roomCode).emit('resetLobby');
    }, 30000); 
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

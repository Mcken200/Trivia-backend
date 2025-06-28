const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.use(cors());

// Explicit CORS headers for all routes
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://trivia-frontend-iota.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  next();
});

// Serve static files (e.g. venue.html)
app.use(express.static(path.join(__dirname, 'public')));

const io = new Server(server, {
  cors: {
    origin: ['https://trivia-frontend-iota.vercel.app'],
    methods: ['GET', 'POST'],
    credentials: false
  }
});

// Store player info
const playerMap = {};
let currentGameId = null;

io.on('connection', (socket) => {
  console.log('[Socket] New client connected:', socket.id);

  socket.on('identifyAs', (role) => {
    console.log(`[Socket] identifyAs received: ${role}`);
    socket.role = role;
  });

  socket.on('createGame', (gameId) => {
    console.log(`[Socket] Game created with ID: ${gameId}`);
    currentGameId = gameId;

    const joinUrl = `https://trivia-frontend-iota.vercel.app/player/${gameId}`;
    const qrData = `https://trivia-frontend-iota.vercel.app/player/${gameId}`;

    io.emit('showQRCode', { gameId, joinUrl, qrData });
  });

  socket.on('joinGame', ({ playerName, gameId }) => {
    console.log(`[Socket] Player joined: ${playerName} for Game ID: ${gameId}`);
    if (gameId === currentGameId) {
      playerMap[socket.id] = { id: socket.id, name: playerName };
      io.emit('playerListUpdate', playerMap);
    }
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Client disconnected:', socket.id);
    if (playerMap[socket.id]) {
      delete playerMap[socket.id];
      io.emit('playerListUpdate', playerMap);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Trivia backend running on port ${PORT}`);
});

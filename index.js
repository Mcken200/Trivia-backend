// index.js

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import path from 'path';
import cors from 'cors';

const app = express();
const server = http.createServer(app);

// 🎧 SOCKET.IO setup
const io = new Server(server, {
  cors: {
    origin: ['https://trivia-frontend-iota.vercel.app'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// ✅ ALLOW our front end to connect over CORS
app.use(cors({
  origin: ['https://trivia-frontend-iota.vercel.app'],
  credentials: true
}));

const PORT = process.env.PORT || 3000;

// Serve your static frontend + venue/host pages if any
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.send(`<h1>Trivia server is running!</h1>`);
});

app.get('/qr/:gameId', async (req, res) => {
  const gameId = req.params.gameId;
  const joinUrl = `https://trivia-frontend-iota.vercel.app/join?gameId=${gameId}`;
  try {
    const qr = await QRCode.toDataURL(joinUrl);
    res.send(`
      <h1>Scan to Join Game ${gameId}</h1>
      <img src="${qr}" />
      <p>or go to: <a href="${joinUrl}">${joinUrl}</a></p>
    `);
  } catch {
    res.status(500).send('Failed to generate QR code');
  }
});

// 🧠 In-memory game session state
const gamePlayers = {};
const pendingPlayers = {};
const deviceToGameMap = {};
const socketToDeviceMap = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('createGame', async (gameId) => {
    socket.join(gameId);
    const joinUrl = `https://trivia-frontend-iota.vercel.app/join?gameId=${gameId}`;
    const qrData = await QRCode.toDataURL(joinUrl);
    io.to(gameId).emit('showQRCode', { gameId, joinUrl, qrData });
  });

  socket.on('host_start_game', ({ gameId, joinUrl }) => {
    io.to(gameId).emit('host_start_game', { gameId, joinUrl });
  });

  socket.on('joinGame', ({ name, code, deviceId, avatar }) => {
    const room = io.sockets.adapter.rooms.get(code);
    if (!room) {
      socket.emit('errorMessage', 'Game not found');
      return;
    }

    if (!pendingPlayers[code]) pendingPlayers[code] = {};
    if (!gamePlayers[code]) gamePlayers[code] = {};

    const nameConflict = Object.values(gamePlayers[code]).some(
      p => p.name === name && p.deviceId !== deviceId
    );
    if (nameConflict) {
      socket.emit('errorMessage', 'Name taken');
      return;
    }

    pendingPlayers[code][deviceId] = { name, avatar, socketId: socket.id };
    socketToDeviceMap[socket.id] = deviceId;
    deviceToGameMap[deviceId] = code;
    socket.join(code);
    io.to(code).emit('pendingPlayerJoin', { deviceId, name, avatar });
  });

  socket.on('hostApprovePlayer', ({ deviceId, approve }) => {
    const gameId = deviceToGameMap[deviceId];
    if (!gameId || !pendingPlayers[gameId]?.[deviceId]) return;

    const player = pendingPlayers[gameId][deviceId];
    const psSocket = player.socketId;

    if (approve) {
      gamePlayers[gameId][deviceId] = {
        name: player.name,
        avatar: player.avatar,
        connected: true
      };
      io.to(gameId).emit('playerListUpdate', gamePlayers[gameId]);
      io.to(psSocket).emit('approved');
    } else {
      io.to(psSocket).emit('rejected');
    }

    delete pendingPlayers[gameId][deviceId];
  });

  socket.on('rejoinGame', ({ deviceId, code }) => {
    if (gamePlayers[code]?.[deviceId]) {
      gamePlayers[code][deviceId].connected = true;
      deviceToGameMap[deviceId] = code;
      socketToDeviceMap[socket.id] = deviceId;
      socket.join(code);
      io.to(code).emit('playerListUpdate', gamePlayers[code]);
    } else {
      socket.emit('errorMessage', 'Unable to rejoin');
    }
  });

  socket.on('disconnect', () => {
    const deviceId = socketToDeviceMap[socket.id];
    const gameId = deviceToGameMap[deviceId];
    if (gamePlayers[gameId]?.[deviceId]) {
      gamePlayers[gameId][deviceId].connected = false;
      io.to(gameId).emit('playerListUpdate', gamePlayers[gameId]);
    }
    delete socketToDeviceMap[socket.id];
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

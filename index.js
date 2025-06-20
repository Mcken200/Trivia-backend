import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const gamePlayers = {};
const deviceToGameMap = {};
const socketToDeviceMap = {};
let latestGameId = null;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'venue.html'));
});

app.get('/qr/:gameId', async (req, res) => {
  const gameId = req.params.gameId;
  const url = `https://trivia-frontend-iota.vercel.app/join?gameId=${gameId}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.send(`
      <h1>Scan to Join Game ${gameId}</h1>
      <img src="${qr}" />
      <p>or go to: <a href="${url}">${url}</a></p>
    `);
  } catch (err) {
    res.status(500).send('Failed to generate QR code');
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Let each client identify its role (host, venue, player)
  socket.on('identifyAs', (role) => {
    socket.role = role;
    console.log(`Socket ${socket.id} identified as ${role}`);
  });

  socket.on('createGame', async (gameId) => {
    latestGameId = gameId;
    socket.join(gameId);
    console.log(`Host ${socket.id} created game ${gameId}`);

    // Track host behind the scenes
    const hostId = `host-${socket.id}`;
    if (!gamePlayers[gameId]) gamePlayers[gameId] = {};
    gamePlayers[gameId][hostId] = { name: '__HOST__', connected: true };

    deviceToGameMap[hostId] = gameId;
    socketToDeviceMap[socket.id] = hostId;

    const joinUrl = `https://trivia-frontend-iota.vercel.app/join?gameId=${gameId}`;
    const qrData = await QRCode.toDataURL(joinUrl);

    // Send QR code to all connected venue clients
    io.sockets.sockets.forEach((s) => {
      if (s.role === 'venue') {
        s.emit('showQRCode', { gameId, joinUrl, qrData });
      }
    });
  });

  socket.on('host_start_game', ({ gameId, joinUrl }) => {
    console.log(`Host ${socket.id} started the game ${gameId}`);
    io.emit('host_start_game', { gameId, joinUrl });
  });

  socket.on('joinGame', ({ name, code, deviceId }) => {
    const room = io.sockets.adapter.rooms.get(code);
    if (!room) {
      socket.emit('errorMessage', 'Game not found');
      return;
    }

    if (!gamePlayers[code]) gamePlayers[code] = {};

    const nameTaken = Object.values(gamePlayers[code]).some(
      (p) => p.name === name && p.deviceId !== deviceId
    );
    if (nameTaken) {
      socket.emit('errorMessage', 'Name taken');
      return;
    }

    gamePlayers[code][deviceId] = { name: name, connected: true };
    deviceToGameMap[deviceId] = code;
    socketToDeviceMap[socket.id] = deviceId;
    socket.join(code);

    console.log(`[${socket.id}] JOINED: ${name} (${deviceId}) to game ${code}`);
    emitFilteredPlayerList(code);
  });

  socket.on('rejoinGame', ({ deviceId, code }) => {
    if (
      deviceId &&
      code &&
      gamePlayers[code] &&
      gamePlayers[code][deviceId]
    ) {
      console.log(`[${socket.id}] REJOINING: ${deviceId}, ${code}`);
      gamePlayers[code][deviceId].connected = true;
      deviceToGameMap[deviceId] = code;
      socketToDeviceMap[socket.id] = deviceId;
      socket.join(code);
      emitFilteredPlayerList(code);
    } else {
      socket.emit('errorMessage', 'Unable to rejoin');
    }
  });

  socket.on('disconnect', () => {
    const deviceId = socketToDeviceMap[socket.id];
    const gameId = deviceToGameMap[deviceId];

    if (
      deviceId &&
      gameId &&
      gamePlayers[gameId] &&
      gamePlayers[gameId][deviceId]
    ) {
      gamePlayers[gameId][deviceId].connected = false;
      emitFilteredPlayerList(gameId);
    }

    delete socketToDeviceMap[socket.id];
  });

  function emitFilteredPlayerList(gameId) {
    if (!gamePlayers[gameId]) return;

    const filtered = Object.fromEntries(
      Object.entries(gamePlayers[gameId]).filter(
        ([deviceId, player]) => player.name !== '__HOST__'
      )
    );

    io.to(gameId).emit('playerListUpdate', filtered);
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

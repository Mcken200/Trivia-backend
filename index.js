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

// 👉 Serve venue screen (real-time HTML)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'venue.html'));
});

// 👉 QR generation (optional, for static viewing or debug)
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

  // ✅ Host starts a game
  socket.on('createGame', async (gameId) => {
    latestGameId = gameId;
    socket.join(gameId);
    console.log(`Host ${socket.id} created game ${gameId}`);

    const joinUrl = `https://trivia-frontend-iota.vercel.app/join?gameId=${gameId}`;
    const qrData = await QRCode.toDataURL(joinUrl);

    // ✅ Emit to all "venue" clients to show the new QR
    io.emit('showQRCode', { gameId, joinUrl, qrData });
  });

  // ✅ Host broadcasts game start
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
    io.to(code).emit('playerListUpdate', gamePlayers[code]);
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
      io.to(code).emit('playerListUpdate', gamePlayers[code]);
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
      io.to(gameId).emit('playerListUpdate', gamePlayers[gameId]);
    }

    delete socketToDeviceMap[socket.id];
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

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
  res.send('Trivia backend is running!');
});

// ✅ Hardcoded URL to Vercel frontend deployment
app.get('/qr/:gameId', async (req, res) => {
  const gameId = req.params.gameId;
  const url = `https://trivia-frontend-y1m4.vercel.app/join?gameId=${gameId}`;
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

  socket.on('createGame', (gameId) => {
    socket.join(gameId);
    console.log(`Host ${socket.id} created game ${gameId}`);
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
    io.to(code).emit('playerListUpdate', gamePlayers[code]);
  });

  socket.on('rejoinGame', ({ deviceId, code }) => {
    if (
      deviceId &&
      code &&
      gamePlayers[code] &&
      gamePlayers[code][deviceId]
    ) {
      console.log(`[${socket.id}] REJOINING: deviceId=${deviceId}, game=${code}, name=${gamePlayers[code][deviceId].name}`);

      gamePlayers[code][deviceId].connected = true;
      deviceToGameMap[deviceId] = code;
      socketToDeviceMap[socket.id] = deviceId;
      socket.join(code);

      io.to(code).emit('playerListUpdate', gamePlayers[code]);
    } else {
      console.log(`[${socket.id}] Failed REJOIN: deviceId=${deviceId}, game=${code}`);
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

      console.log(
        `[${socket.id}] DISCONNECTED: ${gamePlayers[gameId][deviceId].name || 'Unknown'} (${deviceId}) from game ${gameId}`
      );

      io.to(gameId).emit('playerListUpdate', gamePlayers[gameId]);
    }

    delete socketToDeviceMap[socket.id];
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
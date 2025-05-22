const QRCode = require('qrcode');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve files from the "public" folder (we’ll add one soon)
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.send('Trivia server is running!');
  app.get('/qr/:gameId', async (req, res) => {
    const gameId = req.params.gameId;
    const url = `${req.protocol}://${req.get('host')}/join.html?code=${gameId}`;

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
});

// Socket.IO real-time connection
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Host creates a game
    socket.on('createGame', (gameId) => {
      socket.join(gameId);
      console.log(`Host ${socket.id} created game ${gameId}`);
    });

    // Host triggers the display to show QR code
    socket.on('host_start_game', ({ gameId, joinUrl }) => {
      console.log(`Host ${socket.id} started the game ${gameId}`);
      socket.broadcast.emit('host_start_game', { gameId, joinUrl });
    });

    // Player joins a game
    socket.on('joinGame', ({ name, code }) => {
      const room = io.sockets.adapter.rooms.get(code);
      if (room) {
        socket.join(code);
        console.log(`Player ${name} joined game ${code}`);
        io.to(code).emit('playerJoined', { name });
      } else {
        socket.emit('errorMessage', 'Game code not found');
      }
    });

    //User disconnects
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });

server.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      'https://trivia-frontend-iota.vercel.app',
      'https://trivia-frontend.vercel.app'
    ],
    methods: ['GET', 'POST'],
    credentials: false,
  },
});

app.use(cors());

// Serve static venue.html
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.send('Trivia server is running!');
});

io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  socket.on('identifyAs', (role) => {
    if (role === 'host') {
      console.log('🎮 Host connected:', socket.id);
    } else if (role === 'player') {
      console.log('👤 Player connected:', socket.id);
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// File paths
const USERS_FILE = path.join(__dirname, 'users.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const GROUPS_FILE = path.join(__dirname, 'groups.json');

// Helper functions for file storage
function readData(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const JWT_SECRET = 'your_jwt_secret'; // Change this to a strong secret in production

const app = express();
const server = http.createServer(app);
const FRONTEND_URL = 'https://chat-application-1-gznm.onrender.com';
const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST']
  }
});

app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

let onlineUsers = new Set();

// --- Socket.IO events ---
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Send chat history to new user
  const history = readData(MESSAGES_FILE, []);
  socket.emit('chat history', history.slice(-100));

  socket.on('chat message', (msg) => {
    const messages = readData(MESSAGES_FILE, []);
    messages.push(msg);
    writeData(MESSAGES_FILE, messages);
    io.emit('chat message', msg);
  });

  socket.on('private message', (msg) => {
    console.log(`[PRIVATE MESSAGE] from: ${msg.from} to: ${msg.to} text: ${msg.text}`);
    const messages = readData(MESSAGES_FILE, []);
    messages.push(msg);
    writeData(MESSAGES_FILE, messages);
    io.to(msg.from).emit('private message', msg);
    io.to(msg.to).emit('private message', msg);
    console.log(`[PRIVATE MESSAGE] delivered to rooms: ${msg.from}, ${msg.to}`);
  });

  // Typing indicators for private chats
  socket.on('typing', ({ from, to }) => {
    io.to(to).emit('typing', { from });
  });
  socket.on('stop typing', ({ from, to }) => {
    io.to(to).emit('stop typing', { from });
  });

  // Typing indicators for group chats
  socket.on('typing-group', ({ from, group }) => {
    socket.to(group).emit('typing-group', { from, group });
  });
  socket.on('stop typing-group', ({ from, group }) => {
    socket.to(group).emit('stop typing-group', { from, group });
  });

  // Read receipts for private messages
  socket.on('read-message', ({ from, to }) => {
    const messages = readData(MESSAGES_FILE, []);
    let updated = false;
    messages.forEach(msg => {
      if (msg.from === from && msg.to === to && (!msg.readBy || !msg.readBy.includes(to))) {
        msg.readBy = msg.readBy || [];
        msg.readBy.push(to);
        updated = true;
      }
    });
    if (updated) writeData(MESSAGES_FILE, messages);
    io.to(from).emit('message-read', { by: to });
    io.to(to).emit('message-read', { by: to });
  });
  // Read receipts for group messages
  socket.on('read-group-message', ({ group, username }) => {
    const messages = readData(MESSAGES_FILE, []);
    let updated = false;
    messages.forEach(msg => {
      if (msg.group === group && (!msg.readBy || !msg.readBy.includes(username))) {
        msg.readBy = msg.readBy || [];
        msg.readBy.push(username);
        updated = true;
      }
    });
    if (updated) writeData(MESSAGES_FILE, messages);
    io.to(group).emit('group-message-read', { by: username });
  });

  // Join a room for the user's username (for private messaging)
  socket.on('join', (username) => {
    socket.join(username);
  });

  socket.on('join-group', (group) => {
    socket.join(group);
  });
  socket.on('group message', (msg) => {
    const messages = readData(MESSAGES_FILE, []);
    messages.push(msg);
    writeData(MESSAGES_FILE, messages);
    io.to(msg.group).emit('group message', msg);
  });

  // User presence: join event with username
  socket.on('presence', (username) => {
    onlineUsers.add(username);
    io.emit('presence-update', Array.from(onlineUsers));
    socket.username = username;
  });

  // Socket events for reactions
  socket.on('react', ({ messageId, user, emoji }) => {
    const messages = readData(MESSAGES_FILE, []);
    const msg = messages.find(m => m._id === messageId);
    if (msg && (!msg.reactions || !msg.reactions.some(r => r.user === user && r.emoji === emoji))) {
      msg.reactions = msg.reactions || [];
      msg.reactions.push({ user, emoji });
      writeData(MESSAGES_FILE, messages);
      io.emit('reaction', { messageId, reactions: msg.reactions });
    }
  });
  socket.on('unreact', ({ messageId, user, emoji }) => {
    const messages = readData(MESSAGES_FILE, []);
    const msg = messages.find(m => m._id === messageId);
    if (msg) {
      msg.reactions = (msg.reactions || []).filter(r => !(r.user === user && r.emoji === emoji));
      writeData(MESSAGES_FILE, messages);
      io.emit('reaction', { messageId, reactions: msg.reactions });
    }
  });
  // Socket event for replies
  socket.on('reply', ({ replyTo, ...msgData }) => {
    const messages = readData(MESSAGES_FILE, []);
    const reply = { ...msgData, replyTo };
    messages.push(reply);
    writeData(MESSAGES_FILE, messages);
    io.emit('reply', reply);
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      onlineUsers.delete(socket.username);
      io.emit('presence-update', Array.from(onlineUsers));
    }
    console.log('User disconnected:', socket.id);
  });
});

// --- REST API endpoints ---

// Register endpoint
app.post('/api/register', (req, res) => {
  const { username, password, avatar } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const users = readData(USERS_FILE, []);
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  const hashed = bcrypt.hashSync(password, 10);
  const user = { username, password: hashed, avatar };
  users.push(user);
  writeData(USERS_FILE, users);
  res.json({ message: 'User registered successfully' });
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const users = readData(USERS_FILE, []);
  const user = users.find(u => u.username === username);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const match = bcrypt.compareSync(password, user.password);
  if (!match) return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ username: user.username, avatar: user.avatar }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { username: user.username, avatar: user.avatar } });
});

// User list endpoint (excluding self)
app.get('/api/users', (req, res) => {
  const { username } = req.query;
  const users = readData(USERS_FILE, []);
  res.json(users.filter(u => u.username !== username));
});

// Private chat history endpoint
app.get('/api/messages/:user1/:user2', (req, res) => {
  const { user1, user2 } = req.params;
  const messages = readData(MESSAGES_FILE, []);
  const filtered = messages.filter(m =>
    (m.from === user1 && m.to === user2) || (m.from === user2 && m.to === user1)
  );
  res.json(filtered.slice(-100));
});

// Create group
app.post('/api/groups', (req, res) => {
  const { name, avatar, admin } = req.body;
  if (!name || !admin) return res.status(400).json({ error: 'Name and admin required' });
  const groups = readData(GROUPS_FILE, []);
  if (groups.find(g => g.name === name)) {
    return res.status(400).json({ error: 'Group already exists' });
  }
  const group = { name, avatar, members: [admin], admin };
  groups.push(group);
  writeData(GROUPS_FILE, groups);
  res.json(group);
});

// Join group
app.post('/api/groups/join', (req, res) => {
  const { name, username } = req.body;
  if (!name || !username) return res.status(400).json({ error: 'Name and username required' });
  const groups = readData(GROUPS_FILE, []);
  const group = groups.find(g => g.name === name);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.members.includes(username)) {
    group.members.push(username);
    writeData(GROUPS_FILE, groups);
  }
  res.json(group);
});

// List groups (optionally filter by member)
app.get('/api/groups', (req, res) => {
  const { username } = req.query;
  const groups = readData(GROUPS_FILE, []);
  if (username) {
    res.json(groups.filter(g => g.members.includes(username)));
  } else {
    res.json(groups);
  }
});

// Get group messages
app.get('/api/group-messages/:group', (req, res) => {
  const { group } = req.params;
  const messages = readData(MESSAGES_FILE, []);
  const filtered = messages.filter(m => m.group === group);
  res.json(filtered.slice(-100));
});

// Add reaction
app.post('/api/messages/:id/react', (req, res) => {
  const { user, emoji } = req.body;
  const messages = readData(MESSAGES_FILE, []);
  const msg = messages.find(m => m._id === req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  msg.reactions = msg.reactions || [];
  if (!msg.reactions.some(r => r.user === user && r.emoji === emoji)) {
    msg.reactions.push({ user, emoji });
    writeData(MESSAGES_FILE, messages);
  }
  io.emit('reaction', { messageId: msg._id, reactions: msg.reactions });
  res.json(msg);
});
// Remove reaction
app.post('/api/messages/:id/unreact', (req, res) => {
  const { user, emoji } = req.body;
  const messages = readData(MESSAGES_FILE, []);
  const msg = messages.find(m => m._id === req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  msg.reactions = (msg.reactions || []).filter(r => !(r.user === user && r.emoji === emoji));
  writeData(MESSAGES_FILE, messages);
  io.emit('reaction', { messageId: msg._id, reactions: msg.reactions });
  res.json(msg);
});
// Post a reply
app.post('/api/messages/:id/reply', (req, res) => {
  const { from, to, group, text, color, avatar, time } = req.body;
  const messages = readData(MESSAGES_FILE, []);
  const reply = { from, to, group, text, color, avatar, time, replyTo: req.params.id };
  messages.push(reply);
  writeData(MESSAGES_FILE, messages);
  io.emit('reply', reply);
  res.json(reply);
});
// Fetch replies for a message
app.get('/api/messages/:id/replies', (req, res) => {
  const messages = readData(MESSAGES_FILE, []);
  const replies = messages.filter(m => m.replyTo === req.params.id);
  res.json(replies);
});

// Endpoint to get current online users
app.get('/api/online-users', (req, res) => {
  res.json(Array.from(onlineUsers));
});

app.get('/', (req, res) => {
  res.send('Chat server is running');
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
}); 
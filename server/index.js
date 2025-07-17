const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/chatapp', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const GroupSchema = new mongoose.Schema({
  name: { type: String, unique: true, required: true },
  avatar: String,
  members: [String], // usernames
  admin: String,
});
const Group = mongoose.model('Group', GroupSchema);

// Update MessageSchema to support group messages
const MessageSchema = new mongoose.Schema({
  from: { type: String },
  to: { type: String }, // for private
  group: { type: String }, // group name
  text: String,
  color: String,
  avatar: String,
  time: String,
  readBy: [String], // usernames who have read the message
  reactions: [{ user: String, emoji: String }],
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  sticker: String, // <-- Added for sticker support
}, { timestamps: true });
const Message = mongoose.model('Message', MessageSchema);

const JWT_SECRET = 'your_jwt_secret'; // Change this to a strong secret in production

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  avatar: String,
});
const User = mongoose.model('User', UserSchema);

const app = express();
const server = http.createServer(app);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL, // Allow deployed frontend
    methods: ['GET', 'POST']
  }
});

app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

let onlineUsers = new Set();

io.on('connection', async (socket) => {
  console.log('A user connected:', socket.id);

  // Send chat history to new user
  const history = await Message.find({}).sort({ createdAt: 1 }).limit(100);
  socket.emit('chat history', history);

  socket.on('chat message', async (msg) => {
    // Save message to DB
    const savedMsg = await Message.create(msg);
    io.emit('chat message', savedMsg); // Broadcast to all clients
  });

  socket.on('private message', async (msg) => {
    // msg: { from, to, text, color, avatar, time }
    console.log(`[PRIVATE MESSAGE] from: ${msg.from} to: ${msg.to} text: ${msg.text}`);
    const savedMsg = await Message.create(msg);
    // Emit to both sender and recipient if online
    io.to(msg.from).emit('private message', savedMsg);
    io.to(msg.to).emit('private message', savedMsg);
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
  socket.on('read-message', async ({ from, to }) => {
    const unread = await Message.find({ from, to, readBy: { $ne: to } });
    for (const msg of unread) {
      msg.readBy.push(to);
      await msg.save();
      io.to(from).emit('message-read', { _id: msg._id, by: to });
      io.to(to).emit('message-read', { _id: msg._id, by: to });
    }
  });
  // Read receipts for group messages
  socket.on('read-group-message', async ({ group, username }) => {
    const unread = await Message.find({ group, readBy: { $ne: username } });
    for (const msg of unread) {
      msg.readBy.push(username);
      await msg.save();
      io.to(group).emit('group-message-read', { _id: msg._id, by: username });
    }
  });

  // Join a room for the user's username (for private messaging)
  socket.on('join', (username) => {
    socket.join(username);
  });

  socket.on('join-group', (group) => {
    socket.join(group);
  });
  socket.on('group message', async (msg) => {
    // msg: { from, group, text, color, avatar, time }
    const savedMsg = await Message.create(msg);
    io.to(msg.group).emit('group message', savedMsg);
  });

  // User presence: join event with username
  socket.on('presence', (username) => {
    onlineUsers.add(username);
    io.emit('presence-update', Array.from(onlineUsers));
    socket.username = username;
  });

  // Socket events for reactions
  socket.on('react', async ({ messageId, user, emoji }) => {
    const msg = await Message.findById(messageId);
    if (msg && !msg.reactions.some(r => r.user === user && r.emoji === emoji)) {
      msg.reactions.push({ user, emoji });
      await msg.save();
      io.emit('reaction', { messageId, reactions: msg.reactions });
    }
  });
  socket.on('unreact', async ({ messageId, user, emoji }) => {
    const msg = await Message.findById(messageId);
    if (msg) {
      msg.reactions = msg.reactions.filter(r => !(r.user === user && r.emoji === emoji));
      await msg.save();
      io.emit('reaction', { messageId, reactions: msg.reactions });
    }
  });
  // Socket event for replies
  socket.on('reply', async ({ replyTo, ...msgData }) => {
    const reply = await Message.create({ ...msgData, replyTo });
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

// Register endpoint
app.post('/api/register', async (req, res) => {
  const { username, password, avatar } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ error: 'Username already exists' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashed, avatar });
    res.json({ message: 'User registered successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id, username: user.username, avatar: user.avatar }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { username: user.username, avatar: user.avatar } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// User list endpoint (excluding self)
app.get('/api/users', async (req, res) => {
  const { username } = req.query;
  const users = await User.find(username ? { username: { $ne: username } } : {}, 'username avatar');
  res.json(users);
});

// Private chat history endpoint
app.get('/api/messages/:user1/:user2', async (req, res) => {
  const { user1, user2 } = req.params;
  const messages = await Message.find({
    $or: [
      { from: user1, to: user2 },
      { from: user2, to: user1 }
    ]
  }).sort({ createdAt: 1 }).limit(100);
  res.json(messages);
});

// Create group
app.post('/api/groups', async (req, res) => {
  const { name, avatar, admin } = req.body;
  if (!name || !admin) return res.status(400).json({ error: 'Name and admin required' });
  try {
    const group = await Group.create({ name, avatar, members: [admin], admin });
    res.json(group);
  } catch (err) {
    res.status(500).json({ error: 'Group creation failed' });
  }
});

// Join group
app.post('/api/groups/join', async (req, res) => {
  const { name, username } = req.body;
  if (!name || !username) return res.status(400).json({ error: 'Name and username required' });
  try {
    const group = await Group.findOne({ name });
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!group.members.includes(username)) {
      group.members.push(username);
      await group.save();
    }
    res.json(group);
  } catch (err) {
    res.status(500).json({ error: 'Join group failed' });
  }
});

// List groups (optionally filter by member)
app.get('/api/groups', async (req, res) => {
  const { username } = req.query;
  let groups;
  if (username) {
    groups = await Group.find({ members: username });
  } else {
    groups = await Group.find();
  }
  res.json(groups);
});

// Get group messages
app.get('/api/group-messages/:group', async (req, res) => {
  const { group } = req.params;
  const messages = await Message.find({ group }).sort({ createdAt: 1 }).limit(100);
  res.json(messages);
});

// Add reaction
app.post('/api/messages/:id/react', async (req, res) => {
  const { user, emoji } = req.body;
  const msg = await Message.findById(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (!msg.reactions.some(r => r.user === user && r.emoji === emoji)) {
    msg.reactions.push({ user, emoji });
    await msg.save();
  }
  io.emit('reaction', { messageId: msg._id, reactions: msg.reactions });
  res.json(msg);
});
// Remove reaction
app.post('/api/messages/:id/unreact', async (req, res) => {
  const { user, emoji } = req.body;
  const msg = await Message.findById(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  msg.reactions = msg.reactions.filter(r => !(r.user === user && r.emoji === emoji));
  await msg.save();
  io.emit('reaction', { messageId: msg._id, reactions: msg.reactions });
  res.json(msg);
});
// Post a reply
app.post('/api/messages/:id/reply', async (req, res) => {
  const { from, to, group, text, color, avatar, time } = req.body;
  const reply = await Message.create({ from, to, group, text, color, avatar, time, replyTo: req.params.id });
  io.emit('reply', reply);
  res.json(reply);
});
// Fetch replies for a message
app.get('/api/messages/:id/replies', async (req, res) => {
  const replies = await Message.find({ replyTo: req.params.id }).sort({ createdAt: 1 });
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
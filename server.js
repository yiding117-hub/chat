require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const http = require('http');
const { Server } = require('socket.io');
const webpush = require('web-push');
const { pool, init } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

webpush.setVapidDetails(
  process.env.VAPID_CONTACT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }, // 30 days
});
app.use(sessionMiddleware);

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });
}

// ---- Auth ----

app.post('/api/signup', asyncRoute(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 2 || password.length < 4) {
    return res.status(400).json({ error: 'Username (2+ chars) and password (4+ chars) required' });
  }
  const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.rows.length) return res.status(409).json({ error: 'Username already taken' });

  const hash = bcrypt.hashSync(password, 10);
  const result = await pool.query(
    'INSERT INTO users (username, password_hash, created_at) VALUES ($1, $2, $3) RETURNING id',
    [username, hash, Date.now()]
  );

  req.session.userId = result.rows[0].id;
  req.session.username = username;
  res.json({ id: result.rows[0].id, username });
}));

app.post('/api/login', asyncRoute(async (req, res) => {
  const { username, password } = req.body || {};
  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = result.rows[0];
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ id: user.id, username: user.username });
}));

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  res.json({ user: { id: req.session.userId, username: req.session.username } });
});

// ---- Push subscriptions ----

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/subscribe', requireAuth, asyncRoute(async (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, subscription_json, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET subscription_json = EXCLUDED.subscription_json`,
    [req.session.userId, sub.endpoint, JSON.stringify(sub), Date.now()]
  );
  res.json({ ok: true });
}));

app.post('/api/unsubscribe', requireAuth, asyncRoute(async (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  res.json({ ok: true });
}));

// ---- Messages ----

app.get('/api/messages', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT id, user_id, username, body, created_at FROM messages ORDER BY id DESC LIMIT 100'
  );
  res.json({ messages: result.rows.reverse() });
}));

async function broadcastPush(message, excludeUserId) {
  const result = await pool.query('SELECT * FROM push_subscriptions WHERE user_id != $1', [excludeUserId]);

  const payload = JSON.stringify({
    title: message.username,
    body: message.body,
    url: '/',
  });

  for (const row of result.rows) {
    const subscription = JSON.parse(row.subscription_json);
    webpush.sendNotification(subscription, payload).catch((err) => {
      if (err.statusCode === 404 || err.statusCode === 410) {
        pool.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]).catch(console.error);
      } else {
        console.error('Push error:', err.message);
      }
    });
  }
}

async function saveAndBroadcastMessage({ userId, username, body }) {
  const createdAt = Date.now();
  const result = await pool.query(
    'INSERT INTO messages (user_id, username, body, created_at) VALUES ($1, $2, $3, $4) RETURNING id',
    [userId, username, body, createdAt]
  );

  const message = {
    id: result.rows[0].id,
    user_id: userId,
    username,
    body,
    created_at: createdAt,
  };

  io.emit('message', message);
  broadcastPush(message, userId).catch(console.error);
  return message;
}

// ---- Socket.io (live chat while page is open) ----

io.engine.use(sessionMiddleware);

io.use((socket, next) => {
  const session = socket.request.session;
  if (!session || !session.userId) return next(new Error('unauthorized'));
  socket.userId = session.userId;
  socket.username = session.username;
  next();
});

io.on('connection', (socket) => {
  socket.on('message', (body) => {
    if (typeof body !== 'string' || !body.trim() || body.length > 2000) return;
    saveAndBroadcastMessage({ userId: socket.userId, username: socket.username, body: body.trim() }).catch(
      console.error
    );
  });
});

const PORT = process.env.PORT || 3000;

init()
  .then(() => {
    server.listen(PORT, () => console.log(`Listening on :${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

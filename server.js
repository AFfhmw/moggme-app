const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// In-memory storage (resets on restart, acceptable for free tier)
const scores = []; // {psl, symmetry, ts}
const heartbeats = new Map(); // sessionId -> lastSeen timestamp
const serverUsers = new Map(); // id -> {id, nickname, elo, wins, losses, last_psl, metrics, updated}

// Save a face analysis score
app.post('/api/score', (req, res) => {
  const { psl, symmetry } = req.body;
  if (typeof psl !== 'number' || psl < 0 || psl > 10) return res.json({ ok: false });
  scores.push({ psl, symmetry: symmetry || 0, ts: Date.now() });
  // Keep last 10000 scores
  if (scores.length > 10000) scores.splice(0, scores.length - 10000);
  res.json({ ok: true, total: scores.length });
});

// Get stats: average PSL, total measurements, total unique users
app.get('/api/stats', (req, res) => {
  const total = scores.length;
  if (total === 0) return res.json({ ok: true, avgPsl: 0, total: 0, totalUsers: serverUsers.size });
  const sum = scores.reduce((a, s) => a + s.psl, 0);
  const avgPsl = Math.round(sum / total * 10) / 10;
  res.json({ ok: true, avgPsl, total, totalUsers: serverUsers.size });
});

// Heartbeat: client pings every 30s
app.post('/api/heartbeat', (req, res) => {
  const { sid } = req.body;
  if (!sid) return res.json({ ok: false });
  heartbeats.set(sid, Date.now());
  // Cleanup old heartbeats (>90s)
  const now = Date.now();
  for (const [k, v] of heartbeats) {
    if (now - v > 90000) heartbeats.delete(k);
  }
  res.json({ ok: true, online: heartbeats.size });
});

// Get online count
app.get('/api/online', (req, res) => {
  const now = Date.now();
  let count = 0;
  for (const [k, v] of heartbeats) {
    if (now - v < 90000) count++;
  }
  res.json({ ok: true, online: count });
});

// === SERVER-SIDE USER LEADERBOARD ===
// Sync user data to server (called on register, login, analysis, battle)
app.post('/api/user/sync', (req, res) => {
  const { id, nickname, elo, wins, losses, last_psl, metrics } = req.body;
  if (!id || !nickname) return res.json({ ok: false });
  serverUsers.set(id, {
    id, nickname,
    elo: elo || 1000,
    wins: wins || 0,
    losses: losses || 0,
    last_psl: last_psl || 0,
    metrics: metrics || {},
    updated: Date.now()
  });
  res.json({ ok: true });
});

// Get server leaderboard
app.get('/api/leaderboard', (req, res) => {
  const users = Array.from(serverUsers.values());
  res.json({ ok: true, users });
});

// Get all PSL scores for percentile calculation
app.get('/api/percentile', (req, res) => {
  const allPsl = Array.from(serverUsers.values())
    .map(u => u.last_psl)
    .filter(p => p > 0)
    .sort((a, b) => a - b);
  // Also include anonymous scores from server
  scores.forEach(s => { if (s.psl > 0) allPsl.push(s.psl); });
  allPsl.sort((a, b) => a - b);
  res.json({ ok: true, pslValues: allPsl, total: allPsl.length });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`moggme running on port ${PORT}`);
});

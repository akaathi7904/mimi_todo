/**
 * ============================================================================
 * MIMI - NODE.JS EXPRESS LOCAL DATABASE SERVER
 * ============================================================================
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Default initial database template
const DEFAULT_TAGS = [
  { id: 'work', name: 'Work', color: 'var(--tag-work)', bg: 'var(--tag-work-bg)', icon: '💼' },
  { id: 'personal', name: 'Personal', color: 'var(--tag-personal)', bg: 'var(--tag-personal-bg)', icon: '🌸' },
  { id: 'study', name: 'Study', color: 'var(--tag-study)', bg: 'var(--tag-study-bg)', icon: '📚' },
  { id: 'health', name: 'Health', color: 'var(--tag-health)', bg: 'var(--tag-health-bg)', icon: '🧘' },
  { id: 'creative', name: 'Creative', color: 'var(--tag-creative)', bg: 'var(--tag-creative-bg)', icon: '🎨' }
];

const initialDB = {
  tasks: [],
  theme: 'blossom',
  soundEnabled: true,
  streak: { count: 0, lastDate: '' },
  focusMinutesToday: 0,
  tags: DEFAULT_TAGS,
  lastUpdated: new Date().toISOString()
};

// Database Read / Write Helpers
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      writeDB(initialDB);
      return initialDB;
    }
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading database file:', err);
    return initialDB;
  }
}

function writeDB(data) {
  try {
    data.lastUpdated = new Date().toISOString();
    // Atomic safe write
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
    return true;
  } catch (err) {
    console.error('Error writing database file:', err);
    return false;
  }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ------------------- REST API ENDPOINTS -------------------

// 1. Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    app: 'Mimi Server',
    version: '2.0.0',
    time: new Date().toISOString()
  });
});

// 2. Get Full State
app.get('/api/state', (req, res) => {
  const db = readDB();
  res.json(db);
});

// 3. Save / Overwrite Full State
app.post('/api/state', (req, res) => {
  const newState = req.body;
  if (!newState || typeof newState !== 'object') {
    return res.status(400).json({ error: 'Invalid state payload' });
  }

  const currentDB = readDB();
  const merged = { ...currentDB, ...newState, lastUpdated: new Date().toISOString() };
  writeDB(merged);
  res.json({ success: true, message: 'State saved successfully', lastUpdated: merged.lastUpdated });
});

// 4. Get All Tasks
app.get('/api/tasks', (req, res) => {
  const db = readDB();
  res.json(db.tasks || []);
});

// 5. Create New Task
app.post('/api/tasks', (req, res) => {
  const task = req.body;
  if (!task || !task.title) {
    return res.status(400).json({ error: 'Task title is required' });
  }

  const db = readDB();
  if (!task.id) {
    task.id = 'task_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  task.createdAt = task.createdAt || new Date().toISOString();

  db.tasks = db.tasks || [];
  db.tasks.unshift(task);
  writeDB(db);

  res.status(201).json({ success: true, task });
});

// 6. Update Task By ID
app.put('/api/tasks/:id', (req, res) => {
  const taskId = req.params.id;
  const updates = req.body;

  const db = readDB();
  db.tasks = db.tasks || [];
  const idx = db.tasks.findIndex(t => t.id === taskId);

  if (idx === -1) {
    return res.status(404).json({ error: 'Task not found' });
  }

  db.tasks[idx] = { ...db.tasks[idx], ...updates, updatedAt: new Date().toISOString() };
  writeDB(db);

  res.json({ success: true, task: db.tasks[idx] });
});

// 7. Delete Task By ID
app.delete('/api/tasks/:id', (req, res) => {
  const taskId = req.params.id;
  const db = readDB();
  db.tasks = db.tasks || [];
  const initialLength = db.tasks.length;

  db.tasks = db.tasks.filter(t => t.id !== taskId);

  if (db.tasks.length === initialLength) {
    return res.status(404).json({ error: 'Task not found' });
  }

  writeDB(db);
  res.json({ success: true, message: 'Task deleted successfully' });
});

// 8. Smart Sync (Bidirectional Offline-First Sync)
app.post('/api/sync', (req, res) => {
  const clientData = req.body;
  const db = readDB();

  if (clientData && Array.isArray(clientData.tasks)) {
    // Merge tasks: union with newer timestamp priority
    const taskMap = new Map();
    (db.tasks || []).forEach(t => taskMap.set(t.id, t));

    clientData.tasks.forEach(t => {
      taskMap.set(t.id, t);
    });

    db.tasks = Array.from(taskMap.values());
    if (clientData.streak) db.streak = clientData.streak;
    if (clientData.focusMinutesToday !== undefined) db.focusMinutesToday = clientData.focusMinutesToday;
    if (clientData.theme) db.theme = clientData.theme;

    writeDB(db);
  }

  res.json({ success: true, state: db });
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server with Automatic Port Retry
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`
  =======================================================
  🌸 Mimi — Local Database Server Running!
  =======================================================
  🌐 Local URL:   http://localhost:${port}
  📁 Database:    ${DB_FILE}
  ⏰ Status:      Online & Ready to Sync
  =======================================================
    `);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️ Port ${port} is currently in use, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(Number(PORT));

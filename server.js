const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 4001;
const DATA_FILE = path.join(__dirname, 'data', 'licenses.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MACHINES = parseInt(process.env.MAX_MACHINES || '1', 10);
const DEFAULT_DURATION_DAYS = parseInt(process.env.LICENSE_DEFAULT_DAYS || '365', 10);

const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const KEY_PREFIX = 'LX-';
const KEY_SEGMENTS = [4, 4, 4, 4];

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

function generateKey() {
  let segments = KEY_SEGMENTS.map(len => {
    let s = '';
    for (let i = 0; i < len; i++) s += CHARSET[crypto.randomInt(CHARSET.length)];
    return s;
  });
  return KEY_PREFIX + segments.join('-');
}

function loadStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { licenses: [], admins: {} };
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to load store:', e.message);
    return { licenses: [], admins: {} };
  }
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function todayISO() {
  return new Date().toISOString();
}

function addDaysISO(days) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

function nowMs() {
  return Date.now();
}

const store = loadStore();

function findLicense(key) {
  const k = String(key || '').trim().toUpperCase();
  return store.licenses.find(l => l.key === k) || null;
}

function revokeAdminSession(token) {
  if (store.admins[token]) {
    delete store.admins[token];
    saveStore(store);
  }
}

function createAdminSession() {
  const token = crypto.randomBytes(32).toString('hex');
  store.admins[token] = { created: todayISO(), expires: nowMs() + SESSION_TTL_MS };
  saveStore(store);
  return token;
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const session = store.admins[token];
  if (!session || session.expires < nowMs()) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  session.expires = nowMs() + SESSION_TTL_MS;
  saveStore(store);
  req.adminToken = token;
  next();
}

const app = express();
app.use(express.json());
app.use('/admin', express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => res.json({ ok: true, ts: todayISO() }));

/* ─── Public API (used by the desktop app) ─── */

app.post('/api/activate', (req, res) => {
  const { key, machineId, appVersion } = req.body || {};
  const lic = findLicense(key);
  if (!lic) return res.status(404).json({ ok: false, error: 'invalid_key' });

  const now = nowMs();
  if (lic.revoked) return res.status(403).json({ ok: false, error: 'revoked' });

  if (lic.expiresAt && now > Date.parse(lic.expiresAt)) {
    return res.status(403).json({ ok: false, error: 'expired' });
  }

  if (!machineId) return res.status(400).json({ ok: false, error: 'no_machine' });

  const machines = lic.machines || [];
  let binding = machines.find(m => m.machineId === machineId);
  if (!binding) {
    if (machines.length >= (lic.maxMachines || MAX_MACHINES)) {
      return res.status(403).json({ ok: false, error: 'device_limit' });
    }
    binding = { machineId, firstSeen: todayISO(), lastSeen: todayISO() };
    machines.push(binding);
  }
  binding.lastSeen = todayISO();
  lic.activations = (lic.activations || 0) + 1;
  lic.lastActivation = todayISO();
  if (appVersion) lic.lastVersion = appVersion;
  saveStore(store);

  res.json({
    ok: true,
    expiresAt: lic.expiresAt,
    machineCount: machines.length,
    maxMachines: lic.maxMachines || MAX_MACHINES
  });
});

app.post('/api/validate', (req, res) => {
  const { key, machineId } = req.body || {};
  const lic = findLicense(key);
  if (!lic) return res.status(404).json({ ok: false, error: 'invalid_key' });

  const now = nowMs();
  const payload = {
    ok: true,
    revoked: !!lic.revoked,
    valid: !lic.revoked,
    expiresAt: lic.expiresAt,
    machineBound: false
  };

  if (lic.revoked) return res.status(403).json({ ok: false, error: 'revoked', ...payload });

  if (lic.expiresAt && now > Date.parse(lic.expiresAt)) {
    return res.status(403).json({ ok: false, error: 'expired', ...payload, valid: false });
  }

  if (machineId) {
    const binding = (lic.machines || []).find(m => m.machineId === machineId);
    payload.machineBound = !!binding;
    if (!binding && (lic.machines || []).length >= (lic.maxMachines || MAX_MACHINES)) {
      return res.status(403).json({ ok: false, error: 'device_limit', ...payload, valid: false });
    }
    if (!binding) {
      (lic.machines || []).push({ machineId, firstSeen: todayISO(), lastSeen: todayISO() });
    } else {
      binding.lastSeen = todayISO();
    }
    saveStore(store);
  }

  lic.lastValidation = todayISO();
  saveStore(store);
  res.json({ ok: true, valid: true, revoked: false, expiresAt: lic.expiresAt, machineBound: payload.machineBound });
});

app.post('/api/deactivate', (req, res) => {
  const { key, machineId } = req.body || {};
  const lic = findLicense(key);
  if (!lic) return res.status(404).json({ ok: false, error: 'invalid_key' });
  lic.machines = (lic.machines || []).filter(m => m.machineId !== machineId);
  saveStore(store);
  res.json({ ok: true });
});

/* ─── Admin API (control panel) ─── */

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'bad_password' });
  res.json({ ok: true, token: createAdminSession() });
});

app.get('/api/admin/licenses', requireAdmin, (_req, res) => {
  const list = store.licenses.map(l => ({
    key: l.key,
    createdAt: l.createdAt,
    expiresAt: l.expiresAt,
    revoked: !!l.revoked,
    note: l.note || '',
    maxMachines: l.maxMachines || MAX_MACHINES,
    machineCount: (l.machines || []).length,
    lastValidation: l.lastValidation || null,
    lastActivation: l.lastActivation || null,
    activations: l.activations || 0,
    lastVersion: l.lastVersion || null,
    machines: (l.machines || []).map(m => ({
      machineId: m.machineId,
      firstSeen: m.firstSeen,
      lastSeen: m.lastSeen
    }))
  }));
  res.json({ ok: true, licenses: list });
});

app.post('/api/admin/licenses', requireAdmin, (req, res) => {
  const { days, note, maxMachines, count } = req.body || {};
  const n = Math.min(Math.max(parseInt(count || '1', 10), 1), 100);
  const d = parseInt(days || String(DEFAULT_DURATION_DAYS), 10);
  const created = [];
  for (let i = 0; i < n; i++) {
    const key = generateKey();
    store.licenses.push({
      key,
      createdAt: todayISO(),
      expiresAt: addDaysISO(d),
      revoked: false,
      note: String(note || '').slice(0, 200),
      maxMachines: parseInt(maxMachines || MAX_MACHINES, 10),
      machines: [],
      activations: 0,
      lastVersion: null
    });
    created.push(key);
  }
  saveStore(store);
  res.json({ ok: true, keys: created, expiresAt: addDaysISO(d) });
});

app.post('/api/admin/licenses/revoke', requireAdmin, (req, res) => {
  const { key, revoked } = req.body || {};
  const lic = findLicense(key);
  if (!lic) return res.status(404).json({ ok: false, error: 'not_found' });
  lic.revoked = !!revoked;
  if (lic.revoked) lic.revokedAt = todayISO();
  else delete lic.revokedAt;
  saveStore(store);
  res.json({ ok: true, revoked: lic.revoked });
});

app.post('/api/admin/licenses/extend', requireAdmin, (req, res) => {
  const { key, days } = req.body || {};
  const lic = findLicense(key);
  if (!lic) return res.status(404).json({ ok: false, error: 'not_found' });
  const d = parseInt(days || '0', 10);
  const base = lic.expiresAt ? Date.parse(lic.expiresAt) : nowMs();
  lic.expiresAt = new Date(base + d * 86400000).toISOString();
  saveStore(store);
  res.json({ ok: true, expiresAt: lic.expiresAt });
});

app.delete('/api/admin/licenses/:key', requireAdmin, (req, res) => {
  const k = String(req.params.key || '').toUpperCase();
  const idx = store.licenses.findIndex(l => l.key === k);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'not_found' });
  store.licenses.splice(idx, 1);
  saveStore(store);
  res.json({ ok: true });
});

app.get('/api/admin/stats', requireAdmin, (_req, res) => {
  const total = store.licenses.length;
  const active = store.licenses.filter(l => !l.revoked && (!l.expiresAt || Date.parse(l.expiresAt) > nowMs())).length;
  const revoked = store.licenses.filter(l => l.revoked).length;
  const expired = store.licenses.filter(l => !l.revoked && l.expiresAt && Date.parse(l.expiresAt) <= nowMs()).length;
  const machines = store.licenses.reduce((a, l) => a + (l.machines || []).length, 0);
  res.json({ ok: true, stats: { total, active, revoked, expired, machines } });
});

app.listen(PORT, () => {
  console.log(`License server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});

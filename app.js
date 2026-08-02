const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const store = require('./store');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MAX_MACHINES = parseInt(process.env.MAX_MACHINES || '1', 10);
const DEFAULT_DURATION_DAYS = parseInt(process.env.LICENSE_DEFAULT_DAYS || '365', 10);
const SESSION_TTL = '24h';

const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const KEY_PREFIX = 'LX-';
const KEY_SEGMENTS = [4, 4, 4, 4];

function generateKey() {
  let segments = KEY_SEGMENTS.map(len => {
    let s = '';
    for (let i = 0; i < len; i++) s += CHARSET[crypto.randomInt(CHARSET.length)];
    return s;
  });
  return KEY_PREFIX + segments.join('-');
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

function findLicense(key) {
  const k = String(key || '').trim().toUpperCase();
  return store.getStore().licenses.find(l => l.key === k) || null;
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok: false, error: 'unauthorized' });
  try {
    jwt.verify(token, ADMIN_PASSWORD);
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
}

const app = express();
app.use(express.json());

let publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  publicDir = path.join(__dirname, '..', 'public');
}
app.use('/admin', express.static(publicDir));

app.get('/health', (_req, res) => res.json({ ok: true, ts: todayISO() }));

/* ─── Public API (used by the desktop app) ─── */

app.post('/api/activate', async (req, res) => {
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
  await store.saveStore();

  res.json({
    ok: true,
    expiresAt: lic.expiresAt,
    machineCount: machines.length,
    maxMachines: lic.maxMachines || MAX_MACHINES
  });
});

app.post('/api/validate', async (req, res) => {
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
  }

  lic.lastValidation = todayISO();
  await store.saveStore();
  res.json({ ok: true, valid: true, revoked: false, expiresAt: lic.expiresAt, machineBound: payload.machineBound });
});

app.post('/api/deactivate', async (req, res) => {
  const { key, machineId } = req.body || {};
  const lic = findLicense(key);
  if (!lic) return res.status(404).json({ ok: false, error: 'invalid_key' });
  lic.machines = (lic.machines || []).filter(m => m.machineId !== machineId);
  await store.saveStore();
  res.json({ ok: true });
});

/* ─── Admin API (control panel) ─── */

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'bad_password' });
  const token = jwt.sign({ admin: true, exp: Math.floor(Date.now() / 1000) + 24 * 3600 }, ADMIN_PASSWORD);
  res.json({ ok: true, token });
});

app.get('/api/admin/licenses', requireAdmin, (_req, res) => {
  const list = store.getStore().licenses.map(l => ({
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

app.post('/api/admin/licenses', requireAdmin, async (req, res) => {
  const { days, note, maxMachines, count } = req.body || {};
  const n = Math.min(Math.max(parseInt(count || '1', 10), 1), 100);
  const d = parseInt(days || String(DEFAULT_DURATION_DAYS), 10);
  const created = [];
  for (let i = 0; i < n; i++) {
    const key = generateKey();
    store.getStore().licenses.push({
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
  await store.saveStore();
  res.json({ ok: true, keys: created, expiresAt: addDaysISO(d) });
});

app.post('/api/admin/licenses/revoke', requireAdmin, async (req, res) => {
  const { key, revoked } = req.body || {};
  const lic = findLicense(key);
  if (!lic) return res.status(404).json({ ok: false, error: 'not_found' });
  lic.revoked = !!revoked;
  if (lic.revoked) lic.revokedAt = todayISO();
  else delete lic.revokedAt;
  await store.saveStore();
  res.json({ ok: true, revoked: lic.revoked });
});

app.post('/api/admin/licenses/extend', requireAdmin, async (req, res) => {
  const { key, days } = req.body || {};
  const lic = findLicense(key);
  if (!lic) return res.status(404).json({ ok: false, error: 'not_found' });
  const d = parseInt(days || '0', 10);
  const base = lic.expiresAt ? Date.parse(lic.expiresAt) : nowMs();
  lic.expiresAt = new Date(base + d * 86400000).toISOString();
  await store.saveStore();
  res.json({ ok: true, expiresAt: lic.expiresAt });
});

app.delete('/api/admin/licenses/:key', requireAdmin, async (req, res) => {
  const k = String(req.params.key || '').toUpperCase();
  const idx = store.getStore().licenses.findIndex(l => l.key === k);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'not_found' });
  store.getStore().licenses.splice(idx, 1);
  await store.saveStore();
  res.json({ ok: true });
});

app.get('/api/admin/stats', requireAdmin, (_req, res) => {
  const all = store.getStore().licenses;
  const total = all.length;
  const active = all.filter(l => !l.revoked && (!l.expiresAt || Date.parse(l.expiresAt) > nowMs())).length;
  const revoked = all.filter(l => l.revoked).length;
  const expired = all.filter(l => !l.revoked && l.expiresAt && Date.parse(l.expiresAt) <= nowMs()).length;
  const machines = all.reduce((a, l) => a + (l.machines || []).length, 0);
  res.json({ ok: true, stats: { total, active, revoked, expired, machines } });
});

app.use((err, _req, res, _next) => {
  console.error('License server error:', err);
  res.status(500).json({ ok: false, error: 'server_error' });
});

module.exports = app;

const serverless = require('serverless-http');
const store = require('../store');

let initPromise = null;
let app = null;

async function initWithRetry(attempts) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await store.initStore();
      return;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

module.exports = async (req, res) => {
  if (req.url.startsWith('/api/diag')) {
    const dns = require('dns');
    const net = require('net');
    const tls = require('tls');
    const host = 'ep-tiny-base-ayfqvpkg-pooler.c-5.us-east-2.aws.neon.tech';
    const out = {};
    let s = Date.now();
    try {
      const addrs = await new Promise((resolve, reject) => dns.lookup(host, { all: true }, (e, a) => e ? reject(e) : resolve(a)));
      out.dns = { ms: Date.now() - s, addrs: addrs.slice(0, 4) };
    } catch (e) { out.dns_err = { ms: Date.now() - s, msg: e.message }; }
    s = Date.now();
    try {
      await new Promise((resolve, reject) => {
        const sock = net.connect(5432, host, () => { out.tcp = Date.now() - s; sock.destroy(); resolve(); });
        sock.setTimeout(15000, () => { sock.destroy(); reject(new Error('TCP timeout 15s')); });
        sock.on('error', reject);
      });
    } catch (e) { out.tcp_err = { ms: Date.now() - s, msg: e.message }; }
    s = Date.now();
    try {
      await new Promise((resolve, reject) => {
        const sock = tls.connect({ host, port: 5432, rejectUnauthorized: false, timeout: 15000 }, () => { out.tls = Date.now() - s; sock.end(); resolve(); });
        sock.on('error', reject);
      });
    } catch (e) { out.tls_err = { ms: Date.now() - s, msg: e.message }; }
    res.status(200).json({ ok: true, out });
    return;
  }
  if (req.url === '/' || req.url === '/health') {
    try {
      if (!initPromise) {
        initPromise = initWithRetry(2);
        initPromise.catch(() => { initPromise = null; });
      }
      await initPromise;
    } catch (e) { /* DB sleeping — health still responds */ }
    if (!app) app = require('../app');
    return serverless(app)(req, res);
  }
  try {
    if (!initPromise) {
      initPromise = initWithRetry(2);
      initPromise.catch(() => { initPromise = null; });
    }
    await initPromise;
    if (!app) app = require('../app');
    return serverless(app)(req, res);
  } catch (err) {
    console.error('License function error:', err && err.message ? err.message : err);
    if (!res.headersSent) {
      res.status(503).json({
        ok: false,
        error: 'db_unavailable',
        detail: 'قاعدة البيانات نائمة — أعد المحاولة بعد لحظات'
      });
    }
  }
};

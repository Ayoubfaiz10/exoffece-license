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

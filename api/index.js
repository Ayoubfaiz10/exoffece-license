const serverless = require('serverless-http');
const store = require('../store');

let initPromise = null;
let app = null;

module.exports = async (req, res) => {
  try {
    if (!initPromise) initPromise = store.initStore();
    await initPromise;
    if (!app) app = require('../app');
    return serverless(app)(req, res);
  } catch (err) {
    console.error('License function error:', err && err.message ? err.message : err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: 'server_error', detail: String(err && err.message || err) });
    }
  }
};

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'licenses.json');
const ON_VERCEL = !!process.env.VERCEL;
const USE_PG = !!process.env.DATABASE_URL;

let pool = null;
let store = { licenses: [], admins: {} };

async function initStore() {
  if (!USE_PG && ON_VERCEL) {
    throw new Error('DATABASE_URL is missing. Add it in Vercel → Project Settings → Environment Variables, then redeploy.');
  }
  if (USE_PG) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5
    });
    await pool.query(`CREATE TABLE IF NOT EXISTS licenses (
      key TEXT PRIMARY KEY,
      data JSONB NOT NULL
    )`);
    const res = await pool.query('SELECT data FROM licenses');
    store = {
      licenses: res.rows.map(r => r.data),
      admins: {}
    };
    return store;
  }
  try {
    if (fs.existsSync(DATA_FILE)) {
      store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    store = { licenses: [], admins: {} };
  }
  if (!Array.isArray(store.licenses)) store.licenses = [];
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  return store;
}

async function saveStore() {
  if (USE_PG) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM licenses');
      for (const lic of store.licenses) {
        await client.query('INSERT INTO licenses (key, data) VALUES ($1, $2)', [lic.key, JSON.stringify(lic)]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function getStore() {
  return store;
}

module.exports = { initStore, saveStore, getStore, USE_PG };

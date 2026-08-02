const store = require('./store');

const PORT = process.env.PORT || 4001;

store.initStore()
  .then(() => {
    const app = require('./app');
    app.listen(PORT, () => {
      console.log(`License server running on http://localhost:${PORT}`);
      console.log(`Admin panel: http://localhost:${PORT}/admin`);
      console.log(`Storage: ${store.USE_PG ? 'PostgreSQL (DATABASE_URL)' : 'local file (data/licenses.json)'}`);
    });
  })
  .catch(err => {
    console.error('Failed to init store:', err);
    process.exit(1);
  });

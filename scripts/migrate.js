'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');

(async () => {
  const dir = path.join(__dirname, '..', 'sql');
  const archivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const archivo of archivos) {
    process.stdout.write(`  ${archivo} … `);
    const sql = fs.readFileSync(path.join(dir, archivo), 'utf8');
    try {
      await pool.query(sql);
      console.log('ok');
    } catch (err) {
      console.log('ERROR');
      console.error(`  ${err.message}`);
      process.exit(1);
    }
  }

  console.log('\nMigración completa.');
  await pool.end();
})();

import dotenv from 'dotenv';
import pg from '../server/node_modules/pg/lib/index.js';
import path from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { restoreBackupInTransaction, buildBackupPackage } from '../server/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

pg.types.setTypeParser(1082, value => value);

const targetArg = process.argv[2];
const replaceAll = process.argv.includes('--replace');

if (!targetArg) {
  console.error('Uso: node scripts/restore-entidades.mjs <caminho-do-backup.json ou pasta-de-entidades> [--replace]');
  process.exit(1);
}

const targetPath = path.resolve(rootDir, targetArg);
let payload = null;

const info = await stat(targetPath);
if (info.isDirectory()) {
  const fullFile = path.join(targetPath, 'backup-completo-entidades.json');
  try {
    payload = JSON.parse(await readFile(fullFile, 'utf8'));
  } catch {
    const jsonDir = path.join(targetPath, 'json');
    const files = await readdir(jsonDir);
    const entities = {};
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const parsed = JSON.parse(await readFile(path.join(jsonDir, f), 'utf8'));
      const entityName = parsed.meta?.entity || path.basename(f, '.json');
      entities[entityName] = Array.isArray(parsed.records) ? parsed.records : [];
    }
    payload = { entities };
  }
} else {
  payload = JSON.parse(await readFile(targetPath, 'utf8'));
}

const dbConfig = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'allegra',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres'
};

let client = null;
for (const candidateHost of Array.from(new Set([dbConfig.host, '127.0.0.1', '192.168.1.6']))) {
  const candidate = new pg.Client({ ...dbConfig, host: candidateHost });
  try {
    await candidate.connect();
    client = candidate;
    dbConfig.host = candidateHost;
    break;
  } catch {
    await candidate.end().catch(() => {});
  }
}

if (!client) {
  console.error('Não foi possível conectar ao PostgreSQL em 127.0.0.1 nem em 192.168.1.6.');
  process.exit(1);
}

try {
  await client.query('BEGIN');
  await restoreBackupInTransaction(client, payload, replaceAll);
  await client.query('COMMIT');
  const after = await buildBackupPackage(client);
  console.log('Restauração por entidades concluída com sucesso!');
  console.log('Contagem de registros por entidade:', after.meta.entityCounts);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Falha ao restaurar backup:', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

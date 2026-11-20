import dotenv from 'dotenv';
import pg from '../server/node_modules/pg/lib/index.js';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildBackupPackage, rowsToCsv, createZipArchive } from '../server/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

pg.types.setTypeParser(1082, value => value);

const dbConfig = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'allegra',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres'
};

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const backupDir = path.join(rootDir, 'backups', `entidades-${stamp}`);

let client = null;
for (const candidateHost of Array.from(new Set([dbConfig.host, '127.0.0.1', '192.168.1.6']))) {
  const candidate = new pg.Client({ ...dbConfig, host: candidateHost });
  try {
    await candidate.connect();
    client = candidate;
    dbConfig.host = candidateHost;
    break;
  } catch (err) {
    await candidate.end().catch(() => {});
    if (candidateHost === '192.168.1.6') {
      console.error(`Falha ao conectar ao banco PostgreSQL (${err.message}).`);
      process.exit(1);
    }
  }
}

try {
  await client.query('BEGIN READ ONLY');
  const backup = await buildBackupPackage(client);
  await client.query('COMMIT');

  await mkdir(path.join(backupDir, 'json'), { recursive: true });
  await mkdir(path.join(backupDir, 'csv'), { recursive: true });

  const fullJson = JSON.stringify(backup, null, 2);
  await writeFile(path.join(backupDir, 'backup-completo-entidades.json'), fullJson, 'utf8');
  await writeFile(path.join(rootDir, 'backups', `allegra-entidades-${stamp}.json`), fullJson, 'utf8');

  const zipFiles = [
    { name: 'backup-completo-entidades.json', content: fullJson }
  ];

  for (const [entityName, rows] of Object.entries(backup.entities)) {
    const entityJson = JSON.stringify(
      {
        meta: {
          system: backup.meta.system,
          entity: entityName,
          count: rows.length,
          exportedAt: backup.meta.exportedAt
        },
        records: rows
      },
      null,
      2
    );
    const entityCsv = rowsToCsv(rows);

    await writeFile(path.join(backupDir, 'json', `${entityName}.json`), entityJson, 'utf8');
    await writeFile(path.join(backupDir, 'csv', `${entityName}.csv`), entityCsv, 'utf8');

    zipFiles.push({ name: `json/${entityName}.json`, content: entityJson });
    zipFiles.push({ name: `csv/${entityName}.csv`, content: entityCsv });
  }

  const zipBuffer = createZipArchive(zipFiles);
  await writeFile(path.join(rootDir, 'backups', `allegra-entidades-${stamp}.zip`), zipBuffer);

  console.log(`Backup por entidades concluído com sucesso!`);
  console.log(`- Pasta com entidades separadas: backups\\entidades-${stamp}`);
  console.log(`- JSON completo por entidades:   backups\\allegra-entidades-${stamp}.json`);
  console.log(`- Pacote ZIP das entidades:      backups\\allegra-entidades-${stamp}.zip`);
} catch (error) {
  console.error(`Falha ao exportar entidades de ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}:`, error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

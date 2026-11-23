import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { translateMigration } from './dialect';
import { seedWebsiteContent } from '../modules/website/website.seed';

const migrationsDir = path.resolve(__dirname, '../../migrations');

function ident(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error('Database name is not safe to quote.');
  return `"${value}"`;
}

export async function ensureDatabase(): Promise<void> {
  const client = new pg.Client({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: 'postgres',
    options: '-c TimeZone=UTC',
  });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [env.db.name]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE ${ident(env.db.name)} OWNER ${ident(env.db.user)}`);
    }
  } finally {
    await client.end();
  }
}

export async function migrate(): Promise<void> {
  const client = new pg.Client({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.name,
    options: '-c TimeZone=UTC',
  });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const appliedRows = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(appliedRows.rows.map((row) => String(row.version)));
    const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        for (const statement of translateMigration(sql)) {
          try {
            await client.query(statement);
          } catch (error) {
            logger.error('Migration statement failed.', {
              file,
              statement,
              message: error instanceof Error ? error.message : 'Unknown error',
            });
            throw error;
          }
        }
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      logger.info(`Applied migration ${file}`);
    }
    await client.query(`
      CREATE OR REPLACE FUNCTION bajogo_touch_updated_at() RETURNS trigger AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    const tables = await client.query(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'updated_at'`,
    );
    for (const row of tables.rows) {
      const table = String(row.table_name);
      await client.query(`DROP TRIGGER IF EXISTS ${ident(`touch_${table}`)} ON ${ident(table)}`);
      await client.query(
        `CREATE TRIGGER ${ident(`touch_${table}`)} BEFORE UPDATE ON ${ident(table)}
         FOR EACH ROW EXECUTE FUNCTION bajogo_touch_updated_at()`,
      );
    }
    logger.info('Database migrations are up to date.');
  } finally {
    await client.end();
  }
  await seedWebsiteContent();
}

if (require.main === module) {
  ensureDatabase()
    .then(() => migrate())
    .catch((error: unknown) => {
      logger.error('Migration failed.', { message: error instanceof Error ? error.message : 'Unknown error' });
      process.exitCode = 1;
    })
    .finally(async () => {
      const { pool } = await import('./pool');
      await pool.end();
    });
}

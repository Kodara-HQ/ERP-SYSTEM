import pg from 'pg';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { translateSql } from './dialect';
import type { ResultSetHeader, RowDataPacket } from './rows';

const { Pool, types } = pg;

types.setTypeParser(1082, (value) => value);
types.setTypeParser(1114, (value) => value);
types.setTypeParser(1184, (value) => value);
types.setTypeParser(1700, (value) => Number(value));
types.setTypeParser(20, (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
});

const raw = new Pool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.name,
  max: 10,
  options: '-c TimeZone=UTC',
});
raw.on('error', (error: Error) => {
  logger.error('Database pool error.', { message: error.message });
});

type Queryable = { query: (text: string, values?: unknown[]) => Promise<pg.QueryResult> };

function remap(error: unknown): never {
  const failure = error as { code?: string; message?: string };
  if (failure.code === '23505') failure.code = 'ER_DUP_ENTRY';
  else if (failure.code === '23503' && /still referenced/i.test(failure.message ?? '')) failure.code = 'ER_ROW_IS_REFERENCED_2';
  else if (failure.code === '23503') failure.code = 'ER_NO_REFERENCED_ROW_2';
  else if (failure.code === 'P0001') failure.code = 'ER_SIGNAL_EXCEPTION';
  throw error;
}

async function run(client: Queryable, sql: string, params: unknown[] = []): Promise<[RowDataPacket[] | ResultSetHeader]> {
  const translated = translateSql(sql, params);
  try {
    const result = await client.query(translated.text, translated.values);
    const command = sql.trim().match(/^[a-z]+/i)?.[0]?.toLowerCase();
    if (command === 'insert' || command === 'update' || command === 'delete') {
      return [{ insertId: Number(result.rows[0]?.id ?? 0), affectedRows: result.rowCount ?? 0 }];
    }
    return [result.rows as RowDataPacket[]];
  } catch (error) {
    remap(error);
  }
}

export interface Db {
  query: (sql: string, params?: unknown[]) => Promise<[RowDataPacket[] | ResultSetHeader]>;
  beginTransaction?: () => Promise<void>;
  commit?: () => Promise<void>;
  rollback?: () => Promise<void>;
  release?: () => void;
}

export const pool = {
  query: (sql: string, params?: unknown[]) => run(raw, sql, params),
  async getConnection(): Promise<Required<Pick<Db, 'query' | 'beginTransaction' | 'commit' | 'rollback' | 'release'>>> {
    const client = await raw.connect();
    return {
      query: (sql: string, params?: unknown[]) => run(client, sql, params),
      beginTransaction: async () => { await client.query('BEGIN'); },
      commit: async () => { await client.query('COMMIT'); },
      rollback: async () => { await client.query('ROLLBACK'); },
      release: () => client.release(),
    };
  },
  end: () => raw.end(),
};

export async function checkDatabase(): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.query('SELECT 1');
  } finally {
    connection.release();
  }
}

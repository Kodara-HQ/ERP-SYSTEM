import { pool, type Db } from './pool';
import type { ResultSetHeader, RowDataPacket } from './rows';

export type { Db, ResultSetHeader, RowDataPacket };

export async function query<T extends RowDataPacket[]>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const [rows] = await db.query(sql, params);
  return rows as T;
}

export async function queryOne<T extends RowDataPacket>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T[]>(db, sql, params);
  return rows[0] ?? null;
}

export async function execute(db: Db, sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [result] = await db.query(sql, params);
  return result as ResultSetHeader;
}

export async function scalar(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  const row = await queryOne<RowDataPacket>(db, sql, params);
  const value = row ? Object.values(row)[0] : 0;
  return Number(value ?? 0);
}

export async function withTransaction<T>(fn: (connection: Db) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

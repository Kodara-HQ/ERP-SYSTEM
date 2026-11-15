import { createHash } from 'crypto';
import type { RowDataPacket } from '../database/rows';
import type { Db } from '../database/query';
import { execute, query, queryOne, scalar } from '../database/query';
import { HttpError, notFound } from '../utils/httpError';

const MAX_BYTES = 5 * 1024 * 1024;

const allowedTypes = new Map<string, string[]>([
  ['application/pdf', ['.pdf']],
  ['image/png', ['.png']],
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['text/plain', ['.txt']],
  ['text/csv', ['.csv']],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['.docx']],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ['.xlsx']],
]);

export interface DocumentInput {
  companyId: number;
  entityType: string;
  entityId: number;
  fileName: string;
  contentType: string;
  contentBase64: string;
  description?: string | null;
  userId: number;
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200);
}

/** Stores a supporting document in the database so backups carry it. Documents cannot be changed or deleted. */
export async function storeDocument(db: Db, input: DocumentInput) {
  const extensions = allowedTypes.get(input.contentType.toLowerCase());
  const fileName = safeName(input.fileName);
  if (!extensions || !extensions.some((extension) => fileName.toLowerCase().endsWith(extension))) {
    throw new HttpError(422, 'Attach a PDF, image, Word, Excel, CSV, or text file with a matching extension.', 'INVALID_DOCUMENT_TYPE');
  }
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(input.contentBase64)) {
    throw new HttpError(422, 'The document content is not valid base64.', 'INVALID_DOCUMENT');
  }
  const content = Buffer.from(input.contentBase64, 'base64');
  if (content.length === 0) throw new HttpError(422, 'The document is empty.', 'INVALID_DOCUMENT');
  if (content.length > MAX_BYTES) throw new HttpError(413, 'A supporting document can be at most 5 MB.', 'DOCUMENT_TOO_LARGE');
  const sha256 = createHash('sha256').update(content).digest('hex');
  const result = await execute(
    db,
    `INSERT INTO supporting_documents (company_id, entity_type, entity_id, file_name, content_type, size_bytes, sha256, content, description, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.companyId, input.entityType, input.entityId, fileName, input.contentType.toLowerCase(), content.length, sha256, content, input.description ?? null, input.userId],
  );
  return { id: result.insertId, fileName, contentType: input.contentType.toLowerCase(), sizeBytes: content.length, sha256 };
}

export async function listDocuments(db: Db, entities: Array<{ type: string; id: number }>) {
  const valid = entities.filter((entity) => entity.type && Number.isFinite(entity.id));
  if (valid.length === 0) return [];
  const clause = valid.map(() => '(d.entity_type = ? AND d.entity_id = ?)').join(' OR ');
  const rows = await query<RowDataPacket[]>(
    db,
    `SELECT d.id, d.entity_type, d.entity_id, d.file_name, d.content_type, d.size_bytes, d.sha256, d.description, d.created_at, u.username
     FROM supporting_documents d JOIN users u ON u.id = d.uploaded_by
     WHERE ${clause}
     ORDER BY d.id`,
    valid.flatMap((entity) => [entity.type, entity.id]),
  );
  return rows.map((row) => ({
    id: Number(row.id),
    entityType: String(row.entity_type),
    entityId: Number(row.entity_id),
    fileName: String(row.file_name),
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    description: row.description == null ? null : String(row.description),
    uploadedBy: String(row.username),
    uploadedAt: row.created_at,
  }));
}

export async function countDocuments(db: Db, entities: Array<{ type: string; id: number }>): Promise<number> {
  const valid = entities.filter((entity) => entity.type && Number.isFinite(entity.id));
  if (valid.length === 0) return 0;
  const clause = valid.map(() => '(entity_type = ? AND entity_id = ?)').join(' OR ');
  return scalar(db, `SELECT COUNT(*) FROM supporting_documents WHERE ${clause}`, valid.flatMap((entity) => [entity.type, entity.id]));
}

export async function documentContent(db: Db, id: number, entities: Array<{ type: string; id: number }>) {
  const row = await queryOne<RowDataPacket>(db, 'SELECT * FROM supporting_documents WHERE id = ?', [id]);
  if (!row || !entities.some((entity) => entity.type === String(row.entity_type) && entity.id === Number(row.entity_id))) {
    throw notFound('Document');
  }
  const content = row.content as Buffer;
  return { fileName: String(row.file_name), contentType: String(row.content_type), content: Buffer.isBuffer(content) ? content : Buffer.from(content) };
}

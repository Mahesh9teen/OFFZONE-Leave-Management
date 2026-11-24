import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { UPLOAD_LIMITS, type RequestDocument, type RequestStatus, type User } from '@leave/contracts';
import type { Pool, PoolClient } from 'pg';
import { Database } from './db/database.js';
import { RuleError } from './domain/rules.js';
import { supportingDocument, type UploadedAsset } from './uploads.js';

type DocumentRow = Omit<RequestDocument, 'createdAt'> & { createdAt: Date };
type RequestAccess = { employeeId: string; teamId: string; status: RequestStatus };
const columns = 'id, request_id AS "requestId", filename, mime_type AS "mimeType", octet_length(content) AS size, created_at AS "createdAt"';
const metadata = (row: DocumentRow): RequestDocument => ({ ...row, createdAt: row.createdAt.toISOString() });

@Injectable()
export class DocumentsService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async list(actor: User, requestId: string) {
    await this.authorize(this.db.pool, actor, requestId);
    return this.readList(this.db.pool, requestId);
  }

  async upload(actor: User, requestId: string, files: UploadedAsset[]) {
    if (!files.length || files.length > UPLOAD_LIMITS.documentsPerRequest) throw new BadRequestException('Choose between one and three supporting documents.');
    await this.authorize(this.db.pool, actor, requestId, true);
    const documents = await Promise.all(files.map(supportingDocument));
    return this.db.transaction(async (client) => {
      await this.authorize(client, actor, requestId, true, true);
      const count = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM request_documents WHERE request_id = $1', [requestId]);
      if (count.rows[0].count + documents.length > UPLOAD_LIMITS.documentsPerRequest) throw new RuleError(409, 'A leave request can have at most three supporting documents.');
      for (const file of documents) {
        await client.query('INSERT INTO request_documents (request_id, uploaded_by, filename, mime_type, content) VALUES ($1, $2, $3, $4, $5)',
          [requestId, actor.id, file.filename, file.mimeType, file.content]);
      }
      return this.readList(client, requestId);
    });
  }

  async download(actor: User, requestId: string, id: string) {
    await this.authorize(this.db.pool, actor, requestId);
    const { rows } = await this.db.pool.query<{ filename: string; content: Buffer }>('SELECT filename, content FROM request_documents WHERE id = $1 AND request_id = $2', [id, requestId]);
    if (!rows[0]) throw new NotFoundException('Document not found.');
    return rows[0];
  }

  async remove(actor: User, requestId: string, id: string) {
    return this.db.transaction(async (client) => {
      await this.authorize(client, actor, requestId, true, true);
      const result = await client.query('DELETE FROM request_documents WHERE id = $1 AND request_id = $2', [id, requestId]);
      if (!result.rowCount) throw new NotFoundException('Document not found.');
      return this.readList(client, requestId);
    });
  }

  private async readList(client: Pool | PoolClient, requestId: string) {
    return (await client.query<DocumentRow>(`SELECT ${columns} FROM request_documents WHERE request_id = $1 ORDER BY created_at, id`, [requestId])).rows.map(metadata);
  }

  private async authorize(client: Pool | PoolClient, actor: User, requestId: string, write = false, lock = false) {
    const { rows } = await client.query<RequestAccess>(`SELECT r.employee_id AS "employeeId", u.team_id AS "teamId", r.status
      FROM leave_requests r JOIN users u ON u.id = r.employee_id WHERE r.id = $1${lock ? ' FOR UPDATE OF r' : ''}`, [requestId]);
    const request = rows[0];
    if (!request) throw new NotFoundException('Request not found.');
    const owner = actor.role === 'employee' && actor.id === request.employeeId;
    const canRead = owner || actor.role === 'admin' || (actor.role === 'manager' && actor.teamId === request.teamId);
    if (!canRead || (write && !owner)) throw new ForbiddenException('You do not have permission to access these supporting documents.');
    if (write && request.status !== 'pending') throw new RuleError(409, 'Supporting documents can only be changed while the request is pending.');
  }
}

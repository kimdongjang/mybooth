import { mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { sql as raw } from './postgres.mjs';
import { requireAuth } from '../../api/lib/auth.js';
import { canonicalSql } from '../../api/lib/storageContract.js';
import { imageScope } from '../../api/lib/boothFoundation.js';

export default async function upload(req, res) {
  const respond = (status, payload) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(payload)); };
  try {
    if (req.method !== 'POST') return respond(405, { error: 'Method not allowed' });
    const actor = requireAuth(req, { status(code) { this.code = code; return this; }, json(body) { respond(this.code, body); } });
    if (!actor) return;
    const scope = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
    const sql = await canonicalSql(raw);
    const owner = await imageScope(sql, actor.id, scope);
    const { inventoryId, projectId, productId } = scope;
    let prefix;
    if (inventoryId && !projectId && !productId) {
      if (!(await sql`SELECT id FROM pos_inventory WHERE admin_id=${owner} AND id=${inventoryId} AND product->>'removedAt' IS NULL`).rows.length) throw Error('상품 접근 권한이 없습니다.');
      prefix = `inventory/${encodeURIComponent(owner)}/${encodeURIComponent(inventoryId)}`;
    } else {
      if (!projectId || !productId || inventoryId || !(await sql`SELECT p.id FROM pos_products p JOIN pos_projects project ON project.id=p.project_id WHERE p.project_id=${projectId} AND p.id=${productId} AND project.admin_id=${owner} AND project.archived_at IS NULL`).rows.length) throw Error('상품 접근 권한이 없습니다.');
      prefix = `products/${encodeURIComponent(projectId)}/${encodeURIComponent(productId)}`;
    }
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) throw Error('이미지는 5MB 이하여야 합니다.');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const type = req.headers['content-type'];
    const extension = type === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
      : type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg'
      : type === 'image/webp' && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' ? 'webp' : null;
    if (!extension) throw Error('올바른 이미지 파일이 필요합니다.');
    const directory = `.local-data/images/${createHash('sha256').update(prefix).digest('hex')}`;
    await mkdir(directory, { recursive: true });
    const name = `${randomUUID()}.${extension}`;
    await writeFile(`${directory}/${name}`, bytes, { flag: 'wx' });
    respond(200, { url: `/local-images/${prefix}/${name}` });
  } catch (error) { if (!res.headersSent) respond(400, { error: error.message }); }
}

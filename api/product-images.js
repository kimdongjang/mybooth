import { handleUpload } from '@vercel/blob/client';
import { sql } from '@vercel/postgres';
import { requireAuth } from './lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.body?.type === 'blob.generate-client-token') {
    if (!requireAuth(req, res)) return;
    if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
      return res.status(503).json({ code: 'BLOB_NOT_CONFIGURED', error: '이미지 저장소가 설정되지 않았습니다.' });
    }
  }
  try {
    const result = await handleUpload({
      request: req,
      body: req.body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const admin = requireAuth(req, res);
        if (!admin) throw new Error('인증이 필요합니다.');
        const { projectId, productId } = JSON.parse(clientPayload || '{}');
        if (!projectId || !productId) throw new Error('상품과 프로젝트가 필요합니다.');
        const product = (await sql`SELECT p.id FROM pos_products p JOIN pos_projects project ON project.id = p.project_id WHERE p.project_id = ${projectId} AND p.id = ${productId} AND project.admin_id = ${admin.id} AND project.archived_at IS NULL`).rows[0];
        if (!product || !pathname.startsWith(`products/${encodeURIComponent(projectId)}/${encodeURIComponent(productId)}/`)) throw new Error('상품 접근 권한이 없습니다.');
        return { allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'], maximumSizeInBytes: 5 * 1024 * 1024, addRandomSuffix: true, allowOverwrite: false, validUntil: Date.now() + 5 * 60 * 1000 };
      },
      onUploadCompleted: async () => {},
    });
    if (!res.headersSent) return res.status(200).json(result);
  } catch (error) {
    if (!res.headersSent) return res.status(400).json({ error: error.message || '이미지 업로드에 실패했습니다.' });
  }
}

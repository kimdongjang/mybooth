import { createAdmin, createToken, validateAdmin } from './lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { mode = 'login', id, password, email, nickname,allowOperatorStock=true } = req.body || {};

    if (mode === 'signup') {
      const admin = await createAdmin(id, password, email, nickname,allowOperatorStock);
      return res.status(201).json({ token: createToken(admin.id), admin });
    }

    const admin = await validateAdmin(id, password);
    if (!admin) return res.status(401).json({ error: '아이디 또는 패스워드가 올바르지 않습니다.' });

    return res.status(200).json({ token: createToken(admin.id), admin });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ error: error.message || '인증 처리에 실패했습니다.' });
  }
}

import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';

const getAuthSecret = () => process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || 'dev-pos-secret';
const legacyAdminId = () => process.env.ADMIN_ID || process.env.ADMIN_USERNAME || 'admin';
const legacyAdminPassword = () => process.env.ADMIN_PASSWORD || '';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':');
  if (!salt || !hash || !password) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
}

function hasPostgresConnectionString() {
  return Boolean(process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL);
}

export function assertPostgresConnectionString() {
  if (hasPostgresConnectionString()) return;
  throw new Error('Vercel 환경변수 POSTGRES_URL이 설정되지 않았습니다.');
}

export async function initAuthDb() {
  assertPostgresConnectionString();
  await sql`CREATE TABLE IF NOT EXISTS pos_admins (id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;

  if (legacyAdminPassword()) {
    await sql`
      INSERT INTO pos_admins (id, password_hash)
      VALUES (${legacyAdminId()}, ${hashPassword(legacyAdminPassword())})
      ON CONFLICT (id) DO NOTHING
    `;
  }
}

export async function createAdmin(id, password) {
  await initAuthDb();
  const adminId = String(id || '').trim();
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(adminId)) throw new Error('아이디는 영문/숫자/._- 조합 3~32자로 입력해주세요.');
  if (String(password || '').length < 6) throw new Error('패스워드는 6자 이상 입력해주세요.');

  try {
    await sql`INSERT INTO pos_admins (id, password_hash) VALUES (${adminId}, ${hashPassword(password)})`;
  } catch (error) {
    if (String(error.message).includes('duplicate') || String(error.code) === '23505') throw new Error('이미 사용 중인 아이디입니다.');
    throw error;
  }
  return { id: adminId };
}

export async function validateAdmin(id, password) {
  await initAuthDb();
  const adminId = String(id || '').trim();
  const row = (await sql`SELECT id, password_hash FROM pos_admins WHERE id = ${adminId}`).rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return { id: row.id };
}

export async function validateAdminPassword(adminId, password) {
  return Boolean(await validateAdmin(adminId, password));
}

export function createToken(id) {
  const payload = Buffer.from(JSON.stringify({ id, iat: Date.now() })).toString('base64url');
  const signature = crypto.createHmac('sha256', getAuthSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', getAuthSecret()).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed?.id ? { id: String(parsed.id) } : null;
  } catch {
    return null;
  }
}

export function requireAuth(req, res) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const admin = verifyToken(token);
  if (admin) return admin;
  res.status(401).json({ error: '인증이 필요합니다.' });
  return null;
}

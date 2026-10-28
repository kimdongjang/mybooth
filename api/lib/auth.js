import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';

const getAuthSecret = () => process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || 'dev-pos-secret';
const legacyAdminId = () => process.env.ADMIN_ID || process.env.ADMIN_USERNAME || 'admin';
const legacyAdminPassword = () => process.env.ADMIN_PASSWORD || '';

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
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
  await sql`ALTER TABLE pos_admins ADD COLUMN IF NOT EXISTS allow_operator_stock BOOLEAN NOT NULL DEFAULT TRUE`;
  await sql`ALTER TABLE pos_admins ADD COLUMN IF NOT EXISTS email TEXT`;
  await sql`ALTER TABLE pos_admins ADD COLUMN IF NOT EXISTS nickname TEXT`;
  await sql`ALTER TABLE pos_admins ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS pos_admins_email_unique ON pos_admins (LOWER(BTRIM(email)))`;

  if (legacyAdminPassword()) {
    await sql`
      INSERT INTO pos_admins (id, password_hash)
      VALUES (${legacyAdminId()}, ${hashPassword(legacyAdminPassword())})
      ON CONFLICT (id) DO NOTHING
    `;
  }
  // Preserve an already assigned address and every existing password/project link.
  await sql`UPDATE pos_admins SET email = 'naru3644@gmail.com' WHERE id = 'admin' AND email IS NULL AND deleted_at IS NULL`;
}

export async function createAdmin(id, password, email, nickname) {
  const adminId = String(id || '').trim();
  const adminEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const invalid = (message) => Object.assign(new Error(message), { status: 400 });
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(adminId)) throw invalid('아이디는 영문/숫자/._- 조합 3~32자로 입력해주세요.');
  if (typeof password !== 'string' || password.length < 6) throw invalid('패스워드는 6자 이상 입력해주세요.');
  if (adminEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw invalid('올바른 이메일을 입력해주세요.');
  const displayName = nicknameValue(nickname);
  await initAuthDb();

  // Say which value collides so a 409 is actionable (the account may have been deleted but still reserves its ID).
  const taken = (await sql`SELECT id, email FROM pos_admins WHERE id = ${adminId} OR LOWER(email) = ${adminEmail}`).rows;
  if (taken.some(row => row.id === adminId)) throw Object.assign(new Error('이미 사용 중인 아이디입니다.'), { status: 409 });
  if (taken.length) throw Object.assign(new Error('이미 사용 중인 이메일입니다.'), { status: 409 });
  try {
    await sql`INSERT INTO pos_admins (id, email, password_hash, nickname) VALUES (${adminId}, ${adminEmail}, ${hashPassword(password)}, ${displayName})`;
  } catch (error) {
    if (String(error.code) === '23505') throw Object.assign(new Error('이미 사용 중인 아이디 또는 이메일입니다.'), { status: 409 });
    throw error;
  }
  return { id: adminId, email: adminEmail, nickname: displayName };
}

export async function validateAdmin(id, password) {
  await initAuthDb();
  const adminId = String(id || '').trim();
  const row = (await sql`SELECT id, email, nickname, password_hash FROM pos_admins WHERE id = ${adminId} AND deleted_at IS NULL`).rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return { id: row.id, email: row.email, nickname: row.nickname || row.id };
}

export async function validateAdminPassword(adminId, password, query) {
  if (!query) return Boolean(await validateAdmin(adminId, password));
  // POS callers already hold the account row lock: use that same connection.
  const row = (await query`SELECT password_hash FROM pos_admins WHERE id=${adminId} AND deleted_at IS NULL`).rows[0];
  return Boolean(row && verifyPassword(password, row.password_hash));
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

export function nicknameValue(value) {
  if (value != null && typeof value !== 'string') throw Object.assign(new Error('닉네임은 문자로 입력해주세요.'), { status: 400 });
  const nickname = (value || '').trim();
  if (nickname.length > 30) throw Object.assign(new Error('닉네임은 30자 이내로 입력해주세요.'), { status: 400 });
  if (nickname) return nickname;
  const adjectives = ['똑똑한', '맛있는', '즐거운', '다정한', '용감한', '반짝이는'];
  const nouns = ['자동차', '딸기', '고양이', '구름', '토끼', '별'];
  return adjectives[crypto.randomInt(adjectives.length)] + ' ' + nouns[crypto.randomInt(nouns.length)];
}

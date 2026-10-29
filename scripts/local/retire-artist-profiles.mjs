// 로컬 PGlite DB에 제작자 프로필 이관(retireArtistProfiles)을 한 트랜잭션으로 적용한다.
// dev 서버를 멈춘 상태에서 실행한다. 운영 DB에는 사용하지 않는다.
import { PGlite } from '@electric-sql/pglite';
import { retireArtistProfiles } from '../../api/lib/boothFoundation.js';

const db = new PGlite(process.env.POS_LOCAL_DATA_DIR || '.local-data/postgres');
const sql = (parts, ...values) => db.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values);
const count = async table => (await sql`SELECT to_regclass(${table}) AS name`).rows[0].name
  ? Number((await db.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n) : null;
try {
  const before = { profiles: await count('pos_artist_profiles'), owners: await count('pos_stock_owners') };
  await db.exec('BEGIN');
  await retireArtistProfiles(sql);
  await db.exec('COMMIT');
  const linked = (await sql`SELECT COUNT(*)::int AS n FROM pos_stock_owners WHERE link_status='linked'`).rows[0]?.n;
  console.log(JSON.stringify({ before, after: { retired: await count('pos_artist_profiles_retired'), profiles: await count('pos_artist_profiles'), owners: await count('pos_stock_owners'), linked } }));
} catch (error) {
  await db.exec('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await db.close();
}

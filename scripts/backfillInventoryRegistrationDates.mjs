import { createClient } from '@vercel/postgres';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const missingDate = "COALESCE(BTRIM(product->>'createdAt'),'')='' AND COALESCE(product->>'removedAt','')=''";
export async function backfillMissingInventoryDates(db, { adminId, date, apply = false, backup }) {
  if (typeof adminId !== 'string' || !adminId.trim()) throw new Error('An explicit adminId is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date+'T00:00:00Z')) || new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date) throw new Error('A valid YYYY-MM-DD date is required.');
  if (apply && typeof backup !== 'function') throw new Error('A backup writer is required before applying changes.');
  if (apply) await db.query('BEGIN');
  try {
    if (apply) {
      const owner=await db.query('SELECT id FROM pos_admins WHERE id=$1 FOR UPDATE',[adminId]);
      if (!owner.rows.length) throw new Error('Admin not found.');
      await db.query('SELECT id FROM pos_projects WHERE admin_id=$1 ORDER BY id FOR UPDATE',[adminId]);
    }
    const selected=await db.query(`SELECT id,version,product ? 'createdAt' AS had_key,product->'createdAt' AS previous_date FROM pos_inventory WHERE admin_id=$1 AND ${missingDate} ORDER BY id${apply?' FOR UPDATE':''}`,[adminId]);
    const ids=selected.rows.map(row=>row.id);
    if (!apply) return {mode:'preview',date,adminId,matchingCount:ids.length};
    // Save only the minimal before-image; never write credentials or whole products.
    await backup({adminId,date,items:selected.rows});
    const updated=await db.query(`UPDATE pos_inventory SET product=jsonb_set(product,'{createdAt}',to_jsonb($2::text),TRUE),version=version+1 WHERE admin_id=$1 AND id=ANY($3::text[]) AND ${missingDate} RETURNING id`,[adminId,date+'T00:00:00+09:00',ids]);
    if(updated.rows.length!==ids.length) throw new Error('Target count changed; rolled back.');
    await db.query('COMMIT');
    return {mode:'apply',date,adminId,updatedCount:updated.rows.length};
  } catch(err) {if(apply)await db.query('ROLLBACK');throw err;}
}

async function main() {
  const args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
  if(value('--env-file'))process.loadEnvFile(resolve(value('--env-file')));
  const adminId=value('--admin-id');
  const date=value('--date') || new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const apply=args.includes('--apply'),backupFile=value('--backup-file');
  if(apply&&!backupFile)throw new Error('--apply requires --backup-file.');
  const connectionString=process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if(!connectionString)throw new Error('A server-only PostgreSQL connection is required.');
  const db=createClient({connectionString});await db.connect();
  try {
    const result=await backfillMissingInventoryDates(db,{adminId,date,apply,backup:async data=>{const path=resolve(backupFile);await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(data,null,2),{flag:'wx',mode:0o600});}});
    console.log(JSON.stringify(result));
  } finally {await db.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Registration-date backfill failed. No credentials are logged; inspect connection/arguments and backup permissions.');process.exitCode=1;});

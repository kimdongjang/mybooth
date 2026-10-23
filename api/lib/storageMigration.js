import {storageTables,storageColumns} from './storageContract.js';
const identifier=name=>{if(!/^[a-z_][a-z0-9_]*$/.test(name))throw new Error('INVALID_IDENTIFIER');return '"'+name+'"';};
export async function storageShape(db) {
 const tables=(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name LIKE 'pos_%' ORDER BY table_name")).rows.map(r=>r.table_name);
 const shape={};
 for(const table of tables)shape[table]=(await db.query('SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=$1 ORDER BY ordinal_position',[table])).rows;
 return shape;
}
export async function storageDigests(db,shape,{canonical=false}={}) {
 const result={};
 for(const [table,columns] of Object.entries(shape)) {
  // Credentials are never copied; use only immutable principal identity here.
  const selected=table==='pos_admins'?columns.filter(c=>['id','deleted_at'].includes(c.column_name)):columns;
  const fields=selected.map(c=>`${identifier(canonical?(storageColumns[c.column_name]||c.column_name):c.column_name)} AS ${identifier(c.column_name)}`).join(',');
  const name=canonical?(storageTables[table]||table):table;
  result[table]=(await db.query(`SELECT COUNT(*)::int AS count,md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text) AS fingerprint FROM (SELECT ${fields} FROM ${identifier(name)}) r`)).rows[0];
 }
 return result;
}
// Caller owns an explicit transaction and backup. PostgreSQL renames preserve
// rows, foreign keys, indexes and constraints; no transaction snapshots change.
export async function replaceStorageNames(db) {
 const shape=await storageShape(db);
 if(shape.pos_artist_inventory)return {alreadyApplied:true};
 if(!shape.pos_inventory)throw new Error('SOURCE_STORAGE_REQUIRED');
 const before=await storageDigests(db,shape);
 for(const [table,columns] of Object.entries(shape)) {
  for(const column of columns)if(storageColumns[column.column_name])await db.query(`ALTER TABLE ${identifier(table)} RENAME COLUMN ${identifier(column.column_name)} TO ${identifier(storageColumns[column.column_name])}`);
 }
 for(const [from,to] of Object.entries(storageTables))if(shape[from])await db.query(`ALTER TABLE ${identifier(from)} RENAME TO ${identifier(to)}`);
 const after=await storageDigests(db,shape,{canonical:true});
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('STORAGE_DATA_CHANGED');
 return {alreadyApplied:false,tables:storageTables,columns:storageColumns,preserved:before};
}

export async function restoreStorageNames(db,originalShape) {
 // Schema-only rollback also preserves transactions made after the switch.
 for(const [from,to] of Object.entries(storageTables))if(originalShape[from])await db.query(`ALTER TABLE ${identifier(to)} RENAME TO ${identifier(from)}`);
 for(const [table,columns] of Object.entries(originalShape))for(const column of columns)if(storageColumns[column.column_name])await db.query(`ALTER TABLE ${identifier(table)} RENAME COLUMN ${identifier(storageColumns[column.column_name])} TO ${identifier(column.column_name)}`);
}

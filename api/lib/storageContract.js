// Physical storage names describe artists, booths and events. The adapter is
// the single boundary for historical SQL/snapshot names; values are untouched.
export const storageTables={pos_projects:'pos_events',pos_products:'pos_event_products',pos_bundles:'pos_event_bundles',pos_inventory:'pos_artist_inventory',pos_inventory_links:'pos_event_inventory',pos_inventory_owners:'pos_artist_inventory_owners',pos_inventory_openings:'pos_inventory_opening_balances',pos_settlements:'pos_recipient_ledger'};
export const storageColumns={admin_id:'custodian_id',legacy_admin_id:'storage_principal_id',legacy_creator:'settlement_alias',creator:'recipient_alias'};
const names={...storageTables,...storageColumns};
const inverse=Object.fromEntries(Object.entries(storageColumns).map(([a,b])=>[b,a]));
export function storageQuery(text,values=[]) {
 const rewritten=text.replace(/'(?:''|[^'])*'|"[^"]+"|\b[a-z_][a-z_0-9]*\b/g,token=>{
  if(token.startsWith("'")){const name=token.slice(1,-1);return storageTables[name]?`'${storageTables[name]}'`:token;}
  if(token.startsWith('"'))return '"'+(names[token.slice(1,-1)]||token.slice(1,-1))+'"';
  return names[token]||token;
 });
 // Only identifier parameters in to_regclass are translated. A product named
 // "pos_inventory" or a JSON document containing admin_id is ordinary data.
 const params=values.map((value,i)=>new RegExp(`to_regclass\\(\\s*\\$${i+1}(?![0-9])`,'i').test(text)?storageTables[value]||value:value);
 return {text:rewritten,values:params};
}
export function logicalRows(result) {
 return {...result,rows:result.rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[inverse[key]||key,value])))};
}
export async function canonicalSql(raw) {
 const enabled=(await raw`SELECT to_regclass('pos_artist_inventory') AS name`).rows[0]?.name;
 if(!enabled)return raw;
 return async(parts,...values)=>{
  const text=parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,'');
  const translated=storageQuery(text,values);
  const fragments=translated.text.split(/\$\d+(?![0-9])/);
  // Reconstruct tags from original placeholder order (SQL can reuse $n).
  const indices=[...translated.text.matchAll(/\$(\d+)/g)].map(m=>Number(m[1])-1);
  fragments.raw=fragments;
  return logicalRows(await raw(fragments,...indices.map(i=>translated.values[i])));
 };
}

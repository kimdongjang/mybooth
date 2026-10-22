import { useRef, useState } from 'react';
import { columns, exampleWorkbook, readProducts } from '../utils/productWorkbook';
import { prepareProductImage } from '../utils/productImage';
import { uploadInventoryImage } from '../utils/uploadProductImage';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
export default function InventoryImport({api,adminId}) {
 const submitLock=useRef(false),pending=useRef(null);
 const [uncertain,setUncertain]=useState(false);
 const [rows,setRows]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const clear=useUnsavedChanges(rows.length>0);
 const change=(id,key,value)=>setRows(current=>current.map(row=>row.id===id?{...row,[key]:value}:row));
 const load=async file=>{if(!file)return;setBusy(true);setError('');try{setRows(await readProducts(file));}catch(e){setError(e.message);}finally{setBusy(false);}};
 const save=async()=>{if(submitLock.current)return;submitLock.current=true;setBusy(true);setError('');try{
  if(rows.some(row=>!row.name.trim() || ['stock','price','cost'].some(key=>!Number.isInteger(Number(row[key])) || Number(row[key])<0 || Number(row[key])>2147483647)))throw new Error('상품명과 0 이상의 정수 재고·가격·원가를 입력해주세요.');
  // Replay exactly the same batch after an uncertain response.
  pending.current ||= {products:rows.map(({file,preview,...row})=>({...row,stock:Number(row.stock),price:Number(row.price),cost:Number(row.cost)}))};
  await api('importInventory',pending.current);pending.current=null;setUncertain(false);
  const failed=[];
  for(const row of rows.filter(r=>r.file))try{const result=await api('listInventory');const item=result.inventory.find(i=>i.id===row.id);const image=await uploadInventoryImage(adminId,row.id,row.file);await api('saveInventory',{product:{...item,imageUrl:image.url}});}catch(e){failed.push(row.name);}
  setRows([]);clear();if(failed.length)throw new Error('상품 등록 완료, 이미지 저장 실패: '+failed.join(', '));
 }catch(e){if(pending.current){if(e.status>=400 && e.status<500)pending.current=null;else setUncertain(true);}setError(e.message);}finally{setBusy(false);submitLock.current=false;}};
 return <section className="product-management"><div className="inventory-table-actions"><label className="management-upload">엑셀 업로드<input type="file" accept=".xlsx" disabled={busy || uncertain} onChange={e=>{load(e.target.files?.[0]);e.target.value='';}}/></label><button className="management-back" onClick={()=>{const url=URL.createObjectURL(new Blob([exampleWorkbook()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download='상품_등록_예시.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>예시 엑셀 다운로드</button><button className="management-add" disabled={busy || !rows.length} onClick={save}>{uncertain?'이전 등록 재확인':'일괄 등록'}</button></div>{error&&<p role="alert">{error}</p>}<div className="management-table-wrap"><table className="management-table bulk-table"><thead><tr><th>번호</th><th>이미지</th>{columns.map(([key,label])=><th key={key}>{label}</th>)}<th>삭제</th></tr></thead><tbody>{rows.map((row,index)=><tr key={row.id}><td>{index+1}</td><td><label className="management-upload">{row.file?<img width="48" height="48" style={{width:48,height:48,objectFit:'contain'}} src={row.preview} alt="상품 미리보기"/>:'업로드'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || uncertain} onChange={async e=>{const f=e.target.files?.[0];if(!f)return;setBusy(true);try{const file=await prepareProductImage(f);const preview=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(file);});change(row.id,'file',file);change(row.id,'preview',preview);}catch(err){setError(err.message);}finally{setBusy(false);}}}/></label></td>{columns.map(([key,label])=><td key={key}><input aria-label={`${index+1}행 ${label}`} type={['stock','price','cost'].includes(key)?'number':'text'} min="0" step="1" value={row[key]} disabled={busy || uncertain} onChange={e=>change(row.id,key,e.target.value)}/></td>)}<td><button disabled={busy || uncertain} onClick={()=>setRows(rows.filter(r=>r.id!==row.id))}>삭제</button></td></tr>)}</tbody></table></div></section>;
}

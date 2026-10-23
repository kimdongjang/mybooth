import { useEffect, useRef, useState } from 'react';
import { columns, exampleWorkbook, readProducts } from '../utils/productWorkbook';
import { prepareProductImage } from '../utils/productImage';
import { uploadInventoryImage } from '../utils/uploadProductImage';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
export default function InventoryImport({api,adminId,navigate,review = false,onRegistered,saveImage}) {
 const submitLock=useRef(false),pending=useRef(null),active=useRef(true),hasDraft=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{if(review && !hasDraft.current)navigate('/inventory/import',true);},[review,navigate]);
 const [uncertain,setUncertain]=useState(false);
 const [rows,setRows]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const clear=useUnsavedChanges(review && rows.length>0);
 const change=(id,key,value)=>setRows(current=>current.map(row=>row.id===id?{...row,[key]:value}:row));
 const load=async file=>{if(!file || busy)return;setBusy(true);setError('');try{const products=await readProducts(file);if(!active.current)return;hasDraft.current=true;setRows(products);clear();await navigate('/inventory/import/review');}catch(e){if(active.current)setError(e.message);}finally{if(active.current)setBusy(false);}};
 const save=async()=>{if(submitLock.current)return;submitLock.current=true;setBusy(true);setError('');try{
  if(rows.some(row=>!row.name.trim() || ['stock','price','cost'].some(key=>!Number.isInteger(Number(row[key])) || Number(row[key])<0 || Number(row[key])>2147483647)))throw new Error('상품명과 0 이상의 정수 재고·가격·원가를 입력해주세요.');
  // Replay exactly the same batch after an uncertain response.
  pending.current ||= {products:rows.map(({file,preview,...row})=>({...row,stock:Number(row.stock),price:Number(row.price),cost:Number(row.cost)}))};
  let savedData=await api('importInventory',pending.current);if(!active.current)return;pending.current=null;setUncertain(false);
  const failed=[];
  for(const row of rows.filter(r=>r.file))try{if(saveImage)await saveImage(row.id,row.file);else{const result=await api('listInventory');const item=result.inventory.find(i=>i.id===row.id);const image=await uploadInventoryImage(adminId,row.id,row.file);savedData=await api('saveInventory',{product:{...item,imageUrl:image.url}});}}catch(e){failed.push(row.name);}
  if(!active.current)return;
  setRows([]);clear();onRegistered?.(savedData);if(failed.length)throw new Error('상품 등록 완료, 이미지 저장 실패: '+failed.join(', '));
  await navigate('inventory');
 }catch(e){if(pending.current){if(e.status>=400 && e.status<500)pending.current=null;else setUncertain(true);}if(active.current)setError(e.message);}finally{if(active.current)setBusy(false);submitLock.current=false;}};
 return <section className="product-management inventory-import-page">
  {review ? <header className="inventory-import-toolbar"><a className="management-back" href="#/inventory/import" onClick={event=>{if(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button!==0)return;event.preventDefault();navigate('/inventory/import');}}>← 엑셀 업로드로</a><button type="button" className="management-add inventory-import-submit" disabled={busy || !rows.length} onClick={save}>{uncertain?'이전 등록 재확인':'일괄 등록'}</button></header> : <header className="inventory-import-toolbar">
    <div className="inventory-import-file-actions">
      <label className="management-upload inventory-import-upload"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5"/></svg><span>엑셀 업로드</span><input aria-label="상품 엑셀 파일 업로드" type="file" accept=".xlsx" disabled={busy || uncertain} onChange={e=>{load(e.target.files?.[0]);e.target.value='';}}/></label>
      <button type="button" className="management-back inventory-import-template" onClick={()=>{const url=URL.createObjectURL(new Blob([exampleWorkbook()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download='상품_등록_예시.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 4v12m-4-4 4 4 4-4M4 16v4h16v-4"/></svg><span>예시 엑셀 다운로드</span></button>
    </div>
  </header>}
  {!review && <section className="inventory-import-guide" aria-labelledby="inventory-import-guide-title">
    <div className="inventory-import-guide-heading"><h2 id="inventory-import-guide-title">예시 엑셀 작성 가이드</h2><span className="inventory-import-guide-count">컬럼 8개</span></div>
    <div className="inventory-import-guide-body">
      <p>첫 번째 시트의 1행은 아래 컬럼명과 순서를 유지하고, 2행부터 상품을 한 줄에 하나씩 입력해주세요.</p>
      <div className="management-table-wrap inventory-import-table-scroll" tabIndex={0} role="region" aria-label="엑셀 작성 가이드 표"><table className="management-table inventory-import-guide-table"><caption className="sr-only">예시 엑셀 컬럼과 입력 기준</caption><thead><tr><th scope="col">컬럼명</th><th scope="col">입력 기준</th><th scope="col">작성 예시</th></tr></thead><tbody>{[
        ['상품명','필수 · 200자 이내','딸기 키링'],
        ['굿즈 종류','선택 · 상품의 종류','키링'],
        ['캐릭터','선택 · 캐릭터 이름','딸기'],
        ['제작자','선택 · 작가 또는 제작자 이름','작가명'],
        ['작품/시리즈','선택 · 작품명 또는 시리즈명','오리지널'],
        ['재고','0 이상의 정수 · 빈칸은 0개','10'],
        ['판매가','0 이상의 정수(원) · 빈칸은 0원','5000'],
        ['원가','0 이상의 정수(원) · 빈칸은 0원','2000'],
      ].map(([label,rule,example])=><tr key={label}><th scope="row">{label}</th><td>{rule}</td><td>{example}</td></tr>)}</tbody></table></div>
      <ul><li>XLSX 파일만 지원하며, 파일은 5MB 이하·상품은 최대 500개까지 등록할 수 있습니다.</li><li>금액은 쉼표나 ‘원’ 없이 숫자만 입력하고, 수식은 계산된 값으로 바꿔주세요. 0원 상품도 등록할 수 있습니다.</li><li>번호와 이미지는 엑셀 컬럼에 넣지 않습니다. 번호는 화면에서 표시되며, 이미지는 업로드 후 표의 이미지 열에서 추가합니다.</li><li>업로드가 끝나면 이동하는 편집 화면에서 내용을 수정한 뒤 ‘일괄 등록’을 눌러 저장합니다. 예시 상품 행은 실제 상품으로 바꾸거나 삭제해주세요.</li></ul>
    </div>
  </section>}
  {error&&<p role="alert">{error}</p>}{review && <div className="management-table-wrap inventory-import-table-scroll" tabIndex={0} role="region" aria-label="상품 일괄 등록 편집 표"><table className="management-table bulk-table"><thead><tr><th>번호</th><th>이미지</th>{columns.map(([key,label])=><th key={key}>{label}</th>)}<th>삭제</th></tr></thead><tbody>{rows.map((row,index)=><tr key={row.id}><td>{index+1}</td><td><label className="management-upload">{row.file?<img width="48" height="48" style={{width:48,height:48,objectFit:'contain'}} src={row.preview} alt="상품 미리보기"/>:'업로드'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || uncertain} onChange={async e=>{const f=e.target.files?.[0];if(!f)return;setBusy(true);try{const file=await prepareProductImage(f);const preview=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(file);});change(row.id,'file',file);change(row.id,'preview',preview);}catch(err){setError(err.message);}finally{setBusy(false);}}}/></label></td>{columns.map(([key,label])=><td key={key}><input aria-label={`${index+1}행 ${label}`} type={['stock','price','cost'].includes(key)?'number':'text'} min="0" step="1" value={row[key]} disabled={busy || uncertain} onChange={e=>change(row.id,key,e.target.value)}/></td>)}<td><button disabled={busy || uncertain} onClick={()=>setRows(rows.filter(r=>r.id!==row.id))}>삭제</button></td></tr>)}</tbody></table></div>}</section>;
}

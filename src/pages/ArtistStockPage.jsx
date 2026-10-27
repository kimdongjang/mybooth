import {useEffect,useId,useRef,useState} from 'react';
import {Input} from '../components/PosUI';

function Schedule({event,busy,onSave}) {
  const [startsOn,setStart]=useState(event.starts_on||'');
  const [endsOn,setEnd]=useState(event.ends_on||'');
  return <form className="account-form" onSubmit={e=>{e.preventDefault();onSave({projectId:event.id,boothId:event.booth_id,startsOn,endsOn});}}>
    <h3>{event.name} 일정</h3><label>시작일<Input type="date" required value={startsOn} onChange={setStart} disabled={busy}/></label>
    <label>종료일<Input type="date" required min={startsOn} value={endsOn} onChange={setEnd} disabled={busy}/></label>
    <button className="management-add" disabled={busy}>일정 저장</button>
  </form>;
}

export function AllocationQuantity({item,event,allocation,busy,onAllocate}){
 const initial=allocation?.initial||0,min=initial-(allocation?.remaining||0),max=initial+item.warehouse;
 const [value,setValue]=useState(String(initial));
 return <Input aria-label={`${event.name} 배정 수량`} type="number" min={min} max={max} step="1" required value={value} onChange={setValue} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}} disabled={busy||!(event.operator||event.artistEditable)} onBlur={async e=>{if(!e.target.checkValidity()){e.target.reportValidity();setValue(String(initial));return;}if(Number(value)!==initial){try{const result=await onAllocate(item,{projectId:event.id,quantity:Number(value),price:allocation?.price??item.price});if(!result)setValue(String(initial));}catch{setValue(String(initial));}}}}/>;
}

export function StockItem({item,events,busy,onAdjust,onAllocate,onLoss,eventOnly=false,lossOnly=false,embedded=false}) {
  const [total,setTotal]=useState(String(item.totalStock));
  const totalFormId=useId();
  const personal=!eventOnly&&!lossOnly;
  const [projectId,setProject]=useState(events[0]?.id||'');
  const allocation=item.allocations.find(a=>a.projectId===projectId);
  const [quantity,setQuantity]=useState(String(allocation?.initial||0));
  const [price,setPrice]=useState(String(allocation?.price??item.price));
  const [fromProjectId,setFromProject]=useState(''),[moveQuantity,setMoveQuantity]=useState('');
  const [lossQuantity,setLossQuantity]=useState(''),[lossReason,setLossReason]=useState('damage'),[lossProject,setLossProject]=useState(eventOnly?events[0]?.id||'':'');
  const changeEvent=id=>{const next=item.allocations.find(a=>a.projectId===id);setProject(id);setQuantity(String(next?.initial||0));setPrice(String(next?.price??item.price));setFromProject('');setMoveQuantity('');};
  const event=events.find(e=>e.id===projectId);
  const editable=event&&(event.operator||event.artistEditable);
  const Container=embedded?'div':'article';
  return <Container className={embedded?'event-inventory-controls event-stock-detail':`management-product${!eventOnly&&!lossOnly?' personal-stock-management':''}`} >{!embedded&&<div className="management-product-header"><h2>{!eventOnly&&!lossOnly?'행사별 재고 배정 관리':item.name}</h2>{personal&&<button type="submit" form={totalFormId} className="management-add" disabled={busy}>저장</button>}</div>}<div className={embedded?'event-stock-detail-body':'account-card-body'}>
    {!eventOnly&&!personal&&<dl className="account-details"><div><dt>총재고</dt><dd>{item.totalStock}개</dd></div>{lossOnly&&<div><dt>현재 잔량</dt><dd>{item.remaining}개</dd></div>}<div><dt>미배정재고</dt><dd>{item.warehouse}개</dd></div>{lossOnly&&<div><dt>누적 입고</dt><dd>{item.totalReceived}개</dd></div>}</dl>}
    {personal&&<form id={totalFormId} className="account-form personal-stock-total-form" onSubmit={e=>{e.preventDefault();onAdjust(item,{totalStock:Number(total),reason:Number(total)>item.totalStock?'receipt':'correction'});}}>
      <label>총재고<Input type="number" min={item.minimumTotalStock??0} step="1" required value={total} onChange={setTotal} disabled={busy}/></label>
      <div className="personal-stock-unallocated"><span>미배정재고</span><strong>{item.warehouse}개</strong></div>
    </form>}
    {!lossOnly&&events.length>0&&<form className="account-form personal-stock-allocation-form" onSubmit={e=>{e.preventDefault();if(personal)return;onAllocate(item,{projectId,quantity:Number(quantity),price:Number(price),...(fromProjectId?{fromProjectId,moveQuantity:Number(moveQuantity)}:{})});}}>
      {eventOnly?<><div className="inventory-allocation-heading"><h4>행사 배정 재고 관리</h4></div><div className="management-table-wrap"><table className="management-table inventory-allocation-table"><thead><tr><th scope="col">행사</th><th scope="col">행사 배정 수량</th><th scope="col">판매 수량</th><th scope="col">남은 수량</th></tr></thead><tbody><tr><td>{event?.name}</td><td><Input aria-label={`${event?.name} 배정 수량`} type="number" min="0" step="1" required value={quantity} onChange={setQuantity} disabled={busy||!editable}/></td><td>{allocation?.sold||0}개</td><td>{allocation?.remaining||0}개</td></tr></tbody></table></div></>:<>
      <div className="management-table-wrap"><table className="management-table inventory-allocation-table personal-allocation-table"><thead><tr><th scope="col">행사</th><th scope="col">행사 배정 수량</th><th scope="col">판매 수량</th><th scope="col">남은 수량</th></tr></thead><tbody>{events.map(row=>{const assigned=item.allocations.find(a=>a.projectId===row.id);return <tr key={row.id}><td><a className="management-name-link" href={`#/products?projectId=${encodeURIComponent(row.id)}`}>{row.name}</a>{row.archived_at&&<span className="management-note"> (보관)</span>}</td><td className="mono"><AllocationQuantity key={`${row.id}:${item.version}`} item={item} event={row} allocation={assigned} busy={busy} onAllocate={onAllocate}/></td><td className="mono">{assigned?.sold||0}개</td><td className="mono">{assigned?.remaining||0}개</td></tr>;})}</tbody></table></div>
            </>}
      {eventOnly&&<><label>가져올 위치<select value={fromProjectId} onChange={e=>setFromProject(e.target.value)} disabled={busy||!editable}><option value="">미배정 재고</option>{events.filter(e=>e.id!==projectId&&(e.operator||e.artistEditable)&&item.allocations.some(a=>a.projectId===e.id&&a.remaining>0)).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      {fromProjectId&&<label>행사 간 이동 수량<Input type="number" min="1" step="1" required value={moveQuantity} onChange={value=>{setMoveQuantity(value);setQuantity(String((allocation?.initial||0)+Number(value)));}} disabled={busy||!editable}/></label>}
      <label>행사 판매가<Input type="number" min="0" step="1" required value={price} onChange={setPrice} disabled={busy||!editable}/></label>
      <button className="management-add" disabled={busy||!editable}>행사 재고 저장</button></>}
    </form>}
    {(lossOnly||eventOnly)&&<form className="account-form" onSubmit={e=>{e.preventDefault();onLoss(item,{quantity:Number(lossQuantity),reason:lossReason,...(lossProject?{projectId:lossProject}:{})});}}>
      <label>차감 위치<select value={lossProject} onChange={e=>setLossProject(e.target.value)} disabled={busy}>{!eventOnly&&<option value="">미배정 재고</option>}{events.filter(e=>e.operator||e.artistEditable).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <label>차감 사유<select value={lossReason} onChange={e=>setLossReason(e.target.value)} disabled={busy}><option value="damage">파손</option><option value="loss">분실</option>{!lossProject&&<option value="external">외부 판매</option>}</select></label>
      <label>차감 수량<Input type="number" min="1" step="1" required value={lossQuantity} onChange={setLossQuantity} disabled={busy}/></label><button className="management-add" disabled={busy||(eventOnly&&!events.some(e=>e.id===lossProject&&(e.operator||e.artistEditable)))}>차감 기록</button>
    </form>}
  </div></Container>;
}

export default function ArtistStockPage({request,initialProjectId}) {
  const executing=useRef(false);
  const [options,setOptions]=useState([]),[selection,setSelection]=useState(''),[data,setData]=useState(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(null);
  const [name,setName]=useState(''),[price,setPrice]=useState('0'),[quantity,setQuantity]=useState('0'),[projectId,setProject]=useState('');
  const [joinCode,setJoinCode]=useState('');
  const scope=options.find(o=>o.key===selection);
  const post=(action,payload)=>request('/api/booths',{method:'POST',body:JSON.stringify({action,payload})});
  useEffect(()=>{
    let active=true;
    (async()=>{
      const home=await request('/api/booths?artists=home');
      const values=home.profiles.map(p=>({key:`own:${p.owner_id}`,ownerId:p.owner_id,label:`내 재고 · ${p.display_name}`}));
      const lists=await Promise.all(home.booths.filter(b=>['owner','manager'].includes(b.role)).map(async b=>{
        const people=await request(`/api/booths?artists=participants&boothId=${encodeURIComponent(b.id)}`);
        return people.profiles.filter(p=>['active','proxy','ending'].includes(p.participation)).map(p=>({key:`${b.id}:${p.owner_id}`,ownerId:p.owner_id,boothId:b.id,label:`${b.name} · ${p.display_name}`}));
      }));
      if(active){setOptions([...values,...lists.flat()]);setSelection(values[0]?.key||lists.flat()[0]?.key||'');}
    })().catch(err=>{if(active)setError(err.message);});return()=>{active=false;};
  },[request]);
  const url=value=>`/api/booths?artists=stock&ownerId=${encodeURIComponent(value.ownerId)}${value.boothId?`&boothId=${encodeURIComponent(value.boothId)}`:''}`;
  useEffect(()=>{
    setData(null);if(!scope)return;let active=true;
    request(url(scope)).then(result=>{if(active){setData(result);setProject(result.events.find(e=>e.id===initialProjectId&&(e.operator||e.artistEditable))?.id||'');}}).catch(err=>{if(active)setError(err.message);});
    return()=>{active=false;};
  },[selection,options,request]);
  const execute=async command=>{
    if(executing.current)return;executing.current=true;setBusy(true);setError('');setPending(command);
    try {await post(command.action,command.payload);setPending(null);const fresh=await request(url(command.scope));setData(fresh);if(command.action==='createArtistStock'){setName('');setQuantity('0');}}
    catch(err){setError(err.message);if(err.status>=400&&err.status<500)setPending(null);}
    finally{executing.current=false;setBusy(false);}
  };
  const send=(action,details)=>execute({action,scope:{...scope},payload:{ownerId:scope.ownerId,...(scope.boothId?{boothId:scope.boothId}:{}),...details,requestId:crypto.randomUUID()}});
  const disabled=busy||Boolean(pending);
  return <main className="page-content inventory-page account-page"><header className="inventory-page-header"><h1>제작자 재고</h1></header><section className="product-management account-content">
    {error&&<p role="alert" className="inventory-error">{error}</p>}
    {pending&&!busy&&<button className="management-add" onClick={()=>execute(pending)}>같은 요청 다시 확인</button>}
    <label>관리 제작자<select value={selection} onChange={e=>{setSelection(e.target.value);setError('');}} disabled={disabled}>{options.map(o=><option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
    {scope&&data&&<>
      {scope.boothId&&<label>부스 참여 코드<Input value={scope.boothId} readOnly/></label>}
      {!scope.boothId&&<form className="account-form" onSubmit={e=>{e.preventDefault();send('joinArtistBooth',{boothId:joinCode.trim()});}}><label>참여할 부스 코드<Input required value={joinCode} onChange={setJoinCode} disabled={disabled}/></label><button className="management-add" disabled={disabled}>부스 참여</button></form>}
      {data.participations?.filter(p=>p.status!=='ended').map(p=><div key={p.booth_id}><span>{p.name} · {p.status==='ending'?'잔여 재고·정산 정리 중':'참여 중'}</span><button type="button" className="management-back" disabled={disabled} onClick={()=>send('leaveArtistBooth',{boothId:p.booth_id})}>{p.status==='ending'?'참여 종료 재확인':'참여 종료'}</button></div>)}
      <article className="management-product"><div className="management-product-header"><h2>상품 등록</h2></div><form className="account-card-body account-form" onSubmit={e=>{e.preventDefault();send('createArtistStock',{name,price:Number(price),quantity:Number(quantity),...(projectId?{projectId}:{})});}}>
        <label>상품명<Input required maxLength={100} value={name} onChange={setName} disabled={disabled}/></label>
        <label>가격<Input type="number" min="0" step="1" required value={price} onChange={setPrice} disabled={disabled}/></label>
        <label>수량<Input type="number" min="0" step="1" required value={quantity} onChange={setQuantity} disabled={disabled}/></label>
        <label>행사<select value={projectId} onChange={e=>setProject(e.target.value)} disabled={disabled}><option value="">미배정</option>{data.events.filter(e=>e.operator||e.artistEditable).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <button className="management-add" disabled={disabled}>상품 등록</button>
      </form></article>
      {data.inventory.map(item=><StockItem key={`${selection}:${item.id}:${item.version}`} item={item} events={data.events} busy={disabled}
        onAdjust={(row,values)=>send('adjustArtistStock',{id:row.id,version:row.version,...values})}
        onLoss={(row,values)=>send('recordArtistStockLoss',{id:row.id,version:row.version,...values})}
        onAllocate={(row,values)=>send('setArtistAllocation',{id:row.id,version:row.version,...values})}/>)}
      {data.events.filter(e=>e.operator).map(event=><Schedule key={`${event.id}:${event.starts_on}:${event.ends_on}`} event={event} busy={disabled} onSave={values=>send('saveEventStockSchedule',values)}/>)}
      {data.history?.length>0&&<details><summary>재고 변경 이력</summary><ul>{data.history.map(row=><li key={row.id}>{new Date(row.at).toLocaleString('ko-KR')} · {row.actorId} · {row.name||''} · {{createArtistStock:'상품 등록',adjustArtistStock:'총재고 변경',setArtistAllocation:'행사 배정·회수',recordArtistStockLoss:'차감',joinArtistBooth:'부스 참여',leaveArtistBooth:'참여 종료'}[row.action]||row.action}
        {row.change&&` · ${row.change.reason==='receipt'?'입고':row.change.reason==='damage'?'파손':row.change.reason==='loss'?'분실':row.change.reason==='external'?'외부 판매':'정정'} · ${row.change.quantity??row.change.delta??row.change.after}개`}
        {row.changes.map((change,index)=><span key={index}> · {data.events.find(e=>e.id===change.projectId)?.name||'행사'} {change.before}→{change.after}개</span>)}
      </li>)}</ul></details>}
    </>}
  </section></main>;
}

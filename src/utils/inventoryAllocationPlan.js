export const inventoryEventStatus=(event,today)=>event.archived_at||event.closed_at||event.ends_on&&event.ends_on<today?'ended':event.starts_on&&event.starts_on>today?'upcoming':'active';
export function allocationPlan(item,events,total,quantities,today){
 const count=value=>value!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0&&Number(value)<=2147483647;
 const rows=events.map(event=>{const allocation=item.allocations.find(a=>a.projectId===event.id),initial=allocation?.initial||0,remaining=allocation?.remaining||0,sold=allocation?.sold||0;const value=quantities[event.id]??String(initial),quantity=Number(value),consumed=initial-remaining,status=inventoryEventStatus(event,today),changed=quantity!==initial;
 let error=!count(value)?'0 이상의 정수를 입력해주세요.':quantity<consumed?`판매·차감 수량 ${consumed}개보다 적게 배정할 수 없습니다.`:status==='ended'&&quantity>initial?'종료 행사는 회수만 가능합니다.':changed&&!(status==='ended'?event.canReturn:event.operator||event.artistEditable)?'이 행사 수량을 변경할 권한이 없습니다.':'';
 return {event,initial,remaining,sold,quantity,value,consumed,status,changed,error};});
 const delta=rows.reduce((n,r)=>n+(count(r.value)?r.quantity-r.initial:0),0),minimum=(item.minimumTotalStock??item.allocations.reduce((n,a)=>n+a.initial,0))+delta,warehouse=item.warehouse+(count(total)?Number(total):item.totalStock)-item.totalStock-delta;
 const totalError=!count(total)?'총재고는 0 이상의 정수여야 합니다.':Number(total)<minimum?`현재 배정 계획의 최소 총재고는 ${minimum}개입니다.`:'';
 if(warehouse<0)rows.filter(r=>r.quantity>r.initial&&!r.error).forEach(r=>{r.error=`미배정이 ${warehouse}개예요. 총재고나 다른 행사 배정을 확인해주세요.`;});
 return {rows,minimum,warehouse,totalError,changedCount:rows.filter(r=>r.changed).length+(Number(total)!==item.totalStock?1:0),valid:!totalError&&warehouse>=0&&rows.every(r=>!r.error)};
}

import { useEffect, useRef, useState } from 'react';

export function useProductReorder({ products, disabled, onSave }) {
  const [state,setState]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const drag=useRef(null),pending=useRef(false),active=useRef(false),frame=useRef(null);
  const order=products.map(product=>product.id),signature=JSON.stringify(order);
  const stopFrame=()=>{if(frame.current!==null){cancelAnimationFrame(frame.current);frame.current=null;}};
  const clear=()=>{
    const current=drag.current;drag.current=null;stopFrame();setState(null);
    if(current?.button?.hasPointerCapture?.(current.pointerId))current.button.releasePointerCapture(current.pointerId);
  };
  const cancel=()=>{if(drag.current){clear();setMessage('순서 변경을 취소했습니다.');}};
  useEffect(()=>{
    active.current=true;window.addEventListener('blur',cancel);
    return()=>{active.current=false;const current=drag.current;drag.current=null;stopFrame();if(current?.button?.hasPointerCapture?.(current.pointerId))current.button.releasePointerCapture(current.pointerId);window.removeEventListener('blur',cancel);};
  },[]);
  useEffect(()=>{if(drag.current&&(disabled||drag.current.signature!==signature))cancel();},[disabled,signature]);
  const setTarget=index=>{
    const current=drag.current;if(!current||current.to===index)return;
    current.to=index;setState({...current});
    if(index!==null)setMessage(`${current.name}: ${index+1}번 위치로 이동합니다.`);
  };
  const targetAt=(x,y)=>{
    const current=drag.current;
    const row=document.elementFromPoint(x,y)?.closest('[data-product-row]');
    if(!current||!row||!current.table?.contains(row))return null;
    const index=current.order.indexOf(row.dataset.productRow);return index<0?null:index;
  };
  const tick=()=>{
    const current=drag.current;if(!current?.point)return;
    const {x,y}=current.point,container=current.container;
    if(container){const rect=container.getBoundingClientRect();const delta=y<rect.top+48?-12:y>rect.bottom-48?12:0;if(delta)container.scrollTop+=delta;}
    setTarget(targetAt(x,y));frame.current=requestAnimationFrame(tick);
  };
  const begin=(product,extra={})=>{
    if(disabled||pending.current||drag.current)return false;
    const index=order.indexOf(product.id);if(index<0)return false;
    drag.current={id:product.id,name:product.name,from:index,to:index,order:[...order],signature,...extra};
    setState({...drag.current});setMessage(`${product.name} 순서 변경 중. 위아래로 이동한 뒤 놓으세요.`);return true;
  };
  const finish=async()=>{
    const current=drag.current;if(!current)return;
    clear();
    if(disabled||pending.current||current.to===null||current.to===current.from||current.signature!==signature)return;
    pending.current=true;setBusy(true);setMessage('상품 순서를 저장하고 있습니다.');
    try{const saved=await onSave({productId:current.id,saleNumber:current.to+1,expectedOrder:current.order});if(active.current)setMessage(saved?'상품 순서를 저장했습니다.':'순서를 저장하지 못했습니다. 최신 목록을 확인해주세요.');}
    catch(err){if(active.current)setMessage(err.message||'순서를 저장하지 못했습니다.');}
    finally{pending.current=false;if(active.current)setBusy(false);}
  };
  const handleProps=product=>({
    type:'button',disabled:disabled||busy,'aria-label':`${product.name} 순서 변경`,'aria-pressed':state?.id===product.id,
    onPointerDown:event=>{
      if(event.button!==0||event.isPrimary===false)return;
      const button=event.currentTarget;
      if(begin(product,{pointerId:event.pointerId,button,table:button.closest('table'),container:button.closest('.page-content'),point:{x:event.clientX,y:event.clientY}})){
        event.preventDefault();button.focus();button.setPointerCapture(event.pointerId);frame.current=requestAnimationFrame(tick);
      }
    },
    onPointerMove:event=>{if(drag.current?.pointerId===event.pointerId){event.preventDefault();drag.current.point={x:event.clientX,y:event.clientY};setTarget(targetAt(event.clientX,event.clientY));}},
    onPointerUp:event=>{if(drag.current?.pointerId===event.pointerId){event.preventDefault();setTarget(targetAt(event.clientX,event.clientY));return finish();}},
    onPointerCancel:cancel,onLostPointerCapture:cancel,
    onKeyDown:event=>{
      if(event.key==='Tab'){cancel();return;}
      if(event.key==='Escape'){event.preventDefault();cancel();return;}
      if([' ','Enter'].includes(event.key)){event.preventDefault();if(!drag.current)begin(product);else if(drag.current.id===product.id)return finish();return;}
      if(drag.current?.id===product.id&&['ArrowUp','ArrowDown','Home','End'].includes(event.key)){
        event.preventDefault();const current=drag.current;
        const target=event.key==='Home'?0:event.key==='End'?order.length-1:Math.max(0,Math.min(order.length-1,(current.to??current.from)+(event.key==='ArrowUp'?-1:1)));
        setTarget(target);document.querySelector(`[data-product-position="${target}"]`)?.scrollIntoView({block:'nearest'});
      }
    },
  });
  const rowProps=(product,index)=>({'data-product-row':product.id,'data-product-position':index,'data-dragging':state?.id===product.id||undefined,'data-drop-position':state?.to===index&&state.from!==index?(index>state.from?'after':'before'):undefined});
  return{state,busy,message,handleProps,rowProps};
}

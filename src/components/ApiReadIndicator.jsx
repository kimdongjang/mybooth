import {useEffect,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {apiReadTracker} from '../utils/apiReadTracker';

const serverSnapshot=()=>0;
export default function ApiReadIndicator() {
 const reading=useSyncExternalStore(apiReadTracker.subscribe,apiReadTracker.getSnapshot,serverSnapshot)>0;
 const [visible,setVisible]=useState(false),[target,setTarget]=useState(null);
 useEffect(()=>{
  if(!reading){setVisible(false);return;}
  const timer=setTimeout(()=>setVisible(true),150);
  return()=>clearTimeout(timer);
 },[reading]);
 useEffect(()=>{
  if(!reading||!visible)return;
  const update=()=>setTarget([...document.querySelectorAll('dialog[open]')].at(-1)||document.body);
  update();
  const observer=new MutationObserver(update);
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
  return()=>observer.disconnect();
 },[reading,visible]);
 if(!reading||!visible||typeof document==='undefined')return null;
 const portalTarget=target?.isConnected?target:document.body;
 return createPortal(<div className="api-read-indicator"><div className="api-read-indicator-card" role="status" aria-live="polite" aria-busy="true"><span className="inventory-loading-spinner" aria-hidden="true"/><span>불러오는 중…</span></div></div>,portalTarget);
}

import {useEffect,useRef,useState} from 'react';

export function useEventReadRefresh(request,enabled=true) {
 const [revision,setRevision]=useState(0);
 const enabledRef=useRef(enabled);
 enabledRef.current=enabled;
 useEffect(()=>{
  return request?.subscribe?.(()=>{if(enabledRef.current)setRevision(value=>value+1);});
 },[request]);
 return revision;
}

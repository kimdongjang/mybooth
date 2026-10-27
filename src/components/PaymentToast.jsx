import {useEffect} from 'react';
export default function PaymentToast({notice,onDismiss}){
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>onDismiss(null),4000);return()=>clearTimeout(timer);},[notice,onDismiss]);
 return <div className="payment-toast-region" role="status" aria-live="polite" aria-atomic="true">{notice&&<div className="payment-toast"><span>{notice.message}</span><button type="button" className="management-back" aria-label="결제 알림 닫기" onClick={()=>onDismiss(null)}>닫기</button></div>}</div>;
}

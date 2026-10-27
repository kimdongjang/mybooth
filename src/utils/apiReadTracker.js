const isApiRead=(url,options)=>{
 if(options?.background===true)return false;
 if(String(options?.method||'GET').toUpperCase()!=='GET')return false;
 try{return new URL(String(url),'https://local.invalid').pathname.startsWith('/api/');}catch{return false;}
};

export function createApiReadTracker() {
 let pending=0;
 const listeners=new Set();
 const notify=()=>{for(const listener of listeners)listener();};
 return {
  getSnapshot:()=>pending,
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  async run(url,options,operation){
   if(!isApiRead(url,options))return operation();
   pending++;notify();
   try{return await operation();}finally{pending--;notify();}
  },
 };
}

export const apiReadTracker=createApiReadTracker();

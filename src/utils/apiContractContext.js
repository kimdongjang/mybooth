// Memory only, bound to the exact login token. Stored offline payloads never
// pass through this helper and must keep their original ID/body for recovery.
export function createApiContractContext() {
  let currentToken=null,boothId=null,projects=new Map();
  return {
    prepare(token,url,options={}) {
      if(token!==currentToken){currentToken=token;boothId=null;projects=new Map();}
      if(!token||options.method!=='POST'||!/^\/api\/(pos|settlements)(?:\?|$)/.test(url))return options;
      const body=JSON.parse(options.body);
      if(url.startsWith('/api/pos')&&['updateProfile','updateCredentials','deleteAccount'].includes(body.action))return options;
      // Explicit caller scope always wins. Never mutate a caller's request.
      const scope=body.boothId||projects.get(body.projectId||body.payload?.projectId)||boothId;
      return scope?{...options,body:JSON.stringify({...body,boothId:scope})}:options;
    },
    observe(token,url,data) {
      if(token!==currentToken)return;
      if(url.includes('/api/booths?workspace=home'))for(const event of data?.events||[])projects.set(event.id,event.boothId);
      if(/^\/api\/pos(?:\?|$)/.test(url)&&data?.boothId)boothId=data.boothId;
    },
  };
}

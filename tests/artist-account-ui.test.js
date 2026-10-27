import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';

const nodes=node=>!node || typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
async function harness() {
  let cursor=0,mounted=false;
  const states=[],effects=[],calls=[];
  const data={profiles:[],booths:[],links:[],events:[]};
  const request=async(url,options)=>{
    if(!options)return data;
    const command=JSON.parse(options.body);calls.push(command);
    if(command.action==='previewArtistInvitation')return {invitation:{artistName:'제작자',boothName:'부스',expiresAt:'2099-01-01'}};
    if(command.action==='acceptArtistInvitation')return {linked:true};
    throw new Error('unexpected action');
  };
  const mocks={react:{useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useEffect:effect=>{if(!mounted)effects.push(effect);}},
    'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'},
    './PosUI':{Input:'Input'},'../utils/productDisplay':{won:String}};
  const context=vm.createContext({Date});
  const source=await readFile(new URL('../src/components/ArtistAccount.jsx',import.meta.url),'utf8');
  const module=new vm.SourceTextModule(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,{context});
  await module.link(specifier=>new vm.SyntheticModule(Object.keys(mocks[specifier]),function(){for(const[k,v]of Object.entries(mocks[specifier]))this.setExport(k,v);},{context}));
  await module.evaluate();
  const render=()=>{cursor=0;const result=nodes(module.namespace.default({request}));mounted=true;return result;};
  render();for(const effect of effects)effect();await new Promise(resolve=>setImmediate(resolve));
  return {render,calls};
}

test('artist linking UI previews first, requires consent and clears it when the invitation changes',async()=>{
  const h=await harness();
  const input=()=>h.render().find(n=>n.type==='Input'&&n.props.maxLength===64);
  input().props.onChange('a'.repeat(64));
  const form=h.render().find(n=>n.type==='form'&&nodes(n).some(child=>child.type==='button'&&child.props.children==='연결 내용 확인'));
  await form.props.onSubmit({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  const button=()=>h.render().find(n=>n.type==='button'&&n.props.children==='제작자 연결 수락');
  assert.equal(button().props.disabled,true);
  h.render().find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
  assert.equal(button().props.disabled,false);
  input().props.onChange('b'.repeat(64));assert.equal(button(),undefined);
  assert.deepEqual(h.calls.map(c=>c.action),['previewArtistInvitation']);
  await h.render().find(n=>n.type==='form'&&nodes(n).some(child=>child.type==='button'&&child.props.children==='연결 내용 확인')).props.onSubmit({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(button().props.disabled,true);
  h.render().find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
  await button().props.onClick();
  assert.deepEqual(h.calls.at(-1),{action:'acceptArtistInvitation',payload:{token:'b'.repeat(64),acceptSharedStock:true,allowOperatorStock:true}});
  assert.equal(input().props.value,'');assert.equal(button(),undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as React from 'react';
import {renderToString} from 'react-dom/server';
test('unsaved changes hook renders with the same React runtime as React DOM',async()=>{
 const context=vm.createContext({});const module=new vm.SourceTextModule(await readFile(new URL('../src/hooks/useUnsavedChanges.js',import.meta.url),'utf8'),{context});
 await module.link(name=>{const exports=name==='react'?React:{confirmAction:async()=>true};return new vm.SyntheticModule(Object.keys(exports),function(){for(const[k,v]of Object.entries(exports))this.setExport(k,v);},{context});});await module.evaluate();
 function Screen(){module.namespace.useUnsavedChanges(true);return React.createElement('span',null,'ready');}
 assert.equal(renderToString(React.createElement(Screen)),'<span>ready</span>');
});

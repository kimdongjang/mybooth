import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync,strFromU8 } from 'fflate';
import { columns,exampleWorkbook,readProducts } from '../src/utils/productWorkbook.js';
test('example XLSX contains linked workbook, named columns, zero-safe input schema and no formulas',()=>{
 const files=unzipSync(exampleWorkbook());
 assert.ok(files['[Content_Types].xml']);assert.ok(files['_rels/.rels']);
 const sheet=strFromU8(files['xl/worksheets/sheet1.xml']);
 for(const [,name] of columns)assert.ok(sheet.includes(`<t>${name}</t>`));
 assert.equal((sheet.match(/<row /g)||[]).length,2);
 assert.equal((sheet.match(/<c /g)||[]).length,16);
 assert.ok(strFromU8(files['xl/_rels/workbook.xml.rels']).includes('worksheets/sheet1.xml'));
 assert.ok(!sheet.includes('<f>'));assert.ok(sheet.includes('width="22"'));
});
test('oversized spreadsheet is rejected before reading or decompressing its data',async()=>{
 await assert.rejects(readProducts({size:5*1024*1024+1,arrayBuffer(){throw new Error('must not read');}}),/5MB/);
});

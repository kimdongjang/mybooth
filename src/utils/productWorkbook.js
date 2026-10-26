import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
export const columns=[['name','상품명'],['goodsType','굿즈 종류'],['vtuberName','캐릭터'],['creatorName','제작자'],['genre','작품/시리즈'],['stock','재고'],['price','판매가'],['cost','원가']];
const xml=s=>new DOMParser().parseFromString(s,'application/xml');
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export function exampleWorkbook(){
 const rows=[columns.map(c=>c[1]),['딸기 키링','키링','딸기','제작자명','오리지널',10,5000,2000]];
 const files={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
 '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
 'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="상품 등록" sheetId="1" r:id="rId1"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
 'xl/worksheets/sheet1.xml':'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="8" width="22" customWidth="1"/></cols><sheetData>'+rows.map((row,i)=>`<row r="${i+1}">`+row.map((v,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`).join('')+'</row>').join('')+'</sheetData></worksheet>'};
 return zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)])));
}
export async function readProducts(file){
 if(file.size>5*1024*1024) throw new Error('엑셀 파일은 5MB 이하로 선택해주세요.');
 let expandedSize=0;
 const files=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>{expandedSize+=entry.originalSize;if(entry.originalSize>10*1024*1024 || expandedSize>20*1024*1024) throw new Error('압축 해제 크기가 너무 큽니다.');return /^(xl\/(worksheets\/[^/]+\.xml|sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml.rels))$/.test(entry.name);}});
 const read=name=>{if(!files[name]) throw new Error('올바른 XLSX 파일이 아닙니다.');const doc=xml(strFromU8(files[name]));if(doc.querySelector('parsererror'))throw new Error('엑셀 XML을 읽을 수 없습니다.');return doc;};
 const strings=files['xl/sharedStrings.xml']?[...read('xl/sharedStrings.xml').getElementsByTagName('si')].map(el=>el.textContent):[];
 const sheet=read('xl/workbook.xml').getElementsByTagName('sheet')[0];
 const rel=[...read('xl/_rels/workbook.xml.rels').getElementsByTagName('Relationship')].find(r=>r.getAttribute('Id')===sheet?.getAttribute('r:id'));
 const target=rel?.getAttribute('Target') || 'worksheets/sheet1.xml';
 const path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');
 const rows=[...read(path).getElementsByTagName('row')].map(row=>{const values=[];for(const c of row.getElementsByTagName('c')){const ref=c.getAttribute('r')?.match(/^[A-Z]+/)?.[0];if(!ref)continue;const index=[...ref].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1;const type=c.getAttribute('t');const value=type==='inlineStr'?c.getElementsByTagName('is')[0]?.textContent:c.getElementsByTagName('v')[0]?.textContent;values[index]=type==='s'?strings[Number(value)]:value || '';if(c.getElementsByTagName('f').length)throw new Error('수식 대신 값을 입력해주세요.');}return values;}).filter(row=>row.some(v=>String(v).trim()));
 if(rows.length<2 || rows.length>501) throw new Error('상품은 1~500행까지 입력해주세요.');
 const header=rows.shift();if(columns.some((c,i)=>header[i]!==c[1]))throw new Error('예시 파일의 열 제목과 순서를 유지해주세요.');
 return rows.map(row=>({...Object.fromEntries(columns.map(([key],i)=>[key,['stock','price','cost'].includes(key)?Number(row[i] || 0):String(row[i] || '')])),id:crypto.randomUUID(),version:-1}));
}

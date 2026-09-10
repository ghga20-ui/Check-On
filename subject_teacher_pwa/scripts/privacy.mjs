import { readFileSync, writeFileSync } from 'node:fs';
const escape = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const documents = [
 ['privacy-policy','privacy','개인정보처리방침'],
 ['getting-started','getting-started','동료 교사용 이용 안내'],
 ['school-guide','school-guide','학교 담당자용 데이터 처리 안내'],
];
for (const [source, route, title] of documents) {
 const doc = JSON.parse(readFileSync(new URL(`../src/${source}.json`, import.meta.url), 'utf8'));
 const nav = documents.map(([,url,label])=>`<a href="/${url}.html">${escape(label)}</a>`).join(' · ');
 const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>체크온 ${escape(title)}</title><style>body{max-width:760px;margin:32px auto;padding:0 24px;font:16px/1.8 sans-serif;color:#172a28}h1{font-size:28px}h2{font-size:20px;margin-top:32px}a{color:#14655a}nav{font-size:14px}section{break-inside:avoid}@media print{nav{display:none}body{margin:0;max-width:none;font-size:11pt}h2{margin-top:18px}}</style></head><body><nav aria-label="안내 문서"><a href="/">체크온 홈</a> · ${nav}</nav><main><h1>${escape(title)}</h1><p>체크온 · 최종 개정 ${doc.updated}</p>${doc.sections.map(([t,b],i)=>`<section><h2>${i+1}. ${escape(t)}</h2><p>${escape(b)}</p></section>`).join('')}</main><footer><p>Jun.P · <a href="mailto:ghga20@gmail.com">ghga20@gmail.com</a></p></footer></body></html>\n`;
 const md = `# 체크온 ${title}\n\n최종 개정: ${doc.updated}\n\n` + doc.sections.map(([t,b],i)=>`## ${i+1}. ${t}\n\n${b}\n`).join('\n');
 for (const [path, value] of [[`../public/${route}.html`,html],[`../../docs/legal/${source}.md`,md]]) {
  const url = new URL(path, import.meta.url);
  if(process.argv.includes('--check')) { if(readFileSync(url,'utf8').replaceAll('\r\n', '\n')!==value.replaceAll('\r\n', '\n')) throw new Error('안내가 원본과 다릅니다: '+path); }
  else writeFileSync(url,value);
 }
}

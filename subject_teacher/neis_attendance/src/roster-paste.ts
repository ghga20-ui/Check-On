import {validateMixedRows,type MixedStudent} from './mixed-class';
export function parseMixedPaste(text:string,grade:number):MixedStudent[]{
  const lines=text.split(/\r?\n/).filter(line=>line.trim());
  if(lines.length&&/^(원소속\s*반|반|학급)\s/.test(lines[0].trim()))lines.shift();
  const rows=lines.map((line,index)=>{
    const cells=(line.includes('\t')?line.split('\t'):line.trim().split(/\s+/)).map(c=>c.trim());
    if(cells.length<2||!/^\d+$/.test(cells[0])||!/^\d+$/.test(cells[1]))throw new Error(`${index+1}행: 반·번호·이름 순서로 붙여넣어 주세요.`);
    return {grade,homeClassNo:String(Number(cells[0])),number:Number(cells[1]),name:cells.slice(2).join(' ')};
  });
  if(!rows.length)throw new Error('붙여넣을 명단을 입력해 주세요.');
  const error=validateMixedRows(rows,grade).find(Boolean);
  if(error)throw new Error(error);
  return rows;
}

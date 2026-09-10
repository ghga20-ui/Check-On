import { useState } from "react";
import { Icon } from "./components";
import policy from "../../../subject_teacher_pwa/src/privacy-policy.json";
import guide from "../../../subject_teacher_pwa/src/getting-started.json";
import school from "../../../subject_teacher_pwa/src/school-guide.json";
const documents = [{...policy, title:"개인정보처리방침"}, guide, school];
export function PrivacyPolicy({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState(0);
  const doc = documents[selected];
  return <div className="ob-overlay" role="dialog" aria-modal="true" aria-label={doc.title}>
    <div className="ob-card"><div className="ob-head"><div className="ob-head-text">
      <h2>{doc.title}</h2><div className="ob-sub">체크온 · 최종 개정 {doc.updated}</div></div>
      <button className="ob-x" onClick={onClose} aria-label="닫기"><Icon name="x" size={18}/></button></div>
      <div className="policy-body"><nav aria-label="안내 선택" style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {documents.map((item,i)=><button type="button" className="tb-btn" key={item.title} aria-pressed={i === selected} onClick={()=>setSelected(i)}>{item.title}</button>)}
      </nav>{doc.sections.map(([title,body],i)=><section key={title}><h3>{i+1}. {title}</h3><p>{body}</p></section>)}</div>
      <div className="ob-actions"><button className="tb-btn primary" onClick={onClose}>닫기</button></div>
    </div></div>;
}

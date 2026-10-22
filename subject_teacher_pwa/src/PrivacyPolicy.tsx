import { useState } from "react";
import policy from "./privacy-policy.json";
import guide from "./getting-started.json";
import school from "./school-guide.json";
import "./entry.css";
const documents = [{...policy, title:"개인정보처리방침"}, guide, school];
export function PrivacyPolicy({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState(0);
  const doc = documents[selected];
  return <div className="sheet" role="dialog" aria-modal="true" aria-label={doc.title}>
    <div className="sheet-panel policy-panel"><div className="grabber" />
      <div className="sheet-head"><div><p className="muted">체크온 · 최종 개정 {doc.updated}</p><h2>{doc.title}</h2></div>
        <button className="icon-btn" type="button" onClick={onClose} aria-label="닫기">×</button></div>
      <div className="policy-body">
        <nav aria-label="안내 선택" style={{display:"flex",flexWrap:"wrap",gap:12}}>{documents.map((item, i) =>
          <button className="policy-link" type="button" key={item.title} aria-pressed={i === selected} onClick={() => setSelected(i)}>{item.title}</button>)}</nav>
        {doc.sections.map(([title, body], i) => <section key={title}><h3>{i + 1}. {title}</h3><p>{body}</p></section>)}
      </div>
    </div></div>;
}

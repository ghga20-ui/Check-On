import React, { useEffect, useRef } from "react";
import { Icon } from "./components";
export function focusLastRosterInput(selector:string){
  requestAnimationFrame(()=>{const input=window.document.querySelector<HTMLInputElement>(`${selector} tbody tr:last-child input`);input?.focus();input?.scrollIntoView?.({block:'nearest'});});
}
export function rosterEnter(event:React.KeyboardEvent<HTMLTableElement>,append:()=>void){
  if(event.key!=='Enter'||event.nativeEvent.isComposing||!(event.target instanceof HTMLInputElement))return;
  event.preventDefault();
  const inputs=Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('tbody input'));
  const next=inputs[inputs.indexOf(event.target)+1];
  if(next){next.focus();next.scrollIntoView?.({block:'nearest'});}else append();
}
export function ManagementDialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const nodes = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') || []);
    nodes()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if(e.key === "Escape") closeRef.current();
      if(e.key !== "Tab") return;
      const list=nodes(), first=list[0], last=list.at(-1);
      if(e.shiftKey && document.activeElement===first){e.preventDefault();last?.focus();}
      if(!e.shiftKey && document.activeElement===last){e.preventDefault();first?.focus();}
    };
    const node=ref.current;node?.addEventListener("keydown",key);
    return ()=>{node?.removeEventListener("keydown",key);previous?.focus();};
  }, []);
  return <div className="mg-scrim"><div ref={ref} className="mg-dialog" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className="mg-icon" aria-label="닫기" onClick={onClose}><Icon name="x" size={18}/></button></header>{children}</div></div>;
}

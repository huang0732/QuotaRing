'use strict';
const {pickCodexSnapshot}=require('../agent.cjs');

// Read only the original five-hour and weekly windows. Do not infer a reset
// from the percentage, localized date strings, or an unrelated quota window.
function readResetTimes(response) {
  const snapshot=pickCodexSnapshot(response);
  const windows=[snapshot?.primary,snapshot?.secondary].filter(Boolean);
  const timestamp=window=>Number.isFinite(window?.resetsAt)&&window.resetsAt>0&&
    Number.isFinite(new Date(window.resetsAt*1000).getTime())?window.resetsAt:null;
  return {
    fiveHour:timestamp(windows.find(w=>w.windowDurationMins===300)),
    weekly:timestamp(windows.find(w=>Number.isFinite(w.windowDurationMins)&&w.windowDurationMins>=10080&&w.windowDurationMins%10080===0))
  };
}

// Also serialized into the local panel page; keep this function self-contained.
function remainingResetUnits(resetsAt,unitSeconds,total,now=Date.now()) {
  if(!Number.isFinite(resetsAt)||resetsAt<=0||!Number.isFinite(new Date(resetsAt*1000).getTime())||
    !Number.isFinite(unitSeconds)||unitSeconds<=0||!Number.isInteger(total)||total<=0||!Number.isFinite(now))return null;
  return Math.min(total,Math.max(0,Math.ceil((resetsAt*1000-now)/(unitSeconds*1000))));
}

// The original hidden label remains available to the original tooltip renderer.
// Only the taskbar page adds these sibling indicators; the details page is intact.
function installResetIndicators() {
  if(document.documentElement.classList.contains('details'))return {update(){},refresh(){return false;},status(){return [];}};
  const badge=document.getElementById('codex-usage-badge');
  let current=null;
  const entries=[...badge.querySelectorAll('.usage-primary,.usage-secondary')].map(meter=>{
    const node=document.createElement('span');node.className='usage-reset-progress';node.setAttribute('role','img');meter.appendChild(node);
    return {meter,node,signature:null,info:null};
  });
  function refresh() {
    const stale=!current||current.stale||window.__codexUsageBadge.status().stale;
    let changed=false;
    for(const entry of entries) {
      const label=entry.meter.querySelector('.usage-window').textContent;
      const spec=label==='5h额度'?{key:'fiveHour',kind:'hours',unit:3600,total:5,name:'小时'}:
        label==='周额度'?{key:'weekly',kind:'days',unit:86400,total:7,name:'天'}:null;
      const count=!stale&&spec?remainingResetUnits(current.resetTimes?.[spec.key],spec.unit,spec.total):null;
      const color=entry.meter.querySelector('.usage-ring-value').style.stroke||'var(--usage-muted-color)';
      const signature=[label,spec?.kind,count,color].join('|');
      entry.info={label,kind:spec?.kind??'unknown',total:spec?.total??null,lit:count};
      if(signature===entry.signature)continue;
      entry.signature=signature;changed=true;
      const node=entry.node;node.style.setProperty('--reset-color',color);
      node.dataset.kind=spec?.kind??'unknown';node.dataset.known=String(count!==null);
      if(count===null) {
        node.textContent='—';node.removeAttribute('data-lit');
        node.setAttribute('aria-label',label+'：重置时间未知');
      } else {
        if(node.children.length!==spec.total) {
          node.replaceChildren(...Array.from({length:spec.total},()=>{
            const slot=document.createElement('span');slot.className='usage-reset-slot';slot.setAttribute('aria-hidden','true');return slot;
          }));
        }
        [...node.children].forEach((slot,index)=>slot.classList.toggle('is-lit',index<count));
        node.dataset.lit=String(count);
        node.setAttribute('aria-label',label+'：距重置 '+count+spec.name+'（向上取整）');
      }
    }
    return changed;
  }
  return {
    update(value){current=value;return refresh();},refresh,
    status(){return entries.filter(entry=>!entry.meter.hidden).map(entry=>({...entry.info}));}
  };
}
module.exports={readResetTimes,remainingResetUnits,installResetIndicators};

'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {panelHtml}=require('../windows/panel/page.cjs');const {formatRateLimits}=require('../agent.cjs');
const {readResetTimes}=require('../windows/reset-time.cjs');
test('taskbar page keeps quota content and sends click toggles instead of hover commands',async()=>{
  const {JSDOM}=await import('jsdom');const messages=[],listeners=[];
  const dom=new JSDOM(panelHtml(),{url:'https://codex-usage-card.local/panel.html?view=badge',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.ResizeObserver=class{observe(){} unobserve(){} disconnect(){}};
  w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:0,top:0,right:136,bottom:38,width:136,height:38};};
  w.chrome={webview:{postMessage:m=>messages.push(m),addEventListener:(type,fn)=>listeners.push(fn)}};
  try {
    w.eval(w.document.querySelector('script').textContent);
    const badge=w.document.querySelector('#codex-usage-badge');assert.equal(badge.hidden,false);
    const value=formatRateLimits({rateLimits:{planType:'plus',primary:{usedPercent:2,windowDurationMins:300},secondary:{usedPercent:75,windowDurationMins:10080}},rateLimitResetCredits:{availableCount:0}});
    listeners[0]({data:{type:'usage',value:{...value,updatedAt:Date.now(),stale:false}}});
    assert.deepEqual([...badge.querySelectorAll('.usage-number')].map(e=>e.textContent),['98%','25%']);
    assert.deepEqual([...badge.querySelectorAll('.usage-window')].map(e=>e.textContent),['5h额度','周额度']);
    assert.equal(w.getComputedStyle(badge).flexDirection,'row');
    listeners[0]({data:{type:'layout-config',height:28}});
    assert.equal(w.document.documentElement.style.getPropertyValue('--panel-height'),'28px');
    assert.ok(parseFloat(w.document.documentElement.style.getPropertyValue('--panel-ring'))<=28-6);
    assert.deepEqual([...badge.querySelectorAll('.usage-number')].map(e=>e.textContent),['98%','25%']);
    badge.dispatchEvent(new w.MouseEvent('mouseenter'));await new Promise(r=>setTimeout(r,400));
    assert.equal(messages.some(m=>m.type==='toggle-details'||m.type==='hover'),false);
    badge.click();assert.equal(messages.at(-1).type,'toggle-details');
    badge.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(messages.at(-1).type,'close-details');
    listeners[0]({data:{type:'details-state',open:true}});assert.equal(badge.getAttribute('aria-expanded'),'true');
    assert.match(w.document.querySelector('#codex-usage-tooltip').textContent,/Codex 剩余额度/);
    assert.match(w.document.querySelector('#codex-usage-tooltip').textContent,/重置卡：0 张可用/);
  }finally{w.close();}
});
test('taskbar time indicators count time independently of quota, tick locally, and leave the details unchanged',async()=>{
  const {JSDOM}=await import('jsdom');let now=Date.UTC(2026,9,30,12)+999;
  const messages=[],listeners=[],timers=[];
  const dom=new JSDOM(panelHtml(),{url:'https://codex-usage-card.local/panel.html?view=badge',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.Date.now=()=>now;w.setInterval=(fn,ms)=>{timers.push({fn,ms});return timers.length;};
  w.ResizeObserver=class{observe(){} unobserve(){} disconnect(){}};
  w.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,right:136,bottom:38,width:136,height:38});
  w.chrome={webview:{postMessage:m=>messages.push(m),addEventListener:(type,fn)=>listeners.push(fn)}};
  try {
    w.eval(w.document.querySelector('script').textContent);
    const data={rateLimits:{planType:'plus',primary:{usedPercent:89,windowDurationMins:300,resetsAt:(now+4*3600000+1)/1000},secondary:{usedPercent:14,windowDurationMins:10080,resetsAt:(now+6*86400000+1)/1000}},rateLimitResetCredits:{availableCount:0}};
    const value={...formatRateLimits(data),resetTimes:readResetTimes(data),updatedAt:now,stale:false};
    const receive=value=>listeners[0]({data:{type:'usage',value}});
    receive(value);
    const groups=[...w.document.querySelectorAll('.usage-reset-progress')];
    assert.deepEqual(groups.map(g=>g.children.length),[5,7]);
    assert.deepEqual(groups.map(g=>g.querySelectorAll('.is-lit').length),[5,7]);
    assert.deepEqual([...w.document.querySelectorAll('.usage-number')].map(e=>e.textContent),['11%','86%']);
    assert.equal(w.getComputedStyle(w.document.querySelector('.usage-window')).visibility,'hidden');
    assert.equal(groups[0].style.getPropertyValue('--reset-color'),w.document.querySelector('.usage-ring-value').style.stroke);
    const originalCard=w.document.querySelector('#codex-usage-tooltip').innerHTML;
    now++;timers.filter(t=>t.ms===1000).forEach(t=>t.fn());
    assert.deepEqual(groups.map(g=>g.querySelectorAll('.is-lit').length),[4,6]);
    assert.equal(w.document.querySelector('#codex-usage-tooltip').innerHTML,originalCard);
    receive({...value,resetTimes:{fiveHour:null,weekly:null},updatedAt:now});
    assert.deepEqual(groups.map(g=>g.textContent),['—','—']);
    receive({...value,resetTimes:{fiveHour:now/1000,weekly:now/1000},updatedAt:now});
    assert.deepEqual(groups.map(g=>g.children.length),[5,7]);
    assert.deepEqual(groups.map(g=>g.querySelectorAll('.is-lit').length),[0,0]);
    receive({...value,updatedAt:now,stale:true});assert.deepEqual(groups.map(g=>g.textContent),['—','—']);
    receive({...value,updatedAt:now,stale:false});now+=151000;timers.filter(t=>t.ms===1000).forEach(t=>t.fn());
    assert.deepEqual(groups.map(g=>g.textContent),['—','—']);
  }finally{w.close();}
});
test('details page retains its original labels and contains no countdown indicators',async()=>{
  const {JSDOM}=await import('jsdom');const listeners=[];
  const dom=new JSDOM(panelHtml(),{url:'https://codex-usage-card.local/panel.html?view=details',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.ResizeObserver=class{observe(){} unobserve(){} disconnect(){}};
  w.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,right:204,bottom:167,width:204,height:167});
  w.chrome={webview:{postMessage(){},addEventListener:(type,fn)=>listeners.push(fn)}};
  try {w.eval(w.document.querySelector('script').textContent);
    const value=formatRateLimits({rateLimits:{planType:'plus',primary:{usedPercent:89,windowDurationMins:300},secondary:{usedPercent:14,windowDurationMins:10080}},rateLimitResetCredits:{availableCount:2,credits:[{status:'available',resetType:'codexRateLimits',expiresAt:1793800000}]}});
    listeners[0]({data:{type:'usage',value:{...value,updatedAt:Date.now(),stale:false}}});
    assert.equal(w.document.querySelectorAll('.usage-reset-progress').length,0);
    assert.deepEqual([...w.document.querySelectorAll('.usage-tooltip-label')].map(e=>e.textContent),['5h额度','周额度']);
    assert.match(w.document.querySelector('#codex-usage-tooltip').textContent,/重置卡：2 张可用/);
    assert.match(w.document.querySelector('#codex-usage-tooltip').textContent,/最近到期：/);
  }finally{w.close();}
});

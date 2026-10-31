'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const readline=require('node:readline');
const {spawn,execFileSync}=require('node:child_process');const {once}=require('node:events');
const {formatRateLimits}=require('../agent.cjs');
const {readResetTimes}=require('../windows/reset-time.cjs');
test('native taskbar host: original labels, horizontal layout, popup growth for reset credits, hide/restore, clean exit',{
  skip:process.platform!=='win32',timeout:45000
},async t=>{
  const root=path.resolve(__dirname,'..'),binary=path.join(root,'windows/panel/bin/CodexUsagePanel.exe');
  assert.match(execFileSync(binary,['--self-test'],{encoding:'utf8',windowsHide:true}),/PASS/);
  const profile=fs.mkdtempSync(path.join(root,'.test-panel-'));
  const child=spawn(binary,['--profile',profile,'--parent',String(process.pid),'--test-host'],{windowsHide:false,stdio:['pipe','pipe','pipe']});
  const lines=readline.createInterface({input:child.stdout});let state=null;const errors=[];
  lines.on('line',line=>{const m=JSON.parse(line);if(m.type==='status')state=m;else errors.push(m);});
  child.stdin.on('error',()=>{});child.stderr.resume();
  const exited=once(child,'exit');
  const send=m=>child.stdin.write(JSON.stringify(m)+'\n');
  const wait=async predicate=>{const end=Date.now()+20000;while(Date.now()<end){
    assert.deepEqual(errors,[]);assert.equal(child.exitCode,null,'host exited unexpectedly');
    if(predicate(state))return state;await new Promise(r=>setTimeout(r,100));
  }throw Error('Panel state timed out: '+JSON.stringify(state));};
  try {
    const now=Math.floor(Date.now()/1000);
    const response={rateLimits:{planType:'plus',primary:{usedPercent:66,windowDurationMins:300,resetsAt:now+4*3600+120},secondary:{usedPercent:72,windowDurationMins:10080,resetsAt:now+6*86400+120}},rateLimitResetCredits:{availableCount:0}};
    const value={...formatRateLimits(response),resetTimes:readResetTimes(response)};
    send({type:'usage',value:{...value,updatedAt:Date.now(),stale:false}});
    await wait(s=>s?.ready&&s.nativeVisible&&!s.stale&&s.labels.length===2&&s.rendering?.badgeFits&&s.badgeTimeFits&&s.indicators?.length===2);
    assert.deepEqual(state.labels,['5h额度','周额度']);assert.equal(state.title,'Codex 剩余额度');
    assert.deepEqual(state.indicators.map(i=>[i.kind,i.total,i.lit]),[['hours',5,5],['days',7,7]]);
    assert.equal(state.bounds.height,Math.ceil(state.rendering.badgeContent.height*state.rendering.badgePixelRatio));
    assert.equal(state.bounds.width,Math.ceil(state.rendering.badgeContent.width*state.rendering.badgePixelRatio));
    assert.ok(state.bounds.y>=state.taskbarBounds.y);assert.ok(state.bounds.y+state.bounds.height<=state.taskbarBounds.y+state.taskbarBounds.height);
    send({type:'test',scenario:'click'});await wait(s=>s?.tooltipVisible&&s.rendering?.detailsFits&&s.rendering?.detailsTextFits);
    assert.equal(state.detailsBounds.width,Math.ceil(state.rendering.detailsContent.width*state.rendering.badgePixelRatio));
    assert.ok(state.rendering.detailsContent.width<300,'card should shrink to its content');
    assert.ok(state.detailsBounds.y+state.detailsBounds.height<state.bounds.y);
    assert.ok(Math.abs(state.detailsBounds.x+state.detailsBounds.width/2-state.bounds.x-state.bounds.width/2)<=1);
    const initial={...state.detailsBounds};
    const expiresAt=Math.floor(Date.now()/1000)+86400;
    const withCredits={...formatRateLimits({...response,rateLimitResetCredits:{availableCount:2,credits:[
      {status:'available',resetType:'codexRateLimits',expiresAt},
      {status:'available',resetType:'codexRateLimits',expiresAt:expiresAt+86400}
    ]}}),resetTimes:value.resetTimes};
    assert.match(withCredits.title,/重置卡：2 张可用\n最近到期：/);
    send({type:'usage',value:{...withCredits,updatedAt:Date.now(),stale:false}});
    await wait(s=>s?.tooltipVisible&&s.detailsBounds.height>initial.height&&s.rendering?.detailsFits&&s.rendering?.detailsTextFits);
    assert.equal(state.detailsBounds.width,initial.width);
    assert.ok(state.detailsBounds.y<initial.y);
    assert.equal(state.detailsBounds.y+state.detailsBounds.height,initial.y+initial.height);
    assert.ok(state.detailsBounds.height>=Math.ceil(state.rendering.detailsContent.height*state.rendering.detailsPixelRatio));
    t.diagnostic('Popup width '+initial.width+' physical pixels; reset-credit expiry expands height '+initial.height+' -> '+state.detailsBounds.height+' at '+state.rendering.detailsPixelRatio+'x rendering; text and content fit.');
    send({type:'usage',value:{...value,updatedAt:Date.now(),stale:false}});
    await wait(s=>s?.detailsBounds.height===initial.height&&s.rendering?.detailsFits);
    send({type:'test',scenario:'click'});await wait(s=>!s?.tooltipVisible);
    send({type:'test',scenario:'click'});await wait(s=>s?.tooltipVisible);
    send({type:'test',scenario:'fullscreen'});await wait(s=>s?.hiddenReason==='fullscreen'&&!s.nativeVisible&&!s.tooltipVisible);
    send({type:'test',scenario:'normal'});await wait(s=>s?.nativeVisible&&s.hiddenReason==='');
    send({type:'test',scenario:'taskbar-hidden'});await wait(s=>s?.hiddenReason==='taskbar-hidden'&&!s.nativeVisible);
    send({type:'test',scenario:'normal'});await wait(s=>s?.nativeVisible&&s.hiddenReason==='');
    // EOF must close only this panel and its WebView environment.
    child.stdin.end();await exited;assert.equal(child.exitCode,0);
  } finally {
    if(child.exitCode===null){send({type:'shutdown'});child.stdin.end();await exited;}
    lines.close();assert.ok(profile.startsWith(root+path.sep+'.test-panel-'));
    await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});

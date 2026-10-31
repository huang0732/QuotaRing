'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {once}=require('node:events');
const agent=require('../agent.cjs');
const response=(plan='plus')=>({rateLimits:{limitId:'codex',planType:plan,
  primary:{usedPercent:18,windowDurationMins:300,resetsAt:1793356800},
  secondary:{usedPercent:64,windowDurationMins:10080,resetsAt:1793788800}}});
test('Plus uses fixed 5h and weekly rings; Pro and other plans keep the original single-ring rule',()=>{
  assert.deepEqual(agent.formatRateLimits(response()).rings.map(r=>r.percent),[82,36]);
  assert.deepEqual(agent.formatRateLimits(response()).rings.map(r=>r.label),['5h额度','周额度']);
  assert.equal(agent.formatRateLimits(response()).title.split('\n')[0],'Codex 剩余额度');
  for(const plan of ['pro','pro_20x']) {
    const value=agent.formatRateLimits(response(plan));
    assert.equal(value.mode,'single');assert.equal(value.percent,36);assert.equal(value.windowLabel,'周');
  }
  assert.equal(agent.formatRateLimits(response('business')).mode,'single');
  assert.equal(agent.formatRateLimits(response('business')).percent,82);
});
test('missing expected quota windows do not fall back to the first available window',()=>{
  const pro=response('pro');pro.rateLimits.secondary=null;
  assert.equal(agent.formatRateLimits(pro).percent,null);
  const plus=response();plus.rateLimits.primary=null;
  let value=agent.formatRateLimits(plus);
  assert.equal(value.mode,'dual');assert.equal(value.percent,null);
  assert.deepEqual(value.rings.map(r=>r.percent),[null,36]);
  for(const plan of ['plus','pro','business']) {
    const data={rateLimits:{planType:plan,primary:{usedPercent:12,windowDurationMins:60},secondary:null}};
    value=agent.formatRateLimits(data);assert.equal(value.percent,null);
    if(plan==='plus') assert.deepEqual(value.rings.map(r=>r.percent),[null,null]);
  }
  const unknown=response('');unknown.rateLimits.primary=null;
  assert.equal(agent.formatRateLimits(unknown).percent,36); // The upstream unknown-plan rule.
});
test('quota retains zero and bounds and keeps the missing Plus ring visible as unavailable',()=>{
  const data=response(); data.rateLimits.secondary=null; data.rateLimits.primary.usedPercent=100;
  assert.equal(agent.formatRateLimits(data).percent,0);
  assert.deepEqual(agent.formatRateLimits(data).rings.map(r=>r.percent),[0,null]);
  data.rateLimits.primary.usedPercent=110; assert.equal(agent.formatRateLimits(data).percent,0);
  data.rateLimits.primary.usedPercent=-8; assert.equal(agent.formatRateLimits(data).percent,100);
  data.rateLimits.primary.usedPercent='12'; assert.equal(agent.formatRateLimits(data).percent,null);
});
test('keyed Codex bucket is authoritative; other-model or absent data is unavailable',()=>{
  const data=response(); data.rateLimitsByLimitId={codex:null};
  assert.equal(agent.formatRateLimits(data).percent,null);
  assert.equal(agent.formatRateLimits({rateLimits:{limitId:'other',primary:{usedPercent:1}}}).percent,null);
  assert.equal(agent.formatRateLimits(null).percent,null);
  assert.equal(agent.formatRateLimits({}).percent,null);
  const stale=agent.unavailableValue(agent.formatRateLimits(response()));
  assert.equal(stale.stale,true); assert.ok(stale.rings.every(r=>r.percent===null));
});
test('only main Codex windows are selected and foreign CDP endpoints are rejected',async()=>{
  assert.equal(agent.isMainWindow({url:'app://-/index.html'}),true);
  for(const url of ['https://example.com/index.html','app://-/index.html?overlay=1','app://-/other.html']) assert.equal(agent.isMainWindow({url}),false);
  for(const url of ['ws://example.com:39222/devtools/page/1','ws://127.0.0.1:9999/devtools/page/1','ws://user@127.0.0.1:39222/devtools/page/1','wss://localhost:39222/']) {
    await assert.rejects(new agent.CdpSession({webSocketDebuggerUrl:url}).connect(),/loopback/);
  }
});
test('stdio handshake, delta updates, account changes, errors, timeout and shutdown',async()=>{
  const client=new agent.AppServerClient({command:process.execPath,args:[path.join(__dirname,'fake-app-server.cjs')],requestTimeoutMs:5000});
  try {
    await client.start();
    assert.equal(agent.formatRateLimits(client.rateLimits).percent,80);
    const delta=once(client,'rate-limits'); await client.request('test/delta'); await delta;
    assert.deepEqual(agent.formatRateLimits(client.rateLimits).rings.map(r=>r.percent),[70,40]);
    const change=once(client,'account-changed'); await client.request('test/switch'); await change;
    assert.equal(client.rateLimits,null);
    await client.refresh(); assert.equal(agent.formatRateLimits(client.rateLimits).percent,80);
    await assert.rejects(client.request('unsupported'),/Unsupported/);
    client.requestTimeoutMs=100;
    await assert.rejects(client.request('test/timeout'),/timed out/);
  } finally {client.stop();}
  assert.equal(client.child,null); assert.equal(client.pending.size,0);
});

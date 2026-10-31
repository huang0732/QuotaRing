'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {UsageMonitor}=require('../windows/usage-monitor.cjs');const {AppServerClient}=require('../agent.cjs');
test('standalone quota reader starts and refreshes without a desktop window or CDP session',async()=>{
  let now=1000,reads=0;const values=[];
  const monitor=new UsageMonitor({resolveCommand:()=>process.execPath,now:()=>now,pollMs:60000,onValue:v=>values.push(v),
    createClient:()=>{const client=new AppServerClient({command:process.execPath,args:[path.join(__dirname,'fake-app-server.cjs')]});
      const refresh=client.refresh.bind(client);client.refresh=async()=>{reads++;return refresh();};return client;}});
  try {
    await monitor.start();assert.equal(monitor.status().dataAvailable,true);assert.equal(monitor.status().desktopRequired,false);
    assert.deepEqual(monitor.value.rings.map(r=>r.label),['5h额度','周额度']);
    assert.deepEqual(monitor.value.resetTimes,{fiveHour:null,weekly:null});
    assert.equal(reads,1);now+=60000;await monitor.tick();assert.equal(reads,2);
    await monitor.client.request('test/switch');assert.equal(monitor.value.stale,true);assert.equal(monitor.value.percent,null);
    assert.equal(monitor.value.resetTimes,null);
    await monitor.tick();assert.equal(monitor.value.stale,false);assert.equal(reads,3);
  } finally {monitor.stop();}
  assert.equal(monitor.client,null);assert.equal(monitor.timer,null);assert.ok(values.length>=4);
});
test('standalone reader forwards reset timestamps without changing the original formatted quota',async()=>{
  const {EventEmitter}=require('node:events');const {formatRateLimits}=require('../agent.cjs');
  const data={rateLimits:{planType:'plus',primary:{usedPercent:89,windowDurationMins:300,resetsAt:1793370000},secondary:{usedPercent:14,windowDurationMins:10080,resetsAt:1793800000}}};
  const client=new EventEmitter();client.start=async()=>client.emit('rate-limits',data);client.stop=()=>{};
  const monitor=new UsageMonitor({resolveCommand:()=>'',createClient:()=>client});
  try {await monitor.start();const {resetTimes,updatedAt,stale,...formatted}=monitor.value;
    assert.deepEqual(formatted,formatRateLimits(data));assert.deepEqual(resetTimes,{fiveHour:1793370000,weekly:1793800000});
    assert.equal(stale,false);assert.ok(updatedAt);
    client.emit('server-exit');assert.equal(monitor.value.resetTimes,null);assert.equal(monitor.value.stale,true);
  }finally{monitor.stop();}
});
test('reader retries failures without preserving healthy-looking stale values',async()=>{
  let now=1000,attempts=0;
  const {EventEmitter}=require('node:events');
  const monitor=new UsageMonitor({resolveCommand:()=>process.execPath,now:()=>now,retryMs:10000,createClient:()=>{
    const client=new EventEmitter();client.start=async()=>{attempts++;throw Error('fixture unavailable');};client.stop=()=>{};return client;
  }});
  try {await monitor.start();assert.equal(monitor.status().dataAvailable,false);assert.equal(attempts,1);
    await monitor.tick();assert.equal(attempts,1);now+=10000;await monitor.tick();assert.equal(attempts,2);
  } finally {monitor.stop();}
});

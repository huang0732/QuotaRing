'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createCodexResolver}=require('../windows/platform.cjs');
const {UsageMonitor}=require('../windows/usage-monitor.cjs');

test('automatic CLI discovery recovers when a versioned client directory disappears',()=>{
  let active='old-client',scans=0;
  const resolve=createCodexResolver({appPath:'old-client'}, {
    resolve:(cli,app)=>{if(cli==='codex'&&app===active)return app+'/codex.exe';throw Error('CLI missing');},
    inspect:()=>{scans++;return {apps:['new-client']};}
  });
  assert.equal(resolve(),'old-client/codex.exe');assert.equal(scans,0);
  active='new-client';
  assert.equal(resolve(),'new-client/codex.exe');assert.equal(scans,1);
  assert.equal(resolve(),'new-client/codex.exe');assert.equal(scans,1);
});

test('an explicit CLI is never replaced by automatically discovered clients',()=>{
  let available=true,scans=0;
  const resolve=createCodexResolver({codexBin:'custom-cli',appPath:'old-client'}, {
    resolve:(cli)=>{assert.equal(cli,'custom-cli');if(!available)throw Error('custom CLI missing');return cli;},
    inspect:()=>{scans++;return {apps:['other-client']};}
  });
  assert.equal(resolve(),'custom-cli');available=false;
  assert.throws(resolve,/custom CLI missing/);assert.equal(scans,0);
});

test('failed automatic discovery retains the original resolution error',()=>{
  const failure=Error('original CLI missing');
  const resolve=createCodexResolver({}, {resolve:()=>{throw failure;},inspect:()=>{throw Error('inspection unavailable');}});
  assert.throws(resolve,error=>error===failure);
});

test('the background reader reconnects using a newly discovered client without changing login environment',async()=>{
  let active='old-client',now=1000;const commands=[],clients=[];
  const loginEnvironment=process.env.CODEX_HOME;
  const resolveCommand=createCodexResolver({appPath:'old-client'},{
    resolve:(cli,app)=>{if(app!==active)throw Error('missing');return app;},inspect:()=>({apps:['new-client']})
  });
  const monitor=new UsageMonitor({resolveCommand,now:()=>now,retryMs:10000,createClient:({command})=>{
    commands.push(command);const client=new EventEmitter();
    client.start=async()=>client.emit('rate-limits',{rateLimits:{planType:'plus',primary:{usedPercent:20,windowDurationMins:300},secondary:{usedPercent:40,windowDurationMins:10080}}});
    client.stop=()=>{};clients.push(client);return client;
  }});
  try{
    await monitor.start();assert.equal(monitor.status().dataAvailable,true);
    active='new-client';clients[0].emit('server-exit');assert.equal(monitor.value.stale,true);
    now+=10000;await monitor.tick();
    assert.deepEqual(commands,['old-client','new-client']);assert.equal(monitor.status().dataAvailable,true);
    assert.equal(process.env.CODEX_HOME,loginEnvironment);
  }finally{monitor.stop();}
});


'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {detectWebView2,ensureWebView2,registryPaths,downloadBootstrapper,verifyMicrosoftSignature,ensureFramework,runBootstrapper,WEBVIEW2_INSTALL_TIMEOUT_MS}=require('../windows/prerequisites.cjs');

test('a stuck WebView2 bootstrapper times out without killing shared processes',async()=>{
  const child=new EventEmitter();let detached=0,killed=0;
  child.unref=()=>detached++;child.kill=()=>killed++;
  assert.equal(WEBVIEW2_INSTALL_TIMEOUT_MS,180000);
  await assert.rejects(runBootstrapper('fixture.exe',{timeoutMs:20,spawnProcess:()=>child}),
    error=>error.code==='WEBVIEW2_INSTALL_TIMEOUT'&&/等待其结束后.*安装-Windows.cmd/.test(error.message));
  assert.equal(detached,1);assert.equal(killed,0);
  // Late notifications from an independently finishing installer remain harmless.
  child.emit('error',Error('late fixture error'));child.emit('exit',0,null);
});

test('WebView2 success, launch failure and interruption settle before the timeout',async()=>{
  for(const outcome of ['success','error','interrupted']) {
    const child=new EventEmitter();let detached=0;
    child.unref=()=>detached++;
    const result=runBootstrapper('fixture.exe',{timeoutMs:20,spawnProcess:()=>child});
    if(outcome==='success') {child.emit('exit',0,null);assert.equal(await result,0);}
    else if(outcome==='error') {child.emit('error',Error('fixture launch failure'));await assert.rejects(result,/未能启动/);}
    else {child.emit('exit',null,'SIGTERM');await assert.rejects(result,/被中断/);}
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(detached,0,'a completed installer must not trigger the timeout later');
  }
});

test('WebView2 detection reads the Evergreen Runtime registry value',()=>{
  const keys=[];
  const version=detectWebView2({platform:'win32',run:(exe,args)=>{
    keys.push(args[1]);
    return args[1].includes('WOW6432Node')?{status:0,stdout:'pv    REG_SZ    0.0.0.0'}:
      {status:0,stdout:'pv    REG_SZ    140.0.3485.54'};
  }});
  assert.equal(version,'140.0.3485.54');
  assert.deepEqual(keys,registryPaths().slice(0,2));
  assert.equal(detectWebView2({platform:'darwin'}),null);
});

test('an existing WebView2 Runtime skips the prompt and download',async()=>{
  let prompted=false,downloaded=false;
  const result=await ensureWebView2({platform:'win32',detect:()=> '140.0.0.0',
    confirm:async()=>{prompted=true;return true;},download:async()=>{downloaded=true;},
    output:{write(){}}});
  assert.equal(result.source,'existing');
  assert.equal(prompted,false);
  assert.equal(downloaded,false);
});

test('declining the WebView2 prompt stops before downloading',async()=>{
  let downloaded=false;
  await assert.rejects(ensureWebView2({platform:'win32',detect:()=>null,confirm:async()=>false,
    download:async()=>{downloaded=true;},output:{write(){}}}),/已取消 WebView2/);
  assert.equal(downloaded,false);
});

test('missing .NET Framework stops with the official install instructions',()=>{
  assert.throws(()=>ensureFramework({run:()=>({status:1})}),/\.NET Framework 4.8/);
  assert.throws(()=>ensureFramework({run:()=>({status:0,stdout:'Release REG_DWORD 0x70bf6'})}),/\.NET Framework 4.8/);
  assert.doesNotThrow(()=>ensureFramework({run:()=>({status:0,stdout:'Release REG_DWORD 0x80eb0'})}));
});

test('untrusted WebView2 downloads never run and temporary files are cleaned',async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'quotaring-prerequisite-'));
  let ran=false;
  try {
    await assert.rejects(ensureWebView2({platform:'win32',tempDirectory:temporary,output:{write(){}},
      detect:()=>null,confirm:async()=>true,
      download:async(file)=>fs.writeFileSync(file,'untrusted fixture'),
      verify:()=>verifyMicrosoftSignature('fixture',{platform:'win32',run:()=>({status:1})}),
      install:()=>{ran=true;return 0;}
    }),/微软签名/);
    assert.equal(ran,false);assert.deepEqual(fs.readdirSync(temporary),[]);
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
});

test('WebView2 download refuses redirects outside Microsoft and incomplete responses',async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'quotaring-download-'));
  try {
    const file=path.join(temporary,'setup.exe');let requests=0;
    await assert.rejects(downloadBootstrapper(file,{fetchImpl:async()=>{
      requests++;return new Response(null,{status:302,headers:{location:'https://example.com/setup.exe'}});
    }}),/地址异常/);
    assert.equal(requests,1);assert.equal(fs.existsSync(file),false);
    await assert.rejects(downloadBootstrapper(file,{fetchImpl:async()=>new Response('short',{headers:{'content-length':'100'}})}),/不完整/);
    assert.equal(fs.readFileSync(file,'utf8'),'short');
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
});

test('a signed bootstrapper that installs Runtime allows QuotaRing installation to continue',async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'quotaring-prerequisite-'));
  const stages=[];
  let detectionCount=0;
  try {
    const result=await ensureWebView2({platform:'win32',tempDirectory:temporary,output:{write(){}},
      detect:()=>++detectionCount===1?null:'140.0.0.0',
      confirm:async()=>true,
      download:async(file)=>{stages.push('download');fs.writeFileSync(file,'fixture');},
      verify:(file)=>{stages.push('verify');assert.equal(fs.readFileSync(file,'utf8'),'fixture');},
      install:(file)=>{stages.push('install');assert.ok(fs.existsSync(file));return 0;}
    });
    assert.deepEqual(stages,['download','verify','install']);
    assert.equal(result.source,'installed');
    assert.deepEqual(fs.readdirSync(temporary),[]);
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
});

test('failed WebView2 installation stops and removes the temporary bootstrapper',async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'quotaring-prerequisite-'));
  try {
    await assert.rejects(ensureWebView2({platform:'win32',tempDirectory:temporary,output:{write(){}},
      detect:()=>null,confirm:async()=>true,
      download:async(file)=>fs.writeFileSync(file,'fixture'),verify:()=>{},install:()=>7
    }),/尚未安装或更新.*微软官方下载/);
    assert.deepEqual(fs.readdirSync(temporary),[]);
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
});

test('bundled Node upgrades, restarts and uninstalls without relying on PATH or removing unknown runtime files',{
  skip:process.platform!=='win32',timeout:40000
},async()=>{
  const root=path.resolve(__dirname,'..');
  const fixture=fs.mkdtempSync(path.join(root,'.test-bundled-node-中文 & (card)-'));
  const source=path.join(fixture,'source'),installed=path.join(fixture,'installed'),app=path.join(fixture,'ChatGPT.exe');
  const baseManager=require('../windows/manage.cjs');
  fs.mkdirSync(source);fs.writeFileSync(app,'fixture, never executed');
  for(const relative of baseManager.CORE_FILES) {
    const file=path.join(source,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(root,relative),file);
  }
  const platform=require(path.join(source,'windows/platform.cjs'));
  platform.inspectSystem=()=>({apps:[app],running:[]});
  const manager=require(path.join(source,'windows/manage.cjs'));
  const server=require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('[]');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const oldPort=process.env.CODEX_BADGE_PORT;
  process.env.CODEX_BADGE_PORT=String(server.address().port);
  const opts={dir:installed,appPath:app,codexBin:process.execPath,noShortcuts:true};
  try {
    await manager.install(opts);
    assert.equal(platform.ownedConfig(installed).nodePath,process.execPath);
    fs.mkdirSync(path.join(source,'runtime'));
    fs.copyFileSync(process.execPath,path.join(source,'runtime/node.exe'));
    const oldWorker=manager.state(installed).pid;
    await assert.rejects(manager.install(opts),/Node.js 文件不完整/);
    assert.equal(manager.state(installed).pid,oldWorker);
    fs.writeFileSync(path.join(source,'runtime/LICENSE'),'fixture license');
    await manager.install(opts);
    const executable=path.join(installed,'runtime/node.exe');
    assert.equal(platform.ownedConfig(installed).nodePath,executable);
    assert.equal(platform.ownedConfig(installed).codexBin,process.execPath);
    assert.ok(manager.state(installed)?.pid);
    await manager.stop(installed);
    assert.equal(manager.state(installed),null);
    await manager.start(installed);
    await manager.install(opts); // Wait for exit before replacing the formerly running node.exe.
    const execFile=require('node:util').promisify(require('node:child_process').execFile);
    await assert.rejects(execFile(executable,[path.join(installed,'manage.cjs'),'uninstall','--install-dir',installed],{windowsHide:true}),/完整解压的安装包/);
    assert.ok(fs.existsSync(path.join(installed,'config.json')));
    fs.writeFileSync(path.join(installed,'runtime/keep-user-file.txt'),'keep');
    await manager.uninstall(opts);
    assert.equal(fs.existsSync(executable),false);
    assert.equal(fs.existsSync(path.join(installed,'runtime/LICENSE')),false);
    assert.equal(fs.readFileSync(path.join(installed,'runtime/keep-user-file.txt'),'utf8'),'keep');
    assert.ok(fs.existsSync(process.execPath));
  } finally {
    if(fs.existsSync(path.join(installed,'config.json')))await manager.uninstall(opts);
    if(oldPort===undefined)delete process.env.CODEX_BADGE_PORT;else process.env.CODEX_BADGE_PORT=oldPort;
    await new Promise(resolve=>server.close(resolve));
    assert.equal(path.dirname(fs.realpathSync(fixture)).toLowerCase(),root.toLowerCase());
    fs.rmSync(fixture,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});

test('a declined prerequisite check preserves the existing installation before stopping its worker',async()=>{
  const root=path.resolve(__dirname,'..'),manager=require('../windows/manage.cjs'),platform=require('../windows/platform.cjs');
  const prerequisites=require('../windows/prerequisites.cjs');
  const fixture=fs.mkdtempSync(path.join(root,'.test-prerequisite-abort-'));
  const originalFramework=prerequisites.ensureFramework,originalWebView=prerequisites.ensureWebView2;
  const config={owner:platform.OWNER,installDir:fixture,version:'1.0.0',noShortcuts:true,displayMode:'taskbar'};
  platform.writeJson(path.join(fixture,'config.json'),config);fs.writeFileSync(path.join(fixture,'agent.cjs'),'original file');
  prerequisites.ensureFramework=()=>{};
  prerequisites.ensureWebView2=async()=>{throw Error('已取消 WebView2 安装');};
  try {
    await assert.rejects(manager.install({dir:fixture}),/已取消 WebView2/);
    assert.deepEqual(platform.readJson(path.join(fixture,'config.json')),config);
    assert.equal(fs.readFileSync(path.join(fixture,'agent.cjs'),'utf8'),'original file');
    assert.equal(fs.existsSync(path.join(fixture,'stop.json')),false);
  } finally {
    prerequisites.ensureFramework=originalFramework;prerequisites.ensureWebView2=originalWebView;
    fs.rmSync(fixture,{recursive:true,force:true});
  }
});

test('WebView2 timeout preserves the old installation and retains the potentially active setup file',async()=>{
  const root=path.resolve(__dirname,'..'),manager=require('../windows/manage.cjs'),platform=require('../windows/platform.cjs');
  const prerequisites=require('../windows/prerequisites.cjs');
  const fixture=fs.mkdtempSync(path.join(root,'.test-prerequisite-timeout-'));
  const installed=path.join(fixture,'installed'),temporary=path.join(fixture,'temp');
  fs.mkdirSync(installed);fs.mkdirSync(temporary);
  const config={owner:platform.OWNER,installDir:installed,version:'1.0.0',noShortcuts:true,displayMode:'taskbar'};
  platform.writeJson(path.join(installed,'config.json'),config);
  const configBytes=fs.readFileSync(path.join(installed,'config.json'));
  fs.writeFileSync(path.join(installed,'agent.cjs'),'original file');
  const originalFramework=prerequisites.ensureFramework,originalWebView=prerequisites.ensureWebView2;
  const child=new EventEmitter();let detached=0,detections=0,output='';
  child.unref=()=>detached++;
  prerequisites.ensureFramework=()=>{};
  prerequisites.ensureWebView2=()=>originalWebView({platform:'win32',tempDirectory:temporary,
    output:{write:value=>output+=value},detect:()=>{detections++;return null;},confirm:async()=>true,
    download:async file=>fs.writeFileSync(file,'fixture setup; never executed'),verify:()=>{},
    install:file=>runBootstrapper(file,{timeoutMs:20,spawnProcess:()=>child})
  });
  try {
    await assert.rejects(manager.install({dir:installed}),error=>
      error.cause?.code==='WEBVIEW2_INSTALL_TIMEOUT'&&/尚未安装或更新/.test(error.message));
    assert.deepEqual(fs.readFileSync(path.join(installed,'config.json')),configBytes);
    assert.equal(fs.readFileSync(path.join(installed,'agent.cjs'),'utf8'),'original file');
    assert.equal(fs.existsSync(path.join(installed,'stop.json')),false);
    assert.equal(detached,1);assert.equal(detections,1);
    assert.match(output,/临时安装文件保留/);
    const folders=fs.readdirSync(temporary);assert.equal(folders.length,1);
    assert.ok(fs.existsSync(path.join(temporary,folders[0],'MicrosoftEdgeWebview2Setup.exe')));
  } finally {
    prerequisites.ensureFramework=originalFramework;prerequisites.ensureWebView2=originalWebView;
    child.emit('exit',0,null);
    fs.rmSync(fixture,{recursive:true,force:true});
  }
});

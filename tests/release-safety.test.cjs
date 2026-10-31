'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {promisify}=require('node:util');
const execFile=promisify(require('node:child_process').execFile);
const p=require('../windows/platform.cjs'),manager=require('../windows/manage.cjs'),agent=require('../agent.cjs');
const root=path.resolve(__dirname,'..');
const windows={skip:process.platform!=='win32'};
function fixture(){return fs.mkdtempSync(path.join(root,'.test-release-safety-中文 & (card)-'));}
function cleanup(dir,links=[]){
  for(const link of links){try{if(fs.lstatSync(link).isSymbolicLink())fs.unlinkSync(link);}catch(e){if(e.code!=='ENOENT')throw e;}}
  const checked=fs.realpathSync(dir);assert.equal(path.dirname(checked).toLowerCase(),root.toLowerCase());
  assert.ok(path.basename(checked).startsWith('.test-release-safety-'));
  fs.rmSync(checked,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
function owned(dir){
  const installed=path.join(dir,'installed'),external=path.join(dir,'external');
  fs.mkdirSync(installed);fs.mkdirSync(external);
  p.writeJson(path.join(installed,'config.json'),{owner:p.OWNER,installDir:installed,noShortcuts:true,displayMode:'taskbar'});
  fs.writeFileSync(path.join(installed,'agent.cjs'),'owned file must survive rejected uninstall');
  fs.writeFileSync(path.join(external,'manage.cjs'),'external file must survive');
  return {installed,external};
}
function assertUnchanged(installed,external){
  assert.equal(fs.readFileSync(path.join(installed,'agent.cjs'),'utf8'),'owned file must survive rejected uninstall');
  assert.equal(fs.existsSync(path.join(installed,'config.json')),true);
  assert.equal(fs.readFileSync(path.join(external,'manage.cjs'),'utf8'),'external file must survive');
}
function deadLock(installed){
  const folder=path.join(installed,'worker.lock'),file=path.join(folder,'owner.json');
  const record={owner:p.OWNER,pid:2147483647,instance:require('node:crypto').randomUUID()};
  assert.equal(p.alive(record.pid),false);
  fs.mkdirSync(folder);p.writeJson(file,record);return {folder,file,record};
}

test('contained paths allow an installation directly below the drive while retaining root and boundary guards',windows,()=>{
  const dir=fixture();
  try{
    const drive=path.parse(root).root,firstLevel=path.join(drive,path.relative(drive,root).split(path.sep)[0]);
    assert.equal(p.assertContainedPath(firstLevel,firstLevel).isDirectory(),true);
    assert.equal(p.assertContainedPath(dir,dir).isDirectory(),true);
    fs.writeFileSync(path.join(dir,'known.txt'),'fixture');
    assert.equal(p.assertContainedPath(dir,path.join(dir,'known.txt')).isFile(),true);
    assert.throws(()=>p.assertContainedPath(drive,drive),/磁盘根目录/);
    assert.throws(()=>p.assertContainedPath(dir,path.dirname(dir)),/超出/);
    assert.throws(()=>p.assertContainedPath(dir,dir+'-sibling'),/超出/);
  }finally{cleanup(dir);}
});

test('a replaced startup launcher executes correctly from a Chinese path', {...windows,timeout:20000},async()=>{
  const dir=fixture(),file=path.join(dir,'launch.vbs'),probe=path.join(dir,'manage.cjs'),marker=path.join(dir,'started.json');
  try{
    fs.writeFileSync(probe,"require('node:fs').writeFileSync(require('node:path').join(__dirname,'started.json'),JSON.stringify(process.argv.slice(2)));\n");
    fs.writeFileSync(file,p.launcherVbs(process.execPath,probe),'utf8');
    p.writeLauncher(file,process.execPath,probe);
    const bytes=fs.readFileSync(file);assert.deepEqual([...bytes.subarray(0,2)],[255,254]);
    assert.equal(bytes.subarray(2).toString('utf16le'),p.launcherVbs(process.execPath,probe));
    await execFile(path.join(process.env.SystemRoot,'System32','cscript.exe'),['//B','//NoLogo',file],{windowsHide:true,timeout:10000});
    assert.deepEqual(JSON.parse(fs.readFileSync(marker,'utf8')),['start','--install-dir',dir]);
    assert.equal(fs.readdirSync(dir).some(name=>name.startsWith('.launch-')&&name.endsWith('.tmp')),false);
  }finally{cleanup(dir);}
});

test('startup launcher refuses a linked parent without changing its target',windows,()=>{
  const dir=fixture(),target=path.join(dir,'external'),link=path.join(dir,'linked');
  try{
    fs.mkdirSync(target);fs.writeFileSync(path.join(target,'launch.vbs'),'retain original');
    fs.symlinkSync(target,link,'junction');
    assert.throws(()=>p.writeLauncher(path.join(link,'launch.vbs'),process.execPath,path.join(dir,'manage.cjs')),/链接|联接/);
    assert.equal(fs.readFileSync(path.join(target,'launch.vbs'),'utf8'),'retain original');
  }finally{cleanup(dir,[link]);}
});

for(const folder of ['windows','panel-profile']){
  test('uninstall rejects a linked '+folder+' before deleting any owned or external file',windows,async()=>{
    const dir=fixture(),{installed,external}=owned(dir),link=path.join(installed,folder);
    try{
      fs.writeFileSync(path.join(external,'.owner'),'codex-usage-card-panel-v1');
      fs.symlinkSync(external,link,'junction');
      await assert.rejects(manager.uninstall({dir:installed}),/链接|联接/);
      assertUnchanged(installed,external);
    }finally{cleanup(dir,[link]);}
  });
}

test('uninstall detects a broken directory junction before deleting files',windows,async()=>{
  const dir=fixture(),{installed,external}=owned(dir),link=path.join(installed,'windows');
  try{
    fs.symlinkSync(path.join(dir,'missing-target'),link,'junction');
    await assert.rejects(manager.uninstall({dir:installed}),/链接|联接/);
    assertUnchanged(installed,external);
  }finally{cleanup(dir,[link]);}
});

test('uninstall rejects an unmarked cache before deleting program files',async()=>{
  const dir=fixture(),{installed,external}=owned(dir);
  try{
    fs.mkdirSync(path.join(installed,'panel-profile'));
    await assert.rejects(manager.uninstall({dir:installed}),/归属/);
    assertUnchanged(installed,external);
  }finally{cleanup(dir);}
});

test('ordinary uninstall removes the marked cache while retaining unknown files',async()=>{
  const dir=fixture(),{installed,external}=owned(dir);
  try{
    const profile=path.join(installed,'panel-profile');fs.mkdirSync(profile);
    fs.writeFileSync(path.join(profile,'.owner'),'codex-usage-card-panel-v1');fs.writeFileSync(path.join(profile,'cache'),'cache');
    fs.writeFileSync(path.join(installed,'user-data.txt'),'retain this');
    await manager.uninstall({dir:installed});
    assert.equal(fs.existsSync(profile),false);assert.equal(fs.existsSync(path.join(installed,'agent.cjs')),false);
    assert.equal(fs.existsSync(path.join(installed,'config.json')),false);
    assert.equal(fs.readFileSync(path.join(installed,'user-data.txt'),'utf8'),'retain this');
    assert.equal(fs.readFileSync(path.join(external,'manage.cjs'),'utf8'),'external file must survive');
  }finally{cleanup(dir);}
});

test('a real worker crash can be followed by uninstall and a fresh install without changing ordinary stop', {...windows,timeout:45000},async()=>{
  const dir=fixture(),installed=path.join(dir,'installed'),app=path.join(dir,'ChatGPT.exe');fs.writeFileSync(app,'never executed');
  const originalInspect=p.inspectSystem,originalTargets=p.targets,previousPort=process.env.CODEX_BADGE_PORT;
  const server=require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('[]');});
  const spawned=new Set(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async(predicate)=>{const end=Date.now()+10000;while(!predicate()){if(Date.now()>=end)throw Error('fixture worker did not exit');await pause(50);}};
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  process.env.CODEX_BADGE_PORT=String(server.address().port);
  p.inspectSystem=()=>({apps:[app],running:[]});p.targets=async()=>[];
  const opts={dir:installed,appPath:app,codexBin:process.execPath,noShortcuts:true};
  try{
    await manager.install(opts);
    const first=manager.state(installed);assert.ok(first?.pid);spawned.add(first.pid);
    process.kill(first.pid,'SIGKILL');await wait(()=>!p.alive(first.pid));
    const owner=path.join(installed,'worker.lock','owner.json');assert.equal(p.readJson(owner).pid,first.pid);
    await manager.stop(installed);assert.equal(fs.existsSync(owner),true,'ordinary stop retains its previous behavior');
    await manager.uninstall(opts);assert.equal(fs.existsSync(installed),false);
    await manager.install(opts);
    const second=manager.state(installed);assert.ok(second?.pid);spawned.add(second.pid);
    await manager.uninstall(opts);assert.equal(fs.existsSync(installed),false);
  }finally{
    try{if(fs.existsSync(path.join(installed,'config.json')))await manager.uninstall(opts);}
    finally{
      for(const pid of spawned)if(p.alive(pid)){process.kill(pid,'SIGKILL');await wait(()=>!p.alive(pid));}
      p.inspectSystem=originalInspect;p.targets=originalTargets;
      if(previousPort===undefined)delete process.env.CODEX_BADGE_PORT;else process.env.CODEX_BADGE_PORT=previousPort;
      await new Promise(resolve=>server.close(resolve));cleanup(dir);
    }
  }
});

test('unknown files in a worker lock abort uninstall before program files or markers are removed',async()=>{
  const dir=fixture(),{installed,external}=owned(dir),lock=deadLock(installed);
  try{
    fs.writeFileSync(path.join(lock.folder,'keep-user-file.txt'),'retain this');
    await assert.rejects(manager.uninstall({dir:installed}),/锁目录.*未知文件/);
    assertUnchanged(installed,external);assert.deepEqual(p.readJson(lock.file),lock.record);
    assert.equal(fs.readFileSync(path.join(lock.folder,'keep-user-file.txt'),'utf8'),'retain this');
    assert.equal(fs.existsSync(path.join(installed,'stop.json')),false);
  }finally{cleanup(dir);}
});

test('invalid lock ownership, process IDs and instance records abort uninstall before deletion',async()=>{
  const dir=fixture(),{installed,external}=owned(dir),lock=deadLock(installed);
  try{
    const invalid=[{...lock.record,owner:'foreign'},{...lock.record,pid:0},{...lock.record,pid:-1},
      {...lock.record,pid:'123'},{...lock.record,pid:1.5},{...lock.record,pid:Number.MAX_SAFE_INTEGER+1},
      {...lock.record,instance:null},{...lock.record,instance:''},{...lock.record,instance:'  '}];
    for(const record of invalid){
      p.writeJson(lock.file,record);await assert.rejects(manager.uninstall({dir:installed}),/后台锁记录无效/);
      assertUnchanged(installed,external);assert.deepEqual(p.readJson(lock.file),record);
    }
    fs.writeFileSync(lock.file,'invalid JSON');await assert.rejects(manager.uninstall({dir:installed}),SyntaxError);
    assertUnchanged(installed,external);
  }finally{cleanup(dir);}
});

for(const changeAt of [1,2]){
  test('a replacement lock during '+(changeAt===1?'stop':'the final process check')+' is preserved and aborts uninstall',async()=>{
    const dir=fixture(),{installed,external}=owned(dir),lock=deadLock(installed),originalKill=process.kill;
    const replacement={...lock.record,instance:require('node:crypto').randomUUID()};let probes=0;
    process.kill=function(pid,signal){
      if(pid===lock.record.pid&&signal===0){
        if(++probes===changeAt)p.writeJson(lock.file,replacement);
        throw Object.assign(Error('fixture process is gone'),{code:'ESRCH'});
      }
      return originalKill.call(process,pid,signal);
    };
    try{
      await assert.rejects(manager.uninstall({dir:installed}),/后台锁实例已变化/);
      assertUnchanged(installed,external);assert.deepEqual(p.readJson(lock.file),replacement);
    }finally{process.kill=originalKill;cleanup(dir);}
  });
}

test('an uncertain process check never authorizes deletion of a stale-looking lock',async()=>{
  const dir=fixture(),{installed,external}=owned(dir),lock=deadLock(installed),originalKill=process.kill;
  try{
    for(const code of ['EPERM','EINVAL']){
      let probes=0;
      process.kill=function(pid,signal){
        if(pid===lock.record.pid&&signal===0)throw Object.assign(Error('fixture process check'),{code:++probes===1?'ESRCH':code});
        return originalKill.call(process,pid,signal);
      };
      await assert.rejects(manager.uninstall({dir:installed}),/无法确认后台已结束/);
      assertUnchanged(installed,external);assert.deepEqual(p.readJson(lock.file),lock.record);
    }
  }finally{process.kill=originalKill;cleanup(dir);}
});

test('a process found alive on recheck keeps its lock and aborts uninstall',async()=>{
  const dir=fixture(),{installed,external}=owned(dir),lock=deadLock(installed),originalKill=process.kill;let probes=0;
  process.kill=function(pid,signal){
    if(pid===lock.record.pid&&signal===0){if(++probes===1)throw Object.assign(Error('fixture process is gone'),{code:'ESRCH'});return;}
    return originalKill.call(process,pid,signal);
  };
  try{
    await assert.rejects(manager.uninstall({dir:installed}),/后台仍在运行/);
    assertUnchanged(installed,external);assert.deepEqual(p.readJson(lock.file),lock.record);
  }finally{process.kill=originalKill;cleanup(dir);}
});

test('upgrade validates and preserves the saved explicit CLI when automatic discovery is unavailable', {...windows,timeout:45000},async()=>{
  const dir=fixture(),installed=path.join(dir,'installed'),app=path.join(dir,'ChatGPT.exe');fs.writeFileSync(app,'never executed');
  const originalInspect=p.inspectSystem,originalTargets=p.targets,originalResolve=agent.resolveCodexBin;
  const previousPort=process.env.CODEX_BADGE_PORT;
  const server=require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('[]');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  process.env.CODEX_BADGE_PORT=String(server.address().port);
  p.inspectSystem=()=>({apps:[app],running:[]});p.targets=async()=>[];
  agent.resolveCodexBin=(cli,appPath)=>{if(cli!==process.execPath)throw Error('automatic CLI unavailable in fixture');return originalResolve(cli,appPath);};
  try{
    await manager.install({dir:installed,appPath:app,codexBin:process.execPath,noShortcuts:true});
    assert.deepEqual([...fs.readFileSync(path.join(installed,'launch.vbs')).subarray(0,2)],[255,254]);
    await manager.stop(installed);
    await manager.install({dir:installed,appPath:app,noShortcuts:true});
    assert.equal(p.readJson(path.join(installed,'config.json')).codexBin,process.execPath);
  }finally{
    try{if(fs.existsSync(path.join(installed,'config.json')))await manager.uninstall({dir:installed});}
    finally{
      p.inspectSystem=originalInspect;p.targets=originalTargets;agent.resolveCodexBin=originalResolve;
      if(previousPort===undefined)delete process.env.CODEX_BADGE_PORT;else process.env.CODEX_BADGE_PORT=previousPort;
      await new Promise(resolve=>server.close(resolve));cleanup(dir);
    }
  }
});


'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {promisify}=require('node:util');
const execFile=promisify(require('node:child_process').execFile);
const p=require('../windows/platform.cjs');
const manager=require('../windows/manage.cjs');
test('Windows command paths stay separate from shell code',()=>{
  const dir='D:\\A 中文 & ($value)\\card';
  const vbs=p.launcherVbs('D:\\node js\\node.exe',dir+'\\manage.cjs');
  assert.ok(vbs.includes('""D:\\node js\\node.exe""'));
  assert.ok(vbs.includes('中文 & ($value)'));
  assert.ok(vbs.includes(' start --install-dir '));
  assert.ok(vbs.includes('""'+dir+'""'));
  assert.ok(!/\slaunch(?:\s|")/.test(vbs));
  assert.throws(()=>p.launcherVbs('bad"path','ok'),/路径/);
  assert.throws(()=>manager.options(['install','--app']),/缺少/);
  assert.throws(()=>manager.options(['install','--unknown']),/未知/);
  assert.throws(()=>p.assertDirectory(path.parse(process.cwd()).root),/根目录/);
});
test('original shortcut integration preserves appearance, is idempotent, and restores exact original bytes',{
  skip:process.platform!=='win32',timeout:60000
},async()=>{
  const root=path.resolve(__dirname,'..');
  const testDir=fs.mkdtempSync(path.join(root,'.test-shortcuts-中文 & (card)-'));
  const shortcuts=path.join(testDir,'desktop');fs.mkdirSync(shortcuts);
  const installed=path.join(testDir,'installed');fs.mkdirSync(installed);
  const app=path.join(testDir,'ChatGPT.exe');fs.writeFileSync(app,'fixture, never executed');
  const configFile=path.join(installed,'config.json');
  p.writeJson(configFile,{owner:p.OWNER,installDir:installed,appPath:app});
  const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const fixture=async action=>(await execFile(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'shortcut-fixture.ps1'),
    '-Action',action,'-Directory',shortcuts,'-AppPath',app],{windowsHide:true,timeout:15000,encoding:'utf8'})).stdout;
  try {
    await fixture('Create');
    const file=path.join(shortcuts,'Codex.lnk');
    const original=fs.readFileSync(file);
    const other=fs.readFileSync(path.join(shortcuts,'Unrelated.lnk'));
    const before=JSON.parse(await fixture('Inspect'));
    await fixture('CreateOwnedLogin');
    const ownedLogin=path.join(shortcuts,'Codex - original login.lnk');const ownedBytes=fs.readFileSync(ownedLogin);
    const ownedHash=require('node:crypto').createHash('sha256').update(ownedBytes).digest('hex');
    p.writeJson(path.join(installed,'login-integration.json'),{owner:p.OWNER,managedHash:ownedHash});
    assert.equal(JSON.parse(p.system('IntegrateOriginal',configFile,shortcuts)).integrated,1);
    const after=JSON.parse(await fixture('Inspect'));
    assert.equal(after.target,app);
    assert.equal(after.arguments,'--fixture --remote-debugging-port=39222 --remote-debugging-address=127.0.0.1');
    for(const key of ['icon','description','hotkey']) assert.equal(after[key],before[key]);
    const partial=p.readJson(path.join(installed,'shortcut-backups','manifest.json'));
    const ownBackup=require('node:crypto').randomUUID().replaceAll('-','')+'.lnk';
    fs.writeFileSync(path.join(installed,'shortcut-backups',ownBackup),ownedBytes);
    partial.entries.push({path:ownedLogin,backup:ownBackup,originalHash:ownedHash,managedHash:ownedHash});
    p.writeJson(path.join(installed,'shortcut-backups','manifest.json'),partial);
    p.system('IntegrateOriginal',configFile,shortcuts);
    const managed=fs.readFileSync(file);
    const again=JSON.parse(await fixture('Inspect'));
    assert.equal(again.arguments,after.arguments);
    const manifest=p.readJson(path.join(installed,'shortcut-backups','manifest.json'));
    assert.equal(manifest.entries.length,1);
    assert.deepEqual(fs.readFileSync(ownedLogin),ownedBytes);
    assert.equal(fs.existsSync(path.join(installed,'shortcut-backups',ownBackup)),false);
    assert.deepEqual(fs.readFileSync(path.join(installed,'shortcut-backups',manifest.entries[0].backup)),original);
    assert.deepEqual(fs.readFileSync(path.join(shortcuts,'Unrelated.lnk')),other);
    assert.equal(JSON.parse(p.system('IntegrationStatus',configFile,shortcuts)).healthyShortcuts,1);
    await fixture('Edit');
    const edited=fs.readFileSync(file);
    assert.throws(()=>p.system('RestoreOriginal',configFile,shortcuts),/edited after installation/);
    assert.deepEqual(fs.readFileSync(file),edited);
    // Put back the recorded managed bytes, then exercise normal uninstall restoration.
    fs.writeFileSync(file,managed);
    p.system('RestoreOriginal',configFile,shortcuts);
    assert.deepEqual(fs.readFileSync(file),original);
    assert.equal(fs.existsSync(path.join(installed,'shortcut-backups')),false);
  } finally {
    assert.ok(testDir.startsWith(root+path.sep+'.test-'));
    fs.rmSync(testDir,{recursive:true,force:true});
  }
});
test('Windows install, duplicate start, refusal to overwrite unknown files, stop and uninstall',{
  skip:process.platform!=='win32',timeout:60000
},async()=>{
  const root=path.resolve(__dirname,'..');
  const testDir=fs.mkdtempSync(path.join(root,'.test-中文 & (card)-'));
  const installDir=path.join(testDir,'installed');
  const app=path.join(testDir,'ChatGPT.exe'); fs.writeFileSync(app,'fixture, never executed');
  const run=(...args)=>execFile(process.execPath,[path.join(root,'manage.cjs'),...args,'--install-dir',installDir],{
    cwd:root,windowsHide:true,timeout:25000,env:{...process.env,CODEX_USAGE_CARD_HOME:installDir,CODEX_BADGE_PORT:'49229'}
  });
  try {
    await run('install','--no-shortcuts','--app',app,'--codex-bin',process.execPath);
    const original=manager.state(installDir); assert.ok(original?.pid);
    await run('start'); assert.equal(manager.state(installDir).pid,original.pid);
    fs.writeFileSync(path.join(installDir,'user-data.txt'),'keep me');
    await run('stop'); assert.equal(manager.state(installDir),null);
    await run('uninstall');
    assert.deepEqual(fs.readdirSync(installDir),['user-data.txt']);
    await assert.rejects(run('install','--no-shortcuts','--app',app,'--codex-bin',process.execPath),/安装标记/);
  } finally {
    if(fs.existsSync(path.join(installDir,'config.json'))) await run('uninstall');
    // Bound the computed recursive cleanup to this test's workspace fixture.
    assert.ok(testDir.startsWith(root+path.sep+'.test-'));
    fs.rmSync(testDir,{recursive:true,force:true});
  }
});
test('packaged original icon uses the stable package alias and restores AppsFolder activation',{
  skip:process.platform!=='win32',timeout:45000
},async t=>{
  const app=p.inspectSystem().apps.find(exe=>/\\OpenAI\.Codex_[^\\]+\\app\\ChatGPT\.exe$/i.test(exe));
  if(!app) {t.skip('Codex package is not visible in this process sandbox');return;}
  const root=path.resolve(__dirname,'..');
  const dir=fs.mkdtempSync(path.join(root,'.test-packaged-icon-'));
  const shortcuts=path.join(dir,'desktop');fs.mkdirSync(shortcuts);
  const installed=path.join(dir,'installed');fs.mkdirSync(installed);
  const configFile=path.join(installed,'config.json');
  p.writeJson(configFile,{owner:p.OWNER,installDir:installed,appPath:app});
  const fixture=async action=>(await execFile(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
    ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'shortcut-fixture.ps1'),
    '-Action',action,'-Directory',shortcuts,'-AppPath',app],{windowsHide:true,timeout:15000,encoding:'utf8'})).stdout;
  try {
    await fixture('CreatePackaged');
    const file=path.join(shortcuts,'Codex.lnk');
    const original=fs.readFileSync(file);
    p.system('IntegrateOriginal',configFile,shortcuts);
    const shortcut=JSON.parse(await fixture('Inspect'));
    assert.match(shortcut.target,/\\Microsoft\\WindowsApps\\OpenAI\.Codex_[^\\]+\\chatgpt-desktop\.exe$/i);
    assert.equal(shortcut.arguments,'--remote-debugging-port=39222 --remote-debugging-address=127.0.0.1');
    assert.ok(!/wscript|node\.exe/i.test(shortcut.target));
    p.system('IntegrateOriginal',configFile,shortcuts);
    p.system('RestoreOriginal',configFile,shortcuts);
    assert.deepEqual(fs.readFileSync(file),original);
  } finally {
    assert.ok(dir.startsWith(root+path.sep+'.test-'));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
test('existing client login startup is preserved, disabled preferences are respected, and policy is untouched',{
  skip:process.platform!=='win32',timeout:60000
},async t=>{
  const root=path.resolve(__dirname,'..');
  const dir=path.join(root,'.test-login-'+require('node:crypto').randomUUID());fs.mkdirSync(dir);
  const installed=path.join(dir,'installed');fs.mkdirSync(installed);
  const app=path.join(dir,'ChatGPT.exe');fs.writeFileSync(app,'fixture, never executed');
  const configFile=path.join(installed,'config.json');p.writeJson(configFile,{owner:p.OWNER,installDir:installed,appPath:app});
  const run=async(action,state=2)=>(await execFile(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
    ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'login-fixture.ps1'),'-Action',action,
    '-Directory',dir,'-ConfigPath',configFile,'-SourceScript',path.join(root,'windows','login.ps1'),'-State',String(state)],
    {windowsHide:true,timeout:15000,encoding:'utf8'})).stdout;
  let initialized=false;
  try {
    try {await run('Init');initialized=true;} catch(error) {
      if(/PermissionDenied|UnauthorizedAccess/.test(error.stderr || '')) {t.skip('Registry fixture requires normal host access');return;}
      throw error;
    }
    await run('Integrate');
    const status=JSON.parse(await run('Status'));assert.equal(status.nativeLoginMapped,true);assert.equal(status.clientLoginHealthy,true);
    let data=JSON.parse(await run('Inspect'));assert.equal(data.state,0);assert.equal(data.target,app);
    assert.match(data.arguments,/--remote-debugging-port=39222/);
    await run('Integrate');await run('Restore');
    data=JSON.parse(await run('Inspect'));assert.equal(data.state,2);assert.equal(data.target,null);
    assert.equal(fs.existsSync(path.join(installed,'login-integration.json')),false);
    await run('Init',0);await run('Integrate');
    assert.equal(JSON.parse(await run('Inspect')).target,null);
    assert.equal(fs.existsSync(path.join(installed,'login-integration.json')),false);
    await run('SetState',4);await assert.rejects(run('Integrate'),/enforced by policy/);
    assert.equal(JSON.parse(await run('Inspect')).state,4);
    await run('SetState',2);await run('Integrate');await run('SetState',1);await run('Restore');
    assert.equal(JSON.parse(await run('Inspect')).state,1);
  } finally {
    if(initialized) await run('Destroy');
    assert.ok(dir.startsWith(root+path.sep+'.test-login-'));fs.rmSync(dir,{recursive:true,force:true});
  }
});
test('independent background survives closure of the launcher Windows Job',{
  skip:process.platform!=='win32',timeout:60000
},async t=>{
  // WMI is intentionally unavailable inside the restricted process sandbox.
  try {p.system('Inspect'); await execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    "Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID) -ErrorAction Stop | Out-Null"],{windowsHide:true,timeout:10000});}
  catch {t.skip('WMI regression fixture requires normal host access');return;}
  const root=path.resolve(__dirname,'..');const dir=fs.mkdtempSync(path.join(root,'.test-independent-中文 & (card)-'));
  const installed=path.join(dir,'installed');const app=path.join(dir,'ChatGPT.exe');fs.writeFileSync(app,'fixture, never executed');
  const server=require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('[]');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const run=(...args)=>execFile(process.execPath,[path.join(root,'manage.cjs'),...args,'--install-dir',installed],{
    cwd:root,windowsHide:true,timeout:25000,env:{...process.env,CODEX_BADGE_PORT:String(server.address().port)}
  });
  try {
    await run('install','--no-shortcuts','--app',app,'--codex-bin',process.execPath);await run('stop');
    const file=path.join(installed,'config.json');const config=p.readJson(file);config.backgroundMode='wmi-breakaway';p.writeJson(file,config);
    const result=await execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'job-lifetime.ps1'),
      '-ConfigPath',file,'-LauncherPath',path.join(__dirname,'worker-launcher.cjs'),'-FixtureDirectory',dir],{windowsHide:true,timeout:40000,encoding:'utf8'});
    const proof=JSON.parse(result.stdout);
    assert.equal(proof.launcherExited,true,'fixture launcher must be killed by closing its Job');
    assert.equal(proof.workerAlive,true,'brokered worker must survive launcher Job closure');
    assert.equal(proof.heartbeatAdvanced,true,'worker heartbeat must continue after Job closure');
    assert.equal(proof.parentName.toLowerCase(),'wmiprvse');
  } finally {
    if(fs.existsSync(path.join(installed,'config.json'))) await run('uninstall');
    await new Promise(resolve=>server.close(resolve));
    assert.ok(dir.startsWith(root+path.sep+'.test-'));fs.rmSync(dir,{recursive:true,force:true});
  }
});

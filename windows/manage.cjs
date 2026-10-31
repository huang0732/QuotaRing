'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const p=require('./platform.cjs');
const agent=require('../agent.cjs');
const VERSION='1.0.0';
const PANEL_FILES=['CodexUsagePanel.exe','panel.html','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','WEBVIEW2-LICENSE.txt'].map(name=>'windows/panel/bin/'+name);
const CORE_FILES=['agent.cjs','manage.cjs','LICENSE','windows/manage.cjs','windows/platform.cjs','windows/system.ps1','windows/login.ps1'];
const FILES=[...CORE_FILES,'windows/usage-monitor.cjs','windows/reset-time.cjs','windows/taskbar.cjs',...PANEL_FILES];
const UNINSTALL_FILES=[...FILES,'launch.vbs','agent.log','stop.json','worker-state.json'];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const configPath=dir=>path.join(dir,'config.json');
function options(argv) {
  const result={command:argv[0] || 'help'};
  for(let i=1;i<argv.length;i++) {
    if(argv[i]==='--auto-start') result.autoStart=true;
    else if(argv[i]==='--no-auto-start') result.autoStart=false;
    else if(argv[i]==='--no-shortcuts') result.noShortcuts=true;
    else if(['--install-dir','--app','--codex-bin'].includes(argv[i])) {
      const key={'--install-dir':'dir','--app':'appPath','--codex-bin':'codexBin'}[argv[i]];
      if(!argv[i+1] || argv[i+1].startsWith('--')) throw Error(`缺少参数：${argv[i]}`);
      result[key]=path.resolve(argv[++i]);
    } else throw Error(`未知参数：${argv[i]}`);
  }
  result.dir=path.resolve(result.dir || p.homeDir());
  return result;
}
function chooseApp(system, explicit, saved) {
  const choices=explicit ? [explicit] : [...system.apps,saved].filter(Boolean);
  const app=choices.find(file=>/^(ChatGPT|Codex)\.exe$/i.test(path.basename(file)) && fs.existsSync(file));
  if(!app) throw Error('找不到 Codex 桌面客户端。请使用 --app "完整路径\\ChatGPT.exe" 指定。');
  return app;
}
function state(dir) {
  const value=p.readJson(path.join(dir,'worker-state.json'));
  return value?.owner===p.OWNER && p.alive(value.pid) && Date.now()-value.heartbeat<20000 ? value : null;
}
async function start(dir) {
  const config=p.ownedConfig(dir);
  if(state(dir)) return;
  if(config.backgroundMode==='wmi-breakaway') {
    p.system('StartWorker',configPath(dir));
  } else {
    // Compatibility path for unintegrated portable setups and isolated tests.
    const log=fs.openSync(path.join(dir,'agent.log'),'a');
    try {
      const child=spawn(process.execPath,[path.join(dir,'manage.cjs'),'worker','--install-dir',dir],{
        cwd:dir,detached:true,windowsHide:true,stdio:['ignore',log,log],env:process.env
      });
      await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});
      child.unref();
    } finally { fs.closeSync(log); }
  }
  for(let i=0;i<60;i++) { if(state(dir)) return; await pause(200); }
  throw Error('后台未能启动，请检查安装目录的 agent.log，或运行诊断');
}
async function stop(dir) {
  p.ownedConfig(dir);
  const lock=p.readJson(path.join(dir,'worker.lock','owner.json'));
  if(!lock || !p.alive(lock.pid)) return;
  if(lock.owner!==p.OWNER) throw Error('无法确认后台归属');
  p.writeJson(path.join(dir,'stop.json'),{instance:lock.instance});
  for(let i=0;i<75;i++) {
    if(!fs.existsSync(path.join(dir,'worker.lock'))) return;
    await pause(200);
  }
  throw Error('后台未能正常停止，未强制终止任何进程');
}
async function worker(dir) {
  const config=p.ownedConfig(dir);
  const lockDir=path.join(dir,'worker.lock');
  if(fs.existsSync(lockDir)) {
    const old=p.readJson(path.join(lockDir,'owner.json'));
    if(!old || old.owner!==p.OWNER || p.alive(old.pid)) throw Error('已有后台进程或锁状态未确认');
    fs.unlinkSync(path.join(lockDir,'owner.json'));
    fs.rmdirSync(lockDir);
  }
  fs.mkdirSync(lockDir);
  const instance=randomUUID();
  p.writeJson(path.join(lockDir,'owner.json'),{owner:p.OWNER,instance,pid:process.pid});
  let monitor, timer, closing=false;
  const cleanup=()=>{
    const lock=p.readJson(path.join(lockDir,'owner.json'));
    if(lock?.instance!==instance) return;
    for(const file of ['worker-state.json','stop.json']) {
      try {fs.unlinkSync(path.join(dir,file));} catch(error) {if(error.code!=='ENOENT') throw error;}
    }
    fs.unlinkSync(path.join(lockDir,'owner.json')); fs.rmdirSync(lockDir);
  };
  const shutdown=async()=>{
    if(closing) return; closing=true;
    clearInterval(timer); await monitor?.stop(); cleanup();
  };
  process.once('exit',cleanup);
  process.once('SIGTERM',shutdown);
  process.once('SIGINT',shutdown);
  try {
    const logger=message=>fs.appendFileSync(path.join(dir,'agent.log'),`[${new Date().toISOString()}] ${message}\n`);
    monitor=config.displayMode==='taskbar' ? await require('./taskbar.cjs').startTaskbar({dir,config,logger}) :
      await agent.main({port:config.cdpPort || p.PORT,appPath:config.appPath,codexBin:p.createCodexResolver(config)(),logger});
    const heartbeat=()=>{
      if(p.readJson(path.join(dir,'stop.json'))?.instance===instance) {shutdown(); return;}
      p.writeJson(path.join(dir,'worker-state.json'),{
        owner:p.OWNER,version:VERSION,instance,pid:process.pid,launchMode:config.backgroundMode || 'legacy',heartbeat:Date.now(),...monitor.status()
      });
    };
    heartbeat(); timer=setInterval(heartbeat,1000);
  } catch(error) {shutdown(); throw error;}
}
async function install(opts) {
  const dir=p.assertDirectory(opts.dir);
  const source=path.resolve(__dirname,'..');
  if(dir.toLowerCase()===source.toLowerCase()) throw Error('请选择不同于源码的安装目录');
  let migratedFrom=null;
  const oldDir=path.join(process.env.LOCALAPPDATA || path.join(require('node:os').homedir(),'AppData','Local'),'CodexUsageCard');
  // OpenAI is explicitly excluded from AppData virtualization by the installed
  // MSIX manifest. The old folder was only visible inside the package context.
  if(!process.env.CODEX_USAGE_CARD_HOME && dir.toLowerCase()===p.homeDir().toLowerCase() &&
    !fs.existsSync(configPath(dir)) && fs.existsSync(configPath(oldDir))) {
    const old=p.ownedConfig(oldDir);
    if(fs.existsSync(dir) && fs.readdirSync(dir).length) throw Error('新安装位置已有文件，迁移已停止');
    await stop(oldDir);
    if(!old.noShortcuts) {
      p.system('IntegrationStatus',configPath(oldDir));
      p.system('RemoveBackground',configPath(oldDir));
    }
    fs.mkdirSync(dir,{recursive:true});
    const backupDir=path.join(oldDir,'shortcut-backups');
    const manifest=p.readJson(path.join(backupDir,'manifest.json'));
    if(manifest) {
      fs.mkdirSync(path.join(dir,'shortcut-backups'));
      for(const name of ['manifest.json',...manifest.entries.map(e=>e.backup)]) {
        if(name!=='manifest.json' && !/^[a-f0-9]{32}\.lnk$/.test(name)) throw Error('旧备份文件名无效');
        const file=path.join(backupDir,name);
        if(fs.lstatSync(file).isSymbolicLink()) throw Error('旧备份是链接，已停止迁移');
        fs.copyFileSync(file,path.join(dir,'shortcut-backups',name));
      }
    }
    const login=path.join(oldDir,'login-integration.json');
    if(fs.existsSync(login)) {
      if(fs.lstatSync(login).isSymbolicLink()) throw Error('旧登录记录是链接，已停止迁移');
      fs.copyFileSync(login,path.join(dir,'login-integration.json'));
    }
    p.writeJson(configPath(dir),{...old,installDir:dir,migratedFrom:oldDir});
    migratedFrom=oldDir;
  }
  if(fs.existsSync(dir)) {
    const entries=fs.readdirSync(dir);
    if(entries.length) p.ownedConfig(dir);
  }
  const previous=p.ownedConfig(dir,false);
  const system=p.inspectSystem();
  const appPath=chooseApp(system,opts.appPath,previous?.appPath);
  const codexBin=opts.codexBin || previous?.codexBin || null;
  p.createCodexResolver({codexBin,appPath},{inspect:()=>system})();
  if(previous) await stop(dir);
  fs.mkdirSync(dir,{recursive:true});
  const runtimeFiles=opts.noShortcuts?CORE_FILES:FILES;
  for(const relative of runtimeFiles) {
    const destination=path.join(dir,relative);
    p.assertDirectory(path.dirname(destination));
    if(fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) throw Error('安装文件是链接，已中止');
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.copyFileSync(path.join(source,relative),destination);
  }
  if(previous && !previous.noShortcuts && opts.noShortcuts) {
    p.login('Restore',configPath(dir));
    p.system('RestoreOriginal',configPath(dir));
    p.system('RemoveBackground',configPath(dir));
    p.system('RemoveShortcuts',configPath(dir));
  }
  if(previous && !previous.noShortcuts && !opts.noShortcuts) {
    // Moving the display out of Codex removes the need for desktop debugging flags.
    await cleanupUi();
    p.system('RestoreOriginal',configPath(dir));
    p.login('Restore',configPath(dir));
  }
  const config={owner:p.OWNER,version:VERSION,installDir:dir,nodePath:process.execPath,appPath,
    codexBin,
    autoStart:!opts.noShortcuts && opts.autoStart!==false,noShortcuts:!!opts.noShortcuts,
    backgroundMode:opts.noShortcuts ? 'legacy' : 'wmi-breakaway',
    cdpPort:opts.noShortcuts ? Number(process.env.CODEX_BADGE_PORT)||p.PORT : p.PORT,
    displayMode:opts.noShortcuts?'sidebar':'taskbar',
    ...(previous?.migratedFrom || migratedFrom ? {migratedFrom:previous?.migratedFrom || migratedFrom} : {}),
    ...(process.env.CODEX_HOME ? {codexHome:process.env.CODEX_HOME} : {})};
  p.writeJson(configPath(dir),config);
  p.writeLauncher(path.join(dir,'launch.vbs'),process.execPath,path.join(dir,'manage.cjs'));
  if(!opts.noShortcuts) {
    if(config.autoStart) p.system('InstallBackground',configPath(dir));
    else p.system('RemoveBackground',configPath(dir));
    p.system('RemoveShortcuts',configPath(dir));
  }
  await start(dir);
  if(config.migratedFrom && fs.existsSync(configPath(config.migratedFrom))) {
    p.ownedConfig(config.migratedFrom);
    fs.renameSync(configPath(config.migratedFrom),path.join(config.migratedFrom,'migrated-config.json'));
  }
  console.log('Windows 任务栏版已安装，圆环横向排列在任务栏右侧，点击后在正上方显示详情卡；关闭 Codex 后仍查询额度。');
  console.log('后台已启动；当前工作窗口保持运行。'+(config.autoStart ? '插件后台随 Windows 登录启动，不会自动打开 Codex。' : '插件后台未设置登录自启。'));
}
async function launch(opts) {
  const config=p.ownedConfig(opts.dir);
  if(config.displayMode==='taskbar')return start(opts.dir);
  const pages=await p.targets();
  if(pages.some(agent.isMainWindow)) {await start(opts.dir); return;}
  const system=p.inspectSystem();
  const app=chooseApp(system,opts.appPath,config.appPath);
  if(system.running.length) throw Error('Codex 正在运行且没有启用本地连接。请保存工作并完全退出，再点击原来的 Codex 图标。');
  if(pages.length) throw Error('本地调试端口已被其他应用占用，未启动 Codex');
  if(app!==config.appPath) {config.appPath=app; p.writeJson(configPath(opts.dir),config);}
  await start(opts.dir);
  const child=spawn(app,[`--remote-debugging-port=${p.PORT}`,'--remote-debugging-address=127.0.0.1'],{
    cwd:path.dirname(app),detached:true,windowsHide:true,stdio:'ignore'
  });
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});
  child.unref();
  for(let i=0;i<60;i++) {if((await p.targets()).some(agent.isMainWindow)) return; await pause(500);}
  throw Error('客户端已启动，但本地连接尚未就绪。请运行诊断；当前客户端版本可能不支持启动参数。');
}
async function cleanupUi() {
  for(const target of (await p.targets()).filter(agent.isMainWindow)) {
    const session=new agent.CdpSession(target,p.PORT);
    try {await session.connect(); await session.evaluate('window.__codexUsageBadge?.destroy()');} catch {} finally {session.close();}
  }
}
function checkedFile(dir,file) {
  const stat=p.assertContainedPath(dir,file);
  if(stat&&!stat.isFile())throw Error('安装文件不是普通文件，已中止卸载');
  return stat;
}
function checkedProfile(dir) {
  const profile=path.join(dir,'panel-profile'),stat=p.assertContainedPath(dir,profile);
  if(!stat)return false;
  if(!stat.isDirectory())throw Error('显示缓存不是普通目录，已中止卸载');
  const marker=path.join(profile,'.owner');
  if(!checkedFile(dir,marker)||fs.readFileSync(marker,'utf8')!=='codex-usage-card-panel-v1')throw Error('显示缓存归属不明，未清理');
  return true;
}
function checkedLock(dir) {
  const folder=path.join(dir,'worker.lock'),stat=p.assertContainedPath(dir,folder);
  if(!stat)return null;
  if(!stat.isDirectory())throw Error('后台锁不是普通目录，已中止卸载');
  const owner=path.join(folder,'owner.json');
  if(!checkedFile(dir,owner))throw Error('后台锁归属不明，已中止卸载');
  const lock=p.readJson(owner);
  if(lock?.owner!==p.OWNER||!Number.isSafeInteger(lock.pid)||lock.pid<=0||typeof lock.instance!=='string'||!lock.instance.trim()) {
    throw Error('后台锁记录无效，已中止卸载');
  }
  if(fs.readdirSync(folder).some(name=>name!=='owner.json'))throw Error('后台锁目录含有未知文件，已中止卸载');
  return lock;
}
function cleanStoppedLock(dir,expected) {
  const same=lock=>lock&&expected&&lock.owner===expected.owner&&lock.pid===expected.pid&&lock.instance===expected.instance;
  const lock=checkedLock(dir);
  if(!lock)return;
  if(!same(lock))throw Error('后台锁实例已变化，已中止卸载');
  try {process.kill(lock.pid,0);}
  catch(error) {
    if(error.code!=='ESRCH')throw Error('无法确认后台已结束，已中止卸载');
    // Recheck ownership and all paths after the process check. Never recursively
    // delete a lock directory or clear a replacement worker's lock.
    if(!same(checkedLock(dir)))throw Error('后台锁实例已变化，已中止卸载');
    fs.unlinkSync(path.join(dir,'worker.lock','owner.json'));
    p.assertContainedPath(dir,path.join(dir,'worker.lock'));
    fs.rmdirSync(path.join(dir,'worker.lock'));
    return;
  }
  throw Error('后台仍在运行，已中止卸载');
}
function preflightUninstall(dir) {
  const config=p.ownedConfig(dir);
  for(const relative of UNINSTALL_FILES)checkedFile(dir,path.join(dir,relative));
  for(const folder of ['windows','windows/panel','windows/panel/bin','worker.lock']) {
    const stat=p.assertContainedPath(dir,path.join(dir,folder));
    if(stat&&!stat.isDirectory())throw Error('安装子目录不是普通目录，已中止卸载');
  }
  const lock=checkedLock(dir);
  checkedProfile(dir);
  return {config,lock};
}
async function uninstall(opts) {
  const before=preflightUninstall(opts.dir);
  await stop(opts.dir);
  const {config}=preflightUninstall(opts.dir);
  cleanStoppedLock(opts.dir,before.lock);
  if(config.displayMode!=='taskbar')await cleanupUi();
  if(!config.noShortcuts) {
    p.login('Restore',configPath(opts.dir));
    p.system('RestoreOriginal',configPath(opts.dir));
    p.system('RemoveBackground',configPath(opts.dir));
    p.system('RemoveShortcuts',configPath(opts.dir));
  }
  // Delete only our known files. Unknown files and the Codex app are left alone.
  for(const relative of UNINSTALL_FILES) {
    const file=path.join(opts.dir,relative);
    if(checkedFile(opts.dir,file))fs.unlinkSync(file);
  }
  const profile=path.join(opts.dir,'panel-profile');
  if(checkedProfile(opts.dir)) {
    await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
  if(checkedFile(opts.dir,configPath(opts.dir)))fs.unlinkSync(configPath(opts.dir));
  for(const folder of [path.join(opts.dir,'windows','panel','bin'),path.join(opts.dir,'windows','panel'),path.join(opts.dir,'windows'),opts.dir]) {
    const stat=p.assertContainedPath(opts.dir,folder);
    if(stat&&!stat.isDirectory())throw Error('安装子目录不是普通目录，已中止卸载');
    if(stat&&!fs.readdirSync(folder).length)fs.rmdirSync(folder);
  }
  console.log('已卸载 Windows 用量卡片。Codex 客户端保持运行；本地调试端口会在客户端完全退出时关闭。');
}
async function doctor(opts) {
  const config=p.ownedConfig(opts.dir,false);
  const info=p.inspectSystem();
  const integration=config && !config.noShortcuts ? JSON.parse(p.system('IntegrationStatus',configPath(opts.dir))) : null;
  if(integration) Object.assign(integration,JSON.parse(p.login('Status',configPath(opts.dir))));
  let app=false,cli=false;
  try {chooseApp(info,opts.appPath,config?.appPath);app=true;} catch {}
  try {p.createCodexResolver({codexBin:opts.codexBin||config?.codexBin,appPath:opts.appPath||config?.appPath},{inspect:()=>info})();cli=true;} catch {}
  const runtime=state(opts.dir);
  if(config?.displayMode==='taskbar') {
    const panel=runtime?.panel;
    const actualVisible=!!(panel?.nativeVisible&&panel.visibility?.unobscured&&panel.visibility.cloaked===0&&panel.rendering?.badgeFits);
    console.log(JSON.stringify({version:VERSION,installed:true,displayMode:'taskbar',desktopRequired:false,
      background:runtime?'running':'stopped',backgroundMode:runtime?.launchMode??config.backgroundMode,
      actualVisible,
      dataAvailable:runtime?.dataAvailable??false,updatedAt:runtime?.updatedAt??null,panel:runtime?.panel??null,
      backgroundAtLogin:integration?.backgroundAtLogin??false,
      next:actualVisible?'任务栏圆环未被遮挡，内容完整落在窗口内。':panel?.hiddenReason?'当前隐藏原因：'+panel.hiddenReason:'检查窗口遮挡和内容缩放；不能仅根据 ready 判断可见。'},null,2));return;
  }
  const pages=(await p.targets()).filter(agent.isMainWindow);
  const ui=[];
  for(const target of pages) {
    const session=new agent.CdpSession(target,p.PORT);
    try {await session.connect();const response=await session.evaluate('(()=>{const b=window.__codexUsageBadge?.status();return b?{version:b.version,placed:b.placed,stale:b.stale,badgeCount:b.badgeCount,hasData:!!b.updatedAt}:null})()');ui.push(response.result?.value ?? null);}
    catch {ui.push(null);} finally {session.close();}
  }
  console.log(JSON.stringify({version:VERSION,node:process.version,installed:!!config,
    desktopFound:app,cliFound:cli,desktopRunning:info.running.length>0,
    background:runtime ? 'running' : 'stopped',backgroundMode:runtime?.launchMode || config?.backgroundMode || null,
    integration,localConnection:pages.length>0,ui,
    next: !runtime ? '插件后台未运行，请执行 node manage.cjs start。' : !pages.length ? '保存工作并完全退出 Codex，再点击原来的 Codex 图标。' :
      ui.some(b=>b?.placed && b.hasData && !b.stale) ? '用量卡片已显示并读取额度。' : '本地连接正常，但用量卡片尚未就绪，请检查登录和插件后台。'
  },null,2));
}
async function readUsage(opts) {
  const config=p.ownedConfig(opts.dir,false);
  const client=new agent.AppServerClient({command:p.createCodexResolver({codexBin:opts.codexBin||config?.codexBin,appPath:opts.appPath||config?.appPath})()});
  try {
    await client.start();
    // Only formatted quota data, never authentication data, is printed.
    console.log(JSON.stringify(agent.formatRateLimits(client.rateLimits),null,2));
  } finally {client.stop();}
}
async function main(argv=process.argv.slice(2)) {
  if(Number(process.versions.node.split('.')[0])<24) throw Error('需要 Node.js 24 或更新版本');
  const opts=options(argv);
  const config=p.ownedConfig(opts.dir,false);
  if(config?.codexHome && !process.env.CODEX_HOME) process.env.CODEX_HOME=config.codexHome;
  switch(opts.command) {
    case 'install': return install(opts);
    case 'uninstall': return uninstall(opts);
    case 'launch': return launch(opts);
    case 'start': return start(opts.dir);
    case 'stop': return stop(opts.dir);
    case 'worker': return worker(opts.dir);
    case 'doctor': case 'status': return doctor(opts);
    case 'read': return readUsage(opts);
    case 'help': console.log('node manage.cjs install|launch|status|read|stop|uninstall\n可选参数：--app <exe> --codex-bin <exe> --install-dir <目录>\n默认在任务栏右侧独立显示，随登录启动；--no-auto-start 可关闭后台登录自启'); return;
    default: throw Error('未知操作。运行 node manage.cjs help 查看用法');
  }
}
module.exports={main,options,chooseApp,install,stop,start,uninstall,worker,state,FILES,CORE_FILES};

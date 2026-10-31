'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const OWNER = 'codex-usage-card-windows-v1';
const PORT = 39222;
function runScript(script, args) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return execFileSync(powershell, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
    path.join(__dirname,script),...args],
  {encoding:'utf8', windowsHide:true, stdio:['ignore','pipe','pipe'], timeout:20000, maxBuffer:1024*1024}).trim();
}
function system(action, configPath, shortcutDirectory) {
  return runScript('system.ps1',['-Action',action,...(configPath ? ['-ConfigPath',configPath] : []),
    ...(shortcutDirectory ? ['-ShortcutDirectory',shortcutDirectory] : [])]);
}
function login(action, configPath) { return runScript('login.ps1',['-Action',action,'-ConfigPath',configPath]); }
function inspectSystem() { return JSON.parse(system('Inspect').replace(/^\uFEFF/,'')); }
function homeDir() {
  return path.resolve(process.env.CODEX_USAGE_CARD_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'OpenAI','CodexUsageCard'));
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file,'utf8')); }
  catch(error) { if (error.code === 'ENOENT') return null; throw error; }
}
function writeJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value,null,2)+'\n');
  fs.renameSync(temporary,file);
}
function assertDirectory(dir) {
  const resolved = path.resolve(dir);
  if (resolved === path.parse(resolved).root) throw Error('安装目录不能是磁盘根目录');
  // Refuse reparse points/junctions, including ancestors, before writing or deleting.
  for (let current=resolved; current!==path.dirname(current); current=path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error('安装目录不能经过符号链接或目录联接'); }
    catch(error) { if(error.code !== 'ENOENT') throw error; }
  }
  return resolved;
}
function assertContainedPath(dir, file) {
  const root=assertDirectory(dir),target=path.resolve(file);
  const outside=value=>value==='..'||value.startsWith('..'+path.sep)||path.isAbsolute(value);
  if(outside(path.relative(root,target))) throw Error('目标路径超出插件安装目录');
  // The installation root and its ancestors were checked above. Its parent may
  // legitimately be a drive root; only descendants need another parent check.
  if(path.relative(root,target)!=='')assertDirectory(path.dirname(target));
  let stat;
  try {stat=fs.lstatSync(target);} catch(error) {if(error.code==='ENOENT')return null;throw error;}
  if(stat.isSymbolicLink()) throw Error('目标路径包含符号链接或目录联接，已中止');
  if(outside(path.relative(fs.realpathSync(root),fs.realpathSync(target)))) throw Error('目标实际路径超出插件安装目录');
  return stat;
}
function ownedConfig(dir, required=true) {
  assertDirectory(dir);
  const stat=assertContainedPath(dir,path.join(dir,'config.json'));
  if(stat&&!stat.isFile()) throw Error('插件安装标记不是普通文件');
  const config=readJson(path.join(dir,'config.json'));
  if (!config && !required) return null;
  if (config?.owner !== OWNER || config.installDir?.toLowerCase() !== path.resolve(dir).toLowerCase()) throw Error('未找到本插件的安装标记，未修改此目录');
  return config;
}
function alive(pid) {
  if(!Number.isInteger(pid) || pid<=0) return false;
  try { process.kill(pid,0); return true; } catch(error) { return error.code === 'EPERM'; }
}
function quoteVbs(value) { return String(value).replaceAll('"','""'); }
function launcherVbs(node, manager) {
  if (/[\r\n"]/u.test(node+manager)) throw Error('路径包含不支持的字符');
  const command=`"${node}" "${manager}" start --install-dir "${path.dirname(manager)}"`;
  return `' ${OWNER}\r\nSet shell = CreateObject("WScript.Shell")\r\nresult = shell.Run("${quoteVbs(command)}", 0, True)\r\nIf result <> 0 Then MsgBox "QuotaRing 后台未能启动。请运行解压文件夹中的诊断-Windows.cmd 检查状态。", 48, "QuotaRing"\r\n`;
}
function writeLauncher(file, node, manager) {
  const dir=assertDirectory(path.dirname(file));
  const check=()=>{const stat=assertContainedPath(dir,file);if(stat&&!stat.isFile())throw Error('自启脚本不是普通文件');};
  check();
  const temporary=path.join(dir,'.launch-'+randomUUID()+'.tmp');
  const content=Buffer.from('\uFEFF'+launcherVbs(node,manager),'utf16le');
  let created=false;
  try {
    fs.writeFileSync(temporary,content,{flag:'wx'});
    created=true;
    check();
    fs.renameSync(temporary,file);
  } finally {
    if(created){const stat=assertContainedPath(dir,temporary);if(stat)fs.unlinkSync(temporary);}
  }
}
function createCodexResolver(config={}, {inspect=()=>module.exports.inspectSystem(),resolve=(...args)=>require('../agent.cjs').resolveCodexBin(...args)}={}) {
  let appPath=config.appPath||'';
  const explicit=config.codexBin&&config.codexBin!=='codex'?config.codexBin:null;
  return ()=>{
    if(explicit)return resolve(explicit,appPath);
    try {return resolve('codex',appPath);} catch(initialError) {
      let apps;
      try {apps=inspect().apps||[];} catch {throw initialError;}
      for(const current of apps) {
        if(!current||current===appPath)continue;
        try {const command=resolve('codex',current);appPath=current;return command;} catch {}
      }
      throw initialError;
    }
  };
}
async function targets() {
  try {
    const response=await fetch(`http://127.0.0.1:${PORT}/json/list`,{signal:AbortSignal.timeout(1500),redirect:'error'});
    if(!response.ok) return [];
    const list=await response.json();
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
module.exports={OWNER,PORT,system,login,inspectSystem,homeDir,readJson,writeJson,assertDirectory,assertContainedPath,ownedConfig,alive,launcherVbs,writeLauncher,createCodexResolver,targets};

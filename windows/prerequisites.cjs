'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync,spawn}=require('node:child_process');
const readline=require('node:readline/promises');

const WEBVIEW2_CLIENT='{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
const WEBVIEW2_BOOTSTRAPPER='https://go.microsoft.com/fwlink/p/?LinkId=2124703';
const MAX_BOOTSTRAPPER_BYTES=32*1024*1024;
const WEBVIEW2_INSTALL_TIMEOUT_MS=3*60*1000;

function registryPaths() {
  return [
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_CLIENT}`,
    `HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_CLIENT}`,
    `HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_CLIENT}`
  ];
}

function detectWebView2({run=spawnSync,platform=process.platform}={}) {
  if(platform!=='win32')return null;
  for(const key of registryPaths()) {
    const result=run(path.join(process.env.SystemRoot||'C:\\Windows','System32','reg.exe'),['query',key,'/v','pv','/reg:64'],{encoding:'utf8',windowsHide:true,timeout:10000});
    if(result.error||result.status!==0)continue;
    const match=String(result.stdout||'').match(/\bpv\s+REG_SZ\s+([0-9]+(?:\.[0-9]+){1,3})/i);
    if(match&&match[1].split('.').some(part=>Number(part)>0))return match[1];
  }
  return null;
}

function ensureFramework({run=spawnSync}={}) {
  const result=run(path.join(process.env.SystemRoot||'C:\\Windows','System32','reg.exe'),
    ['query','HKLM\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full','/v','Release','/reg:64'],
    {encoding:'utf8',windowsHide:true,timeout:10000});
  const match=String(result.stdout||'').match(/\bRelease\s+REG_DWORD\s+(0x[0-9a-f]+|[0-9]+)/i);
  if(result.error||result.status!==0||!match||Number(match[1])<528040) {
    throw Error('显示组件需要 .NET Framework 4.8 或更新兼容版本。请安装后重试；微软说明：https://learn.microsoft.com/dotnet/framework/install/on-windows-10');
  }
}

async function confirmInstall({input=process.stdin,output=process.stdout}={}) {
  if(!input.isTTY||!output.isTTY)throw Error('缺少 WebView2 Runtime。请在解压文件夹中双击“安装-Windows.cmd”以继续安装。');
  const prompt=readline.createInterface({input,output});
  try {
    const answer=await prompt.question('是否现在从微软下载并安装 WebView2 Runtime？[Y/N] ');
    return /^y(?:es)?$/i.test(answer.trim());
  } finally {prompt.close();}
}

async function downloadBootstrapper(destination,{fetchImpl=globalThis.fetch}={}) {
  const signal=AbortSignal.timeout(120000);
  let url=WEBVIEW2_BOOTSTRAPPER,response;
  for(let attempt=0;attempt<6;attempt++) {
    const target=new URL(url);
    if(target.protocol!=='https:'||!['microsoft.com','msedge.net'].some(domain=>target.hostname===domain||target.hostname.endsWith('.'+domain))) {
      throw Error('微软下载地址异常，已中止。');
    }
    response=await fetchImpl(url,{redirect:'manual',signal});
    if([301,302,303,307,308].includes(response.status)) {
      const next=response.headers.get('location');
      await response.body?.cancel();
      if(!next)throw Error('微软下载重定向无效。');
      url=new URL(next,url).href;continue;
    }
    break;
  }
  if(!response.ok)throw Error(`微软下载失败（HTTP ${response.status}）。`);
  const declared=Number(response.headers?.get?.('content-length')||0);
  if(declared>MAX_BOOTSTRAPPER_BYTES)throw Error('下载文件大小异常，已中止。');
  const file=await fs.promises.open(destination,'wx');
  let length=0;
  try {
    for await(const chunk of response.body) {
      length+=chunk.length;
      if(length>MAX_BOOTSTRAPPER_BYTES)throw Error('下载文件大小异常，已中止。');
      await file.writeFile(chunk);
    }
    if(!length||(declared&&length!==declared))throw Error('微软安装引导程序下载不完整。');
  } finally {await file.close();}
}

function verifyMicrosoftSignature(file,{run=spawnSync,env=process.env,platform=process.platform}={}) {
  if(platform!=='win32')throw Error('只能在 Windows 上验证微软安装程序。');
  const powershell=path.join(env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const script='$s=Get-AuthenticodeSignature -LiteralPath $env:QUOTARING_WEBVIEW2_SETUP; if ($s.Status -ne \'Valid\' -or -not $s.SignerCertificate -or $s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false) -ne \'Microsoft Corporation\') { exit 1 }';
  const result=run(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{
    encoding:'utf8',windowsHide:true,timeout:30000,env:{...env,
      PSModulePath:path.join(path.dirname(powershell),'Modules'),QUOTARING_WEBVIEW2_SETUP:path.resolve(file)}
  });
  if(result.error||result.status!==0)throw Error('无法确认安装程序由微软签名，已中止。');
}

function runBootstrapper(file,{timeoutMs=WEBVIEW2_INSTALL_TIMEOUT_MS,spawnProcess=spawn}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawnProcess(file,['/silent','/install'],{windowsHide:true,detached:true,stdio:'ignore'});
    let settled=false;
    const finish=(error,code)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);
      if(error)reject(error);else resolve(code);
    };
    const timer=setTimeout(()=>{
      if(settled)return;
      // Let the setup process finish independently; never kill shared Edge updaters.
      child.unref();
      const error=Error('等待 WebView2 安装结束超时。微软安装程序可能仍在后台运行；请等待其结束后，再重新运行“安装-Windows.cmd”。');
      error.code='WEBVIEW2_INSTALL_TIMEOUT';
      finish(error);
    },timeoutMs);
    child.once('error',error=>finish(Error(`WebView2 安装未能启动：${error.message}`)));
    child.once('exit',(code,signal)=>signal?finish(Error('WebView2 安装被中断。')):finish(null,code));
  });
}

async function ensureWebView2({
  detect=detectWebView2,confirm=confirmInstall,download=downloadBootstrapper,
  verify=verifyMicrosoftSignature,install=runBootstrapper,output=process.stdout,
  tempDirectory=os.tmpdir(),
  platform=process.platform
}={}) {
  const current=detect({platform});
  if(current)return {installed:true,version:current,source:'existing'};
  output.write('QuotaRing 的任务栏面板需要微软 WebView2 Runtime。\n');
  if(!await confirm())throw Error('已取消 WebView2 安装；QuotaRing 尚未安装或更新。');
  const folder=fs.mkdtempSync(path.join(tempDirectory,'QuotaRing-WebView2-'));
  const file=path.join(folder,'MicrosoftEdgeWebview2Setup.exe');
  let installerTimedOut=false;
  try {
    output.write('正在从微软下载 WebView2 安装引导程序……\n');
    await download(file);
    verify(file,{platform});
    output.write('正在安装 WebView2 Runtime（最多等待 3 分钟）。请保持此窗口打开；安装完成后会自动继续。\n');
    const exitCode=await install(file);
    let version=detect({platform});
    for(let attempt=0;!version&&exitCode===0&&attempt<5;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,1000));version=detect({platform});
    }
    if(!version)throw Error(`WebView2 安装未通过检查${Number.isInteger(exitCode)&&exitCode!==0?`（退出代码 ${exitCode}）`:''}。`);
    output.write(`WebView2 Runtime 已就绪（${version}），继续安装 QuotaRing。\n`);
    return {installed:true,version,source:'installed'};
  } catch(error) {
    installerTimedOut=error.code==='WEBVIEW2_INSTALL_TIMEOUT';
    throw Error(`WebView2 未能安装；QuotaRing 尚未安装或更新。${error.message}请检查网络或安装策略后重试；微软官方下载：${WEBVIEW2_BOOTSTRAPPER}`,{cause:error});
  } finally {
    if(installerTimedOut)output.write('微软安装程序可能仍在运行，临时安装文件保留在：'+folder+'\n');
    else {
      try {fs.unlinkSync(file);fs.rmdirSync(folder);} catch(error) {
        if(error.code==='ENOENT') {try{fs.rmdirSync(folder);}catch{}}
        else output.write('临时安装程序仍被占用，已保留在：'+folder+'\n');
      }
    }
  }
}

module.exports={WEBVIEW2_BOOTSTRAPPER,WEBVIEW2_INSTALL_TIMEOUT_MS,registryPaths,detectWebView2,ensureFramework,confirmInstall,downloadBootstrapper,verifyMicrosoftSignature,runBootstrapper,ensureWebView2};

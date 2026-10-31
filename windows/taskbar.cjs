'use strict';
const fs=require('node:fs');const path=require('node:path');const readline=require('node:readline');
const {spawn}=require('node:child_process');const {UsageMonitor}=require('./usage-monitor.cjs');
async function startTaskbar({dir,config,logger=()=>{},profileDir}) {
  const binary=path.join(dir,'windows','panel','bin','CodexUsagePanel.exe');
  if(!fs.existsSync(binary))throw Error('任务栏显示组件缺失，请运行构建脚本后重新安装');
  const profile=require('./platform.cjs').assertDirectory(profileDir||path.join(dir,'panel-profile'));fs.mkdirSync(profile,{recursive:true});
  const marker=path.join(profile,'.owner');
  if(!fs.existsSync(marker)&&fs.readdirSync(profile).length)throw Error('显示缓存目录已有未知文件，未覆盖');
  if(fs.existsSync(marker)&&fs.readFileSync(marker,'utf8')!=='codex-usage-card-panel-v1')throw Error('显示缓存目录归属不匹配');
  fs.writeFileSync(marker,'codex-usage-card-panel-v1');
  let host=null,lines=null,stopped=false,ui=null,retryTimer=null,restarts=0,stopPromise=null;
  let value={percent:null,title:'正在读取 Codex 剩余用量',tone:'muted',windowLabel:'',stale:true};
  const send=message=>{if(host?.stdin.writable)host.stdin.write(JSON.stringify(message)+'\n',()=>{});};
  function launch() {
    if(stopped)return;
    const child=spawn(binary,['--profile',profile,'--parent',String(process.pid),...(config.panelTest?['--test-host']:[])],
      {cwd:path.dirname(binary),windowsHide:false,stdio:['pipe','pipe','pipe']});
    host=child;ui={ready:false,visible:false,hiddenReason:'starting'};
    child.stdin.on('error',()=>{});child.stderr.resume();
    lines=readline.createInterface({input:child.stdout});
    lines.on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}
      if(m.type==='status'){ui=m;restarts=0;}else if(m.type==='error'){logger('任务栏显示组件错误：'+String(m.code)+(m.message?'；'+String(m.message):''));}
    });
    let finished=false;const gone=()=>{
      if(finished)return;finished=true;if(host===child){host=null;ui={ready:false,visible:false,hiddenReason:'host-exit'};}
      lines?.close();if(!stopped)retryTimer=setTimeout(launch,Math.min(30000,2000*++restarts));
    };
    child.once('error',gone);child.once('exit',gone);send({type:'usage',value});
  }
  const monitor=new UsageMonitor({resolveCommand:require('./platform.cjs').createCodexResolver(config),
    pollMs:config.pollMs||60000,onValue:next=>{value=next;send({type:'usage',value});}});
  launch();await monitor.start();
  return {
    stop(){if(stopped)return stopPromise;stopped=true;clearTimeout(retryTimer);monitor.stop();const child=host;
      stopPromise=child?new Promise(resolve=>{const kill=setTimeout(()=>{if(child.exitCode===null)child.kill();},5000);
        child.once('exit',()=>{clearTimeout(kill);resolve();});send({type:'shutdown'});child.stdin.end();}):Promise.resolve();return stopPromise;},
    status(){return {...monitor.status(),rendererConnections:0,panel:ui?{...ui,pid:host?.pid??null}:null};},
    test(scenario){if(config.panelTest)send({type:'test',scenario});}
  };
}
module.exports={startTaskbar};

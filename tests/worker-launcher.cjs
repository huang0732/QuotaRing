'use strict';
// This launcher is assigned to a kill-on-close Windows Job by job-lifetime.ps1.
const fs=require('node:fs');const path=require('node:path');
const [dir,gate,ready]=process.argv.slice(2);
(async()=>{
  while(!fs.existsSync(gate)) await new Promise(resolve=>setTimeout(resolve,20));
  const manager=require(path.join(dir,'windows','manage.cjs'));
  await manager.start(dir);
  fs.writeFileSync(ready,JSON.stringify({launcher:process.pid,worker:manager.state(dir).pid}));
  setInterval(()=>{},1000);
})().catch(error=>{console.error(error.message);process.exitCode=1;});

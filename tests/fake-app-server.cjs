'use strict';
const readline=require('node:readline');
let initialized=false;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const req=JSON.parse(line);
  if(req.method==='initialized') {initialized=true; return;}
  if(req.method==='initialize') {send({id:req.id,result:{userAgent:'test'}});return;}
  if(!initialized) {send({id:req.id,error:{message:'Not initialized'}});return;}
  if(req.method==='account/rateLimits/read') {
    send({id:req.id,result:{rateLimits:{limitId:'codex',planType:'plus',
      primary:{usedPercent:20,windowDurationMins:300},secondary:{usedPercent:60,windowDurationMins:10080}}}});
  } else if(req.method==='test/switch') {
    send({method:'account/updated',params:{authMode:null}});
    send({id:req.id,result:{}});
  } else if(req.method==='test/delta') {
    send({method:'account/rateLimits/updated',params:{rateLimits:{primary:{usedPercent:30}}}});
    send({id:req.id,result:{}});
  } else if(req.method==='test/timeout') {
    // Intentionally unanswered.
  } else {send({id:req.id,error:{message:'Unsupported test request'}});}
});

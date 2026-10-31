'use strict';
const {AppServerClient,formatRateLimits,unavailableValue}=require('../agent.cjs');
const {readResetTimes}=require('./reset-time.cjs');
// This reader has no renderer, CDP, desktop-process or window dependency.
class UsageMonitor {
  constructor({resolveCommand,pollMs=60000,retryMs=10000,onValue=()=>{},createClient=options=>new AppServerClient(options),now=Date.now}={}) {
    Object.assign(this,{resolveCommand,pollMs,retryMs,onValue,createClient,now});
    this.client=null;this.timer=null;this.pending=false;this.stopped=false;this.nextRead=0;this.failures=0;
    this.value={percent:null,title:'正在读取 Codex 剩余用量',tone:'muted',windowLabel:'',stale:true};
  }
  publish(value) {if(!this.stopped){this.value=value;this.onValue(value);}}
  unavailable() {this.publish({...unavailableValue(this.value),resetTimes:null});}
  async tick() {
    if(this.stopped||this.pending||this.now()<this.nextRead)return;
    this.pending=true;
    try {
      if(!this.client) {
        const client=this.createClient({command:this.resolveCommand()});this.client=client;
        client.on('rate-limits',data=>{if(this.client===client&&!this.stopped)this.publish({...formatRateLimits(data),resetTimes:readResetTimes(data),updatedAt:this.now(),stale:false});});
        client.on('account-changed',()=>{if(this.client===client){this.nextRead=0;this.unavailable();}});
        client.on('server-exit',()=>{if(this.client===client){this.client=null;this.nextRead=this.now()+this.retryMs;this.unavailable();}});
        await client.start();
      } else await this.client.refresh();
      this.failures=0;this.nextRead=this.now()+this.pollMs;
    } catch {
      const old=this.client;this.client=null;old?.stop();this.failures++;
      this.nextRead=this.now()+Math.min(60000,this.retryMs*this.failures);this.unavailable();
    } finally {this.pending=false;}
  }
  async start() {
    this.onValue(this.value);await this.tick();
    if(!this.stopped)this.timer=setInterval(()=>this.tick().catch(()=>{}),1000);
    return this;
  }
  stop() {this.stopped=true;clearInterval(this.timer);this.timer=null;const old=this.client;this.client=null;old?.stop();}
  status(){return {dataAvailable:!!this.value.updatedAt&&!this.value.stale,updatedAt:this.value.updatedAt??null,source:'codex-app-server',desktopRequired:false};}
}
module.exports={UsageMonitor};

// Local visual fixture. All values are synthetic, never account data.
'use strict';
const {createServer}=require('node:http');
const {buildBootstrapScript,formatRateLimits}=require('../agent.cjs');
const value=formatRateLimits({rateLimits:{planType:'plus',primary:{usedPercent:18,windowDurationMins:300,resetsAt:1793356800},secondary:{usedPercent:64,windowDurationMins:10080,resetsAt:1793788800}}});
const html=`<!doctype html><html class="light"><meta charset="utf-8"><title>QuotaRing · Test fixture</title><style>
*{box-sizing:border-box}body{margin:0;background:#fafafa;color:#242424;font:15px 'Segoe UI','Microsoft YaHei UI',sans-serif}nav{position:fixed;inset:0 auto 0 0;width:60px;background:#eee;display:flex;flex-direction:column;align-items:center;padding:16px 0 12px;border-right:1px solid #ddd}nav>div:first-child{flex:1}footer{padding:14px 0 2px;font-size:23px}main{margin:70px 100px;max-width:700px}p{color:#777;line-height:1.8}button{padding:10px 20px;border:1px solid #ccc;border-radius:8px;background:transparent;color:inherit;cursor:pointer}html.dark body{background:#202123;color:#eee}html.dark nav{background:#2b2c2e;border-color:#444}h1{font-weight:600}</style>
<nav data-app-navigation-rail><div>◉<br><br>＋<br><br>▤</div><footer>◌</footer></nav>
<main><p>WINDOWS PORT · VISUAL TEST</p><h1>QuotaRing</h1><p>左下角圆环沿用原版样式。此页为测试夹具，82% / 36% 为示例数据。<br>聚焦或悬停圆环可查看提示，点击按钮切换主题。</p><button onclick="document.documentElement.classList.toggle('dark');document.documentElement.classList.toggle('light')">切换明暗主题</button></main>
<script>${buildBootstrapScript()};window.__codexUsageBadge.update(${JSON.stringify({...value,updatedAt:Date.now(),stale:false})});</script></html>`;
const server=createServer((req,res)=>{if(req.url!=='/'){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
server.listen(39223,'127.0.0.1',()=>console.log('Synthetic UI fixture: http://127.0.0.1:39223/'));

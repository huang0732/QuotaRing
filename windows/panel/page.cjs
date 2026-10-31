'use strict';
const {buildBootstrapScript}=require('../../agent.cjs');
const {remainingResetUnits,installResetIndicators}=require('../reset-time.cjs');
function panelHtml(){
  return `<!doctype html><html class="light"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;"><title>QuotaRing</title><style>
html,body{margin:0;padding:0;overflow:hidden;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;background:#eef5fc}
html.dark,html.dark body{background:#292d32}
nav[data-app-navigation-rail]{display:flex;align-items:center;justify-content:center;width:100vw;height:100vh;background:inherit}
nav>footer{position:relative;width:1px;height:1px;flex:0 0 1px;margin-left:-1px;pointer-events:none}
:root{--panel-height:38px;--panel-ring:32px;--panel-meter:76px;--panel-single:90px;--panel-dual:174px;--panel-number:13px;--panel-number-line:15px;--panel-label:10px;--panel-label-line:11px}
html body #codex-usage-badge,html body #codex-usage-badge[data-mode="dual"]{margin:0;--usage-width:var(--panel-single);--usage-ring-size:var(--panel-ring);height:var(--panel-height);flex:0 0 auto;flex-direction:row;align-items:center;justify-content:center;gap:8px;padding:2px 6px;cursor:pointer}
html body #codex-usage-badge[data-mode="dual"]{--usage-width:var(--panel-dual)}
html body #codex-usage-badge .usage-primary,html body #codex-usage-badge .usage-secondary{display:grid;grid-template-columns:var(--panel-ring) 1fr;grid-template-rows:var(--panel-number-line) var(--panel-label-line);column-gap:4px;row-gap:0;align-content:center;width:var(--panel-meter);height:var(--panel-ring);flex:0 0 var(--panel-meter);padding:0;text-align:left}
html body #codex-usage-badge .usage-ring{position:static;grid-column:1;grid-row:1 / 3;left:auto;top:auto;transform:none;align-self:center}
html body #codex-usage-badge .usage-number{grid-column:2;grid-row:1;font-size:var(--panel-number);line-height:var(--panel-number-line)}
html body #codex-usage-badge .usage-window{grid-column:2;grid-row:2;font-size:var(--panel-label);line-height:var(--panel-label-line)}
html:not(.details) body #codex-usage-badge .usage-window{visibility:hidden}
html body #codex-usage-badge .usage-reset-progress{grid-column:2;grid-row:2;display:flex;align-items:center;align-self:center;width:max-content;max-width:100%;gap:var(--reset-dot-gap,2px);font-size:var(--panel-label);line-height:var(--panel-label-line);color:var(--usage-label)}
html body #codex-usage-badge .usage-reset-slot{display:block;flex:none;width:var(--reset-dot,4px);height:var(--reset-dot,4px);border-radius:50%;background:var(--reset-color);opacity:.18}
html body #codex-usage-badge .usage-reset-progress[data-kind="days"]{gap:var(--reset-bar-gap,1.5px)}
html body #codex-usage-badge .usage-reset-progress[data-kind="days"] .usage-reset-slot{width:var(--reset-bar-width,2.5px);height:var(--reset-bar-height,7px);border-radius:999px}
html body #codex-usage-badge .usage-reset-slot.is-lit{opacity:1}
html:not(.details) body #codex-usage-tooltip{display:none!important}
html.details nav{position:fixed;left:-1000px;width:34px;height:200px}
html.details body #codex-usage-tooltip[hidden],html.details body #codex-usage-tooltip{display:block!important;position:fixed!important;left:0!important;top:0!important;max-width:300px!important;width:max-content!important}
html.details body #codex-usage-tooltip .usage-tooltip-sections{grid-template-columns:max-content}
html.details body #codex-usage-tooltip[data-mode="dual"] .usage-tooltip-sections{grid-template-columns:max-content max-content}
html.details body #codex-usage-tooltip .usage-tooltip-reset{white-space:nowrap}
:root{--color-surface-elevated-secondary:#fff;--color-text-primary:#303630}
html.dark{--color-surface-elevated-secondary:#2c2e2c;--color-text-primary:#edf0ed}
</style></head><body><nav data-app-navigation-rail><footer></footer></nav><script>
if(new URL(location.href).searchParams.get('view')==='details')document.documentElement.classList.add('details');
${buildBootstrapScript()}
${remainingResetUnits.toString()}
${installResetIndicators.toString()}
const resetIndicators=installResetIndicators();
const post=value=>window.chrome?.webview?.postMessage(value);
function configure(height){const h=Math.max(8,Math.min(40,height)),ring=Math.max(2,h-6),number=Math.min(13,ring*.5),label=Math.min(10,ring*.36),textWidth=Math.ceil(Math.max(number*2.8,label*4)),meter=ring+4+textWidth;const values={height:h,ring,meter,single:meter+14,dual:meter*2+22,number,'number-line':number+2,label,'label-line':label+1};for(const [key,value]of Object.entries(values))document.documentElement.style.setProperty('--panel-'+key,value+'px');const dotGap=Math.min(2,textWidth/14),barGap=Math.min(1.5,textWidth/18);const sizes={dot:Math.max(.5,Math.min(4,(textWidth-4*dotGap)/5,label)),'dot-gap':dotGap,'bar-width':Math.max(.5,Math.min(2.5,(textWidth-6*barGap)/7)),'bar-height':Math.min(7,label),'bar-gap':barGap};for(const[key,value]of Object.entries(sizes))document.documentElement.style.setProperty('--reset-'+key,value+'px');report();}
function report(){
  const badge=document.getElementById('codex-usage-badge'),tip=document.getElementById('codex-usage-tooltip');
  const state=window.__codexUsageBadge.status(),tipRect=tip.getBoundingClientRect();
  const rect=document.documentElement.classList.contains('details')?tipRect:badge.getBoundingClientRect();
  const textFits=[...tip.querySelectorAll('.usage-tooltip-title,.usage-tooltip-label,.usage-tooltip-percent,.usage-tooltip-reset,.usage-tooltip-metadata')].every(el=>{
    const box=el.getBoundingClientRect();return el.scrollWidth<=el.clientWidth+1&&box.left>=tipRect.left-1&&box.right<=tipRect.right+1;
  });
  const timeFits=[...badge.querySelectorAll('.usage-reset-progress')].filter(el=>!el.parentElement.hidden).every(el=>{const box=el.getBoundingClientRect(),parent=el.parentElement.getBoundingClientRect();return el.scrollWidth<=el.clientWidth+1&&box.left>=parent.left-1&&box.right<=parent.right+1;});
  post({type:'layout',width:Math.ceil(rect.width),height:Math.ceil(rect.height),textFits,timeFits,indicators:resetIndicators.status(),pixelRatio:devicePixelRatio,viewportWidth:innerWidth,viewportHeight:innerHeight,labels:[...badge.querySelectorAll('.usage-primary,.usage-secondary')].filter(e=>!e.hidden).map(e=>e.querySelector('.usage-window').textContent),title:tip.querySelector('.usage-tooltip-title')?.textContent,stale:state.stale,updatedAt:state.updatedAt});
}
window.chrome?.webview?.addEventListener('message',event=>{const m=event.data;if(m.type==='usage'){window.__codexUsageBadge.update(m.value);resetIndicators.update(m.value);report();}else if(m.type==='theme'){document.documentElement.classList.toggle('dark',m.dark);document.documentElement.classList.toggle('light',!m.dark);resetIndicators.refresh();report();}else if(m.type==='layout-config'){configure(m.height);}else if(m.type==='details-state'){badge.setAttribute('aria-expanded',String(m.open));}});
const badge=document.getElementById('codex-usage-badge');
badge.setAttribute('aria-haspopup','dialog');badge.setAttribute('aria-expanded','false');
badge.addEventListener('click',()=>post({type:'toggle-details'}));
badge.addEventListener('keydown',event=>{if(event.key==='Escape')post({type:'close-details'});else if(event.key==='Enter'||event.key===' '){event.preventDefault();post({type:'toggle-details'});}});
window.addEventListener('resize',()=>requestAnimationFrame(report));document.addEventListener('visibilitychange',()=>{resetIndicators.refresh();report();});setInterval(()=>{if(resetIndicators.refresh())report();},1000);setInterval(report,5000);post({type:'ready'});report();
</script></body></html>`;
}
if(require.main===module)require('node:fs').writeFileSync(require('node:path').join(__dirname,'bin','panel.html'),panelHtml());
module.exports={panelHtml};

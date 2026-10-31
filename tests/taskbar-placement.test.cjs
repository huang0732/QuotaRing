'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const roundEven=value=>value-Math.floor(value)===.5?Math.floor(value)+(Math.floor(value)%2):Math.round(value);
const binary=path.resolve(__dirname,'../windows/panel/bin/CodexUsagePanel.exe');
const box=(x,width,y=1032,height=48)=>({x,y,width,height});
const baseline=()=>({bar:box(0,1920),screen:box(0,1920,0,1080),appsLeft:600,trayLeft:1600,reliable:true,
  width:200,height:40,scale:1,occupied:[box(600,700)]});
function place(value){return JSON.parse(execFileSync(binary,['--placement-test'],{input:JSON.stringify(value),encoding:'utf8',windowsHide:true,timeout:10000}));}
function safe(value,result) {
  if(!result.bounds)return;
  const r=result.bounds,margin=roundEven(12*value.scale);
  assert.equal(r.width,value.width);assert.equal(r.height,value.height);
  assert.ok(r.x>=value.bar.x+margin&&r.x+r.width<=value.bar.x+value.bar.width-margin);
  assert.ok(r.y>=value.bar.y&&r.y+r.height<=value.bar.y+value.bar.height);
  for(const b of [...value.occupied,box(value.trayLeft,value.bar.x+value.bar.width-value.trayLeft,value.bar.y,value.bar.height)]) {
    if(b.y+b.height<=value.bar.y||b.y>=value.bar.y+value.bar.height)continue;
    assert.ok(r.x+r.width<=b.x-margin||r.x>=b.x+b.width+margin,'placement must clear every control and its safety margin');
  }
}
const scenarios=[
 ['centered icons prefer the space next to the tray',v=>v,1388,'right'],
 ['the reported overlap moves the full badge to the left edge',v=>({...v,width:265,appsLeft:694,trayLeft:1480,occupied:[box(694,560)]}),12,'left'],
 ['left placement leaves room for weather and widgets',v=>({...v,width:265,appsLeft:694,trayLeft:1480,occupied:[box(0,180),box(694,560)]}),192,'left'],
 ['left-aligned controls use the free region on their right',v=>({...v,appsLeft:0,occupied:[box(0,1000)]}),1388,'right'],
 ['a safe left position waits before returning to the newly free right side',v=>({...v,current:box(12,200,1036,40)}),12,'left'],
 ['new icons overlapping the right placement trigger relocation',v=>({...v,current:box(1388,200,1036,40),occupied:[box(600,900)]}),12,'left'],
 ['no continuous space returns a hidden result',v=>({...v,occupied:[box(0,1600)]}),null,'taskbar-no-space'],
 ['several small gaps cannot be combined into a fake wide gap',v=>({...v,occupied:[box(0,250),box(400,250),box(800,250),box(1200,250)]}),null,'taskbar-no-space'],
 ['unreliable taskbar data never falls back to a guessed location',v=>({...v,reliable:false}),null,'taskbar-layout-unknown'],
 ['150 percent scaling keeps full dimensions and scales the left margin',v=>({...v,width:207,height:42,scale:1.5,occupied:[box(600,900)]}),18,'left'],
 ['scaled widgets are avoided without changing badge dimensions',v=>({...v,width:207,height:42,scale:1.5,occupied:[box(0,180),box(600,900)]}),198,'left'],
 ['overlapping parent and child rectangles merge safely',v=>({...v,occupied:[box(600,500),box(900,400),box(950,44)]}),1388,'right'],
 ['off-taskbar windows do not consume the taskbar gap',v=>({...v,occupied:[...v.occupied,box(0,500,0,200)]}),1388,'right'],
 ['an oversized badge is hidden until its measured size fits',v=>({...v,height:60}),null,'taskbar-no-space'],
 ['negative monitor coordinates are handled without moving offscreen',v=>({...v,bar:box(-1920,1920),screen:box(-1920,1920,0,1080),appsLeft:-1320,trayLeft:-320,occupied:[box(-1320,700)]}),-532,'right'],
 ['a newly occupied left edge moves the badge after the widget',v=>({...v,width:265,appsLeft:694,trayLeft:1480,current:box(12,265,1036,40),occupied:[box(0,180),box(694,560)]}),192,'left'],
 ['a large internal gap is usable when both outside regions are full',v=>({...v,appsLeft:0,occupied:[box(0,500),box(900,700)]}),688,'right'],
 ['a top taskbar uses its actual vertical bounds',v=>({...v,bar:box(0,1920,0,48),occupied:[box(600,700,0,48)]}),1388,'right']
];
for(const [name,configure,x,region] of scenarios)test('taskbar placement: '+name,{skip:process.platform!=='win32'},()=>{
  const input=configure(baseline()),result=place(input);
  assert.equal(result.region,region);
  if(x===null)assert.equal(result.bounds,null);else assert.equal(result.bounds.x,x);
  safe(input,result);
});

const frame=(nowMs,changes={})=>({...baseline(),nowMs,...changes});
function sequence(steps){return place({steps});}
function checkSequence(steps,expected) {
  const results=sequence(steps);
  assert.deepEqual(results.map(r=>r.bounds?.x??null),expected);
  results.forEach((r,i)=>safe(steps[i],r));
  return results;
}
const returnTest=(name,run)=>test('taskbar return: '+name,{skip:process.platform!=='win32'},run);
returnTest('wait a full second, then return to the notification area',()=>{
  checkSequence([frame(0,{current:box(12,200,1036,40)}),frame(999),frame(1000)],[12,12,1388]);
});
returnTest('renewed crowding resets the entire one-second wait',()=>{
  checkSequence([frame(0,{current:box(12,200,1036,40)}),frame(900,{occupied:[box(600,900)]}),
    frame(950),frame(1949),frame(1950)],[12,12,12,12,1388]);
});
returnTest('one cached snapshot cannot trigger return without a fresh scan',()=>{
  checkSequence([frame(0,{current:box(12,200,1036,40)}),frame(1000,{capturedMs:0}),
    frame(1500,{capturedMs:900}),frame(1600)],[12,12,12,1388]);
});
returnTest('unreliable layout clears the pending wait',()=>{
  checkSequence([frame(0,{current:box(12,200,1036,40)}),frame(900,{reliable:false}),
    frame(1000),frame(1999),frame(2000)],[12,null,12,12,1388]);
});
returnTest('hiding for lack of space clears the pending wait',()=>{
  checkSequence([frame(0,{current:box(12,200,1036,40)}),frame(900,{occupied:[box(0,1600)]}),
    frame(1000),frame(1999),frame(2000)],[12,null,12,12,1388]);
});
returnTest('an internal gap is not mistaken for the tray-side anchor',()=>{
  const crowded={appsLeft:0,occupied:[box(300,200),box(900,700)]};
  checkSequence([frame(0,{...crowded,current:box(12,200,1036,40)}),frame(2000,crowded)],[12,12]);
});
returnTest('moving the notification area restarts the wait',()=>{
  checkSequence([frame(0,{current:box(12,200,1036,40)}),frame(900,{trayLeft:1700}),
    frame(1899,{trayLeft:1700}),frame(1900,{trayLeft:1700})],[12,12,12,1488]);
});
returnTest('an unsafe current position is evacuated immediately',()=>{
  checkSequence([frame(0,{current:box(12,200,1036,40)}),frame(100,{occupied:[box(0,300),box(600,700)]})],[12,1388]);
});
returnTest('150 percent scaling preserves full dimensions on return',()=>{
  const scaled={width:207,height:42,scale:1.5};
  checkSequence([frame(0,{...scaled,current:box(18,207,1035,42)}),frame(999,scaled),frame(1000,scaled)],[18,18,1375]);
});
returnTest('a safe tray-side position stays stable',()=>{
  checkSequence([frame(0,{current:box(1388,200,1036,40)}),frame(1000),frame(3000)],[1388,1388,1388]);
});
returnTest('fractional scaling uses the native even-rounding margin on return',()=>{
  const scaled={width:259,height:42,scale:1.875,occupied:[box(600,690)]};
  checkSequence([frame(0,{...scaled,current:box(22,259,1035,42)}),frame(999,scaled),frame(1000,scaled)],[22,22,1319]);
});

'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {readResetTimes,remainingResetUnits}=require('../windows/reset-time.cjs');
test('reset countdown rounds up at exact hourly and 24-hour boundaries',()=>{
  const now=Date.UTC(2026,9,30,12),hour=3600000,day=24*hour;
  for(const [remaining,expected]of [[5*hour,5],[4*hour+1,5],[4*hour,4],[4*hour-1,4],[hour,1],[hour-1,1],[1,1],[0,0],[-1,0],[8*hour,5]])
    assert.equal(remainingResetUnits((now+remaining)/1000,3600,5,now),expected,'hourly '+remaining);
  for(const [remaining,expected]of [[7*day,7],[6*day+23*hour,7],[6*day+1,7],[6*day,6],[day,1],[day-1,1],[1,1],[0,0],[-day,0],[10*day,7]])
    assert.equal(remainingResetUnits((now+remaining)/1000,86400,7,now),expected,'weekly '+remaining);
  for(const time of [null,undefined,0,-1,NaN,Infinity,'12345',1e300])
    assert.equal(remainingResetUnits(time,3600,5,now),null);
});
test('reset metadata uses the same named Codex windows, never another quota bucket or duration',()=>{
  const data={rateLimits:{limitId:'codex',planType:'plus',primary:{usedPercent:90,windowDurationMins:300,resetsAt:1793370000},secondary:{usedPercent:10,windowDurationMins:10080,resetsAt:1793800000}}};
  const copy=structuredClone(data);
  assert.deepEqual(readResetTimes(data),{fiveHour:1793370000,weekly:1793800000});assert.deepEqual(data,copy);
  assert.deepEqual(readResetTimes({...data,rateLimitsByLimitId:{codex:null}}),{fiveHour:null,weekly:null});
  assert.deepEqual(readResetTimes({rateLimits:{...data.rateLimits,limitId:'other'}}),{fiveHour:null,weekly:null});
  assert.deepEqual(readResetTimes({rateLimits:{primary:{windowDurationMins:60,resetsAt:1793370000},secondary:{windowDurationMins:1440,resetsAt:1793800000}}}),{fiveHour:null,weekly:null});
  assert.deepEqual(readResetTimes({rateLimits:{primary:{windowDurationMins:300,resetsAt:'invalid'}}}),{fiveHour:null,weekly:null});
});

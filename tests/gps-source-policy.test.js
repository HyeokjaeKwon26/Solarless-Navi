const test=require('node:test'),assert=require('node:assert/strict'),{create}=require('../js/gps-source-policy');
const fix=(p,t,extra={})=>p.observe({source:'native-gps',timestamp:t,accuracy:5,accepted:true,...extra},t);
test('only sustained fresh accepted native GPS can replace the duplicate web watch',()=>{
 const p=create();fix(p,1000);fix(p,1250);assert.equal(p.preferred(1250),false);fix(p,1500);assert.equal(p.preferred(1500),true);
 assert.equal(p.preferred(2250),true);assert.equal(p.preferred(2251),false);
 p.reset();fix(p,2000,{source:'native-network'});fix(p,2250);fix(p,2500);assert.equal(p.preferred(2500),false);
});
test('rejected, inaccurate, stale and out-of-order samples never extend the handover',()=>{
 for(const bad of [{accepted:false},{accuracy:150},{timestamp:100},{timestamp:5000}]){
  const p=create();fix(p,1000);fix(p,1250);fix(p,1500);fix(p,1750,bad);assert.equal(p.preferred(1750),false);
 }
 const p=create();fix(p,1000);fix(p,1250);fix(p,1500);p.observe({source:'native-gps',timestamp:1500,accuracy:5,accepted:true},2200);assert.equal(p.preferred(2251),false);
});

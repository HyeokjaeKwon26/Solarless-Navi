const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const regression=require('../js/drive-regression');
const file=path.resolve(process.argv[2]||'tests/fixtures/drive-regressions.json'),suite=JSON.parse(fs.readFileSync(file,'utf8'));
assert.equal(suite.schema,1);assert.ok(Array.isArray(suite.cases)&&suite.cases.length>0&&suite.cases.length<=100);
const results=suite.cases.map(item=>{
 const bytes=fs.readFileSync(path.resolve(path.dirname(file),item.recording));assert.ok(bytes.length<=16*1048576);
 const hash=crypto.createHash('sha256').update(bytes).digest('hex');assert.equal(hash,item.sha256,'Recording changed without reviewed truth/gates: '+item.id);
 const result=regression.evaluate(JSON.parse(bytes),item.source||'foreground');
 if(item.baseline){assert.equal(item.baseline.recordingSha256,hash,'Baseline uses a different recording');assert.equal(item.baseline.source,result.source,'Baseline uses a different location source');}
 return {id:item.id,recordingSha256:hash,...result,...regression.gate(result,item.limits,item.baseline?.metrics)};
});
const report={appVersion:require('../app-release.json').versionName,passed:results.every(r=>r.passed),cases:results};
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');
for(const r of results)console.log(`${r.passed?'PASS':'FAIL'} ${r.id} (${r.synthetic?'synthetic':'user-labelled recording'}): ${r.failures.join('; ')}`);
if(!report.passed)process.exitCode=1;

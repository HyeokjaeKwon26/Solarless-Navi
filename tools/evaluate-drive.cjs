// Same labelled recording/report format as the on-device reviewer; no upload.
const fs=require('node:fs'),truth=require('../js/drive-truth');
(async()=>{
    const [input,output,baseline,source='foreground']=process.argv.slice(2);
    if(!input||!output)throw Error('Usage: node tools/evaluate-drive.cjs labelled.json evaluation.json [baseline.json] [foreground|native]');
    if(fs.statSync(input).size>16*1048576)throw Error('Recording exceeds 16 MB');
    const recording=JSON.parse(fs.readFileSync(input,'utf8'));
    const result=await truth.report(recording,source,require('../app-release.json').versionName);
    if(baseline)result.comparison=truth.compare(JSON.parse(fs.readFileSync(baseline,'utf8')),result);
    fs.writeFileSync(output,truth.serialize(result));
    console.log(JSON.stringify({version:result.appVersion,source,metrics:result.metrics,comparison:result.comparison}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});

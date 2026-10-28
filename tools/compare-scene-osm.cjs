// Compare every existing release building/tunnel way against a Geofabrik PBF.
// Run from the repository root with a directory containing the release ZIPs
// and latest.osm.pbf, followed by the region ID. This compares presence, tags,
// and the derived building-height model; it does not compare geometry or
// establish that unmatched current ways are newly added. The previous raw PBF
// and its extract timestamp were not retained.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const {unzipSync} = require(path.join(process.cwd(),'node_modules','fflate'));
const parse = require(path.join(process.cwd(),'node_modules','osm-pbf-parser'));
const dir=process.argv[2], region=process.argv[3];
const manifest=JSON.parse(fs.readFileSync('data/scene/'+region+'/manifest.json'));
class ShardedMap { constructor(){this.buckets=Array.from({length:16},()=>new Map());this.size=0;} get(id){return this.buckets[id%16].get(id)} has(id){return this.buckets[id%16].has(id)} set(id,value){let m=this.buckets[id%16];if(!m.has(id))this.size++;m.set(id,value)} } const buildings=new ShardedMap(), tunnels=new Set(); let tileCount=0;
for (const pack of Object.values(manifest.packs)) {
 const buf=fs.readFileSync(path.join(dir,pack.path));
 if (crypto.createHash('sha256').update(buf).digest('hex')!==pack.sha256) throw Error('hash mismatch '+pack.path);
 for(const [name,bytes] of Object.entries(unzipSync(buf))) {
  if(!name.endsWith('.json')) continue;
  const raw = Buffer.from(bytes).toString();
  const terrainStart = raw.indexOf(',"terrain":');
  if (terrainStart < 0) throw Error('tile has no terrain field: ' + name);
  // Terrain grids dominate tile size and are outside this OSM comparison.
  const tile = JSON.parse(raw.slice(0, terrainStart) + '}');
  if (!Array.isArray(tile.buildings) || !Array.isArray(tile.tunnels)) throw Error('invalid scene tile: ' + name);
  tileCount++;
  for(const b of tile.buildings||[]) {
   const id=Number(b.id.split('/')[1]);
   if (!buildings.has(id)) buildings.set(id,[b.height,b.heightLower,b.heightUpper,b.heightSource,b.minHeight,b.minHeightLower,b.minHeightUpper,b.minHeightSource]);
  }
  for(const t of tile.tunnels||[]) tunnels.add(Number(t.id.split('/')[1]));
 }
}
console.log('baseline',JSON.stringify({tileCount,buildings:buildings.size,tunnels:tunnels.size}));
const result={tileCount,buildingsBaseline:buildings.size,tunnelsBaseline:tunnels.size,ways:0,buildingsFound:0,buildingsNoLongerTagged:0,buildingModelChanged:0,tunnelsFound:0,tunnelsNoLongerTagged:0,latestBuildingWayNotInBaseline:0,latestTunnelWayNotInBaseline:0,existingBuildingWayEditedAfterLocalFileMtime:0,existingTunnelWayEditedAfterLocalFileMtime:0,examples:[]};
function length(s) {let text=String(s||'').replace(',','.').trim(), m=text.match(/-?\d+(?:\.\d+)?/); if(!m)return null;let f=text.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(\d+(?:\.\d+)?)?\s*(?:in|inch|inches|\")?/i);let n=f?Number(f[1])*.3048+Number(f[2]||0)*.0254:Number(m[0]);if(!f&&(/\b(?:ft|feet|foot)\b|'/i.test(text)))n*=.3048;else if(!f&&(/\b(?:in|inch|inches)\b|\"/i.test(text)))n*=.0254;return Number(n.toFixed(3));}
const round=x=>Number(x.toFixed(3));
function model(t) {
 let mh=length(t.min_height), ml=0,mu=0,ms='ground';
 if(mh!==null&&mh>=0){ml=mu=mh;ms='osm-min-height'} else {let m=String(t['building:min_level']||'').replace(',','.').match(/\d+(?:\.\d+)?/);if(m){mh=round(+m[0]*3.2);ml=round(+m[0]*3);mu=round(+m[0]*4.5);ms='osm-building-min-level'}else mh=0;}
 let h=length(t.height),lo,hi,hs;
 if(h!==null&&h>0){lo=hi=h;hs='osm-height'}else {let m=String(t['building:levels']||'').replace(',','.').match(/\d+(?:\.\d+)?/); if(m&&+m[0]>0){h=round(mh+(+m[0])*3.2);lo=round(ml+(+m[0])*3);hi=round(mu+(+m[0])*4.5);hs='osm-building-levels'} else {h=round(mh+6);lo=round(ml+3);hi=round(mu+12);hs='missing-height-default';}}
 let mhn=Math.min(mh,h),mln=Math.min(ml,lo),mun=Math.min(mu,hi);if(mhn!==mh||mln!==ml||mun!==mu)ms+='-clamped-to-height';
 return [h,lo,hi,hs,mhn,mln,mun,ms];
}
const parser=parse(); parser.on('data',batch=>{for(const way of batch){if(way.type!=='way')continue;result.ways++;const b=buildings.get(way.id),bt=!!(way.tags?.building||way.tags?.['building:part']);const tun=way.tags?.tunnel==='yes'||way.tags?.covered==='yes'||way.tags?.covered==='true';
 if(b){result.buildingsFound++; if(way.info?.timestamp > Date.parse(manifest.localFileModifiedAt)) result.existingBuildingWayEditedAfterLocalFileMtime++; if(!bt)result.buildingsNoLongerTagged++;else {let m=model(way.tags);if(JSON.stringify(b)!==JSON.stringify(m)){result.buildingModelChanged++;if(result.examples.length<12)result.examples.push({id:way.id,old:b,current:m,tags:way.tags});}}}
 else if(bt) result.latestBuildingWayNotInBaseline++;
 if(tunnels.has(way.id)){result.tunnelsFound++; if(way.info?.timestamp > Date.parse(manifest.localFileModifiedAt)) result.existingTunnelWayEditedAfterLocalFileMtime++;if(!tun)result.tunnelsNoLongerTagged++;} else if(tun)result.latestTunnelWayNotInBaseline++;
}});parser.on('error',e=>{console.error(e);process.exitCode=1});parser.on('end',()=>{result.buildingsNotFound=result.buildingsBaseline-result.buildingsFound;result.tunnelsNotFound=result.tunnelsBaseline-result.tunnelsFound;fs.writeFileSync(path.join(dir,'comparison-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,examples:result.examples.length},null,2));});fs.createReadStream(path.join(dir,'latest.osm.pbf')).pipe(parser);




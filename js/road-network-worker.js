importScripts('road-network.js');
self.onmessage = event => {
    const {id,pack,start,end,options} = event.data;
    try { self.postMessage({id,route:RoadGraph.build(pack).route(start,end,options)}); }
    catch(e) { self.postMessage({id,error:e.message}); }
};

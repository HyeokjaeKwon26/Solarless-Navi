/* Worker for ZIP inflation and JSON payload parsing. No DOM or navigation state is shared. */
self.onmessage = function (event) {
    try {
        if (!self.fflate) self.importScripts('fflate.js');
        const payload = event.data && event.data.buffer ? event.data : { buffer: event.data, fileNames: [] };
        const input = new Uint8Array(payload.buffer);
        const requested = new Set((payload.fileNames || []).map(String));
        const unzipped = self.fflate.unzipSync(input, {
            filter: file => requested.size === 0 || requested.has(file.name)
        });
        const files = {};
        const sizes = {};
        Object.keys(unzipped).forEach(name => {
            if (!name.endsWith('.json') || (requested.size > 0 && !requested.has(name))) return;
            const bytes = unzipped[name];
            // Return compact strings. The consumer parses each tile exactly
            // once and can release it immediately after route filtering.
            const text = self.fflate.strFromU8(bytes);
            files[name] = text;
            sizes[name] = bytes.byteLength;
        });
        self.postMessage({ files, sizes });
    } catch (error) {
        self.postMessage({ error: String(error && error.message || error) });
    }
};

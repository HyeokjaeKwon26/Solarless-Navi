/* Worker for ZIP inflation and JSON payload parsing. No DOM or navigation state is shared. */
self.onmessage = function (event) {
    try {
        if (!self.fflate) self.importScripts('fflate.js');
        const input = new Uint8Array(event.data);
        const unzipped = self.fflate.unzipSync(input);
        const files = {};
        const transfers = [];
        Object.keys(unzipped).forEach(name => {
            if (!name.endsWith('.json')) return;
            const bytes = unzipped[name];
            // Validate JSON in the worker so parse failures never block the UI.
            JSON.parse(self.fflate.strFromU8(bytes));
            const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            files[name] = buffer;
            transfers.push(buffer);
        });
        self.postMessage({ files }, transfers);
    } catch (error) {
        self.postMessage({ error: String(error && error.message || error) });
    }
};

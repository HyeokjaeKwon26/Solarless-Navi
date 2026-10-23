/* Bounded opt-in persistence. Android uses private rotating files; web uses IndexedDB. */
(function (root) {
    'use strict';
    let active = false, db = null, sequence = 0;
    const plugin = () => root.Capacitor?.Plugins?.Pip;
    function request(req) { return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
    async function init() {
        if (plugin()?.getDriveRecording) {
            const status = await plugin().getDriveRecording({ statusOnly: true }); active = status.active; return active;
        }
        if (!root.indexedDB) return false;
        const open = root.indexedDB.open('solarless-drive-journal', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('events', { keyPath: 'slot' });
        db = await request(open);
        active = root.localStorage.getItem('solarless_recording_active') === 'true';
        sequence = Number(root.localStorage.getItem('solarless_recording_sequence')) || 0;
        return active;
    }
    async function setActive(value) {
        if (plugin()?.setDriveRecording) await plugin().setDriveRecording({ active: value });
        else root.localStorage.setItem('solarless_recording_active', String(value));
        active = value;
        if (value) record('recording-start', {});
    }
    function record(type, data) {
        if (!active) return;
        if (plugin()?.recordDriveEvent) {
            plugin().recordDriveEvent({ type, data }).catch(() => {}); return;
        }
        if (!db) return;
        const event = { type, data, recordedAt: Date.now(), sequence: ++sequence, slot: type === "route" ? 5000 + sequence % 8 : sequence % 5000 };
        if (JSON.stringify(event).length > (type === "route" ? 300000 : 4096)) return;
        try {
            const tx = db.transaction('events', 'readwrite'); tx.objectStore('events').put(event);
            root.localStorage.setItem('solarless_recording_sequence', String(sequence));
        } catch (e) { active = false; }
    }
    async function exportRecording(fallback) {
        if (plugin()?.getDriveRecording) return (await plugin().getDriveRecording({})).json;
        if (!db) return JSON.stringify(fallback);
        const events = await request(db.transaction('events').objectStore('events').getAll());
        events.sort((a, b) => a.sequence - b.sequence);
        return JSON.stringify({ version: 2, type: 'solarless-drive-quality', retention: 'last-5000-events-and-8-routes; max-4096/300000-characters-per-record',
            samples: events.filter(e => e.type === 'sample').map(e => e.data), events: events.filter(e => e.type !== 'sample') });
    }
    async function clear() {
        await setActive(false);
        if (plugin()?.clearDriveRecording) await plugin().clearDriveRecording();
        else if (db) await request(db.transaction('events', 'readwrite').objectStore('events').clear());
    }
    root.DriveArchive = { init, setActive, record, exportRecording, clear };
    root.addEventListener('solarless:voice', event => record('voice', event.detail));
})(window);

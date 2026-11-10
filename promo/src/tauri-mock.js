(() => {
  const label = ({ "#1v1-overlay": "1v1-overlay", "#ds-overlay": "ds-overlay", "#crosshair-overlay": "crosshair-overlay" })[location.hash] || "main";
  const cbs = new Map(); let nid = 1;
  const listeners = new Map(); // event -> Map(eventId -> cbId)
  const bc = new BroadcastChannel("tauri-mock");
  const log = (window.__mockLog = []);
  const deliver = (event, payload) => {
    const m = listeners.get(event); if (!m) return;
    for (const [eid, cb] of m) { const f = cbs.get(cb); if (f) try { f({ event, payload, id: eid }); } catch (e) { console.error(e); } }
  };
  bc.onmessage = (e) => deliver(e.data.event, e.data.payload);
  window.__emitLocal = deliver;
  window.__emit = (event, payload) => { bc.postMessage({ event, payload }); deliver(event, payload); };
  const defaults = {
    "plugin:window|outer_position": { x: 0, y: 0 }, "plugin:window|inner_position": { x: 0, y: 0 },
    "plugin:window|outer_size": { width: 400, height: 200 }, "plugin:window|inner_size": { width: 400, height: 200 },
    "plugin:window|scale_factor": 1, "plugin:window|is_visible": true, "plugin:window|is_focused": true,
    "plugin:window|current_monitor": { name: "m", size: { width: 1920, height: 1080 }, position: { x: 0, y: 0 }, scaleFactor: 1, workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } } },
    "plugin:window|primary_monitor": { name: "m", size: { width: 1920, height: 1080 }, position: { x: 0, y: 0 }, scaleFactor: 1, workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } } },
    "plugin:app|version": "1.3.2", "plugin:updater|check": null,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { label, windowLabel: label } },
    transformCallback(cb, once) { const id = nid++; cbs.set(id, (...a) => { if (once) cbs.delete(id); return cb && cb(...a); }); return id; },
    unregisterCallback(id) { cbs.delete(id); },
    convertFileSrc: (p) => p,
    async invoke(cmd, args = {}) {
      if (cmd === "plugin:event|listen") { const eid = nid++; if (!listeners.has(args.event)) listeners.set(args.event, new Map()); listeners.get(args.event).set(eid, args.handler); return eid; }
      if (cmd === "plugin:event|unlisten") { listeners.get(args.event)?.delete(args.eventId); return null; }
      if (cmd === "plugin:event|emit" || cmd === "plugin:event|emit_to") { window.__emit(args.event, args.payload); return null; }
      log.push(cmd);
      if (cmd === "plugin:window|set_size") { window.__size = args.value; return null; }
      if (/get_all_w/.test(cmd)) return [];
      if (cmd in defaults) return defaults[cmd];
      return null;
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(event, id) { listeners.get(event)?.delete(id); } };
})();

import { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const C = {
  bg: "#080a0c",
  panel: "#0f1214",
  panel2: "#13171a",
  border: "#1e2428",
  accent: "#f59e0b",
  accentDim: "#78490a",
  green: "#10b981",
  red: "#ef4444",
  blue: "#38bdf8",
  purple: "#a78bfa",
  muted: "#4b5563",
  text: "#e2e8f0",
  textDim: "#94a3b8",
};

const TRUCK_COLORS = ["#f59e0b", "#38bdf8", "#10b981", "#a78bfa", "#f97316", "#ec4899"];

// ── Distribution Centre: Central London-area (generic) ──
const WAREHOUSE = { lat: 51.734, lng: -0.218, id: "WH" };

// ── Generic retail/store delivery nodes across Greater London & SE England ──
const BASE_CUSTOMERS = [
  { id: "S01", lat: 51.652, lng: -0.398, name: "Watford Retail Park" },
  { id: "S02", lat: 51.509, lng: -0.118, name: "Central London Hub" },
  { id: "S03", lat: 51.556, lng:  0.108, name: "East London Depot" },
  { id: "S04", lat: 51.748, lng:  0.073, name: "Harlow Store" },
  { id: "S05", lat: 51.450, lng: -0.336, name: "Twickenham Outlet" },
  { id: "S06", lat: 51.882, lng: -0.410, name: "Luton Distribution" },
  { id: "S07", lat: 51.622, lng:  0.472, name: "Chelmsford Retail" },
  { id: "S08", lat: 51.379, lng: -0.102, name: "Croydon Superstore" },
  { id: "S09", lat: 51.803, lng:  0.241, name: "Stortford Depot" },
  { id: "S10", lat: 51.570, lng: -0.450, name: "Uxbridge Warehouse" },
  { id: "S11", lat: 51.698, lng:  0.474, name: "Colchester Store" },
  { id: "S12", lat: 51.445, lng:  0.323, name: "Gravesend Outlet" },
];

// ─────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────
function distLatLng(a, b) {
  const dx = (a.lat - b.lat) * 111;
  const dy = (a.lng - b.lng) * 111 * Math.cos(a.lat * Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy);
}
function rnd(min, max) { return Math.random() * (max - min) + min; }
function normalSample(mean, cv) {
  const u1 = Math.random() + 1e-9, u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(1, Math.round(mean + z * mean * cv));
}
function lerp(a, b, t) { return a + (b - a) * t; }

// ─────────────────────────────────────────────────────────
// VEHICLE ROUTING — Greedy Nearest-Neighbour VRP
// ─────────────────────────────────────────────────────────
function routeVehicles(customers, truckCapacity) {
  const unserved = [...customers];
  const routes = [];
  while (unserved.length > 0) {
    let remaining = truckCapacity, current = WAREHOUSE;
    const stops = [];
    while (unserved.length > 0) {
      let bestIdx = -1, bestDist = Infinity;
      unserved.forEach((c, i) => {
        if (c.demand <= remaining) {
          const d = distLatLng(current, c);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
      });
      if (bestIdx === -1) break;
      const chosen = unserved.splice(bestIdx, 1)[0];
      stops.push(chosen); remaining -= chosen.demand; current = chosen;
    }
    if (stops.length > 0) {
      const wps = [WAREHOUSE, ...stops, WAREHOUSE];
      const totalDist = wps.reduce((acc, wp, i) => i === 0 ? 0 : acc + distLatLng(wps[i - 1], wp), 0);
      routes.push({ waypoints: wps, load: truckCapacity - remaining, totalDist, stops });
    } else if (unserved.length > 0) {
      const f = unserved.splice(0, 1)[0];
      routes.push({ waypoints: [WAREHOUSE, f, WAREHOUSE], load: f.demand, totalDist: distLatLng(WAREHOUSE, f) * 2, stops: [f] });
    }
  }
  return routes;
}

// ─────────────────────────────────────────────────────────
// INVENTORY DES ENGINE
// ─────────────────────────────────────────────────────────
class InventorySim {
  constructor(p) { this.reset(p); }
  reset(p) {
    this.p = { ...p }; this.t = 0;
    this.inventory = p.initialStock; this.onOrder = 0; this.backlog = 0;
    this.pendingOrders = []; this.totalDemand = 0; this.totalFulfilled = 0;
    this.totalOrders = 0; this.history = []; this.events = [];
  }
  step() {
    this.t++;
    const p = this.p;
    this.pendingOrders = this.pendingOrders.filter(o => {
      if (o.arrival <= this.t) {
        this.inventory += o.qty; this.onOrder -= o.qty;
        this.events.push({ t: this.t, type: "receipt", msg: `+${o.qty}u arrived from supplier` });
        return false;
      }
      return true;
    });
    const demand = normalSample(p.demandMean, p.demandCV);
    this.totalDemand += demand;
    const canFill = Math.min(demand + this.backlog, this.inventory);
    this.inventory -= canFill; this.totalFulfilled += canFill;
    if (demand > canFill) {
      this.backlog += demand - canFill;
      this.events.push({ t: this.t, type: "stockout", msg: `Stockout: ${demand - canFill}u unfulfilled` });
    } else this.backlog = Math.max(0, this.backlog - (canFill - demand));
    const pos = this.inventory + this.onOrder - this.backlog;
    if (pos <= p.reorderPoint && this.onOrder === 0) {
      const lt = Math.max(1, Math.round(p.leadTimeMean + (Math.random() - 0.5) * p.leadTimeVar * 2));
      this.pendingOrders.push({ arrival: this.t + lt, qty: p.orderQty });
      this.onOrder += p.orderQty; this.totalOrders++;
      this.events.push({ t: this.t, type: "order", msg: `PO raised: ${p.orderQty}u, ETA day ${this.t + lt}` });
    }
    const sl = this.totalDemand > 0 ? (this.totalFulfilled / this.totalDemand) * 100 : 100;
    const snap = { t: this.t, inventory: this.inventory, onOrder: this.onOrder, backlog: this.backlog, sl: +sl.toFixed(1) };
    this.history.push(snap);
    return snap;
  }
}

// ─────────────────────────────────────────────────────────
// TRUCK ANIMATION
// ─────────────────────────────────────────────────────────
function initTrucks(routes) {
  return routes.map((route, i) => ({
    id: i, color: TRUCK_COLORS[i % TRUCK_COLORS.length], route,
    wpIdx: 0, progress: 0, lat: WAREHOUSE.lat, lng: WAREHOUSE.lng,
    delivered: 0, done: false, stops: route.waypoints.length - 2, deliveredStops: 0,
  }));
}
function stepTrucks(trucks, speed = 0.07) {
  return trucks.map(tk => {
    if (tk.done) return tk;
    const wps = tk.route.waypoints;
    const from = wps[tk.wpIdx], to = wps[tk.wpIdx + 1];
    if (!to) return { ...tk, done: true };
    const segDist = distLatLng(from, to);
    const step = segDist > 0 ? speed / segDist : 1;
    const np = tk.progress + step;
    if (np >= 1) {
      const newWp = tk.wpIdx + 1;
      const arrived = wps[newWp];
      const isCust = arrived && arrived.id !== "WH";
      return {
        ...tk, wpIdx: newWp, progress: 0,
        lat: arrived?.lat ?? tk.lat, lng: arrived?.lng ?? tk.lng,
        delivered: isCust ? tk.delivered + (arrived.demand || 0) : tk.delivered,
        deliveredStops: isCust ? tk.deliveredStops + 1 : tk.deliveredStops,
        done: newWp >= wps.length - 1,
      };
    }
    return { ...tk, progress: np, lat: lerp(from.lat, to.lat, np), lng: lerp(from.lng, to.lng, np) };
  });
}

// ─────────────────────────────────────────────────────────
// LEAFLET MAP
// ─────────────────────────────────────────────────────────
function LeafletMap({ customers, trucks, routes, phase }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layersRef = useRef({ trucks: [], routes: [], customers: [], warehouse: null });
  const initializedRef = useRef(false);

  useEffect(() => {
    import("leaflet/dist/leaflet.css");
    import("leaflet").then((L) => {
      window.L = L.default;
      initMap();
    });
  }, []);

  function initMap() {
    if (initializedRef.current || !mapRef.current) return;
    const L = window.L;
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false })
      .setView([WAREHOUSE.lat, WAREHOUSE.lng], 9);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd", maxZoom: 19
    }).addTo(map);

    // Small attribution
    L.control.attribution({ prefix: false }).addTo(map);

    const whIcon = L.divIcon({
      className: "",
      html: `<div style="background:#f59e0b;border:2px solid #000;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:5px;font-weight:700;font-size:9px;color:#000;font-family:monospace;box-shadow:0 0 14px #f59e0b66;letter-spacing:0.05em">DC</div>`,
      iconSize: [30, 30], iconAnchor: [15, 15],
    });
    layersRef.current.warehouse = L.marker([WAREHOUSE.lat, WAREHOUSE.lng], { icon: whIcon, zIndexOffset: 1000 })
      .bindTooltip("Distribution Centre", { permanent: false })
      .addTo(map);

    mapInstanceRef.current = map;
    initializedRef.current = true;
  }

  useEffect(() => { if (window.L && !initializedRef.current) initMap(); });

  // Customer markers
  useEffect(() => {
    const L = window.L; if (!L || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    layersRef.current.customers.forEach(m => map.removeLayer(m));
    layersRef.current.customers = [];
    customers.forEach(c => {
      const icon = L.divIcon({
        className: "",
        html: `<div style="background:#0f1214;border:1.5px solid #4b5563;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:7px;color:#94a3b8;font-family:monospace;font-weight:700">${c.id}</div>`,
        iconSize: [26, 26], iconAnchor: [13, 13],
      });
      const m = L.marker([c.lat, c.lng], { icon })
        .bindTooltip(`<b>${c.name}</b><br/>${c.demand}u demand`, { className: "lf-tip" })
        .addTo(map);
      layersRef.current.customers.push(m);
    });
  }, [customers]);

  // Routes
  useEffect(() => {
    const L = window.L; if (!L || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    layersRef.current.routes.forEach(l => map.removeLayer(l));
    layersRef.current.routes = [];
    if (phase !== "dispatch") return;
    routes.forEach((route, ri) => {
      const color = TRUCK_COLORS[ri % TRUCK_COLORS.length];
      const poly = L.polyline(route.waypoints.map(wp => [wp.lat, wp.lng]),
        { color, weight: 2, opacity: 0.45, dashArray: "6 6" }).addTo(map);
      layersRef.current.routes.push(poly);
    });
  }, [routes, phase]);

  // Truck markers + delivered icons
  useEffect(() => {
    const L = window.L; if (!L || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    layersRef.current.trucks.forEach(m => map.removeLayer(m));
    layersRef.current.trucks = [];
    if (phase !== "dispatch") return;

    trucks.filter(tk => !tk.done).forEach(tk => {
      const icon = L.divIcon({
        className: "",
        html: `<div style="background:${tk.color};border:2px solid #000;width:24px;height:16px;display:flex;align-items:center;justify-content:center;border-radius:3px;font-size:8px;color:#000;font-family:monospace;font-weight:700;box-shadow:0 2px 8px #00000099">T${tk.id + 1}</div>`,
        iconSize: [24, 16], iconAnchor: [12, 8],
      });
      const m = L.marker([tk.lat, tk.lng], { icon, zIndexOffset: 500 })
        .bindTooltip(`Truck ${tk.id + 1} · ${tk.delivered}u delivered`, { className: "lf-tip" })
        .addTo(map);
      layersRef.current.trucks.push(m);
    });

    // Mark delivered customers
    layersRef.current.customers.forEach((m, i) => {
      const c = customers[i]; if (!c) return;
      const isDel = trucks.some(tk => tk.route.waypoints.slice(1, tk.wpIdx + 1).some(wp => wp.id === c.id));
      if (isDel) {
        const icon = L.divIcon({
          className: "",
          html: `<div style="background:#10b981;border:1.5px solid #10b981;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:10px;color:#fff;box-shadow:0 0 8px #10b98155">✓</div>`,
          iconSize: [26, 26], iconAnchor: [13, 13],
        });
        m.setIcon(icon);
      }
    });
  }, [trucks, phase, customers]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
      {phase === "inventory" && (
        <div style={{ position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)", background: "#080a0ccc", border: `1px solid ${C.border}`, padding: "5px 14px", fontSize: 10, color: C.muted, fontFamily: "monospace", zIndex: 1000, pointerEvents: "none", whiteSpace: "nowrap" }}>
          Trucks deploy on next dispatch wave
        </div>
      )}
      {phase === "dispatch" && (
        <div style={{ position: "absolute", top: 10, left: 10, background: C.purple + "22", border: `1px solid ${C.purple}55`, padding: "4px 10px", fontSize: 9, color: C.purple, zIndex: 1000, fontFamily: "monospace", pointerEvents: "none" }}>
          ● LIVE ROUTING
        </div>
      )}
      <style>{`
        .lf-tip { background:#0f1214!important;border:1px solid #1e2428!important;color:#94a3b8!important;font-family:monospace!important;font-size:10px!important;box-shadow:none!important;border-radius:3px!important; }
        .lf-tip::before { display:none!important; }
        .leaflet-control-zoom a { background:#0f1214!important;color:#94a3b8!important;border-color:#1e2428!important; }
        .leaflet-control-attribution { background:#0f1214cc!important;color:#4b5563!important;font-size:8px!important; }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// UI COMPONENTS
// ─────────────────────────────────────────────────────────
function KpiCard({ label, value, unit, color, sub }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderTop: `2px solid ${color || C.border}`, padding: "9px 13px", flex: 1, minWidth: 90 }}>
      <div style={{ fontSize: 7, letterSpacing: "0.14em", color: C.muted, textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 20, fontFamily: "monospace", fontWeight: 700, color: color || C.text, lineHeight: 1 }}>
        {value}<span style={{ fontSize: 10, marginLeft: 2, color: C.muted }}>{unit}</span>
      </div>
      {sub && <div style={{ fontSize: 7, color: C.muted, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, onChange, disabled }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ fontSize: 8, color: C.textDim, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</span>
        <span style={{ fontSize: 9, fontFamily: "monospace", color: C.accent }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))} disabled={disabled}
        style={{ width: "100%", accentColor: C.accent, opacity: disabled ? 0.3 : 1, cursor: disabled ? "not-allowed" : "pointer" }} />
    </div>
  );
}

function EventLog({ events }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [events]);
  const clr = { receipt: C.green, stockout: C.red, order: C.blue, dispatch: C.purple, delivery: C.green };
  const ico = { receipt: "⬇", stockout: "⚠", order: "📦", dispatch: "🚛", delivery: "✓" };
  return (
    <div ref={ref} style={{ height: "100%", overflowY: "auto", fontFamily: "monospace", fontSize: 10, display: "flex", flexDirection: "column", gap: 2 }}>
      {events.length === 0 && <span style={{ color: C.muted }}>— awaiting events —</span>}
      {events.slice(-100).map((e, i) => (
        <div key={i} style={{ display: "flex", gap: 8, borderBottom: `1px solid ${C.border}22`, paddingBottom: 2 }}>
          <span style={{ color: C.muted, minWidth: 32, flexShrink: 0 }}>d{e.t}</span>
          <span style={{ color: clr[e.type] || C.textDim, flexShrink: 0 }}>{ico[e.type] || "·"}</span>
          <span style={{ color: C.textDim }}>{e.msg}</span>
        </div>
      ))}
    </div>
  );
}

function TruckTable({ trucks, truckCapacity }) {
  if (!trucks.length) return <div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace" }}>No active fleet</div>;
  return (
    <div style={{ fontSize: 9, fontFamily: "monospace" }}>
      <div style={{ display: "grid", gridTemplateColumns: "32px 50px 44px 44px 52px 48px", gap: "3px 6px", color: C.muted, marginBottom: 4, borderBottom: `1px solid ${C.border}`, paddingBottom: 3 }}>
        {["ID", "Load", "Cap%", "Stops", "Dist", "Status"].map(h => <span key={h}>{h}</span>)}
      </div>
      {trucks.map(tk => {
        const cap = Math.round((tk.route.load / truckCapacity) * 100);
        return (
          <div key={tk.id} style={{ display: "grid", gridTemplateColumns: "32px 50px 44px 44px 52px 48px", gap: "3px 6px", marginBottom: 4, color: C.textDim }}>
            <span style={{ color: tk.color, fontWeight: 700 }}>T{tk.id + 1}</span>
            <span>{tk.route.load}u</span>
            <span style={{ color: cap > 80 ? C.green : cap > 50 ? C.accent : C.red }}>{cap}%</span>
            <span>{tk.deliveredStops}/{tk.stops}</span>
            <span>{tk.route.totalDist.toFixed(0)}km</span>
            <span style={{ color: tk.done ? C.green : C.accent }}>{tk.done ? "RTB ✓" : "EN RT"}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────
const DEFAULT_PARAMS = {
  initialStock: 500, demandMean: 25, demandCV: 0.25,
  reorderPoint: 120, orderQty: 300, leadTimeMean: 5, leadTimeVar: 2,
  truckCapacity: 150, numCustomers: 8, dispatchThreshold: 150,
};

export default function App() {
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState("map");
  const [invSnap, setInvSnap] = useState(null);
  const [invHistory, setInvHistory] = useState([]);
  const [allEvents, setAllEvents] = useState([]);
  const [customers, setCustomers] = useState(() =>
    BASE_CUSTOMERS.slice(0, DEFAULT_PARAMS.numCustomers).map(c => ({ ...c, demand: Math.max(10, Math.round(rnd(0.6, 1.5) * DEFAULT_PARAMS.demandMean)) }))
  );
  const [trucks, setTrucks] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [phase, setPhase] = useState("inventory");
  const [dispatchCount, setDispatchCount] = useState(0);
  const [totalDelivered, setTotalDelivered] = useState(0);
  const [pendingDemand, setPendingDemand] = useState(0);

  const simRef = useRef(null);
  const trucksRef = useRef([]);
  const pendingRef = useRef(0);
  const eventsRef = useRef([]);
  const dispatchCountRef = useRef(0);
  const intervalRef = useRef(null);

  const initAll = useCallback((p) => {
    simRef.current = new InventorySim(p);
    trucksRef.current = []; pendingRef.current = 0; eventsRef.current = [];
    dispatchCountRef.current = 0;
    const newCusts = BASE_CUSTOMERS.slice(0, p.numCustomers).map(c => ({
      ...c, demand: Math.max(10, Math.round(rnd(0.6, 1.5) * p.demandMean))
    }));
    setCustomers(newCusts);
    setInvSnap(null); setInvHistory([]); setAllEvents([]);
    setTrucks([]); setRoutes([]); setPhase("inventory");
    setDispatchCount(0); setTotalDelivered(0); setPendingDemand(0);
  }, []);

  useEffect(() => { initAll(params); }, []);

  const doDispatch = useCallback((p, currentCustomers) => {
    const wave = currentCustomers.map(c => ({
      ...c, demand: Math.max(8, Math.round(rnd(0.6, 1.4) * p.demandMean)),
    }));
    const waveRoutes = routeVehicles(wave, p.truckCapacity);
    const newTrucks = initTrucks(waveRoutes);
    trucksRef.current = newTrucks;
    dispatchCountRef.current += 1;
    const amt = Math.round(pendingRef.current);
    pendingRef.current = 0; setPendingDemand(0);
    setRoutes(waveRoutes); setTrucks([...newTrucks]);
    setPhase("dispatch"); setDispatchCount(dispatchCountRef.current);
    eventsRef.current.push({ t: simRef.current?.t ?? 0, type: "dispatch", msg: `Wave #${dispatchCountRef.current}: ${waveRoutes.length} truck(s), ${wave.length} stops, ~${amt}u` });
    setAllEvents([...eventsRef.current]);
  }, []);

  const customersRef = useRef(customers);
  useEffect(() => { customersRef.current = customers; }, [customers]);

  const tick = useCallback(() => {
    const sim = simRef.current;
    if (!sim || sim.t >= 365) { setRunning(false); return; }
    const snap = sim.step();
    eventsRef.current.push(...sim.events.splice(0));
    pendingRef.current += params.demandMean;
    setPendingDemand(Math.round(pendingRef.current));

    if (pendingRef.current >= params.dispatchThreshold && trucksRef.current.length === 0 && sim.inventory > params.dispatchThreshold * 0.3) {
      doDispatch(params, customersRef.current);
    }

    if (trucksRef.current.length > 0) {
      trucksRef.current = stepTrucks(trucksRef.current, 0.07);
      if (trucksRef.current.every(t => t.done)) {
        const delivered = trucksRef.current.reduce((s, t) => s + t.delivered, 0);
        setTotalDelivered(n => n + delivered);
        eventsRef.current.push({ t: sim.t, type: "delivery", msg: `All trucks returned. ${delivered}u delivered this wave.` });
        trucksRef.current = []; setPhase("inventory"); setTrucks([]);
      } else setTrucks([...trucksRef.current]);
    }

    setInvSnap({ ...snap }); setInvHistory(sim.history.slice(-100));
    setAllEvents([...eventsRef.current.slice(-150)]);
  }, [params, doDispatch]);

  useEffect(() => {
    if (running) intervalRef.current = setInterval(tick, 120);
    else clearInterval(intervalRef.current);
    return () => clearInterval(intervalRef.current);
  }, [running, tick]);

  const setParam = k => v => { if (!running) setParams(p => ({ ...p, [k]: v })); };
  const sl = invSnap?.sl ?? 100;
  const stockColor = !invSnap ? C.text : invSnap.inventory < params.reorderPoint ? C.red : invSnap.inventory < params.reorderPoint * 2 ? C.accent : C.green;
  const slColor = sl >= 95 ? C.green : sl >= 80 ? C.accent : C.red;

  return (
    <div style={{ background: C.bg, height: "100vh", color: C.text, fontFamily: "'IBM Plex Mono', monospace", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&display=swap" rel="stylesheet" />

      {/* HEADER */}
      <div style={{ background: C.panel, borderBottom: `1px solid ${C.border}`, padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 7, color: C.accentDim, letterSpacing: "0.22em", textTransform: "uppercase" }}>
            Discrete Event Simulation · Vehicle Routing · Inventory Control
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: C.accent, fontSize: 18 }}>◈</span>
            FMCG Logistics Simulator
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ textAlign: "right", fontSize: 9, fontFamily: "monospace" }}>
            <div style={{ color: C.muted }}>Simulation Day {invSnap?.t ?? 0} / 365</div>
            <div style={{ color: phase === "dispatch" ? C.purple : C.green, marginTop: 2 }}>
              {phase === "dispatch" ? `● ${trucks.filter(t => !t.done).length} truck(s) en route` : "○ Monitoring inventory"}
            </div>
          </div>
          <button onClick={() => setRunning(r => !r)} style={{ background: running ? C.accentDim : C.accent, color: running ? C.accent : "#000", border: "none", padding: "8px 20px", fontFamily: "monospace", fontWeight: 700, fontSize: 12, cursor: "pointer", letterSpacing: "0.04em" }}>
            {running ? "⏸  PAUSE" : "▶  RUN"}
          </button>
          <button onClick={() => { setRunning(false); setTimeout(() => initAll(params), 60); }} style={{ background: "transparent", color: C.muted, border: `1px solid ${C.border}`, padding: "8px 12px", fontFamily: "monospace", fontSize: 13, cursor: "pointer" }} title="Reset">↺</button>
        </div>
      </div>

      {/* KPI STRIP */}
      <div style={{ display: "flex", gap: 1, background: C.border, flexShrink: 0 }}>
        <KpiCard label="DC Stock" value={invSnap?.inventory ?? params.initialStock} color={stockColor} sub={`Reorder at ${params.reorderPoint}u`} />
        <KpiCard label="On Order" value={invSnap?.onOrder ?? 0} color={C.blue} unit="u" sub="from supplier" />
        <KpiCard label="Backlog" value={invSnap?.backlog ?? 0} color={(invSnap?.backlog ?? 0) > 0 ? C.red : C.muted} unit="u" />
        <KpiCard label="Fill Rate" value={sl} unit="%" color={slColor} sub="service level" />
        <KpiCard label="Waves Sent" value={dispatchCount} color={C.purple} sub="dispatch runs" />
        <KpiCard label="Units Delivered" value={totalDelivered} unit="u" color={C.green} />
        <KpiCard label="Batch Queue" value={pendingDemand} unit={`/${params.dispatchThreshold}u`} color={C.accent} sub="dispatch trigger" />
      </div>

      {/* BODY */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* PARAMS SIDEBAR */}
        <div style={{ width: 188, borderRight: `1px solid ${C.border}`, padding: "12px 12px", flexShrink: 0, background: C.panel, overflowY: "auto" }}>
          <div style={{ fontSize: 7, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 12 }}>
            Parameters {running && <span style={{ color: C.accentDim }}>(pause to edit)</span>}
          </div>
          <div style={{ fontSize: 7, color: C.accent, letterSpacing: "0.1em", marginBottom: 6 }}>— DEMAND —</div>
          <Slider label="Mean Demand / day" value={params.demandMean} min={5} max={70} step={5} unit="u" onChange={setParam("demandMean")} disabled={running} />
          <Slider label="Variability (CV)" value={params.demandCV} min={0.05} max={0.7} step={0.05} unit="" onChange={setParam("demandCV")} disabled={running} />
          <div style={{ fontSize: 7, color: C.accent, letterSpacing: "0.1em", marginBottom: 6, marginTop: 10 }}>— INVENTORY (s, Q) —</div>
          <Slider label="Initial Stock" value={params.initialStock} min={100} max={800} step={50} unit="u" onChange={setParam("initialStock")} disabled={running} />
          <Slider label="Reorder Point (s)" value={params.reorderPoint} min={50} max={400} step={10} unit="" onChange={setParam("reorderPoint")} disabled={running} />
          <Slider label="Order Quantity (Q)" value={params.orderQty} min={100} max={600} step={50} unit="u" onChange={setParam("orderQty")} disabled={running} />
          <Slider label="Lead Time μ" value={params.leadTimeMean} min={1} max={15} step={1} unit="d" onChange={setParam("leadTimeMean")} disabled={running} />
          <Slider label="Lead Time σ" value={params.leadTimeVar} min={0} max={8} step={1} unit="d" onChange={setParam("leadTimeVar")} disabled={running} />
          <div style={{ fontSize: 7, color: C.accent, letterSpacing: "0.1em", marginBottom: 6, marginTop: 10 }}>— DISPATCH (VRP) —</div>
          <Slider label="Truck Capacity" value={params.truckCapacity} min={50} max={400} step={10} unit="u" onChange={setParam("truckCapacity")} disabled={running} />
          <Slider label="No. of Stores" value={params.numCustomers} min={2} max={12} step={1} unit="" onChange={setParam("numCustomers")} disabled={running} />
          <Slider label="Dispatch Trigger" value={params.dispatchThreshold} min={50} max={400} step={10} unit="u" onChange={setParam("dispatchThreshold")} disabled={running} />
          <div style={{ marginTop: 12, padding: "8px 9px", background: C.bg, border: `1px solid ${C.border}`, fontSize: 7, color: C.muted, lineHeight: 1.9 }}>
            <b style={{ color: C.textDim }}>Policy:</b> (s, Q) continuous review<br />
            <b style={{ color: C.textDim }}>Routing:</b> Greedy NN-VRP<br />
            <b style={{ color: C.textDim }}>Demand:</b> Normal(μ, CV·μ)<br />
            <b style={{ color: C.textDim }}>Region:</b> SE England / London
          </div>
        </div>

        {/* CENTRE TABS */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.panel }}>
            {[["map", "🗺  Live Map"], ["inventory", "📈  Inventory"], ["events", "📋  Event Log"]].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                padding: "8px 18px", fontFamily: "monospace", fontSize: 10, cursor: "pointer", border: "none",
                background: tab === id ? C.bg : "transparent",
                color: tab === id ? C.accent : C.muted,
                borderBottom: tab === id ? `2px solid ${C.accent}` : "2px solid transparent",
              }}>{label}</button>
            ))}
          </div>

          {/* MAP TAB */}
          {tab === "map" && (
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              <div style={{ flex: 1, overflow: "hidden" }}>
                <LeafletMap customers={customers} trucks={trucks} routes={routes} phase={phase} />
              </div>
              <div style={{ width: 220, borderLeft: `1px solid ${C.border}`, padding: "12px", overflowY: "auto", background: C.panel, flexShrink: 0 }}>
                <div style={{ fontSize: 7, color: C.muted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>Fleet Status</div>
                <TruckTable trucks={trucks} truckCapacity={params.truckCapacity} />

                <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 7, color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Store Network</div>
                  {customers.map(c => (
                    <div key={c.id} style={{ display: "flex", gap: 6, fontSize: 8, fontFamily: "monospace", color: C.textDim, marginBottom: 4 }}>
                      <span style={{ color: C.accent, minWidth: 28 }}>{c.id}</span>
                      <span style={{ flex: 1, color: C.muted, fontSize: 7 }}>{c.name}</span>
                      <span>{c.demand}u</span>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 7, color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Pipeline</div>
                  {[
                    ["Supplier", (invSnap?.onOrder ?? 0) > 0, C.blue, `${invSnap?.onOrder ?? 0}u inbound`],
                    ["Distribution Centre", true, C.accent, `${invSnap?.inventory ?? params.initialStock}u`],
                    ["Order Batching", pendingDemand > 0, C.purple, `${pendingDemand}/${params.dispatchThreshold}u`],
                    ["Fleet Dispatch", phase === "dispatch", C.accent, `${trucks.filter(t => !t.done).length} active`],
                    ["Store Delivery", totalDelivered > 0, C.green, `${totalDelivered}u delivered`],
                  ].map(([name, active, color, sub]) => (
                    <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: active ? color : C.border, flexShrink: 0, boxShadow: active ? `0 0 6px ${color}` : "none" }} />
                      <div>
                        <div style={{ fontSize: 9, color: active ? color : C.muted, fontFamily: "monospace" }}>{name}</div>
                        <div style={{ fontSize: 7, color: C.muted }}>{sub}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* INVENTORY TAB */}
          {tab === "inventory" && (
            <div style={{ flex: 1, padding: "14px 18px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: "12px 14px" }}>
                <div style={{ fontSize: 7, color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
                  DC Stock · On Order · Backlog · Reorder Point
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={invHistory} margin={{ top: 2, right: 8, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="t" tick={{ fill: C.muted, fontSize: 9 }} label={{ value: "Day", position: "insideRight", fill: C.muted, fontSize: 8 }} />
                    <YAxis tick={{ fill: C.muted, fontSize: 9 }} />
                    <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, fontFamily: "monospace", fontSize: 10 }} />
                    <Line type="monotone" dataKey="inventory" stroke={C.green} dot={false} strokeWidth={2} name="Stock" />
                    <Line type="monotone" dataKey="onOrder" stroke={C.blue} dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="On Order" />
                    <Line type="monotone" dataKey="backlog" stroke={C.red} dot={false} strokeWidth={1.5} name="Backlog" />
                    <Line type="monotone" dataKey={() => params.reorderPoint} stroke={C.accentDim} dot={false} strokeWidth={1} strokeDasharray="2 4" name="ROP" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: "12px 14px" }}>
                <div style={{ fontSize: 7, color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
                  Service Level (Fill Rate %)
                </div>
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={invHistory} margin={{ top: 2, right: 8, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="t" tick={{ fill: C.muted, fontSize: 9 }} />
                    <YAxis domain={[60, 100]} tick={{ fill: C.muted, fontSize: 9 }} />
                    <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, fontFamily: "monospace", fontSize: 10 }} />
                    <Line type="monotone" dataKey="sl" stroke={C.accent} dot={false} strokeWidth={2} name="Fill Rate %" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* EVENTS TAB */}
          {tab === "events" && (
            <div style={{ flex: 1, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
              <div style={{ fontSize: 7, color: C.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>Full Event Stream — Inventory + Dispatch</div>
              <div style={{ flex: 1, background: C.panel, border: `1px solid ${C.border}`, padding: "10px 12px", overflow: "hidden" }}>
                <EventLog events={allEvents} />
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 8 }}>
                {[["⬇ Stock receipt", C.green], ["⚠ Stockout", C.red], ["📦 Purchase order", C.blue], ["🚛 Dispatch wave", C.purple], ["✓ Fleet returned", C.green]].map(([l, c]) => (
                  <span key={l} style={{ color: c }}>{l}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

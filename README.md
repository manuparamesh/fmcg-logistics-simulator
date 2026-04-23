# ◈ FMCG Logistics Simulator

<div align="center">

![Simulation](https://img.shields.io/badge/Paradigm-Discrete%20Event%20Simulation-16523b?style=for-the-badge)
![Routing](https://img.shields.io/badge/Routing-Vehicle%20Routing%20Problem-2d6a4f?style=for-the-badge)
![Stack](https://img.shields.io/badge/Stack-React%20%2B%20Python-1a1a2e?style=for-the-badge)
![Live](https://img.shields.io/badge/Status-Live%20Demo-f59e0b?style=for-the-badge)

**An end-to-end interactive supply chain simulator covering the full FMCG logistics cycle —
from supplier purchase orders through warehouse inventory control to last-mile truck dispatch.**

[🚀 Live Demo](https://manuparamesh.github.io/fmcg-logistics-simulator) · [📦 Source Code](https://github.com/manuparamesh/fmcg-logistics-simulator)

</div>

---

## 🗺 What It Does

```
Supplier ──► Warehouse (DES) ──► Order Batching ──► VRP Routing ──► Truck Dispatch ──► Store Delivery
                 │                                         │
           (s,Q) Policy                        Nearest-Neighbour Heuristic
          Stochastic Demand                    Capacity Constrained
          Variable Lead Time                   Live Map Animation
```

The simulator models a realistic FMCG distribution network across **South-East England**, with a Distribution Centre in Hertfordshire routing deliveries to stores across Greater London and the surrounding region.

---

## ⚙ Simulation Design

### 1 · Inventory Control — Discrete Event Simulation (DES)

The warehouse runs a **continuous-review (s, Q) inventory policy**:

| Parameter | Description |
|-----------|-------------|
| **s** — Reorder Point | Triggers a purchase order when inventory position drops to or below this level |
| **Q** — Order Quantity | Fixed quantity ordered each time the reorder point is breached |
| **Lead Time** | Stochastic — modelled as a rounded Normal distribution with configurable mean and variance |
| **Demand** | Stochastic — Normal(μ, CV·μ) per period; configurable mean and coefficient of variation |

```
Inventory Position = On-Hand Stock + On-Order − Backlog

When Position ≤ s  →  Place order for Q units
```

**Service Level (Fill Rate)** is tracked continuously:

```
Fill Rate = Total Units Fulfilled / Total Units Demanded × 100%
```

### 2 · Dispatch Batching

Demand accumulates until a configurable **dispatch threshold** is reached. This simulates realistic truck consolidation — preventing costly single-unit trips and approximating a minimum load factor constraint.

### 3 · Vehicle Routing Problem (VRP)

Once a dispatch wave is triggered, the simulator solves a **capacitated VRP** using a **Greedy Nearest-Neighbour heuristic**:

```
Algorithm:
  1. Start at Distribution Centre (DC)
  2. Find nearest unserved customer that fits remaining truck capacity
  3. Serve customer, update remaining capacity
  4. Repeat until no feasible customer remains
  5. Return truck to DC
  6. If unserved customers remain → assign new truck → repeat
```

Each truck route is:

```
DC → Store_A → Store_B → Store_C → DC
```

**Routing metrics tracked per truck:**

| Metric | Description |
|--------|-------------|
| Load (units) | Total demand served by this truck |
| Capacity % | Load as a fraction of max truck capacity |
| Stops | Number of store deliveries |
| Distance (km) | Estimated route distance |
| Status | En Route / Return to Base |

---

## 🎛 Parameters

All parameters are configurable in real-time via the sidebar sliders:

### Demand
| Parameter | Range | Description |
|-----------|-------|-------------|
| Mean Demand / day | 5–70u | Average daily demand across the network |
| Variability (CV) | 0.05–0.7 | Coefficient of Variation — controls demand volatility |

### Inventory (s, Q)
| Parameter | Range | Description |
|-----------|-------|-------------|
| Initial Stock | 100–800u | Starting warehouse inventory |
| Reorder Point (s) | 50–400u | Inventory position that triggers replenishment |
| Order Quantity (Q) | 100–600u | Fixed replenishment order size |
| Lead Time μ | 1–15 days | Mean supplier lead time |
| Lead Time σ | 0–8 days | Lead time variability |

### Dispatch (VRP)
| Parameter | Range | Description |
|-----------|-------|-------------|
| Truck Capacity | 50–400u | Maximum load per vehicle |
| No. of Stores | 2–12 | Active delivery nodes in the network |
| Dispatch Trigger | 50–400u | Accumulated demand that fires a dispatch wave |

---

## 🗃 Tech Stack

```
Frontend        React 19 + Vite
Charts          Recharts
Map             Leaflet.js (dark CartoDB tiles)
Simulation      Vanilla JS DES engine (no external lib)
Routing         Custom Greedy NN-VRP implementation
Deployment      GitHub Pages via gh-pages
```

---

## 📂 Project Structure

```
fmcg-logistics-simulator/
├── src/
│   ├── App.jsx              ← Full simulator: DES engine, VRP solver, Leaflet map, UI
│   └── index.css
├── public/
├── index.html
├── vite.config.js           ← base path set for GitHub Pages
└── package.json
```

The entire simulation logic lives in `src/App.jsx`:

| Module | Lines | Description |
|--------|-------|-------------|
| `InventorySim` class | ~45 | DES engine — (s,Q) policy, stochastic demand, lead times |
| `routeVehicles()` | ~30 | Greedy NN-VRP with capacity constraints |
| `initTrucks / stepTrucks` | ~40 | Truck state machine and position interpolation |
| `LeafletMap` component | ~130 | Real map, persistent marker management, route polylines |
| `App` (main) | ~120 | Simulation loop, dispatch logic, state management |

---

## 🚀 Run Locally

```bash
git clone https://github.com/manuparamesh/fmcg-logistics-simulator.git
cd fmcg-logistics-simulator
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and hit **▶ RUN**.

---

## 📈 Deploy to GitHub Pages

```bash
npm run deploy
```

---

## 💡 Simulation Concepts Demonstrated

| Concept | Implementation |
|---------|---------------|
| Discrete Event Simulation | Custom JS DES engine with per-period demand events and order arrival events |
| (s, Q) Inventory Policy | Continuous position review with stochastic triggers |
| Stochastic Demand | Box-Muller normal sampling with configurable CV |
| Stochastic Lead Time | Rounded normal supplier lead time with variance |
| Vehicle Routing Problem | Capacitated VRP with nearest-neighbour construction heuristic |
| Service Level Tracking | Rolling fill-rate KPI throughout simulation horizon |
| Order Batching | Demand accumulation trigger simulating minimum load efficiency |
| Real Geography | Leaflet.js with actual UK lat/lng coordinates |

---

## 🔭 Possible Extensions

- [ ] Clarke-Wright savings algorithm for better VRP solutions
- [ ] (s, S) and (R, Q) policy comparisons
- [ ] Multi-DC network with cross-docking
- [ ] Agent-Based Modelling layer for demand agents
- [ ] Python backend with SimPy for server-side DES
- [ ] Monte Carlo sensitivity analysis on service level vs reorder point

---

<div align="center">

Built by **Manu Paramesh** · [LinkedIn](https://linkedin.com/in/manuparamesh2612) · [GitHub](https://github.com/manuparamesh)

*Demonstrating Operations Research, Discrete Event Simulation, and Vehicle Routing — applied to real FMCG logistics problems.*

</div>

# Delivery Bundle — Status

> **Auto-generated** by `scripts/build_delivery_status.py` on every `build_delivery.py` run. Do not hand-edit — changes are overwritten.

- **Profile:** `option-b`
- **Last generated:** 2026-07-03T16:17:54
- **Bundle files:** `baselines.json`, `init.json`, `node_details.json`, `avoided.json` (+ `README.md` contract, `manifest.json` provenance)

Legend: ✅ complete/populated · ⬜ empty/not built · — not applicable

## Baselines (scenarios)

| Scenario | Source | Links | Status |
|---|---|---|---|
| 2025 | source CSV baseline | 341 | ✅ complete |
| 2040A | Current Policies | 341 | ✅ complete |
| 2040B | Stated Commitments | 341 | ✅ complete |
| 2040C | — | 0 | ⬜ not built (no baseline yet) |

## Nodes

Node-scoped subgraph rollups in `node_details.json` (117 flow nodes total), populated per scenario:

| Scenario | Nodes populated | Status |
|---|---|---|
| 2025 | 117 / 117 | ✅ |
| 2040A | 117 / 117 | ✅ |
| 2040B | 117 / 117 | ✅ |

## Companies (avoided emissions)

20 companies. Avoided-emissions figures are per scenario (2040A, 2040B, 2040C). Only scenarios with a built baseline (2040A, 2040B) can carry data; others are shown as — (n/a).

| Company | Location | 2040A | 2040B | 2040C |
|---|---|---|---|---|
| Fervo Energy | node: `5_Electricity and heat` | ✅ | ✅ | — (n/a) |
| Electric Hydrogen | node: `2_Chemical` | ✅ | ✅ | — (n/a) |
| Propel Aero | node: `3_Plane` | ✅ | ✅ | — (n/a) |
| Redwood Materials | node: `2_Other industry` | ✅ | ✅ | — (n/a) |
| Company E | — none | ⬜ | ⬜ | — (n/a) |
| Company F | — none | ⬜ | ⬜ | — (n/a) |
| Company G | — none | ⬜ | ⬜ | — (n/a) |
| Company H | — none | ⬜ | ⬜ | — (n/a) |
| Company I | — none | ⬜ | ⬜ | — (n/a) |
| Company J | — none | ⬜ | ⬜ | — (n/a) |
| Company K | — none | ⬜ | ⬜ | — (n/a) |
| Company L | — none | ⬜ | ⬜ | — (n/a) |
| Company M | — none | ⬜ | ⬜ | — (n/a) |
| Company N | — none | ⬜ | ⬜ | — (n/a) |
| Company O | — none | ⬜ | ⬜ | — (n/a) |
| Company P | — none | ⬜ | ⬜ | — (n/a) |
| Company Q | — none | ⬜ | ⬜ | — (n/a) |
| Company R | — none | ⬜ | ⬜ | — (n/a) |
| Company S | — none | ⬜ | ⬜ | — (n/a) |
| Company T | — none | ⬜ | ⬜ | — (n/a) |

### Summary

- Companies with a location set: **4 / 20**
- Company × scenario cells populated: **8 / 40** (buildable scenarios only: 2040A, 2040B)

## Themes (aggregated avoided emissions)

4 themes. Each theme sums its member companies' avoided emissions edge-by-edge. A theme whose members declare overlapping intervention locations is **blocked** (no total emitted) pending an attribution policy — shared downstream edges do not block.

| Theme | Members | Status | 2040A | 2040B |
|---|---|---|---|---|
| Materials | 2 | summed | ✅ | ✅ |
| Theme B | 0 | empty | ⬜ | ⬜ |
| Theme C | 0 | empty | ⬜ | ⬜ |
| Theme D | 0 | empty | ⬜ | ⬜ |


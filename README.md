# MarTar-ASA

Repo for the ASA project (Autonomous Software Agents, UniTN) - Team MarTar.

**Release v1.0**, the BDI agent used for the first challenge.
It is the baseline that later versions of the agent are compared against.

## How the agent works

`agent/bdi_agent.js` implements a BDI control loop.

### Beliefs
- `me`: position, id and score of the agent.
- `parcels`: parcels currently perceived; parcels out of view are forgotten.
- `carrying`: parcels the agent is carrying.
- Map knowledge: delivery tiles, spawner tiles, walkable tiles, one-way (arrow) tiles.
- Obstacles: tiles occupied by other agents and crates, refreshed at every sensing.
- Carrying capacity is read from the server config (`GAME.player.capacity`).

### Options (desires)
Generated at every sensing event and every 500 ms:
- `go_deliver` when carrying parcels. It is chosen right away when the agent is full,
  when no free parcels are visible, or when the nearest delivery tile is at least
  3 tiles closer than the nearest free parcel (avoids pickup/deliver ping-pong).
- `go_pick_up` for each free parcel; the nearest one is selected.
- `explore` when there is nothing else to do.

### Intention revision (Revise strategy)
- A new option replaces the current intention only if its utility is more than
  20% higher.
  - `go_pick_up`: `reward - dist(me, parcel) - dist(parcel, nearest delivery)`
  - `go_deliver`: `total carried reward - n_carried * dist(me, nearest delivery)`
- Intentions that are no longer valid (parcel taken by someone else, nothing to
  deliver) are skipped or stopped.
- Every intention is stopped after 5 s (`INTENTION_TIMEOUT_MS`).

### Plans
| Plan | Achieves | What it does |
|---|---|---|
| `GoPickUp` | `go_pick_up` | `go_to` the parcel, then pick it up; drops "ghost" parcels that were not picked |
| `GoDeliver` | `go_deliver` | `go_to` the nearest delivery tile, then put down |
| `Explore` | `explore` | `go_to` a random reachable spawner tile (more than 3 steps away) |
| `GoToBFS` | `go_to` | BFS path finding with walls, arrows, crates and other agents; replans up to 3 times |
| `BlindMove` | `go_to` | fallback: moves straight towards the target |

Plans are tried in this order; if one fails, the next applicable one is used.

## Known limitations
- Distances for utilities and delivery choice are Manhattan distances, not path lengths.
- Parcels out of view are forgotten (no memory).
- An unreachable parcel or delivery tile can be retried repeatedly.

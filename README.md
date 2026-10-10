# Rate Limiting Article Package

This folder contains the publishable article, an interactive browser lab, verified code for four implementation phases, original visuals, and two native video explainers.

## Start here

1. Read [`rate-limiting-article.md`](rate-limiting-article.md).
2. Open [`rate-limiting-playground.html`](rate-limiting-playground.html) directly in a browser.
3. Run `npm install` and `npm test` to reproduce the code verification.

## Four implementation phases

| Phase | Folder | Purpose |
|---|---|---|
| I | `code/phase1-bare/` | Fixed/sliding/token/leaky/GCRA with only JavaScript |
| II | `code/phase2-redis/` | Atomic Lua and a Redis-backed Node wrapper |
| III | `code/phase3-db-redis/` | Cached policy, operational quota, idempotent Postgres settlement |
| IV | `code/phase4-beyond/` | Concurrency, weighted cost, client retry, adaptive control, shedding |

## Commands

```powershell
npm install
npm test
npm run build:images
npm run build:animations
```

`ffmpeg` is needed only to regenerate the MP4 files. The HTML playground itself has no dependencies or build step.

## Verification boundary

The suites execute the algorithms, Lua scripts, race conditions, clock regression, Redis Cluster hash-tag construction, quota cold starts, idempotent batch replay, month rollover, queue deadlines/cancellation, retry safety, and feedback-controller demonstrations.

Redis is emulated around a real Lua 5.3 VM for deterministic script tests. Before deploying comparable code, add integration and fault-injection tests against your real Redis/Cluster/Postgres topology, including failover, persistence, eviction, script deployment, slot routing, network timeouts, and transaction isolation.

## Assets

- `images/00-cover.png` through `images/14-decision-tree.png`: 15 concepts, all at or below 1800px wide except GIF stills, which remain below 2000px.
- `images/03-token-bucket.gif`: token-bucket simulation.
- `images/07-race-condition.gif`: check/write race versus atomic Lua.
- `videos/token-bucket.mp4` and `videos/redis-race.mp4`: native video versions.
- SVG source is retained beside each PNG.

LinkedIn publishing drafts and campaign material are intentionally kept outside this repository.

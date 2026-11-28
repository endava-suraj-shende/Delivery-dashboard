"""Load test: N concurrent virtual users browsing the dashboards for D seconds.

    python tools/loadtest.py --users 50 --seconds 60 [--base http://127.0.0.1:8000] [--email ... --password ...]

Each virtual user signs in once, then loops over a realistic mix (overview, employees, tickets, sprints, narrative,
forecast, team, deployments, search) with short think times. Prints throughput, latency percentiles per endpoint and
error counts. Dependency-free (httpx + asyncio); run it against the demo accounts to avoid touching real data.
"""
from __future__ import annotations

import argparse
import asyncio
import random
import time
from collections import defaultdict
from typing import Dict, List, Tuple

import httpx

MIX: List[Tuple[str, int]] = [  # (path, weight)
    ("/api/v1/dashboard/executive", 6),
    ("/api/v1/dashboard/narrative", 4),
    ("/api/v1/dashboard/forecast", 2),
    ("/api/v1/employees", 4),
    ("/api/v1/jira/tickets?page=1&page_size=100", 3),
    ("/api/v1/sprints", 3),
    ("/api/v1/dashboard/team", 2),
    ("/api/v1/deployment/dev/summary", 2),
    ("/api/v1/deployment/production/summary", 1),
    ("/api/v1/meta/dimensions", 2),
    ("/api/v1/search?q=login", 1),
    ("/api/v1/excel/status", 3),
]
SAMPLES: List[str] = []
PERIODS = ["last_7_days", "last_15_days", "last_30_days", "last_60_days"]


def pct(values: List[float], p: float) -> float:
    if not values:
        return 0.0
    k = (len(values) - 1) * p / 100
    f, c = int(k), min(int(k) + 1, len(values) - 1)
    return values[f] + (values[c] - values[f]) * (k - f)


async def user(idx: int, base: str, email: str, password: str, deadline: float, results: Dict[str, List[float]],
               errors: Dict[str, int], think: float) -> None:
    rng = random.Random(idx)
    async with httpx.AsyncClient(base_url=base, timeout=120, headers={"Origin": base}) as c:
        await asyncio.sleep(rng.random() * 3)  # staggered start
        t = time.perf_counter()
        r = await c.post("/api/v1/auth/login", json={"email": email, "password": password})
        results["/api/v1/auth/login"].append((time.perf_counter() - t) * 1000)
        if r.status_code != 200:
            errors[f"login {r.status_code}"] += 1
            return
        paths = [p for p, w in MIX for _ in range(w)]
        while time.perf_counter() < deadline:
            path = rng.choice(paths)
            sep = "&" if "?" in path else "?"
            url = f"{path}{sep}preset={rng.choice(PERIODS)}" if "/excel/status" not in path and "/meta/" not in path else path
            key = path.split("?")[0]
            t = time.perf_counter()
            try:
                r = await c.get(url)
                results[key].append((time.perf_counter() - t) * 1000)
                if r.status_code >= 400:
                    errors[f"{key} {r.status_code}"] += 1
                    if r.status_code >= 500 and len(SAMPLES) < 3:
                        SAMPLES.append(f"{key} -> {r.text[:300]}")
            except Exception as e:  # noqa: BLE001
                errors[f"{key} {type(e).__name__}"] += 1
            await asyncio.sleep(rng.uniform(think * 0.5, think * 1.5))


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--users", type=int, default=50)
    ap.add_argument("--seconds", type=int, default=60)
    ap.add_argument("--think", type=float, default=2.0, help="average seconds between requests per user")
    ap.add_argument("--accounts", default="demo.admin@example.com:Demo-Admin-2026!,demo.manager@example.com:Demo-Manager-2026!",
                    help="comma-separated email:password pairs; virtual users rotate through them")
    a = ap.parse_args()
    results: Dict[str, List[float]] = defaultdict(list)
    errors: Dict[str, int] = defaultdict(int)
    deadline = time.perf_counter() + a.seconds
    started = time.perf_counter()
    accounts = [tuple(x.split(":", 1)) for x in a.accounts.split(",") if ":" in x]
    await asyncio.gather(*(user(i, a.base, *accounts[i % len(accounts)], deadline, results, errors, a.think) for i in range(a.users)))
    elapsed = time.perf_counter() - started
    total = sum(len(v) for v in results.values())
    print(f"\n{a.users} users x {a.seconds}s (think ~{a.think}s) -> {total} requests, {total / elapsed:.1f} req/s, errors: {sum(errors.values())}\n")
    print(f"{'endpoint':46} {'n':>6} {'p50':>8} {'p95':>8} {'p99':>8} {'max':>8}")
    for path, vals in sorted(results.items(), key=lambda kv: -pct(sorted(kv[1]), 95)):
        v = sorted(vals)
        print(f"{path:46} {len(v):6d} {pct(v, 50):8.0f} {pct(v, 95):8.0f} {pct(v, 99):8.0f} {v[-1]:8.0f}")
    allv = sorted(x for v in results.values() for x in v)
    print(f"\n{'ALL':46} {len(allv):6d} {pct(allv, 50):8.0f} {pct(allv, 95):8.0f} {pct(allv, 99):8.0f} {allv[-1] if allv else 0:8.0f}")
    if errors:
        print("\nErrors:")
        for k, n in sorted(errors.items(), key=lambda kv: -kv[1]):
            print(f"  {n:5d}  {k}")
    for smp in SAMPLES:
        print("sample 5xx:", smp)
    verdict = "PASS" if pct(allv, 95) < 2000 and sum(errors.values()) == 0 else "ATTENTION"
    print(f"\nVerdict: {verdict} (target: p95 < 2000 ms, zero errors)")


if __name__ == "__main__":
    asyncio.run(main())

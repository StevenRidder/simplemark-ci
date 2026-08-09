# 0009 — Wall-clock budgets in the UI suite are calibrated to CI's observed worst case

Status: Accepted (2026-08-10)

## Context

Merge-queue runs bounced four times across 2026-08-08/09 (PRs #157, #176 and the
queue entries testing against them), every failure a wall-clock budget on a
saturated shared runner and never the same test twice. The observed failures
fall into four classes, each with real numbers from the queue-branch runs in
Actions history:

1. **Pure performance guards** — `Date.now()` deltas asserted `< 8_000` in
   `large-table-guard.spec.ts` and `large-markdown-resilience.spec.ts` measured
   8,246ms and 8,577ms on saturated runners: a 3–7% overshoot of a budget whose
   regression signature is ~45,000ms.
2. **Playwright's 5s default assertion budget racing Mermaid** —
   `diagram-frame.spec.ts` bounced three separate queue runs because its render
   waits ran on the 5s default while a large Mermaid render has been measured at
   12–16s on CI (`figure-viewer.spec.ts` documents that measurement and already
   carries a 20s explicit budget for the same wait).
3. **The 30s default test timeout** — `styles-bar.spec.ts` "Callout turns a
   line into a portable caution block" died at 30.9s when a single click stalled
   under runner saturation. The per-file split (PR #137) fixed the shared-budget
   disease; this is the residual: one honest test that is simply slower than 30s
   on a bad runner.
4. **The clipboard settle poll** — the 15s settle budget (PR #178) still lost a
   race at 18.7s; the spec's own comment establishes that headroom, not a better
   signal, is the only available fix.

Each bounce silently dequeues the PR and costs 30–60 minutes of re-enqueue
latency. `retries: 0` is deliberate and stays: a retry would hide exactly the
signal this ADR instead re-calibrates.

## Decision

Wall-clock numbers in `tests/ui` divide into two kinds with opposite rules:

- **Correctness waits** (how long we let the app take to do the right thing)
  get CI headroom **at the framework level**, not per assertion:
  `playwright.config.ts` sets `timeout: 60_000` and `expect.timeout: 15_000`
  when `CI === 'true'`. Local runs keep Playwright's tight defaults, so a
  developer still notices a slow interaction. Widening a correctness wait on CI
  can hide no bug — the assertion still demands the same end state.
  Exception: a wait known to legitimately exceed the raised default (Mermaid
  renders, measured 12–16s on CI) carries its own explicit `timeout: 30_000`,
  which is already the convention in every diagram spec.
- **Performance guards** (asserting the app was *fast*, not just correct) stay
  tight locally and take an explicit CI multiplier through one shared helper,
  `tests/ui/perf-budget.ts` (`perfBudget(ms)` = `ms × 1.5` on CI). The budget
  must still sit far below the regression it guards: 12s on CI against a 45s
  stall signature keeps the guard meaningful. A perf guard whose regression
  signature is not several multiples of its CI budget does not belong in the
  required lane at all.

The ruling for future thresholds: **no wall-clock number enters `tests/ui`
without stating what its CI worst case is and which kind it is.** Queue-branch
runs in Actions history are the calibration data.

## Consequences

- Saturated-runner overshoots of a few hundred milliseconds no longer dequeue
  PRs; a genuine stall (the ~45s class) still fails by a wide margin.
- `retries: 0` remains honest: the suite now distinguishes "slow runner" from
  "wrong behaviour" by construction instead of by luck.
- Failing tests take longer to fail on CI (60s cap instead of 30s). That cost
  is paid only on failure and is far cheaper than a bounce.

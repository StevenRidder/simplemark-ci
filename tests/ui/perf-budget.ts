/**
 * CI headroom for pure performance guards (ADR 0009).
 *
 * A perf guard asserts the app was *fast*, so unlike a correctness wait it
 * cannot borrow the framework's CI-widened defaults — it needs its own,
 * explicit, still-meaningful ceiling. Saturated shared runners have been
 * observed 3–7% over budgets that pass locally with seconds to spare
 * (large-table-guard hit 8,246ms and 8,577ms against an 8,000ms cap in the
 * 2026-08-09 merge-queue bounces), so CI gets a 1.5× multiplier. The budget
 * must remain several multiples below the regression it guards; if it can't,
 * the guard doesn't belong in the required lane.
 */
export function perfBudget(localMs: number): number {
  return process.env['CI'] === 'true' ? localMs * 1.5 : localMs
}

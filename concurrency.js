/**
 * Bounded-concurrency helpers for per-character side prompt runs.
 * PURE module — no SillyTavern imports; Node-testable.
 */

/**
 * Run fn(item, index) over items with at most `limit` calls in flight.
 * - Results preserve input order: results[i] corresponds to items[i].
 * - Settles ALL items: a rejection becomes { ok: false, error } in its slot
 *   instead of rejecting the whole batch; successes are { ok: true, value }.
 * - limit <= 1 degenerates to strictly sequential execution in input order.
 *
 * @param {Array} items
 * @param {number} limit  Max calls in flight (clamped to >= 1).
 * @param {(item: any, index: number) => Promise<any>} fn
 * @returns {Promise<Array<{ ok: true, value: any } | { ok: false, error: any }>>}
 */
export async function runBounded(items, limit, fn) {
    const list = Array.from(items ?? []);
    const results = new Array(list.length);
    if (list.length === 0) return results;

    const numericLimit = Math.trunc(Number(limit));
    const workers = Math.min(Math.max(Number.isFinite(numericLimit) ? numericLimit : 1, 1), list.length);

    let next = 0;
    const worker = async () => {
        while (next < list.length) {
            const i = next++;
            try {
                results[i] = { ok: true, value: await fn(list[i], i) };
            } catch (error) {
                results[i] = { ok: false, error };
            }
        }
    };

    await Promise.all(Array.from({ length: workers }, worker));
    return results;
}

/**
 * Effective LLM concurrency for a template's parallelCalls setting.
 * Absent or disabled -> 1 (the caller keeps its sequential path).
 * Enabled -> limit clamped into [2..4], defaulting to 2.
 *
 * @param {{ enabled?: boolean, limit?: number }|null|undefined} parallelCalls
 * @returns {number}
 */
export function resolveParallelLimit(parallelCalls) {
    if (!parallelCalls?.enabled) return 1;
    const n = Math.trunc(Number(parallelCalls.limit));
    if (!Number.isFinite(n)) return 2;
    return Math.min(Math.max(n, 2), 4);
}

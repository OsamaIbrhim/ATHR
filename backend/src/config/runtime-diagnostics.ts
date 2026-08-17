import { monitorEventLoopDelay } from 'node:perf_hooks';

/**
 * WP-P1 H2: is the read-path p95 gap (13.4ms in Postgres vs. ~548ms
 * observed) event-loop saturation under PERF_CONCURRENCY, or time spent
 * building the response? This samples both and logs them to stdout so they
 * can be correlated against the read-sweep's timestamps in the same job's
 * captured API log. Gated on PERF_DIAGNOSTICS=1 -- inert (no timer started,
 * zero overhead) in every other environment, including production.
 */
export function startRuntimeDiagnostics(intervalMs = 500): void {
  if (process.env.PERF_DIAGNOSTICS !== '1') return;

  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let lastCpu = process.cpuUsage();
  let lastSampledAt = process.hrtime.bigint();

  setInterval(() => {
    const cpu = process.cpuUsage();
    const now = process.hrtime.bigint();
    const elapsedMs = Number(now - lastSampledAt) / 1_000_000;
    const userMs = (cpu.user - lastCpu.user) / 1000;
    const systemMs = (cpu.system - lastCpu.system) / 1000;

    console.log(
      JSON.stringify({
        type: 'runtime_sample',
        // Real wall-clock time, not the GitHub Actions log-ingestion
        // timestamp -- the "Print API log" step dumps the whole captured
        // server log in one `cat`, so every line gets nearly the same
        // ingestion timestamp regardless of when it was actually written.
        // This is what lets a reader correlate a sample to a specific sweep
        // phase (see diagnose-product-pagination.cjs's sweep_phase markers).
        sampled_at: new Date().toISOString(),
        event_loop_delay_mean_ms: Number((histogram.mean / 1e6).toFixed(2)),
        event_loop_delay_p50_ms: Number((histogram.percentile(50) / 1e6).toFixed(2)),
        event_loop_delay_p99_ms: Number((histogram.percentile(99) / 1e6).toFixed(2)),
        event_loop_delay_max_ms: Number((histogram.max / 1e6).toFixed(2)),
        // Percent of one CPU core consumed by this process over the interval
        // -- >100 means the process used more than one core's worth of time
        // (multiple threads/libuv workers), not that it exceeded a limit.
        cpu_percent: Number((((userMs + systemMs) / elapsedMs) * 100).toFixed(1)),
        rss_mb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
      }),
    );

    histogram.reset();
    lastCpu = cpu;
    lastSampledAt = now;
  }, intervalMs).unref();
}

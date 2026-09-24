import { withRequestTimeout } from "./request-timeout";

// Low-priority badges only: never restart or cancel user work on tab focus.
export function startBackgroundPoll(task, {
  intervalMs = 60000,
  maxDelayMs = 300000,
  timeoutMs = 15000,
  isVisible = () => document.visibilityState === "visible",
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let stopped = false;
  let timer;
  let controller;
  let delay = intervalMs;
  const schedule = () => { if (!stopped) timer = setTimer(run, delay); };
  async function run() {
    if (stopped) return;
    if (!isVisible()) { schedule(); return; }
    controller = new AbortController();
    try {
      await withRequestTimeout(task(controller.signal), "Background check timed out", () => controller.abort(), timeoutMs);
      delay = intervalMs;
    } catch {
      // Keep the previous badge count; do not turn an outage into more traffic.
      delay = Math.min(delay * 2, maxDelayMs);
    } finally {
      schedule();
    }
  }
  run();
  return () => { stopped = true; clearTimer(timer); controller?.abort(); };
}

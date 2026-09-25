function pause(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

// A single user action starts a bounded readiness check, never a publication.
// Do not restart this on renders, focus changes or background calendar refreshes.
export async function waitForInstagramPreparation(initial, check, { signal, onProgress = () => {}, wait = pause, now = Date.now } = {}) {
  let job = initial;
  const deadline = now() + 45000;
  const delays = [0, 1500, 3000, 5000, 8000, 10000];
  for (let index = 0; index < delays.length && job?.status === "processing"; index++) {
    signal?.throwIfAborted();
    if (!job.container_id || !job.operation_id) throw new Error("De voorbereiding is onvolledig. Ververs eerst de accountstatus.");
    if (now() + delays[index] >= deadline) break;
    onProgress(index + 1, delays.length);
    if (delays[index]) await wait(delays[index], signal);
    signal?.throwIfAborted();
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const next = await check(job.operation_id, Math.min(12000, remaining));
    signal?.throwIfAborted();
    if (!next?.status || next.operation_id !== initial.operation_id) throw new Error("De voorbereiding is gewijzigd. Ververs eerst de accountstatus.");
    job = next;
  }
  return job;
}

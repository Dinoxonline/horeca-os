export const PREDIS_POLL_INTERVAL = 20000;
export const PREDIS_POLL_WINDOW = 15 * 60 * 1000;

// Only check accepted requests; never retry creation, uncertain or rejected jobs.
export function nextPredisPoll(jobs, now = Date.now()) {
  return jobs.filter(job => job.status === "generating" && job.postIds?.length &&
    Number.isFinite(Date.parse(job.createdAt)) && now - Date.parse(job.createdAt) < PREDIS_POLL_WINDOW)
    .sort((a, b) => (Date.parse(a.checkedAt) || 0) - (Date.parse(b.checkedAt) || 0))[0] || null;
}

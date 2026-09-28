import { normalizePredisPost } from "./predis-content";

// Only match an already accepted provider ID, never titles or user-supplied event IDs.
export function webhookJobs(row, postId) {
  return (row.media || []).filter(m => m?.kind === "campaign_distribution")
    .flatMap(m => m.predis_content?.jobs || []).filter(j => j.postIds?.includes(postId));
}

export function applyPredisWebhook(row, body, now) {
  let changed = false;
  const media = row.media.map(m => {
    if (m?.kind !== "campaign_distribution" || !m.predis_content?.jobs) return m;
    const jobs = m.predis_content.jobs.map(job => {
      if (!job.postIds?.includes(body.post_id)) return job;
      if (body.brand_id && body.brand_id !== job.brandId) throw new Error("BRAND_MISMATCH");
      if (job.status === "ready") return job; // Replays/errors cannot undo a complete result.
      if (body.status === "error") {
        if (job.status === "generation_failed") return job;
        changed = true;
        return { ...job, status: "generation_failed", errorCode: "PREDIS_GENERATION_FAILED", checkedAt: now };
      }
      const result = normalizePredisPost({ post_id: body.post_id, caption: body.caption,
        media_type: job.mediaType, urls: Array.isArray(body.generated_media) ? body.generated_media.map(a => a?.url) : [] }, job.postIds);
      if (!result) throw new Error("INVALID_MEDIA");
      const results = [...(job.results || []).filter(r => r.id !== result.id), result];
      changed = true;
      return { ...job, results, status: job.postIds.every(id => results.some(r => r.id === id)) ? "ready" : job.status,
        errorCode: null, checkedAt: now };
    });
    return { ...m, predis_content: { ...m.predis_content, jobs } };
  });
  return changed ? media : null;
}

export async function savePredisWebhookJobs(admin, body) {
  const found = await admin.from("social_content_items").select("id,workspace_id,business_id,media,updated_at")
    .contains("media", JSON.stringify([{ kind: "campaign_distribution", predis_content: { jobs: [{ postIds: [body.post_id] }] } }])).limit(51);
  if (found.error) throw new Error("LOOKUP_FAILED");
  const rows = found.data || [];
  if (!rows.length) return false;
  // Event reconciliation may copy the same job. Permit only exact copies in one tenant/business.
  const identities = new Set(rows.flatMap(row => webhookJobs(row, body.post_id)
    .map(j => JSON.stringify([row.workspace_id, row.business_id, j.id, j.brandId]))));
  if (rows.length > 50 || identities.size !== 1) throw new Error("AMBIGUOUS_JOB");
  const now = new Date().toISOString();
  // Validate every match before writing any of them.
  rows.forEach(row => applyPredisWebhook(row, body, now));
  for (let row of rows) {
    let saved = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!row.updated_at) throw new Error("MISSING_VERSION");
      const media = applyPredisWebhook(row, body, now);
      if (!media) { saved = true; break; }
      const scope = q => q.eq("id", row.id).eq("workspace_id", row.workspace_id).eq("business_id", row.business_id);
      const write = await scope(admin.from("social_content_items").update({ media })).eq("updated_at", row.updated_at).select("id").maybeSingle();
      if (write.error) throw new Error("WRITE_FAILED");
      if (write.data) { saved = true; break; }
      const fresh = await scope(admin.from("social_content_items").select("id,workspace_id,business_id,media,updated_at")).maybeSingle();
      if (fresh.error || !fresh.data) throw new Error("RELOAD_FAILED");
      row = fresh.data;
    }
    if (!saved) throw new Error("WRITE_CONFLICT");
  }
  return true;
}

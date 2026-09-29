export const META_CAMPAIGN_STATUS_LABELS = {
  active: "Actief in Meta", scheduled: "Ingepland in Meta", paused: "Gepauzeerd in Meta",
  ended: "Looptijd afgelopen", review: "In beoordeling bij Meta", rejected: "Afgekeurd door Meta",
  issues: "Aandacht nodig in Meta", deleted: "Verwijderd in Meta", archived: "Gearchiveerd in Meta",
  processing: "Wordt verwerkt door Meta", unknown: "Status niet vastgesteld",
};

// Inspect the registered campaign, ad set AND ad: an active parent alone does not mean delivery.
export function metaCampaignStatus(campaign, adset, ad, now = new Date()) {
  const nodes = [campaign, adset, ad];
  const statuses = nodes.flatMap(node => [node.status, node.effective_status]).filter(Boolean);
  const has = (...values) => values.some(value => statuses.includes(value));
  let state = "unknown";
  if (has("DELETED")) state = "deleted";
  else if (has("ARCHIVED")) state = "archived";
  else if (adset.end_time && Number.isFinite(Date.parse(adset.end_time)) && Date.parse(adset.end_time) <= now.getTime()) state = "ended";
  else if (has("DISAPPROVED")) state = "rejected";
  else if (has("WITH_ISSUES", "PENDING_BILLING_INFO")) state = "issues";
  else if (has("PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED")) state = "paused";
  else if (has("PENDING_REVIEW", "PREAPPROVED")) state = "review";
  else if (has("IN_PROCESS")) state = "processing";
  else if (nodes.every(node => node.status === "ACTIVE" && node.effective_status === "ACTIVE")) {
    state = adset.start_time && Date.parse(adset.start_time) > now.getTime() ? "scheduled" : "active";
  }
  return {
    state, checked_at: now.toISOString(), start_at: adset.start_time || null, end_at: adset.end_time || null,
    campaign: { status: campaign.status || null, effective_status: campaign.effective_status || null },
    adset: { status: adset.status || null, effective_status: adset.effective_status || null },
    ad: { status: ad.status || null, effective_status: ad.effective_status || null },
  };
}

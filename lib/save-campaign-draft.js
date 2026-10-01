// Keep Predis jobs and manual history when the campaign form replaces its editable fields.
// Read through the user's client (RLS), and reject concurrent webhook/form changes.
export async function saveCampaignDraft(client, workspaceId, itemId, record) {
  if (!itemId) return client.from("social_content_items").insert({ ...record, workspace_id: workspaceId }).select("id").maybeSingle();
  const scoped = () => client.from("social_content_items").select("media,updated_at")
    .eq("id", itemId).eq("workspace_id", workspaceId).eq("business_id", record.business_id).maybeSingle();
  const { data: current, error } = await scoped();
  if (error) return { error };
  if (!current?.updated_at) return { error: new Error("Het concept is niet meer beschikbaar voor deze vestiging. Laad het overzicht opnieuw.") };
  const previous = (current.media || []).find(entry => entry?.kind === "campaign_distribution");
  const next = record.media.find(entry => entry?.kind === "campaign_distribution");
  if (!previous || !next) return { error: new Error("Het campagnedossier is onvolledig. Laad het overzicht opnieuw.") };
  const distribution = { ...next };
  for (const key of ["predis_content", "manual_predis", "predis_library"]) {
    if (Object.hasOwn(previous, key)) distribution[key] = previous[key];
  }
  if (previous.provider_delivery?.predis) distribution.provider_delivery = { ...next.provider_delivery, predis: previous.provider_delivery.predis };
  const media = current.media.map(entry => entry?.kind === "campaign_distribution" ? distribution : entry);
  const result = await client.from("social_content_items").update({ ...record, media })
    .eq("id", itemId).eq("workspace_id", workspaceId).eq("business_id", record.business_id)
    .eq("updated_at", current.updated_at).select("id").maybeSingle();
  return result.error || result.data ? result : { error: new Error("Het dossier is ondertussen gewijzigd. Je invoer blijft staan; probeer opnieuw op te slaan.") };
}

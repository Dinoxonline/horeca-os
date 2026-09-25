import { saveEventContent } from "./manual-event-content";

// Local-only persistence. Never call a publishing API from this operation.
// Save the retained text before marking the other row as a duplicate. Each
// write uses the existing workspace/venue filters and row-version compare-and-swap.
export async function saveLocalEventMerge(client, workspaceId, keep, duplicate, keptDistribution) {
  if (!workspaceId || !keep?.id || !duplicate?.id || keep.id === duplicate.id || !keep.business_id || String(keep.business_id) !== String(duplicate.business_id)) {
    throw new Error("Kies twee verschillende agendapunten van dezelfde vestiging.");
  }
  const duplicateDistribution = (duplicate.media || []).find(entry => entry?.kind === "campaign_distribution");
  const keepDistribution = (keep.media || []).find(entry => entry?.kind === "campaign_distribution");
  if (!duplicateDistribution || !keepDistribution || duplicateDistribution.duplicate_of || keepDistribution.duplicate_of) {
    throw new Error("Een agendapunt is al samengevoegd of niet meer beschikbaar. Ververs eerst de agenda.");
  }
  let savedItem;
  try {
    savedItem = await saveEventContent(client, workspaceId, keep, keptDistribution);
  } catch (cause) {
    throw new Error("Opslaan in Horeca OS kon niet worden bevestigd. Controleer de agenda voordat je opnieuw probeert. Website en Facebook zijn niet gewijzigd.", { cause });
  }
  try {
    await saveEventContent(client, workspaceId, duplicate, { ...duplicateDistribution, duplicate_of: keep.id });
  } catch (cause) {
    const error = new Error("De gekozen tekst is opgeslagen in Horeca OS, maar het samenvoegen kon niet worden bevestigd. Controleer de agenda voordat je opnieuw probeert. Website en Facebook zijn niet gewijzigd.", { cause });
    error.savedItem = savedItem;
    throw error;
  }
  return savedItem;
}

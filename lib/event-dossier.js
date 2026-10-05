import { saveEventContent } from './manual-event-content';

export const eventSteps = ['horeca_os', 'website', 'facebook', 'facebook_giveaway', 'whatsapp', 'instagram', 'meta', 'calendar', 'predis'];
export function eventDistribution(item) {
  return (item?.media || []).find(entry => entry?.kind === 'campaign_distribution') || {};
}
export function normalizedEventImages(images = {}) {
  return Object.fromEntries(Object.entries(images).map(([key, value]) => [key, typeof value === 'string' ? (value ? { url: value } : null) : value]));
}
export function dossierDistribution(snapshot, before = {}) {
  const { form, artistProgram = '', practicalDetails = '', creativeBrief = '', sourceText = '', eventWorkboardTasks = [], step = 'horeca_os' } = snapshot;
  if (!form.title.trim()) throw new Error('Vul minimaal een evenementnaam in.');
  const common = {
    ...before.common, campaign_type: 'event', title: form.title.trim(),
    short_description: form.shortDescription, description: form.description,
    start: form.start, end: form.end, location: form.location,
    image_url: form.eventinImage?.url || form.imageUrl || '',
    eventin_image: form.eventinImage, images: normalizedEventImages(form.images), video_url: form.videoUrl,
    organizer: form.organizer, contact_email: form.contactEmail, language: form.language,
    cta: { ...before.common?.cta, label: form.ctaLabel, url: form.ctaUrl },
    tickets: { ...before.common?.tickets, type: form.ticketType, price: form.ticketPrice, capacity: form.capacity, variations: form.ticketVariations },
    artist_program: artistProgram, practical_details: practicalDetails, creative_brief: creativeBrief, source_text: sourceText,
    giveaway: { cards: form.giveawayCards || '2', deadline: form.giveawayDeadline || '', announcement: form.giveawayAnnouncement || '', responseHours: form.giveawayResponseHours || '12' },
  };
  const payloads = before.channel_payloads || {};
  return {
    ...before, kind: 'campaign_distribution', source_type: before.source_type || 'event', common,
    target_channels: before.target_channels || Object.keys(form.channels || {}).filter(key => form.channels[key]),
    channel_payloads: {
      ...payloads,
      facebook: { ...payloads.facebook, text: form.facebookText || form.description },
      whatsapp: { ...payloads.whatsapp, message: form.whatsappMessage || form.description },
      instagram: { ...payloads.instagram, caption: form.instagramCaption || form.description },
    },
    event_workflow: { ...before.event_workflow, step: eventSteps.includes(step) ? step : 'horeca_os' },
    event_workboard_drafts: eventWorkboardTasks,
  };
}

// Only internal storage. Never calls a publishing, email or calendar endpoint.
// Existing rows use a three-way merge: unrelated channel work survives.
export async function saveEventDossier(client, { workspaceId, businessId, userId, accountId, item, id, snapshot }) {
  const distribution = dossierDistribution(snapshot, eventDistribution(item));
  const body = distribution.common.description || distribution.common.short_description || distribution.common.title;
  if (item) return saveEventContent(client, workspaceId, item, distribution, body);
  if (!workspaceId || !businessId || !userId || !accountId || !id) throw new Error('De opslaggegevens ontbreken.');
  // Stable client id makes a retry safe when an insert succeeded but its response was lost.
  const { data: found, error: readError } = await client.from('social_content_items')
    .select('id,business_id,body,media,updated_at').eq('workspace_id', workspaceId).eq('business_id', businessId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (found) {
    // Do not overwrite an unknown successful insert. Reload it as our baseline first.
    return found;
  }
  const record = { id, workspace_id: workspaceId, business_id: businessId, account_id: accountId, created_by: userId,
    content_type: 'post', direction: 'outbound', body, media: [distribution], status: 'draft', workflow_status: 'new', scheduled_for: null };
  const { data, error } = await client.from('social_content_items').insert(record).select('id,updated_at').maybeSingle();
  if (error || !data?.id) throw error || new Error('Opslaan is niet bevestigd. Je invoer blijft staan.');
  return { ...record, ...data };
}

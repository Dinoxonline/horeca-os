import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createUserSupabase } from '../../../../lib/server-supabase';
import { facebookEventId } from '../../../../lib/manual-event-content';
import { downloadFacebookPhoto, importedPhotoDistribution, photoDistribution, photoHash, websitePhotoId, websitePhotoSnapshot, publishWebsitePhoto } from '../../../../lib/event-photo-server';
import { GET as facebookEvents } from '../../integrations/facebook/events/route';

export const runtime = 'nodejs';
export const maxDuration = 60;
const reply = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export async function POST(request) {
  let reserved, persist;
  try {
    const body = await request.json();
    const { workspaceId, businessId, itemId, action } = body;
    if (![workspaceId, businessId, itemId].every(v => typeof v === 'string' && /^[\w-]{1,80}$/.test(v)) ||
        !['facebook-preview', 'facebook-import', 'website-preview', 'website-publish'].includes(action)) throw fail('Ongeldig fotoverzoek.');
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) throw fail('Log opnieuw in.', 401);
    const client = createUserSupabase(token);
    const { data: auth, error: authError } = await client.auth.getUser(token);
    if (authError || !auth?.user) throw fail('Je sessie is verlopen.', 401);
    let claims;
    try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { throw fail('Ongeldige sessie.', 401); }
    if (claims.aal !== 'aal2') throw fail('Bevestig eerst je tweestapsverificatie.', 403);
    const { data: member } = await client.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', auth.user.id).maybeSingle();
    if (member?.role !== 'owner') throw fail('Alleen een eigenaar kan evenementfoto’s overnemen.', 403);
    const scoped = () => client.from('social_content_items');
    const { data: item, error } = await scoped().select('id,business_id,media,body,updated_at').eq('workspace_id', workspaceId).eq('business_id', businessId).eq('id', itemId).maybeSingle();
    if (error || !item || item.media?.filter(m => m?.kind === 'campaign_distribution').length !== 1) throw fail('Evenement niet gevonden in deze vestiging.', 404);
    const d = photoDistribution(item);
    // The existing agenda can display the most complete merged representative
    // instead of the root. Permit it only when the root has the same verified
    // channel identities in this workspace/business. Legacy self-links are
    // harmless here; do not repair or remove merge metadata as a side effect.
    if (d.duplicate_of && String(d.duplicate_of) !== String(item.id)) {
      const { data: root, error: rootError } = await scoped().select('id,media').eq('workspace_id', workspaceId).eq('business_id', businessId).eq('id', d.duplicate_of).maybeSingle();
      const rootD = photoDistribution(root);
      if (rootError || !root || !facebookEventId(d) || facebookEventId(rootD) !== facebookEventId(d) || !websitePhotoId(d) || websitePhotoId(rootD) !== websitePhotoId(d)) {
        throw fail('Open het samengevoegde evenement: de kanaalkoppelingen van deze regels zijn niet gelijk.', 409);
      }
    }
    if (action.endsWith('import') || action.endsWith('publish')) {
      if (!body.revision || body.revision !== item.updated_at) throw fail('Het evenement is gewijzigd. Ververs de details en bekijk de foto opnieuw.', 409);
    }
    let current = item;
    persist = async next => {
      const media = current.media.map(m => m?.kind === 'campaign_distribution' ? next : m);
      const { data, error: updateError } = await scoped().update({ media }).eq('workspace_id', workspaceId).eq('business_id', businessId).eq('id', itemId).eq('updated_at', current.updated_at).select('id,updated_at').maybeSingle();
      if (updateError || !data) throw fail('De foto/status kon niet worden bewaard. Ververs het evenement en controleer opnieuw.', 409);
      current = { ...current, media, updated_at: data.updated_at }; return current;
    };
    if (d.event_photo_website?.status === 'updating' && action !== 'website-preview') throw fail('Er loopt al een foto-update. Controleer eerst de websitefoto.', 409);

    if (action.startsWith('facebook')) {
      // Reuse the authenticated, business-scoped Page event reader. No URL or
      // event ID supplied by the browser is ever used to download a photo.
      const query = new URLSearchParams({ workspaceId, businessId, includePast: 'true' });
      const result = await facebookEvents(new Request(`https://horeca-os.invalid/api/integrations/facebook/events?${query}`, { headers: { authorization: `Bearer ${token}` } }));
      if (!result.ok) throw fail('De gekoppelde Facebook-evenementen konden niet worden gelezen. Controleer de Facebook-koppeling.', 502);
      const events = (await result.json()).events || [];
      const id = facebookEventId(d) || String(d.provider_delivery?.facebook?.external_id || '');
      const event = events.find(e => e.id === id);
      if (!id || !event) throw fail('Het gekoppelde Facebook-evenement is niet gevonden. Vergelijk de bronnen opnieuw.', 409);
      const photo = await downloadFacebookPhoto(event.image);
      if (action === 'facebook-preview') return reply({ preview: { url: event.image, hash: photo.hash, eventId: id }, item, revision: item.updated_at });
      if (!body.hash || body.hash !== photo.hash) throw fail('De Facebookfoto is intussen gewijzigd. Bekijk eerst de nieuwe foto.', 409);
      if (d.event_photo_import?.hash === photo.hash && d.common?.image_url === d.event_photo_import.url) return reply({ item, message: 'Deze foto staat al in Horeca OS. Er is niets op de website gewijzigd.' });
      const path = `${workspaceId}/${businessId}/facebook-event-${itemId}-${randomUUID()}.${photo.ext}`;
      const bucket = client.storage.from('marketing-assets');
      const { error: uploadError } = await bucket.upload(path, photo.bytes, { contentType: photo.mime, upsert: false, cacheControl: '31536000' });
      if (uploadError) throw fail('De foto kon niet in Horeca OS worden opgeslagen.', 502);
      const url = bucket.getPublicUrl(path).data.publicUrl;
      await persist(importedPhotoDistribution(d, { url, path, hash: photo.hash, eventId: id, at: new Date().toISOString() }));
      return reply({ item: current, message: 'Facebookfoto bewaard als hoofdfoto in Horeca OS. De website is nog niet gewijzigd.' });
    }

    if (action === 'website-publish' && body.confirmed !== true) throw fail('Bevestig eerst dat je deze websitefoto wilt vervangen.');
    const id = websitePhotoId(d);
    if (!/^\d+$/.test(id)) throw fail('Koppel eerst het website-evenement.');
    const { data: business } = await client.from('businesses').select('name').eq('workspace_id', workspaceId).eq('id', businessId).maybeSingle();
    if (!/caribbean|plein/i.test(business?.name || '')) throw fail('Geen ondersteunde website voor deze vestiging.', 403);
    const username = process.env.EVENTIN_CARIBBEAN_USERNAME || process.env.EVENTIN_USERNAME;
    const password = process.env.EVENTIN_CARIBBEAN_APPLICATION_PASSWORD || process.env.EVENTIN_APPLICATION_PASSWORD;
    if (!username || !password) throw fail('De beveiligde websitekoppeling ontbreekt.', 503);
    const api = async (path, options = {}) => {
      const response = await fetch(`https://caribbeancorner.nl${path}`, { ...options, headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`, 'Content-Type': 'application/json', ...options.headers }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw fail('De website kon het fotoverzoek niet verwerken. Controleer de websitefoto opnieuw.', 502);
      return response.json();
    };
    const wp = await api(`/wp-json/wp/v2/etn/${id}?context=edit`);
    const raw = await api(`/wp-json/eventin/v2/events/${id}`);
    const event = raw.data?.id ? raw.data : raw.event?.id ? raw.event : raw;
    if (String(wp.id) !== id || String(event.id) !== id) throw fail('Het website-evenement kon niet veilig worden gecontroleerd.', 502);
    const preview = websitePhotoSnapshot(wp, event);
    if (action === 'website-preview') {
      const job = d.event_photo_website;
      if (job && job.targetId === id && ['updating', 'unconfirmed', 'updated'].includes(job.status)) {
        const verified = job.mediaId && preview.mediaId === job.mediaId && preview.bannerId === job.mediaId;
        // Do not release a live reservation while another request is uploading.
        if (verified || job.status === 'updated' || Date.now() - Date.parse(job.started_at) > 120000) await persist({ ...d, event_photo_website: { ...job, status: verified ? 'updated' : 'unconfirmed', checked_at: new Date().toISOString() } });
      }
      return reply({ preview, item: current, revision: current.updated_at });
    }
    if (!body.websiteVersion || body.websiteVersion !== preview.version) throw fail('De website is intussen gewijzigd. Controleer de websitefoto opnieuw.', 409);
    const imported = d.event_photo_import;
    if (!imported?.path || !/^[a-f0-9]{64}$/.test(imported.hash || '') || imported.url !== d.common?.image_url || !imported.path.startsWith(`${workspaceId}/${businessId}/facebook-event-${itemId}-`) || imported.path.includes('..')) throw fail('Bewaar eerst de gekozen Facebookfoto in Horeca OS.');
    const { data: blob, error: downloadError } = await client.storage.from('marketing-assets').download(imported.path);
    if (downloadError || !blob || blob.size > 10 * 1024 * 1024) throw fail('De opgeslagen foto kon niet worden gelezen.', 502);
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (photoHash(bytes) !== imported.hash) throw fail('De opgeslagen foto is gewijzigd. Neem de Facebookfoto opnieuw over.', 409);
    const old = d.event_photo_website;
    let mediaId = old?.hash === imported.hash && old.targetId === id ? old.mediaId : null;
    const job = { status: 'updating', operation_id: randomUUID(), started_at: new Date().toISOString(), hash: imported.hash, targetId: id, mediaId, previous: preview };
    await persist({ ...d, event_photo_website: job }); reserved = true;
    if (!mediaId) {
      const ext = imported.path.split('.').pop();
      const media = await api('/wp-json/wp/v2/media', { method: 'POST', headers: { 'Content-Type': blob.type, 'Content-Disposition': `attachment; filename="horeca-event-${itemId}-${imported.hash.slice(0,16)}.${ext}"` }, body: bytes });
      mediaId = Number(media.id);
      if (!Number.isSafeInteger(mediaId) || mediaId <= 0) throw fail('De website gaf geen geldige foto terug.', 502);
      job.mediaId = mediaId;
      await persist({ ...photoDistribution(current), event_photo_website: { ...job } });
    }
    // Recheck after upload; a concurrent website edit must not be overwritten.
    const freshWp = await api(`/wp-json/wp/v2/etn/${id}?context=edit`), freshRaw = await api(`/wp-json/eventin/v2/events/${id}`);
    const freshEvent = freshRaw.data?.id ? freshRaw.data : freshRaw.event?.id ? freshRaw.event : freshRaw;
    if (websitePhotoSnapshot(freshWp, freshEvent).version !== preview.version) throw fail('De website is tijdens het klaarzetten gewijzigd. Controleer de foto opnieuw.', 409);
    await publishWebsitePhoto({ api, eventId: id, mediaId });
    await persist({ ...photoDistribution(current), event_photo_website: { ...job, status: 'updated', checked_at: new Date().toISOString() } });
    reserved = false;
    return reply({ item: current, message: 'Websitefoto vervangen en gecontroleerd. Titel, tekst, datums en tickets zijn niet gewijzigd.' });
  } catch (error) {
    if (reserved && persist) {
      // The external write may have succeeded. Never claim a rollback.
      // A fresh preview can reconcile a timeout without publishing again.
      return reply({ error: 'De foto-update is nog niet bevestigd. Controleer de websitefoto opnieuw. Er is niets teruggedraaid.' }, 502);
    }
    return reply({ error: error.status ? error.message : 'De foto kon niet worden verwerkt. Probeer opnieuw of controleer de koppeling.' }, error.status || 502);
  }
}

import { createHash } from 'node:crypto';

export const photoHash = value => createHash('sha256').update(value).digest('hex');
export const photoDistribution = item => (item?.media || []).find(m => m?.kind === 'campaign_distribution') || {};
export const websitePhotoId = d => String(d.eventin_event_id || d.external_ids?.eventin || '');

export function facebookPhotoUrl(value) {
  let u;
  try { u = new URL(value); } catch { throw new Error('Facebook geeft geen bruikbare evenementfoto terug.'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port ||
      !['fbcdn.net', 'fbsbx.com'].some(host => u.hostname === host || u.hostname.endsWith(`.${host}`))) {
    throw new Error('De Facebookfoto komt niet van een toegestane fotobron.');
  }
  return u.href;
}

// Never fetch user-supplied URLs, follow redirects, or buffer an unlimited response.
export async function downloadFacebookPhoto(url, fetcher = fetch) {
  const response = await fetcher(facebookPhotoUrl(url), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
  const limit = 10 * 1024 * 1024;
  const mime = (response.headers.get('content-type') || '').split(';')[0];
  if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(mime) || Number(response.headers.get('content-length')) > limit || !response.body) {
    throw new Error('De Facebookfoto kon niet veilig worden geladen (JPG, PNG of WebP, maximaal 10 MB).');
  }
  const reader = response.body.getReader(), parts = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) throw new Error('De Facebookfoto is groter dan 10 MB.');
      parts.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(parts);
  const ext = mime === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'jpg'
    : mime === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
    : mime === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : '';
  if (!ext) throw new Error('De bron bevat geen geldige ondersteunde foto.');
  return { bytes, mime, ext, hash: photoHash(bytes) };
}

export function importedPhotoDistribution(d, { url, hash, path, eventId, at }) {
  return { ...d, common: { ...d.common, image_url: url },
    event_photo_import: { url, hash, path, facebook_event_id: eventId, imported_at: at, previous_url: d.common?.image_url || '' },
    ...(d.series ? { series: { ...d.series, exception: true } } : {}) };
}

// Version the remote photo, not unrelated counters. No text/date/ticket writes.
export function websitePhotoSnapshot(wp, event) {
  const banner = typeof event.event_banner === 'string' ? event.event_banner : event.event_banner?.url || '';
  const mediaId = Number(wp.featured_media || 0), bannerId = Number(event.event_banner_id || 0);
  return { id: String(wp.id), mediaId, bannerId, bannerUrl: banner, bannerMismatch: Boolean(bannerId && bannerId !== mediaId), url: mediaId && bannerId === mediaId ? banner : '',
    version: photoHash(JSON.stringify([wp.id, wp.featured_media, event.event_banner_id, banner, wp.modified_gmt])) };
}

// Resolve the featured attachment, not Eventin's independently stored banner.
// Never fall back to an old banner when the featured attachment cannot be read.
export async function websitePhotoPreview(api, wp, event) {
  const preview = websitePhotoSnapshot(wp, event);
  if (preview.mediaId) {
    const media = await api(`/wp-json/wp/v2/media/${preview.mediaId}`);
    if (Number(media.id) !== preview.mediaId || !/^https:\/\//i.test(media.source_url || '')) {
      throw new Error('De hoofdfoto kon niet betrouwbaar worden opgehaald.');
    }
    preview.url = media.source_url;
  }
  return preview;
}

export async function publishWebsitePhoto({ api, eventId, mediaId }) {
  // Eventin can keep a separate banner reference. Verify the field we actually
  // change; report a banner difference separately, without rewriting the event.
  await api(`/wp-json/wp/v2/etn/${eventId}`, { method: 'POST', body: JSON.stringify({ featured_media: mediaId }) });
  const wp = await api(`/wp-json/wp/v2/etn/${eventId}?context=edit`);
  const raw = await api(`/wp-json/eventin/v2/events/${eventId}`);
  const event = raw.data?.id ? raw.data : raw.event?.id ? raw.event : raw;
  if (String(wp.id) !== eventId || String(event.id) !== eventId || Number(wp.featured_media) !== mediaId) {
    throw new Error('De websitefoto is verstuurd, maar de controle is niet geslaagd. Controleer de websitefoto opnieuw; de tekst is niet gewijzigd.');
  }
  return websitePhotoSnapshot(wp, event);
}

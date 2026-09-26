import { calendarLocalTime, calendarDistribution } from './event-calendar';
import { prepareContent, saveEventContent } from './manual-event-content';

export const imageRoles = { image_url: 'Hoofdfoto', portrait: 'Staande foto', square: 'Vierkante foto', vertical: 'Story / Reel-foto', landscape: 'Liggende foto' };
export function safeEventUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function eventEditorDraft(item) {
  const c = calendarDistribution(item).common || {};
  return { title: c.title || '', description: c.description ?? c.short_description ?? item?.body ?? '',
    start: calendarLocalTime(c.start), end: calendarLocalTime(c.end), location: c.location || '',
    image_url: c.image_url || '', ...Object.fromEntries(Object.keys(imageRoles).filter(k => k !== 'image_url').map(k => [k, typeof c.images?.[k] === 'string' ? c.images[k] : c.images?.[k]?.url || ''])) };
}
export function editorDifferences(left, right) {
  return Object.keys(left).filter(k => left[k] !== right[k]);
}
export function prepareEventEdit(item, input, at) {
  const d = calendarDistribution(item), before = eventEditorDraft(item), values = {};
  for (const [key, max] of Object.entries({ title: 300, description: 30000, location: 1000, start: 16, end: 16, ...Object.fromEntries(Object.keys(imageRoles).map(k => [k, 4000])) })) {
    if (typeof input?.[key] !== 'string' || input[key].length > max) throw new Error('Controleer de ingevulde evenementgegevens.');
    values[key] = input[key].trim();
  }
  if (!values.title) throw new Error('Vul een titel in.');
  for (const key of ['start', 'end']) {
    const v = values[key];
    // Existing date-only events remain date-only until the user supplies a time.
    if (v && (!/^\d{4}-\d\d-\d\d(?:T([01]\d|2[0-3]):[0-5]\d)?$/.test(v) || !Number.isFinite(Date.parse(v + (v.length === 10 ? 'T00:00:00Z' : ':00Z'))) || new Date(v + (v.length === 10 ? 'T00:00:00Z' : ':00Z')).toISOString().slice(0,v.length) !== v)) throw new Error('Vul een geldige datum en tijd in.');
  }
  if (!values.start || (values.end && values.end <= values.start)) throw new Error('Vul een begindatum in en laat het einde na het begin vallen.');
  for (const key of Object.keys(imageRoles)) if (values[key] && !safeEventUrl(values[key])) throw new Error('Gebruik voor foto’s een geldige https-link.');
  const changed = editorDifferences(before, values);
  if (!changed.length) return d;
  const common = { ...d.common };
  for (const key of changed) {
    if (Object.hasOwn(imageRoles, key) && key !== 'image_url') common.images = { ...common.images, [key]: values[key] };
    else common[key] = values[key];
  }
  const next = prepareContent(d, { title: common.title, description: common.description ?? before.description }, at);
  return { ...next, common, base_edit: { at, fields: changed },
    ...(d.calendar_channel && changed.some(k => ['title','description','start','end','location'].includes(k)) ? { calendar_channel: { ...d.calendar_channel, status: 'needs_check' } } : {}),
    ...(d.series ? { series: { ...d.series, exception: true, modified_at: at } } : {}) };
}
export async function saveEventEdit(client, workspaceId, item, draft, at = new Date().toISOString()) {
  const next = prepareEventEdit(item, draft, at);
  return saveEventContent(client, workspaceId, item, next, next.common.description ?? item.body ?? '');
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import ManualFacebookUpdate from "./manual-facebook-update";
import { withRequestTimeout } from "../lib/request-timeout";
import { confirmFacebookContent, contentDeliveryStatus, contentSnapshot, eventContent, facebookEventId, prepareContent, saveEventContent, withVerifiedFacebookEvent } from "../lib/manual-event-content";

const typeLabels = { event: "Evenement", product: "Gerecht of product", offer: "Aanbieding", package: "Arrangement", review: "Review", custom: "Campagne", website_event: "Evenement" };
const viewLabels = { day: "Dag", week: "Week", month: "Maand", year: "Jaar" };
function distributionFor(item) { return (item?.media || []).find((entry) => entry?.kind === "campaign_distribution") || {}; }
function itemStart(item) { const distribution = distributionFor(item); return distribution.common?.start || distribution.source_preview?.startDate || item.scheduled_for || item.created_at; }
function statusFor(item, distribution) {
  if (["cancelled", "trash"].includes(distribution.website_event_status)) return { key: "cancelled", label: "Geannuleerd" };
  if (distribution.provider_delivery?.facebook?.status === "confirmed" || distribution.facebook_event_delivery?.status === "confirmed" || distribution.provider_delivery?.brevo?.status === "confirmed" || item.published_at) return { key: "published", label: "Geplaatst" };
  if (item.scheduled_for) return { key: "scheduled", label: "Ingepland" };
  if (item.workflow_status === "in_progress") return { key: "approved", label: "Goedgekeurd" };
  return { key: "draft", label: "Concept" };
}
function channelStatus(item, channel) {
  const distribution = distributionFor(item); const targetChannels = distribution.target_channels || [];
  if (["facebook", "website"].includes(channel) && distribution.event_content_delivery?.[channel]) {
    const delivery = contentDeliveryStatus(distribution, channel);
    return { key: ["manual_confirmed", "updated"].includes(delivery.key) ? "placed" : delivery.key === "failed" ? "error" : "warning", label: delivery.label };
  }
  const verified = distribution.verification?.channels?.[channel];
  if (verified?.status === "reachable") return { key: "placed", label: verified.label || (channel === "website" ? "Eventin gecontroleerd" : channel === "facebook" ? "Facebook gecontroleerd" : "Live gecontroleerd") };
  if (verified?.status === "unreachable") return { key: "error", label: verified.label || (channel === "website" ? "Eventin controle mislukt" : channel === "facebook" ? "Facebook controle mislukt" : "Controle mislukt") };
  if (verified?.status === "missing") return { key: "warning", label: verified.label || "Niet gecontroleerd: link ontbreekt" };
  if (channel === "website") {
    if (distribution.website_event_status === "publish" && (distribution.source_type === "website_event" || distribution.eventin_event_id)) return { key: "placed", label: "Geplaatst" };
    return { key: distribution.source_type === "website_event" ? "concept" : "not_active", label: distribution.source_type === "website_event" ? "Concept" : "Niet actief" };
  }
  if (!targetChannels.includes(channel)) return { key: "not_active", label: "Niet actief" };
  const delivery = distribution.provider_delivery?.[channel] || {};
  if (["failed", "error"].includes(delivery.status) || distribution.channel_status?.[channel] === "error") return { key: "error", label: "Fout" };
  if (["confirmed", "published", "placed"].includes(delivery.status)) return { key: "placed", label: "Geplaatst" };
  if (["scheduled", "in_progress"].includes(delivery.status)) return { key: "scheduled", label: "Gepland" };
  if (distribution.channel_status?.[channel] === "extra_gegevens_nodig") return { key: "warning", label: "Gegevens nodig" };
  return { key: "concept", label: "Concept" };
}
const channelLabels = { website: "Website", facebook: "Facebook", instagram: "Instagram", google: "Google", other: "Overige" };
function dateOnly(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function sameDay(left, right) { return left && right && left.toDateString() === right.toDateString(); }
function todayStart() { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
function isToday(date) { return sameDay(date, todayStart()); }
function startOfWeek(date) { const result = new Date(date); const day = result.getDay(); result.setDate(result.getDate() - (day === 0 ? 6 : day - 1)); result.setHours(0, 0, 0, 0); return result; }
function formatDate(value, options = { day: "numeric", month: "long", year: "numeric" }) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Datum onbekend" : new Intl.DateTimeFormat("nl-NL", options).format(date); }
function eventText(item) { const distribution = distributionFor(item); return distribution.common?.title || "Zonder titel"; }
function descriptionFor(item) {
  const distribution = distributionFor(item);
  const value = distribution.common?.description || distribution.common?.short_description || item?.body || "";
  return String(value).replace(/\s*\{\s*["']@context[\s\S]*$/i, "").trim() || "Geen omschrijving";
}
function isExternalEvent(item) { const distribution = distributionFor(item); return (["facebook_event", "eventin_event", "external_event"].includes(distribution.source_type) || distribution.external_sources?.length > 0) && !distribution.linked_to_horeca_os; }
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length); let nextIndex = 0;
  async function run() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function facebookCalendarItem(event, business) {
  const checkedAt = new Date().toISOString();
  return {
    id: `facebook-event:${business.id}:${event.id}`,
    business_id: business.id,
    status: "published",
    workflow_status: "published",
    scheduled_for: event.startDate,
    published_at: event.startDate,
    created_at: event.startDate || checkedAt,
    media: [{
      kind: "campaign_distribution",
      source_type: "facebook_event",
      external_source: "facebook",
      external_id: String(event.id),
      linked_to_horeca_os: false,
      common: { title: event.title, start: event.startDate, end: event.endDate, location: event.location, description: event.description },
      target_channels: ["facebook"],
      provider_delivery: { facebook: { status: "confirmed", external_id: event.id, permalink: event.sourceUrl } },
      verification: { checked_at: checkedAt, checked_by: "facebook-events-sync", channels: { facebook: { status: "reachable", label: "Facebook-evenement gevonden" } }, links: { facebook: event.sourceUrl } },
    }],
  };
}

function eventinCalendarItem(event, business) {
  const checkedAt = new Date().toISOString();
  const start = event.start || event.startDate;
  const end = event.end || event.endDate || "";
  return {
    id: `eventin-event:${business.id}:${event.id}`,
    business_id: business.id,
    status: "published",
    workflow_status: "published",
    scheduled_for: start,
    published_at: start,
    created_at: start || checkedAt,
    media: [{
      kind: "campaign_distribution",
      source_type: "eventin_event",
      external_source: "eventin",
      external_id: String(event.id),
      linked_to_horeca_os: false,
      source_url: event.url || "",
      common: { title: event.title, start, end, location: event.location, description: event.description, website_url: event.url || "" },
      target_channels: ["website"],
      verification: { checked_at: checkedAt, checked_by: "eventin-events-sync", channels: { website: { status: "reachable", label: "Eventin-evenement gevonden" } }, links: { website: event.url || "" } },
    }],
  };
}

async function loadFacebookItems({ workspaceId, businesses, token, campaigns }) {
  const knownIds = new Set(campaigns.flatMap((item) => {
    const distribution = distributionFor(item);
    return [distribution.facebook_event_delivery?.external_id, distribution.provider_delivery?.facebook?.external_id].filter(Boolean).map(String);
  }));
  const responses = await Promise.all((businesses || []).map(async (business) => {
    try {
      const response = await fetch(`/api/integrations/facebook/events?workspaceId=${encodeURIComponent(workspaceId)}&businessId=${encodeURIComponent(business.id)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return [];
      const payload = await response.json();
      return (payload.events || []).filter((event) => !knownIds.has(String(event.id))).map((event) => facebookCalendarItem(event, business));
    } catch { return []; }
  }));
  return responses.flat();
}

function siteForBusiness(business) {
  return String(business?.name || "").toLowerCase().includes("plein") ? "grandcafehetplein.com" : "caribbeancorner.nl";
}

async function loadEventinItems({ workspaceId, businesses, token, campaigns }) {
  const knownIds = new Set(campaigns.flatMap((item) => {
    const distribution = distributionFor(item);
    return [distribution.eventin_event_id, distribution.external_id].filter(Boolean).map(String);
  }));
  const responses = await Promise.all((businesses || []).map(async (business) => {
    try {
      const site = siteForBusiness(business);
      const endpoint = `/api/marketing/website-events?site=${encodeURIComponent(site)}`;
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return [];
      const payload = await response.json();
      return (payload.events || []).filter((event) => event.id && !event.expired && !knownIds.has(String(event.id))).map((event) => eventinCalendarItem(event, business));
    } catch { return []; }
  }));
  return responses.flat();
}

function deduplicateCalendarItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function duplicateRootId(item, items) {
  let current = item; const visited = new Set();
  while (distributionFor(current).duplicate_of && !visited.has(current.id)) {
    visited.add(current.id);
    const next = items.find((candidate) => String(candidate.id) === String(distributionFor(current).duplicate_of));
    if (!next) return item.id;
    current = next;
  }
  return current.id;
}

function visibleCalendarItems(items, businessById, activeFromToday) {
  const candidates = items.filter((item) => businessById.has(String(item.business_id)) && (dateOnly(itemStart(item)) || activeFromToday) >= activeFromToday);
  const grouped = new Map();
  candidates.forEach((item) => {
    const rootId = duplicateRootId(item, items); const current = grouped.get(String(rootId));
    if (!current || statusRank(item) > statusRank(current)) grouped.set(String(rootId), item);
  });
  return [...grouped.values()];
}

function suggestPotentialMatches(items) {
  return items.map((item) => {
    const match = items.find((candidate) => candidate.id !== item.id
      && !isExternalEvent(candidate)
      && !distributionFor(candidate).duplicate_of
      && String(candidate.business_id) === String(item.business_id)
      && dateOnly(itemStart(candidate))?.toDateString() === dateOnly(itemStart(item))?.toDateString()
      && externalTitlesMatch(eventText(candidate), eventText(item)));
    return match ? { ...item, potentialMatch: { id: match.id, title: eventText(match), status: statusFor(match, distributionFor(match)).label, external: isExternalEvent(match) } } : item;
  });
}

function normalizeEventTitle(value) { return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
function externalTitlesMatch(left, right) {
  const meaningful = (word) => word.length > 2 && !/^\d+$/.test(word);
  const a = new Set(normalizeEventTitle(left).split(" ").filter(meaningful));
  const b = new Set(normalizeEventTitle(right).split(" ").filter(meaningful));
  if (!a.size || !b.size) return false;
  const overlap = [...a].filter((word) => b.has(word)).length;
  return overlap >= 2 && overlap / Math.min(a.size, b.size) >= 0.6;
}

function mergeExternalSourceItems(items) {
  const result = [];
  for (const item of items) {
    const distribution = distributionFor(item);
    if (!isExternalEvent(item)) { result.push(item); continue; }
    const match = result.find((candidate) => {
      if (!isExternalEvent(candidate) || String(candidate.business_id) !== String(item.business_id)) return false;
      return dateOnly(itemStart(candidate))?.toDateString() === dateOnly(itemStart(item))?.toDateString()
        && externalTitlesMatch(eventText(candidate), eventText(item));
    });
    if (!match) { result.push(item); continue; }
    const current = distributionFor(match);
    const sources = [...new Set([...(current.external_sources || [current.external_source]), ...(distribution.external_sources || [distribution.external_source])].filter(Boolean))];
    const externalIds = { ...(current.external_ids || {}), ...(distribution.external_ids || {}) };
    if (distribution.external_source && distribution.external_id) externalIds[distribution.external_source] = String(distribution.external_id);
    if (current.external_source && current.external_id) externalIds[current.external_source] = String(current.external_id);
    const merged = { ...current, ...distribution, source_type: "external_event", external_source: "multiple", external_sources: sources, external_ids: externalIds, external_id: externalIds.eventin || externalIds.facebook, target_channels: [...new Set([...(current.target_channels || []), ...(distribution.target_channels || [])])], provider_delivery: { ...(current.provider_delivery || {}), ...(distribution.provider_delivery || {}) }, verification: { ...(current.verification || {}), ...(distribution.verification || {}) }, common: { ...(current.common || {}), ...(distribution.common || {}) } };
    match.media = (match.media || []).map((entry) => entry?.kind === "campaign_distribution" ? merged : entry);
  }
  return result;
}

function mergeExternalWithManagedItems(items) {
  const result = [];
  for (const item of items) {
    if (!isExternalEvent(item)) { result.push(item); continue; }
    const managed = result.find((candidate) => !isExternalEvent(candidate)
      && String(candidate.business_id) === String(item.business_id)
      && dateOnly(itemStart(candidate))?.toDateString() === dateOnly(itemStart(item))?.toDateString()
      && externalTitlesMatch(eventText(candidate), eventText(item)));
    if (!managed) { result.push(item); continue; }
    const managedDistribution = distributionFor(managed);
    const externalDistribution = distributionFor(item);
    const sources = [...new Set([...(managedDistribution.external_sources || []), ...(externalDistribution.external_sources || [externalDistribution.external_source])].filter(Boolean))];
    const externalIds = { ...(managedDistribution.external_ids || {}), ...(externalDistribution.external_ids || {}) };
    if (externalDistribution.external_source && externalDistribution.external_id) externalIds[externalDistribution.external_source] = String(externalDistribution.external_id);
    const merged = { ...managedDistribution, external_sources: sources, external_ids: externalIds, linked_to_horeca_os: true, target_channels: [...new Set([...(managedDistribution.target_channels || []), ...(externalDistribution.target_channels || [])])], provider_delivery: { ...(managedDistribution.provider_delivery || {}), ...(externalDistribution.provider_delivery || {}) }, verification: { ...(managedDistribution.verification || {}), ...(externalDistribution.verification || {}) } };
    managed.media = (managed.media || []).map((entry) => entry?.kind === "campaign_distribution" ? merged : entry);
  }
  return result;
}

function statusRank(item) { const status = statusFor(item, distributionFor(item)).key; return { published: 4, scheduled: 3, approved: 2, draft: 1 }[status] || 0; }
function mergeSimilarManagedItems(items) {
  const result = [];
  for (const item of items) {
    if (isExternalEvent(item)) { result.push(item); continue; }
    const index = result.findIndex((candidate) => !isExternalEvent(candidate)
      && String(candidate.business_id) === String(item.business_id)
      && dateOnly(itemStart(candidate))?.toDateString() === dateOnly(itemStart(item))?.toDateString()
      && externalTitlesMatch(eventText(candidate), eventText(item)));
    if (index < 0) { result.push(item); continue; }
    const candidate = result[index];
    const preferred = statusRank(item) > statusRank(candidate) ? item : candidate;
    const other = preferred.id === item.id ? candidate : item;
    const preferredDistribution = distributionFor(preferred);
    const otherDistribution = distributionFor(other);
    const mergedDistribution = { ...preferredDistribution, external_sources: [...new Set([...(preferredDistribution.external_sources || []), ...(otherDistribution.external_sources || [])])], external_ids: { ...(otherDistribution.external_ids || {}), ...(preferredDistribution.external_ids || {}) }, provider_delivery: { ...(otherDistribution.provider_delivery || {}), ...(preferredDistribution.provider_delivery || {}) }, verification: { ...(otherDistribution.verification || {}), ...(preferredDistribution.verification || {}) }, target_channels: [...new Set([...(preferredDistribution.target_channels || []), ...(otherDistribution.target_channels || [])])] };
    result[index] = { ...preferred, media: (preferred.media || []).map((entry) => entry?.kind === "campaign_distribution" ? mergedDistribution : entry) };
  }
  return result;
}

function CalendarEvent({ item, business, onSelectEvent }) {
  const distribution = distributionFor(item); const status = statusFor(item, distribution); const external = isExternalEvent(item); const externalLabel = distribution.external_source === "multiple" ? "Extern Eventin + Facebook" : distribution.external_source === "eventin" ? "Extern Eventin-evenement" : "Extern Facebook-event";
  return <button type="button" className={`marketingCalendarEvent ${business?.color || "venueA"} ${external ? "externalFacebookEvent" : ""}`} onClick={() => onSelectEvent(item)} title={`${eventText(item)} · ${external ? externalLabel : status.label}`}><strong>{eventText(item)}</strong><span>{external ? externalLabel : status.label}</span><div className="marketingChannelMini">{["website", "facebook", "instagram", "google"].map((channel) => { const channelState = channelStatus(item, channel); return <i className={channelState.key} key={channel} title={`${channelLabels[channel]}: ${channelState.label}`}>{channel === "website" ? "W" : channel === "facebook" ? "F" : channel === "instagram" ? "I" : "G"}</i>; })}</div></button>;
}

function ComparisonCard({ label, item, onChoose, selected = false, disabled = false }) {
  const distribution = distributionFor(item);
  const description = descriptionFor(item);
  return <div className="marketingComparisonCard"><p className="eyebrow">{label}</p>{onChoose && <button type="button" className={selected ? "primaryButton" : "secondaryButton"} aria-label={`Tekst van ${label} gebruiken`} aria-pressed={selected} disabled={disabled} onClick={onChoose}>{selected ? "Deze tekst is gekozen" : "Deze tekst gebruiken"}</button>}<div className="marketingComparisonTitle"><span>Titel</span><strong>{eventText(item)}</strong></div><dl><div><dt>Datum</dt><dd>{formatDate(itemStart(item), { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</dd></div><div><dt>Locatie</dt><dd>{distribution.common?.location || "Geen locatie"}</dd></div><div><dt>Status</dt><dd>{statusFor(item, distribution).label}</dd></div></dl><div className="marketingComparisonDescription"><span>Tekst</span><p>{description}</p></div></div>;
}

function comparisonDifference(items) {
  if (!items?.length || items.length < 2) return "";
  const records = items.map((entry) => entry?.item || entry).filter(Boolean);
  const titles = new Set(records.map((entry) => eventText(entry).trim()));
  const descriptions = new Set(records.map((entry) => descriptionFor(entry).trim()));
  const titleDifferent = titles.size > 1;
  const descriptionDifferent = descriptions.size > 1;
  if (!titleDifferent && !descriptionDifferent) return "Titel en tekst zijn gelijk.";
  return [titleDifferent ? "De titels verschillen" : "De titels zijn gelijk", descriptionDifferent ? "de omschrijvingen verschillen" : "de omschrijvingen zijn gelijk"].join("; ") + ".";
}

export function sourceComparisonStatus(item, sources = [], check = "idle") {
  const distribution = distributionFor(item);
  const expected = [];
  if (distribution.eventin_event_id || distribution.external_ids?.eventin) expected.push("Eventin");
  if (facebookEventId(distribution) || distribution.provider_delivery?.facebook?.external_id) expected.push("Facebook");
  if (check === "pending") return { key: "pending", title: "Controle op verschillen loopt…", detail: "Je hoeft niets te doen. De bewerkpanelen blijven gesloten." };
  if (check === "queued") return { key: "queued", title: "Controle staat klaar", detail: "Dit evenement wacht op de automatische controle." };
  if (check === "timeout") return { key: "incomplete", title: "Controle duurt te lang", detail: "Een bron reageerde niet binnen 30 seconden. Er is niets gewijzigd. Je kunt de controle opnieuw proberen." };
  if (check === "error") return { key: "incomplete", title: "Controle niet afgerond", detail: "De bronnen konden niet volledig worden opgehaald. Probeer opnieuw via ‘Bronnen vergelijken en tekst kiezen’." };
  if (!expected.length) return { key: "unlinked", title: "Geen gekoppelde bronnen om te vergelijken", detail: "Er kan nog niet worden vastgesteld of de externe teksten overeenkomen." };
  const remote = sources.filter(source => expected.includes(source.label));
  const missing = expected.filter(label => !remote.some(source => source.label === label));
  if (check !== "done" || missing.length) return { key: "incomplete", title: "Controle niet afgerond", detail: missing.length ? `Nog niet vergeleken: ${missing.join(" en ")}. Open ‘Bronnen vergelijken en tekst kiezen’ voor een nieuwe controle.` : "De automatische controle is nog niet afgerond." };
  // Compare against the CURRENT saved record, not the older local copy returned by a background check.
  const difference = comparisonDifference([{ label: "Horeca OS", item }, ...remote]);
  return difference === "Titel en tekst zijn gelijk."
    ? { key: "equal", title: "Titel en tekst zijn gelijk", detail: "Geen tekstwijziging nodig voor de gekoppelde website- en/of Facebook-bronnen." }
    : { key: "different", title: "Verschillen gevonden", detail: `${difference} Bekijk eerst de bronnen en kies daarna zelf wat je wilt bijwerken.` };
}

function MonthCalendar({ anchor, items, businessById, onSelectEvent }) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1); const gridStart = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, index) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index));
  return <div className="marketingMonthCalendar"><div className="marketingWeekdayRow">{["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"].map((day) => <strong key={day}>{day}</strong>)}</div><div className="marketingMonthGrid">{days.map((day) => { const dayItems = items.filter((item) => sameDay(dateOnly(itemStart(item)), day)); return <div className={`marketingDayCell ${day.getMonth() !== anchor.getMonth() ? "outside" : ""} ${isToday(day) ? "today" : ""}`} key={day.toISOString()}><strong>{isToday(day) ? "Vandaag · " : ""}{day.getDate()}</strong><div>{dayItems.map((item) => <CalendarEvent key={item.id} item={item} business={businessById.get(String(item.business_id))} onSelectEvent={onSelectEvent} />)}</div></div>; })}</div></div>;
}

function WeekCalendar({ anchor, items, businessById, onSelectEvent }) {
  const first = startOfWeek(anchor); const days = Array.from({ length: 7 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index));
  return <div className="marketingWeekCalendar"><div className="marketingWeekHeader">{days.map((day) => <strong className={isToday(day) ? "today" : ""} key={day.toISOString()}>{isToday(day) ? "Vandaag · " : ""}{formatDate(day, { weekday: "short", day: "numeric", month: "short" })}</strong>)}</div><div className="marketingWeekColumns">{days.map((day) => { const dayItems = items.filter((item) => sameDay(dateOnly(itemStart(item)), day)); return <div className={`marketingWeekColumn ${isToday(day) ? "today" : ""}`} key={day.toISOString()}>{dayItems.map((item) => <CalendarEvent key={item.id} item={item} business={businessById.get(String(item.business_id))} onSelectEvent={onSelectEvent} />)}{!dayItems.length && <span className="marketingCalendarEmpty">Geen afspraken</span>}</div>; })}</div></div>;
}

function YearCalendar({ anchor, items, onSelectEvent }) {
  return <div className="marketingYearGrid">{Array.from({ length: 12 }, (_, month) => { const monthDate = new Date(anchor.getFullYear(), month, 1); const current = monthDate.getMonth() === todayStart().getMonth() && monthDate.getFullYear() === todayStart().getFullYear(); const gridStart = startOfWeek(monthDate); const days = Array.from({ length: 42 }, (_, index) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index)); const monthItems = items.filter((item) => { const date = dateOnly(itemStart(item)); return date?.getFullYear() === anchor.getFullYear() && date.getMonth() === month; }); return <article className={`marketingMiniMonth ${current ? "currentMonth" : ""}`} key={month}><h4>{current ? "Deze maand · " : ""}{formatDate(monthDate, { month: "long" })}</h4><div className="marketingMiniWeekdays">{["M", "D", "W", "D", "V", "Z", "Z"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div><div className="marketingMiniDays">{days.map((day) => { const dayItems = monthItems.filter((item) => sameDay(dateOnly(itemStart(item)), day)); return <button type="button" className={`${day.getMonth() !== month ? "outside" : ""} ${dayItems.length ? "hasEvent" : ""} ${isToday(day) ? "today" : ""}`} onClick={() => dayItems[0] && onSelectEvent(dayItems[0])} title={dayItems.map(eventText).join(", ")} key={day.toISOString()}>{isToday(day) ? "Vandaag" : day.getDate()}</button>; })}</div><small>{monthItems.length} {monthItems.length === 1 ? "resterend item" : "resterende items"}</small></article>; })}</div>;
}

export function EventDetails({ item, matchItem, sameDayItems = [], sourceComparisonItems = [], sourceComparisonCheck = "idle", business, onClose, onLink, onLinkExisting, onChooseMatch, onSyncContent, onUpdateWebsite, facebookLinkCheck, onConfirmFacebook, onCompareSources, comparing, linking, syncError }) {
  const distribution = withVerifiedFacebookEvent(distributionFor(item), sourceComparisonItems); const status = statusFor(item, distribution); const external = isExternalEvent(item); const externalLabel = distribution.external_source === "multiple" ? "Extern Eventin + Facebook" : distribution.external_source === "eventin" ? "Extern Eventin-evenement" : "Extern Facebook-event"; const start = itemStart(item); const end = distribution.common?.end;
  const checkedAt = distribution.verification?.checked_at;
  const matchDistribution = distributionFor(matchItem); const selectedDescription = descriptionFor(item);
  const matchDescription = descriptionFor(matchItem);
  const [mergeTitle, setMergeTitle] = useState(eventText(item)); const [mergeDescription, setMergeDescription] = useState(selectedDescription);
  useEffect(() => { setMergeTitle(eventText(item)); setMergeDescription(selectedDescription); }, [item.id, matchItem?.id]);
  const [chosenContent, setChosenContent] = useState(null);
  useEffect(() => { setChosenContent(null); }, [item.id]);
  const canChoose = !external && Boolean(onSyncContent);
  const savedContent = eventContent(distribution);
  const contentDirty = Boolean(chosenContent && (chosenContent.title !== savedContent.title || chosenContent.description !== savedContent.description));
  const sources = [{ label: "Horeca OS", item }, ...sourceComparisonItems.filter(source => source.label !== "Horeca OS")];
  const comparisonState = sourceComparisonStatus(item, sources, comparing ? "pending" : sourceComparisonCheck);
  function chooseSource(source) {
    const common = distributionFor(source.item).common || {};
    const description = String(common.description ?? common.short_description ?? source.item.body ?? "").replace(/\s*\{\s*["']@context[\s\S]*$/i, "").trim();
    setChosenContent({ label: source.label, title: eventText(source.item), description });
  }
  function useContent(title, description) { setMergeTitle(title); setMergeDescription(description); }
  return <div className="marketingEventModalBackdrop" role="dialog" aria-modal="true" aria-label={`Details van ${eventText(item)}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><article className={`marketingEventDetails ${external ? "externalFacebookDetails" : ""}`} onMouseDown={(event) => event.stopPropagation()}>{(linking || comparing) && <div className="marketingLinkingNotice" role="status" aria-live="polite"><span className="marketingLoadingSpinner" aria-hidden="true" />{comparing ? "Even geduld… Eventin en Facebook worden naast elkaar gelegd." : "Even geduld… het evenement wordt gekoppeld en de agenda wordt bijgewerkt."}</div>}<div className="marketingEventHeading"><div><p className="eyebrow">EVENEMENTDETAILS</p><h3>{eventText(item)}</h3><p aria-label="Evenementdatum"><strong>{formatDate(start, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong></p><p>{business?.name || "Onbekende vestiging"} · <span className={`marketingDetailStatus ${status.key}`}>{status.label}</span>{external && <span className="marketingExternalBadge">{externalLabel}</span>}</p></div><div className="marketingDetailActions">{external && <button type="button" className="primaryButton" onClick={onLink} disabled={linking || comparing}>{linking ? "Even geduld… koppeling wordt verwerkt" : "Als nieuw evenement toevoegen"}</button>}{item.potentialMatch && <div className="marketingMatchSuggestion"><strong>Voorstel op basis van datum, vestiging en titel</strong><span>Controleer hieronder eerst welke titel en tekst je wilt behouden.</span></div>}{matchItem && <section className="marketingMergeContent"><strong>Welke tekst moet worden behouden?</strong><div><button type="button" className="secondaryButton" onClick={() => useContent(eventText(item), selectedDescription)}>Geselecteerd record</button><button type="button" className="secondaryButton" onClick={() => useContent(eventText(matchItem), matchDescription)}>Bestaand record</button><button type="button" className="secondaryButton" onClick={() => useContent(`${eventText(item)} / ${eventText(matchItem)}`, `${selectedDescription}\n\n${matchDescription}`)}>Teksten samenvoegen</button></div><label>Titel<input value={mergeTitle} onChange={(event) => setMergeTitle(event.target.value)} /></label><label>Omschrijving<textarea value={mergeDescription} onChange={(event) => setMergeDescription(event.target.value)} /></label><button type="button" className="primaryButton" onClick={() => onLinkExisting({ title: mergeTitle, description: mergeDescription })} disabled={linking}>{linking ? "Even geduld… koppeling wordt verwerkt" : "Samenvoegen met deze tekst"}</button></section>}<button type="button" className="secondaryButton" onClick={onClose}>Details sluiten</button></div></div><section className="marketingEventFacts" aria-label="Evenementgegevens"><p><strong>Locatie: </strong>{distribution.common?.location?.trim() || business?.name || "Locatie nog niet bekend"}{end && <span> · Tot {formatDate(end, { timeStyle: "short" })}</span>}</p><details className="marketingDetailFold"><summary>Volledige omschrijving bekijken</summary><p className="marketingFullDescription">{descriptionFor(item)}</p></details></section><section className="marketingChannelStatus" aria-label="Publicatiestatus per kanaal"><h4>Publicatiestatus per kanaal</h4>{checkedAt && <p className="marketingLastChecked">Laatste controle: {formatDate(checkedAt, { dateStyle: "medium", timeStyle: "short" })}</p>}<div>{["website", "facebook", "instagram", "google", "other"].map((channel) => { const state = channelStatus(item, channel); return <div className={`marketingChannelRow ${state.key}`} key={channel}><strong>{channelLabels[channel]}</strong><span>{state.label}</span></div>; })}</div></section>{sameDayItems.length > 0 && <section className="marketingSameDayMatches"><strong>Zelf koppelen aan een ander evenement op deze datum</strong><span>Kies hieronder zelf het record dat bij dit evenement hoort.</span>{sameDayItems.map((candidate) => <div className="marketingSameDayMatch" key={candidate.id}><div><b>{eventText(candidate)}</b><small>{statusFor(candidate, distributionFor(candidate)).label}{candidate.potentialMatch?.id === item.id ? " · voorgestelde overeenkomst" : ""}</small></div><button type="button" className="secondaryButton" onClick={() => onChooseMatch(candidate)} disabled={linking || comparing}>{linking ? "Even geduld… koppeling wordt verwerkt" : "Vergelijken"}</button></div>)}</section>}{!external && <section className={`marketingComparisonSummary ${comparisonState.key}`} aria-label="Controle op tekstverschillen" role="status" aria-live="polite" aria-atomic="true" aria-busy={comparisonState.key === "pending"}><div className="marketingComparisonProgress">{comparisonState.key === "pending" && <span className="marketingLoadingSpinner" aria-hidden="true" />}<strong>{comparisonState.title}</strong></div><p>{comparisonState.detail}</p>{comparisonState.key === "incomplete" && onCompareSources && <button type="button" className="secondaryButton" onClick={onCompareSources} disabled={linking || comparing}>Controle opnieuw proberen</button>}</section>}<details className="marketingDetailFold"><summary>Bronnen vergelijken en tekst kiezen</summary>{!external && onCompareSources && <button type="button" className="secondaryButton" onClick={onCompareSources} disabled={linking || comparing}>{comparing ? "Bronnen vergelijken…" : "Bronnen opnieuw vergelijken"}</button>}{(canChoose || sources.length > 1) && <section className="marketingComparisonGrid"><div className="marketingComparisonDifference"><strong>{external ? "Opgehaalde bronnen" : comparisonState.title}</strong><span>{external ? comparisonDifference(sources) : comparisonState.detail}{canChoose && " Kies hieronder de titel en tekst die je wilt gebruiken."}</span></div>{sources.map((source) => <ComparisonCard key={source.label} label={source.label} item={source.item} onChoose={canChoose ? () => chooseSource(source) : undefined} selected={chosenContent?.label === source.label} disabled={linking || comparing} />)}</section>}{canChoose && chosenContent && <section className="marketingChosenContent" aria-label="Voorbeeld gekozen tekst" aria-live="polite"><h4>Gekozen bron: {chosenContent.label}</h4><strong>{chosenContent.title}</strong><p>{chosenContent.description || "Geen omschrijving"}</p><small>{contentDirty ? "Nog niet opgeslagen. " : ""}Opslaan bewaart alleen de tekst in Horeca OS. Website en Facebook werk je afzonderlijk bij.</small><button type="button" className="primaryButton" disabled={linking || comparing} onClick={() => onSyncContent({ title: chosenContent.title, description: chosenContent.description })}>{linking ? "Even geduld… bewaren" : "Tekst bewaren in Horeca OS"}</button></section>}</details>{!external && <details key={`facebook-edit:${item.id}`} className="marketingDetailFold" data-facebook-editor><summary>Facebook handmatig bijwerken</summary><ManualFacebookUpdate key={item.id} distribution={distribution} dirty={contentDirty} busy={linking || comparing} onConfirm={onConfirmFacebook} linkCheck={comparing ? "pending" : facebookLinkCheck} draftContent={chosenContent} sources={canChoose ? sources : []} onChooseSource={chooseSource} onSave={onSyncContent} /></details>}{!external && <details className="marketingDetailFold"><summary>Website afzonderlijk bijwerken</summary><section className="marketingChosenContent" aria-label="Website afzonderlijk bijwerken"><h4>Website bijwerken</h4><p>Alleen deze actie wijzigt het bestaande website-evenement met de tekst die in Horeca OS is opgeslagen. Facebook blijft ongewijzigd.</p><strong>{contentDeliveryStatus(distribution, "website").label}</strong>{contentDirty && <p>Bewaar eerst je gekozen tekst in Horeca OS.</p>}<button type="button" className="secondaryButton" disabled={contentDirty || linking || comparing || !onUpdateWebsite || !/^\d+$/.test(contentSnapshot(distribution, "website").event_id)} onClick={onUpdateWebsite}>Website bijwerken</button></section></details>}{syncError && <p role="alert">{syncError}</p>}{matchItem && <section className="marketingComparisonGrid"><div className="marketingComparisonDifference"><strong>Verschil vóór synchronisatie</strong><span>{comparisonDifference([item, matchItem])}</span></div><ComparisonCard label={external ? "Binnengekomen bron" : "Geselecteerd record"} item={item} /><ComparisonCard label="Bestaand Horeca OS-record" item={matchItem} /></section>}</article></div>;
}

export default function MarketingOverview({ workspaceId, businesses, session }) {
  const [items, setItems] = useState([]); const [busy, setBusy] = useState(true); const [autoChecking, setAutoChecking] = useState(false); const [linkingId, setLinkingId] = useState(""); const [error, setError] = useState(""); const [view, setView] = useState("month"); const [anchor, setAnchor] = useState(() => new Date()); const [refreshKey, setRefreshKey] = useState(0); const [calendarLayout, setCalendarLayout] = useState("two"); const [selectedItem, setSelectedItem] = useState(null); const [sourceComparisons, setSourceComparisons] = useState({}); const comparisonTargetRef = useRef(""); const contentSyncRef = useRef(false);
  const sessionRef = useRef(session); sessionRef.current = session;
  const [facebookLinkChecks, setFacebookLinkChecks] = useState({});
  const [sourceComparisonChecks, setSourceComparisonChecks] = useState({});
  const comparisonJobs = useRef(new Map());
  const venueBusinesses = useMemo(() => (businesses || []).map((business, index) => ({ ...business, color: index % 2 ? "venueB" : "venueA" })), [businesses]);
  const businessById = useMemo(() => new Map(venueBusinesses.map((business) => [String(business.id), business])), [venueBusinesses]);

  async function fetchSourceComparison(item, signal) {
    const distribution = distributionFor(item);
    const result = [{ label: "Horeca OS", item }];
    const business = businessById.get(String(item.business_id));
    const eventinId = String(distribution.eventin_event_id || distribution.external_ids?.eventin || "").trim();
    const facebookId = String(distribution.facebook_event_delivery?.external_id || distribution.provider_delivery?.facebook?.external_id || distribution.external_ids?.facebook || "").trim();
    const sourceRequests = [];
    if (/^\d+$/.test(eventinId) && business) sourceRequests.push((async () => {
      const params = new URLSearchParams({ workspaceId, businessId: String(item.business_id), site: siteForBusiness(business), eventId: eventinId, campaignId: String(item.id), importEvent: "1" });
      const response = await fetch(`/api/marketing/website-events/create?${params}`, { signal, headers: { Authorization: `Bearer ${sessionRef.current?.access_token || session?.access_token}` }, keepalive: true });
      const payload = await response.json().catch(() => ({}));
      return response.ok && payload.event ? { label: "Eventin", item: { id: `compare:eventin:${eventinId}`, business_id: item.business_id, scheduled_for: payload.event.start, media: [{ kind: "campaign_distribution", source_type: "eventin_event", common: { title: payload.event.title, start: payload.event.start, end: payload.event.end, location: payload.event.location, description: payload.event.description, website_url: payload.event.url || "" } }] } } : null;
    })());
    if (facebookId && business) sourceRequests.push((async () => {
      const params = new URLSearchParams({ workspaceId, businessId: String(item.business_id), includePast: "true" });
      const response = await fetch(`/api/integrations/facebook/events?${params}`, { signal, headers: { Authorization: `Bearer ${sessionRef.current?.access_token || session?.access_token}` }, keepalive: true });
      const payload = await response.json().catch(() => ({}));
      const event = (payload.events || []).find((candidate) => String(candidate.id) === facebookId);
      return response.ok && event ? { label: "Facebook", item: { id: `compare:facebook:${facebookId}`, business_id: item.business_id, scheduled_for: event.startDate, media: [{ kind: "campaign_distribution", source_type: "facebook_event", common: { title: event.title, start: event.startDate, end: event.endDate, location: event.location, description: event.description } }] } } : null;
    })());
    const sources = await Promise.all(sourceRequests);
    result.push(...sources.filter(Boolean));
    return result.length > 1 ? result : null;
  }

  function checkSourceComparison(item, force = false) {
    const jobs = comparisonJobs.current;
    const id = String(item.id);
    const existing = jobs.get(id);
    // Opening, reopening and the background queue share the same check.
    if (existing && (!force || !existing.settled)) return existing.promise;
    const job = { controller: new AbortController(), settled: false, timedOut: false };
    jobs.set(id, job);
    const current = () => comparisonJobs.current === jobs && jobs.get(id) === job;
    setSourceComparisonChecks(previous => ({ ...previous, [id]: "pending" }));
    job.promise = (async () => {
      try {
        const comparison = await withRequestTimeout(fetchSourceComparison(item, job.controller.signal), "Een bron reageerde niet binnen 30 seconden.", () => { job.timedOut = true; job.controller.abort(); }, 30000);
        if (current()) {
          setSourceComparisons(previous => ({ ...previous, [id]: comparison || [] }));
          setSourceComparisonChecks(previous => ({ ...previous, [id]: comparison ? "done" : "error" }));
        }
        return comparison;
      } catch (error) {
        if (current()) setSourceComparisonChecks(previous => ({ ...previous, [id]: job.timedOut ? "timeout" : "error" }));
        throw error;
      } finally { job.settled = true; }
    })();
    return job.promise;
  }

  useEffect(() => {
    let active = true;
    const jobs = new Map();
    comparisonJobs.current = jobs;
    async function load() {
      if (!workspaceId) return;
      setBusy(true); setAutoChecking(false); setError("");
      const { data, error: queryError } = await supabase.from("social_content_items").select("id,business_id,media,status,workflow_status,scheduled_for,published_at,created_at").eq("workspace_id", workspaceId).filter("media", "cs", JSON.stringify([{ kind: "campaign_distribution" }])).order("created_at", { ascending: false }).range(0, 499);
      if (!active) return;
      if (queryError) { setError("De marketingagenda kon niet worden geladen."); setBusy(false); return; }
      const campaigns = data || [];
      setSourceComparisons({});
      setSourceComparisonChecks({});
      setFacebookLinkChecks(Object.fromEntries(campaigns.slice(0, 100).map(item => [String(item.id), "pending"])));
      setItems(campaigns);
      setBusy(false);
      const accessToken = sessionRef.current?.access_token;
      if (!accessToken) { setFacebookLinkChecks({}); return; }
      setAutoChecking(true);
      const [verifiedCampaigns, facebookItems, eventinItems] = await Promise.all([
        mapWithConcurrency(campaigns.slice(0, 100), 4, async (item) => {
          if (!active) return item;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 45000);
          try {
            const response = await fetch("/api/marketing/publication-status", { method: "POST", signal: controller.signal, headers: { Authorization: `Bearer ${sessionRef.current?.access_token || accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, campaignId: item.id }) });
            const payload = await response.json().catch(() => ({}));
            const updated = response.ok ? { ...item, media: payload.media || item.media } : item;
            if (active) {
              const check = distributionFor(updated).verification?.channels?.facebook;
              setFacebookLinkChecks(current => ({ ...current, [String(item.id)]: response.ok && check && check.status !== "unreachable" ? "done" : "error" }));
              // Do not wait for the other campaigns; keep a newer user edit intact.
              const updateUnchanged = current => current?.id === item.id && JSON.stringify(current.media) === JSON.stringify(item.media) ? { ...current, media: updated.media } : current;
              setItems(current => current.map(updateUnchanged));
              setSelectedItem(updateUnchanged);
            }
            return updated;
          } catch {
            if (active) setFacebookLinkChecks(current => ({ ...current, [String(item.id)]: "error" }));
            return item;
          } finally { clearTimeout(timeout); }
        }),
        loadFacebookItems({ workspaceId, businesses: venueBusinesses, token: accessToken, campaigns }),
        loadEventinItems({ workspaceId, businesses: venueBusinesses, token: accessToken, campaigns }),
      ]);
      if (!active) return;
      const merged = suggestPotentialMatches(deduplicateCalendarItems([...verifiedCampaigns, ...facebookItems, ...eventinItems]));
      setItems(current => {
        const latest = new Map(current.map(item => [String(item.id), item]));
        // Verification was already applied progressively; preserve any subsequent edits
        // and campaigns outside the capped verification batch.
        return suggestPotentialMatches(deduplicateCalendarItems([...campaigns.map(item => latest.get(String(item.id)) || item), ...facebookItems, ...eventinItems]));
      });
      setAutoChecking(false);
      const managedItems = merged.filter((item) => {
        const distribution = distributionFor(item);
        return Boolean(distribution.eventin_event_id || distribution.external_ids?.eventin || distribution.facebook_event_delivery?.external_id || distribution.provider_delivery?.facebook?.external_id || distribution.external_ids?.facebook);
      });
      mapWithConcurrency(managedItems.slice(0, 100), 4, async (item) => {
        if (!active || comparisonTargetRef.current === String(item.id)) return;
        await checkSourceComparison(item).catch(() => {});
      });
    }
    load();
    return () => {
      active = false;
      if (comparisonJobs.current === jobs) comparisonJobs.current = new Map();
      for (const job of jobs.values()) if (!job.settled) job.controller.abort();
    };
  }, [workspaceId, refreshKey, session?.user?.id, venueBusinesses]);

  useEffect(() => {
    if (busy || !selectedItem || isExternalEvent(selectedItem) || !sessionRef.current?.access_token) return;
    // Do not make the open event wait for every publication/import request.
    checkSourceComparison(selectedItem).catch(() => {});
  }, [selectedItem?.id, workspaceId, refreshKey, busy]);

  function move(step) { const next = new Date(anchor); if (view === "day") next.setDate(next.getDate() + step); if (view === "week") next.setDate(next.getDate() + step * 7); if (view === "month") next.setMonth(next.getMonth() + step); if (view === "year") next.setFullYear(next.getFullYear() + step); setAnchor(next); }
  const title = view === "day" ? formatDate(anchor, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : view === "week" ? `Week van ${formatDate(startOfWeek(anchor), { day: "numeric", month: "long", year: "numeric" })}` : view === "year" ? String(anchor.getFullYear()) : formatDate(anchor, { month: "long", year: "numeric" });
  const activeFromToday = todayStart(); const visibleItems = visibleCalendarItems(items, businessById, activeFromToday); const dayItems = visibleItems.filter((item) => sameDay(dateOnly(itemStart(item)), anchor));
  const externalItems = visibleItems.filter(isExternalEvent).sort((left, right) => new Date(itemStart(right) || 0) - new Date(itemStart(left) || 0));
  useEffect(() => {
    if (busy || autoChecking || selectedItem || !externalItems.length) return;
    setSelectedItem(externalItems[0]);
  }, [busy, autoChecking, selectedItem, externalItems]);

  const itemsForBusiness = (businessId) => visibleItems.filter((item) => String(item.business_id) === String(businessId));
  async function syncExternalEventContent(distribution, businessId, content = {}) {
    if (!sessionRef.current?.access_token) throw new Error("Je sessie is verlopen. Log opnieuw in.");
    const common = distribution.common || {};
    const payload = { workspaceId, businessId, title: content.title ?? common.title ?? "", description: content.description ?? common.description ?? "", start: common.start || "", end: common.end || "", location: common.location || "" };
    const eventinId = String(distribution.eventin_event_id || distribution.external_ids?.eventin || "").trim();
    const requests = [];
    if (/^\d+$/.test(eventinId)) requests.push(fetch("/api/marketing/website-events/create", { method: "PATCH", headers: { Authorization: `Bearer ${sessionRef.current.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, site: siteForBusiness(businessById.get(String(businessId))), eventId: eventinId, allowLinked: true, action: "sync-content" }) }));
    const responses = await Promise.all(requests);
    const failures = [];
    for (const response of responses) { if (!response.ok) { const result = await response.json().catch(() => ({})); failures.push(result.error || `Publicatiebron gaf status ${response.status}.`); } }
    if (failures.length) throw new Error(`De website kon niet worden bijgewerkt: ${failures.join(" ")}`);
    return /^\d+$/.test(eventinId);
  }
  async function linkExternalEvent(item, existingItem = null, content = {}) {
    if (!session?.access_token || linkingId) return;
    const distribution = distributionFor(item); const businessId = String(item.business_id); const business = businessById.get(businessId); if (!business) return;
    setLinkingId(String(item.id)); setError("");
    try {
      let event = { title: distribution.common?.title, description: distribution.common?.description || "", start: distribution.common?.start, end: distribution.common?.end, location: distribution.common?.location || "", url: distribution.source_url || distribution.common?.website_url || "" };
      if (existingItem) {
        const existingDistribution = distributionFor(existingItem);
        const linkedDistribution = { ...existingDistribution, linked_to_horeca_os: true, common: { ...(existingDistribution.common || {}), ...(content.title ? { title: content.title } : {}), ...(content.description ? { description: content.description } : {}) }, external_sources: [...new Set([...(existingDistribution.external_sources || []), ...(distribution.external_sources || [distribution.external_source])].filter(Boolean))], external_ids: { ...(existingDistribution.external_ids || {}), ...(distribution.external_ids || {}), ...(distribution.external_source && distribution.external_id ? { [distribution.external_source]: String(distribution.external_id) } : {}) }, provider_delivery: { ...(existingDistribution.provider_delivery || {}), ...(distribution.provider_delivery || {}) }, verification: { ...(existingDistribution.verification || {}), ...(distribution.verification || {}) }, target_channels: [...new Set([...(existingDistribution.target_channels || []), ...(distribution.target_channels || [])])] };
        const nextMedia = (existingItem.media || []).map((entry) => entry?.kind === "campaign_distribution" ? linkedDistribution : entry);
        const { data: updated, error: updateError } = await supabase.from("social_content_items").update({ media: nextMedia }).eq("id", existingItem.id).select("id,business_id,media,status,workflow_status,scheduled_for,published_at,created_at").single();
        if (updateError) throw updateError;
        await syncExternalEventContent(linkedDistribution, businessId, content);
        setItems((current) => current.filter((entry) => entry.id !== item.id).map((entry) => entry.id === existingItem.id ? updated : entry)); setSelectedItem(null); return;
      }
      const { data: account, error: accountError } = await supabase.from("integration_accounts").select("id").eq("workspace_id", workspaceId).eq("business_id", businessId).in("provider", ["marketing", "meta"]).limit(1).maybeSingle();
      if (accountError || !account?.id) throw new Error("De interne marketingkoppeling ontbreekt voor deze vestiging.");
      const hasEventinSource = distribution.external_source === "eventin" || distribution.external_sources?.includes("eventin");
      const hasFacebookSource = distribution.external_source === "facebook" || distribution.external_sources?.includes("facebook");
      const linkedDistribution = { ...distribution, linked_to_horeca_os: true, source_type: hasEventinSource ? "website_event" : "facebook_event", common: { ...distribution.common, title: event.title, description: event.description, start: event.start, end: event.end, location: event.location, website_url: event.url }, source_url: event.url || distribution.source_url, eventin_event_id: hasEventinSource ? String(distribution.external_ids?.eventin || distribution.external_id || "") : distribution.eventin_event_id, provider_delivery: hasFacebookSource ? { ...(distribution.provider_delivery || {}), facebook: distribution.provider_delivery?.facebook || { status: "confirmed", external_id: String(distribution.external_ids?.facebook || distribution.external_id), permalink: distribution.source_url } } : (distribution.provider_delivery || {}), target_channels: [ ...(hasEventinSource ? ["website"] : []), ...(hasFacebookSource ? ["facebook"] : []) ] };
      const { data: inserted, error: insertError } = await supabase.from("social_content_items").insert({ workspace_id: workspaceId, business_id: businessId, account_id: account.id, content_type: "post", direction: "outbound", body: event.description || event.title || "Extern evenement", media: [{ ...linkedDistribution, external_source: distribution.external_source }], status: "draft", workflow_status: "new", scheduled_for: event.start || null, created_by: session.user.id }).select("id,business_id,media,status,workflow_status,scheduled_for,published_at,created_at").single();
      if (insertError) throw insertError;
      setItems((current) => current.map((entry) => entry.id === item.id ? inserted : entry)); setSelectedItem(null);
    } catch (linkError) { setError(linkError.message || "Het externe evenement kon niet worden gekoppeld."); }
    finally { setLinkingId(""); }
  }
  function showSavedContent(updated) {
    setItems((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
    const updateSources = (sources) => (sources || []).map((source) => source.label === "Horeca OS" ? { ...source, item: updated } : source);
    setSelectedItem((current) => current?.id === updated.id ? { ...current, ...updated, sourceComparisonItems: updateSources(current.sourceComparisonItems) } : current);
    setSourceComparisons((current) => ({ ...current, [String(updated.id)]: updateSources(current[String(updated.id)]) }));
  }
  async function saveChosenEventContent(item, content) {
    if (!item || linkingId || contentSyncRef.current) return;
    if (!sessionRef.current?.access_token || !content?.title?.trim() || typeof content.description !== "string") {
      setError("Kies eerst een titel en tekst en controleer of je bent ingelogd."); return;
    }
    contentSyncRef.current = true;
    setLinkingId(String(item.id)); setError("");
    try {
      const linkedDistribution = withVerifiedFacebookEvent(distributionFor(item), item.sourceComparisonItems || sourceComparisons[String(item.id)] || []);
      const nextDistribution = prepareContent(linkedDistribution, content, new Date().toISOString());
      const updated = await saveEventContent(supabase, workspaceId, item, nextDistribution, content.description);
      showSavedContent(updated);
      // Saving prepares the manual Facebook workflow, but never writes a website.
    } catch (saveError) { setError(saveError.message || "De gekozen evenementtekst kon niet worden opgeslagen."); }
    finally { contentSyncRef.current = false; setLinkingId(""); }
  }
  async function updateWebsiteContent(item) {
    if (!item || linkingId || contentSyncRef.current || !sessionRef.current?.access_token) return;
    const distribution = distributionFor(item);
    const snapshot = contentSnapshot(distribution, "website");
    if (!/^\d+$/.test(snapshot.event_id) || !snapshot.title.trim()) {
      setError("Er is geen bestaand website-evenement gekoppeld of de opgeslagen titel ontbreekt."); return;
    }
    contentSyncRef.current = true;
    setLinkingId(String(item.id)); setError("");
    try {
      const nextDistribution = { ...distribution, event_content_delivery: { ...distribution.event_content_delivery,
        website: { mode: "automatic", status: "updating", snapshot, started_at: new Date().toISOString() }
      } };
      // Check the stored version before any external write. Preserve Facebook's status.
      const updated = await saveEventContent(supabase, workspaceId, item, nextDistribution);
      showSavedContent(updated);
      let websiteUpdated = false;
      let websiteError;
      try { websiteUpdated = await syncExternalEventContent(nextDistribution, String(item.business_id), eventContent(distribution)); }
      catch (error) { websiteError = error; }
      if (websiteUpdated || websiteError) {
        const finished = { ...nextDistribution, event_content_delivery: { ...nextDistribution.event_content_delivery,
          website: { mode: "automatic", status: websiteUpdated ? "updated" : "failed", snapshot: contentSnapshot(nextDistribution, "website"), updated_at: new Date().toISOString() }
        } };
        const saved = await saveEventContent(supabase, workspaceId, updated, finished);
        showSavedContent(saved);
      }
      if (websiteError) throw new Error(websiteError.message + " De opgeslagen tekst en Facebook-status blijven behouden.");
      // Keep the dialog open for copying/confirmation; no full calendar reload.
    } catch (syncError) { setError(syncError.message || "De website-update kon niet worden afgerond. Controleer de website voordat je opnieuw probeert."); }
    finally { contentSyncRef.current = false; setLinkingId(""); }
  }
  async function confirmFacebook(item, expectedSnapshot) {
    if (!item || linkingId || contentSyncRef.current || !sessionRef.current?.user?.id) return;
    contentSyncRef.current = true;
    setLinkingId(String(item.id)); setError("");
    try {
      const next = confirmFacebookContent(distributionFor(item), expectedSnapshot, sessionRef.current.user.id, new Date().toISOString());
      const updated = await saveEventContent(supabase, workspaceId, item, next);
      showSavedContent(updated);
    } catch (confirmError) { setError(confirmError.message || "De handmatige bevestiging kon niet worden opgeslagen."); }
    finally { contentSyncRef.current = false; setLinkingId(""); }
  }
  async function compareSources(item) {
    if (!item || linkingId || comparisonTargetRef.current) return;
    const comparisonKey = `compare:${String(item.id)}`;
    comparisonTargetRef.current = String(item.id);
    setLinkingId(comparisonKey); setError("");
    try {
      await checkSourceComparison(item, true);
    } catch (compareError) { setError(compareError.message || "De bronnen konden niet opnieuw worden vergeleken."); }
    finally { comparisonTargetRef.current = ""; setLinkingId(""); }
  }
  async function mergeManagedDuplicate(item, matchingItem, content = {}) {
    if (!matchingItem || linkingId) return;
    const keep = statusRank(item) >= statusRank(matchingItem) ? item : matchingItem;
    const duplicate = keep.id === item.id ? matchingItem : item;
    setLinkingId(String(item.id)); setError("");
    try {
      const keepDistribution = distributionFor(keep); const duplicateDistribution = distributionFor(duplicate);
      const nextDistribution = { ...duplicateDistribution, duplicate_of: keep.id };
      const nextMedia = (duplicate.media || []).map((entry) => entry?.kind === "campaign_distribution" ? nextDistribution : entry);
      const { error: updateError } = await supabase.from("social_content_items").update({ media: nextMedia }).eq("id", duplicate.id);
      if (updateError) throw updateError;
      const { duplicate_of: _ignoredDuplicateOf, ...cleanKeepDistribution } = keepDistribution;
      const keptDistribution = { ...cleanKeepDistribution, source_url: keepDistribution.source_url || duplicateDistribution.source_url, eventin_event_id: keepDistribution.eventin_event_id || duplicateDistribution.eventin_event_id, external_sources: [...new Set([...(keepDistribution.external_sources || []), ...(duplicateDistribution.external_sources || [])].filter(Boolean))], external_ids: { ...(duplicateDistribution.external_ids || {}), ...(keepDistribution.external_ids || {}) }, provider_delivery: { ...(duplicateDistribution.provider_delivery || {}), ...(keepDistribution.provider_delivery || {}) }, target_channels: [...new Set([...(keepDistribution.target_channels || []), ...(duplicateDistribution.target_channels || [])])], common: { ...(duplicateDistribution.common || {}), ...(keepDistribution.common || {}), ...(content.title ? { title: content.title } : {}), ...(content.description ? { description: content.description } : {}) } };
      const keptMedia = (keep.media || []).map((entry) => entry?.kind === "campaign_distribution" ? keptDistribution : entry);
      const { error: keepError } = await supabase.from("social_content_items").update({ media: keptMedia }).eq("id", keep.id);
      if (keepError) throw keepError;
      await syncExternalEventContent(keptDistribution, String(keep.business_id), content);
      setItems((current) => current.filter((entry) => entry.id !== duplicate.id)); setSelectedItem(null);
    } catch (mergeError) { setError(mergeError.message || "De dubbele records konden niet worden gekoppeld."); }
    finally { setLinkingId(""); }
  }
  function sameDateCandidates(item) {
    const itemDate = dateOnly(itemStart(item));
    return items.filter((candidate) => candidate.id !== item.id && !distributionFor(candidate).duplicate_of && String(candidate.business_id) === String(item.business_id) && sameDay(dateOnly(itemStart(candidate)), itemDate));
  }
  function chooseSameDateMatch(candidate) {
    if (!selectedItem) return;
    setSelectedItem((current) => current ? { ...current, potentialMatch: { id: candidate.id, title: eventText(candidate), status: statusFor(candidate, distributionFor(candidate)).label, external: isExternalEvent(candidate) } } : current);
  }
  const renderBusinessCalendar = (business) => { const businessItems = itemsForBusiness(business.id); const businessDayItems = businessItems.filter((item) => sameDay(dateOnly(itemStart(item)), anchor)); return <article className="marketingVenueCalendar" key={business.id}><header><span className={`marketingVenueDot ${business.color}`} /><h3>{business.name}</h3></header>{view === "month" && <MonthCalendar anchor={anchor} items={businessItems} businessById={businessById} onSelectEvent={setSelectedItem} />}{view === "week" && <WeekCalendar anchor={anchor} items={businessItems} businessById={businessById} onSelectEvent={setSelectedItem} />}{view === "day" && <div className="marketingDayAgenda">{businessDayItems.length ? businessDayItems.map((item) => <CalendarEvent key={item.id} item={item} business={business} onSelectEvent={setSelectedItem} />) : <p>Geen geplande items voor deze dag.</p>}</div>}{view === "year" && <YearCalendar anchor={anchor} items={businessItems} onSelectEvent={setSelectedItem} />}</article>; };

  return <section className="panel marketingCalendarPanel"><div className="panelHead marketingCalendarHead"><div><p className="eyebrow">MARKETINGAGENDA</p><h2>{title}</h2><p>Bekijk de planning van beide vestigingen naast elkaar. Zo zie je direct wanneer evenementen op dezelfde dag vallen.</p></div><button type="button" className="secondaryButton" onClick={() => setRefreshKey((value) => value + 1)} disabled={busy}>{busy ? "Agenda laden…" : "Agenda verversen"}</button></div>
    <div className="marketingCalendarToolbar"><div className="marketingCalendarViews">{Object.entries(viewLabels).map(([key, label]) => <button type="button" className={view === key ? "active" : ""} onClick={() => setView(key)} key={key}>{label}</button>)}</div><div className="marketingCalendarNav"><button type="button" onClick={() => move(-1)}>‹</button><button type="button" onClick={() => setAnchor(new Date())}>Vandaag</button><button type="button" onClick={() => move(1)}>›</button></div><div className="marketingCalendarLayout"><button type="button" className={calendarLayout === "two" ? "active" : ""} onClick={() => setCalendarLayout("two")}>Twee agenda's</button><button type="button" className={calendarLayout === "combined" ? "active" : ""} onClick={() => setCalendarLayout("combined")}>Over elkaar leggen</button></div></div>
    <div className="marketingCalendarLegend">{venueBusinesses.map((business) => <span key={business.id}><i className={business.color} />{business.name}</span>)}<span><i className="externalLegend" />Extern evenement — nog niet gekoppeld</span></div>
    {autoChecking && <div className="marketingAutoNotice">Marketingagenda geladen. Publicaties en externe evenementen worden automatisch gecontroleerd…</div>}
    {!autoChecking && externalItems.length > 0 && <div className="marketingExternalQueueNotice">{externalItems.length} extern {externalItems.length === 1 ? "evenement wacht" : "evenementen wachten"} op koppeling. Het nieuwste wordt automatisch geopend.</div>}
    {error && <div className="eventResult error"><strong>{error}</strong></div>}{calendarLayout === "two" ? <div className="marketingTwoCalendars">{venueBusinesses.map(renderBusinessCalendar)}</div> : <div className="marketingCombinedCalendar">{view === "month" && <MonthCalendar anchor={anchor} items={visibleItems} businessById={businessById} onSelectEvent={setSelectedItem} />}{view === "week" && <WeekCalendar anchor={anchor} items={visibleItems} businessById={businessById} onSelectEvent={setSelectedItem} />}{view === "day" && <div className="marketingDayAgenda"><h3>{formatDate(anchor, { weekday: "long", day: "numeric", month: "long" })}</h3>{dayItems.length ? dayItems.map((item) => <CalendarEvent key={item.id} item={item} business={businessById.get(String(item.business_id))} onSelectEvent={setSelectedItem} />) : <p>Geen geplande items voor deze dag.</p>}</div>}{view === "year" && <YearCalendar anchor={anchor} items={visibleItems} onSelectEvent={setSelectedItem} />}</div>}
    {selectedItem && <EventDetails item={selectedItem} matchItem={items.find((entry) => entry.id === selectedItem.potentialMatch?.id)} sameDayItems={sameDateCandidates(selectedItem)} sourceComparisonItems={sourceComparisons[String(selectedItem.id)] || selectedItem.sourceComparisonItems || []} sourceComparisonCheck={sourceComparisonChecks[String(selectedItem.id)] || (autoChecking ? "queued" : "idle")} facebookLinkCheck={facebookLinkChecks[String(selectedItem.id)] || "idle"} business={businessById.get(String(selectedItem.business_id))} onClose={() => setSelectedItem(null)} onLink={() => linkExternalEvent(selectedItem)} onCompareSources={() => compareSources(selectedItem)} onSyncContent={(content) => saveChosenEventContent(selectedItem, content)} onUpdateWebsite={() => updateWebsiteContent(selectedItem)} onConfirmFacebook={(snapshot) => confirmFacebook(selectedItem, snapshot)} syncError={error} onLinkExisting={(content) => { const matchingItem = items.find((entry) => entry.id === selectedItem.potentialMatch?.id); return selectedItem.potentialMatch?.external ? linkExternalEvent(selectedItem, matchingItem, content) : mergeManagedDuplicate(selectedItem, matchingItem, content); }} onChooseMatch={chooseSameDateMatch} comparing={linkingId === `compare:${String(selectedItem.id)}`} linking={linkingId === String(selectedItem.id)} />}
    {!busy && !visibleItems.length && <div className="marketingCalendarEmptyState"><strong>Nog geen evenementen of campagnes ingepland</strong><p>Maak vanuit één van de vestigingen een campagne aan; die verschijnt daarna automatisch op deze agenda.</p></div>}
    <style jsx>{`.marketingCalendarPanel{margin-bottom:24px}.marketingCalendarHead{align-items:flex-start}.marketingCalendarHead p:not(.eyebrow){max-width:780px}.marketingCalendarToolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:18px 0 10px;flex-wrap:wrap}.marketingCalendarViews,.marketingCalendarNav{display:flex;gap:6px}.marketingCalendarViews button,.marketingCalendarNav button{border:1px solid #25889b;border-radius:8px;padding:9px 13px;background:#fff;color:#176d7f;font:inherit;font-weight:800;cursor:pointer}.marketingCalendarViews button.active,.marketingCalendarNav button:first-child{background:#25889b;color:#fff}.marketingCalendarLegend{display:flex;gap:18px;flex-wrap:wrap;margin:10px 0 14px;color:#405866;font-size:13px;font-weight:800}.marketingCalendarLegend span{display:flex;align-items:center;gap:6px}.marketingCalendarLegend i{width:11px;height:11px;border-radius:50%;display:inline-block}.venueA{background:#25889b}.venueB{background:#d27928}.marketingCalendarEvent{display:grid;gap:2px;width:100%;padding:6px 7px;border:0;border-left:4px solid;border-radius:6px;background:#eef7f9;color:#173552;text-align:left;cursor:pointer}.marketingCalendarEvent.venueA{border-left-color:#25889b}.marketingCalendarEvent.venueB{border-left-color:#d27928;background:#fff5e9}.marketingCalendarEvent strong{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.marketingCalendarEvent span{font-size:11px;color:#5c7285}.marketingWeekdayRow{display:grid;grid-template-columns:repeat(7,1fr);gap:1px}.marketingWeekdayRow strong{padding:8px;background:#173b5c;color:#fff;text-align:center}.marketingMonthGrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1px;background:#c6d5df;border:1px solid #c6d5df}.marketingDayCell{min-height:126px;padding:7px;background:#fff}.marketingDayCell.outside{background:#f1f4f6;color:#91a0aa}.marketingDayCell>strong{display:block;margin-bottom:6px}.marketingDayCell>div,.marketingWeekColumn{display:grid;gap:5px}.marketingWeekCalendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1px;background:#c6d5df;border:1px solid #c6d5df}.marketingWeekColumn{min-height:280px;padding:9px;background:#fff}.marketingWeekColumn>strong{padding-bottom:8px;border-bottom:1px solid #d5e0e7}.marketingCalendarEmpty{color:#91a0aa;font-size:12px}.marketingDayAgenda{display:grid;gap:10px;max-width:720px}.marketingDayAgenda h3{margin:0}.marketingDayAgenda>p,.marketingCalendarEmptyState{padding:16px;border-radius:10px;background:#f5f8fa;color:#5c7285}.marketingYearGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.marketingMiniMonth{padding:12px;border:1px solid #c6d5df;border-radius:10px;background:#fff}.marketingMiniMonth h4{margin:0 0 9px;text-transform:capitalize}.marketingMiniDays{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}.marketingMiniDays span{padding:5px 0;border-radius:4px;text-align:center;font-size:11px;background:#f4f7f9}.marketingMiniDays span.hasEvent{background:#dceff2;color:#176d7f;font-weight:800}.marketingMiniMonth small{display:block;margin-top:8px;color:#5c7285}.marketingCalendarEmptyState{margin-top:14px}.marketingCalendarEmptyState p{margin:6px 0 0}@media(max-width:760px){.marketingCalendarHead{display:block}.marketingCalendarHead button{width:100%;margin-top:12px}.marketingDayCell{min-height:94px;padding:5px}.marketingCalendarEvent{padding:4px}.marketingCalendarEvent strong{font-size:10px}.marketingCalendarEvent span{display:none}.marketingWeekColumn{min-height:220px;padding:5px}.marketingWeekColumn .marketingCalendarEvent strong{white-space:normal}.marketingYearGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}`}</style>
    <style jsx global>{`.marketingCalendarPanel{background:#fff}.marketingCalendarPanel .marketingWeekdayRow{display:grid!important;grid-template-columns:repeat(7,minmax(0,1fr));border-top:1px solid #d7dfe4}.marketingCalendarPanel .marketingWeekdayRow strong{display:block!important;padding:11px 8px!important;background:#fff!important;color:#536b7c!important;font-size:11px!important;letter-spacing:.08em;text-align:left}.marketingCalendarPanel .marketingMonthGrid{display:grid!important;grid-template-columns:repeat(7,minmax(0,1fr));gap:0!important;background:#d7dfe4!important;border:0!important;border-top:1px solid #d7dfe4}.marketingCalendarPanel .marketingDayCell{display:block!important;min-height:142px!important;padding:10px!important;background:#fff!important;border-right:1px solid #d7dfe4;border-bottom:1px solid #d7dfe4;color:#173552}.marketingCalendarPanel .marketingDayCell.outside{background:#f7f8f9!important;color:#9aa7af}.marketingCalendarPanel .marketingDayCell>strong{display:block!important;margin-bottom:8px;font-size:12px}.marketingCalendarPanel .marketingDayCell>div{display:grid!important;gap:5px}.marketingCalendarPanel .marketingCalendarEvent{display:grid!important;gap:2px!important;width:100%!important;min-width:0;padding:6px 8px!important;border:0!important;border-left:3px solid!important;border-radius:2px!important;box-shadow:none!important}.marketingCalendarPanel .marketingCalendarEvent strong{display:block!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px!important}.marketingCalendarPanel .marketingCalendarEvent span{display:block!important;font-size:10px!important}.marketingCalendarPanel .marketingCalendarEvent.venueA{background:#eef7f9!important;border-left-color:#25889b!important}.marketingCalendarPanel .marketingCalendarEvent.venueB{background:#fff4e8!important;border-left-color:#d27928!important}.marketingCalendarPanel .marketingCalendarToolbar{border-top:1px solid #d7dfe4;border-bottom:1px solid #d7dfe4;padding:14px 0}.marketingCalendarPanel .marketingCalendarViews button,.marketingCalendarPanel .marketingCalendarNav button{border-radius:0!important}.marketingCalendarPanel .marketingCalendarViews button.active{background:#173b5c!important;color:#fff!important}.marketingCalendarPanel .marketingCalendarNav button:first-child{background:#173b5c!important;color:#fff!important}.marketingCalendarPanel .marketingCalendarLegend{margin:12px 0 16px}.marketingCalendarPanel .marketingYearGrid{display:grid!important}.marketingCalendarPanel .marketingMiniMonth{min-height:150px}.marketingCalendarPanel .marketingDayAgenda{border-top:1px solid #d7dfe4;padding-top:16px}.marketingCalendarPanel .marketingCalendarEmptyState{border-radius:0;border:1px solid #d7dfe4;background:#f7f8f9}@media(max-width:760px){.marketingCalendarPanel .marketingDayCell{min-height:92px!important;padding:6px!important}.marketingCalendarPanel .marketingCalendarEvent strong{font-size:10px!important}.marketingCalendarPanel .marketingCalendarEvent span{display:none!important}}`}</style>
    <style jsx global>{`.marketingTwoCalendars{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.marketingVenueCalendar{min-width:0;border:1px solid #d7dfe4;background:#fff}.marketingVenueCalendar>header{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid #d7dfe4}.marketingVenueCalendar>header h3{margin:0;font-size:18px}.marketingVenueDot{width:12px;height:12px;border-radius:50%;display:inline-block}.marketingVenueCalendar .marketingDayCell{min-height:116px!important;padding:8px!important}.marketingCalendarLayout{display:flex;gap:6px;margin-left:auto}.marketingCalendarLayout button{border:1px solid #25889b;border-radius:8px;padding:9px 12px;background:#fff;color:#176d7f;font:inherit;font-weight:800;cursor:pointer}.marketingCalendarLayout button.active{background:#25889b;color:#fff}.marketingCombinedCalendar{width:100%}@media(max-width:760px){.marketingTwoCalendars{grid-template-columns:1fr}.marketingCalendarLayout{width:100%;margin-left:0}.marketingCalendarLayout button{flex:1}}`}</style>
    <style jsx global>{`.marketingCalendarPanel .marketingWeekCalendar{display:block!important;border:0!important;background:transparent!important}.marketingCalendarPanel .marketingWeekHeader,.marketingCalendarPanel .marketingWeekColumns{display:grid!important;grid-template-columns:repeat(7,minmax(0,1fr))}.marketingCalendarPanel .marketingWeekHeader{border-top:1px solid #d7dfe4;border-bottom:1px solid #d7dfe4}.marketingCalendarPanel .marketingWeekHeader strong{padding:12px 10px;color:#536b7c;font-size:11px;letter-spacing:.06em;text-transform:uppercase}.marketingCalendarPanel .marketingWeekColumns{background:#d7dfe4;gap:1px}.marketingCalendarPanel .marketingWeekColumn{display:grid!important;align-content:start;gap:8px;min-height:340px;padding:10px;background:#fff}.marketingCalendarPanel .marketingWeekColumn:has(.marketingCalendarEvent){background:#fff}.marketingCalendarPanel .marketingWeekColumn .marketingCalendarEmpty{padding-top:4px;color:#9aa7af;font-size:12px}.marketingCalendarPanel .marketingYearGrid{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.marketingCalendarPanel .marketingMiniMonth{min-height:220px;padding:14px!important;border:1px solid #d7dfe4;border-radius:0;background:#fff}.marketingCalendarPanel .marketingMiniMonth h4{padding-bottom:10px;border-bottom:1px solid #d7dfe4;font-size:16px;color:#173b5c}.marketingCalendarPanel .marketingMiniWeekdays,.marketingCalendarPanel .marketingMiniDays{display:grid!important;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}.marketingCalendarPanel .marketingMiniWeekdays span{padding:3px 0;color:#8a99a3;font-size:10px;font-weight:800;text-align:center}.marketingCalendarPanel .marketingMiniDays{margin-top:3px}.marketingCalendarPanel .marketingMiniDays span{position:relative;min-height:22px;padding:4px 0;border-radius:3px;background:#f5f7f8;color:#173552;font-size:11px;text-align:center}.marketingCalendarPanel .marketingMiniDays span.outside{background:transparent;color:#b3bdc3}.marketingCalendarPanel .marketingMiniDays span.hasEvent{background:#dceff2;color:#176d7f;font-weight:800}.marketingCalendarPanel .marketingMiniDays span.hasEvent:after{content:"";position:absolute;right:3px;bottom:2px;width:4px;height:4px;border-radius:50%;background:#25889b}.marketingCalendarPanel .marketingMiniMonth small{display:block;margin-top:12px;padding-top:9px;border-top:1px solid #edf1f3;color:#5c7285;font-size:11px}@media(max-width:760px){.marketingCalendarPanel .marketingWeekHeader strong{padding:8px 3px;font-size:9px}.marketingCalendarPanel .marketingWeekColumn{min-height:230px;padding:5px}.marketingCalendarPanel .marketingYearGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.marketingCalendarPanel .marketingMiniMonth{min-height:180px;padding:9px!important}.marketingCalendarPanel .marketingMiniDays span{min-height:18px;padding:2px 0;font-size:10px}}`}</style>
    <style jsx global>{`.marketingCalendarPanel .marketingMiniDays button{position:relative;min-height:22px;padding:4px 0;border:0;border-radius:3px;background:#f5f7f8;color:#173552;font:inherit;font-size:11px;text-align:center;cursor:pointer}.marketingCalendarPanel .marketingMiniDays button.outside{background:transparent;color:#b3bdc3}.marketingCalendarPanel .marketingMiniDays button.hasEvent{background:#dceff2;color:#176d7f;font-weight:800}.marketingCalendarPanel .marketingMiniDays button.hasEvent:after{content:"";position:absolute;right:3px;bottom:2px;width:4px;height:4px;border-radius:50%;background:#25889b}.marketingEventDetails{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px 20px;margin-top:18px;padding:18px;border:2px solid #25889b;border-radius:10px;background:#eef7f9}.marketingEventDetails h3{margin:3px 0 4px}.marketingEventDetails p{margin:0;color:#5c7285}.marketingEventDetails dl{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0}.marketingEventDetails dl>div{padding:11px;background:#fff;border-radius:7px}.marketingEventDetails dt{font-size:11px;font-weight:800;color:#536b7c;text-transform:uppercase}.marketingEventDetails dd{margin:5px 0 0;color:#173552;white-space:pre-wrap}.marketingDetailStatus{font-weight:800;color:#176d7f}.marketingDetailStatus.cancelled{color:#a12f2f}.marketingDetailStatus.published,.marketingDetailStatus.approved{color:#24723b}@media(max-width:760px){.marketingEventDetails{display:block}.marketingEventDetails .secondaryButton{width:100%;margin-top:12px}.marketingEventDetails dl{display:grid;grid-template-columns:1fr;margin-top:14px}}`}</style>
    <style jsx global>{`.marketingChannelMini{display:flex;gap:3px;margin-top:2px}.marketingChannelMini i{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:#e6ecef;color:#6b7e8d;font-size:9px;font-style:normal;font-weight:800}.marketingChannelMini i.placed{background:#dcefe2;color:#24723b}.marketingChannelMini i.scheduled{background:#e4efff;color:#145dbf}.marketingChannelMini i.concept{background:#fff0ca;color:#815b00}.marketingChannelMini i.warning,.marketingChannelMini i.error{background:#f8dddd;color:#a12f2f}.marketingChannelStatus{grid-column:1/-1;padding-top:14px;border-top:1px solid #d7dfe4}.marketingChannelStatus h4{margin:0 0 10px}.marketingChannelStatus>div{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.marketingChannelRow{display:grid;gap:6px;padding:10px;border-radius:7px;background:#fff;border-left:4px solid #c6d5df}.marketingChannelRow strong{font-size:12px}.marketingChannelRow span{font-size:12px;font-weight:800;color:#5c7285}.marketingChannelRow.placed{border-left-color:#3a9455;background:#f1faf4}.marketingChannelRow.placed span{color:#24723b}.marketingChannelRow.scheduled{border-left-color:#4a90d9;background:#f1f6fd}.marketingChannelRow.scheduled span{color:#145dbf}.marketingChannelRow.concept{border-left-color:#d99b16;background:#fffaf0}.marketingChannelRow.concept span{color:#815b00}.marketingChannelRow.warning,.marketingChannelRow.error{border-left-color:#c95d5d;background:#fff5f5}.marketingChannelRow.warning span,.marketingChannelRow.error span{color:#a12f2f}.marketingChannelRow.not_active span{color:#8a99a3}@media(max-width:760px){.marketingChannelStatus>div{grid-template-columns:repeat(2,minmax(0,1fr))}.marketingChannelStatus>div .marketingChannelRow:last-child{grid-column:1/-1}}`}</style>
    <style jsx global>{`.marketingDetailActions{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap}.marketingLinkingNotice{display:flex;align-items:center;gap:9px;grid-column:1/-1;padding:11px 13px;border-left:4px solid #25889b;border-radius:6px;background:#eaf6f8;color:#176d7f;font-size:13px;font-weight:800}.marketingLoadingSpinner{width:15px;height:15px;flex:0 0 15px;border:2px solid #b9dbe2;border-top-color:#25889b;border-radius:50%;animation:marketingSpin .8s linear infinite}@keyframes marketingSpin{to{transform:rotate(360deg)}}.marketingAutoCheck{padding:9px 0;color:#24723b;font-size:12px;font-weight:800}.marketingAutoNotice{margin:0 0 14px;padding:10px 12px;border-left:4px solid #25889b;background:#eef7f9;color:#176d7f;font-size:13px;font-weight:800}.marketingExternalQueueNotice{margin:0 0 14px;padding:11px 13px;border-left:4px solid #d88900;background:#fff7df;color:#815b00;font-size:13px;font-weight:800}.externalLegend{background:#d88900!important}.marketingExternalBadge{display:inline-block;margin-left:8px;padding:3px 7px;border-radius:999px;background:#fff0ca;color:#815b00;font-size:11px;font-weight:800}.marketingCalendarEvent.externalFacebookEvent{background:#fff0ca!important;border-left-color:#d88900!important}.marketingCalendarEvent.externalFacebookEvent span{color:#815b00;font-weight:800}.externalFacebookDetails{border-color:#d88900!important;background:#fffaf0!important}.marketingMatchSuggestion{display:grid;gap:4px;width:100%;padding:10px 12px;border-left:4px solid #d88900;border-radius:7px;background:#fff7df;color:#815b00}.marketingMatchSuggestion span{font-size:12px}.marketingMatchSuggestion button{justify-self:start}.marketingSameDayMatches{display:grid;grid-column:1/-1;gap:8px;padding:12px;border-left:4px solid #25889b;background:#eef7f9}.marketingSameDayMatches>span{color:#5c7285;font-size:12px}.marketingSameDayMatch{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 10px;background:#fff;border:1px solid #d7dfe4;border-radius:7px}.marketingSameDayMatch div{min-width:0}.marketingSameDayMatch b{display:block;overflow-wrap:anywhere;color:#173552}.marketingSameDayMatch small{display:block;margin-top:3px;color:#5c7285}.marketingComparisonGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;grid-column:1/-1;margin:4px 0 2px}.marketingComparisonDifference{grid-column:1/-1;display:grid;gap:4px;padding:10px 12px;border-left:4px solid #d88900;background:#fff7df;color:#815b00;font-size:13px}.marketingComparisonDifference strong{font-size:12px}.marketingComparisonCard{min-width:0;padding:14px;border:1px solid #d7dfe4;border-radius:9px;background:#fff}.marketingComparisonTitle{display:grid;gap:4px;margin:7px 0 12px;padding:10px;border-radius:6px;background:#f7f9fa}.marketingComparisonTitle span,.marketingComparisonDescription>span{font-size:10px;font-weight:800;color:#536b7c;text-transform:uppercase;letter-spacing:.05em}.marketingComparisonTitle strong{overflow-wrap:anywhere;color:#173552}.marketingComparisonCard dl{display:grid;gap:8px;margin:0}.marketingComparisonCard dl>div{padding-bottom:7px;border-bottom:1px solid #edf1f3}.marketingComparisonCard dt{font-size:10px;font-weight:800;color:#536b7c;text-transform:uppercase}.marketingComparisonCard dd{margin:3px 0 0;overflow-wrap:anywhere;color:#173552}.marketingComparisonDescription{max-height:180px;margin:12px 0 0;overflow:auto;color:#405866;font-size:13px;line-height:1.45}.marketingComparisonDescription p{margin:6px 0 0;white-space:pre-wrap}.marketingEventModalBackdrop{position:fixed;z-index:50;inset:0;display:grid;place-items:center;padding:24px;background:rgba(10,35,53,.58)}.marketingEventModalBackdrop .marketingEventDetails{width:min(1100px,100%);max-height:calc(100vh - 48px);margin:0;overflow:auto;box-shadow:0 20px 70px rgba(10,35,53,.28)}.marketingLastChecked{margin:0 0 10px;color:#5c7285;font-size:12px}.marketingChannelRow span{display:block}@media(max-width:760px){.marketingComparisonGrid{grid-template-columns:1fr}.marketingSameDayMatch{display:grid}.marketingSameDayMatch .secondaryButton{width:100%}.marketingEventModalBackdrop{padding:12px}.marketingEventModalBackdrop .marketingEventDetails{max-height:calc(100vh - 24px)}}`}</style>
    <style jsx global>{`.marketingCalendarPanel .marketingDayCell.today{background:#fff8df!important;box-shadow:inset 0 0 0 2px #d99b16}.marketingCalendarPanel .marketingDayCell.today>strong{color:#815b00}.marketingCalendarPanel .marketingWeekHeader strong.today{background:#fff0ca;color:#815b00}.marketingCalendarPanel .marketingWeekColumn.today{background:#fff8df;border-top:3px solid #d99b16}.marketingCalendarPanel .marketingMiniMonth.currentMonth{border:2px solid #d99b16}.marketingCalendarPanel .marketingMiniMonth.currentMonth h4{color:#815b00}.marketingCalendarPanel .marketingMiniDays button.today{background:#d99b16;color:#fff;font-weight:900}.marketingCalendarPanel .marketingMiniDays button.today.hasEvent:after{background:#fff}.marketingCalendarPanel .marketingDayAgenda{border-left:4px solid #d99b16;padding-left:14px;background:#fff8df}`}</style>
    <style jsx global>{`.marketingEventDetails{display:block!important}.marketingEventDetails>.marketingLinkingNotice{margin-bottom:16px}.marketingEventDetails>.marketingDetailActions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:2px 0 14px;margin-bottom:16px;border-bottom:1px solid #d7dfe4}.marketingDetailActions>button{min-height:42px;padding:10px 15px;white-space:nowrap;border-radius:8px}.marketingDetailActions>.marketingAutoCheck{margin-left:auto}.marketingMergeContent{flex:1 0 100%;width:100%;margin-top:4px}.marketingComparisonGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin:4px 0 2px}.marketingChosenContent{display:grid;gap:12px;margin:18px 0;padding:16px;border:2px solid #25889b;border-radius:9px;background:#fff}.marketingChosenContent h4,.marketingChosenContent p{margin:0}.marketingChosenContent p{white-space:pre-wrap;max-height:260px;overflow:auto;overflow-wrap:anywhere}.marketingChosenContent small{color:#405866}.marketingChosenContent button{justify-self:start}.marketingComparisonCard{padding:16px}.marketingComparisonCard>button{margin:6px 0;min-height:40px}.marketingComparisonTitle strong{font-size:15px;line-height:1.35}.marketingComparisonDescription{max-height:240px;font-size:14px;line-height:1.55}.marketingEventDetails>dl{margin-top:18px}@media(max-width:760px){.marketingDetailActions{align-items:stretch}.marketingDetailActions>button,.marketingDetailActions>.marketingAutoCheck{width:100%;margin-left:0}.marketingComparisonGrid{grid-template-columns:1fr}}.marketingDetailFold{margin-top:10px;border:1px solid #cbdde5;border-radius:8px;background:#fff}.marketingDetailFold>summary{padding:12px 14px;cursor:pointer;font-size:13px;font-weight:800;color:#176d7f}.marketingDetailFold[open]{padding:0 14px 14px}.marketingDetailFold[open]>summary{margin:0 -14px 12px;border-bottom:1px solid #e0e9ef}.marketingEventDetails .manualFacebookUpdate button,.marketingEventDetails .manualFacebookUpdate a{width:auto;margin-top:0;min-height:34px}.marketingEventDetails .manualFacebookUpdate textarea{min-height:0}.marketingEventDetails>.marketingDetailActions{margin-bottom:8px;padding-bottom:8px}.marketingDetailFold .marketingChosenContent{margin-bottom:0}@media(max-width:760px){.marketingEventModalBackdrop .marketingEventDetails{padding:12px}.marketingEventDetails>.marketingDetailActions>button{width:auto}.marketingEventDetails .manualFacebookUpdate{padding:12px}}.marketingEventFacts{margin:6px 0 14px}.marketingEventFacts>p{margin:0;font-size:13px;color:#173552}.marketingFullDescription{white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;margin:0;line-height:1.55}.marketingEventHeading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.marketingEventHeading>div:first-child{flex:1;min-width:200px}.marketingEventHeading .marketingDetailActions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.marketingEventHeading .marketingDetailActions>button{width:auto;margin:0}.marketingComparisonSummary{display:grid;gap:5px;margin:14px 0 10px;padding:12px 14px;border-radius:8px;border-left:4px solid #8ca6b6;background:#f5f8fa;font-size:13px}.marketingComparisonProgress{display:flex;align-items:center;gap:9px}.marketingComparisonProgress .marketingLoadingSpinner{display:inline-block}@media(prefers-reduced-motion:reduce){.marketingComparisonProgress .marketingLoadingSpinner{animation:none}}.marketingComparisonSummary.equal{border-color:#3a9455;background:#f1faf4}.marketingComparisonSummary.different{border-color:#d99b16;background:#fffaf0}.marketingComparisonSummary p{line-height:1.5}.marketingDetailFold .manualFacebookUpdate{margin:0;border:0;padding:0}`}</style>
  </section>;
}

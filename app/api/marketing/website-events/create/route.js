import { NextResponse } from "next/server";
import { createUserSupabase } from "../../../../../lib/server-supabase";

const SITES = {
  "caribbeancorner.nl": {
    origin: "https://caribbeancorner.nl",
    username: "EVENTIN_CARIBBEAN_USERNAME",
    password: "EVENTIN_CARIBBEAN_APPLICATION_PASSWORD",
  },
};

function text(value, limit = 10000) {
  return String(value || "").trim().slice(0, limit);
}

function dateParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function eventContent(body) {
  const variations = normalizedTicketInputs(body);
  const ticket = variations.length ? variations.map((item) => `${text(item.name, 80)}: ${item.type === "paid" ? `€ ${Number(item.price || 0).toFixed(2)}` : "gratis"}${item.capacity ? ` (${Number(item.capacity)} beschikbaar)` : ""}`).join(" · ") : "";
  const image = text(body.imageUrl, 2000);
  return [
    image ? `<figure><img src="${image.replace(/"/g, "&quot;")}" alt="" /></figure>` : "",
    `<p>${text(body.description).replace(/\n/g, "<br>")}</p>`,
    "<hr>",
    `<p><strong>Locatie:</strong> ${text(body.location, 500)}</p>`,
    ticket ? `<p><strong>Tickets:</strong> ${ticket}</p>` : "",
  ].filter(Boolean).join("\n");
}

function currentEventinDateParts() {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

function datePartsTimestamp(parts) {
  return parts ? new Date(`${parts.date}T${parts.time}:00`).getTime() : Number.NaN;
}

async function ownerContext(request, workspaceId) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !workspaceId) return null;
  const client = createUserSupabase(token);
  const { data } = await client.auth.getUser(token);
  if (!data?.user) return null;
  const { data: member } = await client.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", data.user.id).maybeSingle();
  return member?.role === "owner" ? { client, user: data.user } : null;
}

function eventId(value) {
  const id = String(value || "").trim();
  return /^\d+$/.test(id) ? id : "";
}

function siteCredentials(body) {
  const site = SITES[text(body.site, 200).toLowerCase()];
  if (!site) return { error: "Voor deze vestiging is nog geen Eventin-website ingesteld.", status: 400 };
  const username = process.env[site.username] || process.env.EVENTIN_USERNAME;
  const password = process.env[site.password] || process.env.EVENTIN_APPLICATION_PASSWORD;
  if (!username || !password) {
    return {
      site,
      error: `De beveiligde Eventin-schrijfkoppeling voor ${body.site} moet nog eenmalig onder Vercel → Environment Variables worden ingesteld (${site.username} en ${site.password}).`,
      status: 503,
      configurationRequired: true,
    };
  }
  return { site, authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

function normalizedTicketInputs(body) {
  if (Array.isArray(body.ticketVariations)) return body.ticketVariations.slice(0, 20).map((item) => ({
    id: text(item?.id, 150), name: text(item?.name, 80), type: item?.type === "paid" ? "paid" : "free", price: item?.price,
    capacity: item?.capacity, salesStart: item?.salesStart, salesEnd: item?.salesEnd,
    minQuantity: item?.minQuantity, maxQuantity: item?.maxQuantity,
  })).filter((item) => item.name);
  if (body.ticketType === "none") return [];
  return [{ name: body.ticketType === "paid" ? "Ticket" : "Gratis ticket", type: body.ticketType === "paid" ? "paid" : "free", price: body.ticketPrice, capacity: body.capacity, minQuantity: 1, maxQuantity: 10 }];
}

function ticketValidationError(body) {
  const defaultStart = currentEventinDateParts();
  const defaultEnd = dateParts(body.end);
  for (const ticket of normalizedTicketInputs(body)) {
    if (ticket.type === "paid" && Number(ticket.price) <= 0) return `Vul een geldige prijs in voor ${ticket.name}.`;
    if (ticket.capacity && (!Number.isInteger(Number(ticket.capacity)) || Number(ticket.capacity) < 1)) return `Vul een geldige capaciteit in voor ${ticket.name}.`;
    const minimum = Number(ticket.minQuantity || 1);
    const maximum = Number(ticket.maxQuantity || 10);
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 1 || maximum < minimum) return `Controleer de minimale en maximale afname van ${ticket.name}.`;
    if (ticket.salesStart && !dateParts(ticket.salesStart)) return `De verkoopstart van ${ticket.name} is niet geldig.`;
    if (ticket.salesEnd && !dateParts(ticket.salesEnd)) return `Het verkoopeinde van ${ticket.name} is niet geldig.`;
    const effectiveStart = dateParts(ticket.salesStart) || defaultStart;
    const effectiveEnd = dateParts(ticket.salesEnd) || defaultEnd;
    if (datePartsTimestamp(effectiveEnd) <= datePartsTimestamp(effectiveStart)) return `De verkoopperiode van ${ticket.name} is niet geldig.`;
  }
  return "";
}

function ticketSlug(ticket, existingTicket) {
  if (existingTicket?.etn_ticket_slug) return existingTicket.etn_ticket_slug;
  const label = text(ticket.name, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ticket";
  return `horeca-os-${label}-${Date.now().toString(36)}`;
}

function eventinTickets(body, start, end, existingTickets = []) {
  const defaultSaleStart = currentEventinDateParts();
  return normalizedTicketInputs(body).map((ticket, index) => {
    const capacity = Math.max(0, Number.parseInt(ticket.capacity, 10) || 0);
    const price = ticket.type === "paid" ? Math.max(0, Number(ticket.price || 0)) : 0;
    const existingTicket = existingTickets.find((item) => item.etn_ticket_slug === ticket.id || item.etn_ticket_name === ticket.name) || existingTickets[index];
    const saleStart = dateParts(ticket.salesStart) || defaultSaleStart;
    const saleEnd = dateParts(ticket.salesEnd) || end;
    return {
      etn_ticket_name: ticket.name,
      etn_ticket_description: text(body.shortDescription || body.description, 150),
      etn_ticket_price: price,
      etn_avaiilable_tickets: capacity || -1,
      etn_unlimited_tickets: !capacity,
      etn_sold_tickets: Number(existingTicket?.etn_sold_tickets || 0),
      etn_min_ticket: Math.max(1, Number.parseInt(ticket.minQuantity, 10) || 1),
      etn_max_ticket: Math.max(1, Number.parseInt(ticket.maxQuantity, 10) || 10),
      etn_ticket_slug: ticketSlug(ticket, existingTicket),
      etn_enable_ticket: true,
      start_date: saleStart.date, end_date: saleEnd.date, start_time: saleStart.time, end_time: saleEnd.time,
      pending: Number(existingTicket?.pending || 0),
      optiontics_block_ids: existingTicket?.optiontics_block_ids || [],
    };
  });
}

function eventinPayload(body, venue, existingEvent = null) {
  const start = dateParts(body.start);
  const end = dateParts(body.end);
  const existingTickets = Array.isArray(existingEvent?.ticket_variations) ? existingEvent.ticket_variations : [];
  const ticketVariations = eventinTickets(body, start, end, existingTickets);
  const capacities = ticketVariations.map((ticket) => Number(ticket.etn_avaiilable_tickets));
  const totalCapacity = capacities.some((value) => value < 0) ? -1 : capacities.reduce((sum, value) => sum + value, 0);
  return {
    title: text(body.title, 300),
    description: eventContent(body),
    excerpt: text(body.description, 500),
    visibility_status: body.status === "publish" ? "publish" : "draft",
    timezone: "Europe/Paris",
    start_date: start.date,
    end_date: end.date,
    start_time: start.time,
    end_time: end.time,
    event_type: "offline",
    location_type: "venue",
    location: { address: venue },
    ticket_variations: ticketVariations,
    total_ticket: totalCapacity,
    etn_enable_global_stock: false,
    etn_global_stock: 0,
    event_banner: text(body.imageUrl, 2000),
    event_banner_id: Number(body.eventinImage?.mediaId || 0),
  };
}

function cleanHtml(value, limit = 10000) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function eventinValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key] ?? row?.meta?.[key];
    const scalar = value && typeof value === "object"
      ? value.date ?? value.value ?? value.raw ?? value.rendered
      : value;
    if (scalar !== undefined && scalar !== null && String(scalar).trim()) return String(scalar).trim();
  }
  return "";
}

function eventinLocation(row) {
  const value = row?.location ?? row?.event_location ?? row?.etn_event_location
    ?? row?.meta?.event_location ?? row?.meta?.etn_event_location;
  if (typeof value === "string") return value.trim();
  return String(value?.name || value?.title || value?.address || value?.venue_name || "").trim();
}

function normalizedEventinDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const legacy = raw.match(/^(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2})/);
  if (legacy) return `${legacy[3]}-${legacy[2].padStart(2, "0")}-${legacy[1].padStart(2, "0")}`;
  if (/^\d{10,13}$/.test(raw)) {
    const timestamp = Number(raw) * (raw.length === 10 ? 1000 : 1);
    const date = new Date(timestamp);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function normalizedEventinTime(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const match = raw.match(/\b(\d{1,2}):(\d{2})(?:\s*([ap])\.?m\.?)?/i);
  if (!match) return fallback;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = String(match[3] || "").toLowerCase();
  if (meridiem === "p" && hour < 12) hour += 12;
  if (meridiem === "a" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return fallback;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function eventinDateTime(row, kind) {
  const date = normalizedEventinDate(eventinValue(row, kind === "start"
    ? ["etn_start_date", "_etn_start_date", "event_start_date", "start_date"]
    : ["etn_end_date", "_etn_end_date", "event_end_date", "end_date"]));
  const time = normalizedEventinTime(eventinValue(row, kind === "start"
    ? ["etn_start_time", "_etn_start_time", "event_start_time", "start_time"]
    : ["etn_end_time", "_etn_end_time", "event_end_time", "end_time"]), kind === "start" ? "12:00" : "13:00");
  if (!date) return "";
  const combined = `${date}T${time}`;
  return Number.isNaN(new Date(combined).getTime()) ? "" : combined;
}

function imageFromContent(row) {
  const html = String(row?.content?.rendered || row?.description || "");
  return html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || "";
}

const DUTCH_MONTHS = {
  januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6,
  juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12,
};

function inferredEventDate(row) {
  const source = [
    row?.slug,
    row?.title?.rendered,
    row?.excerpt?.rendered,
    row?.content?.rendered,
  ].map((value) => cleanHtml(value, 20000).toLowerCase()).filter(Boolean).join(" ");
  const isoMatch = source.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  const dutchMatch = source.match(/\b(0?[1-9]|[12]\d|3[01])\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(20\d{2})\b/);
  if (!dutchMatch) return "";
  return `${dutchMatch[3]}-${String(DUTCH_MONTHS[dutchMatch[2]]).padStart(2, "0")}-${dutchMatch[1].padStart(2, "0")}`;
}

function normalizeEventinDetail(eventinResponse, wordpressRow, site) {
  const row = eventinResponse?.data || eventinResponse?.event || eventinResponse || {};
  const start = eventinDateTime(row, "start");
  const end = eventinDateTime(row, "end");
  const tickets = Array.isArray(row.ticket_variations) ? row.ticket_variations : [];
  const firstTicket = tickets[0] || {};
  const ticketPrice = Number(firstTicket.etn_ticket_price || 0);
  const unlimited = Boolean(firstTicket.etn_unlimited_tickets) || Number(firstTicket.etn_avaiilable_tickets) < 0;
  const banner = typeof row.event_banner === "string"
    ? row.event_banner
    : row.event_banner?.url || row.event_banner?.source_url || "";
  const location = eventinLocation(row);
  const ticketVariations = tickets.map((ticket, index) => {
    const saleStart = eventinDateTime(ticket, "start");
    const saleEnd = eventinDateTime(ticket, "end");
    const ticketCapacity = Number(ticket.etn_avaiilable_tickets);
    return {
      id: String(ticket.etn_ticket_slug || `ticket-${index + 1}`),
      name: String(ticket.etn_ticket_name || `Ticket ${index + 1}`),
      type: Number(ticket.etn_ticket_price || 0) > 0 ? "paid" : "free",
      price: String(Number(ticket.etn_ticket_price || 0)),
      capacity: ticket.etn_unlimited_tickets || ticketCapacity < 0 ? "" : String(ticketCapacity || ""),
      salesStart: saleStart,
      salesEnd: saleEnd,
      minQuantity: String(ticket.etn_min_ticket || 1),
      maxQuantity: String(ticket.etn_max_ticket || 10),
    };
  });
  return {
    id: String(row.id || wordpressRow?.id || ""),
    title: cleanHtml(row.title?.rendered || row.title || wordpressRow?.title?.rendered, 300),
    description: cleanHtml(row.description?.rendered || row.description || row.content?.rendered || wordpressRow?.content?.rendered || wordpressRow?.excerpt?.rendered),
    start,
    end,
    location,
    imageUrl: String(banner || wordpressRow?._embedded?.["wp:featuredmedia"]?.[0]?.source_url || imageFromContent(wordpressRow)),
    url: String(wordpressRow?.link || row.link || `${site.origin}/?p=${row.id || wordpressRow?.id || ""}`),
    status: (row.visibility_status || wordpressRow?.status) === "draft" ? "draft" : "publish",
    tickets: {
      type: tickets.length ? (ticketPrice > 0 ? "paid" : "free") : "none",
      price: String(ticketPrice),
      capacity: unlimited ? "" : String(firstTicket.etn_avaiilable_tickets || row.total_ticket || ""),
    },
    ticketVariations,
  };
}

function normalizeManagedEvent(row, site) {
  const start = eventinDateTime(row, "start");
  return {
    id: String(row?.id || ""),
    title: cleanHtml(row?.title?.rendered, 300),
    description: cleanHtml(row?.content?.rendered || row?.excerpt?.rendered),
    start,
    end: eventinDateTime(row, "end"),
    eventDate: start ? start.slice(0, 10) : inferredEventDate(row),
    location: eventinLocation(row),
    imageUrl: String(row?._embedded?.["wp:featuredmedia"]?.[0]?.source_url || ""),
    url: String(row?.link || `${site.origin}/?p=${row?.id || ""}`),
    status: row?.status === "draft" ? "draft" : "publish",
  };
}

function dateInTimeZone(timeZone = "Europe/Amsterdam") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function isExpiredEvent(event, today) {
  const finalDate = event.end ? event.end.slice(0, 10) : event.eventDate;
  return Boolean(finalDate) && finalDate < today;
}

async function fetchAllWordPressEvents(endpoint, options) {
  const firstUrl = new URL(endpoint);
  firstUrl.searchParams.set("page", "1");
  const firstResponse = await fetch(firstUrl, options);
  const firstData = await firstResponse.json().catch(() => ([]));
  if (!firstResponse.ok) return { response: firstResponse, data: firstData };

  const totalPages = Math.max(1, Math.min(100, Number(firstResponse.headers.get("x-wp-totalpages")) || 1));
  if (totalPages === 1) return { response: firstResponse, data: Array.isArray(firstData) ? firstData : [] };

  const remainingPages = await Promise.all(Array.from({ length: totalPages - 1 }, async (_, index) => {
    const pageUrl = new URL(endpoint);
    pageUrl.searchParams.set("page", String(index + 2));
    const pageResponse = await fetch(pageUrl, options);
    const pageData = await pageResponse.json().catch(() => ([]));
    if (!pageResponse.ok) throw new Error(pageData?.message || `Eventin-pagina ${index + 2} kon niet worden geladen.`);
    return Array.isArray(pageData) ? pageData : [];
  }));

  return { response: firstResponse, data: [firstData, ...remainingPages].flat() };
}

async function enrichMissingEventDetails(events, site, authorization) {
  if (!authorization) return events;
  const enriched = [...events];
  const missingIndexes = enriched
    .map((event, index) => event.eventDate && event.location ? -1 : index)
    .filter((index) => index >= 0);

  for (let offset = 0; offset < missingIndexes.length; offset += 8) {
    const batch = missingIndexes.slice(offset, offset + 8);
    await Promise.all(batch.map(async (index) => {
      const event = enriched[index];
      const response = await fetch(`${site.origin}/wp-json/eventin/v2/events/${event.id}`, {
        headers: { Authorization: authorization, "User-Agent": "HorecaOS-EventImporter/1.0" },
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = await response.json().catch(() => ({}));
      const row = payload?.data || payload?.event || payload || {};
      const start = eventinDateTime(row, "start");
      const end = eventinDateTime(row, "end");
      enriched[index] = {
        ...event,
        start: start || event.start,
        end: end || event.end,
        eventDate: start ? start.slice(0, 10) : event.eventDate,
        location: event.location || eventinLocation(row),
      };
    }));
  }

  return enriched;
}

function normalizeVenueName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function eventBelongsToVenue(event, venue) {
  const location = normalizeVenueName(event.location);
  const expected = normalizeVenueName(venue);
  if (!location || !expected) return false;
  const aliases = expected.includes("plein")
    ? ["grandcafe het plein", "grand cafe het plein", "het plein"]
    : expected.includes("caribbean corner")
      ? ["caribbean corner"]
      : [expected];
  return aliases.some((alias) => location.includes(alias) || alias.includes(location));
}

async function storedEventBelongsToBusiness(context, body, id) {
  const campaignId = String(body.campaignId || "").trim();
  const businessId = String(body.businessId || "").trim();
  if (!campaignId || !businessId) return false;
  const { data } = await context.client.from("social_content_items")
    .select("id,media")
    .eq("id", campaignId)
    .eq("workspace_id", body.workspaceId)
    .eq("business_id", businessId)
    .maybeSingle();
  const distribution = (data?.media || []).find((entry) => entry?.kind === "campaign_distribution");
  return String(distribution?.eventin_event_id || "") === id && distribution?.source_type === "website_event";
}

async function siteMatchesBusiness(context, body) {
  const businessId = String(body.businessId || "").trim();
  if (!businessId) return false;
  const { data } = await context.client.from("businesses")
    .select("name")
    .eq("id", businessId)
    .eq("workspace_id", body.workspaceId)
    .maybeSingle();
  const name = String(data?.name || "").toLowerCase();
  const expectedSite = name.includes("plein") || name.includes("caribbean") ? "caribbeancorner.nl" : "";
  return Boolean(expectedSite) && text(body.site, 200).toLowerCase() === expectedSite;
}

async function venueForBusiness(context, body) {
  const businessId = String(body.businessId || "").trim();
  if (!businessId) return "";
  const { data } = await context.client.from("businesses")
    .select("name")
    .eq("id", businessId)
    .eq("workspace_id", body.workspaceId)
    .maybeSingle();
  const name = String(data?.name || "").toLowerCase();
  if (name.includes("plein")) return "Grandcafé Het Plein";
  if (name.includes("caribbean")) return "Caribbean Corner";
  return "";
}

export async function GET(request) {
  const url = new URL(request.url);
  const body = {
    workspaceId: url.searchParams.get("workspaceId"),
    businessId: url.searchParams.get("businessId"),
    site: url.searchParams.get("site"),
    campaignId: url.searchParams.get("campaignId"),
    importEvent: url.searchParams.get("importEvent") === "1",
  };
  const context = await ownerContext(request, body.workspaceId);
  if (!context) return NextResponse.json({ error: "Alleen de eigenaar mag bestaande Eventin-evenementen importeren." }, { status: 403 });
  if (!await siteMatchesBusiness(context, body)) return NextResponse.json({ error: "De gekozen Eventin-website hoort niet bij deze vestiging." }, { status: 403 });
  const credentials = siteCredentials(body);
  if (credentials.error && !credentials.configurationRequired) return NextResponse.json({ error: credentials.error }, { status: credentials.status });
  const { site, authorization } = credentials;
  const businessVenue = await venueForBusiness(context, body);
  if (!businessVenue) return NextResponse.json({ error: "Voor deze vestiging is nog geen Eventin-venue ingesteld." }, { status: 400 });
  const requestedEventId = eventId(url.searchParams.get("eventId"));
  if (requestedEventId) {
    if (!authorization) return NextResponse.json({ error: "De beveiligde Eventin-koppeling is nodig om dit evenement te bewerken." }, { status: 503 });
    if (!body.importEvent && !await storedEventBelongsToBusiness(context, body, requestedEventId)) return NextResponse.json({ error: "Dit Eventin-evenement hoort niet bij het gekozen marketingdossier." }, { status: 403 });
    const headers = { Authorization: authorization, "User-Agent": "HorecaOS-EventImporter/1.0" };
    const [eventinResponse, wordpressResponse] = await Promise.all([
      fetch(`${site.origin}/wp-json/eventin/v2/events/${requestedEventId}`, { headers, cache: "no-store" }),
      fetch(`${site.origin}/wp-json/wp/v2/etn/${requestedEventId}?context=edit&_embed=1`, { headers, cache: "no-store" }),
    ]);
    const eventinData = await eventinResponse.json().catch(() => ({}));
    const wordpressData = await wordpressResponse.json().catch(() => ({}));
    if (!eventinResponse.ok || !wordpressResponse.ok) {
      const detail = eventinData?.message || wordpressData?.message || "";
      return NextResponse.json({ error: `De volledige Eventin-gegevens konden niet worden geladen.${detail ? ` ${cleanHtml(detail, 500)}` : ""}` }, { status: eventinResponse.ok ? wordpressResponse.status : eventinResponse.status });
    }
    return NextResponse.json({ event: normalizeEventinDetail(eventinData, wordpressData, site), website: site.origin, readOnly: false });
  }
  const endpoint = new URL("/wp-json/wp/v2/etn", site.origin);
  endpoint.searchParams.set("per_page", "100");
  endpoint.searchParams.set("status", authorization ? "publish,draft" : "publish");
  endpoint.searchParams.set("context", authorization ? "edit" : "view");
  endpoint.searchParams.set("_embed", "1");
  const { response, data } = await fetchAllWordPressEvents(endpoint, { headers: { ...(authorization ? { Authorization: authorization } : {}), "User-Agent": "HorecaOS-EventImporter/1.0" }, cache: "no-store" });
  if (!response.ok) {
    const detail = data?.message ? ` ${String(data.message).replace(/<[^>]*>/g, "")}` : "";
    return NextResponse.json({ error: `De Eventin-evenementen konden niet beveiligd worden opgehaald.${detail}` }, { status: response.status });
  }
  const today = dateInTimeZone();
  const normalizedEvents = (Array.isArray(data) ? data : [])
    .map((row) => normalizeManagedEvent(row, site))
    .filter((event) => event.id && event.title);
  const eventsWithDetails = await enrichMissingEventDetails(normalizedEvents, site, authorization);
  const events = eventsWithDetails
    .filter((event) => eventBelongsToVenue(event, businessVenue))
    .map((event) => ({ ...event, expired: isExpiredEvent(event, today) }))
    .sort((left, right) => {
      if (left.eventDate && right.eventDate) return left.eventDate.localeCompare(right.eventDate);
      if (left.eventDate) return -1;
      if (right.eventDate) return 1;
      return left.title.localeCompare(right.title, "nl-NL");
    });
  return NextResponse.json({
    events,
    website: site.origin,
    readOnly: !authorization,
    warning: !authorization ? "Alleen gepubliceerde evenementen zijn geladen. Bewerken en annuleren vereisen later de beveiligde Eventin-koppeling." : "",
  });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const context = await ownerContext(request, body.workspaceId);
  if (!context) return NextResponse.json({ error: "Alleen de eigenaar mag website-evenementen aanmaken." }, { status: 403 });

  const credentials = siteCredentials(body);
  if (credentials.error) return NextResponse.json({ error: credentials.error, configurationRequired: credentials.configurationRequired }, { status: credentials.status });
  const { site, authorization } = credentials;

  const start = dateParts(body.start);
  const end = dateParts(body.end);
  if (!text(body.title) || !start || !end || new Date(body.end) <= new Date(body.start)) {
    return NextResponse.json({ error: "Controleer de titel en de begin- en eindtijd." }, { status: 400 });
  }
  const ticketError = ticketValidationError(body);
  if (ticketError) return NextResponse.json({ error: ticketError }, { status: 400 });
  const venue = await venueForBusiness(context, body);
  if (!venue) return NextResponse.json({ error: "Voor deze vestiging is nog geen Eventin-venue ingesteld." }, { status: 400 });
  const payload = eventinPayload(body, venue);

  const response = await fetch(`${site.origin}/wp-json/eventin/v2/events`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      "User-Agent": "HorecaOS-EventPublisher/1.0",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.message ? ` ${String(data.message).replace(/<[^>]*>/g, "")}` : "";
    return NextResponse.json({ error: `Eventin heeft het evenement niet geaccepteerd.${detail}` }, { status: response.status });
  }
  return NextResponse.json({
    event: {
      id: String(data.id || ""),
      url: data.link || `${site.origin}/?p=${data.id}`,
      status: data.visibility_status || payload.visibility_status,
      website: site.origin,
    },
  });
}

export async function PATCH(request) {
  const body = await request.json().catch(() => ({}));
  const context = await ownerContext(request, body.workspaceId);
  if (!context) return NextResponse.json({ error: "Alleen de eigenaar mag website-evenementen wijzigen." }, { status: 403 });
  const id = eventId(body.eventId);
  if (!id) return NextResponse.json({ error: "Het Eventin-evenement ontbreekt." }, { status: 400 });
  if (!await storedEventBelongsToBusiness(context, body, id)) return NextResponse.json({ error: "Dit Eventin-evenement hoort niet bij het gekozen marketingdossier." }, { status: 403 });
  if (!await siteMatchesBusiness(context, body)) return NextResponse.json({ error: "De gekozen Eventin-website hoort niet bij deze vestiging." }, { status: 403 });
  const credentials = siteCredentials(body);
  if (credentials.error) return NextResponse.json({ error: credentials.error, configurationRequired: credentials.configurationRequired }, { status: credentials.status });
  const { site, authorization } = credentials;
  if (body.action === "publish" || body.action === "draft") {
    const visibilityStatus = body.action;
    const response = await fetch(`${site.origin}/wp-json/wp/v2/etn/${id}`, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json", "User-Agent": "HorecaOS-EventPublisher/1.0" },
      body: JSON.stringify({ status: visibilityStatus }),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.message ? ` ${String(data.message).replace(/<[^>]*>/g, "")}` : "";
      return NextResponse.json({ error: `Eventin heeft de statuswijziging niet geaccepteerd.${detail}` }, { status: response.status });
    }
    return NextResponse.json({ event: { id, url: data.link || `${site.origin}/?p=${id}`, status: data.status || visibilityStatus, website: site.origin } });
  }
  const start = dateParts(body.start);
  const end = dateParts(body.end);
  if (!text(body.title) || !start || !end || new Date(body.end) <= new Date(body.start)) {
    return NextResponse.json({ error: "Controleer de titel en de begin- en eindtijd." }, { status: 400 });
  }
  const ticketError = ticketValidationError(body);
  if (ticketError) return NextResponse.json({ error: ticketError }, { status: 400 });
  const currentResponse = await fetch(`${site.origin}/wp-json/eventin/v2/events/${id}`, {
    headers: { Authorization: authorization, "User-Agent": "HorecaOS-EventPublisher/1.0" },
    cache: "no-store",
  });
  const currentEventResponse = currentResponse.ok ? await currentResponse.json().catch(() => null) : null;
  const currentEvent = currentEventResponse?.data || currentEventResponse?.event || currentEventResponse;
  const venue = await venueForBusiness(context, body);
  if (!venue) return NextResponse.json({ error: "Voor deze vestiging is nog geen Eventin-venue ingesteld." }, { status: 400 });
  const payload = eventinPayload(body, venue, currentEvent);
  const response = await fetch(`${site.origin}/wp-json/eventin/v2/events/${id}`, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json", "User-Agent": "HorecaOS-EventPublisher/1.0" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.message ? ` ${String(data.message).replace(/<[^>]*>/g, "")}` : "";
    return NextResponse.json({ error: `Eventin heeft de wijziging niet geaccepteerd.${detail}` }, { status: response.status });
  }
  return NextResponse.json({ event: { id, url: data.link || `${site.origin}/?p=${id}`, status: data.visibility_status || payload.visibility_status, website: site.origin } });
}

export async function DELETE(request) {
  const body = await request.json().catch(() => ({}));
  const context = await ownerContext(request, body.workspaceId);
  if (!context) return NextResponse.json({ error: "Alleen de eigenaar mag website-evenementen annuleren." }, { status: 403 });
  const id = eventId(body.eventId);
  if (!id) return NextResponse.json({ error: "Het Eventin-evenement ontbreekt." }, { status: 400 });
  if (!await storedEventBelongsToBusiness(context, body, id)) return NextResponse.json({ error: "Dit Eventin-evenement hoort niet bij het gekozen marketingdossier." }, { status: 403 });
  if (!await siteMatchesBusiness(context, body)) return NextResponse.json({ error: "De gekozen Eventin-website hoort niet bij deze vestiging." }, { status: 403 });
  const mode = ["draft", "cancelled"].includes(body.mode) ? body.mode : "trash";
  const credentials = siteCredentials(body);
  if (credentials.error) return NextResponse.json({ error: credentials.error, configurationRequired: credentials.configurationRequired }, { status: credentials.status });
  const { site, authorization } = credentials;
  let cancelledTitle = "";
  if (mode === "cancelled") {
    const currentResponse = await fetch(`${site.origin}/wp-json/wp/v2/etn/${id}?context=edit`, {
      headers: { Authorization: authorization, "User-Agent": "HorecaOS-EventPublisher/1.0" },
      cache: "no-store",
    });
    const current = await currentResponse.json().catch(() => ({}));
    if (!currentResponse.ok) return NextResponse.json({ error: "Het bestaande Eventin-evenement kon niet worden gelezen." }, { status: currentResponse.status });
    const currentTitle = text(current.title?.raw || current.title?.rendered || "Evenement");
    cancelledTitle = /^geannuleerd\s*[—-]/i.test(currentTitle) ? currentTitle : `GEANNULEERD — ${currentTitle}`;
  }
  const response = await fetch(`${site.origin}/wp-json/wp/v2/etn/${id}`, {
    method: mode === "trash" ? "DELETE" : "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json", "User-Agent": "HorecaOS-EventPublisher/1.0" },
    body: mode === "draft" ? JSON.stringify({ status: "draft" }) : mode === "cancelled" ? JSON.stringify({ status: "publish", title: cancelledTitle }) : undefined,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.message ? ` ${String(data.message).replace(/<[^>]*>/g, "")}` : "";
    return NextResponse.json({ error: `Eventin heeft de actie niet geaccepteerd.${detail}` }, { status: response.status });
  }
  return NextResponse.json({ event: { id, url: data.link || "", status: mode, website: site.origin } });
}

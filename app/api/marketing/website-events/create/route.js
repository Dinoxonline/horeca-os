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
  const ticket = body.ticketType === "paid"
    ? `Ticketprijs: € ${Number(body.ticketPrice || 0).toFixed(2)}`
    : body.ticketType === "free" ? "Gratis toegang" : "";
  const capacity = body.capacity ? `Capaciteit: ${Number(body.capacity)} personen` : "";
  const image = text(body.imageUrl, 2000);
  return [
    image ? `<figure><img src="${image.replace(/"/g, "&quot;")}" alt="" /></figure>` : "",
    `<p>${text(body.description).replace(/\n/g, "<br>")}</p>`,
    "<hr>",
    `<p><strong>Locatie:</strong> ${text(body.location, 500)}</p>`,
    ticket ? `<p><strong>Tickets:</strong> ${ticket}</p>` : "",
    capacity ? `<p><strong>Capaciteit:</strong> ${capacity}</p>` : "",
  ].filter(Boolean).join("\n");
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

function ticketSlug(body, existingTicket) {
  if (existingTicket?.etn_ticket_slug) return existingTicket.etn_ticket_slug;
  const label = text(body.title, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
  return `horeca-os-${label}-${Date.now().toString(36)}`;
}

function eventinTicket(body, start, end, existingTicket) {
  if (body.ticketType === "none") return [];
  const capacity = Math.max(0, Number.parseInt(body.capacity, 10) || 0);
  const price = body.ticketType === "paid" ? Math.max(0, Number(body.ticketPrice || 0)) : 0;
  return [{
    etn_ticket_name: body.ticketType === "paid" ? "Ticket" : "Gratis ticket",
    etn_ticket_description: text(body.shortDescription || body.description, 150),
    etn_ticket_price: price,
    etn_avaiilable_tickets: capacity || -1,
    etn_unlimited_tickets: !capacity,
    etn_sold_tickets: Number(existingTicket?.etn_sold_tickets || 0),
    etn_min_ticket: 1,
    etn_max_ticket: capacity ? Math.min(capacity, 10) : 10,
    etn_ticket_slug: ticketSlug(body, existingTicket),
    etn_enable_ticket: true,
    start_date: start.date,
    end_date: end.date,
    start_time: start.time,
    end_time: end.time,
    pending: 0,
    optiontics_block_ids: [],
  }];
}

function eventinPayload(body, venue, existingEvent = null) {
  const start = dateParts(body.start);
  const end = dateParts(body.end);
  const capacity = Math.max(0, Number.parseInt(body.capacity, 10) || 0);
  const existingTicket = Array.isArray(existingEvent?.ticket_variations) ? existingEvent.ticket_variations[0] : null;
  const ticketVariations = eventinTicket(body, start, end, existingTicket);
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
    total_ticket: capacity || (ticketVariations.length ? -1 : 0),
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
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function eventinDateTime(row, kind) {
  const date = eventinValue(row, kind === "start" ? ["etn_start_date", "start_date"] : ["etn_end_date", "end_date"]);
  const time = eventinValue(row, kind === "start" ? ["etn_start_time", "start_time"] : ["etn_end_time", "end_time"]);
  if (!date) return "";
  const combined = `${date}T${time || (kind === "start" ? "12:00" : "13:00")}`;
  return Number.isNaN(new Date(combined).getTime()) ? "" : combined;
}

function normalizeManagedEvent(row, site) {
  return {
    id: String(row?.id || ""),
    title: cleanHtml(row?.title?.rendered, 300),
    description: cleanHtml(row?.content?.rendered || row?.excerpt?.rendered),
    start: eventinDateTime(row, "start"),
    end: eventinDateTime(row, "end"),
    location: eventinValue(row, ["event_location", "etn_event_location"]),
    imageUrl: String(row?._embedded?.["wp:featuredmedia"]?.[0]?.source_url || ""),
    url: String(row?.link || `${site.origin}/?p=${row?.id || ""}`),
    status: row?.status === "draft" ? "draft" : "publish",
  };
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
  };
  const context = await ownerContext(request, body.workspaceId);
  if (!context) return NextResponse.json({ error: "Alleen de eigenaar mag bestaande Eventin-evenementen importeren." }, { status: 403 });
  if (!await siteMatchesBusiness(context, body)) return NextResponse.json({ error: "De gekozen Eventin-website hoort niet bij deze vestiging." }, { status: 403 });
  const credentials = siteCredentials(body);
  if (credentials.error && !credentials.configurationRequired) return NextResponse.json({ error: credentials.error }, { status: credentials.status });
  const { site, authorization } = credentials;
  const endpoint = new URL("/wp-json/wp/v2/etn", site.origin);
  endpoint.searchParams.set("per_page", "100");
  endpoint.searchParams.set("status", authorization ? "publish,draft" : "publish");
  endpoint.searchParams.set("context", authorization ? "edit" : "view");
  endpoint.searchParams.set("_embed", "1");
  const response = await fetch(endpoint, { headers: { ...(authorization ? { Authorization: authorization } : {}), "User-Agent": "HorecaOS-EventImporter/1.0" }, cache: "no-store" });
  const data = await response.json().catch(() => ([]));
  if (!response.ok) {
    const detail = data?.message ? ` ${String(data.message).replace(/<[^>]*>/g, "")}` : "";
    return NextResponse.json({ error: `De Eventin-evenementen konden niet beveiligd worden opgehaald.${detail}` }, { status: response.status });
  }
  const events = (Array.isArray(data) ? data : []).map((row) => normalizeManagedEvent(row, site)).filter((event) => event.id && event.title);
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
  const start = dateParts(body.start);
  const end = dateParts(body.end);
  if (!text(body.title) || !start || !end || new Date(body.end) <= new Date(body.start)) {
    return NextResponse.json({ error: "Controleer de titel en de begin- en eindtijd." }, { status: 400 });
  }
  const currentResponse = await fetch(`${site.origin}/wp-json/eventin/v2/events/${id}`, {
    headers: { Authorization: authorization, "User-Agent": "HorecaOS-EventPublisher/1.0" },
    cache: "no-store",
  });
  const currentEvent = currentResponse.ok ? await currentResponse.json().catch(() => null) : null;
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
  const mode = body.mode === "draft" ? "draft" : "trash";
  const credentials = siteCredentials(body);
  if (credentials.error) return NextResponse.json({ error: credentials.error, configurationRequired: credentials.configurationRequired }, { status: credentials.status });
  const { site, authorization } = credentials;
  const response = await fetch(`${site.origin}/wp-json/wp/v2/etn/${id}`, {
    method: mode === "draft" ? "POST" : "DELETE",
    headers: { Authorization: authorization, "Content-Type": "application/json", "User-Agent": "HorecaOS-EventPublisher/1.0" },
    body: mode === "draft" ? JSON.stringify({ status: "draft" }) : undefined,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.message ? ` ${String(data.message).replace(/<[^>]*>/g, "")}` : "";
    return NextResponse.json({ error: `Eventin heeft de actie niet geaccepteerd.${detail}` }, { status: response.status });
  }
  return NextResponse.json({ event: { id, url: data.link || "", status: mode === "draft" ? "draft" : "trash", website: site.origin } });
}

import { NextResponse } from "next/server";
import { createUserSupabase } from "../../../../lib/server-supabase";

const ALLOWED_HOSTS = new Set([
  "caribbeancorner.nl", "www.caribbeancorner.nl",
  "grandcafehetplein.com", "www.grandcafehetplein.com",
  "leclubbbq.nl", "www.leclubbbq.nl",
]);

export async function POST(request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  const userClient = createUserSupabase(token);
  const { data: authData } = await userClient.auth.getUser(token);
  if (!authData?.user) return NextResponse.json({ error: "Sessie is verlopen." }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Ongeldig verzoek." }, { status: 400 }); }
  let sourceUrl;
  try { sourceUrl = new URL(String(body.sourceUrl || "")); } catch { return NextResponse.json({ error: "Vul een geldige eventlink in." }, { status: 400 }); }
  if (sourceUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(sourceUrl.hostname.toLowerCase())) {
    return NextResponse.json({ error: "Gebruik een HTTPS-eventlink van Caribbean Corner, GrandcafÃ© Het Plein of Le Club BBQ." }, { status: 400 });
  }

  try {
    const { response, finalUrl } = await fetchAllowed(sourceUrl);
    if (!response.ok) throw new Error("De eventpagina gaf geen geldig antwoord.");
    const html = await response.text();
    if (html.length > 2_000_000) throw new Error("De eventpagina is te groot om veilig in te lezen.");
    const jsonLd = findEventJsonLd(html);
    const title = cleanText(jsonLd?.name || meta(html, "property", "og:title") || tagTitle(html));
    const description = cleanText(jsonLd?.description || meta(html, "property", "og:description") || meta(html, "name", "description"));
    const imageValue = Array.isArray(jsonLd?.image) ? jsonLd.image[0] : jsonLd?.image;
    const image = absoluteUrl(imageValue?.url || imageValue || meta(html, "property", "og:image"), finalUrl);
    const location = cleanText(typeof jsonLd?.location === "string" ? jsonLd.location : [jsonLd?.location?.name, jsonLd?.location?.address?.streetAddress, jsonLd?.location?.address?.addressLocality].filter(Boolean).join(", "));
    if (!title) return NextResponse.json({ error: "Op deze pagina zijn geen herkenbare Eventin-eventgegevens gevonden." }, { status: 422 });
    return NextResponse.json({ event: { title, description, image, startDate: validDate(jsonLd?.startDate), endDate: validDate(jsonLd?.endDate), location, sourceUrl: finalUrl.toString(), sourceSystem: "Eventin van Team Winter" } });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Het evenement kon niet worden ingelezen." }, { status: 502 });
  }
}

async function fetchAllowed(initialUrl) {
  let current = initialUrl;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!ALLOWED_HOSTS.has(current.hostname.toLowerCase())) throw new Error("De eventlink verwijst naar een niet-toegestane website.");
    const response = await fetch(current, { cache: "no-store", redirect: "manual", headers: { "User-Agent": "HorecaOS-EventPreview/1.0" } });
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, finalUrl: current };
    const location = response.headers.get("location");
    if (!location) throw new Error("De eventpagina verwijst onjuist door.");
    current = new URL(location, current);
    if (current.protocol !== "https:") throw new Error("De eventpagina verwijst niet veilig door.");
  }
  throw new Error("De eventpagina verwijst te vaak door.");
}

function findEventJsonLd(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1]);
      const items = Array.isArray(parsed) ? parsed : parsed?.["@graph"] || [parsed];
      const event = items.find((item) => item?.["@type"] === "Event" || (Array.isArray(item?.["@type"]) && item["@type"].includes("Event")));
      if (event) return event;
    } catch { /* Continue with the next metadata block. */ }
  }
  return null;
}

function meta(html, attribute, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = new RegExp(`<meta[^>]+${attribute}=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i").exec(html);
  if (first?.[1]) return first[1];
  return new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attribute}=["']${escaped}["'][^>]*>`, "i").exec(html)?.[1] || "";
}

function tagTitle(html) { return /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || ""; }
function cleanText(value) { return String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#039;|&apos;/gi, "'").replace(/\s+/g, " ").trim().slice(0, 5000); }
function absoluteUrl(value, base) { if (!value) return ""; try { return new URL(value, base).toString(); } catch { return ""; } }
function validDate(value) { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toISOString(); }


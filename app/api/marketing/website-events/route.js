import { NextResponse } from "next/server";
import { createUserSupabase } from "../../../../lib/server-supabase";

const ALLOWED_SITES = new Map([
  ["caribbeancorner.nl", "https://caribbeancorner.nl"],
  ["www.caribbeancorner.nl", "https://caribbeancorner.nl"],
  ["grandcafehetplein.com", "https://grandcafehetplein.com"],
  ["www.grandcafehetplein.com", "https://grandcafehetplein.com"],
]);

export async function GET(request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  const userClient = createUserSupabase(token);
  const { data: authData } = await userClient.auth.getUser(token);
  if (!authData?.user) return NextResponse.json({ error: "Sessie is verlopen." }, { status: 401 });

  const hostname = String(new URL(request.url).searchParams.get("site") || "").toLowerCase();
  const origin = ALLOWED_SITES.get(hostname);
  if (!origin) return NextResponse.json({ error: "Voor deze vestiging is nog geen Eventin-website ingesteld." }, { status: 400 });

  try {
    const url = new URL("/wp-json/wp/v2/etn", origin);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("status", "publish");
    url.searchParams.set("_embed", "1");
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "HorecaOS-EventCalendar/1.0" },
    });
    if (!response.ok) throw new Error(response.status === 404
      ? "Op deze website is geen openbare Eventin-agenda gevonden."
      : "De Eventin-agenda kon niet worden opgehaald.");
    const rows = await response.json();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const events = (Array.isArray(rows) ? rows : [])
      .map(normalizeEvent)
      .filter((event) => !event.startDate || new Date(event.startDate) >= today)
      .sort((left, right) => String(left.startDate || "9999").localeCompare(String(right.startDate || "9999")));
    return NextResponse.json({ events, source: "Eventin", website: origin });
  } catch (error) {
    return NextResponse.json({ error: error.message || "De websiteagenda kon niet worden geladen." }, { status: 502 });
  }
}

function normalizeEvent(row) {
  const title = cleanText(row?.title?.rendered);
  const startDate = dateFromSlug(row?.slug) || dateFromTitle(title);
  return {
    id: String(row?.id || row?.slug || ""),
    title,
    description: cleanText(row?.excerpt?.rendered || row?.content?.rendered),
    sourceUrl: safeUrl(row?.link),
    image: safeUrl(row?._embedded?.["wp:featuredmedia"]?.[0]?.source_url),
    startDate: startDate ? startDate.toISOString() : "",
    sourceSystem: "Eventin van ThemeWinter",
  };
}

function dateFromSlug(slug) {
  const match = String(slug || "").match(/(?:^|[^\d])(20\d{2})-(\d{2})-(\d{2})(?:[^\d]|$)/);
  if (!match) return null;
  return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function dateFromTitle(title) {
  const months = { januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6, juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12 };
  const match = String(title || "").toLowerCase().match(/(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(20\d{2})/);
  return match ? validDate(Number(match[3]), months[match[2]], Number(match[1])) : null;
}

function validDate(year, month, day) {
  const date = new Date(year, month - 1, day, 12, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&#8230;/gi, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 5000);
}

function safeUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

import { NextResponse } from "next/server";
import { createUserSupabase } from "../../../../../lib/server-supabase";

const SITES = {
  "caribbeancorner.nl": {
    origin: "https://caribbeancorner.nl",
    username: "EVENTIN_CARIBBEAN_USERNAME",
    password: "EVENTIN_CARIBBEAN_APPLICATION_PASSWORD",
  },
  "grandcafehetplein.com": {
    origin: "https://grandcafehetplein.com",
    username: "EVENTIN_PLEIN_USERNAME",
    password: "EVENTIN_PLEIN_APPLICATION_PASSWORD",
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

async function eventinProperties(origin, authorization) {
  try {
    const response = await fetch(`${origin}/wp-json/wp/v2/etn`, {
      method: "OPTIONS",
      headers: { Authorization: authorization, "User-Agent": "HorecaOS-EventPublisher/1.0" },
      cache: "no-store",
    });
    const schema = response.ok ? await response.json() : null;
    return schema?.schema?.properties || {};
  } catch {
    return {};
  }
}

function addKnownEventinFields(payload, properties, body) {
  const start = dateParts(body.start);
  const end = dateParts(body.end);
  if (!start || !end) return payload;
  const candidates = {
    etn_start_date: start.date,
    etn_end_date: end.date,
    etn_start_time: start.time,
    etn_end_time: end.time,
    start_date: start.date,
    end_date: end.date,
    start_time: start.time,
    end_time: end.time,
    event_location: text(body.location, 500),
    etn_event_location: text(body.location, 500),
  };
  for (const [key, value] of Object.entries(candidates)) {
    if (Object.prototype.hasOwnProperty.call(properties, key)) payload[key] = value;
  }
  return payload;
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const context = await ownerContext(request, body.workspaceId);
  if (!context) return NextResponse.json({ error: "Alleen de eigenaar mag website-evenementen aanmaken." }, { status: 403 });

  const site = SITES[text(body.site, 200).toLowerCase()];
  if (!site) return NextResponse.json({ error: "Voor deze vestiging is nog geen Eventin-website ingesteld." }, { status: 400 });
  const username = process.env[site.username] || process.env.EVENTIN_USERNAME;
  const password = process.env[site.password] || process.env.EVENTIN_APPLICATION_PASSWORD;
  if (!username || !password) {
    return NextResponse.json({
      error: `De beveiligde Eventin-schrijfkoppeling voor ${body.site} moet nog eenmalig onder Vercel → Environment Variables worden ingesteld (${site.username} en ${site.password}).`,
      configurationRequired: true,
    }, { status: 503 });
  }

  const start = dateParts(body.start);
  const end = dateParts(body.end);
  if (!text(body.title) || !start || !end || new Date(body.end) <= new Date(body.start)) {
    return NextResponse.json({ error: "Controleer de titel en de begin- en eindtijd." }, { status: 400 });
  }
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const properties = await eventinProperties(site.origin, authorization);
  const payload = addKnownEventinFields({
    title: text(body.title, 300),
    content: eventContent(body),
    excerpt: text(body.description, 500),
    status: body.status === "publish" ? "publish" : "draft",
  }, properties, body);

  const response = await fetch(`${site.origin}/wp-json/wp/v2/etn`, {
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
      status: data.status || payload.status,
      website: site.origin,
    },
  });
}

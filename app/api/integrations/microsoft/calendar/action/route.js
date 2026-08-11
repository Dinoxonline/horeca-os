import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../../lib/server-supabase";
import { decryptMetaToken } from "../../../../../../lib/meta-oauth";

function accessToken(row) {
  return decryptMetaToken({ token_ciphertext: row.access_token_ciphertext, token_iv: row.access_token_iv, token_tag: row.access_token_tag });
}

async function context(request, workspaceId, mailbox) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !workspaceId || !mailbox) return null;
  const client = createUserSupabase(token);
  const { data } = await client.auth.getUser(token);
  if (!data?.user) return null;
  const { data: member } = await client.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", data.user.id).maybeSingle();
  if (member?.role !== "owner") return null;
  const admin = createAdminSupabase();
  const { data: connection } = await admin.from("calendar_connections").select("*").eq("workspace_id", workspaceId).eq("user_id", data.user.id).eq("provider", "microsoft").eq("email", mailbox).maybeSingle();
  return connection ? { connection } : null;
}

function eventPayload(body) {
  const attendees = (body.attendees || []).map((address) => String(address).trim()).filter(Boolean).map((address) => ({
    emailAddress: { address },
    type: "required",
  }));
  const startDate = new Date(body.start);
  const recurrenceType = String(body.recurrence || "none");
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  let recurrence = null;
  if (recurrenceType !== "none") {
    const pattern = recurrenceType === "daily"
      ? { type: "daily", interval: 1 }
      : recurrenceType === "weekly"
        ? { type: "weekly", interval: 1, daysOfWeek: [dayNames[startDate.getDay()]], firstDayOfWeek: "monday" }
        : recurrenceType === "monthly"
          ? { type: "absoluteMonthly", interval: 1, dayOfMonth: startDate.getDate() }
          : { type: "absoluteYearly", interval: 1, dayOfMonth: startDate.getDate(), month: startDate.getMonth() + 1 };
    recurrence = { pattern, range: { type: "noEnd", startDate: startDate.toISOString().slice(0, 10) } };
  }
  return {
    subject: String(body.subject || "").trim() || "(Geen onderwerp)",
    body: { contentType: "text", content: String(body.description || "") },
    start: { dateTime: body.start, timeZone: "Europe/Amsterdam" },
    end: { dateTime: body.end, timeZone: "Europe/Amsterdam" },
    isAllDay: Boolean(body.isAllDay),
    location: { displayName: String(body.location || "") },
    attendees,
    recurrence,
    isReminderOn: Number(body.reminderMinutes) >= 0,
    reminderMinutesBeforeStart: Math.max(0, Number(body.reminderMinutes) || 0),
    showAs: ["free", "tentative", "busy", "oof", "workingElsewhere"].includes(body.showAs) ? body.showAs : "busy",
    sensitivity: body.isPrivate ? "private" : "normal",
    isOnlineMeeting: Boolean(body.isOnlineMeeting),
    onlineMeetingProvider: body.isOnlineMeeting ? "teamsForBusiness" : undefined,
    responseRequested: attendees.length > 0,
    allowNewTimeProposals: attendees.length > 0,
  };
}

async function graph(token, path, options = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: 'outlook.timezone="Europe/Amsterdam"',
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const result = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error?.message || "De afspraak kon niet worden aangepast.");
  return result;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const auth = await context(request, body.workspaceId, body.mailbox);
    if (!auth) return NextResponse.json({ error: "Geen toegang tot deze agenda." }, { status: 403 });
    if (!body.start || !body.end) return NextResponse.json({ error: "Vul een begin- en eindtijd in." }, { status: 400 });
    const event = await graph(accessToken(auth.connection), "events", { method: "POST", body: JSON.stringify(eventPayload(body)) });
    return NextResponse.json({ event, message: "De afspraak is aangemaakt." });
  } catch (error) {
    return NextResponse.json({ error: error.message || "De afspraak kon niet worden aangemaakt." }, { status: 400 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const auth = await context(request, body.workspaceId, body.mailbox);
    if (!auth) return NextResponse.json({ error: "Geen toegang tot deze agenda." }, { status: 403 });
    if (!body.eventId || !body.start || !body.end) return NextResponse.json({ error: "De afspraakgegevens zijn niet compleet." }, { status: 400 });
    const event = await graph(accessToken(auth.connection), `events/${encodeURIComponent(body.eventId)}`, { method: "PATCH", body: JSON.stringify(eventPayload(body)) });
    return NextResponse.json({ event, message: "De afspraak is gewijzigd." });
  } catch (error) {
    return NextResponse.json({ error: error.message || "De afspraak kon niet worden gewijzigd." }, { status: 400 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const auth = await context(request, body.workspaceId, body.mailbox);
    if (!auth) return NextResponse.json({ error: "Geen toegang tot deze agenda." }, { status: 403 });
    if (!body.eventId || !["accept", "tentativelyAccept", "decline"].includes(body.response)) {
      return NextResponse.json({ error: "Kies een geldige reactie op de uitnodiging." }, { status: 400 });
    }
    await graph(accessToken(auth.connection), `events/${encodeURIComponent(body.eventId)}/${body.response}`, {
      method: "POST",
      body: JSON.stringify({ comment: String(body.comment || ""), sendResponse: true }),
    });
    const labels = { accept: "geaccepteerd", tentativelyAccept: "voorlopig geaccepteerd", decline: "geweigerd" };
    return NextResponse.json({ message: `De uitnodiging is ${labels[body.response]}.` });
  } catch (error) {
    return NextResponse.json({ error: error.message || "De reactie kon niet worden verzonden." }, { status: 400 });
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json();
    const auth = await context(request, body.workspaceId, body.mailbox);
    if (!auth) return NextResponse.json({ error: "Geen toegang tot deze agenda." }, { status: 403 });
    if (!body.eventId) return NextResponse.json({ error: "De afspraak ontbreekt." }, { status: 400 });
    await graph(accessToken(auth.connection), `events/${encodeURIComponent(body.eventId)}`, { method: "DELETE" });
    return NextResponse.json({ message: "De afspraak is verwijderd." });
  } catch (error) {
    return NextResponse.json({ error: error.message || "De afspraak kon niet worden verwijderd." }, { status: 400 });
  }
}

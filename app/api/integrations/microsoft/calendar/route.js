import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../lib/server-supabase";
import { decryptMetaToken } from "../../../../../lib/meta-oauth";

function accessToken(row) {
  return decryptMetaToken({ token_ciphertext: row.access_token_ciphertext, token_iv: row.access_token_iv, token_tag: row.access_token_tag });
}
async function context(request, workspaceId) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !workspaceId) return null;
  const client = createUserSupabase(token);
  const { data } = await client.auth.getUser(token);
  if (!data?.user) return null;
  const { data: member } = await client.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", data.user.id).maybeSingle();
  if (member?.role !== "owner") return null;
  return { user: data.user, admin: createAdminSupabase() };
}
async function graph(token, path) {
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/${path}`, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="Europe/Amsterdam"' }, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "De Microsoft-agenda kon niet worden gelezen.");
  return result.value || [];
}
export async function GET(request) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const start = url.searchParams.get("start") || new Date().toISOString();
  const end = url.searchParams.get("end") || new Date(Date.now() + 30 * 86400000).toISOString();
  const auth = await context(request, workspaceId);
  if (!auth) return NextResponse.json({ error: "Alleen de eigenaar heeft toegang tot dit agendaoverzicht." }, { status: 403 });
  const { data: connections } = await auth.admin.from("calendar_connections").select("*").eq("workspace_id", workspaceId).eq("user_id", auth.user.id).eq("provider", "microsoft");
  const accounts = await Promise.all((connections || []).map(async (connection) => {
    try {
      const token = accessToken(connection);
      const [calendars, events] = await Promise.all([
        graph(token, "calendars?$select=id,name,color,canEdit,owner"),
        graph(token, `calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$select=id,subject,start,end,location,organizer,attendees,bodyPreview,isAllDay,webLink,showAs,onlineMeetingUrl,recurrence,isReminderOn,reminderMinutesBeforeStart,type&$orderby=start/dateTime&$top=100`),
      ]);
      return { mailbox: connection.email, calendars, events, error: null };
    } catch (error) {
      return { mailbox: connection.email, calendars: [], events: [], error: error.message };
    }
  }));
  return NextResponse.json({ accounts, start, end });
}

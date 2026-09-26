import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../lib/server-supabase";
import { microsoftAccessToken } from "../../../../lib/microsoft-token";
import { EVENT_MAILBOX } from "../../../../lib/event-calendar";
import { eventCalendarAction } from "../../../../lib/event-calendar-service";

export const maxDuration = 60;
const reply = (data, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request) {
  let input;
  try { input = await request.json(); } catch { return reply({ error: "Ongeldig verzoek." }, 400); }
  if (!["check", "create", "update", "link"].includes(input?.action) || ![input.workspaceId, input.businessId, input.itemId].every(v => typeof v === "string" && v.length > 0 && v.length < 100) || !(input.revision === null || typeof input.revision === "string")) return reply({ error: "Evenement of versie ontbreekt." }, 400);
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return reply({ error: "Log opnieuw in." }, 401);
    const client = createUserSupabase(token);
    const { data: auth, error } = await client.auth.getUser(token);
    if (error || !auth?.user) return reply({ error: "Je sessie is verlopen." }, 401);
    let aal;
    try { aal = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).aal; } catch { aal = null; }
    if (aal !== "aal2") return reply({ error: "Bevestig eerst je tweestapsverificatie." }, 403);
    // Same owner-only mailbox access model as the existing Microsoft calendar module.
    const { data: member, error: memberError } = await client.from("workspace_members").select("role").eq("workspace_id", input.workspaceId).eq("user_id", auth.user.id).maybeSingle();
    if (memberError || member?.role !== "owner") return reply({ error: "Alleen de eigenaar heeft toegang tot deze gekoppelde agenda." }, 403);
    const admin = createAdminSupabase();
    const scope = q => q.eq("workspace_id", input.workspaceId).eq("business_id", input.businessId).eq("id", input.itemId);
    const repo = {
      read: async () => { const { data, error } = await scope(admin.from("social_content_items").select("id,media,body,updated_at")).maybeSingle(); if (error) throw new Error("Evenement laden mislukt."); return data; },
      write: async (version, media) => { const { data, error } = await scope(admin.from("social_content_items").update({ media })).eq("updated_at", version).select("id").maybeSingle(); if (error) throw new Error("Opslag mislukt."); return Boolean(data?.id); },
    };
    // Authorize the item before looking up credentials or calling Microsoft.
    if (!(await repo.read())) return reply({ error: "Evenement niet toegankelijk." }, 404);
    const { data: connection, error: connectionError } = await admin.from("calendar_connections").select("*").eq("workspace_id", input.workspaceId).eq("user_id", auth.user.id).eq("provider", "microsoft").eq("email", EVENT_MAILBOX).maybeSingle();
    if (connectionError || !connection) return reply({ error: "Koppel eerst de Microsoft-agenda van info@leclubbbq.nl via Agenda. Er is niets ingepland.", needsConnection: true }, 409);
    const graph = async (path, options = {}, allowMissing = false) => {
      const send = async forceRefresh => fetch(`https://graph.microsoft.com/v1.0/${path}`, { ...options, signal: AbortSignal.timeout(12000), cache: "no-store", headers: { Authorization: `Bearer ${await microsoftAccessToken(connection, admin, { forceRefresh })}`, "Content-Type": "application/json", Prefer: 'outlook.timezone="Europe/Amsterdam", outlook.body-content-type="text"', ...(options.headers || {}) } });
      let response = await send(false);
      if (response.status === 401) response = await send(true);
      if (response.status === 404 && allowMissing) return null;
      const data = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) throw Object.assign(new Error("Microsoft kon deze agenda-actie niet bevestigen."), { status: response.status });
      return data;
    };
    return reply(await eventCalendarAction({ repo, graph, input }));
  } catch (error) {
    return reply({ error: error.status ? error.message : "De agenda kon niet veilig worden verwerkt. Controleer opnieuw; maak niet zomaar een tweede afspraak." }, error.status || 500);
  }
}

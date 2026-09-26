import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminSupabase, createUserSupabase } from "../../../../lib/server-supabase";
import { manualDistribution, validateManualDraft, retainedConfirmations } from "../../../../lib/manual-predis";

export const maxDuration = 30;
const reply = (data, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function contextFor(request, input) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const { workspaceId, businessId, itemId } = input || {};
  if (!token || ![workspaceId, businessId, itemId].every(v => typeof v === "string" && v.length > 0 && v.length <= 100)) throw new Error("Sessie, evenement of vestiging ontbreekt.");
  const client = createUserSupabase(token);
  const { data: auth, error } = await client.auth.getUser(token);
  if (error || !auth?.user) throw new Error("Je sessie is verlopen.");
  let aal;
  try { aal = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).aal; } catch { aal = null; }
  if (aal !== "aal2") throw new Error("Bevestig eerst je tweestapsverificatie.");
  const roles = await client.from("user_role_assignments").select("business_id,location_id,assignment_permissions(permission),role:roles!inner(role_key,role_permissions(permission))").eq("workspace_id", workspaceId).eq("user_id", auth.user.id);
  const allowed = !roles.error && (roles.data || []).some(a => {
    if (a.location_id || (a.business_id && a.business_id !== businessId)) return false;
    const permissions = a.role?.role_key === "custom" ? a.assignment_permissions : a.role?.role_permissions;
    return a.role?.role_key === "owner" || (permissions || []).some(p => ["marketing:manage", "social:manage"].includes(p.permission));
  });
  if (!allowed) throw new Error("Geen marketingrechten voor deze vestiging.");
  const admin = createAdminSupabase();
  return { userId: auth.user.id, query: () => admin.from("social_content_items"), scope: q => q.eq("workspace_id", workspaceId).eq("business_id", businessId).eq("id", itemId) };
}
export async function GET(request) {
  try {
    let ctx; try { ctx = await contextFor(request, Object.fromEntries(new URL(request.url).searchParams)); } catch (e) { return reply({ error: e.message }, 403); }
    const { data, error } = await ctx.scope(ctx.query().select("id,media")).maybeSingle();
    const dist = manualDistribution(data);
    if (error || !dist) return reply({ error: "Deze voorbereiding is niet toegankelijk." }, 404);
    return reply({ saved: dist.manual_predis || null });
  } catch { return reply({ error: "Laden mislukt. Probeer opnieuw." }, 500); }
}
export async function POST(request) {
  let input, ctx, draft;
  try { input = await request.json(); } catch { return reply({ error: "Ongeldig verzoek." }, 400); }
  if (!input || !["save", "confirm"].includes(input.action)) return reply({ error: "Alleen handmatig bewaren en bevestigen is mogelijk." }, 400);
  if (!(input.expectedRevision === null || (typeof input.expectedRevision === "string" && input.expectedRevision.length <= 100))) return reply({ error: "De versie ontbreekt." }, 400);
  try { ctx = await contextFor(request, input); } catch (e) { return reply({ error: e.message }, 403); }
  try { if (input.action === "save") draft = validateManualDraft(input.draft); } catch (e) { return reply({ error: e.message }, 400); }
  if (input.action === "confirm" && (input.confirmed !== true || !["pending", "scheduled", "published"].includes(input.state) || typeof input.entryKey !== "string")) return reply({ error: "Bevestig dat je de status zelf in Predis hebt gecontroleerd." }, 400);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: row, error } = await ctx.scope(ctx.query().select("id,media,updated_at")).maybeSingle();
      const dist = manualDistribution(row), previous = dist?.manual_predis;
      if (error || !dist) return reply({ error: "Evenement niet toegankelijk." }, 404);
      if ((previous?.revision || null) !== input.expectedRevision || !row.updated_at) return reply({ error: "De opgeslagen voorbereiding is gewijzigd. Je invoer blijft staan. Laad de bewaarde versie opnieuw voordat je verdergaat." }, 409);
      const stamp = { at: new Date().toISOString(), by: ctx.userId };
      let confirmations;
      if (input.action === "save") {
        confirmations = retainedConfirmations(previous, draft);
        if (Object.keys(previous?.confirmations || {}).some(key => !confirmations[key]) && input.acceptReset !== true) return reply({ error: "Deze wijziging maakt eerdere bevestigingen ongeldig. Bevestig eerst dat je die opnieuw gaat controleren." }, 409);
      } else {
        if (!previous?.draft?.entries.some(e => e.key === input.entryKey)) return reply({ error: "Bewaar eerst dit publicatiemoment." }, 409);
        draft = previous.draft;
        if (input.state !== "pending" && !draft.caption && !draft.assets.length) return reply({ error: "Bewaar eerst de inhoud van je bericht." }, 400);
        confirmations = { ...previous.confirmations };
        if (input.state === "pending") delete confirmations[input.entryKey];
        else confirmations[input.entryKey] = { state: input.state, ...stamp, verification: "user_reported" };
      }
      const saved = { revision: randomUUID(), draft, confirmations, updated_at: stamp.at, updated_by: ctx.userId,
        history: [...(previous?.history || []), { action: input.action, ...(input.action === "confirm" ? { key: input.entryKey, state: input.state } : { invalidated: Object.keys(previous?.confirmations || {}).filter(key => !confirmations[key]) }), ...stamp }].slice(-100) };
      const media = row.media.map(entry => entry === dist ? { ...entry, manual_predis: saved } : entry);
      const result = await ctx.scope(ctx.query().update({ media })).eq("updated_at", row.updated_at).select("id").maybeSingle();
      if (result.error) return reply({ error: "Bewaren mislukt. Je invoer blijft staan." }, 500);
      if (result.data?.id) return reply({ saved });
    }
    return reply({ error: "Het evenement wordt elders bijgewerkt. Probeer opnieuw." }, 409);
  } catch { return reply({ error: "Geen opslagbevestiging ontvangen. Controleer de bewaarde versie. Er is niets naar Predis verstuurd." }, 500); }
}

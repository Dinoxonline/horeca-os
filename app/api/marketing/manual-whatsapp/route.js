import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminSupabase, createUserSupabase } from "../../../../lib/server-supabase";
import { manualDistribution } from "../../../../lib/manual-predis";

export const maxDuration = 30;
const reply = (data, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function contextFor(request, input) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const { workspaceId, businessId, itemId } = input || {};
  if (!token || ![workspaceId, businessId, itemId].every(value => typeof value === "string" && value.length > 0 && value.length <= 100)) throw new Error("Sessie, evenement of vestiging ontbreekt.");
  const client = createUserSupabase(token);
  const { data: auth, error } = await client.auth.getUser(token);
  if (error || !auth?.user) throw new Error("Je sessie is verlopen.");
  let aal; try { aal = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).aal; } catch { aal = null; }
  if (aal !== "aal2") throw new Error("Bevestig eerst je tweestapsverificatie.");
  const roles = await client.from("user_role_assignments").select("business_id,location_id,assignment_permissions(permission),role:roles!inner(role_key,role_permissions(permission))").eq("workspace_id", workspaceId).eq("user_id", auth.user.id);
  const allowed = !roles.error && (roles.data || []).some(assignment => {
    if (assignment.location_id || (assignment.business_id && assignment.business_id !== businessId)) return false;
    const permissions = assignment.role?.role_key === "custom" ? assignment.assignment_permissions : assignment.role?.role_permissions;
    return assignment.role?.role_key === "owner" || (permissions || []).some(permission => ["marketing:manage", "social:manage"].includes(permission.permission));
  });
  if (!allowed) throw new Error("Geen marketingrechten voor deze vestiging.");
  const admin = createAdminSupabase();
  return { userId: auth.user.id, query: () => admin.from("social_content_items"), scope: query => query.eq("workspace_id", workspaceId).eq("business_id", businessId).eq("id", itemId) };
}

export async function POST(request) {
  let input, context;
  try { input = await request.json(); } catch { return reply({ error: "Ongeldig verzoek." }, 400); }
  if (!input || input.action !== "mark_published" || input.confirmed !== true) return reply({ error: "Bevestig eerst dat je dit bericht zelf op WhatsApp hebt geplaatst." }, 400);
  if (!(input.expectedRevision === null || (typeof input.expectedRevision === "string" && input.expectedRevision.length <= 100))) return reply({ error: "De versie ontbreekt." }, 400);
  try { context = await contextFor(request, input); } catch (error) { return reply({ error: error.message }, 403); }
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: row, error } = await context.scope(context.query().select("id,media,updated_at")).maybeSingle();
      const distribution = manualDistribution(row), previous = distribution?.manual_whatsapp;
      if (error || !distribution) return reply({ error: "Evenement niet toegankelijk." }, 404);
      if ((previous?.revision || null) !== input.expectedRevision || !row.updated_at) return reply({ error: "De WhatsApp-status is gewijzigd. Laad het evenement opnieuw voordat je verdergaat." }, 409);
      const stamp = { at: new Date().toISOString(), by: context.userId };
      const saved = { revision: randomUUID(), state: "placed", verification: "user_reported", ...stamp, updated_at: stamp.at, updated_by: context.userId, history: [...(previous?.history || []), { action: "mark_published", ...stamp }].slice(-100) };
      const media = row.media.map(entry => entry === distribution ? { ...entry, manual_whatsapp: saved } : entry);
      const result = await context.scope(context.query().update({ media })).eq("updated_at", row.updated_at).select("id").maybeSingle();
      if (result.error) return reply({ error: "Bewaren mislukt. Probeer opnieuw." }, 500);
      if (result.data?.id) return reply({ saved });
    }
    return reply({ error: "Het evenement wordt elders bijgewerkt. Probeer opnieuw." }, 409);
  } catch { return reply({ error: "Geen opslagbevestiging ontvangen. WhatsApp is niet automatisch geplaatst." }, 500); }
}

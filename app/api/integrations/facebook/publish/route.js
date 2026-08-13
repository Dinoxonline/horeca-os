import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../lib/server-supabase";
import { decryptMetaToken } from "../../../../../lib/meta-oauth";

const GRAPH_VERSION = "v25.0";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek.", 400); }
  const { workspaceId, businessId, campaignId } = body || {};
  const context = await authorizedContext(request, workspaceId, businessId);
  if (context.error) return context.error;
  const { admin } = context;

  const [{ data: account }, { data: campaign }] = await Promise.all([
    admin.from("integration_accounts").select("id,external_account_id,display_name,granted_scopes")
      .eq("workspace_id", workspaceId).eq("business_id", businessId).eq("provider", "facebook").maybeSingle(),
    admin.from("social_content_items").select("id,business_id,media,workflow_status")
      .eq("id", campaignId).eq("workspace_id", workspaceId).eq("business_id", businessId).maybeSingle(),
  ]);
  if (!account) return jsonError("Voor deze vestiging is nog geen Facebookpagina gekoppeld.", 404);
  if (!account.granted_scopes?.includes("pages_manage_posts")) return jsonError("Koppel de Facebookpagina opnieuw om berichten te mogen publiceren.", 409);
  if (!campaign) return jsonError("Het campagneconcept is niet gevonden.", 404);
  if (campaign.workflow_status !== "in_progress") return jsonError("Keur het campagneconcept eerst goed voordat je het op Facebook plaatst.", 409);

  const distribution = (campaign.media || []).find((entry) => entry?.kind === "campaign_distribution");
  if (!distribution?.target_channels?.includes("facebook")) return jsonError("Facebook is niet als bestemming geselecteerd.", 409);
  if (["confirmed", "published"].includes(distribution.provider_delivery?.facebook?.status)) return jsonError("Dit bericht is al op Facebook geplaatst.", 409);

  const { data: credential } = await admin.from("integration_credentials").select("token_ciphertext,token_iv,token_tag")
    .eq("account_id", account.id).maybeSingle();
  if (!credential) return jsonError("De beveiligde Facebook-toegang ontbreekt. Koppel de pagina opnieuw.", 409);

  try {
    const accessToken = decryptMetaToken(credential);
    const common = distribution.common || {};
    const facebook = distribution.channel_payloads?.facebook || {};
    const message = buildEventMessage(common, facebook, distribution.source_url);
    const imageUrl = facebook.image_url || common.image_url || "";
    const result = imageUrl
      ? await graphPost(`${account.external_account_id}/photos`, accessToken, { url: imageUrl, caption: message, published: "true" })
      : await graphPost(`${account.external_account_id}/feed`, accessToken, { message, link: common.website_url || distribution.source_url || "" });
    const postId = String(result.post_id || result.id || "");
    if (!postId) throw new Error("Facebook heeft geen berichtnummer teruggegeven.");
    const permalink = `https://www.facebook.com/${postId.replace("_", "/posts/")}`;
    const nextDistribution = {
      ...distribution,
      provider_delivery: { ...(distribution.provider_delivery || {}), facebook: { status: "confirmed", external_id: postId, permalink, published_at: new Date().toISOString() } },
      channel_status: { ...(distribution.channel_status || {}), facebook: "geplaatst" },
    };
    const media = (campaign.media || []).map((entry) => entry?.kind === "campaign_distribution" ? nextDistribution : entry);
    const { error: updateError } = await admin.from("social_content_items").update({ media }).eq("id", campaign.id);
    if (updateError) throw new Error("Het bericht staat op Facebook, maar de bevestiging kon niet in Horeca OS worden opgeslagen.");
    return NextResponse.json({ ok: true, post: { id: postId, permalink, pageName: account.display_name } });
  } catch (error) {
    return jsonError(error.message || "Facebook heeft het bericht geweigerd.", 502);
  }
}

function buildEventMessage(common, facebook, sourceUrl) {
  const start = common.start ? new Date(common.start) : null;
  const end = common.end ? new Date(common.end) : null;
  const date = start && !Number.isNaN(start.getTime()) ? new Intl.DateTimeFormat("nl-NL", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Amsterdam" }).format(start) : "";
  const endTime = end && !Number.isNaN(end.getTime()) ? new Intl.DateTimeFormat("nl-NL", { timeStyle: "short", timeZone: "Europe/Amsterdam" }).format(end) : "";
  const ticketLines = (common.tickets?.variations || []).map((ticket) => {
    const price = Number(ticket.price || 0);
    return `${ticket.name || "Ticket"}: ${price > 0 ? `€ ${price.toFixed(2).replace(".", ",")}` : "gratis"}`;
  });
  return [
    common.title ? `📅 ${common.title}` : "", facebook.text || common.short_description || common.description || "",
    date ? `🗓️ ${date}${endTime ? ` – ${endTime}` : ""}` : "", common.location ? `📍 ${common.location}` : "",
    ticketLines.length ? `🎟️ ${ticketLines.join(" · ")}` : "",
    common.website_url || sourceUrl ? `Meer informatie en tickets: ${common.website_url || sourceUrl}` : "",
  ].filter(Boolean).join("\n\n");
}

async function graphPost(path, accessToken, values) {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...values, access_token: accessToken }), cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Facebook heeft het bericht geweigerd.");
  return result;
}

async function authorizedContext(request, workspaceId, businessId) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !workspaceId || !businessId) return { error: jsonError("Niet ingelogd of geen vestiging gekozen.", 401) };
  const userClient = createUserSupabase(token);
  const { data: authData } = await userClient.auth.getUser(token);
  if (!authData?.user) return { error: jsonError("Sessie is verlopen.", 401) };
  const { data: assignments } = await userClient.from("user_role_assignments")
    .select("business_id,assignment_permissions(permission),role:roles!inner(role_key,role_permissions(permission))")
    .eq("workspace_id", workspaceId).eq("user_id", authData.user.id);
  const allowed = (assignments || []).some((assignment) => {
    if (assignment.business_id && assignment.business_id !== businessId) return false;
    const permissions = assignment.role?.role_key === "custom" ? assignment.assignment_permissions?.map((item) => item.permission) || [] : assignment.role?.role_permissions?.map((item) => item.permission) || [];
    return assignment.role?.role_key === "owner" || permissions.includes("marketing:manage") || permissions.includes("social:manage");
  });
  return allowed ? { admin: createAdminSupabase() } : { error: jsonError("Je hebt geen toestemming om op Facebook te publiceren.", 403) };
}

function jsonError(error, status) { return NextResponse.json({ error }, { status }); }

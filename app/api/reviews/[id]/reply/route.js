import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../lib/server-supabase";

const GOOGLE_REVIEW_NAME = /^accounts\/[^/]+\/locations\/[^/]+\/reviews\/[^/]+$/;

export async function POST(request, { params }) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return jsonError("Niet ingelogd.", 401);
  const userClient = createUserSupabase(token);
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData?.user) return jsonError("Sessie is verlopen.", 401);
  if (tokenAal(token) !== "aal2") return jsonError("Bevestig eerst je tweestapsverificatie.", 403);

  let body;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek.", 400); }
  const workspaceId = String(body.workspaceId || "");
  const responseText = String(body.responseText || "").trim();
  const reviewId = String((await params).id || "");
  if (!workspaceId || !reviewId || !responseText) return jsonError("Review en reactie zijn verplicht.", 400);
  if (responseText.length > 4096) return jsonError("De reactie is te lang.", 400);

  const { data: assignments, error: roleError } = await userClient.from("user_role_assignments")
    .select("assignment_permissions(permission),role:roles!inner(role_key,role_permissions(permission))")
    .eq("workspace_id", workspaceId).eq("user_id", authData.user.id);
  if (roleError) return jsonError("Rechten konden niet worden gecontroleerd.", 403);
  const allowed = (assignments || []).some((assignment) => {
    const permissions = assignment.role?.role_key === "custom"
      ? assignment.assignment_permissions?.map((item) => item.permission) || []
      : assignment.role?.role_permissions?.map((item) => item.permission) || [];
    return assignment.role?.role_key === "owner" || permissions.includes("reviews:manage") || permissions.includes("reviews:respond");
  });
  if (!allowed) return jsonError("Je hebt geen toestemming om op reviews te reageren.", 403);

  const admin = createAdminSupabase();
  const { data: review } = await admin.from("customer_reviews")
    .select("id,workspace_id,business_id,source,external_id")
    .eq("id", reviewId).eq("workspace_id", workspaceId).maybeSingle();
  if (!review) return jsonError("Review niet gevonden.", 404);
  if (!/google/i.test(review.source)) return jsonError(`${review.source} is nog niet gekoppeld voor directe reacties. De reactie is daarom niet als geplaatst gemarkeerd.`, 409);
  if (!review.external_id || !GOOGLE_REVIEW_NAME.test(review.external_id)) return jsonError("Deze geïmporteerde Google-review mist het officiële Google review-ID. Koppel eerst Google Bedrijfsprofiel en synchroniseer de reviews.", 409);

  const accessToken = process.env.GOOGLE_BUSINESS_ACCESS_TOKEN;
  if (!accessToken) return jsonError("Google Bedrijfsprofiel is nog niet gekoppeld voor het plaatsen van reacties.", 409);
  const googleResponse = await fetch(`https://mybusiness.googleapis.com/v4/${review.external_id}/reply`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ comment: responseText }),
    cache: "no-store",
  });
  if (!googleResponse.ok) {
    const details = await googleResponse.json().catch(() => null);
    return jsonError(details?.error?.message || "Google heeft de reactie niet geaccepteerd.", 502);
  }

  const respondedAt = new Date().toISOString();
  const { error: updateError } = await admin.from("customer_reviews").update({
    response_text: responseText, status: "responded", responded_at: respondedAt,
  }).eq("id", review.id).eq("workspace_id", workspaceId);
  if (updateError) return jsonError("De reactie is geplaatst, maar de bevestiging kon niet worden opgeslagen.", 500);
  return NextResponse.json({ ok: true, respondedAt });
}

function tokenAal(token) {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).aal || null; }
  catch { return null; }
}
function jsonError(error, status) { return NextResponse.json({ error }, { status }); }

import { NextResponse } from "next/server";
import { createAdminSupabase } from "../../../../../lib/server-supabase";

export async function POST(request) {
  const expected = process.env.PREDIS_WEBHOOK_SECRET?.trim();
  const supplied = request.nextUrl.searchParams.get("token") || "";
  if (!expected || supplied !== expected) return NextResponse.json({ error: "Ongeldige webhook." }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Ongeldige inhoud." }, { status: 400 }); }

  const status = String(body?.status || "");
  const postId = String(body?.post_id || "").trim();
  if (!["completed", "error"].includes(status) || !postId) {
    return NextResponse.json({ error: "Onbekende Predis-status." }, { status: 400 });
  }

  const generatedMedia = status === "completed"
    ? (Array.isArray(body.generated_media) ? body.generated_media : [])
      .map((item) => safeHttpsUrl(item?.url))
      .filter(Boolean)
      .map((url) => ({ url }))
    : [];
  const caption = status === "completed" ? String(body.caption || "").slice(0, 10000) : "";
  const brandId = String(body.brand_id || "").trim();
  const admin = createAdminSupabase();
  const { data: matches, error: findError } = await admin
    .from("social_content_items")
    .select("id,media")
    .contains("media", [{
      kind: "campaign_distribution",
      provider_delivery: { predis: { post_ids: [postId] } },
    }])
    .limit(2);

  if (findError) return NextResponse.json({ error: "Predis-resultaat kon niet worden gekoppeld." }, { status: 500 });
  if (!matches?.length) return NextResponse.json({ received: true, matched: false, postId, status });
  if (matches.length > 1) return NextResponse.json({ error: "Predis-resultaat hoort bij meerdere campagnes." }, { status: 409 });

  const item = matches[0];
  const distributionIndex = (item.media || []).findIndex((entry) =>
    entry?.kind === "campaign_distribution"
    && (entry.provider_delivery?.predis?.post_ids || []).map(String).includes(postId)
  );
  if (distributionIndex < 0) return NextResponse.json({ received: true, matched: false, postId, status });

  const distribution = item.media[distributionIndex];
  const currentDelivery = distribution.provider_delivery?.predis || {};
  const resultUrl = generatedMedia[0]?.url || "";
  if (
    currentDelivery.provider_status === status
    && String(currentDelivery.post_id || "") === postId
    && String(currentDelivery.result_url || "") === resultUrl
  ) {
    return NextResponse.json({ received: true, matched: true, unchanged: true, postId, status });
  }

  const receivedAt = new Date().toISOString();
  const nextDelivery = {
    ...currentDelivery,
    status: status === "completed" ? "draft_ready" : "generation_failed",
    provider_status: status,
    post_id: postId,
    brand_id: brandId || currentDelivery.brand_id || "",
    caption: caption || currentDelivery.caption || "",
    generated_media: generatedMedia,
    result_url: resultUrl,
    ...(status === "completed" ? { completed_at: receivedAt } : { failed_at: receivedAt }),
  };
  const nextDistribution = {
    ...distribution,
    provider_delivery: {
      ...(distribution.provider_delivery || {}),
      predis: nextDelivery,
    },
  };
  const nextMedia = item.media.map((entry, index) => index === distributionIndex ? nextDistribution : entry);
  const { error: updateError } = await admin.from("social_content_items").update({ media: nextMedia }).eq("id", item.id);
  if (updateError) return NextResponse.json({ error: "Predis-resultaat kon niet worden opgeslagen." }, { status: 500 });

  return NextResponse.json({ received: true, matched: true, postId, status });
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

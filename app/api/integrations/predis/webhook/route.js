import { NextResponse } from "next/server";

export async function POST(request) {
  const expected = process.env.PREDIS_WEBHOOK_SECRET?.trim();
  const supplied = request.nextUrl.searchParams.get("token") || "";
  if (!expected || supplied !== expected) return NextResponse.json({ error: "Ongeldige webhook." }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Ongeldige inhoud." }, { status: 400 }); }
  if (!["completed", "error"].includes(body?.status) || !body?.post_id) return NextResponse.json({ error: "Onbekende Predis-status." }, { status: 400 });
  // Predis verstuurt iedere status precies eenmaal. De resultaten worden in een volgende
  // stap aan de Horeca OS-conceptenbibliotheek gekoppeld; deze ontvangstbevestiging
  // voorkomt dat publieke, ongeldige verzoeken als Predis-resultaat worden verwerkt.
  return NextResponse.json({ received: true, postId: String(body.post_id), status: body.status });
}

import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../lib/server-supabase";

export async function POST(request) {
  try {
    const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const userClient = createUserSupabase(accessToken || "");
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

    const { requestId } = await request.json();
    const admin = createAdminSupabase();
    const { data: accessRequest, error: requestError } = await admin
      .from("staff_access_requests")
      .select("id, workspace_id, email, full_name, status")
      .eq("id", requestId)
      .maybeSingle();
    if (requestError || !accessRequest) return NextResponse.json({ error: "Aanvraag niet gevonden." }, { status: 404 });

    const { data: manager } = await admin.from("workspace_members")
      .select("role")
      .eq("workspace_id", accessRequest.workspace_id)
      .eq("user_id", authData.user.id)
      .in("role", ["owner", "manager"])
      .maybeSingle();
    if (!manager) return NextResponse.json({ error: "Geen bevoegdheid." }, { status: 403 });
    if (accessRequest.status !== "approved") return NextResponse.json({ error: "De aanvraag is nog niet goedgekeurd." }, { status: 400 });

    const apiKey = process.env.BREVO_API_KEY?.trim();
    if (!apiKey) return NextResponse.json({ ok: false, emailSent: false, message: "E-mailkoppeling is nog niet ingesteld." });
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Horeca OS", email: "info@leclubbbq.nl" },
        to: [{ email: accessRequest.email, name: accessRequest.full_name }],
        subject: "Je Horeca OS-account is goedgekeurd",
        htmlContent: `<p>Hallo ${escapeHtml(accessRequest.full_name)},</p><p>Je account voor Horeca OS is goedgekeurd. Je kunt nu inloggen via de medewerkerslink.</p><p>Gebruik je e-mailadres en je gekozen wachtwoord.</p>`,
      }),
    });
    if (!response.ok) throw new Error(`Brevo returned ${response.status}`);
    return NextResponse.json({ ok: true, emailSent: true });
  } catch (error) {
    console.error("Staff approval email failed", { error: error.message });
    return NextResponse.json({ error: "De goedkeuringsmail kon niet worden verstuurd." }, { status: 500 });
  }
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}

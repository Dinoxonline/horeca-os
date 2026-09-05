import { NextResponse } from "next/server";
import { createAdminSupabase } from "../../../../lib/server-supabase";

export async function POST(request) {
  try {
    const body = await request.json();
    const token = String(body.token || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const fullName = String(body.fullName || "").trim();
    const password = String(body.password || "");

    if (!token || !email.includes("@") || fullName.length < 2 || password.length < 6) {
      return NextResponse.json({ error: "Vul naam, geldig e-mailadres en een wachtwoord van minimaal 6 tekens in." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { data: link, error: linkError } = await admin
      .from("staff_ticket_links")
      .select("id, workspace_id")
      .eq("token", token)
      .eq("active", true)
      .maybeSingle();
    if (linkError || !link) return NextResponse.json({ error: "Deze medewerkerslink is niet actief." }, { status: 400 });

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) return NextResponse.json({ error: /already|registered|exists/i.test(error.message) ? "Dit e-mailadres bestaat al. Kies Inloggen." : "Account aanmaken lukt niet. Controleer de gegevens." }, { status: 400 });

    const user = data.user;
    const { error: profileError } = await admin.from("profiles").upsert({ id: user.id, email, full_name: fullName }, { onConflict: "id" });
    if (profileError) return NextResponse.json({ error: "Account aangemaakt, maar je aanvraag kon niet worden opgeslagen." }, { status: 500 });

    const { error: requestError } = await admin.from("staff_access_requests").insert({
      workspace_id: link.workspace_id,
      link_id: link.id,
      user_id: user.id,
      email,
      full_name: fullName,
    });
    if (requestError) return NextResponse.json({ error: "Account aangemaakt, maar je toegangsaanvraag kon niet worden opgeslagen." }, { status: 500 });

    await sendApprovalEmail({ email, fullName }).catch((error) => {
      console.error("Staff approval email failed", { error: error.message });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Staff signup failed", { error: error.message });
    return NextResponse.json({ error: "Account aanmaken lukt momenteel niet. Probeer het opnieuw." }, { status: 500 });
  }
}


async function sendApprovalEmail({ email, fullName }) {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = "info@leclubbbq.nl";
  if (!apiKey || !senderEmail) return;
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: "Horeca OS", email: senderEmail },
      to: [{ email: "info@leclubbbq.nl", name: "Dino" }],
      subject: "Nieuwe accountaanvraag voor Horeca OS",
      htmlContent: `<p>Er is een nieuwe accountaanvraag voor Horeca OS.</p><p><strong>Naam:</strong> ${escapeHtml(fullName)}<br /><strong>E-mail:</strong> ${escapeHtml(email)}</p><p>Open Horeca OS → Gebruikers & rollen om de aanvraag goed te keuren of af te wijzen.</p>`,
    }),
  });
  if (!response.ok) throw new Error(`Brevo returned ${response.status}`);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}

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

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Staff signup failed", { error: error.message });
    return NextResponse.json({ error: "Account aanmaken lukt momenteel niet. Probeer het opnieuw." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../lib/server-supabase";

export async function POST(request) {
  try {
    const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const userClient = createUserSupabase(accessToken || "");
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

    const { workspaceId, ticketId, assigneeId } = await request.json();
    const admin = createAdminSupabase();
    const { data: manager } = await admin.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", authData.user.id).in("role", ["owner", "manager"]).maybeSingle();
    if (!manager) return NextResponse.json({ error: "Geen bevoegdheid." }, { status: 403 });
    const { data: ticket } = await admin.from("staff_tickets").select("ticket_number, title").eq("workspace_id", workspaceId).eq("id", ticketId).maybeSingle();
    if (!ticket || !assigneeId) return NextResponse.json({ ok: true, emailSent: false });
    const { data: assignee } = await admin.auth.admin.getUserById(assigneeId);
    if (!assignee?.user?.email) return NextResponse.json({ ok: true, emailSent: false });

    const apiKey = process.env.BREVO_API_KEY?.trim();
    if (!apiKey) return NextResponse.json({ ok: false, emailSent: false, message: "E-mailkoppeling is nog niet ingesteld." });
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Horeca OS", email: "info@leclubbbq.nl" },
        to: [{ email: assignee.user.email }],
        subject: `Ticket #${ticket.ticket_number} aan jou toegewezen`,
        htmlContent: `<p>Er is een ticket aan jou toegewezen in Horeca OS.</p><p><strong>Ticket:</strong> #${ticket.ticket_number}<br /><strong>Onderwerp:</strong> ${escapeHtml(ticket.title)}</p><p><a href="https://horeca-os-le-club.vercel.app/werkbord/tickets">Open het ticket in Horeca OS</a></p>`,
      }),
    });
    if (!response.ok) throw new Error(`Brevo returned ${response.status}`);
    return NextResponse.json({ ok: true, emailSent: true });
  } catch (error) {
    console.error("Staff ticket assignment email failed", { error: error.message });
    return NextResponse.json({ error: "De toewijzingsmail kon niet worden verstuurd." }, { status: 500 });
  }
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}

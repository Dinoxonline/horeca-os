import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../lib/server-supabase";

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export async function POST(request) {
  try {
    const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const userClient = createUserSupabase(accessToken || "");
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

    const formData = await request.formData();
    const token = String(formData.get("token") || "").trim();
    const ticketNumber = Number(formData.get("ticketNumber"));
    const file = formData.get("file");
    if (!token || !Number.isInteger(ticketNumber) || !(file instanceof File)) return NextResponse.json({ error: "Bestand of ticket ontbreekt." }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Een bestand mag maximaal 10 MB zijn." }, { status: 400 });
    if (!allowedTypes.has(file.type)) return NextResponse.json({ error: "Alleen JPEG, PNG, PDF en Word-bestanden zijn toegestaan." }, { status: 400 });

    const admin = createAdminSupabase();
    const { data: link } = await admin.from("staff_ticket_links").select("id, workspace_id").eq("token", token).eq("active", true).maybeSingle();
    if (!link) return NextResponse.json({ error: "Deze medewerkerslink is niet actief." }, { status: 400 });
    const { data: ticket } = await admin.from("staff_tickets").select("id, workspace_id, attachments").eq("workspace_id", link.workspace_id).eq("link_id", link.id).eq("ticket_number", ticketNumber).eq("reporter_user_id", authData.user.id).maybeSingle();
    if (!ticket) return NextResponse.json({ error: "Ticket niet gevonden." }, { status: 404 });

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const path = `${link.workspace_id}/${ticketNumber}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await admin.storage.from("staff-ticket-attachments").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    const attachment = { path, name: file.name, type: file.type, size: file.size, uploaded_at: new Date().toISOString(), uploaded_by: authData.user.id };
    const { error: updateError } = await admin.from("staff_tickets").update({ attachments: [...(Array.isArray(ticket.attachments) ? ticket.attachments : []), attachment], updated_at: new Date().toISOString() }).eq("id", ticket.id);
    if (updateError) {
      await admin.storage.from("staff-ticket-attachments").remove([path]);
      throw updateError;
    }
    return NextResponse.json({ ok: true, name: file.name });
  } catch (error) {
    console.error("Staff ticket attachment failed", { error: error.message });
    return NextResponse.json({ error: "De bijlage kon niet worden opgeslagen." }, { status: 500 });
  }
}

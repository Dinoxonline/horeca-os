import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../lib/server-supabase";

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export async function GET(request) {
  try {
    const accessToken = request.headers.get("authorization")?.replace(/^Bearer\\s+/i, "");
    const userClient = createUserSupabase(accessToken || "");
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user || verifiedTokenAal(accessToken) !== "aal2") return NextResponse.json({ error: "Bevestig eerst je tweestapsverificatie." }, { status: 403 });

    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    const ticketId = request.nextUrl.searchParams.get("ticketId");
    const path = request.nextUrl.searchParams.get("path");
    if (!workspaceId || !ticketId || !path) return NextResponse.json({ error: "Bijlage ontbreekt." }, { status: 400 });

    const { data: assignments, error: assignmentError } = await userClient
      .from("user_role_assignments")
      .select("assignment_permissions(permission), role:roles!inner(role_key, role_permissions(permission))")
      .eq("workspace_id", workspaceId)
      .eq("user_id", authData.user.id);
    if (assignmentError) throw assignmentError;
    const allowed = (assignments || []).some((assignment) => {
      const permissions = assignment.role?.role_key === "custom"
        ? assignment.assignment_permissions?.map((item) => item.permission) || []
        : assignment.role?.role_permissions?.map((item) => item.permission) || [];
      return assignment.role?.role_key === "owner" || permissions.includes("users:manage") || permissions.includes("processes:manage");
    });
    if (!allowed) return NextResponse.json({ error: "Je hebt geen toegang tot deze bijlage." }, { status: 403 });

    const admin = createAdminSupabase();
    const { data: ticket } = await admin.from("staff_tickets").select("attachments").eq("workspace_id", workspaceId).eq("id", ticketId).maybeSingle();
    const attachment = (Array.isArray(ticket?.attachments) ? ticket.attachments : []).find((item) => item.path === path);
    if (!attachment) return NextResponse.json({ error: "Bijlage niet gevonden." }, { status: 404 });
    const { data, error } = await admin.storage.from("staff-ticket-attachments").createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return NextResponse.json({ error: "De bijlage kon niet worden geopend." }, { status: 404 });
    return NextResponse.json({ url: data.signedUrl, name: attachment.name });
  } catch (error) {
    console.error("Staff ticket attachment view failed", { error: error.message });
    return NextResponse.json({ error: "De bijlage kon niet worden geopend." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const userClient = createUserSupabase(accessToken || "");
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

    const formData = await request.formData();
    const token = String(formData.get("token") || "").trim();
    const workspaceId = String(formData.get("workspaceId") || "").trim();
    const ticketId = String(formData.get("ticketId") || "").trim();
    const ticketNumber = Number(formData.get("ticketNumber"));
    const file = formData.get("file");
    if ((!token && !(workspaceId && ticketId)) || !(file instanceof File)) return NextResponse.json({ error: "Bestand of ticket ontbreekt." }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Een bestand mag maximaal 10 MB zijn." }, { status: 400 });
    if (!allowedTypes.has(file.type)) return NextResponse.json({ error: "Alleen JPEG, PNG, PDF en Word-bestanden zijn toegestaan." }, { status: 400 });

    const admin = createAdminSupabase();
    let ticket;
    if (workspaceId && ticketId) {
      if (verifiedTokenAal(accessToken) !== "aal2") return NextResponse.json({ error: "Bevestig eerst je tweestapsverificatie." }, { status: 403 });
      const { data: assignments, error: assignmentError } = await userClient
        .from("user_role_assignments")
        .select("assignment_permissions(permission), role:roles!inner(role_key, role_permissions(permission))")
        .eq("workspace_id", workspaceId)
        .eq("user_id", authData.user.id);
      if (assignmentError) throw assignmentError;
      const allowed = (assignments || []).some((assignment) => {
        const permissions = assignment.role?.role_key === "custom"
          ? assignment.assignment_permissions?.map((item) => item.permission) || []
          : assignment.role?.role_permissions?.map((item) => item.permission) || [];
        return assignment.role?.role_key === "owner" || permissions.includes("users:manage") || permissions.includes("processes:manage");
      });
      if (!allowed) return NextResponse.json({ error: "Je hebt geen toegang om bijlagen aan tickets toe te voegen." }, { status: 403 });
      const { data: managerTicket } = await admin.from("staff_tickets").select("id, workspace_id, ticket_number, attachments").eq("workspace_id", workspaceId).eq("id", ticketId).maybeSingle();
      ticket = managerTicket;
    } else {
      if (!token || !Number.isInteger(ticketNumber)) return NextResponse.json({ error: "Bestand of ticket ontbreekt." }, { status: 400 });
      const { data: link } = await admin.from("staff_ticket_links").select("id, workspace_id").eq("token", token).eq("active", true).maybeSingle();
      if (!link) return NextResponse.json({ error: "Deze medewerkerslink is niet actief." }, { status: 400 });
      const { data: employeeTicket } = await admin.from("staff_tickets").select("id, workspace_id, ticket_number, attachments").eq("workspace_id", link.workspace_id).eq("link_id", link.id).eq("ticket_number", ticketNumber).eq("reporter_user_id", authData.user.id).maybeSingle();
      ticket = employeeTicket;
    }
    if (!ticket) return NextResponse.json({ error: "Ticket niet gevonden." }, { status: 404 });

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const path = `${ticket.workspace_id}/${ticket.ticket_number}/${crypto.randomUUID()}-${safeName}`;
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

function verifiedTokenAal(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).aal || null;
  } catch {
    return null;
  }
}

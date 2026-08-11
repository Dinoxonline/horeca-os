import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../lib/server-supabase";
import { createMicrosoftState, microsoftConfiguration, MICROSOFT_SCOPES } from "../../../../lib/microsoft-oauth";

const ALLOWED_MAILBOXES = ["dino@leclubbbq.nl","admin@leclubbbq.nl","info@leclubbbq.nl","verhuur@leclubbbq.nl"];

async function context(request, workspaceId) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !workspaceId) return null;
  const client = createUserSupabase(token);
  const { data } = await client.auth.getUser(token);
  if (!data?.user) return null;
  const { data: assignment } = await client.from("user_role_assignments").select("workspace_id").eq("workspace_id", workspaceId).eq("user_id", data.user.id).limit(1).maybeSingle();
  return assignment ? { user: data.user, admin: createAdminSupabase() } : null;
}

export async function GET(request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  const auth = await context(request, workspaceId);
  if (!auth) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  const { data } = await auth.admin.from("calendar_connections").select("email,display_name,granted_scopes,token_expires_at,updated_at").eq("workspace_id", workspaceId).eq("user_id", auth.user.id).eq("provider", "microsoft").order("email");
  return NextResponse.json({ connections: data || [], configuration: microsoftConfiguration(), mailboxes: ALLOWED_MAILBOXES });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const auth = await context(request, body.workspaceId);
  if (!auth) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  const mailbox = String(body.mailbox || "").trim().toLowerCase();
  if (!ALLOWED_MAILBOXES.includes(mailbox)) return NextResponse.json({ error: "Kies een geldige Horeca OS-mailbox." }, { status: 400 });
  const configuration = microsoftConfiguration();
  if (!configuration.ready) return NextResponse.json({ error: `Microsoft 365 mist serverinstellingen: ${configuration.missing.join(", ")}.` }, { status: 409 });
  const state = createMicrosoftState({ workspaceId: body.workspaceId, userId: auth.user.id, mailbox, returnTo: body.returnTo === "/agenda" ? "/agenda" : "/mail" });
  const url = new URL(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    response_type: "code",
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    prompt: "login",
    login_hint: mailbox,
    state,
  }).toString();
  return NextResponse.json({ authorizationUrl: url.toString() });
}

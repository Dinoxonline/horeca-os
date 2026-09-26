import { createUserSupabase } from "../../../lib/server-supabase";
import { quoteAction } from "../../../lib/quote-service";
import { QuoteError, uuid } from "../../../lib/quotes";

const reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request) {
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return reply({ error: "Log opnieuw in." }, 401);
    const client = createUserSupabase(token);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return reply({ error: "Je sessie is verlopen. Log opnieuw in." }, 401);
    let aal;
    try { aal = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).aal; } catch { aal = null; }
    if (aal !== "aal2") return reply({ error: "Bevestig eerst je tweestapsverificatie." }, 403);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 100000) throw new QuoteError("De offerte is te groot.", 413);
    let input;
    try { input = JSON.parse(raw); } catch { throw new QuoteError("Ongeldig verzoek."); }
    uuid(input?.workspaceId);
    const member = await client.from("workspace_members").select("role").eq("workspace_id", input.workspaceId).eq("user_id", data.user.id).maybeSingle();
    if (member.error || member.data?.role !== "owner") return reply({ error: "Gasten en offertes zijn voorlopig alleen toegankelijk voor de eigenaar." }, 403);
    return reply(await quoteAction(client, input));
  } catch (error) {
    return reply({ error: error instanceof QuoteError ? error.message : "Offertes konden niet veilig worden verwerkt. Probeer opnieuw; je invoer blijft staan." }, error instanceof QuoteError ? error.status : 500);
  }
}

import { QuoteError, uuid, validateGuest, validateQuote, guestSnapshot } from "./quotes";

function check(result) {
  if (!result.error) return result.data;
  if (["42P01", "PGRST205", "PGRST204"].includes(result.error.code)) throw new QuoteError("De opslag voor gasten en offertes is nog niet geactiveerd. Je invoer blijft in dit scherm staan; er is nog niets bewaard.", 503);
  if (result.error.code === "23505") throw new QuoteError("Dit concept of deze gast is mogelijk al opgeslagen. Vernieuw het overzicht voordat je opnieuw opslaat.", 409);
  throw new QuoteError("Opslag kon niet worden bevestigd. Je invoer blijft staan. Controleer het overzicht voordat je opnieuw probeert.", 500);
}
const version = value => {
  if (!Number.isSafeInteger(value) || value < 1) throw new QuoteError("De opgeslagen versie ontbreekt. Open het concept opnieuw.", 409);
  return value;
};
export async function quoteAction(client, input) {
  const workspace = uuid(input.workspaceId);
  const scoped = table => client.from(table).select("*").eq("workspace_id", workspace);
  if (input.action === "list") {
    const page = input.page ?? 0;
    if (!Number.isSafeInteger(page) || page < 0 || page > 10000) throw new QuoteError("Ongeldige pagina.");
    const entity = input.entity === "guests" ? "crm_guests" : "quote_drafts";
    let query = client.from(entity).select(entity === "crm_guests" ? "*" : "id,quote_number,business_id,guest_id,guest_snapshot,content,status,version,updated_at").eq("workspace_id", workspace);
    const search = typeof input.search === "string" ? input.search.trim().slice(0, 160).replace(/[\\%_]/g, "\\$&") : "";
    if (search) query = query.ilike(entity === "crm_guests" ? "name" : "content->>title", `%${search}%`);
    if (input.businessId && entity === "quote_drafts") query = query.eq("business_id", uuid(input.businessId));
    const rows = check(await query.order("updated_at", { ascending: false }).order("id").range(page * 30, page * 30 + 30));
    return { rows: rows.slice(0, 30), hasMore: rows.length > 30 };
  }
  if (input.action === "history") {
    return { rows: check(await client.from("quote_versions").select("version,snapshot,saved_at").eq("workspace_id", workspace).eq("quote_id", uuid(input.id)).order("version", { ascending: false }).limit(50)) };
  }
  const id = uuid(input.id);
  const table = input.action === "save_guest" ? "crm_guests" : "quote_drafts";
  if (!["save_guest", "save_quote"].includes(input.action)) throw new QuoteError("Onbekende offerte-actie.");
  const current = check(await scoped(table).eq("id", id).maybeSingle());
  // Stable client ID prevents duplicate creates after double click / a lost response.
  if (current && (input.version === null || current.version !== version(input.version))) throw new QuoteError("Dit item is al opgeslagen of intussen gewijzigd. Open de bewaarde versie om verder te werken; je invoer is niet overschreven.", 409);
  if (!current && input.version !== null) throw new QuoteError("Deze bewaarde versie is niet meer toegankelijk.", 404);
  let values;
  if (table === "crm_guests") values = validateGuest(input.guest);
  else {
    const businessId = uuid(input.businessId), guestId = uuid(input.guestId);
    const [business, guest] = await Promise.all([
      client.from("businesses").select("id").eq("workspace_id", workspace).eq("id", businessId).maybeSingle(),
      scoped("crm_guests").eq("id", guestId).maybeSingle(),
    ]);
    if (!check(business) || !check(guest)) throw new QuoteError("Kies een vestiging en een bewaarde gast uit deze organisatie.");
    values = { business_id: businessId, guest_id: guestId, content: validateQuote(input.content), guest_snapshot: current?.guest_id === guestId ? current.guest_snapshot : guestSnapshot(guest.data) };
  }
  const result = current
    ? await client.from(table).update(values).eq("workspace_id", workspace).eq("id", id).eq("version", current.version).select("*").maybeSingle()
    : await client.from(table).insert({ id, workspace_id: workspace, ...values }).select("*").single();
  const row = check(result);
  if (!row) throw new QuoteError("Er is intussen een andere wijziging opgeslagen. Je invoer is behouden; open eerst de bewaarde versie.", 409);
  return { row };
}

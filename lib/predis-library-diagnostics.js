import { normalizePredisPost, PREDIS_FORMATS } from "./predis-content";

// Only fixed labels and counts leave the server. Never echo provider errors,
// arbitrary field names, URLs, captions, headers or credentials in diagnostics.
export function inspectPredisPosts(result, mediaType) {
  const rawPosts = Array.isArray(result?.posts) ? result.posts : null;
  const posts = [], seen = new Set(), reasons = {};
  let duplicates = 0;
  const skip = reason => { reasons[reason] = (reasons[reason] || 0) + 1; };
  for (const raw of (rawPosts || []).slice(0, 20)) {
    const id = typeof raw?.post_id === "string" && raw.post_id.length > 0 && raw.post_id.length <= 200 ? raw.post_id : "";
    if (!id) { skip("Postnummer ontbreekt of heeft een onverwacht formaat"); continue; }
    if (!Object.hasOwn(PREDIS_FORMATS, raw.media_type)) { skip("Onbekend inhoudstype ontvangen"); continue; }
    if (raw.media_type !== mediaType) { skip("Ander inhoudstype dan aangevraagd"); continue; }
    if (typeof raw.caption !== "string" || raw.caption.length > 10000) { skip("Bijschrift ontbreekt, heeft een onverwacht formaat of is te lang"); continue; }
    if (!Array.isArray(raw.urls) || !raw.urls.length || raw.urls.length > 10) { skip("Medialijst ontbreekt, is leeg of bevat meer dan tien bestanden"); continue; }
    const post = normalizePredisPost(raw, [id]);
    if (!post) { skip("Mediaverwijzing heeft een onveilig of onverwacht formaat"); continue; }
    if (seen.has(id)) { duplicates++; continue; }
    seen.add(id); posts.push(post);
  }
  return { posts, skipped: Object.values(reasons).reduce((sum, n) => sum + n, 0), reasons, duplicates,
    received: rawPosts ? rawPosts.length : null, inspected: rawPosts ? Math.min(rawPosts.length, 20) : null,
    overflow: rawPosts ? Math.max(0, rawPosts.length - 20) : 0 };
}

export function predisLibraryDiagnostic({ result, report, brandId, mediaType, page, httpStatus = null, validJson = false, transportError = false }) {
  const errors = result?.errors;
  const hasErrors = Array.isArray(errors) ? errors.length > 0 : errors != null && errors !== "";
  let outcome, message;
  if (transportError) { outcome = "connection_error"; message = "Geen volledig antwoord ontvangen; een verbindingsfout of tijdslimiet. Het aantal posts is onbekend."; }
  else if (httpStatus === 401 || httpStatus === 403) { outcome = "access_error"; message = "Predis weigert toegang. Controleer API-toegang en de serverinstellingen."; }
  else if (httpStatus === 429) { outcome = "rate_limited"; message = "Predis vraagt om later opnieuw te proberen: de aanvraaglimiet is bereikt."; }
  else if (httpStatus < 200 || httpStatus >= 300) { outcome = "provider_error"; message = "Predis heeft een foutantwoord teruggestuurd; dit is geen bevestiging van een lege bibliotheek."; }
  else if (!validJson) { outcome = "invalid_json"; message = "Het antwoord van Predis kon niet als JSON worden gelezen."; }
  else if (hasErrors) { outcome = "provider_error"; message = "Predis meldt een fout in het antwoord. Er wordt geen lege bibliotheek verondersteld."; }
  else if (report.received === null) { outcome = "unexpected_shape"; message = "Het antwoord bevat niet de verwachte posts-lijst."; }
  else if (report.received === 0) { outcome = "empty"; message = "Predis geeft voor dit merk, inhoudstype en deze pagina een lege posts-lijst terug. Horeca OS heeft geen posts weggefilterd. Waarom de lijst leeg is, blijkt niet uit dit antwoord."; }
  else if (!report.posts.length) { outcome = "unusable"; message = "Predis levert posts, maar Horeca OS kan geen daarvan verwerken. Bekijk de redenen hieronder."; }
  else { outcome = "available"; message = "Predis levert bruikbare posts. Hieronder staat hoeveel er zijn ontvangen en verwerkt."; }
  const knownCodes = { "001": "001 — Aanvraaglimiet bereikt", "002": "002 — Predis meldt een ongeldig merk-ID" };
  const providerErrors = Array.isArray(errors) ? errors.slice(0, 10).map(e => {
    const code = e?.code ?? e?.error_code;
    return typeof code === "string" && Object.hasOwn(knownCodes, code) ? knownCodes[code] : "Predis-fout ontvangen; vrije fouttekst niet getoond om gegevens te beschermen";
  }) : hasErrors ? ["Onverwacht foutveld ontvangen; inhoud niet getoond"] : [];
  return { checkedAt: new Date().toISOString(), brandId, mediaType, page, requestedItems: 20, httpStatus, validJson,
    received: report.received, inspected: report.inspected, usable: report.posts.length, skipped: report.skipped,
    duplicates: report.duplicates, overflow: report.overflow, reasons: report.reasons,
    reportedPages: Number.isSafeInteger(result?.total_pages) && result.total_pages >= 0 ? result.total_pages : null,
    nestedPostsCount: Array.isArray(result?.data?.posts) ? result.data.posts.length : null,
    providerErrors, outcome, message };
}

import { publicWebUrl } from "./meta-campaign-settings";

export const META_CATALOG_RESOURCES = ["saved_audiences", "custom_audiences", "facebook_posts", "instagram_posts", "facebook_events"];
const id = value => String(value || "");
const clean = value => String(value || "").replace(/<[^>]*>/g, "").slice(0, 5000);
const definitions = {
  saved_audiences: { edge: "saved_audiences", fields: "id,name,targeting" },
  custom_audiences: { edge: "customaudiences", fields: "id,name,subtype" },
  facebook_posts: { edge: "published_posts", fields: "id,message,created_time,permalink_url,full_picture" },
  instagram_posts: { edge: "media", fields: "id,caption,timestamp,permalink,media_type,media_product_type,media_url,thumbnail_url" },
  facebook_events: { edge: "events", fields: "id,name,description,start_time,end_time,cover" },
};

export function normalizePromotion(resource, row) {
  if (resource.endsWith("audiences")) return { id: id(row.id), name: clean(row.name), ...(resource === "saved_audiences" ? { targeting: row.targeting || null } : { subtype: row.subtype || "CUSTOM" }) };
  return {
    id: id(row.id), kind: resource, name: clean(row.name || row.message || row.caption || (resource === "facebook_events" ? "Facebook-evenement" : "Bericht zonder tekst")).slice(0, 150),
    text: clean(row.description || row.message || row.caption), date: row.start_time || row.created_time || row.timestamp || null,
    image: publicWebUrl(row.cover?.source || row.full_picture || row.thumbnail_url || (row.media_type !== "VIDEO" ? row.media_url : "")),
    url: publicWebUrl(resource === "facebook_events" ? `https://www.facebook.com/events/${row.id}/` : row.permalink_url || row.permalink),
    mediaType: row.media_product_type || row.media_type || "POST",
  };
}

export async function listMetaCatalog(resource, after, { read, token, accountId, pageId, pageToken, instagramAccess }) {
  const definition = definitions[resource];
  if (!definition) throw new Error("Onbekende Meta-bron.");
  if (after && (typeof after !== "string" || after.length > 2048)) throw new Error("Ongeldige vervolgpagina.");
  const audience = resource.endsWith("audiences");
  let parent = audience ? accountId : pageId;
  if (!audience && !pageId) throw new Error("Koppel eerst de Facebookpagina van deze vestiging.");
  if (resource === "instagram_posts") {
    const page = await read(pageId, pageToken, { fields: "instagram_business_account{id}" });
    parent = page.instagram_business_account?.id;
    if (!parent) throw new Error("Meta geeft geen gekoppeld Instagram-profiel voor deze pagina terug.");
    if (instagramAccess && id(parent) !== id(instagramAccess.id)) throw new Error("Het gekoppelde Instagram-profiel hoort niet bij deze Facebookpagina. Controleer Koppelingen.");
  }
  const reader = resource === "instagram_posts" && instagramAccess ? instagramAccess.read : read;
  const accessToken = resource === "instagram_posts" && instagramAccess ? instagramAccess.token : audience ? token : pageToken;
  const result = await reader(`${parent}/${definition.edge}`, accessToken, { fields: definition.fields, limit: "25", ...(after ? { after } : {}) });
  return { options: (result.data || []).map(row => normalizePromotion(resource, row)), after: result.paging?.next ? result.paging?.cursors?.after || null : null };
}

// Re-read selections at creation time; never trust client-supplied targeting, ownership or previews.
export async function resolveMetaSelection(settings, { read, token, accountId, pageId, pageToken, instagramId, instagramAccess }) {
  let savedTargeting = null, source = null;
  if (settings.audienceMode === "saved") {
    const audience = await read(settings.savedAudienceId, token, { fields: "id,name,account{id},targeting" });
    if (id(audience.id) !== id(settings.savedAudienceId) || id(audience.account?.id).replace(/^act_/, "") !== id(accountId).replace(/^act_/, "")) throw new Error("Deze opgeslagen doelgroep hoort niet bij het gekoppelde advertentieaccount.");
    if (!audience.targeting?.geo_locations) throw new Error("Meta geeft geen bruikbare locatie-instellingen voor deze doelgroep terug.");
    if (Number(audience.targeting.age_min || 18) < 18) throw new Error("Deze doelgroep omvat minderjarigen. Kies een doelgroep vanaf 18 jaar.");
    savedTargeting = audience.targeting;
  }
  if (settings.audienceMode !== "saved") {
    for (const audienceId of settings.customAudienceIds || []) {
      const audience = await read(audienceId, token, { fields: "id,account_id" });
      if (id(audience.id) !== id(audienceId) || id(audience.account_id).replace(/^act_/, "") !== id(accountId).replace(/^act_/, "")) throw new Error("Een aangepaste doelgroep hoort niet bij dit advertentieaccount.");
    }
  }
  const kind = settings.sourceKind || "new";
  if (kind !== "new") {
    let row;
    if (kind === "facebook_posts") {
      row = await read(settings.sourceId, pageToken, { fields: "id,from{id},message,created_time,permalink_url,full_picture" });
      if (id(row.from?.id) !== id(pageId) || !id(row.id).startsWith(`${pageId}_`)) throw new Error("Dit bericht hoort niet bij de Facebookpagina van deze vestiging.");
    } else if (kind === "instagram_posts") {
      if (instagramAccess && id(instagramId) !== id(instagramAccess.id)) throw new Error("Het gekoppelde Instagram-profiel hoort niet bij deze Facebookpagina.");
      row = await (instagramAccess?.read || read)(settings.sourceId, instagramAccess?.token || pageToken, { fields: "id,owner{id},caption,timestamp,permalink,media_type,media_product_type,media_url,thumbnail_url" });
      if (!instagramId || id(row.owner?.id) !== id(instagramId)) throw new Error("Dit Instagrambericht hoort niet bij deze vestiging.");
    } else if (kind === "facebook_events") {
      row = await read(settings.sourceId, pageToken, { fields: "id,owner{id},name,description,start_time,end_time,cover" });
      if (id(row.owner?.id) !== id(pageId)) throw new Error("Dit evenement is niet van de gekoppelde Facebookpagina. Promoot het rechtstreeks in Meta.");
      if (row.end_time && Date.parse(row.end_time) < Date.now()) throw new Error("Dit Facebook-evenement is afgelopen.");
    } else throw new Error("Kies een geldige advertentiebron.");
    if (id(row.id) !== id(settings.sourceId)) throw new Error("Meta heeft een andere bron teruggegeven. Kies de bron opnieuw.");
    source = normalizePromotion(kind, row);
  }
  return { savedTargeting, source };
}

export function promotionCreative(settings, pageId, instagramId) {
  if (settings.sourceKind === "facebook_posts") return { object_story_id: settings.sourceId };
  if (settings.sourceKind === "instagram_posts") return { source_instagram_media_id: settings.sourceId, instagram_user_id: String(instagramId), object_id: String(pageId) };
  return null;
}

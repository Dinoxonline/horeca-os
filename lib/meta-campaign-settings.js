export const META_OBJECTIVES = {
  traffic: { label: "Verkeer", detail: "Meer bezoekers naar je website of ticketpagina", api: "OUTCOME_TRAFFIC", optimization: "LINK_CLICKS" },
  engagement: { label: "Betrokkenheid", detail: "Meer interactie met je advertentie", api: "OUTCOME_ENGAGEMENT", optimization: "POST_ENGAGEMENT" },
  awareness: { label: "Bekendheid", detail: "Je evenement of aanbod onder de aandacht brengen", api: "OUTCOME_AWARENESS", optimization: "REACH" },
};
export const META_CTA = {
  tickets: { label: "Tickets kopen", api: "BUY_TICKETS" },
  learn_more: { label: "Meer informatie", api: "LEARN_MORE" },
  book_now: { label: "Nu boeken", api: "BOOK_NOW" },
  shop_now: { label: "Nu kopen", api: "SHOP_NOW" },
  sign_up: { label: "Aanmelden", api: "SIGN_UP" },
};
export function publicWebUrl(value) {
  try { const url = new URL(String(value || "")); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}
const text = value => String(value || "").replace(/<[^>]*>/g, "").trim();
const localDate = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export function campaignImages(distribution = {}) {
  const common = distribution.common || {};
  const entries = [
    { url: common.images?.landscape?.url, label: "Evenement · liggend", format: "landscape" },
    { url: common.images?.square?.url, label: "Evenement · vierkant", format: "square" },
    { url: common.images?.portrait?.url, label: "Evenement · staand", format: "portrait" },
    { url: common.images?.vertical?.url, label: "Story · 9:16", format: "vertical" },
    { url: distribution.channel_payloads?.facebook?.image_url, label: "Facebook-afbeelding", format: "landscape" },
    { url: common.image_url, label: "Evenementfoto", format: "unknown" },
    ...(distribution.campaign_assets || []).map((asset, index) => ({ url: asset.url, label: `Campagnebeeld ${index + 1}`, format: "unknown" })),
    { url: distribution.source_preview?.image, label: "Bronafbeelding", format: "unknown" },
  ];
  const seen = new Set();
  return entries.filter(entry => { entry.url = publicWebUrl(entry.url); if (!entry.url || seen.has(entry.url)) return false; seen.add(entry.url); return true; });
}

export function campaignImageForPlacement(distribution = {}, placements = "both") {
  const formats = placements === "facebook" ? ["landscape", "square", "portrait", "vertical", "unknown"] : ["portrait", "square", "vertical", "landscape", "unknown"];
  const images = campaignImages(distribution);
  return formats.map(format => images.find(image => image.format === format)).find(Boolean) || null;
}

export function campaignPrimaryText(item = {}, distribution = {}) {
  const common = distribution.common || {};
  const isWebsiteEvent = Boolean(distribution.eventin_event_id || distribution.external_ids?.eventin || ["website_event", "eventin_event"].includes(distribution.source_type));
  return text(isWebsiteEvent ? common.description || common.short_description || distribution.channel_payloads?.facebook?.text || item.body : distribution.channel_payloads?.facebook?.text || common.short_description || common.description || item.body);
}
export function defaultMetaCampaign(item = {}, distribution = {}, now = new Date()) {
  const title = text(distribution.common?.title || distribution.source_preview?.title || item.body).slice(0, 100) || "Campagne";
  const start = new Date(now.getTime() + 15 * 60000);
  const eventEnd = new Date(distribution.common?.end || item.scheduled_for || "");
  const end = Number.isFinite(eventEnd.getTime()) && eventEnd > start ? eventEnd : new Date(start.getTime() + 3 * 86400000);
  return {
    campaignName: title, objective: "traffic", budgetType: "daily", dailyBudget: 10,
    audienceMode: "saved", savedAudienceId: "", savedAudienceName: "", customAudienceIds: [],
    sourceKind: "new", sourceId: "", sourcePreview: null, specialCategory: "none", beneficiary: "", payer: "",
    startAt: localDate(start), endAt: localDate(end), ageMin: 18, ageMax: 65, gender: "all",
    countries: ["NL"], locationQuery: "", locationKey: "", radiusKm: 25, interests: [],
    placements: "both", placementFormat: "feed", primaryText: campaignPrimaryText(item, distribution),
    headline: title, description: "", imageUrl: campaignImageForPlacement(distribution, "both")?.url || "",
    destinationUrl: publicWebUrl(distribution.source_url || distribution.common?.website_url || distribution.common?.cta?.url), callToAction: distribution.source_type && !["event", "website_event"].includes(distribution.source_type) ? "learn_more" : "tickets", launchStatus: "paused",
  };
}
export function validateMetaCampaign(settings, now = new Date()) {
  if (!["manual", "advantage", "saved"].includes(settings.audienceMode || "manual")) return "Kies een geldige doelgroepsoort.";
  if (settings.audienceMode === "saved" && !/^\d+$/.test(String(settings.savedAudienceId || ""))) return "Kies een opgeslagen doelgroep uit Meta.";
  if (settings.customAudienceIds !== undefined && (!Array.isArray(settings.customAudienceIds) || settings.customAudienceIds.length > 10 || settings.customAudienceIds.some(id => !/^\d+$/.test(String(id))))) return "Kies maximaal tien aangepaste doelgroepen uit Meta.";
  if ((settings.specialCategory || "none") !== "none") return "Bijzondere advertentiecategorieën vereisen aanvullende instellingen. Maak deze campagne rechtstreeks in Meta.";
  if (settings.editorVersion === 3 && [settings.beneficiary, settings.payer].some(value => typeof value !== "string" || !value.trim() || value.length > 200)) return "Vul de adverteerder (begunstigde) en betaler in, maximaal 200 tekens per naam.";
  const sourceKind = settings.sourceKind || "new";
  if (!["new", "facebook_posts", "instagram_posts", "facebook_events"].includes(sourceKind)) return "Kies een geldige advertentiebron.";
  if (sourceKind !== "new" && !(sourceKind === "facebook_posts" ? /^\d+_\d+$/ : /^\d+$/).test(String(settings.sourceId || ""))) return "Kies het bericht of evenement uit de bronlijst.";
  const existingPost = ["facebook_posts", "instagram_posts"].includes(sourceKind);
  if (existingPost && settings.objective !== "engagement") return "Bestaande berichten worden hier met het doel Betrokkenheid gepromoot.";
  if (sourceKind === "facebook_events" && settings.objective !== "traffic") return "Evenementpromotie gebruikt hier Verkeer naar de Facebook-evenementpagina.";
  if (existingPost && (settings.placements !== (sourceKind === "facebook_posts" ? "facebook" : "instagram") || settings.placementFormat !== "automatic")) return "Een bestaand bericht wordt op het oorspronkelijke kanaal gepromoot; Meta bepaalt de geschikte plaatsingen.";
  if (typeof settings.campaignName !== "string" || !settings.campaignName.trim() || settings.campaignName.length > 150) return "Geef de campagne een naam van maximaal 150 tekens.";
  if (!Object.hasOwn(META_OBJECTIVES, settings.objective)) return "Kies een ondersteund campagnedoel.";
  if (!["daily", "lifetime"].includes(settings.budgetType)) return "Kies een dagbudget of totaalbudget.";
  if (!Number.isFinite(Number(settings.dailyBudget)) || Number(settings.dailyBudget) < 2) return "Kies een budget van minimaal € 2,00.";
  const start = new Date(settings.startAt), end = new Date(settings.endAt);
  if (!Number.isFinite(start.getTime()) || start < new Date(now.getTime() - 60000)) return "Kies een startdatum in de toekomst.";
  if (!Number.isFinite(end.getTime()) || end <= start) return "De einddatum moet na de startdatum liggen.";
  const min = Number(settings.ageMin), max = Number(settings.ageMax);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 18 || max > 65 || max < min) return "Kies een leeftijd van 18 tot en met 65+ jaar, met maximum boven minimum.";
  if (!["all", "women", "men"].includes(settings.gender)) return "Kies een geldig geslacht.";
  if (!Array.isArray(settings.countries) || settings.countries.length !== 1 || !/^[A-Z]{2}$/.test(settings.countries[0])) return "Kies één geldig land.";
  if (!Number.isInteger(Number(settings.radiusKm)) || Number(settings.radiusKm) < 1 || Number(settings.radiusKm) > 80) return "Kies een straal van 1 tot 80 kilometer.";
  if (!["automatic", "both", "facebook", "instagram"].includes(settings.placements)) return "Kies Facebook, Instagram of beide.";
  if (!["automatic", "feed", "story", "feed_story"].includes(settings.placementFormat)) return "Kies een geldige plaatsing.";
  if (typeof settings.locationQuery !== "string" || settings.locationQuery.length > 100) return "Vul een geldige plaatsnaam in.";
  if (!Array.isArray(settings.interests) || settings.interests.length > 10 || settings.interests.some(item => !item || !/^\d+$/.test(String(item.id)) || typeof item.name !== "string" || !item.name)) return "Kies maximaal tien interesses uit de zoekresultaten.";
  if (existingPost) return "";
  if (typeof settings.primaryText !== "string" || !settings.primaryText.trim() || settings.primaryText.length > 2200) return "Vul advertentietekst in (maximaal 2.200 tekens).";
  if (typeof settings.headline !== "string" || !settings.headline.trim() || settings.headline.length > 100) return "Vul een kop in (maximaal 100 tekens).";
  if (typeof settings.description !== "string" || settings.description.length > 200) return "De beschrijving mag maximaal 200 tekens bevatten.";
  if (!publicWebUrl(settings.destinationUrl)) return "Vul een volledige website- of ticketlink in (https://…).";
  if (!publicWebUrl(settings.imageUrl)) return "Kies een afbeelding of vul een openbare afbeeldingslink in.";
  if (!Object.hasOwn(META_CTA, settings.callToAction)) return "Kies een ondersteunde actieknop.";
  return "";
}
export function campaignBudgetSummary(settings) {
  const days = Math.max(1, Math.ceil((new Date(settings.endAt) - new Date(settings.startAt)) / 86400000));
  const amount = Number(settings.dailyBudget);
  return { days, amount, estimate: Number.isFinite(amount * days) ? (settings.budgetType === "lifetime" ? amount : amount * days) : null, fixed: settings.budgetType === "lifetime" };
}
export function metaTargeting(settings, city, savedTargeting = null) {
  const targeting = savedTargeting ? { ...savedTargeting } : {
    age_min: Number(settings.ageMin), age_max: Number(settings.ageMax),
    geo_locations: city ? { cities: [{ key: String(city.key), radius: Number(settings.radiusKm), distance_unit: "kilometer" }] } : { countries: settings.countries },
  };
  if (!savedTargeting) {
    if (settings.gender !== "all") targeting.genders = [settings.gender === "men" ? 1 : 2];
    if (settings.interests.length) targeting.interests = settings.interests.map(({ id, name }) => ({ id: String(id), name }));
    targeting.targeting_automation = { advantage_audience: settings.audienceMode === "advantage" ? 1 : 0 };
    if (settings.customAudienceIds?.length) targeting.custom_audiences = settings.customAudienceIds.map(id => ({ id: String(id) }));
  }
  // Saved audiences provide the audience, never silently override the visible placement choices.
  for (const field of ["publisher_platforms", "facebook_positions", "instagram_positions", "messenger_positions", "audience_network_positions", "device_platforms"]) delete targeting[field];
  if (settings.placements !== "automatic") {
    const platforms = settings.placements === "both" ? ["facebook", "instagram"] : [settings.placements];
    targeting.publisher_platforms = platforms;
    if (settings.placementFormat !== "automatic") {
      const positions = settings.placementFormat === "feed_story" ? ["feed", "story"] : [settings.placementFormat];
      if (platforms.includes("facebook")) targeting.facebook_positions = positions;
      if (platforms.includes("instagram")) targeting.instagram_positions = positions.map(position => position === "feed" ? "stream" : position);
      if (positions.includes("story") || platforms.includes("instagram")) targeting.device_platforms = ["mobile"];
    }
  }
  return targeting;
}
export function metaStorySpec(settings, pageId, instagramId) {
  return {
    page_id: String(pageId),
    ...(instagramId && settings.placements !== "facebook" ? { instagram_user_id: String(instagramId) } : {}),
    link_data: { link: settings.destinationUrl, message: settings.primaryText, name: settings.headline,
      ...(settings.description ? { description: settings.description } : {}), picture: settings.imageUrl,
      call_to_action: { type: META_CTA[settings.callToAction].api, value: { link: settings.destinationUrl } },
    },
  };
}

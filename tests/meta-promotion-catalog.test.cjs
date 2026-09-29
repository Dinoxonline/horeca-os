const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const swc = require("next/dist/build/swc");
const root = path.resolve(__dirname, "..");
function load(file, mocks = {}) {
  const { code } = swc.transformSync(fs.readFileSync(path.join(root, file), "utf8"), { filename: file, jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022", transform: { react: { runtime: "automatic" } } }, module: { type: "commonjs" } });
  const module = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})")((name) => {
    if (mocks[name]) return mocks[name];
    if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    return name.startsWith(".") ? load(path.join(path.dirname(file), name) + ".js", mocks) : require(name);
  }, module, module.exports);
  return module.exports;
}
const distribution = { kind: "campaign_distribution", common: { title: "Muziek", description: "Live muziek", image_url: "https://example.com/photo.jpg", website_url: "https://example.com/tickets" } };
const item = { id: "event", business_id: "venue", media: [distribution] };

test("catalog routes page/Instagram/account edges and returns safe cursors, not token-bearing URLs", async () => {
  await swc.loadBindings();
  const catalog = load("lib/meta-promotion-catalog.js");
  const calls = [];
  const context = { accountId: "act_99", pageId: "10", token: "ads-token", pageToken: "page-token", read: async (path, token, values) => {
    calls.push({ path, token, values });
    return path === "10" ? { instagram_business_account: { id: "20" } } : { data: [{ id: "31", name: "Naam", caption: "Tekst", media_type: "VIDEO", thumbnail_url: "https://example.com/thumb.jpg", media_url: "https://example.com/video.mp4" }], paging: { cursors: { after: "cursor" }, next: "https://evil.test/?access_token=secret" } };
  } };
  for (const resource of catalog.META_CATALOG_RESOURCES) {
    const result = await catalog.listMetaCatalog(resource, "next-page", context);
    assert.equal(result.after, "cursor"); assert.ok(!JSON.stringify(result).includes("secret"));
    const last = calls.at(-1);
    assert.equal(last.token, resource.endsWith("audiences") ? "ads-token" : "page-token");
    assert.equal(last.values.after, "next-page");
    if (resource === "instagram_posts") { assert.equal(last.path, "20/media"); assert.equal(result.options[0].image, "https://example.com/thumb.jpg"); }
    if (resource === "facebook_events") assert.equal(result.options[0].url, "https://www.facebook.com/events/31/");
  }
  await assert.rejects(catalog.listMetaCatalog("facebook_posts", "x".repeat(2049), context), /vervolgpagina/);
  assert.equal(catalog.normalizePromotion("facebook_posts", { id: "1", permalink_url: "javascript:alert(1)" }).url, "");
});

test("selection revalidation rejects cross-venue sources and foreign account audiences", async () => {
  await swc.loadBindings();
  const { resolveMetaSelection, promotionCreative } = load("lib/meta-promotion-catalog.js");
  let foreign = false;
  const context = { accountId: "act_99", pageId: "10", instagramId: "20", token: "ads", pageToken: "page", read: async (id) => ({
    id, account: { id: foreign ? "88" : "99" }, account_id: foreign ? "88" : "99", targeting: { geo_locations: { countries: ["ES"] }, age_min: 25 },
    from: { id: foreign ? "11" : "10" }, owner: { id: foreign ? "11" : id === "32" ? "20" : "10" }, name: "Bron",
  }) };
  for (const sourceKind of ["facebook_posts", "instagram_posts", "facebook_events"]) {
    const settings = { sourceKind, sourceId: sourceKind === "facebook_posts" ? "10_31" : sourceKind === "instagram_posts" ? "32" : "33" };
    foreign = false; assert.equal((await resolveMetaSelection(settings, context)).source.kind, sourceKind);
    foreign = true; await assert.rejects(resolveMetaSelection(settings, context), /niet/);
  }
  foreign = false;
  assert.equal((await resolveMetaSelection({ audienceMode: "saved", savedAudienceId: "40" }, context)).savedTargeting.age_min, 25);
  foreign = true;
  await assert.rejects(resolveMetaSelection({ audienceMode: "saved", savedAudienceId: "40" }, context), /advertentieaccount/);
  await assert.rejects(resolveMetaSelection({ audienceMode: "manual", customAudienceIds: ["41"] }, context), /advertentieaccount/);
  assert.deepEqual(promotionCreative({ sourceKind: "facebook_posts", sourceId: "10_31" }, "10", "20"), { object_story_id: "10_31" });
  const ig = promotionCreative({ sourceKind: "instagram_posts", sourceId: "32" }, "10", "20");
  assert.equal(ig.source_instagram_media_id, "32"); assert.equal(ig.instagram_user_id, "20"); assert.equal(ig.object_story_spec, undefined);
});

test("targeting preserves saved exclusions, explicitly controls Advantage+ and gates unsupported / incomplete choices", async () => {
  await swc.loadBindings();
  const settings = load("lib/meta-campaign-settings.js");
  const draft = { ...settings.defaultMetaCampaign(item, distribution), editorVersion: 3, beneficiary: "Restaurant", payer: "Bedrijf" };
  assert.equal(settings.validateMetaCampaign(draft), "");
  for (const patch of [{ payer: "" }, { specialCategory: "housing" }, { sourceKind: "facebook_posts", sourceId: "10_31" }, { audienceMode: "saved", savedAudienceId: "" }, { customAudienceIds: ["bad"] }]) assert.ok(settings.validateMetaCampaign({ ...draft, ...patch }));
  const post = { ...draft, sourceKind: "facebook_posts", sourceId: "10_31", objective: "engagement", placements: "facebook", placementFormat: "automatic", primaryText: "", imageUrl: "", destinationUrl: "" };
  assert.equal(settings.validateMetaCampaign(post), "", "existing post keeps its original content; no dummy image/link needed");
  assert.equal(settings.metaTargeting(draft).targeting_automation.advantage_audience, 0);
  assert.equal(settings.metaTargeting({ ...draft, audienceMode: "advantage" }).targeting_automation.advantage_audience, 1);
  const saved = { age_min: 25, geo_locations: { countries: ["ES"] }, excluded_custom_audiences: [{ id: "55" }], publisher_platforms: ["messenger"], messenger_positions: ["messenger_home"] };
  const target = settings.metaTargeting({ ...draft, placements: "facebook" }, null, saved);
  assert.equal(target.age_min, 25); assert.deepEqual(target.geo_locations.countries, ["ES"]); assert.deepEqual(target.excluded_custom_audiences, [{ id: "55" }]);
  assert.deepEqual(target.publisher_platforms, ["facebook"]); assert.equal(target.messenger_positions, undefined);
  assert.deepEqual(saved.publisher_platforms, ["messenger"], "original audience is not mutated");
});

test("creation uses verified existing post / event, real saved audience and DSA, never activates", async () => {
  await swc.loadBindings();
  const originalFetch = global.fetch, calls = [], credentials = [];
  let foreign = false;
  const user = { auth: { getUser: async () => ({ data: { user: { id: "user" } } }) }, from() { const q = { select() { return q; }, eq() { return q; }, then(resolve) { return Promise.resolve({ data: [{ business_id: "venue", role: { role_key: "owner" } }] }).then(resolve); } }; return q; } };
  const admin = { from(table) { const filters = {}; const q = { select() { return q; }, eq(key, value) { filters[key] = value; return q; }, update() { return q; }, then(resolve) { return Promise.resolve({ error: null }).then(resolve); }, async maybeSingle() {
    if (table === "integration_credentials") { credentials.push(filters); return { data: { token_ciphertext: filters.account_id } }; }
    return { data: table === "social_content_items" ? item : filters.provider === "facebook_ads" ? { id: "ads-row", external_account_id: "act_99", connection_status: "connected", granted_scopes: ["ads_management"] } : filters.provider === "meta" ? { id: "ig-row", external_account_id: "20", connection_status: "connected", granted_scopes: ["instagram_business_basic"] } : { id: "page-row", external_account_id: "10" } };
  } }; return q; } };
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url), id = parsed.pathname.split("/").pop();
    if (id === "32") { assert.equal(parsed.hostname, "graph.instagram.com"); assert.equal(options.headers.Authorization, "Bearer ig-row"); }
    if (options.method === "POST") { calls.push({ path: parsed.pathname, body: Object.fromEntries(options.body) }); return { ok: true, json: async () => ({ id: String(100 + calls.length) }) }; }
    const result = id === "act_99" ? { currency: "EUR" } : id === "10" ? { instagram_business_account: { id: "20" } } : id === "40" ? { id: "40", account: { id: "99" }, targeting: { age_min: 30, geo_locations: { countries: ["ES"] } } } : { id, from: { id: foreign ? "11" : "10" }, owner: { id: foreign ? "11" : id === "32" ? "20" : "10" }, name: "Meta event", message: "Meta text" };
    return { ok: true, json: async () => result };
  };
  const route = load("app/api/integrations/facebook/ads/route.js", {
    "../../../../../lib/server-supabase": { createAdminSupabase: () => admin, createUserSupabase: () => user },
    "../../../../../lib/meta-oauth": { decryptMetaToken: value => value.token_ciphertext },
  });
  const base = { ...load("lib/meta-campaign-settings.js").defaultMetaCampaign(item, distribution), editorVersion: 3, beneficiary: "Het Plein", payer: "Le Club BV", audienceMode: "saved", savedAudienceId: "40", savedAudiencePreview: { age_min: 12 } };
  const request = (patch, token = true) => new Request("https://example.com/api/integrations/facebook/ads", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer session" } : {}) }, body: JSON.stringify({ workspaceId: "workspace", businessId: "venue", campaignId: "event", settings: { ...base, ...patch } }) });
  try {
    for (const kind of ["facebook_posts", "instagram_posts", "facebook_events"]) {
      calls.length = 0;
      const patch = { sourceKind: kind, sourceId: kind === "facebook_posts" ? "10_31" : kind === "instagram_posts" ? "32" : "33", objective: kind === "facebook_events" ? "traffic" : "engagement", placements: kind === "instagram_posts" ? "instagram" : "facebook", placementFormat: "automatic" };
      const response = await route.POST(request(patch)); assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      assert.equal(calls.length, 4); assert.equal(calls[0].body.status, "PAUSED"); assert.equal(calls[1].body.status, "PAUSED"); assert.equal(calls[3].body.status, "PAUSED");
      assert.equal(calls[1].body.dsa_beneficiary, "Het Plein"); assert.equal(calls[1].body.dsa_payor, "Le Club BV");
      assert.equal(JSON.parse(calls[1].body.targeting).age_min, 30, "server target wins over fabricated preview");
      const creative = calls[2].body;
      if (kind === "facebook_posts") assert.equal(creative.object_story_id, "10_31");
      if (kind === "instagram_posts") assert.equal(creative.source_instagram_media_id, "32");
      if (kind === "facebook_events") assert.equal(JSON.parse(creative.object_story_spec).link_data.link, "https://www.facebook.com/events/33/");
      assert.equal((await response.json()).paidCampaign.source.id, patch.sourceId);
      foreign = true; calls.length = 0; assert.equal((await route.POST(request(patch))).status, 502); assert.equal(calls.length, 0); foreign = false;
    }
    assert.equal((await route.POST(request({ specialCategory: "politics" }))).status, 400); assert.equal(calls.length, 0);
    const get = token => new Request("https://example.com/api/integrations/facebook/ads?workspaceId=workspace&businessId=venue&resource=facebook_posts&pageId=evil", { headers: token ? { Authorization: "Bearer session" } : {} });
    assert.equal((await route.GET(get(false))).status, 401);
    assert.equal((await route.GET(get(true))).status, 200);
    assert.ok(credentials.every(row => row.workspace_id === "workspace" && row.business_id === "venue"));
    assert.ok(credentials.some(row => row.account_id === "page-row"));
  } finally { global.fetch = originalFetch; }
});

test("UI selects a real Instagram post, uses saved audience, retains preview and submits original media IDs", async () => {
  await swc.loadBindings();
  const React = require("react"), Renderer = require("react-test-renderer"); global.IS_REACT_ACT_ENVIRONMENT = true;
  const Composer = load("components/meta-campaign-composer.js", { "next/image": { __esModule: true, default: props => React.createElement("img", { src: props.src, alt: props.alt }) } }).default;
  let renderer, submitted;
  const catalogs = [];
  const onCatalog = async (kind, after) => { catalogs.push({ kind, after }); return kind === "saved_audiences" ? { options: [{ id: "40", name: "Spanje 30+", targeting: { geo_locations: { countries: ["ES"] }, age_min: 30 } }] } : { options: [{ id: after ? "33" : "32", name: "Onze Reel", text: "Heerlijk eten", image: "https://example.com/thumb.jpg", url: "https://www.instagram.com/reel/test/", mediaType: "REELS" }], after: after ? null : "older" }; };
  const button = label => renderer.root.findAllByType("button").find(node => node.props.children === label || Array.isArray(node.props.children) && node.props.children.includes(label));
  try {
    await React.act(async () => { renderer = Renderer.create(React.createElement(Composer, { item, distribution, pageName: "Pagina", businessName: "Restaurant", onCatalog, onCreate: value => { submitted = value; } })); });
    await React.act(async () => button("Instagramberichten / Reels").props.onClick());
    assert.equal(catalogs[0].kind, "instagram_posts");
    await React.act(async () => button("Meer laden").props.onClick());
    assert.equal(catalogs[1].after, "older");
    await React.act(async () => button("Kiezen").props.onClick());
    await React.act(async () => button("Betaler is dezelfde als adverteerder").props.onClick());
    await React.act(async () => button("Doelgroep en plaatsingen").props.onClick());
    const savedRadio = renderer.root.findAllByType("label").find(node => node.findAllByType("strong").some(strong => strong.props.children === "Opgeslagen doelgroep uit Meta")).findByType("input");
    await React.act(async () => savedRadio.props.onChange());
    await React.act(async () => button("Doelgroepen ophalen").props.onClick());
    const audienceSelect = renderer.root.findAllByType("select").find(node => node.findAllByType("option").some(option => option.props.value === "40"));
    await React.act(async () => audienceSelect.props.onChange({ target: { value: "40" } }));
    assert.ok(JSON.stringify(renderer.toJSON()).includes("Spanje 30+"));
    await React.act(async () => button("Advertentie").props.onClick());
    assert.equal(renderer.root.findAllByType("textarea").length, 0, "original post text is not shown as editable");
    await React.act(async () => button("Controleren en concept maken").props.onClick());
    assert.equal(submitted.sourceId, "32"); assert.equal(submitted.savedAudienceId, "40"); assert.equal(submitted.objective, "engagement"); assert.equal(submitted.placements, "instagram"); assert.equal(submitted.payer, "Pagina");
  } finally { if (renderer) await React.act(async () => renderer.unmount()); }
});

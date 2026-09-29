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
const distribution = { kind: "campaign_distribution", common: { title: "Live muziek", description: "Een avond vol muziek.", image_url: "https://example.com/poster.jpg", website_url: "https://example.com/tickets" } };
const item = { id: "campaign", body: "Tekst", business_id: "venue", media: [distribution] };

test("settings have stable future dates, safe URLs and real budget/placement mappings", async () => {
  await swc.loadBindings();
  const settings = load("lib/meta-campaign-settings.js");
  const now = new Date("2026-09-29T12:00:00Z");
  const draft = settings.defaultMetaCampaign({ ...item, scheduled_for: "2020-01-01" }, distribution, now);
  assert.equal(settings.validateMetaCampaign(draft, now), "");
  assert.ok(new Date(draft.endAt) > new Date(draft.startAt));
  assert.equal(draft.launchStatus, "paused");
  for (const patch of [{ ageMin: "NaN" }, { ageMin: 17 }, { ageMin: 55, ageMax: 20 }, { dailyBudget: 0 }, { imageUrl: "javascript:alert(1)" }, { primaryText: "" }, { campaignName: 33 }, { interests: [null] }]) assert.ok(settings.validateMetaCampaign({ ...draft, ...patch }, now));
  const lifetime = { ...draft, budgetType: "lifetime", dailyBudget: 100, placements: "both", placementFormat: "feed_story", gender: "women", interests: [{ id: "123", name: "Live muziek" }] };
  assert.equal(settings.campaignBudgetSummary(lifetime).estimate, 100);
  const targeting = settings.metaTargeting(lifetime, { key: "city" });
  assert.deepEqual(targeting.geo_locations.cities, [{ key: "city", radius: 25, distance_unit: "kilometer" }]);
  assert.deepEqual(targeting.genders, [2]);
  assert.deepEqual(targeting.facebook_positions, ["feed", "story"]);
  assert.deepEqual(targeting.instagram_positions, ["stream", "story"]);
  const story = settings.metaStorySpec({ ...lifetime, headline: "Eigen kop", primaryText: "Eigen tekst", callToAction: "sign_up" }, "page-plein", "ig-plein");
  assert.equal(story.page_id, "page-plein"); assert.equal(story.instagram_user_id, "ig-plein");
  assert.equal(story.link_data.message, "Eigen tekst"); assert.equal(story.link_data.name, "Eigen kop");
  assert.equal(story.link_data.call_to_action.type, "SIGN_UP");
  assert.equal(settings.metaStorySpec(draft, "page").link_data.call_to_action.type, "BUY_TICKETS");
  assert.equal(settings.metaStorySpec({ ...draft, callToAction: "book_now" }, "page").link_data.call_to_action.type, "BOOK_NOW");
  assert.ok(settings.validateMetaCampaign({ ...draft, objective: "toString" }, now));
  assert.ok(settings.validateMetaCampaign({ ...draft, callToAction: "constructor" }, now));
});

test("editor edits update preview, retain step state, search real IDs and submit paused settings", async () => {
  await swc.loadBindings();
  const React = require("react"), Renderer = require("react-test-renderer");
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const Composer = load("components/meta-campaign-composer.js", { "next/image": { __esModule: true, default: props => React.createElement("img", { src: props.src, alt: props.alt }) } }).default;
  let renderer, submitted, dirty = false;
  await React.act(async () => { renderer = Renderer.create(React.createElement(Composer, { item, distribution, businessName: "Grandcafé Het Plein", pageName: "Pagina Het Plein", onDirty: value => { dirty = value; }, onCreate: value => { submitted = value; }, onSearch: async resource => resource === "locations" ? [{ key: "100", name: "Zoetermeer", country: "NL", region: "Zuid-Holland" }] : [{ id: "123", name: "Live muziek" }] })); });
  const button = name => renderer.root.findAllByType("button").find(node => node.props.children === name || (Array.isArray(node.props.children) && node.props.children.includes(name)));
  const control = label => renderer.root.findAllByType("label").find(node => Array.isArray(node.props.children) && node.props.children[0] === label).findAll(node => ["input", "select", "textarea"].includes(node.type))[0];
  const change = (label, value) => React.act(async () => control(label).props.onChange({ target: { value } }));
  try {
    await change("Campagnenaam", "Mijn campagne");
    await change("Budgettype", "lifetime"); await change("Totaalbudget (€)", "85");
    await React.act(async () => button("Advertentieset").props.onClick());
    await change("Plaats (leeg = heel land)", "Zoetermeer");
    await React.act(async () => button("Zoek plaats").props.onClick());
    await change("Kies de plaats uit Meta", "100");
    await change("Kanalen", "instagram"); await change("Plaatsingen", "story");
    await change("Interesses (optioneel)", "muziek");
    await React.act(async () => button("Zoek interesse").props.onClick());
    await React.act(async () => button("Live muziek").props.onClick());
    await React.act(async () => button("Advertentie").props.onClick());
    await change("Advertentietekst", "Mijn eigen tekst"); await change("Kop", "Zaterdag live");
    await change("Actieknop", "sign_up");
    assert.ok(JSON.stringify(renderer.toJSON()).includes("Zaterdag live"));
    assert.ok(dirty);
    await React.act(async () => button("Campagne").props.onClick());
    assert.equal(control("Campagnenaam").props.value, "Mijn campagne");
    await React.act(async () => button("Controleren en concept maken").props.onClick());
    assert.equal(submitted.launchStatus, "paused"); assert.equal(submitted.editorVersion, 2);
    assert.equal(submitted.startAt, new Date(control("Start").props.value).toISOString());
    assert.equal(submitted.endAt, new Date(control("Einde").props.value).toISOString());
    assert.equal(submitted.dailyBudget, "85"); assert.equal(submitted.budgetType, "lifetime");
    assert.equal(submitted.locationKey, "100"); assert.equal(submitted.placementFormat, "story");
    assert.equal(submitted.interests[0].id, "123"); assert.equal(submitted.primaryText, "Mijn eigen tekst");
  } finally { await React.act(async () => renderer.unmount()); }
});

test("route sends edited fields to Meta, isolates venue identity, fails preflight safely and cannot activate", async () => {
  await swc.loadBindings();
  const originalFetch = global.fetch;
  const calls = [], writes = [], lookups = [];
  let currency = "EUR", allowedBusiness = "venue", ig = true;
  const user = { auth: { getUser: async () => ({ data: { user: { id: "user" } } }) }, from: () => { const q = { select() { return q; }, eq() { return q; }, then(resolve) { return Promise.resolve({ data: [{ business_id: allowedBusiness, role: { role_key: "owner" } }] }).then(resolve); } }; return q; } };
  const admin = { from(table) {
    const filters = {}; let payload;
    const q = { select() { return q; }, eq(key, value) { filters[key] = value; return q; }, update(value) { payload = value; return q; },
      async maybeSingle() {
        lookups.push({ table, filters });
        return { data: table === "social_content_items" ? item : table === "integration_credentials" ? { token_ciphertext: "encrypted" }
          : filters.provider === "facebook_ads" ? { id: "account-row", external_account_id: "act_123", display_name: "Shared account", connection_status: "connected", granted_scopes: ["ads_management"] }
          : { external_account_id: "page-venue", display_name: "Venue page" } };
      }, then(resolve) { writes.push({ table, filters, payload }); return Promise.resolve({ error: null }).then(resolve); },
    }; return q;
  } };
  global.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (options.method === "POST") { calls.push({ path: url.pathname, body: Object.fromEntries(options.body) }); return { ok: true, json: async () => ({ id: `result-${calls.length}` }) }; }
    let result = url.pathname.endsWith("/act_123") ? { currency } : url.pathname.endsWith("/page-venue") ? { instagram_business_account: ig ? { id: "ig-venue" } : undefined }
      : { data: url.searchParams.get("type") === "adinterest" ? [{ id: "123", name: "Music" }] : [{ key: "100", name: "Zoetermeer", country_code: "NL" }] };
    return { ok: true, json: async () => result };
  };
  const route = load("app/api/integrations/facebook/ads/route.js", {
    "../../../../../lib/server-supabase": { createAdminSupabase: () => admin, createUserSupabase: () => user },
    "../../../../../lib/meta-oauth": { decryptMetaToken: () => "secret" },
  });
  const settings = { ...load("lib/meta-campaign-settings.js").defaultMetaCampaign(item, distribution), editorVersion: 2, launchStatus: "active", budgetType: "lifetime", dailyBudget: 80, headline: "Nieuwe kop", primaryText: "Nieuwe tekst", description: "Korte uitleg", locationQuery: "Zoetermeer", locationKey: "100", placementFormat: "feed_story", callToAction: "sign_up", interests: [{ id: "123", name: "Music" }] };
  const request = patch => new Request("https://example.com/api/integrations/facebook/ads", { method: "POST", headers: { Authorization: "Bearer session", "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: "workspace", businessId: "venue", campaignId: "campaign", settings: { ...settings, ...patch } }) });
  try {
    const response = await route.POST(request()); assert.equal(response.status, 200);
    const receipt = (await response.json()).paidCampaign;
    assert.equal(receipt.status, "paused"); assert.equal(receipt.headline, "Nieuwe kop");
    assert.equal(calls.length, 4);
    for (const call of calls.filter(call => !call.path.endsWith("/adcreatives"))) assert.equal(call.body.status, "PAUSED");
    assert.equal(calls[1].body.lifetime_budget, "8000"); assert.equal(calls[1].body.daily_budget, undefined);
    const targeting = JSON.parse(calls[1].body.targeting); assert.equal(targeting.geo_locations.cities[0].key, "100");
    const creative = JSON.parse(calls[2].body.object_story_spec);
    assert.equal(creative.page_id, "page-venue"); assert.equal(creative.instagram_user_id, "ig-venue");
    assert.equal(creative.link_data.message, "Nieuwe tekst"); assert.equal(creative.link_data.picture, settings.imageUrl);
    assert.equal(creative.link_data.call_to_action.type, "SIGN_UP");
    assert.ok(lookups.every(call => call.filters.workspace_id === "workspace" && call.filters.business_id === "venue"));
    assert.equal(writes[0].filters.business_id, "venue");
    const count = calls.length;
    currency = "USD"; assert.equal((await route.POST(request())).status, 502); assert.equal(calls.length, count);
    currency = "EUR"; ig = false; assert.equal((await route.POST(request())).status, 502); assert.equal(calls.length, count);
    ig = true; assert.equal((await route.POST(request({ locationKey: "unknown" }))).status, 502); assert.equal(calls.length, count);
    assert.equal((await route.POST(request({ ageMin: 12 }))).status, 400); assert.equal(calls.length, count);
    const searchRequest = () => new Request("https://example.com/api/integrations/facebook/ads?workspaceId=workspace&businessId=venue&resource=interests&q=music", { headers: { Authorization: "Bearer session" } });
    assert.equal((await (await route.GET(searchRequest())).json()).options[0].id, "123");
    allowedBusiness = "other-venue"; assert.equal((await route.GET(searchRequest())).status, 403); assert.equal((await route.POST(request())).status, 403);
    assert.equal((await route.GET(new Request(searchRequest().url))).status, 401);
  } finally { global.fetch = originalFetch; }
});

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

test("saved Meta audiences always show their concrete location or a clearly labelled name fallback", async () => {
  await swc.loadBindings();
  const { audienceLocationSummary, audienceNameLocationHint } = load("components/meta-audience-picker.js");
  assert.equal(audienceLocationSummary({ geo_locations: { countries: ["NL"], cities: [{ name: "Zoetermeer", radius: 25, distance_unit: "km" }] } }), "Nederland, Zoetermeer + 25 km");
  assert.match(audienceLocationSummary({ geo_locations: {} }), /Locatie niet door Meta teruggegeven/);
  assert.equal(audienceNameLocationHint("Tot amsterdam 25+ 60 km"), "Amsterdam");
  assert.match(audienceLocationSummary({ geo_locations: {} }, "Tot amsterdam 25+ 60 km"), /Amsterdam \(volgens de doelgroepnaam/);
});

test("both entry points reuse the shared editor and new campaigns are not gated on a Facebook event", async () => {
  await swc.loadBindings();
  for (const file of ["components/central-event-creator.js", "components/marketing-overview.js", "components/meta-campaign-editor.js"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    swc.transformSync(source, { filename: file, jsc: { parser: { syntax: "ecmascript", jsx: true } } });
    if (file.includes("central-event")) {
      assert.match(source, /import { SavedMetaCampaignEditor } from "\.\/meta-campaign-editor"/);
      assert.match(source, /!websiteEventCancelled && <section className="savedChannelPanel savedFacebookAdsPanel"/);
      assert.match(source, /initialDraft={facebookAdDrafts\[item.id\]}/);
      assert.doesNotMatch(source, /async function startFacebookPaidCampaign|facebookAdsSpendWarning|Betaalde campagne starten/);
    }
  }
});

test("saved event and product panels open the same editor, use venue identity and create only after confirmation", async () => {
  await swc.loadBindings();
  const React = require("react"), Renderer = require("react-test-renderer");
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const originalFetch = global.fetch, originalWindow = global.window;
  let allowed = false, requests = [], saved, draftSnapshot;
  global.window = { confirm: () => allowed, addEventListener() {}, removeEventListener() {} };
  global.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (options.method === "POST") return { ok: true, json: async () => ({ paidCampaign: { status: "paused", campaign_id: "meta-123", manage_url: "https://www.facebook.com/adsmanager/" } }) };
    return { ok: true, json: async () => ({
      accounts: [{ business_id: "other", display_name: "Andere vestiging" }, { business_id: "venue", display_name: "Pagina Het Plein" }],
      adAccounts: [{ business_id: "venue", display_name: "Gedeeld advertentieaccount", connection_status: "connected", granted_scopes: ["ads_management"] }],
    }) };
  };
  const { SavedMetaCampaignEditor } = load("components/meta-campaign-editor.js", { "next/image": { __esModule: true, default: props => React.createElement("img", { src: props.src, alt: props.alt }) } });
  try {
    for (const type of ["website_event", "product"]) {
      requests = []; saved = undefined; allowed = false;
      const currentDistribution = { ...distribution, source_type: type, target_channels: [] };
      const currentItem = { ...item, media: [currentDistribution] };
      const props = { workspaceId: "workspace", session: { access_token: "test-session" }, item: currentItem, distribution: currentDistribution, business: { name: "Grandcafé Het Plein" }, onSaved: value => { saved = value; }, onDraftChange: value => { draftSnapshot = value; } };
      let renderer;
      try {
        await React.act(async () => { renderer = Renderer.create(React.createElement(SavedMetaCampaignEditor, props)); });
        assert.equal(requests.length, 0, "closed editors do not load accounts");
        await React.act(async () => renderer.root.findByProps({ className: "savedMetaCampaignEditor" }).props.onToggle({ currentTarget: { open: true } }));
        if (type === "website_event") {
          const form = JSON.stringify(renderer.toJSON());
          assert.match(form, /Je promoot dit evenement/);
          assert.doesNotMatch(form, /Facebook-evenementen/);
        }
        const preview = renderer.root.findByProps({ "aria-label": "Advertentievoorbeeld" });
        assert.ok(preview.findAllByType("strong").some(node => node.props.children === "Pagina Het Plein"));
        const field = renderer.root.findAllByType("input").find(node => node.props.maxLength === 150);
        await React.act(async () => field.props.onChange({ target: { value: "Mijn " + type } }));
        assert.equal(draftSnapshot.campaignName, "Mijn " + type);
        await React.act(async () => renderer.root.findAllByType("button").find(node => node.props.children === "Betaler is dezelfde als adverteerder").props.onClick());
        const submit = () => renderer.root.findAllByType("button").find(node => node.props.children === "Controleren en concept maken");
        await React.act(async () => submit().props.onClick());
        assert.equal(requests.filter(row => row.options.method === "POST").length, 0, "cancelled confirmation does not create anything");
        allowed = true;
        await React.act(async () => submit().props.onClick());
        const body = JSON.parse(requests.find(row => row.options.method === "POST").options.body);
        assert.equal(body.businessId, "venue"); assert.equal(body.campaignId, "campaign");
        assert.equal(body.settings.editorVersion, 3); assert.equal(body.settings.launchStatus, "paused");
        assert.equal(body.settings.campaignName, "Mijn " + type);
        assert.equal(saved.media[0].facebook_paid_campaign.status, "paused");
        await React.act(async () => renderer.update(React.createElement(SavedMetaCampaignEditor, { ...props, item: saved, distribution: saved.media[0] })));
        assert.equal(renderer.root.findAllByProps({ "aria-label": "Meta-campagne instellen" }).length, 0, "saved receipt replaces the creation form");
      } finally { if (renderer) await React.act(async () => renderer.unmount()); }
    }
  } finally { global.fetch = originalFetch; global.window = originalWindow; }
});

test("settings have stable future dates, safe URLs and real budget/placement mappings", async () => {
  await swc.loadBindings();
  const settings = load("lib/meta-campaign-settings.js");
  const now = new Date("2026-09-29T12:00:00Z");
  const draft = settings.defaultMetaCampaign({ ...item, scheduled_for: "2020-01-01" }, distribution, now);
  assert.equal(draft.campaignName, "Live muziek");
  const imageDistribution = { common: { images: { landscape: { url: "https://example.com/landscape.jpg" }, portrait: { url: "https://example.com/portrait.jpg" } } } };
  assert.equal(settings.campaignImageForPlacement(imageDistribution, "both").url, "https://example.com/portrait.jpg");
  assert.equal(settings.campaignImageForPlacement(imageDistribution, "facebook").url, "https://example.com/landscape.jpg");
  assert.equal(settings.defaultMetaCampaign(item, imageDistribution, now).imageUrl, "https://example.com/portrait.jpg");
  const eventDistribution = { source_type: "website_event", eventin_event_id: "123", common: { title: "Volledig evenement", short_description: "Korte versie", description: "Volledige omschrijving uit Eventin" }, channel_payloads: { facebook: { text: "Korte Facebooktekst" } } };
  assert.equal(settings.defaultMetaCampaign(item, eventDistribution, now).primaryText, "Volledige omschrijving uit Eventin");
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
    assert.equal(renderer.root.findAllByType("h4").some(node => node.props.children === "Jouw instellingen"), false, "the preview panel does not repeat editable settings");
    await change("Campagnenaam", "Mijn campagne");
    await change("Betaler", "Testbedrijf BV");
    await change("Budgettype", "lifetime"); await change("Totaalbudget (€)", "85");
    await React.act(async () => button("Doelgroep en plaatsingen").props.onClick());
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
    await React.act(async () => button("Campagne en bron").props.onClick());
    assert.equal(control("Campagnenaam").props.value, "Mijn campagne");
    await React.act(async () => button("Controleren en concept maken").props.onClick());
    assert.equal(submitted.launchStatus, "paused"); assert.equal(submitted.editorVersion, 3);
    assert.equal(submitted.startAt, new Date(control("Start").props.value).toISOString());
    assert.equal(submitted.endAt, new Date(control("Einde").props.value).toISOString());
    assert.equal(submitted.dailyBudget, "85"); assert.equal(submitted.budgetType, "lifetime");
    assert.equal(submitted.locationKey, "100"); assert.equal(submitted.placementFormat, "story");
    assert.equal(submitted.interests[0].id, "123"); assert.equal(submitted.primaryText, "Mijn eigen tekst");
  } finally { await React.act(async () => renderer.unmount()); }
});

test("advertentievoorbeeld behoudt de oorspronkelijke afbeeldingsverhouding", async () => {
  await swc.loadBindings();
  const React = require("react"), Renderer = require("react-test-renderer");
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const Composer = load("components/meta-campaign-composer.js", { "next/image": { __esModule: true, default: props => React.createElement("img", props) } }).default;
  let renderer;
  try {
    await React.act(async () => { renderer = Renderer.create(React.createElement(Composer, { item, distribution, businessName: "Caribbean Corner", onCreate() {}, onSearch: async () => [], onCatalog: async () => ({ options: [] }) })); });
    const image = renderer.root.findByProps({ alt: "Gekozen advertentiebeeld" });
    await React.act(async () => image.props.onLoad({ currentTarget: { naturalWidth: 1080, naturalHeight: 1350 } }));
    assert.equal(renderer.root.findAllByProps({ className: "adImage" })[0].props.style.aspectRatio, "0.8");
  } finally { if (renderer) await React.act(async () => renderer.unmount()); }
});

test("a saved Meta audience is edited in one dialog and saves the existing Meta audience", async () => {
  await swc.loadBindings();
  const React = require("react"), Renderer = require("react-test-renderer");
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const Composer = load("components/meta-campaign-composer.js", { "next/image": { __esModule: true, default: props => React.createElement("img", { src: props.src, alt: props.alt }) } }).default;
  let renderer, updated;
  const initialDraft = { audienceMode: "saved", savedAudienceId: "saved-1", savedAudienceName: "Tot Utrecht", savedAudiencePreview: { geo_locations: { countries: ["NL"], cities: [{ name: "Gouda", key: "gouda", radius: 37, distance_unit: "kilometer" }] }, age_min: 18, age_max: 65 }, countries: ["NL"], locationQuery: "Gouda", locationKey: "gouda", radiusKm: 37, ageMin: 18, ageMax: 65, gender: "all" };
  const button = name => renderer.root.findAllByType("button").find(node => node.props.children === name || (Array.isArray(node.props.children) && node.props.children.includes(name)));
  try {
    await React.act(async () => { renderer = Renderer.create(React.createElement(Composer, { item, distribution, businessName: "Caribbean Corner", pageName: "Caribbean Corner", initialDraft, onCreate() {}, onSearch: async () => [], onCatalog: async () => ({ options: [] }), onUpdateSavedAudience: async draft => { updated = draft; return { targeting: draft.savedAudiencePreview }; } })); });
    await React.act(async () => button("Doelgroep en plaatsingen").props.onClick());
    assert.ok(JSON.stringify(renderer.toJSON()).includes("Tot Utrecht"));
    assert.equal(renderer.root.findAllByProps({ role: "dialog" }).length, 0);
    await React.act(async () => button("Doelgroep bewerken").props.onClick());
    assert.equal(renderer.root.findAllByProps({ role: "dialog" }).length, 1);
    assert.ok(JSON.stringify(renderer.toJSON()).includes("Gouda"));
    assert.match(renderer.root.findByProps({ title: "Kaart van de doelgroep" }).props.src, /Gouda/);
    await React.act(async () => button("Doelgroep opslaan").props.onClick());
    assert.equal(updated.savedAudienceId, "saved-1");
    assert.equal(renderer.root.findAllByProps({ role: "dialog" }).length, 0);
    assert.ok(JSON.stringify(renderer.toJSON()).includes("bijgewerkt in Meta"));
  } finally { if (renderer) await React.act(async () => renderer.unmount()); }
});

test("route sends edited fields to Meta, isolates venue identity, fails preflight safely and cannot activate", async () => {
  await swc.loadBindings();
  const originalFetch = global.fetch;
  const calls = [], writes = [], lookups = [];
  let currency = "EUR", allowedBusiness = "venue", ig = true, paymentDenied = false, savedAudienceCapabilityDenied = false;
  let savedAudience = { id: "777", account: { id: "123" }, targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ["NL"] } } };
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
    if (url.searchParams.get("fields") === "funding_source_details,business_name") return { ok: !paymentDenied, json: async () => paymentDenied ? { error: { message: "No billing access" } } : { business_name: "Le Club", funding_source_details: { display_string: "Visa •••• 1234", id: "private-funding-id" } } };
    if (url.pathname.endsWith("/777")) {
      if (options.method === "POST") { calls.push({ path: url.pathname, body: Object.fromEntries(options.body) }); if (savedAudienceCapabilityDenied) return { ok: false, json: async () => ({ error: { message: "(#3) Application does not have the capability to make this API call." } }) }; savedAudience = { ...savedAudience, targeting: JSON.parse(Object.fromEntries(options.body).targeting) }; return { ok: true, json: async () => ({ success: true }) }; }
      return { ok: true, json: async () => savedAudience };
    }
    if (options.method === "POST") { calls.push({ path: url.pathname, body: Object.fromEntries(options.body) }); return { ok: true, json: async () => ({ id: `result-${calls.length}` }) }; }
    let result = url.pathname.endsWith("/act_123") ? { currency, spend_cap: "50000", amount_spent: "12000", balance: "1000", is_prepay_account: false } : url.pathname.endsWith("/page-venue") ? { instagram_business_account: ig ? { id: "ig-venue" } : undefined }
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
    const updateAudience = () => new Request("https://example.com/api/integrations/facebook/ads", { method: "POST", headers: { Authorization: "Bearer session", "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: "workspace", businessId: "venue", campaignId: "campaign", action: "update_saved_audience", settings: { ...settings, audienceMode: "saved", savedAudienceId: "777", ageMin: 25, ageMax: 55, gender: "women", locationQuery: "Zoetermeer", locationKey: "100", radiusKm: 20 } }) });
    const updatedAudience = await route.POST(updateAudience());
    assert.equal(updatedAudience.status, 200);
    assert.deepEqual((await updatedAudience.json()).targeting.geo_locations.cities, [{ key: "100", radius: 20, distance_unit: "kilometer" }]);
    assert.deepEqual(savedAudience.targeting.genders, [2]);
    savedAudienceCapabilityDenied = true;
    const deniedAudience = await route.POST(updateAudience());
    assert.equal(deniedAudience.status, 409);
    assert.match((await deniedAudience.json()).error, /Marketing API af/);
    const updatedCount = calls.length;
    const searchRequest = () => new Request("https://example.com/api/integrations/facebook/ads?workspaceId=workspace&businessId=venue&resource=interests&q=music", { headers: { Authorization: "Bearer session" } });
    assert.equal((await (await route.GET(searchRequest())).json()).options[0].id, "123");
    const budgetRequest = () => new Request("https://example.com/api/integrations/facebook/ads?workspaceId=workspace&businessId=venue&resource=budget&accountId=act_999", { headers: { Authorization: "Bearer session" } });
    const budgetResponse = await route.GET(budgetRequest());
    assert.equal(budgetResponse.headers.get("cache-control"), "private, no-store");
    const budgetResult = await budgetResponse.json();
    assert.equal(budgetResult.budget.accountId, "123", "account is resolved server-side, not from the request");
    assert.equal(budgetResult.budget.remaining, 380); assert.equal(budgetResult.budget.outstanding, 10);
    assert.equal(budgetResult.budget.paymentMethod, "Visa •••• 1234");
    assert.ok(!JSON.stringify(budgetResult).includes("private-funding-id"));
    paymentDenied = true;
    const partial = await (await route.GET(budgetRequest())).json();
    assert.equal(partial.budget.remaining, 380); assert.ok(partial.paymentWarning);
    assert.equal(calls.length, updatedCount, "reading finance never calls a Meta mutation");
    assert.equal(writes.length, 1, "reading finance never writes to Supabase");
    assert.ok(lookups.every(call => call.filters.workspace_id === "workspace" && call.filters.business_id === "venue"));
    allowedBusiness = "other-venue"; assert.equal((await route.GET(searchRequest())).status, 403); assert.equal((await route.POST(request())).status, 403);
    assert.equal((await route.GET(budgetRequest())).status, 403);
    assert.equal((await route.GET(new Request(budgetRequest().url))).status, 401);
    assert.equal((await route.GET(new Request(searchRequest().url))).status, 401);
  } finally { global.fetch = originalFetch; }
});

test("account budget distinguishes cap headroom, debt, prepaid and missing data", async () => {
  await swc.loadBindings();
  const { normalizeMetaAccountBudget: normalize } = load("lib/meta-account-budget.js");
  const account = { currency: "EUR", spend_cap: "10000", amount_spent: "2500", balance: "700", is_prepay_account: false };
  const result = normalize(account, {}, "act_123");
  assert.equal(result.remaining, 75); assert.equal(result.outstanding, 7);
  assert.equal(normalize({ ...account, balance: "0" }, {}, "123").outstanding, 0);
  assert.equal(normalize({ ...account, balance: undefined }, {}, "123").outstanding, null);
  assert.equal(normalize({ ...account, spend_cap: "0" }).hasLimit, false);
  assert.equal(normalize({ ...account, spend_cap: "0" }).remaining, null);
  assert.equal(normalize({ ...account, amount_spent: "20000" }).remaining, 0);
  assert.equal(normalize({ ...account, spend_cap: null }).remaining, null);
  assert.equal(normalize({ ...account, amount_spent: "" }).remaining, null);
  assert.equal(normalize({ ...account, currency: "JPY" }).remaining, null);
  assert.equal(normalize({ ...account, is_prepay_account: true }).outstanding, null);
  assert.equal(normalize({ ...account, is_prepay_account: undefined }).outstanding, null);
  const privateData = normalize(account, { funding_source_details: { id: "secret-id", display_string: "Card 4111 1111 1111 1111" }, tax_id: "secret-tax-id" }, "123");
  assert.equal(privateData.paymentMethod, "Card ••••");
  assert.ok(!JSON.stringify(privateData).includes("secret"));
});

test("budget panel refreshes read-only data, warns on over-budget and clears stale amounts on failure", async () => {
  await swc.loadBindings();
  const React = require("react"), Renderer = require("react-test-renderer");
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const originalFetch = global.fetch;
  const Budget = load("components/meta-account-budget.js").default;
  const normalize = load("lib/meta-account-budget.js").normalizeMetaAccountBudget;
  let fail = false, calls = [], renderer;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: !fail, json: async () => fail ? { error: "Meta tijdelijk niet bereikbaar" } : { budget: normalize({ name: "Gedeeld account", currency: "EUR", account_status: 1, spend_cap: "10000", amount_spent: "2500", balance: "0", is_prepay_account: false }, { funding_source_details: { display_string: "Visa •••• 1234" } }, "123") } };
  };
  try {
    const props = { workspaceId: "workspace", businessId: "venue", session: { access_token: "test" }, plannedBudget: 90 };
    await React.act(async () => { renderer = Renderer.create(React.createElement(Budget, props)); });
    assert.ok(JSON.stringify(renderer.toJSON()).includes("hoger dan"));
    assert.ok(JSON.stringify(renderer.toJSON()).includes("Visa •••• 1234"));
    assert.ok(renderer.root.findAllByType("a")[0].props.href.endsWith("act=123"));
    await React.act(async () => renderer.update(React.createElement(Budget, { ...props, plannedBudget: 50 })));
    assert.ok(!JSON.stringify(renderer.toJSON()).includes("hoger dan"));
    assert.equal(calls.length, 1, "editing campaign budget does not refetch or change account limits");
    fail = true;
    await React.act(async () => renderer.root.findByType("button").props.onClick());
    const output = JSON.stringify(renderer.toJSON());
    assert.ok(output.includes("Meta tijdelijk niet bereikbaar")); assert.ok(!output.includes("Visa")); assert.ok(!output.includes("75"));
    assert.ok(calls.every(call => !call.options.method && call.options.cache === "no-store"));
  } finally { if (renderer) await React.act(async () => renderer.unmount()); global.fetch = originalFetch; }
});

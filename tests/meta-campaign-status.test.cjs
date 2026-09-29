const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const swc = require("next/dist/build/swc");
const root = path.resolve(__dirname, "..");
function load(file, mocks = {}) {
  const { code } = swc.transformSync(fs.readFileSync(path.join(root, file), "utf8"), { filename: file, jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022", transform: { react: { runtime: "automatic" } } }, module: { type: "commonjs" } });
  const module = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})")((name) => mocks[name] || (name.startsWith(".") ? load(path.join(path.dirname(file), name) + ".js", mocks) : require(name)), module, module.exports);
  return module.exports;
}
const receipt = { campaign_id: "101", adset_id: "102", ad_id: "103", ad_account_id: "act_99", status: "paused", name: "Live muziek" };
const item = { id: "event", business_id: "venue", media: [{ kind: "campaign_distribution", common: { title: "Event" }, facebook_paid_campaign: receipt }] };
const active = { status: "ACTIVE", effective_status: "ACTIVE" };

test("status uses all delivery levels and never treats absent or novel states as active", async () => {
  await swc.loadBindings();
  const { metaCampaignStatus: status } = load("lib/meta-campaign-status.js");
  const now = new Date("2026-09-29T12:00:00Z");
  assert.equal(status(active, active, active, now).state, "active");
  assert.equal(status({ ...active, status: "PAUSED" }, active, active, now).state, "paused");
  assert.equal(status(active, active, { ...active, effective_status: "ADSET_PAUSED" }, now).state, "paused");
  assert.equal(status(active, { ...active, start_time: "2026-10-01T12:00:00Z" }, active, now).state, "scheduled");
  assert.equal(status(active, { ...active, end_time: "2026-09-29T11:00:00Z" }, active, now).state, "ended");
  for (const [raw, expected] of Object.entries({ DISAPPROVED: "rejected", WITH_ISSUES: "issues", PENDING_BILLING_INFO: "issues", PENDING_REVIEW: "review", IN_PROCESS: "processing", ARCHIVED: "archived", DELETED: "deleted", NEW_STATUS: "unknown" })) {
    assert.equal(status(active, active, { ...active, effective_status: raw }, now).state, expected);
  }
  assert.equal(status(active, active, {}, now).state, "unknown");
  assert.equal(status(active, active, active, now).checked_at, now.toISOString());
});

test("status endpoint is authorized, validates stored identities, only reads Meta and protects concurrent edits", async () => {
  await swc.loadBindings();
  const originalFetch = global.fetch;
  let allowed = true, mismatch = false, remoteFailure = false, conflict = false, stored = structuredClone(item);
  const calls = [], writes = [], filtersSeen = [];
  const user = { auth: { getUser: async () => ({ data: { user: { id: "user" } } }) }, from() {
    const q = { select() { return q; }, eq() { return q; }, then(resolve) { return Promise.resolve({ data: [{ business_id: allowed ? "venue" : "other", role: { role_key: "owner" } }] }).then(resolve); } }; return q;
  } };
  const admin = { from(table) {
    const filters = {}; let payload;
    const q = { select() { return q; }, eq(key, value) { filters[key] = value; return q; }, update(value) { payload = value; return q; }, async maybeSingle() {
      filtersSeen.push({ table, filters });
      if (payload) { writes.push({ filters, payload }); return { data: conflict ? null : { id: "event" } }; }
      return { data: table === "social_content_items" ? stored : table === "integration_credentials" ? {} : filters.provider === "facebook_ads" ? { id: "credential", external_account_id: "act_99", connection_status: "connected", granted_scopes: ["ads_management"] } : null };
    } }; return q;
  } };
  const route = load("app/api/integrations/facebook/ads/route.js", {
    "../../../../../lib/server-supabase": { createAdminSupabase: () => admin, createUserSupabase: () => user },
    "../../../../../lib/meta-oauth": { decryptMetaToken: () => "private-token" },
  });
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const id = new URL(url).pathname.split("/").pop();
    return { ok: !remoteFailure, json: async () => remoteFailure ? { error: { message: "Object not accessible" } } : {
      ...active, id, account_id: mismatch ? "88" : "99", campaign_id: "101", adset_id: "102", start_time: "2026-09-01T10:00:00Z", end_time: "2099-10-01T10:00:00Z",
    } };
  };
  const request = (extra = {}, token = true) => new Request("https://example.com/api/integrations/facebook/ads", {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer session" } : {}) },
    body: JSON.stringify({ workspaceId: "workspace", businessId: "venue", campaignId: "event", action: "refresh_status", ...extra }),
  });
  try {
    assert.equal((await route.POST(request({}, false))).status, 401);
    allowed = false; assert.equal((await route.POST(request())).status, 403); allowed = true;
    assert.equal(calls.length, 0);
    const response = await route.POST(request({ ad_id: "attacker", ad_account_id: "act_88" }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.paidCampaign.live_status.state, "active");
    assert.equal(result.paidCampaign.status, "paused", "creation receipt preserved independently");
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => !call.options.method && call.options.cache === "no-store" && !call.url.includes("private-token")));
    assert.equal(writes[0].filters.workspace_id, "workspace"); assert.equal(writes[0].filters.business_id, "venue");
    assert.equal(writes[0].filters.media, JSON.stringify(stored.media));
    assert.deepEqual(writes[0].payload.media[0].common, item.media[0].common);
    assert.ok(filtersSeen.filter(row => row.table === "integration_credentials").every(row => row.filters.business_id === "venue"));
    writes.length = 0;
    mismatch = true; assert.equal((await route.POST(request())).status, 409); mismatch = false;
    remoteFailure = true; assert.equal((await route.POST(request())).status, 502); remoteFailure = false;
    assert.equal(writes.length, 0, "failed checks never replace a saved status");
    conflict = true; assert.equal((await route.POST(request())).status, 409); conflict = false;
    stored.media[0].facebook_paid_campaign.ad_account_id = "act_88";
    const before = calls.length; assert.equal((await route.POST(request())).status, 409); assert.equal(calls.length, before);
    stored = structuredClone(item); stored.media[0].facebook_paid_campaign.status = "ended";
    assert.equal((await route.POST(request({ action: undefined }))).status, 200);
    assert.equal(calls.length, before, "an ended registered campaign is not created again");
  } finally { global.fetch = originalFetch; }
});

test("registered status checks on open and manual refresh, keeps last check on failure and does not loop on parent saves", async () => {
  await swc.loadBindings();
  const React = require("react"), Renderer = require("react-test-renderer");
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const Component = load("components/meta-campaign-status.js").default;
  const originalFetch = global.fetch;
  let requests = 0, failed = false, saved, renderer;
  global.fetch = async (_, options) => {
    requests++;
    assert.equal(JSON.parse(options.body).action, "refresh_status");
    return { ok: !failed, json: async () => failed ? { error: "Meta tijdelijk onbereikbaar" } : { paidCampaign: { ...receipt, live_status: { state: "active", checked_at: "2026-09-29T12:00:00Z" } } } };
  };
  const props = { workspaceId: "workspace", session: { access_token: "session" }, item, paidCampaign: receipt, enabled: false, onSaved: value => { saved = value; } };
  try {
    await React.act(async () => { renderer = Renderer.create(React.createElement(Component, props)); });
    assert.equal(requests, 0);
    await React.act(async () => renderer.update(React.createElement(Component, { ...props, enabled: true })));
    assert.equal(requests, 1); assert.ok(JSON.stringify(renderer.toJSON()).includes("Actief in Meta"));
    await React.act(async () => renderer.update(React.createElement(Component, { ...props, enabled: true, item: saved, paidCampaign: saved.media[0].facebook_paid_campaign })));
    assert.equal(requests, 1, "onSaved rerender must not fetch again");
    failed = true;
    await React.act(async () => renderer.root.findByType("button").props.onClick());
    assert.equal(requests, 2);
    assert.ok(JSON.stringify(renderer.toJSON()).includes("laatst bekende status"));
    assert.ok(JSON.stringify(renderer.toJSON()).includes("Actief in Meta"));
    assert.equal(saved.media[0].facebook_paid_campaign.live_status.checked_at, "2026-09-29T12:00:00Z");
    await React.act(async () => renderer.update(React.createElement(Component, props)));
    failed = false;
    await React.act(async () => renderer.update(React.createElement(Component, { ...props, enabled: true })));
    assert.equal(requests, 3, "reopening checks again");
  } finally { if (renderer) await React.act(async () => renderer.unmount()); global.fetch = originalFetch; }
});

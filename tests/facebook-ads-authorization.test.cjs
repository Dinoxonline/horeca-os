const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const swc = require("next/dist/build/swc");

const root = path.resolve(__dirname, "..");

function compile(relative, mocks = {}) {
  const { code } = swc.transformSync(fs.readFileSync(path.join(root, relative), "utf8"), {
    filename: relative, jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022" }, module: { type: "commonjs" },
  });
  const module = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})", { filename: relative })((name) => mocks[name] || require(name), module, module.exports);
  return module.exports;
}

test("OAuth keeps page login working and enables advertising only after app setup and explicit selection", async () => {
  await swc.loadBindings();
  const envNames = ["META_APP_ID", "META_APP_SECRET", "META_OAUTH_STATE_SECRET", "META_TOKEN_ENCRYPTION_KEY", "META_ADS_ENABLED"];
  const original = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  for (const name of envNames) process.env[name] = "test-only";
  delete process.env.META_ADS_ENABLED;
  try {
    const oauth = compile("lib/meta-oauth.js");
    let role = "owner";
    const query = { select() { return this; }, eq() { return this; }, then(resolve) { return Promise.resolve({ data: [{ business_id: "venue", role: { role_key: role } }] }).then(resolve); } };
    let selectionCalls = 0;
    const route = compile("app/api/integrations/facebook/route.js", {
      "../../../../lib/meta-oauth": oauth,
      "../../../../lib/facebook-ad-account-selection": { selectFacebookAdAccount: async () => { selectionCalls++; return { candidates: [] }; } },
      "../../../../lib/server-supabase": { createAdminSupabase: () => ({}), createUserSupabase: () => ({ auth: { getUser: async () => ({ data: { user: { id: "user" } } }) }, from: () => query }) },
    });
    const request = (purpose, token = "test-token") => new Request("https://horeca-os-le-club.vercel.app/api/integrations/facebook", {
      method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ workspaceId: "workspace", businessId: "venue", ...(purpose ? { purpose } : {}) }),
    });
    const pageResponse = await route.POST(request());
    assert.equal(pageResponse.status, 200);
    const pageUrl = new URL((await pageResponse.json()).authorizationUrl);
    assert.ok(pageUrl.searchParams.get("scope").includes("pages_manage_posts"));
    assert.ok(!pageUrl.searchParams.get("scope").includes("ads_management"));
    assert.equal(oauth.readMetaState(pageUrl.searchParams.get("state")).purpose, "pages");

    const blocked = await route.POST(request("ads"));
    assert.equal(blocked.status, 409);
    const blockedBody = await blocked.json();
    assert.equal(blockedBody.code, "META_ADS_SETUP_REQUIRED");
    assert.equal(blockedBody.authorizationUrl, undefined);
    assert.match(blockedBody.error, /Marketing API/);

    process.env.META_ADS_ENABLED = "true";
    const adsResponse = await route.POST(request("ads"));
    assert.equal(adsResponse.status, 200);
    const adsUrl = new URL((await adsResponse.json()).authorizationUrl);
    assert.ok(adsUrl.searchParams.get("scope").split(",").includes("ads_management"));
    assert.equal(oauth.readMetaState(adsUrl.searchParams.get("state")).purpose, "ads");
    const normalAfterEnable = new URL((await (await route.POST(request())).json()).authorizationUrl);
    assert.ok(!normalAfterEnable.searchParams.get("scope").includes("ads_management"));
    assert.equal((await route.POST(request("ads", ""))).status, 401);
    role = "staff";
    assert.equal((await route.POST(request("ads"))).status, 403);
    const selectionRequest = token => new Request("https://horeca-os-le-club.vercel.app/api/integrations/facebook", {
      method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ workspaceId: "workspace", businessId: "venue", action: "select_ad_account", adAccountId: "act_1" }),
    });
    assert.equal((await route.POST(selectionRequest("test"))).status, 403);
    assert.equal((await route.POST(selectionRequest(""))).status, 401);
    assert.equal(selectionCalls, 0);

    role = "owner";
    assert.equal((await route.POST(selectionRequest("test"))).status, 200);
    assert.equal(selectionCalls, 1);
    delete process.env.META_ADS_ENABLED;
    process.env.META_APP_ID = "2231952860937833";
    const confirmedAppResponse = await route.POST(request("ads"));
    assert.equal(confirmedAppResponse.status, 200);
    const confirmedUrl = new URL((await confirmedAppResponse.json()).authorizationUrl);
    assert.equal(confirmedUrl.searchParams.get("client_id"), "2231952860937833");
    assert.ok(confirmedUrl.searchParams.get("scope").split(",").includes("ads_management"));
    process.env.META_ADS_ENABLED = "false";
    assert.equal((await route.POST(request("ads"))).status, 409, "explicitly disabling the confirmed app still wins");
    delete process.env.META_ADS_ENABLED;
    process.env.META_APP_ID = "another-app";
    assert.equal((await route.POST(request("ads"))).status, 409, "other apps still need their own setup");
  } finally {
    for (const name of envNames) { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; }
  }
});

test("a saved marketing campaign can create a paused Meta draft without requiring a Facebook event", () => {
  const app = fs.readFileSync(path.join(root, "components/horeca-os-app.js"), "utf8");
  const ads = fs.readFileSync(path.join(root, "app/api/integrations/facebook/ads/route.js"), "utf8");

  assert.match(app, /Meta-campagne als concept maken/);
  assert.match(app, /launchStatus:\s*"paused"/);
  assert.match(app, /location_query/);
  assert.match(ads, /select\("id,body,media"\)/);
  assert.match(ads, /defaultMetaCampaign\(campaign, distribution\)/);
  assert.doesNotMatch(ads, /facebook_event_delivery\?\.status !== "confirmed"/);
});

test("event details show a clickable Meta campaign card beside the social channels", () => {
  const overview = fs.readFileSync(path.join(root, "components/marketing-overview.js"), "utf8");

  assert.match(overview, /meta:\s*"Meta-campagne"/);
  assert.match(overview, /\["meta", "calendar"\]/);
  assert.match(overview, /Facebook \+ Instagram/);
  assert.match(overview, /event-channel-meta-\$\{item\.id\}/);
  assert.match(overview, /MetaCampaignComposer/);
  assert.match(overview, /launchStatus:\s*"paused"/);
});

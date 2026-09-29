const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const swc = require("next/dist/build/swc");
const root = path.resolve(__dirname, "..");

function compile(relative, mocks) {
  const { code } = swc.transformSync(fs.readFileSync(path.join(root, relative), "utf8"), {
    filename: relative, jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022", transform: { react: { runtime: "automatic" } } }, module: { type: "commonjs" },
  });
  const module = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})")((name) => mocks[name] || require(name), module, module.exports);
  return module.exports;
}

test("account choice lists all pages, rejects inactive/foreign accounts, and saves only the explicit choice", async () => {
  await swc.loadBindings();
  const originalFetch = global.fetch;
  const writes = [];
  let pages;
  let requests;
  let saveError = null;
  const admin = { from(table) {
    const filters = [];
    const q = { select() { return q; }, eq(key, value) { filters.push([key, value]); return q; },
      maybeSingle: async () => ({ data: table === "integration_accounts" ? { id: "saved", granted_scopes: ["ads_management"] } : { token_ciphertext: "encrypted" } }),
      update(payload) { writes.push({ payload, filters }); return q; },
      then(resolve) { return Promise.resolve({ error: saveError }).then(resolve); },
    };
    return q;
  } };
  const helper = compile("lib/facebook-ad-account-selection.js", { "./meta-oauth": { decryptMetaToken: () => "secret-user-token" } });
  const body = { workspaceId: "workspace", businessId: "venue", action: "list_ad_accounts" };
  function setPages(values) { pages = [...values]; requests = []; }
  global.fetch = async (url, options) => {
    requests.push(String(url));
    assert.equal(options.headers.Authorization, "Bearer secret-user-token");
    assert.ok(!String(url).includes("secret-user-token"));
    return { ok: true, json: async () => pages.shift() };
  };
  const data = [{ id: "act_1", name: "One", account_status: 1 }, { id: "act_2", name: "Two", account_status: 1 }, { id: "act_3", name: "Disabled", account_status: 2 }];
  try {
    setPages([{ data: [data[0]], paging: { next: "https://untrusted.invalid/", cursors: { after: "cursor-2" } } }, { data: data.slice(1) }]);
    const result = await helper.selectFacebookAdAccount(admin, body);
    assert.equal(result.candidates.length, 3);
    assert.equal(result.candidates[2].active, false);
    assert.ok(requests[1].startsWith("https://graph.facebook.com/"));
    assert.ok(requests[1].includes("after=cursor-2"));
    assert.ok(!JSON.stringify(result).includes("secret-user-token"));
    assert.equal(writes.length, 0);
    for (const id of ["act_3", "act_999"]) {
      setPages([{ data }]);
      await assert.rejects(helper.selectFacebookAdAccount(admin, { ...body, action: "select_ad_account", adAccountId: id }), /actief advertentieaccount/);
    }
    assert.equal(writes.length, 0);
    setPages([{ data }]);
    assert.equal((await helper.selectFacebookAdAccount(admin, { ...body, action: "select_ad_account", adAccountId: "act_2" })).ok, true);
    assert.equal(writes[0].payload.external_account_id, "act_2");
    assert.equal(writes[0].payload.connection_status, "connected");
    assert.deepEqual(writes[0].filters, [["id", "saved"], ["workspace_id", "workspace"], ["business_id", "venue"]]);
    setPages([{ data: [] }]);
    assert.deepEqual((await helper.selectFacebookAdAccount(admin, body)).candidates, []);
    saveError = { code: "23505" };
    setPages([{ data }]);
    await assert.rejects(helper.selectFacebookAdAccount(admin, { ...body, action: "select_ad_account", adAccountId: "act_2" }), /Vernieuw de pagina/);
    global.fetch = async () => ({ ok: false, json: async () => ({ error: { message: "provider error" } }) });
    await assert.rejects(helper.selectFacebookAdAccount(admin, body), /Meta kon/);
  } finally { global.fetch = originalFetch; }
});

test("advertising callback retains an encrypted pending credential and returns to account selection, not false success", async () => {
  await swc.loadBindings();
  const originalFetch = global.fetch;
  const writes = [];
  let purpose = "ads";
  let credentialFailure = false;
  const scopes = ["pages_manage_engagement", "pages_manage_posts", "ads_management"];
  const admin = { from(table) {
    let provider; let operation; let payload;
    const query = {
      select() { return query; }, eq(key, value) { if (key === "provider") provider = value; return query; },
      order() { return Promise.resolve({ data: [{ id: "page-record", external_account_id: "page-1" }] }); },
      maybeSingle() { return Promise.resolve({ data: provider === "meta" ? { external_account_id: "ig-1" } : null }); },
      update(value) { payload = value; operation = "update"; return query; },
      insert(value) { payload = value; operation = "insert"; return query; },
      upsert(value) { payload = value; operation = "upsert"; return query; },
      single() { writes.push({ table, payload }); return Promise.resolve({ data: { id: "ad-record" } }); },
      then(resolve) { if (operation) writes.push({ table, payload }); return Promise.resolve({ error: credentialFailure && table === "integration_credentials" && payload.account_id === "ad-record" ? {} : null }).then(resolve); },
    };
    return query;
  } };
  const route = compile("app/api/integrations/facebook/callback/route.js", {
    "../../../../../lib/server-supabase": { createAdminSupabase: () => admin },
    "../../../../../lib/meta-oauth": {
      getFacebookConfiguration: () => ({ ready: true }), getFacebookRedirectUri: () => "https://example.test/callback",
      getSafeReturnOrigin: () => "https://horeca-os-le-club.vercel.app",
      readMetaState: () => ({ connection: "facebook", purpose, workspaceId: "workspace", businessId: "venue" }),
      encryptMetaToken: token => ({ ciphertext: `encrypted:${token}`, iv: "iv", tag: "tag" }),
    },
  });
  global.fetch = async input => {
    const url = new URL(input);
    let data;
    if (url.pathname.endsWith("/oauth/access_token")) data = { access_token: "user-token", expires_in: 3600 };
    else if (url.pathname.endsWith("/me/permissions")) data = { data: scopes.map(permission => ({ permission, status: "granted" })) };
    else if (url.pathname.endsWith("/me/accounts")) data = { data: [{ id: "page-1", name: "Venue", access_token: "page-token", instagram_business_account: { id: "ig-1" } }] };
    else throw new Error("Unexpected external request");
    return { ok: true, json: async () => data };
  };
  const request = () => new Request("https://example.test/callback?code=test&state=test");
  try {
    const response = await route.GET(request());
    const location = new URL(response.headers.get("location"));
    assert.equal(location.searchParams.get("facebook"), "choose_ad_account");
    assert.equal(location.hash, "#meta-advertentieaccounts");
    const adRecord = writes.find(write => write.payload?.provider === "facebook_ads");
    assert.equal(adRecord.payload.connection_status, "pending");
    assert.equal(adRecord.payload.external_account_id, "pending:venue");
    assert.equal(writes.find(write => write.table === "integration_credentials" && write.payload.account_id === "ad-record").payload.token_ciphertext, "encrypted:user-token");
    assert.ok(!location.href.includes("user-token"));
    credentialFailure = true;
    assert.equal(new URL((await route.GET(request())).headers.get("location")).searchParams.get("facebook"), "error");
    credentialFailure = false; purpose = "pages"; writes.length = 0;
    assert.equal(new URL((await route.GET(request())).headers.get("location")).searchParams.get("facebook"), "connected");
    assert.ok(!writes.some(write => write.payload?.provider === "facebook_ads"));
  } finally { global.fetch = originalFetch; }
});

test("UI modules compile and pending accounts cannot create campaigns", async () => {
  await swc.loadBindings();
  for (const file of ["components/facebook-ad-account-picker.js", "components/marketing-overview.js", "components/horeca-os-app.js"]) {
    swc.transformSync(fs.readFileSync(path.join(root, file), "utf8"), { filename: file, jsc: { parser: { syntax: "ecmascript", jsx: true } } });
  }
  assert.match(fs.readFileSync(path.join(root, "app/api/integrations/facebook/ads/route.js"), "utf8"), /adAccount.connection_status !== "connected"/);
});

test("two venues select the same advertising account with separate credentials and record updates", async () => {
  await swc.loadBindings();
  const originalFetch = global.fetch;
  const writes = [];
  const tokens = [];
  const admin = { from(table) {
    const filters = {};
    const q = { select() { return q; }, eq(key, value) { filters[key] = value; return q; },
      maybeSingle: async () => ({ data: table === "integration_accounts"
        ? { id: `row-${filters.business_id}`, granted_scopes: ["ads_management"] }
        : { token_ciphertext: `token-${filters.business_id}` } }),
      update(payload) { writes.push({ payload, filters }); return q; },
      then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
    }; return q;
  } };
  const helper = compile("lib/facebook-ad-account-selection.js", { "./meta-oauth": { decryptMetaToken: record => record.token_ciphertext } });
  global.fetch = async (_, options) => {
    tokens.push(options.headers.Authorization);
    return { ok: true, json: async () => ({ data: [{ id: "act_123", name: "Shared account", account_status: 1 }] }) };
  };
  try {
    for (const businessId of ["caribbean", "plein"]) {
      await helper.selectFacebookAdAccount(admin, { workspaceId: "workspace", businessId, action: "select_ad_account", adAccountId: "act_123" });
    }
    assert.deepEqual(tokens, ["Bearer token-caribbean", "Bearer token-plein"]);
    assert.deepEqual(writes.map(write => write.payload.external_account_id), ["act_123", "act_123"]);
    assert.deepEqual(writes.map(write => write.filters), [
      { id: "row-caribbean", workspace_id: "workspace", business_id: "caribbean" },
      { id: "row-plein", workspace_id: "workspace", business_id: "plein" },
    ]);
  } finally { global.fetch = originalFetch; }
});

test("picker requires explicit choice and shows no-account explanation without another OAuth redirect", async () => {
  await swc.loadBindings();
  const React = require("react");
  const Renderer = require("react-test-renderer");
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const Picker = compile("components/facebook-ad-account-picker.js", {}).default;
  const originalFetch = global.fetch;
  let renderer;
  let saved = 0;
  const actions = [];
  let candidates = [{ id: "act_1", name: "One", active: true }, { id: "act_2", name: "Two", active: true }];
  global.fetch = async (_, options) => {
    const body = JSON.parse(options.body); actions.push(body);
    return { ok: true, json: async () => body.action === "list_ad_accounts" ? { candidates } : { ok: true } };
  };
  const props = { workspaceId: "workspace", businessId: "venue", businessName: "Venue", session: { access_token: "session" }, account: { id: "pending", connection_status: "pending" }, onSaved: () => { saved++; } };
  try {
    await React.act(async () => { renderer = Renderer.create(React.createElement(Picker, props)); });
    const saveButton = () => renderer.root.findAllByType("button").find(button => button.props.children === "Dit advertentieaccount gebruiken");
    assert.equal(saveButton().props.disabled, true);
    assert.equal(renderer.root.findByType("select").props.value, "");
    await React.act(async () => renderer.root.findByType("select").props.onChange({ target: { value: "act_2" } }));
    await React.act(async () => saveButton().props.onClick());
    assert.equal(saved, 1);
    assert.equal(actions.at(-1).adAccountId, "act_2");
    candidates = [];
    await React.act(async () => renderer.root.findAllByType("button").find(button => button.props.children === "Accounts opnieuw ophalen").props.onClick());
    assert.equal(saveButton().props.disabled, true);
    assert.match(renderer.root.findByProps({ role: "status" }).props.children, /geen actief advertentieaccount/);
    assert.ok(actions.every(body => !body.purpose));
  } finally { if (renderer) await React.act(async () => renderer.unmount()); global.fetch = originalFetch; }
});

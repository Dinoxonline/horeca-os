const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const swc = require("next/dist/build/swc");
const root = path.resolve(__dirname, "..");

function load(file, mocks) {
  const { code } = swc.transformSync(fs.readFileSync(path.join(root, file), "utf8"), { filename: file, jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022" }, module: { type: "commonjs" } });
  const module = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})")((name) => mocks[name] || require(name), module, module.exports);
  return module.exports;
}

test("a confirmed giveaway posts its generated image only to the linked Facebook page", async () => {
  await swc.loadBindings();
  const originalFetch = global.fetch;
  const distribution = { kind: "campaign_distribution", common: { title: "Live avond" } };
  const campaign = { id: "event-1", business_id: "venue", media: [distribution], workflow_status: "new" };
  let updated;
  const admin = { from(table) {
    const q = {
      select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; },
      maybeSingle: async () => table === "integration_accounts"
        ? { data: { id: "page-account", external_account_id: "page-1", display_name: "Caribbean Corner", granted_scopes: ["pages_manage_posts"] } }
        : table === "social_content_items" ? { data: campaign } : { data: { token_ciphertext: "encrypted" } },
      update(payload) { updated = payload; return q; },
      single: async () => ({ data: { id: campaign.id, media: updated.media }, error: null }),
    };
    return q;
  } };
  const user = { auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) }, from() {
    const q = { select() { return q; }, eq() { return q; }, then(resolve) { return Promise.resolve({ data: [{ business_id: "venue", role: { role_key: "owner", role_permissions: [] } }] }).then(resolve); } };
    return q;
  } };
  const route = load("app/api/integrations/facebook/publish/route.js", {
    "../../../../../lib/server-supabase": { createAdminSupabase: () => admin, createUserSupabase: () => user },
    "../../../../../lib/meta-oauth": { decryptMetaToken: () => "page-token" },
  });
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (options.method === "POST") return { ok: true, json: async () => ({ id: "page-1_post-9" }) };
    return { ok: true, json: async () => ({ data: [] }) };
  };
  try {
    const response = await route.POST(new Request("https://example.test/api", { method: "POST", headers: { authorization: "Bearer user-token", "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "workspace", businessId: "venue", campaignId: "event-1", action: "publish_giveaway", giveaway: { text: "WINACTIE", image_url: "https://project.supabase.co/storage/v1/object/public/marketing-assets/workspace/venue/facebook-giveaway-event-1-uuid.jpg" } }) }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.post.pageName, "Caribbean Corner");
    assert.equal(updated.media[0].provider_delivery.facebook_giveaway.status, "confirmed");
    assert.equal(updated.media[0].provider_delivery.facebook_giveaway.external_id, "page-1_post-9");
    assert.ok(calls.some(call => call.options.method === "POST" && call.url.endsWith("/page-1/photos")));
    assert.ok(!JSON.stringify(result).includes("page-token"));
  } finally { global.fetch = originalFetch; }
});

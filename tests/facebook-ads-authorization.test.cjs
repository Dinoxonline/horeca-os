const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("the existing Meta connection explicitly requests and retains the paid-campaign permission", () => {
  const authorize = fs.readFileSync(path.join(root, "app/api/integrations/facebook/route.js"), "utf8");
  const callback = fs.readFileSync(path.join(root, "app/api/integrations/facebook/callback/route.js"), "utf8");

  assert.match(authorize, /"ads_management"/);
  assert.match(authorize, /auth_type:\s*"rerequest"/);
  assert.match(callback, /"ads_management"/);
  assert.match(callback, /grantedScopes\.includes\("ads_management"\)/);
});

test("a saved marketing campaign can create a paused Meta draft without requiring a Facebook event", () => {
  const app = fs.readFileSync(path.join(root, "components/horeca-os-app.js"), "utf8");
  const ads = fs.readFileSync(path.join(root, "app/api/integrations/facebook/ads/route.js"), "utf8");

  assert.match(app, /Meta-campagne als concept maken/);
  assert.match(app, /launchStatus:\s*"paused"/);
  assert.match(app, /location_query/);
  assert.match(ads, /select\("id,body,media"\)/);
  assert.match(ads, /campaign\.body/);
  assert.doesNotMatch(ads, /facebook_event_delivery\?\.status !== "confirmed"/);
});

test("event details show a clickable Meta campaign card beside the social channels", () => {
  const overview = fs.readFileSync(path.join(root, "components/marketing-overview.js"), "utf8");

  assert.match(overview, /meta:\s*"Meta-campagne"/);
  assert.match(overview, /\["meta", "calendar"\]/);
  assert.match(overview, /Facebook \+ Instagram/);
  assert.match(overview, /event-channel-meta-\$\{item\.id\}/);
  assert.match(overview, /Meta-campagne als concept maken/);
  assert.match(overview, /launchStatus:\s*"paused"/);
});

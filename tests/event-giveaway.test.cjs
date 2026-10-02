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
    return name.startsWith(".") ? load(path.join(path.dirname(file), name) + ".js", mocks) : require(name);
  }, module, module.exports);
  return module.exports;
}

test("a giveaway is filled from the event and keeps its practical variables in the text", async () => {
  await swc.loadBindings();
  const { defaultGiveawayDraft, buildGiveawayText, giveawayDraftStorageKey } = load("components/event-giveaway.js", { "next/image": { __esModule: true, default: () => null } });
  const { giveawayImageFilename, giveawayOverlayLines } = load("lib/giveaway-image.js");
  const draft = defaultGiveawayDraft({
    item: { id: "event-42" },
    distribution: { common: { title: "40 jaar Rhythm Construction", start: "2026-11-07T18:00:00", location: "Caribbean Corner", website_url: "https://example.com/tickets" }, facebook_event_delivery: { page_id: "110904729511668" } },
    businessName: "Caribbean Corner",
  });
  const text = buildGiveawayText({ ...draft, cards: 3, responseHours: 24 });
  assert.equal(giveawayDraftStorageKey("event-42"), "horeca-os-event-giveaway:event-42");
  assert.equal(draft.deadline, "2026-11-01");
  assert.equal(draft.announcement, "2026-11-04");
  assert.equal(draft.facebookPageUrl, "https://www.facebook.com/110904729511668");
  assert.match(text, /WIN 3 KAARTEN/);
  assert.match(text, /40 jaar Rhythm Construction/);
  assert.match(text, /Caribbean Corner/);
  assert.match(text, /https:\/\/example\.com\/tickets/);
  assert.match(text, /binnen 24 uur/);
  assert.doesNotMatch(text, /Deel dit bericht/);
  assert.deepEqual(giveawayOverlayLines({ cards: 1 }), ["WINACTIE", "WIN 1 KAART"]);
  assert.deepEqual(giveawayOverlayLines({ cards: 3 }), ["WINACTIE", "WIN 3 KAARTEN"]);
  assert.equal(giveawayImageFilename("40 jaar Rhythm Construction!"), "horeca-os-winactie-40-jaar-rhythm-construction.jpg");
  const overview = fs.readFileSync(path.join(root, "components/marketing-overview.js"), "utf8");
  assert.match(overview, /facebook_giveaway: "Facebook winactie"/);
  assert.match(overview, /\["website", "facebook", \.\.\.\(!external \? \["facebook_giveaway"\]/);
  assert.match(overview, /summary>Facebook winactie/);
  assert.doesNotMatch(overview, /onClick=\{\(\) => openChannel\("giveaway"\)\}>Winactie maken/);
  const giveawaySource = fs.readFileSync(path.join(root, "components/event-giveaway.js"), "utf8");
  assert.match(giveawaySource, /Facebook openen om te plaatsen/);
  assert.match(giveawaySource, /Winactiebeeld downloaden/);
  assert.match(giveawaySource, /Direct op Facebook plaatsen/);
});

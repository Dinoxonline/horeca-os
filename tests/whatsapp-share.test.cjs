const { test } = require("node:test");
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const swc = require("next/dist/build/swc"), root = path.resolve(__dirname, "..");
function load(file) {
  const { code } = swc.transformSync(fs.readFileSync(path.join(root, file), "utf8"), { filename: file, jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022", transform: { react: { runtime: "automatic" } } }, module: { type: "commonjs" } });
  const module = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})")((name) => {
    if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    if (name === "next/image") return { __esModule: true, default: props => require("react").createElement("img", { src: props.src, alt: props.alt }) };
    return name.startsWith(".") ? load(path.join(path.dirname(file), name) + ".js") : require(name);
  }, module, module.exports); return module.exports;
}
const distribution = { kind: "campaign_distribution", common: { title: "Muziek & eten", description: "<p>Kom langs!</p><script>evil()</script>", start: "2026-10-01T16:00:00Z", image_url: "https://example.com/photo.jpg", website_url: "https://example.com/event?a=1&b=2" } };

test("WhatsApp draft uses public content, explicit event date and correctly encodes the editable message", async () => {
  await swc.loadBindings();
  const helper = load("lib/whatsapp-share.js");
  const draft = helper.whatsappDraft({ scheduled_for: "2040-01-01" }, distribution);
  assert.ok(draft.text.includes("18:00")); assert.ok(draft.text.includes("Kom langs!")); assert.ok(!draft.text.includes("evil"));
  assert.equal(new URL(helper.whatsappShareUrl(draft.text + " 🎵")).searchParams.get("text"), draft.text + " 🎵");
  assert.equal(new URL(helper.whatsappShareUrl(draft.text)).pathname, "/", "does not target a person or fixed group");
  assert.equal(new URL(helper.whatsappDesktopUrl(draft.text)).protocol, "whatsapp:");
  assert.equal(helper.whatsappShareUrl("  "), "");
  assert.equal(helper.whatsappDesktopUrl("  "), "");
  const complete = helper.whatsappDraft({}, { common: { title: "Avond", short_description: "Kort", description: "Volledige Horeca OS-tekst met alle details." } });
  assert.ok(complete.text.includes("Volledige Horeca OS-tekst met alle details.")); assert.ok(!complete.text.includes("Kort"));
  const facebookPost = helper.whatsappDraft({ body: "Kort" }, { channel_payloads: { facebook: { text: "Afwijkende Facebook-versie" } }, common: { description: "Originele Horeca OS-evenementtekst met alle details." } });
  assert.ok(facebookPost.text.includes("Originele Horeca OS-evenementtekst met alle details.")); assert.ok(!facebookPost.text.includes("Afwijkende Facebook-versie"));
  const product = helper.whatsappDraft({ body: "Nieuwe kaart", scheduled_for: "2040-01-01" }, { common: { website_url: "javascript:alert(1)" } });
  assert.equal(product.text, "Nieuwe kaart"); assert.equal(product.images.length, 0);
});

test("image preparation is client-side, omits credentials and rejects HTML and oversized files", async () => {
  await swc.loadBindings();
  const { prepareWhatsappImage, MAX_SHARE_IMAGE_BYTES } = load("lib/whatsapp-share.js");
  const original = global.fetch;
  let type = "image/png", length = "3";
  global.fetch = async (_, options) => {
    assert.equal(options.credentials, "omit"); assert.equal(options.mode, "cors"); assert.equal(options.headers, undefined);
    return { ok: true, headers: new Headers({ "content-type": type, "content-length": length }), blob: async () => new Blob(["abc"], { type }) };
  };
  try {
    const file = await prepareWhatsappImage("https://example.com/photo.png"); assert.equal(file.name, "horeca-bericht.png"); assert.equal(file.size, 3);
    type = "text/html"; await assert.rejects(prepareWhatsappImage("https://example.com/photo.png"), /JPG/);
    type = "image/png"; length = String(MAX_SHARE_IMAGE_BYTES + 1); await assert.rejects(prepareWhatsappImage("https://example.com/photo.png"), /10 MB/);
    await assert.rejects(prepareWhatsappImage("javascript:alert(1)"), /geldige/);
  } finally { global.fetch = original; }
});

test("share UI copies the chosen image and never marks a publication sent", async () => {
  await swc.loadBindings();
  const React = require("react"), Renderer = require("react-test-renderer"); global.IS_REACT_ACT_ENVIRONMENT = true;
  const Component = load("components/whatsapp-share.js").default;
  const nav = Object.getOwnPropertyDescriptor(global, "navigator"), originalFetch = global.fetch;
  const clipboardItem = Object.getOwnPropertyDescriptor(global, "ClipboardItem"); let renderer, copiedImage, requests = 0;
  global.ClipboardItem = class { constructor(value) { copiedImage = value; } };
  Object.defineProperty(global, "navigator", { configurable: true, value: { clipboard: { write: async () => {} } } });
  global.fetch = async (_, options) => { requests++; assert.equal(options.credentials, "omit"); return { ok: true, headers: new Headers({ "content-type": "image/jpeg" }), blob: async () => new Blob(["photo"], { type: "image/jpeg" }) }; };
  const button = name => renderer.root.findAllByType("button").find(node => node.props.children === name);
  try {
    await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { item: { id: "event" }, distribution })); });
    assert.equal(requests, 0);
    await React.act(async () => renderer.root.findByType("details").props.onToggle({ currentTarget: { open: true } }));
    await React.act(async () => renderer.root.findByType("textarea").props.onChange({ target: { value: "Mijn eigen groepsbericht 🎵" } }));
    const link = renderer.root.findAllByType("a").find(node => node.props.href.startsWith("whatsapp://"));
    assert.equal(new URL(link.props.href).searchParams.get("text"), "Mijn eigen groepsbericht 🎵");
    await React.act(async () => link.props.onClick());
    assert.ok(JSON.stringify(renderer.toJSON()).includes("WhatsApp Desktop wordt geopend"));
    await React.act(async () => button("Afbeelding kopiëren").props.onClick()); assert.equal(requests, 1); assert.ok(copiedImage["image/jpeg"]); assert.ok(JSON.stringify(renderer.toJSON()).includes("Afbeelding gekopieerd"));
  } finally { if (renderer) await React.act(async () => renderer.unmount()); if (nav) Object.defineProperty(global, "navigator", nav); else delete global.navigator; if (clipboardItem) Object.defineProperty(global, "ClipboardItem", clipboardItem); else delete global.ClipboardItem; global.fetch = originalFetch; }
});

test("fallback UI handles denied clipboard and unavailable photo copying", async () => {
  await swc.loadBindings();
  const React = require("react"), Renderer = require("react-test-renderer"); global.IS_REACT_ACT_ENVIRONMENT = true;
  const Component = load("components/whatsapp-share.js").default;
  const nav = Object.getOwnPropertyDescriptor(global, "navigator"), originalFetch = global.fetch;
  let renderer;
  Object.defineProperty(global, "navigator", { configurable: true, value: { clipboard: { writeText: async () => { throw Error("denied"); } } } });
  global.fetch = async () => { throw Error("Foto geblokkeerd"); };
  try {
    await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { item: { id: "event" }, distribution })); });
    await React.act(async () => renderer.root.findByType("details").props.onToggle({ currentTarget: { open: true } }));
    await React.act(async () => renderer.root.findAllByType("button").find(node => node.props.children === "Afbeelding kopiëren").props.onClick());
    assert.ok(JSON.stringify(renderer.toJSON()).includes("Kies een andere foto"));
  } finally { if (renderer) await React.act(async () => renderer.unmount()); if (nav) Object.defineProperty(global, "navigator", nav); else delete global.navigator; global.fetch = originalFetch; }
});

test("manual confirmation is explicit and turns the WhatsApp status green only after the saved response", async () => {
  await swc.loadBindings();
  const React = require("react"), Renderer = require("react-test-renderer"); global.IS_REACT_ACT_ENVIRONMENT = true;
  const Component = load("components/whatsapp-share.js").default;
  const originalFetch = global.fetch; let renderer, sent;
  global.fetch = async (url, options) => { sent = { url, body: JSON.parse(options.body) }; return { ok: true, json: async () => ({ saved: { revision: "saved", state: "placed" } }) }; };
  try {
    await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { item: { id: "event", business_id: "venue" }, distribution, workspaceId: "workspace", session: { access_token: "token" } })); });
    await React.act(async () => renderer.root.findByType("details").props.onToggle({ currentTarget: { open: true } }));
    await React.act(async () => renderer.root.findAllByType("button").find(node => node.props.children === "Geplaatst op WhatsApp").props.onClick());
    assert.equal(sent.url, "/api/marketing/manual-whatsapp"); assert.equal(sent.body.action, "mark_published"); assert.equal(sent.body.confirmed, true);
    assert.ok(JSON.stringify(renderer.toJSON()).includes("Geplaatst op WhatsApp"));
  } finally { if (renderer) await React.act(async () => renderer.unmount()); global.fetch = originalFetch; }
});

test("both event details and saved event/product campaigns mount the same sharing component", async () => {
  await swc.loadBindings();
  for (const file of ["components/marketing-overview.js", "components/central-event-creator.js"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /import WhatsappShare from "\.\/whatsapp-share"/);
    assert.match(source, /<WhatsappShare key=.*?item={item} distribution={distribution}/);
    swc.transformSync(source, { filename: file, jsc: { parser: { syntax: "ecmascript", jsx: true } } });
  }
});

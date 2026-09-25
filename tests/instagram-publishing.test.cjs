const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const Renderer = require('react-test-renderer');
const swc = require('next/dist/build/swc');
global.IS_REACT_ACT_ENVIRONMENT = true;
const root = path.resolve(__dirname, '..');
async function load(file, mocks = {}) {
  await swc.loadBindings();
  function compile(relative) {
    const { code } = swc.transformSync(fs.readFileSync(path.join(root, relative), 'utf8'), {
      filename: relative, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
    });
    const module = { exports: {} };
    vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: relative })(
      name => Object.hasOwn(mocks, name) ? { __esModule: true, ...mocks[name] } : name.startsWith('.') ? compile(path.join(path.dirname(relative), name) + '.js') : require(name), module, module.exports);
    return module.exports;
  }
  return compile(file);
}
const photo = { type: 'image', url: 'https://images.example.com/photo.jpg' };
const video = { type: 'video', url: 'https://images.example.com/video.mp4' };

test('Instagram formats validate media count, captions, URLs and native container fields', async () => {
  const { validateInstagramDraft: validate, instagramContainerValues: values } = await load('lib/instagram-publishing.js');
  for (const format of ['feed', 'story', 'carousel', 'reel']) {
    const draft = validate({ format, caption: 'Hello', shareToFeed: true, assets: format === 'carousel' ? [photo, video] : [format === 'reel' ? video : photo] });
    assert.equal(draft.format, format);
    assert.equal(values(draft, draft.assets[0]).media_type, format === 'reel' ? 'REELS' : format === 'story' ? 'STORIES' : undefined);
    if (format === 'story') { assert.equal(draft.caption, ''); assert.equal(values(draft, photo).caption, undefined); }
  }
  assert.equal(values({ format: 'carousel' }, video, true).media_type, 'VIDEO');
  assert.equal(values({ format: 'carousel' }, photo, true).is_carousel_item, 'true');
  for (const format of ['toString', '__proto__', 'invalid']) assert.throws(() => validate({ format, assets: [photo] }));
  assert.throws(() => validate({ format: 'feed', assets: [video] }));
  assert.throws(() => validate({ format: 'reel', assets: [photo] }));
  assert.throws(() => validate({ format: 'carousel', assets: [photo] }));
  assert.throws(() => validate({ format: 'feed', caption: 'x'.repeat(2201), assets: [photo] }));
  for (const url of ['http://example.com/a.jpg', 'https://user:pass@example.com/a.jpg', 'https://127.0.0.1/a.jpg']) assert.throws(() => validate({ format: 'feed', assets: [{ ...photo, url }] }));
});

async function routeHarness({ denied = false, publishFailure = false, businessType = 'BUSINESS', largeMedia = false, storageError = false, conflictOnce = false, noVersion = false } = {}) {
  let revision = 1;
  const campaign = { id: 'c', business_id: 'b', updated_at: noVersion ? null : '2026-09-25T07:00:00.000001+00:00', media: [{ kind: 'image', url: 'keep' }, { kind: 'campaign_distribution', common: { title: 'Keep title', ...(largeMedia ? { description: 'Flyer 🎉 '.repeat(3000) } : {}) }, provider_delivery: { facebook: { status: 'confirmed' } } }] };
  const account = { id: 'a', external_account_id: 'ig', display_name: 'venue', connection_status: 'connected', granted_scopes: ['instagram_business_content_publish'] };
  const calls = [], updates = [];
  function query(table) {
    const filters = {}; let patch;
    const result = () => {
      if (table === 'social_content_items') {
        if (filters.workspace_id !== 'w' || filters.business_id !== 'b' || filters.id !== 'c') return { data: null };
        if (patch) {
          updates.push({ ...filters });
          if (new URLSearchParams(filters).toString().length > 8192) return { data: null, error: { code: '', message: 'URI too long' }, status: 414 };
          if (storageError) return { data: null, error: { code: '42501', message: 'hidden database details' }, status: 403 };
          if (conflictOnce) { conflictOnce = false; campaign.media[1].provider_delivery.facebook.checked_at = 'newer background check'; campaign.updated_at = `2026-09-25T07:00:00.${String(++revision).padStart(6, '0')}+00:00`; return { data: null }; }
          if (Object.hasOwn(filters, 'media') ? filters.media !== JSON.stringify(campaign.media) : filters.updated_at !== campaign.updated_at) return { data: null };
          campaign.media = patch.media;
          campaign.updated_at = `2026-09-25T07:00:00.${String(++revision).padStart(6, '0')}+00:00`;
          return { data: { id: 'c' } };
        }
        return { data: structuredClone(campaign) };
      }
      if (table === 'integration_accounts') return { data: filters.workspace_id === 'w' && filters.business_id === 'b' ? account : null };
      if (table === 'integration_credentials') {
        assert.equal(filters.workspace_id, 'w'); assert.equal(filters.business_id, 'b'); assert.equal(filters.account_id, 'a');
        return { data: { token_ciphertext: 'secret' } };
      }
      if (table === 'user_role_assignments') return { data: [{ business_id: denied ? 'other' : 'b', role: { role_key: 'owner' } }] };
    };
    let builder;
    builder = new Proxy({}, { get: (_, key) => {
      if (key === 'then') return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
      if (key === 'maybeSingle') return async () => result();
      if (key === 'eq') return (field, value) => { filters[field] = value; return builder; };
      if (key === 'update') return value => { patch = value; return builder; };
      return () => builder;
    } });
    return builder;
  }
  global.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method, values: options.body ? Object.fromEntries(options.body) : {} });
    let data = {};
    if (url.includes('account_type')) data = { account_type: businessType };
    else if (url.endsWith('/media_publish')) { if (publishFailure) throw new Error('network'); data = { id: 'published' }; }
    else if (url.endsWith('/media')) data = { id: 'container' + calls.length };
    else if (url.includes('status_code')) data = { status_code: 'FINISHED' };
    else if (url.includes('permalink')) data = { permalink: 'https://www.instagram.com/p/example/' };
    return { ok: true, json: async () => data };
  };
  const server = { from: query, auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) } };
  const route = await load('app/api/integrations/meta/publish/route.js', {
    '../../../../../lib/server-supabase': { createUserSupabase: () => server, createAdminSupabase: () => server },
    '../../../../../lib/meta-oauth': { decryptMetaToken: () => 'private-token' },
  });
  async function post(action, extra = {}) {
    const response = await route.POST(new Request('https://app.example/api', { method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: 'w', businessId: 'b', campaignId: 'c', format: 'feed', action, ...extra }) }));
    return { status: response.status, ...await response.json() };
  }
  return { post, calls, campaign, route, updates };
}

test('large campaign media never enters the status-update URL and background edits survive retries', async () => {
  const h = await routeHarness({ largeMedia: true, conflictOnce: true });
  const prepared = await h.post('prepare', { accountId: 'a', draft: { assets: [photo], caption: 'Keep my caption' } });
  assert.equal(prepared.status, 200, prepared.error);
  assert.equal(prepared.job.status, 'processing');
  assert.equal(h.campaign.media[1].provider_delivery.facebook.checked_at, 'newer background check');
  for (const update of h.updates) {
    assert.equal(Object.hasOwn(update, 'media'), false);
    assert.match(update.updated_at, /\.\d{6}\+00:00$/);
    assert.ok(new URLSearchParams(update).toString().length < 250);
  }
  const discarded = await h.post('discard', { operationId: prepared.job.operation_id });
  assert.equal(discarded.status, 200);
  assert.deepEqual(discarded.job.draft, prepared.job.draft);
  assert.equal(h.calls.filter(call => call.url.endsWith('/media_publish')).length, 0);
});

test('missing row version or a denied status save never starts an Instagram write', async () => {
  for (const options of [{ noVersion: true }, { storageError: true }]) {
    const h = await routeHarness(options);
    const result = await h.post('prepare', { accountId: 'a', draft: { assets: [photo] } });
    assert.notEqual(result.status, 200);
    assert.equal(h.calls.filter(call => call.method === 'POST').length, 0);
    assert.ok(!result.error.includes('hidden database details'));
  }
});

test('prepare, readiness and explicit publication are separate; concurrent clicks publish once', async () => {
  const h = await routeHarness();
  const prepared = await h.post('prepare', { accountId: 'a', draft: { assets: [photo], caption: 'Text' } });
  assert.equal(prepared.job.status, 'processing');
  assert.equal(h.calls.filter(c => c.url.endsWith('/media_publish')).length, 0);
  const operationId = prepared.job.operation_id;
  assert.equal((await h.post('publish', { operationId })).status, 409);
  assert.equal((await h.post('status', { operationId })).job.status, 'ready');
  const results = await Promise.all([h.post('publish', { operationId, confirm: true }), h.post('publish', { operationId, confirm: true })]);
  assert.ok(results.some(result => result.job?.status === 'published'));
  assert.equal(h.calls.filter(c => c.url.endsWith('/media_publish')).length, 1);
  assert.equal((await h.post('publish', { operationId, confirm: true })).job.status, 'published');
  assert.equal(h.calls.filter(c => c.url.endsWith('/media_publish')).length, 1);
  assert.equal(h.campaign.media[0].url, 'keep');
  assert.equal(h.campaign.media[1].provider_delivery.facebook.status, 'confirmed');
  assert.equal(h.campaign.media[1].common.title, 'Keep title');
});

test('uncertain publish is persisted and cannot be reset or republished by retry', async () => {
  const h = await routeHarness({ publishFailure: true });
  const prepared = await h.post('prepare', { accountId: 'a', draft: { assets: [photo] } });
  const operationId = prepared.job.operation_id;
  await h.post('status', { operationId });
  assert.equal((await h.post('publish', { operationId, confirm: true })).job.status, 'unknown');
  assert.equal((await h.post('status', { operationId })).job.status, 'unknown');
  await h.post('publish', { operationId, confirm: true });
  assert.equal((await h.post('prepare', { accountId: 'a', draft: { assets: [photo] } })).status, 409);
  assert.equal(h.calls.filter(c => c.url.endsWith('/media_publish')).length, 1);
});

test('other venue, stale destination, missing confirmation and creator Story are rejected', async () => {
  const denied = await routeHarness({ denied: true });
  assert.equal((await denied.post('prepare')).status, 403);
  assert.equal(denied.calls.length, 0);
  const h = await routeHarness({ businessType: 'MEDIA_CREATOR' });
  assert.equal((await h.post('prepare', { accountId: 'wrong', draft: { assets: [photo] } })).status, 409);
  assert.equal((await h.post('prepare', { accountId: 'a', format: 'story', draft: { assets: [photo] } })).status, 409);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 0);
  assert.equal((await h.post('prepare', { businessId: 'other' })).status, 403);
});

test('Instagram composer exposes all four formats without automatic network or publication', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('Unexpected'); };
  const Component = (await load('components/instagram-event-publisher.js', { '../lib/supabase': { supabase: {} } })).default;
  let renderer;
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { item: { id: 'c', media: [] }, businessName: 'Venue' })); });
  try {
    const selector = renderer.root.findAllByType('select')[0];
    assert.deepEqual(selector.findAllByType('option').map(option => option.props.value), ['feed', 'carousel', 'story', 'reel']);
    assert.equal(calls, 0);
    const prepare = renderer.root.findAllByType('button').find(button => String(button.props.children).startsWith('Voorbeeld klaarzetten'));
    assert.equal(prepare.props.disabled, true, 'account must be checked before prepare');
    await React.act(async () => selector.props.onChange({ target: { value: 'reel' } }));
    assert.equal(calls, 0, 'format changes do not publish');
    assert.equal(renderer.root.findAllByProps({ type: 'file' }).length, 0, 'unsupported local video upload is not offered');
  } finally { await React.act(async () => renderer.unmount()); }
});

test('a stranded preparation can be restored with its exact photo and caption, without preparing or publishing', async () => {
  const calls = [];
  const saved = { status: 'preparing', operation_id: 'old-operation', account_id: 'a', account_name: 'venue', draft: { format: 'feed', caption: 'My edited caption', assets: [photo], shareToFeed: false } };
  let job = structuredClone(saved), renderer;
  global.fetch = async (_url, options) => {
    const body = options.body && JSON.parse(options.body); calls.push(body?.action || 'read');
    if (body) {
      assert.equal(body.action, 'discard'); assert.equal(body.operationId, 'old-operation');
      job = { ...job, status: 'draft', operation_id: 'new-operation', container_id: null };
      return { ok: true, json: async () => ({ job }) };
    }
    return { ok: true, json: async () => ({ account: { id: 'a', name: 'venue' }, publications: { feed: job } }) };
  };
  const Component = (await load('components/instagram-event-publisher.js')).default;
  const item = { id: 'c', business_id: 'b', media: [{ kind: 'campaign_distribution', instagram_publications: { feed: saved } }] };
  const button = label => renderer.root.findAllByType('button').find(b => b.props.children === label);
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { item, workspaceId: 'w' })); });
  try {
    const label = 'Voorbereiding herstellen — niet publiceren';
    assert.equal(button(label).props.disabled, true, 'check the destination first');
    await React.act(async () => button('Instagram-account controleren').props.onClick());
    assert.equal(button(label).props.disabled, false);
    await React.act(async () => button(label).props.onClick());
    assert.equal(renderer.root.findByType('textarea').props.value, saved.draft.caption);
    assert.equal(renderer.root.findByProps({ className: 'instagramAsset' }).findByType('img').props.src, photo.url);
    assert.deepEqual(calls, ['read', 'discard']);
    assert.equal(button('Voorbeeld klaarzetten — nog niet publiceren').props.disabled, false);
    await React.act(async () => renderer.unmount());
    await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { item: { ...item, media: [] }, workspaceId: 'w' })); });
    await React.act(async () => button('Instagram-account controleren').props.onClick());
    assert.equal(renderer.root.findByType('textarea').props.value, saved.draft.caption, 'the persisted recovery draft can be reloaded');
    assert.equal(renderer.root.findByProps({ className: 'instagramAsset' }).findByType('img').props.src, photo.url);
    assert.deepEqual(calls, ['read', 'discard', 'read']);
  } finally { await React.act(async () => renderer.unmount()); }
});

test('readiness polling is bounded, checks only the same preparation and stops on errors, deadlines and aborts', async () => {
  const { waitForInstagramPreparation: follow } = await load('lib/instagram-preparation.js');
  const initial = { status: 'processing', container_id: 'container', operation_id: 'op' };
  let checks = 0, clock = 0;
  const waits = [], progress = [];
  const result = await follow(initial, async (operation, timeout) => {
    assert.equal(operation, 'op'); assert.ok(timeout <= 12000); checks++;
    return initial;
  }, { now: () => clock, wait: async delay => { waits.push(delay); clock += delay; }, onProgress: attempt => progress.push(attempt) });
  assert.equal(result.status, 'processing'); assert.equal(checks, 6);
  assert.deepEqual(waits, [1500, 3000, 5000, 8000, 10000]);
  assert.deepEqual(progress, [1, 2, 3, 4, 5, 6]);
  checks = 0; clock = 0;
  await follow(initial, async () => { checks++; clock += 44000; return initial; }, { now: () => clock, wait: async () => assert.fail('deadline reached') });
  assert.equal(checks, 1);
  await assert.rejects(() => follow(initial, async () => ({ ...initial, status: 'ready', operation_id: 'different' })), /voorbereiding is gewijzigd/);
  await assert.rejects(() => follow(initial, async () => undefined), /voorbereiding is gewijzigd/);
  await assert.rejects(() => follow(initial, async () => { throw new Error('network failed'); }), /network failed/);
  for (const status of ['ready', 'failed', 'unknown', 'publishing', 'published']) {
    checks = 0;
    assert.equal((await follow(initial, async () => { checks++; return { ...initial, status }; })).status, status);
    assert.equal(checks, 1, `stop at ${status}`);
  }
  const controller = new AbortController();
  checks = 0;
  const pending = follow(initial, async () => { checks++; return initial; }, { signal: controller.signal, onProgress: attempt => { if (attempt === 2) queueMicrotask(() => controller.abort()); } });
  await assert.rejects(() => pending, { name: 'AbortError' });
  assert.equal(checks, 1, 'aborting cancels the wait before the next network request');
});

test('prepare automatically advances to confirmation, deduplicates clicks and never publishes without explicit confirmation', async () => {
  let renderer, releaseStatus;
  const calls = [];
  const job = { status: 'processing', operation_id: 'op', container_id: 'container', account_name: 'venue', draft: { format: 'feed', caption: 'Text', assets: [photo] } };
  global.fetch = async (_url, options) => {
    const body = options.body && JSON.parse(options.body); calls.push(body?.action || 'read');
    if (!body) return { ok: true, json: async () => ({ account: { id: 'a', name: 'venue' }, publications: {} }) };
    if (body.action === 'status') return new Promise(resolve => { releaseStatus = () => resolve({ ok: true, json: async () => ({ job: { ...job, status: 'ready' } }) }); });
    return { ok: true, json: async () => ({ job: body.action === 'publish' ? { ...job, status: 'published' } : job }) };
  };
  const Component = (await load('components/instagram-event-publisher.js')).default;
  const item = { id: 'c', business_id: 'b', body: 'Text', media: [{ kind: 'image', url: photo.url }] };
  const button = label => renderer.root.findAllByType('button').find(b => b.props.children === label);
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { item, workspaceId: 'w' })); });
  try {
    await React.act(async () => button('Instagram-account controleren').props.onClick());
    await React.act(async () => button('Deze foto gebruiken').props.onClick());
    let pending;
    await React.act(async () => {
      const prepare = button('Voorbeeld klaarzetten — nog niet publiceren');
      pending = prepare.props.onClick();
      await prepare.props.onClick();
    });
    assert.deepEqual(calls, ['read', 'prepare', 'status']);
    assert.equal(button('Nu publiceren op Instagram').props.disabled, true, 'next step visible but unavailable during processing');
    assert.equal(renderer.root.findByProps({ type: 'checkbox' }).props.disabled, true);
    await React.act(async () => { releaseStatus(); await pending; });
    assert.equal(renderer.root.findByProps({ type: 'checkbox' }).props.disabled, false);
    assert.equal(button('Nu publiceren op Instagram').props.disabled, true, 'ready is not user consent');
    await React.act(async () => button('Nu publiceren op Instagram').props.onClick());
    assert.deepEqual(calls, ['read', 'prepare', 'status'], 'even an invalid direct handler call cannot publish');
    await React.act(async () => renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }));
    assert.equal(button('Nu publiceren op Instagram').props.disabled, false);
    await React.act(async () => button('Nu publiceren op Instagram').props.onClick());
    assert.deepEqual(calls, ['read', 'prepare', 'status', 'publish']);
  } finally { await React.act(async () => renderer.unmount()); }
});

test('loading an existing processing job checks readiness once; leaving aborts the request and ignores late publication responses', async () => {
  const job = { status: 'processing', operation_id: 'op', container_id: 'container', account_name: 'venue', draft: { format: 'feed', caption: 'Text', assets: [photo] } };
  const calls = []; let renderer, resolveStatus, signal, published = 0;
  global.fetch = async (_url, options) => {
    const body = options.body && JSON.parse(options.body); calls.push(body?.action || 'read');
    if (!body) return { ok: true, json: async () => ({ account: { id: 'a', name: 'venue' }, publications: { feed: job } }) };
    signal = options.signal;
    return new Promise(resolve => { resolveStatus = () => resolve({ ok: true, json: async () => ({ job: { ...job, status: 'published' } }) }); });
  };
  const Component = (await load('components/instagram-event-publisher.js')).default;
  const props = { item: { id: 'c', business_id: 'b', media: [] }, workspaceId: 'w', onPublished: () => published++ };
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, props)); });
  assert.deepEqual(calls, []);
  let pending;
  await React.act(async () => { pending = renderer.root.findAllByType('button').find(b => b.props.children === 'Instagram-account controleren').props.onClick(); });
  await React.act(async () => renderer.update(React.createElement(Component, props)));
  assert.deepEqual(calls, ['read', 'status'], 'renders do not start another check or preparation');
  await React.act(async () => renderer.unmount());
  assert.equal(signal.aborted, true);
  await React.act(async () => { resolveStatus(); await pending; });
  assert.equal(published, 0, 'ignore late responses after leaving the event');
  assert.deepEqual(calls, ['read', 'status']);
});

test('a status error is shown beside the final step and cannot enable publication', async () => {
  const job = { status: 'processing', operation_id: 'op', container_id: 'container', account_name: 'venue', draft: { format: 'feed', caption: 'Text', assets: [photo] } };
  const calls = []; let renderer;
  global.fetch = async (_url, options) => {
    const body = options.body && JSON.parse(options.body); calls.push(body?.action || 'read');
    return body ? { ok: false, json: async () => ({ error: 'Controle mislukt. Probeer later opnieuw.' }) } : { ok: true, json: async () => ({ account: { id: 'a', name: 'venue' }, publications: { feed: job } }) };
  };
  const Component = (await load('components/instagram-event-publisher.js')).default;
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { item: { id: 'c', business_id: 'b', media: [] }, workspaceId: 'w' })); });
  try {
    await React.act(async () => renderer.root.findAllByType('button').find(b => b.props.children === 'Instagram-account controleren').props.onClick());
    const panel = renderer.root.findByProps({ className: 'instagramPublishStatus' });
    assert.match(panel.findByProps({ role: 'alert' }).props.children, /Controle mislukt/);
    assert.equal(panel.findAllByType('button').find(b => b.props.children === 'Nu publiceren op Instagram').props.disabled, true);
    assert.equal(panel.findAllByProps({ role: 'status' }).length, 0, 'spinner stops after error');
    assert.deepEqual(calls, ['read', 'status']);
  } finally { await React.act(async () => renderer.unmount()); }
});

test('local Instagram preview supports every format, plain captions, carousel navigation and media failure without API calls', async () => {
  const Preview = (await load('components/instagram-post-preview.js')).default;
  let renderer, calls = 0;
  global.fetch = async () => { calls++; throw new Error('Preview must not call the API'); };
  const text = n => typeof n === 'string' ? n : (n.children || []).map(text).join(' ');
  const props = { businessName: 'Venue', accountName: 'venue', draft: { format: 'feed', caption: '<b>Literal caption</b>\nSecond line', assets: [photo] } };
  await React.act(async () => { renderer = Renderer.create(React.createElement(Preview, props)); });
  try {
    assert.equal(renderer.root.findByType('img').props.src, photo.url);
    assert.match(text(renderer.root.findByProps({ className: 'igMockCaption ' })), /<b>Literal caption<\/b>/);
    assert.equal(renderer.root.findAllByType('b').length, 0, 'caption is not interpreted as HTML');
    assert.match(text(renderer.root), /geen live Instagram-bericht/);
    const button = label => renderer.root.findAllByType('button').find(b => b.props['aria-label'] === label || b.props.children === label);
    await React.act(async () => button('Volledig bijschrift bekijken').props.onClick());
    assert.equal(button('Minder tekst').props['aria-expanded'], true);
    const carousel = { ...props, draft: { format: 'carousel', caption: 'Carousel text', assets: [photo, video] } };
    await React.act(async () => renderer.update(React.createElement(Preview, carousel)));
    assert.equal(button('Vorig beeld in voorbeeld').props.disabled, true);
    await React.act(async () => button('Volgend beeld in voorbeeld').props.onClick());
    assert.equal(renderer.root.findByType('video').props.src, video.url);
    assert.equal(renderer.root.findByType('video').props.controls, true);
    assert.equal(renderer.root.findByType('video').props.autoPlay, undefined);
    assert.equal(button('Volgend beeld in voorbeeld').props.disabled, true);
    await React.act(async () => renderer.update(React.createElement(Preview, { ...carousel, draft: { ...carousel.draft, caption: 'Updated live' } })));
    assert.equal(renderer.root.findByType('video').props.src, video.url, 'typing does not restart carousel navigation');
    assert.match(text(renderer.root), /Updated live/);
    await React.act(async () => renderer.update(React.createElement(Preview, { ...carousel, draft: { ...carousel.draft, assets: [photo] } })));
    assert.equal(renderer.root.findByType('img').props.src, photo.url, 'removing media resets to a valid frame');
    for (const format of ['story', 'reel']) {
      await React.act(async () => renderer.update(React.createElement(Preview, { ...props, draft: { format, caption: 'Only reel caption', assets: [video] } })));
      assert.equal(renderer.root.findByProps({ className: 'igMockMedia' }).props.style.aspectRatio, '9 / 16');
      assert.equal(text(renderer.root).includes('Only reel caption'), format === 'reel');
      assert.equal(renderer.root.findByType('video').props.controls, true);
    }
    await React.act(async () => renderer.root.findByType('video').props.onError());
    assert.match(text(renderer.root.findByProps({ role: 'status' })), /niet in het voorbeeld worden geladen/);
    await React.act(async () => renderer.update(React.createElement(Preview, { ...props, draft: { format: 'feed', assets: [] } })));
    assert.match(text(renderer.root), /Kies een\s+foto of video/);
    assert.equal(calls, 0);
  } finally { await React.act(async () => renderer.unmount()); }
});

test('publisher preview follows photo and caption edits immediately and always shows the saved draft after preparation', async () => {
  const Component = (await load('components/instagram-event-publisher.js')).default;
  let renderer, calls = 0;
  global.fetch = async () => { calls++; throw new Error('Unexpected network request'); };
  const props = { item: { id: 'c', business_id: 'b', body: 'Initial caption', media: [{ kind: 'image', url: photo.url }] }, businessName: 'Venue' };
  const text = n => typeof n === 'string' ? n : (n.children || []).map(text).join(' ');
  const preview = () => renderer.root.findByProps({ 'aria-label': 'Instagram-voorbeeld' });
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, props)); });
  try {
    assert.equal(preview().findAllByType('img').length, 0);
    await React.act(async () => renderer.root.findAllByType('button').find(b => b.props.children === 'Deze foto gebruiken').props.onClick());
    assert.equal(preview().findByType('img').props.src, photo.url);
    await React.act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'Typed just now' } }));
    assert.match(text(preview()), /Typed just now/);
    assert.equal(preview().findAllByType('details').length, 0, 'preview is visible without expanding details');
    await React.act(async () => renderer.unmount());
    const saved = { status: 'ready', operation_id: 'op', account_name: 'saved_account', draft: { format: 'feed', caption: 'Exact prepared caption', assets: [{ ...photo, url: 'https://images.example.com/prepared.jpg' }] } };
    const item = { ...props.item, media: [{ kind: 'campaign_distribution', instagram_publications: { feed: saved } }] };
    await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { ...props, item })); });
    assert.equal(preview().findByType('img').props.src, saved.draft.assets[0].url);
    assert.match(text(preview()), /Exact prepared caption/);
    assert.match(text(preview()), /@saved_account/);
    assert.equal(text(preview()).includes('Initial caption'), false);
    assert.equal(renderer.root.findByProps({ type: 'checkbox' }).props.checked, false);
    assert.equal(calls, 0, 'preview alone never fetches, prepares or publishes');
  } finally { await React.act(async () => renderer.unmount()); }
});

test('event media includes stored image profiles, videos and linked sources without duplicates or other venues', async () => {
  const { instagramEventMedia } = await load('lib/instagram-event-media.js');
  const item = { id: 'c', business_id: 'b', media: [{ kind: 'campaign_distribution',
    common: { images: { portrait: { url: photo.url, label: 'Poster' }, square: { url: 'https://images.example.com/square.jpg' } }, video_url: video.url },
    campaign_assets: [{ url: photo.url }, { url: 'https://images.example.com/clip', content_type: 'video/mp4' }, { url: 'https://images.example.com/picture.png', content_type: 'image/png' }],
  }, { kind: 'image', url: 'https://images.example.com/extra.jpg' }, { kind: 'image', url: 'javascript:alert(1)' }] };
  const linked = (businessId, url) => ({ label: 'Facebook', item: { business_id: businessId, media: [{ kind: 'campaign_distribution', common: { image_url: url } }] } });
  const media = instagramEventMedia(item, [linked('b', 'https://images.example.com/linked.jpg'), linked('other', 'https://images.example.com/private.jpg')]);
  assert.equal(media.filter(asset => asset.url === photo.url).length, 1);
  assert.equal(media.find(asset => asset.url === video.url).type, 'video');
  assert.equal(media.find(asset => asset.url.endsWith('/clip')).type, 'video');
  assert.equal(media.find(asset => asset.url.endsWith('.png')).issue, '');
  assert.equal(media.find(asset => asset.url.endsWith('.png')).needsJpeg, true);
  assert.ok(media.some(asset => asset.label.includes('Gekoppeld Facebook')));
  assert.ok(media.every(asset => !asset.url.includes('private') && asset.url.startsWith('https://')));
  assert.equal(media.length, 7);
});

test('stored event media can be selected when sources arrive, without upload, duplicate selection or publication', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('Unexpected'); };
  const Component = (await load('components/instagram-event-publisher.js')).default;
  const item = { id: 'c', business_id: 'b', media: [{ kind: 'campaign_distribution', common: { video_url: video.url } }] };
  const linkedSources = [{ label: 'Eventin', item: { business_id: 'b', media: [{ kind: 'campaign_distribution', common: { image_url: photo.url } }] } }];
  let renderer;
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { item, mediaLoading: true })); });
  try {
    assert.equal(renderer.root.findAllByProps({ type: 'file' }).length, 0, 'no computer file picker');
    await React.act(async () => renderer.update(React.createElement(Component, { item, linkedSources })));
    const choices = () => renderer.root.findAllByType('button').filter(button => button.props['aria-label']?.startsWith('Kies '));
    const photoChoice = () => choices().find(button => button.props['aria-label'].startsWith('Kies foto'));
    const videoChoice = () => choices().find(button => button.props['aria-label'].startsWith('Kies video'));
    assert.equal(videoChoice().props.disabled, true, 'feed requires a photo');
    await React.act(async () => photoChoice().props.onClick());
    assert.equal(photoChoice().props.children, 'Gekozen');
    await React.act(async () => photoChoice().props.onClick());
    assert.equal(renderer.root.findAllByProps({ className: 'instagramAsset' }).length, 1);
    assert.equal(renderer.root.findByProps({ className: 'instagramAsset' }).findByType('img').props.src, photo.url);
    await React.act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'reel' } }));
    assert.equal(photoChoice().props.disabled, true, 'reel requires a video');
    await React.act(async () => videoChoice().props.onClick());
    assert.equal(renderer.root.findByProps({ className: 'instagramAsset' }).findByType('video').props.src, video.url);
    assert.equal(calls, 0, 'selection does not upload, query or publish');
  } finally { await React.act(async () => renderer.unmount()); }
});

test('PNG selection makes a local JPEG preview, saves only on prepare, never publishes and deduplicates retries', async () => {
  const calls = []; let conversions = 0, uploads = 0, renderer;
  const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' });
  const Component = (await load('components/instagram-event-publisher.js', {
    '../lib/instagram-photo': {
      prepareInstagramPhoto: async () => { conversions++; return { blob: jpeg, width: 1080, height: 1350 }; },
      uploadInstagramPhoto: async (blob, scope) => { uploads++; assert.equal(blob, jpeg); assert.deepEqual(scope, { workspaceId: 'w', businessId: 'b', campaignId: 'c' }); return photo.url; },
    },
  })).default;
  global.fetch = async (url, options) => {
    const body = options.body && JSON.parse(options.body); calls.push(body?.action || 'status');
    if (body) { assert.equal(body.draft.assets[0].url, photo.url); return { ok: false, json: async () => ({ error: 'Test: preparation failed before publication' }) }; }
    return { ok: true, json: async () => ({ account: { id: 'a', name: 'venue' }, publications: {} }) };
  };
  const item = { id: 'c', business_id: 'b', media: [{ kind: 'image', url: 'https://images.example.com/poster.png' }] };
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { item, workspaceId: 'w' })); });
  const button = text => renderer.root.findAllByType('button').find(b => b.props.children === text);
  try {
    assert.equal(button('Deze foto gebruiken').props.disabled, false);
    await React.act(async () => button('Deze foto gebruiken').props.onClick());
    assert.equal(conversions, 1); assert.equal(uploads, 0); assert.deepEqual(calls, []);
    assert.ok(renderer.root.findByProps({ className: 'instagramAsset' }).findByType('img').props.src.startsWith('blob:'));
    assert.equal(button('Gekozen').props.disabled, true);
    await React.act(async () => button('Gekozen').props.onClick());
    assert.equal(conversions, 1);
    await React.act(async () => button('Instagram-account controleren').props.onClick());
    await React.act(async () => button('Voorbeeld klaarzetten — nog niet publiceren').props.onClick());
    await React.act(async () => button('Voorbeeld klaarzetten — nog niet publiceren').props.onClick());
    assert.equal(uploads, 1, 'reuse the saved JPEG after a failed preparation');
    assert.deepEqual(calls, ['status', 'prepare', 'prepare']);
    for (const format of ['feed', 'carousel', 'story', 'reel']) {
      await React.act(async () => renderer.root.findByType('select').props.onChange({ target: { value: format } }));
      const help = renderer.root.findByProps({ className: 'instagramFormatHelp' });
      const text = n => typeof n === 'string' ? n : (n.children || []).map(text).join(' ');
      assert.match(text(help), format === 'feed' || format === 'carousel' ? /1080 × 1350/ : /1080 × 1920/);
    }
    assert.equal(button('Deze foto gebruiken').props.disabled, true, 'a photo cannot become a reel');
  } finally { await React.act(async () => renderer.unmount()); }
});

test('failed PNG conversion displays an error and leaves no selected photo or upload', async () => {
  let renderer, uploads = 0;
  const Component = (await load('components/instagram-event-publisher.js', {
    '../lib/instagram-photo': { prepareInstagramPhoto: async () => { throw new Error('Foto niet leesbaar'); }, uploadInstagramPhoto: async () => { uploads++; } },
  })).default;
  await React.act(async () => { renderer = Renderer.create(React.createElement(Component, { item: { id: 'c', media: [{ kind: 'image', url: 'https://images.example.com/a.webp' }] } })); });
  try {
    const choice = () => renderer.root.findAllByType('button').find(b => b.props.children === 'Deze foto gebruiken');
    await React.act(async () => choice().props.onClick());
    assert.equal(renderer.root.findByProps({ role: 'alert' }).props.children, 'Foto niet leesbaar');
    assert.equal(renderer.root.findAllByProps({ className: 'instagramAsset' }).length, 0);
    assert.equal(choice().props.disabled, false); assert.equal(uploads, 0);
  } finally { await React.act(async () => renderer.unmount()); }
});

test('JPEG conversion preserves the complete image, paints transparency white and rejects unsupported/oversize sources', async () => {
  const originalWindow = global.window, originalDocument = global.document;
  const drawn = [], revoked = [];
  const originalRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = value => { revoked.push(value); originalRevoke.call(URL, value); };
  const { prepareInstagramPhoto: convert } = await load('lib/instagram-photo.js');
  const source = { type: 'image/png' };
  global.fetch = async (url, options) => {
    assert.equal(options.credentials, 'omit'); assert.equal(options.mode, 'cors');
    return { ok: true, headers: new Headers(), blob: async () => new Blob(['image'], { type: source.type }) };
  };
  global.window = { Image: class { naturalWidth = 2160; naturalHeight = 2700; set src(value) { if (value) queueMicrotask(() => this.onload?.()); } } };
  const context = { fillRect: (...args) => drawn.push(['background', context.fillStyle, ...args]), drawImage: (...args) => drawn.push(['draw', ...args.slice(1)]) };
  global.document = { createElement: () => ({ getContext: () => context, toBlob: (callback, type) => callback(new Blob(['jpeg'], { type })) }) };
  try {
    const result = await convert({ url: photo.url });
    assert.equal(result.blob.type, 'image/jpeg'); assert.equal(result.width, 1440); assert.equal(result.height, 1800);
    assert.deepEqual(drawn, [['background', '#ffffff', 0, 0, 1440, 1800], ['draw', 0, 0, 1440, 1800]]);
    assert.equal(revoked.length, 1);
    source.type = 'image/gif'; await assert.rejects(() => convert({ url: photo.url }), /ondersteunde foto/);
    global.fetch = async () => ({ ok: true, headers: new Headers({ 'content-length': String(11 * 1024 * 1024) }) });
    await assert.rejects(() => convert({ url: photo.url }), /10 MB/);
    global.fetch = async () => { throw new Error('CORS'); };
    await assert.rejects(() => convert({ url: photo.url }), /niet bereikbaar/);
  } finally { global.window = originalWindow; global.document = originalDocument; URL.revokeObjectURL = originalRevoke; }
});

test('JPEG storage uses event-scoped paths, insert-only uploads and never bypasses denied access', async () => {
  const calls = []; let denied = false;
  const { uploadInstagramPhoto: upload } = await load('lib/instagram-photo.js', {
    './supabase': { supabase: { storage: { from: bucket => {
      assert.equal(bucket, 'marketing-assets');
      return { upload: async (path, blob, options) => { calls.push({ path, blob, options }); return { error: denied ? { message: 'Permission denied' } : null }; }, getPublicUrl: path => ({ data: { publicUrl: `https://images.example.com/${path}` } }) };
    } } } },
  });
  const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
  const scope = { workspaceId: 'workspace', businessId: 'venue', campaignId: 'event' };
  assert.match(await upload(blob, scope), /^https:\/\/images.example.com\/workspace\/venue\/instagram-event-.*\.jpg$/);
  assert.equal(calls[0].options.upsert, false); assert.equal(calls[0].options.contentType, 'image/jpeg');
  await assert.rejects(() => upload(blob, { ...scope, businessId: '../other' }), /ontbreekt/);
  await assert.rejects(() => upload(new Blob(['png'], { type: 'image/png' }), scope), /niet geschikt/);
  assert.equal(calls.length, 1);
  denied = true; await assert.rejects(() => upload(blob, scope), /Permission denied/);
  assert.equal(calls.length, 2, 'no privileged fallback or automatic retry');
});

test('all publication formats create the correct containers, without publishing', async () => {
  for (const format of ['feed', 'carousel', 'story', 'reel']) {
    const h = await routeHarness();
    const assets = format === 'carousel' ? [photo, video] : [format === 'reel' ? video : photo];
    const result = await h.post('prepare', { format, accountId: 'a', draft: { assets, caption: 'Text', shareToFeed: true } });
    assert.equal(result.job.status, 'processing', format);
    const containers = h.calls.filter(call => call.url.endsWith('/media'));
    assert.equal(containers.length, format === 'carousel' ? 3 : 1);
    assert.equal(containers.at(-1).values.media_type, ({ carousel: 'CAROUSEL', story: 'STORIES', reel: 'REELS' })[format]);
    if (format === 'story') assert.equal(containers[0].values.caption, undefined);
    if (format === 'reel') assert.equal(containers[0].values.share_to_feed, 'true');
    assert.equal(h.calls.filter(call => call.url.endsWith('/media_publish')).length, 0);
  }
});

test('unpublished preparations can be edited; started publications cannot be reset', async () => {
  const h = await routeHarness();
  const prepared = await h.post('prepare', { accountId: 'a', draft: { assets: [photo] } });
  const discarded = await h.post('discard', { operationId: prepared.job.operation_id });
  assert.equal(discarded.job.status, 'draft');
  assert.equal(discarded.job.container_id, null);
  assert.equal((await h.post('publish', { operationId: prepared.job.operation_id, confirm: true })).status, 409);
  const again = await h.post('prepare', { accountId: 'a', draft: { assets: [photo], caption: 'Updated text' } });
  assert.equal(again.job.draft.caption, 'Updated text');
  await h.post('status', { operationId: again.job.operation_id });
  await h.post('publish', { operationId: again.job.operation_id, confirm: true });
  assert.equal((await h.post('discard', { operationId: again.job.operation_id })).status, 502);
  assert.equal(h.campaign.media[1].instagram_publications.feed.status, 'published');
});

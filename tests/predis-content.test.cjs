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
    const { code } = swc.transformSync(fs.readFileSync(path.join(root, relative), 'utf8'), { filename: relative, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } });
    const module = { exports: {} };
    vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: relative })(name => Object.hasOwn(mocks, name) ? { __esModule: true, ...mocks[name] } : name.endsWith('.css') ? { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) } : name.startsWith('.') ? compile(path.join(path.dirname(relative), name) + '.js') : require(name), module, module.exports);
    return module.exports;
  }
  return compile(file);
}
const photo = 'https://images.example.com/event.jpg';
const item = { id: 'c', business_id: 'b', body: 'Live muziek op donderdagavond.', updated_at: 'v1', media: [{ kind: 'image', url: photo }, { kind: 'campaign_distribution', common: { title: 'Jamsessie', start: '2026-10-01T18:00:00+02:00' }, manual_predis: { revision: 'keep' }, provider_delivery: { website: { status: 'published' } } }] };
const id = '11111111-1111-4111-8111-111111111111';
const draft = { prompt: 'Maak een mooi promotiebericht voor ons evenement.', mediaType: 'single_image', mediaUrls: [photo], confirmed: true, requestId: id };
const post = { post_id: 'p1', caption: 'Kom gezellig langs!', media_type: 'single_image', urls: ['https://cdn.example.com/result.jpg'] };
test('campaign edits preserve Predis jobs, legacy history and attachments with a scoped concurrency check', async () => {
  const { saveCampaignDraft } = await load('lib/save-campaign-draft.js');
  const previous = { media: [{ kind: 'image', url: photo }, { kind: 'campaign_distribution', common: { title: 'old' }, predis_content: { jobs: [{ id: 'job' }] }, manual_predis: { revision: 'old' }, provider_delivery: { predis: { post_ids: ['legacy'] } } }], updated_at: 'v2' };
  const record = { business_id: 'b', media: [{ kind: 'campaign_distribution', common: { title: 'new' }, provider_delivery: { brevo: { status: 'draft_saved' } } }] };
  let write, inserted, filters = [], collision = false, unavailable = false;
  const client = { from(table) {
    assert.equal(table, 'social_content_items');
    let updating = false;
    const q = { select() { return q; }, eq(k, v) { filters.push([k, v]); return q; },
      update(value) { updating = true; write = value; return q; },
      insert(value) { inserted = value; return { error: null }; },
      maybeSingle() { return { data: updating ? collision ? null : { id: 'c' } : unavailable ? null : previous, error: null }; } };
    return q;
  } };
  assert.equal((await saveCampaignDraft(client, 'w', 'c', record)).data.id, 'c');
  assert.deepEqual(write.media[1].predis_content, previous.media[1].predis_content);
  assert.deepEqual(write.media[1].manual_predis, previous.media[1].manual_predis);
  assert.deepEqual(write.media[0], previous.media[0]);
  assert.equal(write.media[1].common.title, 'new');
  assert.deepEqual(write.media[1].provider_delivery, { brevo: { status: 'draft_saved' }, predis: { post_ids: ['legacy'] } });
  for (const pair of [['id', 'c'], ['workspace_id', 'w'], ['business_id', 'b'], ['updated_at', 'v2']]) assert.ok(filters.some(f => f[0] === pair[0] && f[1] === pair[1]));
  assert.equal(record.media[0].predis_content, undefined, 'caller record is not mutated');
  collision = true;
  assert.match((await saveCampaignDraft(client, 'w', 'c', record)).error.message, /ondertussen gewijzigd/);
  unavailable = true; write = null;
  assert.match((await saveCampaignDraft(client, 'w', 'c', record)).error.message, /niet meer beschikbaar/);
  assert.equal(write, null, 'no write after scoped read returns no row');
  await saveCampaignDraft(client, 'w', null, record);
  assert.equal(inserted.workspace_id, 'w');
});

test('new event/campaign uses the shared library-first flow without generation during save', async () => {
  await load('components/central-event-creator.js', { '../lib/supabase': { supabase: {} }, 'next/image': { default: 'img' } });
  const source = fs.readFileSync(path.join(root, 'components/central-event-creator.js'), 'utf8');
  assert.match(source, /<SavedPredisWorkspace/);
  assert.equal((source.match(/await saveCampaignDraft\(/g) || []).length, 2);
  assert.doesNotMatch(source, /\b(predisGenerate|pendingPredisGeneration|predisGeneration)\b|fetch\("\/api\/integrations\/predis"/);
  assert.match(source, /Alleen opslaan kost geen Predis-tegoed/);
  assert.match(source, /if \(item.channel === "predis"\) return \[\]/, 'Predis must not require the video/image it is supposed to create');
});

test('real Supabase client sends a version-guarded update and requests confirmation', async () => {
  const { saveCampaignDraft } = await load('lib/save-campaign-draft.js');
  const { createClient } = require('@supabase/supabase-js');
  const calls = [];
  const client = createClient('https://example.supabase.co', 'test-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (url, init) => {
    calls.push({ url: new URL(url), method: init.method, headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : null });
    return Response.json(init.method === 'GET' ? [{ media: [{ kind: 'campaign_distribution', predis_content: { jobs: [{ id: 'keep' }] } }], updated_at: '2026-09-29T20:00:00+00:00' }] : [{ id: 'c' }]);
  } } });
  const result = await saveCampaignDraft(client, 'w', 'c', { business_id: 'b', media: [{ kind: 'campaign_distribution', common: { title: 'Updated' } }] });
  assert.equal(result.data.id, 'c');
  assert.deepEqual(calls.map(c => c.method), ['GET', 'PATCH']);
  const update = calls[1];
  for (const [key, value] of [['id', 'eq.c'], ['workspace_id', 'eq.w'], ['business_id', 'eq.b'], ['updated_at', 'eq.2026-09-29T20:00:00+00:00'], ['select', 'id']]) assert.equal(update.url.searchParams.get(key), value);
  assert.match(update.headers.get('prefer'), /return=representation/);
  assert.equal(update.body.media[0].predis_content.jobs[0].id, 'keep');
});

test('saved campaign panel keeps checking disabled while collapsed', async () => {
  const { SavedPredisWorkspace } = await load('components/predis-workspace.js', {
    './predis-content': { default: props => React.createElement('predis-generator', { enabled: props.enabled }) },
    './manual-predis': { default: () => null },
  });
  let r;
  try {
    await React.act(async () => { r = Renderer.create(React.createElement(SavedPredisWorkspace, { item, businessName: 'Caribbean Corner' })); });
    await React.act(async () => r.root.findAllByType('button').find(b => text(b) === 'Andere werkwijze kiezen').props.onClick());
    await React.act(async () => r.root.findAllByType('button').find(b => text(b) === 'Eerdere AI-resultaten bekijken').props.onClick());
    assert.equal(r.root.findByType('predis-generator').props.enabled, false);
    await React.act(async () => r.root.findByType('details').props.onToggle({ currentTarget: { open: true } }));
    assert.equal(r.root.findByType('predis-generator').props.enabled, true);
    await React.act(async () => r.root.findByType('details').props.onToggle({ currentTarget: { open: false } }));
    assert.equal(r.root.findByType('predis-generator').props.enabled, false);
  } finally { if (r) await React.act(async () => r.unmount()); }
});

test('AI history can retrieve old requests but exposes no generation or transfer controls', async () => {
  const Component = (await load('components/predis-content.js', { 'next/image': { default: 'img' } })).default;
  const oldWindow = global.window, oldFetch = global.fetch, calls = [];
  global.window = { addEventListener() {}, removeEventListener() {} };
  global.fetch = async (url, init) => { calls.push(init.method); return Response.json({ jobs: [{ id: 'old', status: 'unknown', mediaType: 'single_image', createdAt: '2026-09-29T10:00:00Z', results: [] }], photos: [], configured: true }); };
  let r;
  try {
    await React.act(async () => { r = Renderer.create(React.createElement(Component, { item, session: { access_token: 'one' }, workspaceId: 'w', enabled: true, historyOnly: true })); });
    assert.equal(r.root.findAllByType('textarea').length, 0);
    assert.equal(r.root.findAllByType('input').length, 0);
    assert.ok(r.root.findAllByType('button').some(b => text(b) === 'Resultaat ophalen'));
    assert.ok(r.root.findAllByType('button').every(b => !/Content laten maken|Kopie gebruiken/.test(text(b))));
    assert.deepEqual(calls, ['GET']);
  } finally { if(r) await React.act(async () => r.unmount()); global.window=oldWindow; global.fetch=oldFetch; }
});

test('automatic polling selects only recent accepted jobs and checks least-recently checked first', async () => {
  const { nextPredisPoll, PREDIS_POLL_WINDOW } = await load('lib/predis-polling.js');
  const now = Date.now(), fresh = { id: 'fresh', status: 'generating', postIds: ['p1'], createdAt: new Date(now - 1000).toISOString() };
  for (const patch of [{ status: 'unknown' }, { status: 'failed' }, { status: 'generation_failed' }, { status: 'ready' }, { postIds: [] }, { createdAt: 'invalid' }, { createdAt: new Date(now - PREDIS_POLL_WINDOW).toISOString() }]) assert.equal(nextPredisPoll([{ ...fresh, ...patch }], now), null);
  assert.equal(nextPredisPoll([{ ...fresh, id: 'checked', checkedAt: new Date(now).toISOString() }, fresh], now).id, 'fresh');
});

test('accepted generation automatically retrieves the result and reveals planning only after review', async t => {
  const Component = (await load('components/predis-content.js', { 'next/image': { default: p => React.createElement('img', p) } })).default;
  const oldWindow = global.window, oldFetch = global.fetch;
  global.window = { addEventListener() {}, removeEventListener() {}, confirm: () => true };
  const calls = [], job = { id, status: 'generating', postIds: ['p1'], createdAt: new Date().toISOString(), prompt: draft.prompt, mediaType: 'single_image', results: [] };
  global.fetch = async (_, init) => {
    if (init.method === 'GET') return Response.json({ configured: true, hasBrand: true, jobs: [], photos: [] });
    const body = JSON.parse(init.body); calls.push(body.action);
    return Response.json({ jobs: [{ ...job, ...(body.action === 'refresh' ? { status: 'ready', results: [{ id: 'p1', caption: 'Welkom', assets: [], mediaType: 'single_image' }] } : {}) }] });
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let r;
  try {
    await React.act(async () => { r = Renderer.create(React.createElement(Component, { item, enabled: true, workspaceId: 'w', session: { access_token: 'one' }, businessName: 'Caribbean Corner' })); });
    const button = label => r.root.findAllByType('button').find(b => text(b) === label);
    await React.act(async () => r.root.findByType('input').props.onChange({ target: { checked: true } }));
    await React.act(async () => button('Content laten maken').props.onClick());
    assert.deepEqual(calls, ['generate']);
    assert.equal(r.root.findAllByProps({ 'aria-label': 'Gemaakte content inplannen' }).length, 0);
    await React.act(async () => t.mock.timers.tick(20000));
    assert.deepEqual(calls, ['generate', 'refresh']);
    assert.match(text(r.root), /Content klaar bij Predis/);
    assert.equal(r.root.findAllByProps({ 'aria-label': 'Gemaakte content inplannen' }).length, 0);
    await React.act(async () => button('Ontwerp bekeken — verder naar inplannen').props.onClick());
    assert.equal(r.root.findAllByProps({ 'aria-label': 'Gemaakte content inplannen' }).length, 1);
    assert.ok(r.root.findAllByType('a').every(a => a.props.href === 'https://app.predis.ai/app/content_library'));
    await React.act(async () => t.mock.timers.tick(60000));
    assert.deepEqual(calls, ['generate', 'refresh']);
  } finally { if (r) await React.act(async () => r.unmount()); t.mock.timers.reset(); global.window = oldWindow; global.fetch = oldFetch; }
});

test('automatic result checks pause after repeated errors and stop when the panel closes', async t => {
  const Component = (await load('components/predis-content.js', { 'next/image': { default: p => React.createElement('img', p) } })).default;
  const oldWindow = global.window, oldFetch = global.fetch;
  global.window = { addEventListener() {}, removeEventListener() {} };
  const calls = [], job = { id, status: 'generating', postIds: ['p1'], createdAt: new Date().toISOString(), prompt: draft.prompt, mediaType: 'single_image', results: [] };
  global.fetch = async (_, init) => {
    if (init.method === 'GET') return Response.json({ configured: true, jobs: [job], photos: [] });
    calls.push(JSON.parse(init.body).action); throw new Error('Predis tijdelijk niet bereikbaar');
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const props = { item, enabled: true, workspaceId: 'w', session: { access_token: 'one' } };
  let r;
  try {
    await React.act(async () => { r = Renderer.create(React.createElement(Component, props)); });
    await React.act(async () => r.update(React.createElement(Component, { ...props, enabled: false })));
    await React.act(async () => t.mock.timers.tick(60000));
    assert.equal(calls.length, 0);
    await React.act(async () => r.update(React.createElement(Component, props)));
    for (const delay of [20000, 40000, 60000]) await React.act(async () => t.mock.timers.tick(delay));
    assert.deepEqual(calls, ['refresh', 'refresh', 'refresh']);
    assert.match(text(r.root), /gepauzeerd na drie mislukte controles/);
    await React.act(async () => t.mock.timers.tick(120000));
    assert.equal(calls.length, 3);
  } finally { if (r) await React.act(async () => r.unmount()); t.mock.timers.reset(); global.window = oldWindow; global.fetch = oldFetch; }
});
test('input uses only event photos, limits payloads and selects the custom-asset-capable model', async () => {
  const lib = await load('lib/predis-content.js');
  const input = lib.validatePredisInput(draft, item), form = lib.predisForm(input, 'brand');
  assert.equal(form.get('model_version'), '2'); assert.equal(form.get('media_urls'), JSON.stringify([photo])); assert.equal(form.get('n_posts'), '1');
  assert.equal(lib.predisForm({ ...input, mediaUrls: [] }, 'brand').get('model_version'), '4');
  assert.equal(lib.predisForm({ ...input, mediaType: 'video' }, 'brand').get('video_duration'), 'short');
  for (const patch of [{ prompt: 'tiny' }, { prompt: 'a '.repeat(6000) }, { mediaUrls: ['https://other.example.com/photo.jpg'] }, { mediaType: 'publish' }, { mediaUrls: [photo, photo] }]) assert.throws(() => lib.validatePredisInput({ ...draft, ...patch }, item));
  assert.match(lib.predisPrompt(item), /Jamsessie/); assert.match(lib.predisPrompt(item), /18:00/);
});
test('result parsing accepts only exact stored post IDs and safe media URLs', async () => {
  const { normalizePredisPost } = await load('lib/predis-content.js');
  assert.equal(normalizePredisPost(post, ['p1']).assets[0].type, 'image');
  assert.equal(normalizePredisPost(post, ['other']), null);
  for (const url of ['javascript:alert(1)', 'http://example.com/a', 'https://127.0.0.1/a', 'https://user:secret@example.com/a', 'https://internal.local/a']) assert.equal(normalizePredisPost({ ...post, urls: [url] }, ['p1']), null);
});
async function harness(options = {}) {
  const row = structuredClone(item), writes = [], calls = []; let revision = 1, conflict = options.conflict;
  const token = 'verified.' + Buffer.from(JSON.stringify({ aal: options.aal || 'aal2' })).toString('base64url') + '.sig';
  let adminCalls = 0;
  function query(table) {
    const filters = {}; let patch;
    function result() {
      if (table === 'user_role_assignments') return { data: [{ business_id: options.denied ? 'wrong' : 'b', location_id: options.location ? 'l' : null, role: { role_key: 'custom' }, assignment_permissions: [{ permission: 'marketing:manage' }] }] };
      assert.equal(filters.workspace_id, 'w'); assert.equal(filters.business_id, 'b');
      if (table === 'integration_accounts') { assert.equal(filters.provider, 'predis'); return { data: options.noBrand ? null : { external_account_id: 'private-brand', connection_status: 'connected' } }; }
      assert.equal(table, 'social_content_items'); assert.equal(filters.id, 'c');
      if (!patch) return { data: structuredClone(row) };
      assert.deepEqual(Object.keys(patch), ['media']); writes.push(patch);
      if (options.storageError) return { error: { message: 'secret database failure' } };
      if (filters.updated_at !== row.updated_at) return { data: null };
      if (conflict) { conflict = false; row.media[1].calendar_channel = { status: 'keep-concurrent' }; row.updated_at = 'v' + ++revision; return { data: null }; }
      row.media = patch.media; row.updated_at = 'v' + ++revision; return { data: { id: row.id } };
    }
    let q; q = new Proxy({}, { get: (_, k) => k === 'then' ? (resolve, reject) => Promise.resolve(result()).then(resolve, reject) : k === 'maybeSingle' ? async () => result() : k === 'eq' ? (field, value) => { filters[field] = value; return q; } : k === 'update' ? value => { patch = value; return q; } : () => q }); return q;
  }
  const db = { from: query, auth: { getUser: async () => ({ data: { user: options.noAuth ? null : { id: 'u' } } }) } };
  const route = await load('app/api/marketing/predis-content/route.js', { '../../../../lib/server-supabase': { createUserSupabase: () => db, createAdminSupabase: () => { adminCalls++; return db; } } });
  process.env.PREDIS_API_KEY = options.noKey ? '' : 'TEST-ONLY';
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/create_content/')) {
      assert.equal(row.media[1].predis_content.jobs.at(-1).status, 'submitting');
      if (options.timeout) throw new Error('hidden token network failure');
      if (options.reject) return Response.json({ errors: [{ detail: 'private upstream details' }] }, { status: 429 });
      if (options.malformed) return Response.json({ post_status: 'inProgress' });
      if (options.creationReply) return Response.json(options.creationReply);
      return Response.json({ post_ids: ['p1'], post_status: 'inProgress', errors: [] });
    }
    if (options.readError) return Response.json({ errors: [{}] }, { status: 500 });
    return Response.json({ posts: options.results || [post, { ...post, post_id: 'unrelated' }], total_pages: options.pages || 1 });
  };
  async function send(extra = {}) {
    const r = await route.POST(new Request('https://local.test/api', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: 'w', businessId: 'b', itemId: 'c', action: 'generate', ...draft, ...extra }) }));
    return { status: r.status, ...await r.json() };
  }
  async function get() { const r = await route.GET(new Request('https://local.test/api?workspaceId=w&businessId=b&itemId=c', { headers: { Authorization: 'Bearer ' + token } })); return { status: r.status, ...await r.json() }; }
  return { send, get, row, writes, calls, adminCalls: () => adminCalls };
}
test('generation is reserved before request, scoped, persistent and idempotent; refresh never publishes', async () => {
  const h = await harness({ conflict: true });
  const first = await h.send(); assert.equal(first.status, 200); assert.equal(first.jobs[0].status, 'generating'); assert.equal(first.jobs[0].brandId, undefined);
  assert.equal((await h.send()).jobs[0].id, id); assert.equal(h.calls.length, 1);
  assert.equal((await h.get()).jobs[0].postIds[0], 'p1');
  const result = await h.send({ action: 'refresh', jobId: id }); assert.equal(result.jobs[0].status, 'ready'); assert.equal(result.jobs[0].results.length, 1);
  assert.equal(result.jobs[0].results[0].id, 'p1'); assert.equal(h.calls.length, 2);
  assert.equal(h.row.media[1].manual_predis.revision, 'keep'); assert.equal(h.row.media[1].provider_delivery.website.status, 'published'); assert.equal(h.row.media[1].calendar_channel.status, 'keep-concurrent');
  assert.ok(h.calls.every(c => c.url.includes('/create_content/') || c.url.includes('/get_posts/')));
});
test('double concurrent generate requests can send only one paid provider request', async () => {
  const h = await harness(); const results = await Promise.all([h.send(), h.send()]); assert.ok(results.some(r => r.status === 200)); assert.equal(h.calls.length, 1); assert.equal(h.row.media[1].predis_content.jobs.length, 1);
});
test('uncertain and malformed responses do not automatically retry and remain stored', async () => {
  for (const options of [{ timeout: true }, { malformed: true }]) {
    const h = await harness(options); await h.send(); assert.equal(h.row.media[1].predis_content.jobs[0].status, 'unknown'); await h.send(); assert.equal(h.calls.length, 1);
    assert.equal((await h.send({ requestId: id.replace(/^1/, '2') })).status, 409);
  }
});
test('rejection is not success and private provider messages are not exposed', async () => {
  const h = await harness({ reject: true }); const result = await h.send(); assert.equal(result.jobs[0].status, 'failed'); assert.doesNotMatch(JSON.stringify(result), /private upstream/);
});
test('auth, MFA, business/location scope and storage fail closed before provider calls', async () => {
  for (const options of [{ denied: true }, { location: true }, { noAuth: true }, { aal: 'aal1' }]) { const h = await harness(options); assert.ok((await h.send()).status >= 400); assert.equal(h.calls.length, 0); assert.equal(h.adminCalls(), 0); }
  const h = await harness({ storageError: true }); assert.equal((await h.send()).status, 500); assert.equal(h.calls.length, 0);
});
test('missing key/brand and missing consent do not create paid requests', async () => {
  for (const options of [{ noKey: true }, { noBrand: true }]) { const h = await harness(options); assert.equal((await h.get()).configured, false); assert.ok((await h.send()).status >= 400); assert.equal(h.calls.length, 0); }
  const h = await harness(); assert.equal((await h.send({ confirmed: false })).status, 400); assert.equal(h.calls.length, 0);
});
test('bounded pagination continues across refreshes and never attaches unrelated results', async () => {
  const h = await harness({ results: [{ ...post, post_id: 'other' }], pages: 8 }); await h.send();
  const r = await h.send({ action: 'refresh', jobId: id }); assert.equal(r.jobs[0].status, 'generating'); assert.equal(r.jobs[0].results.length, 0); assert.equal(r.jobs[0].nextPage, 4); assert.equal(h.calls.length, 4);
  await h.send({ action: 'refresh', jobId: id }); assert.equal(h.calls.length, 4); // throttle
});
test('failed refresh preserves IDs and never issues a second generation', async () => {
  const h = await harness({ readError: true }); await h.send(); assert.equal((await h.send({ action: 'refresh', jobId: id })).status, 502); assert.deepEqual(h.row.media[1].predis_content.jobs[0].postIds, ['p1']); assert.equal(h.calls.filter(c => c.url.endsWith('/create_content/')).length, 1);
});
const text = node => typeof node === 'string' ? node : (node.children || []).map(text).join(' ');
test('UI loads only on open; defaults event photo; preserves prompt on token refresh; suppresses duplicate clicks', async () => {
  global.window = { addEventListener() {}, removeEventListener() {}, confirm: () => true };
  let calls = [], release, body;
  global.fetch = async (_, init) => {
    calls.push(init.method);
    if (init.method === 'GET') return Response.json({ configured: true, hasBrand: true, jobs: [], photos: [{ url: photo, label: 'Evenementfoto' }] });
    body = JSON.parse(init.body); return new Promise(resolve => { release = resolve; });
  };
  const Component = (await load('components/predis-content.js', { 'next/image': { default: p => React.createElement('img', p) } })).default;
  const props = { item, workspaceId: 'w', session: { access_token: 'one' }, enabled: false };
  let r; await React.act(async () => { r = Renderer.create(React.createElement(Component, props)); });
  try {
    assert.equal(calls.length, 0); await React.act(async () => r.update(React.createElement(Component, { ...props, enabled: true })));
    assert.equal(r.root.findAllByType('input')[0].props.checked, true);
    await React.act(async () => r.root.findByType('textarea').props.onChange({ target: { value: draft.prompt } }));
    await React.act(async () => r.update(React.createElement(Component, { ...props, enabled: true, session: { access_token: 'two' } })));
    assert.equal(calls.length, 1); assert.equal(r.root.findByType('textarea').props.value, draft.prompt);
    const button = () => r.root.findAllByType('button').find(b => text(b) === 'Content laten maken');
    assert.equal(button().props.disabled, true);
    await React.act(async () => r.root.findAllByType('input')[1].props.onChange({ target: { checked: true } }));
    let pending; await React.act(async () => { pending = button().props.onClick(); button().props.onClick(); }); assert.equal(calls.length, 2); assert.deepEqual(body.mediaUrls, [photo]);
    await React.act(async () => { release(Response.json({ jobs: [{ id, status: 'generating', createdAt: '2026-09-28T00:00:00Z', prompt: draft.prompt, mediaType: 'single_image', results: [] }] })); await pending; });
    assert.match(text(r.root), /Aanvraag geaccepteerd/); assert.doesNotMatch(text(r.root), /Nog niet aangevraagd/);
  } finally { await React.act(async () => r.unmount()); delete global.window; }
});
test('generated content goes into separate manual draft, preserving dates until explicit save', async () => {
  global.window = { addEventListener() {}, removeEventListener() {}, confirm: () => true };
  global.fetch = async () => Response.json({ saved: { revision: 'r', draft: { caption: 'Old', assets: [], entries: [{ key: 'k', at: '2026-10-01T10:00', channel: 'instagram' }] }, confirmations: {} } });
  const Component = (await load('components/manual-predis.js', { 'next/image': { default: p => React.createElement('img', p) } })).default;
  let r; await React.act(async () => { r = Renderer.create(React.createElement(Component, { item, enabled: true, workspaceId: 'w', session: { access_token: 'one' }, generatedContent: { id: 'p1', caption: 'New generated caption', assets: [{ url: photo, type: 'image', label: 'Generated' }] } })); });
  try { assert.equal(r.root.findByType('textarea').props.value, 'New generated caption'); assert.match(text(r.root), /01\s*-\s*10\s*-\s*2026/); assert.match(text(r.root), /Niet-bewaarde wijzigingen/); }
  finally { await React.act(async () => r.unmount()); delete global.window; }
});

const acceptedJob = () => ({ id, brandId: 'brand', postIds: ['p1'], mediaType: 'single_image', status: 'generating', results: [] });
const callback = { status: 'completed', post_id: 'p1', brand_id: 'brand', caption: 'Welkom!', generated_media: [{ url: photo }] };
const callbackRow = () => ({ ...structuredClone(item), workspace_id: 'w', media: [{ kind: 'campaign_distribution', common: { title: 'Keep' }, predis_content: { jobs: [acceptedJob()] }, calendar_channel: { status: 'keep' } }] });
test('new webhook stores a complete result without altering event or other channels; replay is inert', async () => {
  const { applyPredisWebhook } = await load('lib/predis-webhook.js');
  const row = callbackRow(), media = applyPredisWebhook(row, callback, 'now');
  assert.equal(media[0].predis_content.jobs[0].status, 'ready');
  assert.equal(media[0].predis_content.jobs[0].results[0].caption, 'Welkom!');
  assert.deepEqual(media[0].common, row.media[0].common);
  assert.deepEqual(media[0].calendar_channel, row.media[0].calendar_channel);
  assert.equal(applyPredisWebhook({ ...row, media }, callback, 'later'), null);
  assert.equal(applyPredisWebhook({ ...row, media }, { status: 'error', post_id: 'p1' }, 'later'), null);
});
test('provider failure is explicit, but a later completed result can recover it', async () => {
  const { applyPredisWebhook } = await load('lib/predis-webhook.js');
  const row = callbackRow();
  row.media = applyPredisWebhook(row, { status: 'error', post_id: 'p1' }, 'now');
  assert.equal(row.media[0].predis_content.jobs[0].status, 'generation_failed');
  assert.equal(applyPredisWebhook(row, { status: 'error', post_id: 'p1' }, 'later'), null);
  assert.equal(applyPredisWebhook(row, callback, 'later')[0].predis_content.jobs[0].status, 'ready');
});
test('webhook rejects wrong brand and incomplete or unsafe media and ignores other IDs', async () => {
  const { applyPredisWebhook } = await load('lib/predis-webhook.js');
  for (const patch of [{ brand_id: 'other' }, { generated_media: [] }, { generated_media: [{ url: 'https://127.0.0.1/a' }] }]) assert.throws(() => applyPredisWebhook(callbackRow(), { ...callback, ...patch }, 'now'));
  assert.equal(applyPredisWebhook(callbackRow(), { ...callback, post_id: 'other' }, 'now'), null);
});
function webhookDb(rows, conflict = false) {
  let writes = 0;
  return { get writes() { return writes; }, from(table) {
    assert.equal(table, 'social_content_items'); const filters = {}; let patch, contains;
    const result = () => {
      if (contains) return { data: structuredClone(rows) };
      const row = rows.find(r => r.id === filters.id && r.workspace_id === filters.workspace_id && r.business_id === filters.business_id);
      if (!patch) return { data: structuredClone(row) };
      if (conflict) { conflict = false; row.updated_at = 'concurrent'; row.media[0].calendar_channel.status = 'concurrent'; return { data: null }; }
      assert.equal(filters.updated_at, row.updated_at); writes++; row.media = patch.media; row.updated_at += '-next'; return { data: { id: row.id } };
    };
    let q; q = new Proxy({}, { get: (_, k) => k === 'then' ? resolve => resolve(result()) : k === 'maybeSingle' ? async () => result() : k === 'contains' ? (column, value) => { assert.equal(column, 'media'); assert.equal(typeof value, 'string'); assert.equal(JSON.parse(value)[0].predis_content.jobs[0].postIds[0], 'p1'); contains = value; return q; } : k === 'eq' ? (key, value) => { filters[key] = value; return q; } : k === 'update' ? value => { patch = value; return q; } : () => q }); return q;
  } };
}
test('webhook updates reconciled copies only within identical job/tenant identity and preserves concurrent edits', async () => {
  const { savePredisWebhookJobs } = await load('lib/predis-webhook.js');
  const rows = [callbackRow(), { ...callbackRow(), id: 'copy' }], db = webhookDb(rows, true);
  assert.equal(await savePredisWebhookJobs(db, callback), true); assert.equal(db.writes, 2);
  assert.equal(rows[0].media[0].calendar_channel.status, 'concurrent');
  assert.ok(rows.every(r => r.media[0].predis_content.jobs[0].status === 'ready'));
  await savePredisWebhookJobs(db, callback); assert.equal(db.writes, 2);
  for (const mismatch of [{ workspace_id: 'other' }, { business_id: 'other' }]) {
    const unsafe = webhookDb([callbackRow(), { ...callbackRow(), ...mismatch, id: 'copy' }]);
    await assert.rejects(savePredisWebhookJobs(unsafe, callback), /AMBIGUOUS_JOB/); assert.equal(unsafe.writes, 0);
  }
  assert.equal(await savePredisWebhookJobs(webhookDb([]), callback), false);
});
test('webhook requires secret before database access and stores accepted callbacks', async () => {
  const rows = [callbackRow()], db = webhookDb(rows); let accesses = 0;
  const route = await load('app/api/integrations/predis/webhook/route.js', { '../../../../../lib/server-supabase': { createAdminSupabase: () => { accesses++; return db; } } });
  process.env.PREDIS_WEBHOOK_SECRET = 'test-callback-only';
  const send = (secret, body) => route.POST({ nextUrl: new URL('https://example.test/?token=' + secret), json: async () => body });
  assert.equal((await send('wrong', callback)).status, 401); assert.equal(accesses, 0);
  assert.equal((await send('test-callback-only', {})).status, 400); assert.equal(accesses, 0);
  assert.equal((await send('test-callback-only', callback)).status, 200);
  assert.equal(rows[0].media[0].predis_content.jobs[0].status, 'ready');
  delete process.env.PREDIS_WEBHOOK_SECRET;
});
test('overdue and malformed results are uncertain, not an endless claim of generation', async () => {
  const h = await harness({ results: [] }); await h.send();
  h.row.media[1].predis_content.jobs[0].createdAt = '2020-01-01T00:00:00Z';
  const r = await h.send({ action: 'refresh', jobId: id });
  assert.equal(r.jobs[0].status, 'unknown'); assert.match(r.warning, /15 minuten/); assert.equal(h.calls.length, 2);
  const malformed = await harness({ results: [{ ...post, urls: [] }] }); await malformed.send();
  const m = await malformed.send({ action: 'refresh', jobId: id }); assert.equal(m.jobs[0].status, 'unknown'); assert.match(m.warning, /niet veilig/);
});

test('real Supabase client serializes the webhook JSONB predicate as JSON, not a SQL array', async () => {
  const { createClient } = require('@supabase/supabase-js');
  const { savePredisWebhookJobs } = await load('lib/predis-webhook.js');
  let predicate;
  const client = createClient('https://test-only.supabase.co', 'test-only', { global: { fetch: async url => {
    predicate = new URL(String(url)).searchParams.get('media');
    return Response.json([]);
  } } });
  assert.equal(await savePredisWebhookJobs(client, callback), false);
  assert.ok(predicate.startsWith('cs.['));
  assert.deepEqual(JSON.parse(predicate.slice(3)), [{ kind: 'campaign_distribution', predis_content: { jobs: [{ postIds: ['p1'] }] } }]);
});

test('own-media trial requires own assets and prevents video URLs being ignored for images/carousels', async () => {
  const lib = await load('lib/predis-content.js');
  const video = 'https://images.example.com/clip.mp4';
  const withVideo = { ...item, media: [...item.media, { kind: 'video', url: video }] };
  for (const mediaType of ['single_image', 'carousel', 'video']) {
    assert.throws(() => lib.validatePredisInput({ ...draft, sourceMode: 'own', mediaType, mediaUrls: [] }, withVideo), /minimaal één eigen bestand/);
  }
  for (const mediaType of ['single_image', 'carousel']) {
    assert.throws(() => lib.validatePredisInput({ ...draft, sourceMode: 'own', mediaType, mediaUrls: [video] }, withVideo), /alleen voor video/);
  }
  const input = lib.validatePredisInput({ ...draft, sourceMode: 'own', mediaType: 'video', mediaUrls: [video, photo] }, withVideo);
  assert.deepEqual(input.sourceAssets.map(a => a.type), ['video', 'image']);
  const form = lib.predisForm(input, 'brand');
  assert.equal(form.get('model_version'), '2');
  assert.equal(form.get('media_urls'), JSON.stringify([video, photo]));
  assert.equal(form.get('n_posts'), '1');
  assert.match(lib.predisOwnMediaPrompt(item), /geen extra tekst/);
  assert.match(lib.predisOwnMediaPrompt(item), /Live muziek op donderdagavond\./);
  assert.throws(() => lib.validatePredisInput({ ...draft, sourceMode: 'unknown' }, item));
});

test('own-media server trial stores original inputs, uses model 2, and handles both documented response shapes without retry', async () => {
  for (const creationReply of [{ post_id: 'p1', status: 'inProgress' }, { post_ids: ['p1'], post_status: 'inProgress', errors: [] }]) {
    const h = await harness({ creationReply });
    const first = await h.send({ sourceMode: 'own' });
    assert.equal(first.jobs[0].status, 'generating');
    assert.equal(first.jobs[0].sourceMode, 'own');
    assert.deepEqual(first.jobs[0].sourceAssets.map(a => a.url), [photo]);
    assert.equal(h.calls[0].init.body.get('model_version'), '2');
    assert.equal(h.calls[0].init.body.get('media_urls'), JSON.stringify([photo]));
    assert.equal(h.calls[0].init.headers.Authorization, 'TEST-ONLY');
    await h.send({ sourceMode: 'own' });
    assert.equal(h.calls.length, 1);
    const refreshed = await h.send({ action: 'refresh', jobId: id });
    assert.equal(refreshed.jobs[0].status, 'ready');
    assert.deepEqual(refreshed.jobs[0].sourceAssets, first.jobs[0].sourceAssets);
  }
  const empty = await harness();
  assert.equal((await empty.send({ sourceMode: 'own', mediaUrls: [] })).status, 400);
  assert.equal(empty.calls.length, 0);
  assert.equal(empty.row.media[1].predis_content, undefined);
  const invalid = await harness({ creationReply: { post_id: 'p1', post_ids: null } });
  assert.equal((await invalid.send({ sourceMode: 'own' })).jobs[0].status, 'unknown');
  await invalid.send({ sourceMode: 'own' });
  assert.equal(invalid.calls.length, 1);
});

test('own-media choice is visible, separate from unchanged uploads and never generates on opening', async () => {
  const oldWindow = global.window, oldFetch = global.fetch;
  global.window = { confirm: () => true };
  global.fetch = async () => { throw new Error('Choice must not call provider'); };
  const Component = (await load('components/predis-workspace.js', {
    './predis-content': { default: props => React.createElement('predis-generator', props) },
    './manual-predis': { default: () => null }, './predis-library': { default: () => null },
  })).default;
  let r;
  try {
    await React.act(async () => { r = Renderer.create(React.createElement(Component, { item, businessName: 'Caribbean Corner' })); });
    assert.equal(r.root.findAllByType('predis-generator').length, 0);
    await React.act(async () => r.root.findAllByType('button').find(b => text(b) === 'Andere werkwijze kiezen').props.onClick());
    await React.act(async () => r.root.findAllByType('button').find(b => text(b) === 'Eigen beeld gebruiken — proef voorbereiden').props.onClick());
    assert.equal(r.root.findByType('predis-generator').props.sourceMode, 'own');
    assert.match(text(r.root), /geen ongewijzigde upload/);
  } finally { if (r) await React.act(async () => r.unmount()); global.window = oldWindow; global.fetch = oldFetch; }
});

test('own-media UI requires selected source and credit consent and sends the reviewed text once', async () => {
  const oldWindow = global.window, oldFetch = global.fetch;
  global.window = { addEventListener() {}, removeEventListener() {}, confirm: () => true };
  const video = 'https://images.example.com/clip.mp4';
  const calls = [];
  global.fetch = async (_, init) => {
    if (init.method === 'GET') return Response.json({ configured: true, jobs: [], assets: [{ url: photo, type: 'image', label: 'Eigen flyer' }, { url: video, type: 'video', label: 'Video' }] });
    const body = JSON.parse(init.body); calls.push(body);
    return Response.json({ jobs: [{ id, createdAt: new Date().toISOString(), status: 'unknown', mediaType: body.mediaType, sourceMode: body.sourceMode, prompt: body.prompt, sourceAssets: [{ url: photo, type: 'image' }] }] });
  };
  const Component = (await load('components/predis-content.js', { 'next/image': { default: p => React.createElement('img', p) } })).default;
  let r;
  try {
    await React.act(async () => { r = Renderer.create(React.createElement(Component, { item, enabled: true, sourceMode: 'own', workspaceId: 'w', session: { access_token: 'one' } })); });
    const start = () => r.root.findAllByType('button').find(b => text(b) === 'Proef met eigen beeld starten');
    assert.match(r.root.findByType('textarea').props.value, /Neem het onderstaande bijschrift letterlijk over/);
    assert.equal(start().props.disabled, true);
    assert.equal(r.root.findAllByType('video').length, 0);
    await React.act(async () => r.root.findAllByType('input')[0].props.onChange()); // deselect photo
    await React.act(async () => r.root.findAllByType('input')[1].props.onChange({ target: { checked: true } }));
    assert.equal(start().props.disabled, true);
    await React.act(async () => start().props.onClick());
    assert.equal(calls.length, 0);
    await React.act(async () => r.root.findAllByType('input')[0].props.onChange());
    await React.act(async () => r.root.findByType('textarea').props.onChange({ target: { value: draft.prompt } }));
    assert.equal(start().props.disabled, true); // changing input revokes consent
    await React.act(async () => r.root.findAllByType('input')[1].props.onChange({ target: { checked: true } }));
    await React.act(async () => { const pending = start().props.onClick(); start().props.onClick(); await pending; });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sourceMode, 'own'); assert.equal(calls[0].prompt, draft.prompt);
    assert.deepEqual(calls[0].mediaUrls, [photo]);
    assert.equal(r.root.findAllByProps({ 'aria-label': 'Origineel vergelijken met Predis' }).length, 1);
    assert.match(text(r.root), /bewijst niet dat het resultaat ongewijzigd is/);
  } finally { if (r) await React.act(async () => r.unmount()); global.window = oldWindow; global.fetch = oldFetch; }
});

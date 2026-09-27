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
    assert.match(text(r.root), /Predis maakt de content/); assert.doesNotMatch(text(r.root), /Nog niet aangevraagd/);
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

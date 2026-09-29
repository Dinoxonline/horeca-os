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
const providerPost = { post_id: 'p1', caption: '🌴 DONDERDAG 24 SEPTEMBER – CARIBBEAN SOCIAL CLUB\nPatricia Colon', media_type: 'single_image', urls: ['https://cdn.example.com/original.png'] };
const item = { id: 'c', business_id: 'b', body: 'Original event', updated_at: 'v1', media: [{ kind: 'image', url: 'https://cdn.example.com/source.png' }, { kind: 'campaign_distribution', common: { title: 'Original event' }, manual_predis: { revision: 'keep' }, predis_content: { jobs: [{ id: 'old-ai' }] }, provider_delivery: { website: { status: 'published' } } }] };
async function harness(t, options = {}) {
  const oldFetch = global.fetch, oldKey = process.env.PREDIS_API_KEY;
  t.after(() => { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.PREDIS_API_KEY; else process.env.PREDIS_API_KEY = oldKey; });
  const row = structuredClone(item), writes = [], calls = [];
  let adminCalls = 0, revision = 1, conflict = options.conflict;
  const token = 'verified.' + Buffer.from(JSON.stringify({ aal: options.aal || 'aal2' })).toString('base64url') + '.sig';
  function query(table) {
    const filters = {}; let patch, selected;
    function result() {
      if (table === 'user_role_assignments') {
        assert.equal(filters.workspace_id, 'w'); assert.equal(filters.user_id, 'u');
        return { data: options.roles || [{ business_id: 'b', role: { role_key: 'custom' }, assignment_permissions: [{ permission: 'marketing:manage' }] }] };
      }
      assert.equal(filters.workspace_id, 'w'); assert.equal(filters.business_id, 'b');
      if (table === 'integration_accounts') { assert.equal(filters.provider, 'predis'); assert.equal(patch, undefined); return { data: options.noBrand ? null : { external_account_id: options.brand || 'private-brand', connection_status: 'connected' } }; }
      assert.equal(table, 'social_content_items'); assert.equal(filters.id, 'c');
      if (!patch) return { data: options.missing ? null : structuredClone(row) };
      assert.deepEqual(Object.keys(patch), ['media']); assert.equal(selected, 'id'); writes.push(patch);
      if (options.storageError) return { error: { message: 'secret error' } };
      if (filters.updated_at !== row.updated_at) return { data: null };
      if (conflict) { if (conflict !== 'always') conflict = false; row.media[1].calendar_channel = { status: 'preserve concurrent' }; row.updated_at = 'v' + ++revision; return { data: null }; }
      row.media = patch.media; row.updated_at = 'v' + ++revision; return { data: { id: row.id } };
    }
    let q; q = new Proxy({}, { get: (_, k) => k === 'then' ? (resolve, reject) => Promise.resolve(result()).then(resolve, reject) : k === 'maybeSingle' ? async () => result() : k === 'eq' ? (field, value) => { filters[field] = value; return q; } : k === 'update' ? value => { patch = value; return q; } : k === 'select' ? value => { selected = value; return q; } : () => q }); return q;
  }
  const db = { from: query, auth: { getUser: async () => ({ data: { user: options.noAuth ? null : { id: 'u' } } }) } };
  const route = await load('app/api/marketing/predis-library/route.js', { '../../../../lib/server-supabase': { createUserSupabase: () => db, createAdminSupabase: () => { adminCalls++; return db; } } });
  process.env.PREDIS_API_KEY = options.noKey ? '' : 'TEST-ONLY';
  global.fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.equal(new URL(url).pathname, '/predis_api/v1/get_posts/');
    assert.equal(new URL(url).searchParams.get('brand_id'), options.brand || 'private-brand');
    if (options.timeout) throw new Error('secret provider failure');
    return Response.json(options.response || { posts: options.posts || [providerPost], total_pages: 3 }, { status: options.status || 200 });
  };
  const scope = { workspaceId: 'w', businessId: 'b', itemId: 'c' };
  async function request(extra = {}, write = false) {
    const r = await route[write ? 'POST' : 'GET'](new Request('https://local.test/api?' + new URLSearchParams({ ...scope, ...extra }), { method: write ? 'POST' : 'GET', headers: options.noToken ? {} : { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(write ? { body: JSON.stringify({ ...scope, action: 'link', confirmed: true, ...extra }) } : {}) }));
    assert.equal(r.headers.get('cache-control'), 'no-store');
    return { status: r.status, ...await r.json() };
  }
  return { get: extra => request(extra), link: extra => request(extra, true), row, calls, writes, adminCalls: () => adminCalls };
}

test('opening reads only saved state; explicit listing uses the scoped brand, type and page, never writes', async t => {
  const h = await harness(t);
  assert.equal((await h.get()).configured, true); assert.equal(h.calls.length, 0);
  const r = await h.get({ list: '1', brandId: 'foreign', page: '2', mediaType: 'single_image' });
  assert.equal(r.status, 200); assert.equal(r.page, 2); assert.equal(r.totalPages, 3);
  assert.equal(r.posts[0].caption, providerPost.caption); assert.equal(r.posts[0].assets[0].url, providerPost.urls[0]);
  assert.equal(r.posts[0].brandId, undefined); assert.equal(h.writes.length, 0);
  assert.equal(h.calls[0].url.searchParams.get('items_n'), '20');
});
test('link revalidates provider snapshot, preserves other channels and concurrency, persists once', async t => {
  const h = await harness(t, { conflict: true });
  const post = (await h.get({ list: '1' })).posts[0];
  const input = { postId: post.id, fingerprint: post.fingerprint, caption: 'tampered', assets: ['https://evil.example/a'], brandId: 'foreign' };
  const r = await h.link(input);
  assert.equal(r.status, 200); assert.equal(r.linked[0].caption, providerPost.caption);
  assert.equal(r.linked[0].brandId, undefined); assert.equal(h.row.body, 'Original event');
  const d = h.row.media[1];
  assert.equal(d.manual_predis.revision, 'keep'); assert.equal(d.predis_content.jobs[0].id, 'old-ai');
  assert.equal(d.provider_delivery.website.status, 'published'); assert.equal(d.calendar_channel.status, 'preserve concurrent');
  assert.equal(h.writes.length, 2); assert.equal((await h.link(input)).alreadyLinked, true);
  assert.equal(h.writes.length, 2); assert.equal((await h.get()).linked.length, 1);
});
test('foreign or changed post cannot be linked, including a changed configured brand', async t => {
  const options = {}, h = await harness(t, options), post = (await h.get({ list: '1' })).posts[0];
  for (const input of [{ postId: 'foreign', fingerprint: post.fingerprint }, { postId: post.id, fingerprint: '0'.repeat(64) }]) assert.equal((await h.link(input)).status, 409);
  options.brand = 'different-brand';
  assert.equal((await h.link({ postId: post.id, fingerprint: post.fingerprint })).status, 409);
  assert.equal(h.writes.length, 0);
});
test('authentication, MFA, tenant and location rights fail before privileged access', async t => {
  for (const options of [{ noToken: true }, { noAuth: true }, { aal: 'aal1' }, { roles: [] }, { roles: [{ business_id: 'other', role: { role_key: 'owner' } }] }, { roles: [{ location_id: 'limited', role: { role_key: 'owner' } }] }, { roles: [{ role: { role_key: 'custom', role_permissions: [{ permission: 'marketing:manage' }] }, assignment_permissions: [] }] }]) {
    const h = await harness(t, options), r = await h.get({ list: '1' });
    assert.ok([401, 403].includes(r.status)); assert.equal(h.adminCalls(), 0); assert.equal(h.calls.length, 0);
  }
});
test('configuration, missing event, invalid pagination and format fail without provider calls', async t => {
  for (const options of [{ noBrand: true }, { noKey: true }, { missing: true }]) {
    const h = await harness(t, options); assert.ok([404, 409].includes((await h.get({ list: '1' })).status)); assert.equal(h.calls.length, 0);
  }
  const h = await harness(t);
  for (const extra of [{ page: '0' }, { page: '-1' }, { page: '1.5' }, { page: '10001' }, { mediaType: 'invalid' }]) assert.equal((await h.get({ list: '1', ...extra })).status, 400);
  assert.equal(h.calls.length, 0);
});
test('malformed/private media are skipped, format filtering and empty results do not imply empty library', async t => {
  const h = await harness(t, { posts: [providerPost, { ...providerPost, post_id: 'bad', urls: ['https://127.0.0.1/a'] }, { ...providerPost, post_id: 'wrong-format', media_type: 'video' }, { ...providerPost, post_id: 'long-caption', caption: 'a'.repeat(10001) }] });
  const r = await h.get({ list: '1' }); assert.equal(r.posts.length, 1); assert.equal(r.skipped, 3);
  const empty = await harness(t, { posts: [] }); assert.deepEqual((await empty.get({ list: '1' })).posts, []);
});
test('video and carousel preserve original URLs and order', async t => {
  for (const type of ['video', 'carousel']) {
    const urls = type === 'video' ? ['https://cdn.example.com/original.mp4'] : ['https://cdn.example.com/second.png', 'https://cdn.example.com/first.png'];
    const h = await harness(t, { posts: [{ ...providerPost, media_type: type, urls }] });
    const r = await h.get({ list: '1', mediaType: type }); assert.deepEqual(r.posts[0].assets.map(a => a.url), urls);
    assert.equal(r.posts[0].assets[0].type, type === 'video' ? 'video' : 'image');
  }
});
test('provider failures and write conflicts never claim success, leak upstream errors, or generate', async t => {
  for (const options of [{ timeout: true }, { status: 429 }, { status: 500 }, { response: { errors: [{ detail: 'secret' }] } }]) {
    const h = await harness(t, options), r = await h.get({ list: '1' });
    assert.ok([429, 502].includes(r.status)); assert.doesNotMatch(r.error, /secret/); assert.equal(h.writes.length, 0);
  }
  for (const options of [{ storageError: true }, { conflict: 'always' }]) {
    const h = await harness(t, options), post = (await h.get({ list: '1' })).posts[0];
    const r = await h.link({ postId: post.id, fingerprint: post.fingerprint }); assert.ok([409, 500].includes(r.status)); assert.equal(r.linked, undefined);
  }
});
test('confirmation required and concurrent identical linking is idempotent', async t => {
  const h = await harness(t), post = (await h.get({ list: '1' })).posts[0], input = { postId: post.id, fingerprint: post.fingerprint };
  assert.equal((await h.link({ ...input, confirmed: false })).status, 400);
  const r = await Promise.all([h.link(input), h.link(input)]); assert.ok(r.every(v => v.status === 200)); assert.equal(h.row.media[1].predis_library.posts.length, 1);
});
function text(node) { if (typeof node === 'string') return node; return (node.children || []).map(text).join(''); }
test('UI opens lazily, refreshes tokens, explicitly selects and confirms, never generates or publishes', async t => {
  const Component = (await load('components/predis-library.js')).default;
  const oldFetch = global.fetch, calls = [], saves = [], post = { id: 'p1', key: 'k', fingerprint: 'f', caption: providerPost.caption, assets: [], mediaType: 'single_image' };
  global.fetch = async (url, init) => {
    calls.push({ url: new URL(url, 'https://local.test'), init });
    return Response.json(init.method === 'POST' ? { linked: [post] } : { configured: true, linked: [], ...(String(url).includes('list=1') ? { posts: [post], page: 1, totalPages: 2, mediaType: 'single_image', skipped: 0 } : {}) });
  };
  let r;
  t.after(async () => { if (r) await React.act(async () => r.unmount()); global.fetch = oldFetch; });
  const props = { item, workspaceId: 'w', session: { access_token: 'one' }, onLibrarySaved: saved => saves.push(saved) };
  await React.act(async () => { r = Renderer.create(React.createElement(Component, { ...props, enabled: false })); });
  assert.equal(calls.length, 0);
  await React.act(async () => r.update(React.createElement(Component, { ...props, enabled: true })));
  assert.equal(calls.length, 1); assert.equal(calls[0].url.searchParams.has('list'), false);
  await React.act(async () => r.update(React.createElement(Component, { ...props, enabled: true, session: { access_token: 'two' } })));
  assert.equal(calls.length, 1, 'token refresh does not reload draft');
  const button = label => r.root.findAllByType('button').find(b => text(b) === label);
  await React.act(async () => button('Posts ophalen uit Predis').props.onClick());
  assert.equal(calls[1].init.headers.Authorization, 'Bearer two');
  await React.act(async () => button('Deze post kiezen').props.onClick());
  assert.equal(calls.length, 2);
  await React.act(async () => button('Post aan dit evenement koppelen').props.onClick());
  assert.equal(JSON.parse(calls[2].init.body).action, 'link'); assert.equal(saves[0].posts[0].id, 'p1');
  assert.match(text(r.root), /Niets gewijzigd in Predis/);
  assert.ok(calls.every(c => c.url.pathname === '/api/marketing/predis-library'));
});
test('closing a panel aborts and ignores its stale response', async t => {
  const Component = (await load('components/predis-library.js')).default;
  const oldFetch = global.fetch; let finish, signal, r;
  global.fetch = (url, init) => { signal = init.signal; return new Promise(resolve => { finish = resolve; }); };
  t.after(async () => { if (r) await React.act(async () => r.unmount()); global.fetch = oldFetch; });
  const props = { item, workspaceId: 'w', session: { access_token: 'one' } };
  await React.act(async () => { r = Renderer.create(React.createElement(Component, { ...props, enabled: true })); });
  await React.act(async () => r.update(React.createElement(Component, { ...props, enabled: false })));
  assert.equal(signal.aborted, true);
  await React.act(async () => finish(Response.json({ configured: true, linked: [{ key: 'old', caption: 'STALE', assets: [] }] })));
  assert.doesNotMatch(text(r.root), /STALE/);
});
test('draft save preserves linked posts and both event entry points receive library callbacks', async () => {
  const { saveCampaignDraft } = await load('lib/save-campaign-draft.js');
  let patch;
  const d = { kind: 'campaign_distribution', predis_library: { posts: [{ id: 'keep' }] } };
  const q = { select() { return this; }, eq() { return this; }, update(value) { patch = value; return this; }, async maybeSingle() { return { data: patch ? { id: 'c' } : { media: [d], updated_at: 'v1' } }; } };
  await saveCampaignDraft({ from: () => q }, 'w', 'c', { business_id: 'b', media: [{ kind: 'campaign_distribution', common: { title: 'Edited' } }] });
  assert.equal(patch.media[0].predis_library.posts[0].id, 'keep');
  assert.match(fs.readFileSync(path.join(root, 'components/central-event-creator.js'), 'utf8'), /onLibrarySaved=/);
  assert.match(fs.readFileSync(path.join(root, 'components/marketing-overview.js'), 'utf8'), /onLibrarySaved=\{onPredisLibrarySaved\}/);
});

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const swc = require('next/dist/build/swc');
const root = path.resolve(__dirname, '..');
let helpers;
before(async () => { await swc.loadBindings(); helpers = await import('../lib/backup-status.mjs'); });
function load(file, mocks = {}) {
  const { code } = swc.transformSync(fs.readFileSync(path.join(root, file), 'utf8'), {
    filename: file, jsc: { parser: { syntax: file.endsWith('.ts') ? 'typescript' : 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})')(
    name => Object.hasOwn(mocks, name) ? { __esModule: true, ...mocks[name] } : require(name), module, module.exports);
  return module.exports;
}
test('database status never equates local verification with Dropbox receipt', () => {
  const now = Date.now();
  assert.equal(helpers.databaseHealth(null, now).tone, 'warning');
  const latest = { ok: true, copy_verified: true, completed_at: new Date(now).toISOString() };
  assert.deepEqual(helpers.databaseHealth({ latest }, now), { tone: 'success', label: 'Lokale kopie gecontroleerd' });
  assert.equal(helpers.databaseHealth({ latest: { ...latest, ok: false }, lastSuccess: latest }, now).tone, 'danger');
  assert.equal(helpers.databaseHealth({ latest: { ...latest, completed_at: new Date(now - 7200001).toISOString() } }, now).tone, 'warning');
});
test('file status detects disabled, failed, overdue, wake errors and processing', () => {
  assert.equal(helpers.filesHealth(null).tone, 'warning');
  assert.equal(helpers.filesHealth({ enabled: false }).tone, 'danger');
  for (const key of ['failed', 'overdue', 'wakeError']) assert.equal(helpers.filesHealth({ enabled: true, [key]: 1 }).tone, 'danger');
  assert.equal(helpers.filesHealth({ enabled: true, pending: 1 }).tone, 'warning');
  assert.equal(helpers.filesHealth({ enabled: true, succeeded: 44 }).tone, 'success');
});
test('runner sends only sanitized Hourly receipts', () => {
  const result = { mode: 'Hourly', runId: '20260927T155738Z-352803da', startedAt: '2026-09-27T15:57:38Z', completedAt: '2026-09-27T15:57:54Z', ok: true,
    components: [{ component: 'application-database-core', file: 'private-name.dump.age', bytes: 1000, copyVerified: true }], failureComponent: 'DO_NOT_EXPOSE', dropboxFolder: 'PRIVATE' };
  const receipt = helpers.sanitizeRunResult(result);
  assert.deepEqual(Object.keys(receipt).sort(), ['bytes','completed_at','copy_verified','ok','run_id','started_at']);
  assert.equal(JSON.stringify(receipt).includes('PRIVATE'), false);
  assert.throws(() => helpers.sanitizeRunResult({ ...result, mode: 'Full' }));
  assert.throws(() => helpers.sanitizeRunResult({ ...result, components: [] }));
});

for (const scenario of ['missing', 'invalid', 'aal1', 'wrong-workspace', 'member', 'owner', 'database-error']) test(`status API access: ${scenario}`, async () => {
  let adminCalled = false;
  const token = `a.${Buffer.from(JSON.stringify({ aal: scenario === 'aal1' ? 'aal1' : 'aal2' })).toString('base64url')}.c`;
  const membership = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { role: scenario === 'member' ? 'member' : 'owner' } }; } };
  const { GET } = load('app/api/backups/status/route.js', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, ...options }) } },
    '../../../../lib/backup-status.mjs': helpers,
    '../../../../lib/server-supabase': {
      createUserSupabase: () => ({ auth: { getUser: async () => scenario === 'invalid' ? { error: true } : { data: { user: { id: 'u' } } } }, from: () => membership }),
      createAdminSupabase: () => { adminCalled = true; return { rpc: async () => scenario === 'database-error' ? { error: true } : { data: { files: { succeeded: 44 } } } }; },
    },
  });
  const response = await GET({ headers: new Headers(scenario === 'missing' ? {} : { authorization: `Bearer ${token}` }), nextUrl: new URL(`https://test/api?workspaceId=${scenario === 'wrong-workspace' ? 'different' : helpers.BACKUP_WORKSPACE}`) });
  assert.equal(response.status, ['missing','invalid'].includes(scenario) ? 401 : ['aal1','wrong-workspace','member'].includes(scenario) ? 403 : scenario === 'database-error' ? 503 : 200);
  assert.equal(adminCalled, ['owner','database-error'].includes(scenario));
  assert.match(response.headers['Cache-Control'], /no-store/);
});

test('edge reporting rejects unauthenticated, excessive and malformed payloads', async () => {
  let handler; let calls = 0;
  const previousDeno = global.Deno, previousFetch = global.fetch;
  const secret = 'a'.repeat(64);
  global.Deno = { env: { get: name => name === 'BACKUP_REPORT_TOKEN' ? secret : 'test' }, serve: value => { handler = value; } };
  global.fetch = async () => { calls++; return new Response(null, { status: 201 }); };
  try {
    load('supabase/functions/horeca-backup-report/index.ts');
    assert.equal((await handler(new Request('https://test', { method: 'POST', body: '{}' }))).status, 401);
    const send = body => handler(new Request('https://test', { method: 'POST', headers: { 'x-backup-report-token': secret }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
    assert.equal((await send('x'.repeat(3000))).status, 413);
    assert.equal((await send({ secret: 'bad' })).status, 400);
    const valid = { run_id: '20260927T155738Z-352803da', started_at: '2026-09-27T15:57:38Z', completed_at: '2026-09-27T15:57:54Z', ok: true, copy_verified: true, bytes: 1000 };
    assert.equal((await send({ ...valid, copy_verified: false })).status, 400);
    assert.equal((await send({ ...valid, path: 'private' })).status, 400);
    assert.equal((await send(valid)).status, 200);
    assert.equal(calls, 1);
  } finally { global.Deno = previousDeno; global.fetch = previousFetch; }
});

test('UI presents real counts, coverage and unconfirmed cloud status; refresh failure removes old green status', async () => {
  const React = require('react'), Renderer = require('react-test-renderer');
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const previousFetch = global.fetch;
  let fail = false, tree;
  global.fetch = async () => ({ ok: !fail, json: async () => fail ? { error: 'Offline' } : {
    checkedAt: new Date().toISOString(), database: { latest: { ok: true, copy_verified: true, completed_at: new Date().toISOString() }, lastSuccess: { bytes: 1000, completed_at: new Date().toISOString() }, recent: [] },
    files: { enabled: true, succeeded: 44, pending: 0, processing: 0, failed: 0, overdue: 0, wakeError: false },
  } });
  const { default: Component } = load('components/backup-overview.js', {
    '../lib/supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'mock' } } }) } } },
    '../lib/backup-status.mjs': helpers,
    './backup-overview.module.css': { default: new Proxy({}, { get: (_, key) => key }) },
  });
  try {
    await Renderer.act(async () => { tree = Renderer.create(React.createElement(Component, { workspaceId: helpers.BACKUP_WORKSPACE })); });
    const content = JSON.stringify(tree.toJSON());
    assert.match(content, /44/); assert.match(content, /Niet automatisch bevestigd/); assert.match(content, /Niet inbegrepen/);
    fail = true;
    await Renderer.act(async () => tree.root.findByType('button').props.onClick());
    const failed = JSON.stringify(tree.toJSON());
    assert.match(failed, /Offline/); assert.doesNotMatch(failed, /Lokale kopie gecontroleerd/);
  } finally { if (tree) await Renderer.act(async () => tree.unmount()); global.fetch = previousFetch; }
});

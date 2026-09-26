const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const swc = require('next/dist/build/swc');
const React = require('react');
const Renderer = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const root = path.resolve(__dirname, '..');
async function load(file, mocks = {}) {
  await swc.loadBindings();
  const cache = new Map();
  function compile(f) {
    if (cache.has(f)) return cache.get(f);
    const { code } = swc.transformSync(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } });
    const m = { exports: {} };
    vm.runInThisContext('(function(require,module,exports){' + code + '\n})')(name => mocks[name] || (name.endsWith('.css') ? { __esModule: true, default: new Proxy({}, { get: (_, k) => k }) } : name.startsWith('.') ? compile(path.join(path.dirname(f), name) + '.js') : require(name)), m, m.exports);
    cache.set(f, m.exports); return m.exports;
  }
  return compile(file);
}
const ids = { w: '10000000-0000-4000-8000-000000000001', b: '10000000-0000-4000-8000-000000000002', g: '10000000-0000-4000-8000-000000000003', q: '10000000-0000-4000-8000-000000000004' };
const guest = { id: ids.g, name: 'Testgast', email: 'test@example.invalid', company: '', phone: '', address: '', notes: 'Niet voor gast zichtbaar' };
const line = (label, price, quantity = 1, unit = 'fixed', hours = 1) => ({ label, price, quantity, unit, hours, pending: false });
const content = () => ({ title: 'Testbijeenkomst', eventDate: '2026-10-03', validUntil: '2026-09-30', guestCount: 150, location: 'Testlocatie', introduction: '', terms: '', program: [{ time: '01:00', nextDay: true, description: 'Einde' }], lines: [line('Drank', '48', 150, 'person'), line('Geluid', '375'), line('DJ', '100', 1, 'hour', 3), line('Beveiliging', '50', 2, 'hour', 6)] });
function clientMock(responses) {
  const calls = [];
  return { calls, from(table) {
    const call = { table, filters: [], method: 'read' }; calls.push(call);
    const q = { select(fields) { call.fields = fields; return q; }, eq(k, v) { call.filters.push([k, v]); return q; }, ilike(k, v) { call.search = [k, v]; return q; }, order() { return q; }, range() { return q; }, limit() { return q; }, update(values) { call.method = 'update'; call.values = values; return q; }, insert(values) { call.method = 'insert'; call.values = values; return q; }, maybeSingle() { return q; }, single() { return q; }, then(resolve, reject) { return Promise.resolve(responses.shift()).then(resolve, reject); } }; return q;
  } };
}
test('reference budget is 8475 incl VAT, unknown posts are explicitly excluded and zero remains included', async () => {
  const { validateQuote } = await load('lib/quotes.js');
  const c = content(); c.lines.push({ ...line('Nacalculatie', '', 1), pending: true }, line('Zaal inbegrepen', '0'));
  const result = validateQuote(c);
  assert.equal(result.knownTotalCents, 847500); assert.equal(result.pendingCount, 1); assert.equal(result.lines[4].totalCents, null); assert.equal(result.lines[5].totalCents, 0); assert.equal(result.priceBasis, 'incl_vat'); assert.equal(result.program[0].nextDay, true);
});
test('money uses integer cents, decimal quantities are rejected, fractional hours rounded per line', async () => {
  const { moneyCents, validateQuote } = await load('lib/quotes.js');
  assert.equal(moneyCents('48,50'), 4850); assert.equal(moneyCents('0.29'), 29);
  for (const invalid of ['1e3', '-5', '1.000,00', '1,234', '', Infinity]) assert.throws(() => moneyCents(invalid));
  const c = content(); c.lines = [line('Uren', '19.99', 1, 'hour', '1,25')]; assert.equal(validateQuote(c).knownTotalCents, 2499);
  c.lines[0].quantity = 1.5; assert.throws(() => validateQuote(c));
});
test('invalid dates, oversized amounts, non-text values and empty required fields fail', async () => {
  const { validateQuote, validateGuest, uuid } = await load('lib/quotes.js');
  for (const patch of [{ eventDate: '2026-02-30' }, { title: '' }, { guestCount: false }, { lines: [] }, { program: [{ time: '25:00', description: 'x' }] }, { lines: [line('Huge', '9999999', 100000)] }]) assert.throws(() => validateQuote({ ...content(), ...patch }));
  assert.throws(() => validateGuest({ name: 'Test', email: 'not-email' })); assert.throws(() => uuid('../test'));
});
test('guest snapshot excludes internal notes and all client-injected fields', async () => {
  const { guestSnapshot, validateQuote } = await load('lib/quotes.js');
  assert.equal(guestSnapshot(guest).notes, undefined); assert.equal(guestSnapshot(guest).id, undefined);
  const result = validateQuote({ ...content(), knownTotalCents: 1, status: 'sent' }); assert.equal(result.knownTotalCents, 847500); assert.equal(result.status, undefined);
});
test('create scopes guest and business, recalculates totals and never calls external services', async () => {
  const { quoteAction } = await load('lib/quote-service.js');
  const client = clientMock([{ data: null }, { data: { id: ids.b } }, { data: guest }, { data: { id: ids.q, version: 1 } }]);
  await quoteAction(client, { action: 'save_quote', workspaceId: ids.w, businessId: ids.b, guestId: ids.g, id: ids.q, version: null, content: { ...content(), knownTotalCents: 1 } });
  assert.equal(client.calls[3].values.content.knownTotalCents, 847500); assert.equal(client.calls[3].values.guest_snapshot.notes, undefined);
  for (const call of client.calls.slice(0, 3)) assert.deepEqual(call.filters[0], ['workspace_id', ids.w]);
});
test('editing quote keeps original guest snapshot and uses compare-and-swap', async () => {
  const { quoteAction } = await load('lib/quote-service.js'); const original = { name: 'Oude naam' };
  const client = clientMock([{ data: { version: 3, guest_id: ids.g, guest_snapshot: original } }, { data: { id: ids.b } }, { data: guest }, { data: { id: ids.q, version: 4 } }]);
  await quoteAction(client, { action: 'save_quote', workspaceId: ids.w, businessId: ids.b, guestId: ids.g, id: ids.q, version: 3, content: content() });
  assert.deepEqual(client.calls[3].values.guest_snapshot, original); assert.deepEqual(client.calls[3].filters, [['workspace_id', ids.w], ['id', ids.q], ['version', 3]]);
});
test('cross-workspace guest, stale revision, lost response and missing migration never produce false success', async () => {
  const { quoteAction } = await load('lib/quote-service.js');
  const input = { action: 'save_quote', workspaceId: ids.w, businessId: ids.b, guestId: ids.g, id: ids.q, version: null, content: content() };
  await assert.rejects(quoteAction(clientMock([{ data: null }, { data: { id: ids.b } }, { data: null }]), input), /organisatie/);
  await assert.rejects(quoteAction(clientMock([{ data: { version: 1 } }]), input), /al opgeslagen/);
  await assert.rejects(quoteAction(clientMock([{ error: { code: '42P01' } }]), input), e => e.status === 503);
  const update = clientMock([{ data: { version: 1 } }, { data: null }]);
  await assert.rejects(quoteAction(update, { action: 'save_guest', workspaceId: ids.w, id: ids.g, version: 1, guest }), e => e.status === 409);
});
test('list pagination is tenant scoped and literal search wildcards are escaped', async () => {
  const { quoteAction } = await load('lib/quote-service.js'); const client = clientMock([{ data: Array.from({ length: 31 }, (_, i) => ({ id: i })) }]);
  const result = await quoteAction(client, { action: 'list', workspaceId: ids.w, search: '20%_', page: 0 });
  assert.equal(result.hasMore, true); assert.equal(result.rows.length, 30); assert.match(client.calls[0].fields, /guest_id/); assert.deepEqual(client.calls[0].search, ['content->>title', '%20\\%\\_%']);
});
test('API denies anonymous, unverified, low-assurance and non-owner requests', async () => {
  let serviceCalls = 0;
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) }, from() { const q = { select() { return q; }, eq() { return q; }, maybeSingle: async () => ({ data: { role: 'staff' } }) }; return q; } };
  const { POST } = await load('app/api/quotes/route.js', { '../../../lib/server-supabase': { createUserSupabase: () => client }, '../../../lib/quote-service': { quoteAction: () => { serviceCalls++; } } });
  const req = aal => new Request('https://example.invalid/api/quotes', { method: 'POST', headers: aal ? { Authorization: `Bearer x.${Buffer.from(JSON.stringify({ aal })).toString('base64url')}.x` } : {}, body: JSON.stringify({ workspaceId: ids.w, action: 'list' }) });
  assert.equal((await POST(req())).status, 401); assert.equal((await POST(req('aal1'))).status, 403); assert.equal((await POST(req('aal2'))).status, 403);
  client.auth.getUser = async () => ({ error: { message: 'invalid' } }); assert.equal((await POST(req('aal2'))).status, 401); assert.equal(serviceCalls, 0);
});
test('guest UI preserves failed input, blocks double save and hides private notes in quote preview', async () => {
  const previousWindow = global.window, previousDocument = global.document;
  global.window = { addEventListener() {}, removeEventListener() {}, confirm: () => true };
  global.document = { addEventListener() {}, removeEventListener() {} };
  const C = (await load('components/quotes.js')).default;
  let tree, saveCalls = 0, resolve;
  const request = async input => { if (input.action === 'list') return { rows: [], hasMore: false }; saveCalls++; if (saveCalls === 1) throw Error('Test opslagfout'); return new Promise(done => { resolve = () => done({ row: { ...guest, id: input.id, version: 1 } }); }); };
  const button = name => tree.root.findAllByType('button').find(b => b.props.children === name);
  try {
    await Renderer.act(async () => { tree = Renderer.create(React.createElement(C, { workspaceId: ids.w, businesses: [{ id: ids.b, name: 'Testvestiging' }], request })); });
    await Renderer.act(async () => button('Nieuwe offerte').props.onClick());
    await Renderer.act(async () => button('Gasten').props.onClick());
    await Renderer.act(async () => button('Nieuwe gast').props.onClick());
    const name = () => tree.root.findAllByType('input').find(i => i.props.required);
    await Renderer.act(async () => name().props.onChange({ target: { value: 'Mijn gast' } }));
    await Renderer.act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.equal(name().props.value, 'Mijn gast'); assert.match(JSON.stringify(tree.toJSON()), /Test opslagfout/);
    await Renderer.act(async () => { tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    assert.equal(saveCalls, 2); await Renderer.act(async () => resolve());
    await Renderer.act(async () => button('Deze gast gebruiken in offerte').props.onClick());
    assert.match(JSON.stringify(tree.toJSON()), /Testgast/); assert.doesNotMatch(JSON.stringify(tree.toJSON()), /Niet voor gast zichtbaar/);
  } finally { if (tree) await Renderer.act(async () => tree.unmount()); global.window = previousWindow; global.document = previousDocument; }
});
test('quote UI opens saved guest selection, saves a new version and shows preview and history', async () => {
  const previousWindow = global.window, previousDocument = global.document;
  global.window = { addEventListener() {}, removeEventListener() {}, confirm: () => true };
  global.document = { addEventListener() {}, removeEventListener() {} };
  const { validateQuote, guestSnapshot } = await load('lib/quotes.js');
  let record = { id: ids.q, business_id: ids.b, guest_id: ids.g, guest_snapshot: guestSnapshot(guest), content: validateQuote(content()), version: 1, quote_number: 12 };
  let tree, saves = 0;
  const request = async input => {
    if (input.action === 'list') return { rows: input.entity === 'guests' ? [guest] : [record], hasMore: false };
    if (input.action === 'history') return { rows: [{ version: record.version, snapshot: record, saved_at: '2026-09-26T12:00:00Z' }] };
    assert.equal(input.guestId, ids.g); assert.equal(input.version, 1); saves++;
    record = { ...record, version: 2, content: validateQuote(input.content) }; return { row: record };
  };
  const C = (await load('components/quotes.js')).default;
  const button = name => tree.root.findAllByType('button').find(b => b.props.children === name);
  try {
    await Renderer.act(async () => { tree = Renderer.create(React.createElement(C, { workspaceId: ids.w, businesses: [{ id: ids.b, name: 'Testvestiging' }], request })); });
    await Renderer.act(async () => new Promise(done => setTimeout(done, 250)));
    await Renderer.act(async () => button('Openen').props.onClick());
    assert.equal(tree.root.findAllByType('select').some(s => s.props.value === ids.g), true);
    await Renderer.act(async () => tree.root.findAllByType('input').find(i => i.props.value === 'Testbijeenkomst').props.onChange({ target: { value: 'Gewijzigde bijeenkomst' } }));
    await Renderer.act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.equal(saves, 1); assert.match(JSON.stringify(tree.toJSON()), /versie 2/);
    await Renderer.act(async () => button('Offertevoorbeeld bekijken').props.onClick());
    assert.equal(tree.root.findAllByProps({ 'aria-label': 'Offertevoorbeeld' }).length, 1);
    await Renderer.act(async () => button('Bewaarde versies bekijken').props.onClick());
    await Renderer.act(async () => button('Deze versie bekijken').props.onClick());
    assert.equal(tree.root.findAllByProps({ 'aria-label': 'Offertevoorbeeld' }).length, 2);
    assert.doesNotMatch(JSON.stringify(tree.toJSON()), /Niet voor gast zichtbaar/);
  } finally { if (tree) await Renderer.act(async () => tree.unmount()); global.window = previousWindow; global.document = previousDocument; }
});

test('switching guest and quote lists never renders rows from the other entity, including after editing', async () => {
  const { validateQuote, guestSnapshot } = await load('lib/quotes.js');
  const record = { id: ids.q, business_id: ids.b, guest_id: ids.g, guest_snapshot: guestSnapshot(guest), content: validateQuote(content()), version: 1, quote_number: 12 };
  const C = (await load('components/quotes.js')).default;
  const businesses = [{ id: ids.b, name: 'Testvestiging' }];
  const request = async input => ({ rows: input.entity === 'guests' ? [guest] : [record], hasMore: false });
  let tree;
  const click = async name => Renderer.act(async () => tree.root.findAllByType('button').find(b => b.props.children === name).props.onClick());
  const settle = async () => Renderer.act(async () => new Promise(done => setTimeout(done, 250)));
  try {
    await Renderer.act(async () => { tree = Renderer.create(React.createElement(C, { workspaceId: ids.w, businesses, request })); });
    await settle();
    await click('Gasten'); await settle();
    assert.match(JSON.stringify(tree.toJSON()), /Testgast/);
    await click('Offertes'); await settle();
    assert.match(JSON.stringify(tree.toJSON()), /Testbijeenkomst/);
    await click('Gasten'); await settle();
    await click('Nieuwe offerte');
    await click('Offertes'); await settle();
    assert.match(JSON.stringify(tree.toJSON()), /Testbijeenkomst/);
    // Clicking the already selected list must not leave an endless loading state.
    await click('Offertes'); await settle();
    assert.match(JSON.stringify(tree.toJSON()), /Testbijeenkomst/);
    assert.doesNotMatch(JSON.stringify(tree.toJSON()), /Overzicht laden/);
  } finally { if (tree) await Renderer.act(async () => tree.unmount()); }
});

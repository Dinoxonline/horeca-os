const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const postcss = require('postcss');
const swc = require('next/dist/build/swc');
const root = path.resolve(__dirname, '..');
const css = postcss.parse(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'));
function value(selector, property) {
  let result;
  css.walkRules(rule => {
    if (rule.selector.split(',').map(s => s.trim()).includes(selector)) {
      rule.walkDecls(property, declaration => { result = declaration.value; });
    }
  });
  return result;
}

test('connection layout reserves button height, separates venues and wraps at narrow widths', () => {
  assert.equal(value('.adAccountCard', 'display'), 'flex');
  assert.equal(value('.adAccountCard', 'flex-direction'), 'column');
  assert.equal(value('.adAccountCard', 'gap'), '12px');
  assert.equal(value('.adAccountCard .secondaryButton', 'display'), 'inline-flex');
  assert.equal(value('.adAccountCard .secondaryButton', 'min-height'), '44px');
  assert.equal(value('.adAccountGrid', 'gap'), '16px');
  assert.equal(value('.integrationsPage button:disabled', 'cursor'), 'not-allowed');
  assert.equal(value('.integrationsPage .connectionRow', 'flex-wrap'), 'wrap');
  const narrow = css.nodes.find(node => node.type === 'atrule' && node.params === '(max-width: 1100px)' && node.toString().includes('.adAccountGrid'));
  assert.match(narrow.toString(), /grid-template-columns: minmax\(0, 1fr\)/);
});

test('quick navigation targets existing provider sections and refresh has a timeout', () => {
  const app = fs.readFileSync(path.join(root, 'components/horeca-os-app.js'), 'utf8');
  const settings = app.slice(app.indexOf('function RobuustIntegrationSettings'), app.indexOf('function UsersAdmin'));
  const whatsapp = fs.readFileSync(path.join(root, 'components/whatsapp-business-connection.js'), 'utf8');
  const links = [...settings.matchAll(/href="#([^"]+)"/g)];
  assert.equal(links.length, 7);
  links.forEach(([, id]) => assert.ok((settings + whatsapp).includes(`id="${id}"`), id));
  assert.match(settings, /className="integrationsPage"/);
  assert.equal((settings.match(/AbortSignal.timeout\(20000\)/g) || []).length, 5);
});

test('both connected venues render separate cards with headings and working navigation links', async () => {
  await swc.loadBindings();
  const file = 'components/facebook-ad-account-picker.js';
  const { code } = swc.transformSync(fs.readFileSync(path.join(root, file), 'utf8'), {
    filename: file, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})')(require, module, module.exports);
  const React = require('react'), Renderer = require('react-test-renderer');
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  try {
    await React.act(async () => { renderer = Renderer.create(React.createElement('div', {}, ['Caribbean Corner', 'Grandcafé Het Plein'].map(name => React.createElement(module.exports.default, {
      key: name, businessName: name, account: { connection_status: 'connected', display_name: 'Le Club BBQ Restaurant' },
    })))); });
    assert.equal(renderer.root.findAllByProps({ className: 'adAccountCard' }).length, 2);
    assert.deepEqual(renderer.root.findAllByType('h3').map(n => n.props.children), ['Caribbean Corner', 'Grandcafé Het Plein']);
    assert.deepEqual(renderer.root.findAllByType('a').map(n => n.props.href), ['/marketing', '/marketing']);
  } finally { if (renderer) await React.act(async () => renderer.unmount()); }
});

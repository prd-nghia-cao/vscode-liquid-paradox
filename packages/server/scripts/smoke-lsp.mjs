/**
 * Post-build smoke test: drives the *minified* `dist/server.cjs` over a real
 * LSP session, exactly as `vscode-languageclient` does (fork + node-ipc).
 *
 * Unit tests import unminified TypeScript, so they cannot catch damage that
 * only the production bundle exhibits. This script exists because such a bug
 * shipped: `tokenize` branched on `t.constructor.name === 'TagToken'`, which
 * minification renames, so every Liquid token became an `html` token and props,
 * scope, and diagnostics silently died in the published extension while all
 * 200+ unit tests passed.
 */
import { fork } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(here, '../dist/server.cjs');
const ROOT = resolve(here, '../../../fixtures/career-site-mini');
const DOC = `${ROOT}/src/pages/home.liquid`;
const DOC_URI = `file://${DOC}`;
const SIDECAR_URI = `file://${ROOT}/src/pages/home.liquid.json`;

const TEXT = [
  '{% layout "main" %}',
  '<h1>{{ title }}</h1>',
  '{% render "button",  %}',
  '<section ></section>',
  '<img src="">',
  '<video src=""></video>',
  `{% render 'button', text: 'a group-odd:left-2 group-even:right-2 b', type: 'primary' %}`,
  '',
].join('\n');

const child = fork(SERVER, ['--node-ipc'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
const serverErrors = [];
child.stderr.on('data', (d) => serverErrors.push(String(d)));

let nextId = 0;
const pending = new Map();
const logs = [];
const diagnostics = [];
child.on('message', (msg) => {
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'client/registerCapability') {
    child.send({ jsonrpc: '2.0', id: msg.id, result: null });
  } else if (msg.method === 'window/logMessage') {
    logs.push(msg.params.message);
  } else if (msg.method === 'textDocument/publishDiagnostics') {
    diagnostics.push(...msg.params.diagnostics.map((d) => ({ ...d, uri: msg.params.uri })));
  }
});

const request = (method, params) =>
  new Promise((res) => {
    const id = ++nextId;
    pending.set(id, res);
    child.send({ jsonrpc: '2.0', id, method, params });
  });
const notify = (method, params) => child.send({ jsonrpc: '2.0', method, params });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
const check = (name, ok, detail) => {
  if (ok) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
};

const itemsAt = async (line, character, uri = DOC_URI) => {
  const res = await request('textDocument/completion', {
    textDocument: { uri },
    position: { line, character },
    context: { triggerKind: 1 },
  });
  return Array.isArray(res.result) ? res.result : (res.result?.items ?? []);
};
const labelsAt = async (line, character) => (await itemsAt(line, character)).map((i) => i.label);

console.log(`smoke: ${SERVER}`);
await request('initialize', {
  processId: process.pid,
  rootUri: `file://${ROOT}`,
  workspaceFolders: [{ uri: `file://${ROOT}`, name: 'fixture' }],
  capabilities: {},
});
notify('initialized', {});
await sleep(800);

notify('textDocument/didOpen', {
  textDocument: { uri: DOC_URI, languageId: 'liquid', version: 1, text: TEXT },
});
await sleep(300);

check(
  'workspace index resolved from vite config',
  logs.some((l) => /indexed [1-9]\d* component/.test(l)),
  logs.filter((l) => l.startsWith('[config]')).join(' ') || 'no [config] log',
);

// Render-arg props. Depends on the whole chain: tokenize -> AST -> prop block
// extraction -> file index. This is what the constructor.name bug broke.
const props = await labelsAt(2, TEXT.split('\n')[2].indexOf(',') + 2);
check('render-arg props offered', props.includes('type') && props.includes('text'), `got [${props}]`);

// Tag names inside `{% %}` — pure cursor-bucket logic, works even with a broken
// tokenizer, so it is the control case that made the bug hard to spot.
const tags = await labelsAt(0, 3);
check('tag names offered', tags.includes('render') && tags.includes('if'), `got ${tags.length} items`);

// Output-region completions (`<h1>{{ | title }}`) — the analyzer produced a
// real AST rather than one undifferentiated html token.
const vars = await labelsAt(1, '<h1>{{ '.length);
check('output-region completions offered', vars.length > 0, `got ${vars.length} items`);

// HTML region completions require liquidSpans() to have found the Liquid spans,
// which also depends on the tokenizer.
const attrs = await labelsAt(3, '<section '.length);
check('html attribute completions offered', attrs.includes('class'), `got ${attrs.length}: ${attrs.slice(0, 8)}`);

// Asset completions inside `src` values: needs the assets dir resolved from
// staticAssetsPlugin(), the asset index built, and the HTML scanner to place
// the cursor inside an attribute value of the masked virtual document.
const imgItems = await itemsAt(4, '<img src="'.length);
const imgLabels = imgItems.map((i) => i.label).sort();
check('img src offers images only', imgLabels.join(',') === '/hero.png,/img/team.webp', `got [${imgLabels}]`);
check(
  'asset item replaces the value via textEdit',
  imgItems[0]?.textEdit?.range?.start?.character === '<img src="'.length,
  JSON.stringify(imgItems[0]?.textEdit ?? null),
);

const videoLabels = await labelsAt(5, '<video src="'.length);
check('video src offers videos only', videoLabels.join(',') === '/video/reel.mp4', `got [${videoLabels}]`);

// Colons inside a prop value (Tailwind variants) must not be read as prop names.
await sleep(400);
const unknownProps = diagnostics.filter((d) => /Unknown prop/i.test(d.message));
check(
  'no Unknown prop for colons inside a prop value',
  unknownProps.length === 0,
  unknownProps.map((d) => d.message).join('; '),
);

// `.liquid.json` sidecars: media keys offer assets, other keys stay quiet, and
// the Liquid analyzer never sees the JSON text.
const sidecarText = readFileSync(new URL(SIDECAR_URI).pathname, 'utf8');
notify('textDocument/didOpen', {
  textDocument: { uri: SIDECAR_URI, languageId: 'json', version: 1, text: sidecarText },
});
await sleep(300);

const sidecarLines = sidecarText.split('\n');
const valueColumn = (lineNo) => sidecarLines[lineNo].indexOf(':') + 3;
const lineOf = (needle) => sidecarLines.findIndex((l) => l.includes(needle));

const jsonImageLine = lineOf('"src": ""');
const jsonImages = (await itemsAt(jsonImageLine, valueColumn(jsonImageLine), SIDECAR_URI)).map((i) => i.label).sort();
check(
  'sidecar image.src offers images only',
  jsonImages.join(',') === '/hero.png,/img/team.webp',
  `got [${jsonImages}]`,
);

const jsonVideoLine = sidecarLines.findIndex((l, i) => i > jsonImageLine && l.includes('"src": ""'));
const jsonVideos = (await itemsAt(jsonVideoLine, valueColumn(jsonVideoLine), SIDECAR_URI)).map((i) => i.label);
check('sidecar video.src offers videos only', jsonVideos.join(',') === '/video/reel.mp4', `got [${jsonVideos}]`);

const altLine = lineOf('"alt"');
const jsonAlt = await itemsAt(altLine, valueColumn(altLine) + 2, SIDECAR_URI);
check('sidecar non-media key offers nothing', jsonAlt.length === 0, `got ${jsonAlt.length} items`);

await sleep(400);
const sidecarDiags = diagnostics.filter((d) => d.uri === SIDECAR_URI);
check('sidecar gets no Liquid diagnostics', sidecarDiags.length === 0, sidecarDiags.map((d) => d.message).join('; '));

child.kill();

if (serverErrors.length) {
  console.log('server stderr:\n' + serverErrors.join(''));
}
if (failures.length) {
  console.error(`\nsmoke FAILED: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('smoke passed');

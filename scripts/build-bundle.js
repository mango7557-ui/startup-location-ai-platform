'use strict';
// Static build contains ONLY explicit demo data and a scoped CommonJS loader.
// Server API clients, secrets, authentication and network shims are never bundled.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const modules = {
  regions: ['server/data/koreaRegionsFull.js', {}],
  store: ['server/data/publicDatasetStore.js', { './koreaRegionsFull': 'regions' }],
  engine: ['server/services/recommendationEngine.js', { '../data/publicDatasetStore': 'store' }],
  demo: ['server/services/demoAnalysis.js', { './recommendationEngine': 'engine', '../data/publicDatasetStore': 'store' }]
};
const { CATALOG } = require('../server/services/externalApiConnectors');
const factories = Object.entries(modules).map(([id, [file, deps]]) => `${JSON.stringify(id)}:[function(require,module,exports){\n${read(file)}\n},${JSON.stringify(deps)}]`).join(',\n');
const bootstrap = `window.APP_STATIC=true;window.APP_DEMO=(()=>{const modules={${factories}};const cache={};function load(id){if(cache[id])return cache[id].exports;const [factory,deps]=modules[id];const module={exports:{}};cache[id]=module;factory(name=>load(deps[name]),module,module.exports);return module.exports;}const s=load('store');return {meta:{industries:s.INDUSTRY_CODES,regions:s.REGIONS_TREE},providers:${JSON.stringify(CATALOG)},analyze:load('demo').demoAnalysis};})();`;
new vm.Script(bootstrap);
new vm.Script(read('public/app.js'));
const bundle = read('public/index.html')
  .replace('<link rel="stylesheet" href="/styles.css">', () => `<style>${read('public/styles.css')}</style>`)
  .replace('<script src="/app.js"></script>', () => `<script>${(bootstrap + '\n' + read('public/app.js')).replace(/<\/script/gi, '<\\/script')}</script>`);
fs.mkdirSync(path.join(ROOT, 'dist', 'firebase'), { recursive: true });
for (const file of ['index.html', 'public/preview.html', 'dist/firebase/index.html']) fs.writeFileSync(path.join(ROOT, file), bundle);
console.log('Static demo built: index.html, public/preview.html, dist/firebase/index.html. Server connectors excluded; scripts syntax checked.');

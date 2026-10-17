const fs = require('fs');
const content = fs.readFileSync('js/views/sa/my-requests.js', 'utf8');

// Find returned keys in setup
const returnMatch = content.match(/return\s*\{([\s\S]*?)\};\s*\},/);
if (!returnMatch) {
  console.log('No return match');
  process.exit(1);
}
const returnKeys = returnMatch[1].split('\n').map(s => s.trim().replace(/,$/, '').split(':')[0].trim()).filter(Boolean);
console.log('Returned keys count:', returnKeys.length);

// Find template
const templateMatch = content.match(/template:\s*`([\s\S]*?)`\s*\}\s*;/);
const tpl = templateMatch ? templateMatch[1] : '';

// Find potential identifiers in template: e.g. v-if, v-for, :..., @...
const regex = /(?:v-if|v-else-if|v-show|v-model|:|@)[a-zA-Z0-9_\-\.]+=\"([^\"]+)\"/g;
let m;
const missing = new Set();
while ((m = regex.exec(tpl)) !== null) {
  const expr = m[1];
  const idents = expr.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) || [];
  for (const id of idents) {
    if (['true', 'false', 'null', 'undefined', 'event', 'idx', 'row', 'req', 'item', 'c', 'h', 'f', 'code', 'dept', 'opt', 'Math', 'Number', 'String', 'Array', 'Boolean', 'window', 'document', 'form', 'saContext', 'Store', 'Format'].includes(id)) continue;
    if (!returnKeys.includes(id)) {
      missing.add(id);
    }
  }
}
console.log('Missing template identifiers:', Array.from(missing));


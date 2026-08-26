import postcss from 'postcss';
import tw from '@tailwindcss/postcss';
import fs from 'node:fs';
const root = '/Users/shofiqulislam/9router-master';
const css = fs.readFileSync(root + '/src/app/globals.css', 'utf8');
const res = await postcss([tw({ base: root })]).process(css, { from: root + '/src/app/globals.css' });
fs.writeFileSync('/private/tmp/claude-501/-Users-shofiqulislam-9router-master/bfb33ded-1be5-48b6-a77a-2cadf8ec81f8/scratchpad/out.css', res.css);
console.log('bytes', res.css.length);

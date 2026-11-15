import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = (name) => readFile(path.join(root, 'src', name), 'utf8');
const [shell, css, importCSS, sceneCSS, vendor, presetData, presetImage, ...scripts] = await Promise.all([
  source('shell.html'), source('style.css'), source('import-ui.css'), Promise.all(['scene3d.css','original-map.css'].map(source)).then(parts=>parts.join('\n')),
  readFile(path.join(root,'vendor/three.cjs'),'utf8'),readFile(path.join(root,'data/tsinghua-plan.json'),'utf8'),readFile(path.join(root,'examples/校园道路绿植识别底图.png')),
  source('thermal.js'), source('engine.js'), source('campus-import.js'), source('campus-preset.js'), source('walkway-recognition.js'), source('vegetation-recognition.js'), source('geocoding.js'), source('i18n.js'), source('sidebar.js'), source('audit-chart.js'), source('import-ui.js'), Promise.all(['preview-plan.js','original-map.js','scene3d-surfaces.js','scene3d-trees.js','scene3d-walk.js','scene3d.js'].map(source)).then(parts=>parts.join('\n')), source('app.js'),
]);
for (const marker of ['<!--STYLES-->', '<!--SCRIPTS-->']) {
  if (shell.split(marker).length !== 2) throw new Error(`Expected one ${marker} in src/shell.html`);
}
const safeCSS = (css+'\n'+importCSS+'\n'+sceneCSS).replace(/<\/style/gi, '<\\/style');
const workerSource=scripts[0]+'\n'+scripts[1]+'\nonmessage=event=>{try{const {campus,budget,settings}=event.data;postMessage({plan:ShadeEngine.optimize(campus,budget,settings)});}catch(error){postMessage({error:error.message});}};';
const prepared=scripts.map(script=>script.replace('__CAMPUS_PRESET_DATA__',()=>JSON.stringify(JSON.parse(presetData))).replace('__CAMPUS_PRESET_IMAGE__',()=>`data:image/png;base64,${presetImage.toString('base64')}`).replace('__SHADE_PLANNER_WORKER__',()=>JSON.stringify(workerSource)));
const safeJS = [`(function(){const exports={};\n${vendor}\nglobalThis.THREE=exports;})();`,...prepared].map((script) => script.replace(/<\/script/gi, '<\\/script'));
const html = shell
  .replace('<!--STYLES-->', () => `<style>\n${safeCSS}\n</style>`)
  .replace('<!--SCRIPTS-->', () => safeJS.map((script) => `<script>\n${script}\n</script>`).join('\n'));
const destinations = ['ShadePath-preview.html', 'preview/ShadePath-preview.html', 'dist/index.html'];
for (const destination of destinations) {
  const target = path.join(root, destination);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, html);
}
const sha256 = createHash('sha256').update(html).digest('hex');
console.log(`Built ${destinations.length} identical offline HTML files (${Buffer.byteLength(html)} bytes).`);
console.log(`SHA256 ${sha256}`);

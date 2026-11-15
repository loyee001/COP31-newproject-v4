/* Pure SVG Cartesian view of the model coordinates. No model or UI state changes. */
(() => {
  'use strict';
  const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  function render({campus, candidates = [], trees = [], selectionAudit = [], treeServices = [], selected = null, translate = key => key, format = (value, digits = 1) => Number(value).toFixed(digits)}) {
    const W = 780, H = 460, L = 62, R = 24, T = 24, B = 45;
    const width = campus.bounds.width, height = campus.bounds.height;
    if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) throw new RangeError('Coordinate plot requires positive finite campus bounds');
    const plotWidth = W - L - R, plotHeight = H - T - B;
    const x = value => L + value / width * plotWidth;
    const y = value => H - B - value / height * plotHeight;
    const t = key => escape(translate(key));
    const f = (value, digits = 1) => escape(format(value, digits));
    const validPoint = point => Number.isFinite(point.x) && Number.isFinite(point.y);
    const points = candidates.filter(validPoint), additions = trees.filter(validPoint);
    const existing = (campus.trees || []).filter(validPoint);
    const topology=globalThis.ShadeEngine.network(campus);
    const serviceById=new Map(treeServices.map(row=>[row.id,row.pathIds]));
    const servedPaths=tree=>serviceById.get(tree.id)||tree.servicePathIds||[];
    const sharedTrees=additions.filter(tree=>servedPaths(tree).length>1);
    const pathNames=new Map(topology.paths.map(path=>[path.id,path.name||path.id]));
    const ticksFor=maximum=>{
      const target=maximum/10,power=10**Math.floor(Math.log10(target)),fraction=target/power;
      const step=power*(fraction>=7?10:fraction>=3?5:fraction>=1.5?2:1);
      const count=Math.floor(maximum/step+1e-10),values=Array.from({length:count+1},(_,index)=>index*step);
      if(Math.abs(values.at(-1)-maximum)>step*.15)values.push(maximum);
      return {values,digits:Math.max(0,-Math.floor(Math.log10(step)))};
    };
    const xTicks=ticksFor(width),yTicks=ticksFor(height);
    const rows = Array.isArray(selectionAudit) ? selectionAudit : selectionAudit?.audit || [];
    const auditById = new Map(rows.map((row, index) => [row.id, {...row, order: index + 1}]));
    let out = `<div class="coordinate-plot"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="group" aria-label="x ${t('东')}, y ${t('北')}; ${t('候选点')} / ${t('新增树木')}">`;
    out += `<rect x="${L}" y="${T}" width="${plotWidth}" height="${plotHeight}" fill="#fbfcf7" stroke="#d7dfd4"/>`;
    for (const value of xTicks.values) {
      out += `<path d="M${x(value)} ${T}V${H-B}" stroke="#e1e7dc" stroke-width=".8"/><path d="M${x(value)} ${H-B}v5" stroke="#758673"/><text x="${x(value)}" y="${H-B+21}" text-anchor="middle" fill="#63765f" font-family="monospace" font-size="11">${f(value,xTicks.digits)}</text>`;
    }
    for (const value of yTicks.values) {
      out += `<path d="M${L} ${y(value)}H${W-R}" stroke="#e1e7dc" stroke-width=".8"/><path d="M${L} ${y(value)}h-5" stroke="#758673"/><text x="${L-11}" y="${y(value)+4}" text-anchor="end" fill="#63765f" font-family="monospace" font-size="11">${f(value,yTicks.digits)}</text>`;
    }
    for (const building of campus.buildings || []) {
      const polygon = building.polygon.filter(validPoint).map(point => `${x(point.x)},${y(point.y)}`).join(' ');
      out += `<polygon points="${polygon}" fill="#e3e7df" stroke="#c3ccbe" stroke-width="1"><title>${t('建筑')} · ${escape(building.id)}</title></polygon>`;
    }
    for(const segment of topology.segments){
      out+=`<path class="coordinate-route" data-segment-id="${escape(segment.id)}" d="M${x(segment.a.x)},${y(segment.a.y)}L${x(segment.b.x)},${y(segment.b.y)}" fill="none" stroke="#be923d" stroke-width="3" stroke-linejoin="round"><title>${t('步道')} · ${escape(segment.pathIds.map(id=>translate(pathNames.get(id)||id)).join(' / '))}</title></path>`;
    }
    for(const node of topology.intersections){
      out+=`<circle class="coordinate-junction" cx="${x(node.x)}" cy="${y(node.y)}" r="4.5" fill="#ffffff" stroke="#6b8da3" stroke-width="1.5"><title>${t('交叉口')} · ${f(node.pathIds.length,0)} ${t('步道')}</title></circle>`;
    }
    for (const point of points) out += `<circle class="candidate-coordinate" cx="${x(point.x)}" cy="${y(point.y)}" r="3.5" fill="#fbfcf7" stroke="#9ca89a" stroke-width="1.2"><title>${t('候选点')} (${f(point.x)}, ${f(point.y)}) ${t('米')}</title></circle>`;
    for (const tree of existing) {
      const px=x(tree.x), py=y(tree.y);
      out += `<path d="M${px-4} ${py}h8M${px} ${py-4}v8" fill="none" stroke="#879580" stroke-width="1.8"><title>${t('原有树')} (${f(tree.x)}, ${f(tree.y)}) ${t('米')}</title></path>`;
    }
    additions.forEach((tree,index) => {
      const row=auditById.get(tree.id),order=row?.order || index+1,px=x(tree.x),py=y(tree.y);
      const cost=Number.isFinite(tree.cost)?tree.cost:campus.treeTemplate?.cost;
      const pathIds=servedPaths(tree),shared=pathIds.length>1;
      const detail=[`${translate('新增树木')} ${order}`,`${translate('选择顺序')}: ${order}`,`x ${format(tree.x,1)} ${translate('米')}`,`y ${format(tree.y,1)} ${translate('米')}`];
      if(Number.isFinite(cost))detail.push(`$${format(cost,0)}`);
      if(Number.isFinite(row?.gain))detail.push(`${translate('边际收益')}: ${format(row.gain,5)} min`);
      if(shared)detail.push(`${translate('公共树')} · ${translate('步道')}: ${pathIds.map(id=>translate(pathNames.get(id)||id)).join(' / ')}`);
      const label=escape(detail.join(' · ')),active=selected===tree.id;
      out += `<g class="coordinate-tree${active?' selected':''}${shared?' shared-tree':''}" data-audit-tree="${escape(tree.id)}" data-x="${tree.x}" data-y="${tree.y}" data-service-count="${pathIds.length}" role="button" tabindex="0" aria-label="${label}"><title>${label}</title><circle class="coordinate-selection" cx="${px}" cy="${py}" r="15" fill="none" stroke="${active?'#b78924':'transparent'}" stroke-width="2.5"/>${shared?`<circle class="coordinate-shared" cx="${px}" cy="${py}" r="12" fill="none" stroke="#427aa1" stroke-width="2"/>`:''}<circle cx="${px}" cy="${py}" r="10" fill="#2d7550" stroke="#fffef7" stroke-width="1.5"/><text x="${px}" y="${py+.5}" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" font-size="10" font-family="monospace" font-weight="600" pointer-events="none">${order}</text></g>`;
    });
    out += `<path d="M${L} ${T-4}V${H-B}H${W-R+4}" fill="none" stroke="#5b7055" stroke-width="1.5"/><path d="M${L} ${T-7}l-4 7h8Z M${W-R+7} ${H-B}l-7 -4v8Z" fill="#5b7055"/><text x="${L+plotWidth/2}" y="${H-3}" text-anchor="middle" fill="#52684b" font-size="12">x · ${t('东')} (${t('米')})</text><text x="17" y="${T+plotHeight/2}" transform="rotate(-90 17 ${T+plotHeight/2})" text-anchor="middle" fill="#52684b" font-size="12">y · ${t('北')} (${t('米')})</text></svg></div>`;
    const selectedTree=additions.find(tree=>tree.id===selected);
    out += `<p class="small muted coordinate-detail">${selectedTree?`${t('新增树木')} ${auditById.get(selectedTree.id)?.order||additions.indexOf(selectedTree)+1} · x = ${f(selectedTree.x)} ${t('米')} · y = ${f(selectedTree.y)} ${t('米')}`:t('点击树木查看坐标与选择顺序。')}</p>`;
    out += `<div class="coordinate-legend legend"><span>○ ${t('候选点')} ${f(points.length,0)}</span><span>● ${t('新增树木')} ${f(additions.length,0)}</span><span style="color:#427aa1">◎ ${t('公共树')} ${f(sharedTrees.length,0)}</span><span>＋ ${t('原有树')} ${f(existing.length,0)}</span><span>━ ${t('步道')} ${f(topology.paths.length,0)}</span><span>◇ ${t('交叉口')} ${f(topology.intersections.length,0)}</span><span>▧ ${t('建筑')}</span></div>`;
    return out;
  }
  globalThis.ShadeAuditChart = Object.freeze({render});
})();

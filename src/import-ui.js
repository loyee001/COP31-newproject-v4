/* Local image recognition with editable, user-confirmed roads and vegetation. */
(function () {
  'use strict';
  const MAX_FILE_BYTES = 16 * 1024 * 1024;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const MAX_PIXELS = 16 * 1000 * 1000;
  const MAX_PATHS = 128, MAX_POINTS = 2048;
  const clone = value => JSON.parse(JSON.stringify(value));
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let active = null;

  function init(options) {
    if (active) { active.configure(options); active.update(); return active; }
    const container = document.getElementById('campus-import-controls');
    const map = document.getElementById('sun-map');
    if (!container || !map) return null;
    let api = options;
    let expanded = true, busy = false, drawing = false, draft = [], editingId = null;
    let generation = 0, sequence = 0, lastCampus = null, lastLanguage = '', statusKey = '', statusError = false;
    let activeReader = null;
    let pending = null, selectedPending = null, recognitionBusy = false, recognitionEpoch = 0;
    let sensitivity = .5, seedMode = false, recognitionImage = null, drag = null, dragFrame = 0, suppressClick = false;
    let draftForPending = false, recognitionEditingOpen = false, recognitionAssumptionsOpen = false;
    const toolbar = document.getElementById('recognition-toolbar');
    const t = (key, vars) => api.translate ? api.translate(key, vars) : key;
    const h = (key, vars) => escape(t(key, vars));
    const importer = () => {
      if (!globalThis.ShadeCampusImport) throw new Error(t('导入模块尚未就绪。'));
      return globalThis.ShadeCampusImport;
    };
    function pathsOf(campus) {
      if (Array.isArray(campus.paths)) return campus.paths;
      return Array.isArray(campus.route) && campus.route.length >= 2
        ? [{id:'legacy-route',name:t('原有步道'),points:campus.route,width:5,demand:1}] : [];
    }
    function setStatus(key, error = false) {
      statusKey = key; statusError = error;
      const status = container.querySelector('[data-import-status]');
      if (status) { status.textContent = t(key); status.classList.toggle('error', error); }
      const mapStatus = toolbar?.querySelector('[data-recognition-status]');
      if (mapStatus) { mapStatus.textContent = t(key); mapStatus.classList.toggle('error', error); }
    }
    function fail(error) {
      const message = error && typeof error.message === 'string' ? error.message : t('操作失败，原校园保持不变。');
      setStatus(message, true);
      if (typeof api.notify === 'function') api.notify(message);
    }
    function resetDraft() { drawing = false; draft = []; editingId = null; draftForPending = false; map.classList.remove('import-drawing'); }
    function render(force = false) {
      const campus = api.getCampus();
      if (!campus) return;
      const language = t('导入校园与步道');
      if (!force && campus === lastCampus && language === lastLanguage) return;
      lastCampus = campus; lastLanguage = language;
      const paths = pending ? pending.paths : pathsOf(campus), disabled = busy || recognitionBusy || drawing ? ' disabled' : '';
      const rows = paths.map(path => `<div class="import-path-row" data-import-path="${escape(path.id)}"><label>${h('步道名称')}<input data-path-field="name" type="text" maxlength="120" value="${escape(path.name || path.id)}"${disabled}></label><label>${h('净宽（米）')}<input data-path-field="width" type="number" min="0" max="100" step="any" value="${Number(path.width) || 5}"${disabled}></label><label>${h('人流权重')}<input data-path-field="demand" type="number" min="0" max="1000" step="any" value="${Number(path.demand) || 1}"${disabled}></label><div class="import-path-actions"><button type="button" class="button subtle" data-import-action="save-path"${disabled}>${h('应用')}</button><button type="button" class="button subtle" data-import-action="redraw-path"${disabled}>${h('重新描画')}</button><button type="button" class="button subtle" data-import-action="delete-path"${disabled}>${h('删除步道')}</button></div></div>`).join('');
      container.innerHTML = `<details class="campus-import"${expanded?' open':''}><summary>${h('导入校园与步道')}</summary><div class="import-body"><div class="import-actions"><label class="button import-file-label${disabled?' disabled':''}" for="campus-import-file">${h('导入 PNG / JPG / WebP / JSON')}</label><input id="campus-import-file" class="import-file-input" type="file" accept="image/png,image/jpeg,image/webp,application/json,.png,.jpg,.jpeg,.webp,.json"${disabled}><button type="button" class="button" data-import-action="example"${disabled}>${h('加载路网示例')}</button></div><p class="import-hint">${h('导入图片后会在本机生成道路与绿植候选，请确认或修正。')}</p><p class="import-hint">${h('图片须北朝上；图片不超过 8 MB / 1600 万像素，JSON 不超过 16 MB。')}</p>${campus.image?`<div class="import-calibration"><label for="campus-image-width">${h('底图实际宽度（米）')}</label><div><input id="campus-image-width" type="number" min="0" max="10000" step="any" value="${Number(campus.image.widthMeters) || campus.bounds.width}"${disabled}><button type="button" class="button" data-import-action="calibrate"${disabled}>${h('应用比例')}</button></div><p class="import-hint">${h('校准会缩放平面坐标、步道宽度和候选冠幅；已确认树木的冠幅与高度保持原值。')}</p></div>`:''}<div class="import-drawing-actions"><button type="button" class="button" data-import-action="start-draw"${disabled}>${h('添加步道')}</button>${drawing?`<button type="button" class="button primary" data-import-action="finish-draw"${draft.length<2||busy?' disabled':''}>${h('完成标注')}</button><button type="button" class="button subtle" data-import-action="undo-point"${!draft.length||busy?' disabled':''}>${h('撤销本次点')}</button><button type="button" class="button subtle" data-import-action="cancel-draw"${busy?' disabled':''}>${h('取消标注')}</button>`:''}</div>${drawing?`<p class="import-draft-hint">${h(editingId?'正在重新描画步道；完成前保留原路径。':'在地图上依次点击步道中心线，至少两个点后完成。')} <span>${draft.length} ${h('个点')}</span></p>`:''}${!paths.length?`<p class="import-empty">${h('请先确认步道网络。')}</p>`:''}<details class="import-path-management"><summary>${h('管理步道 {n}',{n:paths.length})}</summary><div class="import-path-list">${rows}</div><p class="import-hint">${h('人流权重为相对需求；识别候选需确认，建筑高度仍需补充。')}</p></details><p class="import-status${statusError?' error':''}" data-import-status role="status" aria-live="polite"></p></div></details>`;
      renderToolbar();
      setStatus(statusKey, statusError);
    }
    function redraw() { render(true); if (typeof api.refresh === 'function') api.refresh(); }
    function editCopy() {
      const data = clone(api.getCampus());
      data.paths = clone(pathsOf(data));
      delete data.scenario;
      return data;
    }
    function normalizePaths(data) { data.route = data.paths[0] ? clone(data.paths[0].points) : []; return data; }
    async function commit(data, message, options = undefined, preservePending = false) {
      const clean = importer().validate(data);
      await api.setCampus(clean, options || {});
      resetDraft(); expanded = true;
      if (!preservePending) { pending = null; selectedPending = null; seedMode = false; recognitionEpoch++; recognitionBusy = false; }
      setStatus(message); redraw();
    }
    function pendingNodes() {
      const nodes = new Map();
      for (const path of pending?.paths || []) path.points.forEach((point,index)=>{
        const key=Math.round(point.x*1e6)+','+Math.round(point.y*1e6);
        if(!nodes.has(key))nodes.set(key,{point,refs:[]});
        nodes.get(key).refs.push({id:path.id,index});
      });
      return [...nodes.values()];
    }
    function pendingData(paths = pending?.paths || [], trees = pending?.trees || []) {
      const data=editCopy();
      data.paths=clone(paths);
      data.trees=(data.trees||[]).filter(tree=>tree.candidateSource!=='image-recognition').concat(clone(trees));
      return normalizePaths(data);
    }
    function setPendingPaths(paths) {
      if(!pending)return;
      pending.paths=importer().validate(pendingData(paths)).paths;
    }
    function renderToolbar() {
      if(!toolbar)return;
      const campus=api.getCampus();
      if(!campus?.image&&!pending){toolbar.innerHTML='';return;}
      const locked=busy||recognitionBusy||drawing;
      const disabled=locked?' disabled':'';
      const selected=Boolean(selectedPending||pending?.selectedTree);
      toolbar.innerHTML=`<div class="recognition-toolbar"><div class="recognition-primary"><button type="button" class="button primary" data-import-action="confirm-recognition"${locked||!pending||!(pending.paths.length||pending.trees.length)?' disabled':''}>${h('确认识别结果并优化')}</button><button type="button" class="button" data-import-action="recognize"${disabled}>${h(pending?'重新识别':'自动识别道路与绿植')}</button><label class="recognition-strength">${h('识别强度')}<select data-recognition-sensitivity${disabled}><option value="0.3"${sensitivity===.3?' selected':''}>${h('保守')}</option><option value="0.5"${sensitivity===.5?' selected':''}>${h('标准')}</option><option value="0.75"${sensitivity===.75?' selected':''}>${h('更宽松')}</option></select></label>${pending||recognitionBusy||seedMode?`<button type="button" class="button subtle" data-import-action="cancel-recognition"${busy?' disabled':''}>${h('撤销识别')}</button>`:''}</div><details class="recognition-editing"${recognitionEditingOpen?' open':''}><summary>${h('修正候选')}</summary><p class="recognition-hint">${h('拖动节点可修正，共享交叉点会一起移动。')}</p><div class="recognition-secondary"><button type="button" class="button subtle" data-import-action="assist-recognition"${disabled}>${h('在路面点一下辅助识别')}</button><button type="button" class="button subtle" data-import-action="delete-recognized"${locked||!selected?' disabled':''}>${h('删除选中候选')}</button><button type="button" class="button subtle" data-import-action="redraw-recognized"${locked||!selectedPending?' disabled':''}>${h('重新描画')}</button><button type="button" class="button subtle" data-import-action="start-draw"${disabled}>${h('补画缺失步道')}</button>${drawing?`<button type="button" class="button primary" data-import-action="finish-draw"${draft.length<2?' disabled':''}>${h('完成标注')}</button><button type="button" class="button subtle" data-import-action="undo-point"${!draft.length?' disabled':''}>${h('撤销本次点')}</button><button type="button" class="button subtle" data-import-action="cancel-draw">${h('取消标注')}</button>`:''}</div></details>${pending?`<p class="recognition-summary">${h('待确认')} · ${pending.paths.length} ${h('步道')} · ${pendingNodes().filter(node=>new Set(node.refs.map(r=>r.id)).size>1).length} ${h('交叉口')} · ${pending.trees.length} ${h('树冠候选')}</p><p class="recognition-hint">${h('蓝线：道路 · 蓝点：交叉口 · 绿圈：树冠 · 浅绿：绿地')}<br>${h('可预览种植方案；道路确认后纳入正式计算。')}</p>`:''}${pending?.excludedLargeCanopies?`<p class="recognition-hint">${h('有 {n} 处大面积绿色区域仅作绿地显示，不计树荫。',{n:pending.excludedLargeCanopies})}</p>`:''}<details class="recognition-assumptions"${recognitionAssumptionsOpen?' open':''}><summary>${h('比例与高度假设')}</summary><p class="recognition-hint">${h('底图尺寸、北向与树高仍需校准。')} ${h('浅绿草坪仅作绿地，不作遮阳树。')} ${h('图片与识别均在本机处理，不上传。')}</p></details><p class="import-status" data-recognition-status role="status" aria-live="polite"></p></div>`;
    }
    async function recognitionPixels(campus) {
      if(recognitionImage?.dataUrl===campus.image.dataUrl)return recognitionImage;
      const image=await new Promise((resolve,reject)=>{const source=new Image();source.onload=()=>resolve(source);source.onerror=()=>reject(new Error(t('图片无法解码，请使用 PNG、JPG 或 WebP。')));source.src=campus.image.dataUrl;});
      if(image.naturalWidth*image.naturalHeight>MAX_PIXELS)throw new Error(t('图片不能超过 1600 万像素。'));
      const ratio=Math.min(1,768/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
      const context=canvas.getContext('2d',{willReadFrequently:true});
      if(!context)throw new Error(t('当前浏览器无法读取图片像素。'));
      context.drawImage(image,0,0,canvas.width,canvas.height);
      recognitionImage={dataUrl:campus.image.dataUrl,imageData:context.getImageData(0,0,canvas.width,canvas.height)};
      return recognitionImage;
    }
    function maskURL(mask) {
      if(!mask?.data||!mask.width||!mask.height)return '';
      const canvas=document.createElement('canvas');canvas.width=mask.width;canvas.height=mask.height;
      const context=canvas.getContext('2d'),pixels=context.createImageData(mask.width,mask.height);
      for(let i=0;i<mask.data.length;i++)if(mask.data[i]){const at=i*4;pixels.data[at]=59;pixels.data[at+1]=147;pixels.data[at+2]=89;pixels.data[at+3]=45;}
      context.putImageData(pixels,0,0);return canvas.toDataURL('image/png');
    }
    async function recognize({seedPoint=null}={}) {
      const campus=api.getCampus();if(!campus?.image||busy||drawing)return;
      const epoch=++recognitionEpoch, source=campus.image.dataUrl;
      recognitionBusy=true;seedMode=false;setStatus('正在本机识别道路与绿植…');redraw();
      try {
        const pixels=await recognitionPixels(campus);
        if(epoch!==recognitionEpoch||api.getCampus().image?.dataUrl!==source)return;
        await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
        if(epoch!==recognitionEpoch)return;
        if(!globalThis.ShadeWalkwayRecognition?.detect)throw new Error(t('自动识别模块尚未就绪。'));
        const seed=seedPoint?{x:Math.max(0,Math.min(pixels.imageData.width-1,seedPoint.x/campus.bounds.width*pixels.imageData.width)),y:Math.max(0,Math.min(pixels.imageData.height-1,(campus.bounds.height-seedPoint.y)/campus.bounds.height*pixels.imageData.height))}:undefined;
        const options={campusWidth:campus.bounds.width,campusHeight:campus.bounds.height,sensitivity,maxPaths:128,maxPoints:2048,...(seed?{seed}:{})};
        const roads=await globalThis.ShadeWalkwayRecognition.detect(pixels.imageData,options);
        const plants=globalThis.ShadeVegetationRecognition?.detect?await globalThis.ShadeVegetationRecognition.detect(pixels.imageData,options):{trees:[]};
        if(epoch!==recognitionEpoch||api.getCampus().image?.dataUrl!==source)return;
        const detectedTrees=(plants.trees||[]).map((tree,index)=>({id:'image-tree-'+epoch+'-'+index,x:tree.x,y:tree.y,radius:tree.radius,height:Math.max(campus.treeTemplate?.height||8,tree.radius),cost:campus.treeTemplate?.cost||95,candidateSource:'image-recognition',existing:true}));
        const trees=detectedTrees.filter(tree=>tree.radius<=8),excludedTrees=detectedTrees.filter(tree=>tree.radius>8);
        const clean=importer().validate(pendingData(roads.paths||[],trees));
        pending={paths:clean.paths,trees:clean.trees.filter(tree=>tree.candidateSource==='image-recognition'),excludedTrees,confidence:roads.confidence,diagnostics:roads.diagnostics,vegetationDiagnostics:plants.diagnostics,excludedLargeCanopies:excludedTrees.length,greenMask:maskURL(plants.greenMask),selectedTree:null};
        selectedPending=null;
        setStatus(!pending.paths.length?'未找到可靠道路；可点一次路面辅助整图识别。':roads.confidence?.level==='low'?'识别结果不确定，请先修正候选再确认。':'已生成识别候选，请在图上确认或修正。');
        (toolbar || map).scrollIntoView({block:'start'});
      } catch(error){if(epoch===recognitionEpoch)fail(error);}
      finally{if(epoch===recognitionEpoch){recognitionBusy=false;redraw();}}
    }
    async function confirmRecognition() {
      if(!pending||drawing||recognitionBusy)return;
      const data=pendingData();
      await commit(data,'识别结果已确认，正在使用该路网与既有树计算。');
    }
    async function loadPrepared(campus, options={}) {
      const full=importer().validate(campus);
      generation++; recognitionEpoch++; recognitionBusy=false; recognitionImage=null;
      if(activeReader){activeReader.abort();activeReader=null;}
      busy=false;resetDraft();
      await commit({...full,paths:[],route:[],trees:[]},'本图已载入，路网与树冠仍待确认。',{...options,settings:{minutes:900,...options.settings}});
      pending={paths:full.paths,trees:full.trees,excludedTrees:[],excludedLargeCanopies:0,greenMask:'',selectedTree:null};
      selectedPending=null;setStatus('本图已载入，路网与树冠仍待确认。');redraw();
    }
    function scenePreview() {
      if(!pending)return null;
      const campus=api.getCampus();
      return {...campus,paths:pending.paths,trees:[...(campus.trees||[]).filter(tree=>tree.candidateSource!=='image-recognition'),...pending.trees]};
    }
    function cancelRecognition() {
      recognitionEpoch++;recognitionBusy=false;seedMode=false;pending=null;selectedPending=null;drag=null;
      if(dragFrame){cancelAnimationFrame(dragFrame);dragFrame=0;}
      resetDraft();setStatus('已撤销识别，保留已确认路网。');redraw();
    }
    function mapPoint(event) {
      const svg=event.target.closest('svg')||map.querySelector('svg');if(!svg)return null;
      const matrix=svg.getScreenCTM();if(!matrix)return null;
      const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
      const local=point.matrixTransform(matrix.inverse()),bounds=api.getCampus().bounds;
      return {x:Math.max(0,Math.min(bounds.width,local.x)),y:Math.max(0,Math.min(bounds.height,bounds.height-local.y))};
    }
    function candidateOverlay() {
      if(!pending)return '';
      const campus=api.getCampus(),height=campus.bounds.height,scale=Math.max(.15,Math.min(campus.bounds.width,height)/350);
      let result=`<g class="recognition-candidates">${pending.greenMask?`<image href="${escape(pending.greenMask)}" x="0" y="0" width="${campus.bounds.width}" height="${height}" preserveAspectRatio="none" pointer-events="none"/>`:''}`;
      for(const tree of pending.trees)result+=`<circle class="recognition-tree" data-recognition-tree="${escape(tree.id)}" cx="${tree.x}" cy="${height-tree.y}" r="${tree.radius}" fill="#35945c" fill-opacity=".18" stroke="${pending.selectedTree===tree.id?'#b76c22':'#2f8050'}" stroke-width="${scale*.9}" tabindex="0" role="button" aria-label="${h('树冠候选')}"/>`;
      for(const path of pending.paths)result+=`<polyline class="recognition-path" data-recognition-path="${escape(path.id)}" tabindex="0" role="button" aria-label="${escape(path.name||path.id)}" points="${path.points.map(point=>`${point.x},${height-point.y}`).join(' ')}" fill="none" stroke="${path.id===selectedPending?'#dc8a22':'#226ed4'}" stroke-width="${scale*2.4}" stroke-linejoin="round" stroke-linecap="round"><title>${escape(path.name||path.id)}</title></polyline>`;
      for(const node of pendingNodes()){
        const chosen=node.refs.find(ref=>ref.id===selectedPending),shared=new Set(node.refs.map(ref=>ref.id)).size>1;
        if(!chosen&&!shared)continue;const ref=chosen||node.refs[0];
        result+=`<circle class="recognition-node" data-recognition-path="${escape(ref.id)}" data-recognition-node="${escape(ref.id)}:${ref.index}" data-node-path="${escape(ref.id)}" data-node-index="${ref.index}" cx="${node.point.x}" cy="${height-node.point.y}" r="${scale*(shared?3.4:2.5)}" fill="white" stroke="#226ed4" stroke-width="${scale*1.2}" tabindex="0" role="button" aria-label="${h(shared?'拖动交叉点一起修正':'拖动节点修正步道')}"/>`;
      }
      return result+'</g>';
    }

    function readDataURL(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader(); activeReader = reader;
        reader.onload = () => { activeReader = null; resolve(String(reader.result)); };
        reader.onerror = () => { activeReader = null; reject(new Error(t('无法读取图片文件。'))); };
        reader.onabort = () => { activeReader = null; reject(new Error(t('导入已取消。'))); };
        reader.readAsDataURL(file);
      });
    }
    function decodeImage(dataUrl) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        const timer = setTimeout(() => { image.onload = image.onerror = null; reject(new Error(t('图片解码超时，请换一张图片。'))); }, 15000);
        image.onload = () => {
          clearTimeout(timer);
          if (!image.naturalWidth || !image.naturalHeight) { reject(new Error(t('图片尺寸无效。'))); return; }
          if (image.naturalWidth * image.naturalHeight > MAX_PIXELS) { reject(new Error(t('图片不能超过 1600 万像素。'))); return; }
          resolve({pixelWidth:image.naturalWidth,pixelHeight:image.naturalHeight});
        };
        image.onerror = () => { clearTimeout(timer); reject(new Error(t('图片无法解码，请使用 PNG、JPG 或 WebP。'))); };
        image.src = dataUrl;
      });
    }
    function campusNameFromFilename(filename) {
      const stem = String(filename).replace(/\.[^.]+$/, '');
      if (!/(学校|小学|中学|大学|学院|校区)/.test(stem)) return '';
      const candidate = stem.replace(/(?:总)?平面图|结构图|校园地图|校园图|航拍图|示意图|设计图|照片|底图/g, '').replace(/[_—–-]+/g, ' ').replace(/\s+/g, ' ').trim();
      return candidate.length > 2 && candidate.length <= 120 ? candidate : '';
    }
    async function importFile(file) {
      if (!file || busy || drawing) return;
      const token = ++generation;
      recognitionEpoch++; recognitionBusy = false;
      busy = true; expanded = true; setStatus('正在读取校园文件…'); render(true);
      try {
        if (file.size > MAX_FILE_BYTES) throw new Error(t('文件不能超过 16 MB。'));
        const isJSON = /\.json$/i.test(file.name) || file.type === 'application/json';
        let data, restore;
        if (isJSON) {
          data = importer().parseJSON(await file.text());
          if (token !== generation) return;
          if (data.image) {
            const decoded = await decodeImage(data.image.dataUrl);
            if (token !== generation) return;
            if (decoded.pixelWidth !== data.image.pixelWidth || decoded.pixelHeight !== data.image.pixelHeight) throw new Error(t('JSON 中的图片尺寸与实际图片不一致。'));
          }
          if (data.scenario) {
            if (!globalThis.ShadeEngine?.restoreScenario) throw new Error(t('当前版本无法恢复此方案。'));
            restore = globalThis.ShadeEngine.restoreScenario(data);
            data = restore.campus;
          }
        } else {
          if (!/\.(png|jpe?g|webp)$/i.test(file.name) && !/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error(t('请选择 PNG、JPG、WebP 或校园 JSON 文件。'));
          if (file.size > MAX_IMAGE_BYTES) throw new Error(t('图片文件不能超过 8 MB。'));
          const encoded = await readDataURL(file);
          if (token !== generation) return;
          const extension = file.name.split('.').pop().toLowerCase();
          const mime = /^image\/(png|jpeg|webp)$/.test(file.type) ? file.type : ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'}[extension]);
          const dataUrl = encoded.replace(/^data:[^;,]*;base64,/, 'data:'+mime+';base64,');
          // Validate the raster signature before asking the browser to decode it.
          importer().fromImage({dataUrl,pixelWidth:1,pixelHeight:1,widthMeters:220,northRotation:0});
          const dimensions = await decodeImage(dataUrl);
          if (token !== generation) return;
          const campusName = campusNameFromFilename(file.name);
          data = importer().fromImage({dataUrl,...dimensions,widthMeters:220,northRotation:0,name:file.name,...(campusName?{campusName}:{})});
        }
        if (token !== generation) return;
        if(isJSON&&data.metadata?.pendingRecognition){await loadPrepared(data,restore?{settings:restore.settings,budget:restore.budget}:{});return;}
        if(!isJSON&&globalThis.ShadeCampusPreset?.matches(data))data=globalThis.ShadeCampusPreset.attach(data);
        await commit(data, data.image && !pathsOf(data).length ? '底图已导入，正在准备自动识别。' : '校园数据已导入。', restore ? {trees:restore.trees,settings:restore.settings,budget:restore.budget} : undefined);
      } catch (error) { if (token === generation) fail(error); }
      finally { if (token === generation) { busy = false; render(true); } }
      if (token === generation && api.getCampus()?.image && !pathsOf(api.getCampus()).length && !statusError) { (toolbar || map).scrollIntoView({block:'start'}); recognize(); }
    }
    async function loadExample() {
      const data = clone(globalThis.ShadeEngine.campus);
      delete data.image; delete data.scenario;
      data.metadata = {...data.metadata,title:'ShadePath synthetic crossing walkways',provenance:'synthetic',measured:false};
      const width = data.bounds.width, height = data.bounds.height;
      data.paths = [
        {id:'example-east-west',name:t('东西步道'),width:5,demand:1,points:[{x:width*.13,y:height*.47},{x:width*.92,y:height*.47}]},
        {id:'example-north-south',name:t('南北步道'),width:5,demand:1,points:[{x:width*.5,y:height*.07},{x:width*.5,y:height*.93}]}
      ];
      await commit(normalizePaths(data),'已加载合成路网示例。');
    }
    async function calibrate() {
      const field = container.querySelector('#campus-image-width');
      if (!field || !field.value || !field.checkValidity()) { field?.reportValidity(); return; }
      const width = Number(field.value), data = editCopy();
      if (!data.image || !Number.isFinite(width) || width <= 0) throw new Error(t('请输入有效的底图实际宽度。'));
      const factor = width / data.bounds.width;
      const scalePoint = point => ({...point,x:point.x*factor,y:point.y*factor});
      data.bounds = {width,height:data.bounds.height*factor};
      data.image.widthMeters = width;
      data.paths = data.paths.map(path => ({...path,width:path.width*factor,points:path.points.map(scalePoint)}));
      data.buildings = (data.buildings || []).map(building => ({...building,polygon:building.polygon.map(scalePoint)}));
      data.trees = (data.trees || []).map(scalePoint);
      const previousPending = pending;
      if (pending) {
        const scaledTrees=pending.trees.concat(pending.excludedTrees||[]).map(tree=>{
          const radius=tree.radius*factor;
          return {...scalePoint(tree),radius,height:Math.max(tree.height,radius)};
        });
        const excludedTrees=scaledTrees.filter(tree=>tree.radius>8);
        const nextPending={...pending,paths:pending.paths.map(path=>({...path,width:path.width*factor,points:path.points.map(scalePoint)})),trees:scaledTrees.filter(tree=>tree.radius<=8),excludedTrees,excludedLargeCanopies:excludedTrees.length};
        // Validate candidates against the proposed bounds before changing either scene.
        const proposed=clone(data);
        proposed.paths=clone(nextPending.paths);
        proposed.trees=(proposed.trees||[]).filter(tree=>tree.candidateSource!=='image-recognition').concat(clone(nextPending.trees));
        const clean=importer().validate(normalizePaths(proposed));
        nextPending.paths=clean.paths;
        nextPending.trees=clean.trees.filter(tree=>tree.candidateSource==='image-recognition');
        if(!nextPending.trees.some(tree=>tree.id===nextPending.selectedTree))nextPending.selectedTree=null;
        pending=nextPending;
      }
      try { await commit(normalizePaths(data),'底图比例已校准，请复核步道宽度和实测树冠。',undefined,true); }
      catch (error) { pending = previousPending; throw error; }
    }
    function startDrawing(id = null) {
      if (busy || recognitionBusy || drawing) return;
      const paths = pending ? pending.paths : pathsOf(api.getCampus());
      if (!id && paths.length >= MAX_PATHS) throw new Error(t('最多可标注 128 条步道。'));
      if (id && !paths.some(path => path.id === id)) return;
      drawing = true; editingId = id; draft = []; draftForPending = Boolean(pending); seedMode = false; expanded = true; recognitionEditingOpen = true;
      map.classList.add('import-drawing'); map.tabIndex = 0;
      setStatus('请在图上依次点击步道中心线。'); redraw();
      (toolbar || map).scrollIntoView({block:'start'}); map.focus({preventScroll:true});
    }
    async function finishDrawing() {
      if (!drawing || draft.length < 2) return;
      const data = editCopy();
      if (draftForPending && pending) data.paths = clone(pending.paths);
      if (editingId) {
        const index = data.paths.findIndex(path => path.id === editingId);
        if (index < 0) throw new Error(t('原步道已变化，请取消后重试。'));
        data.paths[index] = {...data.paths[index],points:clone(draft)};
      } else {
        data.paths.push({id:'path-'+Date.now()+'-'+(++sequence),name:t('步道')+' '+(data.paths.length+1),width:5,demand:1,points:clone(draft)});
      }
      if (draftForPending && pending) { setPendingPaths(data.paths); resetDraft(); setStatus('候选路网已修正，确认后才参与计算。'); redraw(); }
      else await commit(normalizePaths(data),'步道已保存，方案已重新计算。');
    }
    async function savePath(row) {
      const fields = [...row.querySelectorAll('input')];
      if (fields.some(field => !field.checkValidity())) { fields.find(field => !field.checkValidity()).reportValidity(); return; }
      const data = editCopy(); if (pending) data.paths = clone(pending.paths);
      const path = data.paths.find(item => item.id === row.dataset.importPath);
      if (!path) return;
      path.name = row.querySelector('[data-path-field="name"]').value.trim() || t('步道');
      path.width = Number(row.querySelector('[data-path-field="width"]').value);
      path.demand = Number(row.querySelector('[data-path-field="demand"]').value);
      if (pending) { setPendingPaths(data.paths); setStatus('候选路网已修正，确认后才参与计算。'); redraw(); }
      else await commit(normalizePaths(data),'步道参数已更新。');
    }
    container.addEventListener('change', event => {
      if (event.target.id === 'campus-import-file') importFile(event.target.files?.[0]);
    });
    container.addEventListener('toggle', event => { if (event.target.classList?.contains('campus-import')) expanded = event.target.open; }, true);
    async function handleAction(event) {
      const button = event.target.closest('[data-import-action]');
      if (!button || button.disabled || busy) return;
      const action = button.dataset.importAction, row = button.closest('[data-import-path]');
      try {
        if (action === 'recognize') await recognize();
        else if (action === 'confirm-recognition') await confirmRecognition();
        else if (action === 'cancel-recognition') cancelRecognition();
        else if (action === 'assist-recognition') { seedMode = true; resetDraft(); setStatus('请在图中路面内部点一下，将辅助识别整张图。'); redraw(); (toolbar || map).scrollIntoView({block:'start'}); }
        else if (action === 'delete-recognized' && pending && (selectedPending||pending.selectedTree)) { if(pending.selectedTree)pending.trees=pending.trees.filter(tree=>tree.id!==pending.selectedTree);else setPendingPaths(pending.paths.filter(path=>path.id!==selectedPending)); selectedPending=null;pending.selectedTree=null; setStatus('候选路网已修正，确认后才参与计算。'); redraw(); }
        else if (action === 'redraw-recognized' && pending && selectedPending) startDrawing(selectedPending);
        else if (action === 'example') await loadExample();
        else if (action === 'calibrate') await calibrate();
        else if (action === 'start-draw') startDrawing();
        else if (action === 'redraw-path' && row) startDrawing(row.dataset.importPath);
        else if (action === 'finish-draw') await finishDrawing();
        else if (action === 'undo-point') { draft.pop(); redraw(); }
        else if (action === 'cancel-draw') { resetDraft(); setStatus('本次标注已取消。'); redraw(); }
        else if (action === 'save-path' && row) await savePath(row);
        else if (action === 'delete-path' && row) {
          const data = editCopy(); data.paths = (pending ? clone(pending.paths) : data.paths).filter(path => path.id !== row.dataset.importPath);
          if (pending) { setPendingPaths(data.paths); setStatus('候选路网已修正，确认后才参与计算。'); redraw(); } else await commit(normalizePaths(data),'步道已删除。');
        }
      } catch (error) { fail(error); }
    }
    container.addEventListener('click', handleAction);
    toolbar?.addEventListener('click', handleAction);
    toolbar?.addEventListener('toggle', event=>{
      if(!toolbar.contains(event.target))return;
      if(event.target.classList?.contains('recognition-editing'))recognitionEditingOpen=event.target.open;
      if(event.target.classList?.contains('recognition-assumptions'))recognitionAssumptionsOpen=event.target.open;
    },true);
    toolbar?.addEventListener('change', event=>{if(event.target.matches('[data-recognition-sensitivity]')){sensitivity=Number(event.target.value);recognize();}});
    function nodeReferences(id,index) {
      const path=pending?.paths.find(path=>path.id===id),point=path?.points[index];if(!point)return [];
      const refs=[];for(const item of pending.paths)item.points.forEach((p,i)=>{if(Math.abs(p.x-point.x)<1e-6&&Math.abs(p.y-point.y)<1e-6)refs.push({id:item.id,index:i});});return refs;
    }
    function moveSelection(target,point) {
      if(target.tree){const tree=pending.trees.find(tree=>tree.id===target.tree);if(tree){tree.x=point.x;tree.y=point.y;}}
      else for(const ref of target.refs){const path=pending.paths.find(path=>path.id===ref.id);if(path)path.points[ref.index]={x:point.x,y:point.y};}
    }
    function validatePending() {
      if(!pending)return;const clean=importer().validate(pendingData());
      pending.paths=clean.paths;pending.trees=clean.trees.filter(tree=>tree.candidateSource==='image-recognition');
    }
    map.addEventListener('pointerdown',event=>{
      if(!pending||busy||drawing||seedMode||recognitionBusy||event.button!==0)return;
      const node=event.target.closest('[data-recognition-node]'),tree=event.target.closest('[data-recognition-tree]');if(!node&&!tree)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(tree){pending.selectedTree=tree.dataset.recognitionTree;selectedPending=null;}
      else {selectedPending=node.dataset.nodePath;pending.selectedTree=null;}
      drag={pointerId:event.pointerId,tree:tree?.dataset.recognitionTree,refs:node?nodeReferences(node.dataset.nodePath,Number(node.dataset.nodeIndex)):[],originalPaths:clone(pending.paths),originalTrees:clone(pending.trees),moved:false};
      map.setPointerCapture(event.pointerId);redraw();
    },true);
    map.addEventListener('pointermove',event=>{
      if(!drag||event.pointerId!==drag.pointerId||!pending)return;
      event.preventDefault();event.stopImmediatePropagation();const point=mapPoint(event);if(!point)return;
      moveSelection(drag,point);drag.moved=true;
      if(!dragFrame)dragFrame=requestAnimationFrame(()=>{dragFrame=0;if(typeof api.refresh==='function')api.refresh();});
    },true);
    function finishDrag(event) {
      if(!drag||event.pointerId!==drag.pointerId)return;
      event.preventDefault();event.stopImmediatePropagation();const previous=drag;drag=null;suppressClick=true;
      if(map.hasPointerCapture?.(event.pointerId))map.releasePointerCapture(event.pointerId);
      if(dragFrame){cancelAnimationFrame(dragFrame);dragFrame=0;}
      if(event.type==='pointercancel'){pending.paths=previous.originalPaths;pending.trees=previous.originalTrees;}
      else try{validatePending();if(previous.moved)setStatus('候选路网已修正，确认后才参与计算。');}
      catch(error){pending.paths=previous.originalPaths;pending.trees=previous.originalTrees;fail(error);}
      redraw();
    }
    map.addEventListener('pointerup',finishDrag,true);map.addEventListener('pointercancel',finishDrag,true);
    map.addEventListener('keydown',event=>{
      if(!pending||busy||drawing||seedMode||recognitionBusy)return;
      const node=event.target.closest('[data-recognition-node]'),tree=event.target.closest('[data-recognition-tree]');
      if(!node&&!tree){const path=event.target.closest('[data-recognition-path]');if(path&&['Enter',' '].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();selectedPending=path.dataset.recognitionPath;pending.selectedTree=null;const id=selectedPending;redraw();map.querySelector(`.recognition-path[data-recognition-path="${CSS.escape(id)}"]`)?.focus({preventScroll:true});}return;}
      if(['Enter',' '].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();selectedPending=node?.dataset.nodePath||null;pending.selectedTree=tree?.dataset.recognitionTree||null;redraw();return;}
      const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};if(!directions[event.key])return;
      event.preventDefault();event.stopImmediatePropagation();const before=clone(pending),step=event.shiftKey?1:.2;
      const item=tree?pending.trees.find(t=>t.id===tree.dataset.recognitionTree):pending.paths.find(p=>p.id===node.dataset.nodePath)?.points[Number(node.dataset.nodeIndex)];if(!item)return;
      const bounds=api.getCampus().bounds,delta=directions[event.key];
      moveSelection({tree:tree?.dataset.recognitionTree,refs:node?nodeReferences(node.dataset.nodePath,Number(node.dataset.nodeIndex)):[]},{x:Math.max(0,Math.min(bounds.width,item.x+delta[0]*step)),y:Math.max(0,Math.min(bounds.height,item.y+delta[1]*step))});
      try{validatePending();setStatus('候选路网已修正，确认后才参与计算。');}catch(error){pending=before;fail(error);}
      const attr=tree?'data-recognition-tree':'data-recognition-node',id=tree?tree.dataset.recognitionTree:node.dataset.recognitionNode;redraw();map.querySelector(`[${attr}="${CSS.escape(id)}"]`)?.focus({preventScroll:true});
    },true);

    map.addEventListener('click', event => {
      if (busy) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (seedMode) {
        event.preventDefault(); event.stopImmediatePropagation();
        const point = mapPoint(event); if (!point) return;
        seedMode = false; recognize({seedPoint:point}); return;
      }
      if (!drawing) {
        if (pending || recognitionBusy) {
          event.preventDefault(); event.stopImmediatePropagation();
          const item=event.target.closest('[data-recognition-path]');
          const tree=event.target.closest('[data-recognition-tree]');
          if(tree&&pending){pending.selectedTree=tree.dataset.recognitionTree;selectedPending=null;redraw();}
          else if(item&&pending){selectedPending=item.dataset.recognitionPath;pending.selectedTree=null;redraw();}
        }
        return;
      }
      event.preventDefault(); event.stopImmediatePropagation();
      const svg = event.target.closest('svg');
      if (!svg || !map.contains(svg)) return;
      try {
        const campus = api.getCampus();
        const otherPoints = (pending ? pending.paths : pathsOf(campus)).filter(path => path.id !== editingId).reduce((sum,path) => sum+path.points.length,0);
        if (otherPoints + draft.length >= MAX_POINTS) throw new Error(t('步道总点数不能超过 2048 个。'));
        const matrix = svg.getScreenCTM();
        if (!matrix) return;
        const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
        const mapped = point.matrixTransform(matrix.inverse());
        const p = {x:Math.round(Math.max(0,Math.min(campus.bounds.width,mapped.x))*100)/100,y:Math.round(Math.max(0,Math.min(campus.bounds.height,campus.bounds.height-mapped.y))*100)/100};
        const last = draft[draft.length-1];
        if (last && Math.hypot(last.x-p.x,last.y-p.y) < .05) { setStatus('请点击另一个位置。'); return; }
        draft.push(p); setStatus('标注中：至少两个点后点击完成。'); redraw();
      } catch (error) { fail(error); }
    }, true);
    map.addEventListener('keydown', event => {
      if (!drawing || !['Escape','Backspace','Enter'].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape') { resetDraft(); setStatus('本次标注已取消。'); redraw(); }
      else if (event.key === 'Backspace') { draft.pop(); redraw(); }
      else finishDrawing().catch(fail);
    }, true);
    function reset() {
      generation++; recognitionEpoch++; busy = false; recognitionBusy = false; pending = null; selectedPending = null; seedMode = false; drag = null;
      if(dragFrame){cancelAnimationFrame(dragFrame);dragFrame=0;}
      if (activeReader) { activeReader.abort(); activeReader = null; }
      resetDraft(); statusKey = ''; statusError = false; redraw();
    }
    function overlay() {
      const candidates = candidateOverlay();
      if (!drawing || !draft.length) return candidates;
      const campus = api.getCampus(), height = campus.bounds.height;
      const scale = Math.max(.15, Math.min(campus.bounds.width,height)/350);
      const points = draft.map(point => `${point.x},${height-point.y}`).join(' ');
      return candidates+`<g class="import-draft-overlay" pointer-events="none"><polyline points="${points}" fill="none" stroke="#b64b3d" stroke-width="${scale}" stroke-linejoin="round" stroke-dasharray="${scale*3} ${scale*2}"/>${draft.map((point,index)=>`<circle cx="${point.x}" cy="${height-point.y}" r="${scale*2.4}" fill="#fff" stroke="#b64b3d" stroke-width="${scale}"/><text x="${point.x+scale*4}" y="${height-point.y-scale*3}" font-size="${scale*5}" fill="#9c3c31">${index+1}</text>`).join('')}</g>`;
    }
    active = Object.freeze({
      configure(next) { api = next; }, update: () => render(), reset, loadPrepared, scenePreview,
      overlay, isDrawing: () => drawing, isEditing: () => drawing || Boolean(pending) || seedMode || recognitionBusy
    });
    render(true);
    return active;
  }
  globalThis.ShadeImportUI = Object.freeze({
    init,
    update: () => active?.update(), reset: () => active?.reset(), loadPrepared:campus=>active?.loadPrepared(campus), scenePreview:()=>active?.scenePreview(),
    overlay: () => active?.overlay() || '', isDrawing: () => active?.isDrawing() || false, isEditing: () => active?.isEditing() || false
  });
}());

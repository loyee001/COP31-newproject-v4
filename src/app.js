(function () {
  'use strict';
  const E=globalThis.ShadeEngine, I=globalThis.ShadeI18n;
  let C={...E.campus,paths:[
    {id:'main',name:'主步道',points:E.campus.route,width:5,demand:1},
    {id:'cross',name:'横向步道',points:[{x:23,y:58},{x:182,y:58}],width:5,demand:1},
    {id:'library-path',name:'图书馆步道',points:[{x:76,y:58},{x:76,y:75}],width:5,demand:1},
    {id:'activity-path',name:'活动室步道',points:[{x:135,y:58},{x:135,y:86}],width:5,demand:1}
  ]};
  const $=id=>document.getElementById(id);
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let savedLanguage='zh';try{savedLanguage=localStorage.getItem('shadepath-language')||'zh';}catch{}
  const state={lang:['zh','en','tr'].includes(savedLanguage)?savedLanguage:'zh',view:'overview',budget:2200,mode:'auto',mapLayer:'shade',mapPhase:'after',mapFocus:null,trees:[],settings:{...E.defaults,airTemperature:32,relativeHumidity:55,windSpeed:1.2},selected:null,plan:null,metrics:null,audit:null,computeMs:0};
  const t=(key,vars={})=>I.t(key,vars,state.lang);
  const fmt=(number,digits=1)=>Number.isFinite(number)?number.toLocaleString(state.lang==='zh'?'zh-CN':state.lang==='tr'?'tr-TR':'en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}):'—';
  const money=number=>'$'+fmt(number,Number.isInteger(number)?0:2),pct=number=>fmt(number*100,1)+'%';
  const clock=minute=>{const m=((Math.round(minute)%1440)+1440)%1440;return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;};
  const h=(key,vars)=>escape(t(key,vars));
  const metric=(label,value,comparison='')=>`<div class="metric"><label>${h(label)}</label><div class="value">${value}</div>${comparison?`<div class="comparison">${comparison}</div>`:''}</div>`;
  let draftPlan=null,draftSettings=null,draftGeometryKey='',draftRequestKey='',draftBusy=false,draftError='',draftTimer=0,draftEpoch=0;
  let toastTimer, renderTimer, timeFrame=0, curveKey='',dayCurve=[],curveTimer=0,curveGeneration=0,curvePending=false,locationRequest=0,locationCandidates=[],lastLocationQuery='',sceneController=null,originalMapController=null;
  function toast(key,vars){$('toast').textContent=t(key,vars);$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3200);}
  function localize(){
    document.documentElement.lang={zh:'zh-CN',en:'en',tr:'tr'}[state.lang];
    document.title=t('绿茵计划')+' ShadePath · '+t('校园荫凉规划实验室');
    document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n));
    document.querySelectorAll('[data-i18n-aria]').forEach(el=>el.setAttribute('aria-label',t(el.dataset.i18nAria)));
    document.querySelectorAll('[data-i18n-content]').forEach(el=>el.setAttribute('content',t(el.dataset.i18nContent)));
    $('language').value=state.lang;$('language').ariaLabel=t('请选择语言');
    renderMethods();globalThis.ShadeImportUI.update();
  }
  function renderMethods(){
    const cards=[
      ['太阳位置','太阳位置按 NOAA 太阳计算公式求解，包含经度、时区、均时差与大气折射修正。','sin α = sin φ sin δ + cos φ cos δ cos H','NOAA · 太阳计算说明','https://gml.noaa.gov/grad/solcalc/calcdetails.html'],
      ['阴影几何','建筑阴影使用底面与投影顶面的凸包；球形树冠按椭圆投影，重叠阴影取并集。','a = r / sin α; b = r; offset = h / tan α'],
      ['步行暴露','沿路线每 0.5 米采样，按 1.15 米/秒推进，并以抵达时刻重新计算太阳与遮荫。','tᵢ = t₀ + distanceᵢ / (1.15 × 60)'],
      ['预算优化','先按太阳方向反推候选树位，再逐棵选择当前出发时刻下新增荫凉分钟数除以成本最大的树。','argmaxₜ Σᵢ wᵢ · Δshadeᵢ(t) / cost(t)'],
      ['官方 UTCI 近似','使用 UTCI 官方六阶多项式近似，输入气温、平均辐射温度、10 米风速和水汽压，并检查有效范围。','UTCI = f₆(Ta, v₁₀, Tmrt − Ta, pa)','UTCI · 操作流程','https://utci.org/utci_calc.php'],
      ['数据与边界','场地、天气与人流是可替换的合成输入；计算结果不会被调整为产品文档中的参考数字。',t('x 向东；y 向北')+'; m · °C · m/s · kPa']
    ];
    $('method-cards').innerHTML=cards.map((c,i)=>`<article class="panel method-card"><span class="number">0${i+1}</span><h2>${h(c[0])}</h2><p>${h(c[1])}</p><code>${escape(c[2])}</code>${c[3]?`<a href="${c[4]}" target="_blank" rel="noopener noreferrer">${h(c[3])} ↗</a>`:''}</article>`).join('');
  }
  function setView(){
    const hash=location.hash.slice(1), view=['overview','budget','sun','method'].includes(hash)?hash:'overview';
    state.view=view;document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!=='view-'+view);
    document.querySelectorAll('[data-view]').forEach(el=>{const active=el.dataset.view===view;el.classList.toggle('active',active);if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
    if(state.metrics&&view==='sun')renderDayChart();
    if(state.metrics)renderScene();
  }
  function updateRanges(){document.querySelectorAll('input[type="range"]').forEach(el=>el.style.setProperty('--fill',100*(+el.value-+el.min)/(+el.max-+el.min)+'%'));}
  function recompute(replan=true){
    clearTimeout(renderTimer);renderTimer=0;
    if(timeFrame){cancelAnimationFrame(timeFrame);timeFrame=0;}
    const start=performance.now();
    state.plan=E.optimize(C,state.budget,state.settings);
    if(replan&&state.mode==='auto')state.trees=state.plan.trees;
    if(replan&&state.mode==='near')state.trees=state.plan.nearTrees;
    if(state.selected&&!state.trees.some(tree=>tree.id===state.selected))state.selected=null;
    state.metrics=E.evaluate(C,state.trees,state.settings);
    state.audit=E.auditPlan(C,state.trees,state.settings);
    state.computeMs=performance.now()-start;
    render();
  }
  function schedule(replan=true){clearTimeout(renderTimer);renderTimer=setTimeout(()=>recompute(replan),35);}
  function flushPending(){if(renderTimer||timeFrame)recompute();}
  function replaceCampus(campus,options={}){
    const previousImage=C.image?.dataUrl,previousName=C.metadata?.campusName,previousLocation=JSON.stringify(C.location);
    const next=globalThis.ShadeCampusImport.validate(campus);
    const settings={...state.settings,...next.location,...(options.settings||{})},budget=options.budget??state.budget;
    if(next.location?.timezoneName)settings.timezone=globalThis.ShadeGeocoding.timezoneOffset(next.location.timezoneName,settings.date);
    // Complete model validation before replacing the visible scene.
    const plan=E.optimize(next,budget,settings),trees=options.trees??plan.trees;
    const metrics=E.evaluate(next,trees,settings),audit=E.auditPlan(next,trees,settings);
    clearTimeout(renderTimer);renderTimer=0;if(timeFrame){cancelAnimationFrame(timeFrame);timeFrame=0;}
    C=next;Object.assign(state,{settings,budget,trees,plan,metrics,audit,selected:null,mode:options.trees?'manual':'auto',mapPhase:'after',mapLayer:'shade'});
    curveKey='';
    for(const [id,key] of Object.entries(settingsFields))$(id).value=settings[key];
    render();
    if(previousImage!==C.image?.dataUrl||previousName!==C.metadata?.campusName||previousLocation!==JSON.stringify(C.location))syncCampusLocation(true);
  }
  function updateLocationTimezone(){
    if(C.location?.timezoneName)state.settings.timezone=globalThis.ShadeGeocoding.timezoneOffset(C.location.timezoneName,state.settings.date);
  }
  function locationStatus(message){$('campus-location-status').textContent=message;}
  function syncCampusLocation(lookup=false){
    locationRequest++;locationCandidates=[];$('campus-location-options').hidden=true;lastLocationQuery='';
    const raw=C.metadata?.name||C.metadata?.title||'',inferred=/(学校|小学|中学|大学|学院|校区)/.test(raw)?raw.replace(/\.[a-z0-9]+$/i,'').replace(/(校园)?(结构图|平面图|总平面图|规划图|地图)/g,'').trim():'';
    const name=C.metadata?.campusName||inferred;
    $('campus-name').value=name;
    const located=C.location?.source&&C.location.source!=='unverified-default';
    locationStatus(located?`${C.location.displayName||name||t('已导入位置')} · ${fmt(state.settings.latitude,4)}°, ${fmt(state.settings.longitude,4)}°`:t(C.image?'填写学校全名和城市，自动确定经纬度。':'示例位置：上海。填写校园名称可自动定位。'));
    if(lookup&&name&&!located)locateCampus();
  }
  function applyCampusLocation(candidate,query){
    if(!candidate.timezoneName){locationStatus(t('已找到坐标，但时区未确认，请补充城市后重试。'));return;}
    const timezone=globalThis.ShadeGeocoding.timezoneOffset(candidate.timezoneName,state.settings.date);
    C={...C,metadata:{...C.metadata,campusName:query},location:{latitude:candidate.latitude,longitude:candidate.longitude,timezone,timezoneName:candidate.timezoneName,source:candidate.source,displayName:candidate.displayName,query}};
    Object.assign(state.settings,{latitude:candidate.latitude,longitude:candidate.longitude,timezone});
    locationStatus(`${candidate.displayName} · ${fmt(candidate.latitude,4)}°, ${fmt(candidate.longitude,4)}°`);
    $('campus-location-options').hidden=true;curveKey='';recompute();
  }
  async function locateCampus(){
    const query=$('campus-name').value.trim();
    if(!query){locationStatus(t('填写学校全名和城市，自动确定经纬度。'));return;}
    if(query===lastLocationQuery)return;
    if(location.protocol==='file:'){locationStatus(t('自动定位需要本地网页预览及网络连接。'));return;}
    const request=++locationRequest;lastLocationQuery=query;locationCandidates=[];$('campus-location-options').hidden=true;
    locationStatus(t('正在查找校园位置…'));
    try{
      const response=await fetch('/api/campus-location?q='+encodeURIComponent(query));
      const result=await response.json();if(request!==locationRequest)return;
      if(!response.ok)throw new Error(result.error?.message||result.error||'location unavailable');
      locationCandidates=result.candidates||[];
      if(locationCandidates.length===1)applyCampusLocation(locationCandidates[0],query);
      else if(locationCandidates.length){
        $('campus-location-options').innerHTML=`<option value="">${h('请选择具体校区')}</option>`+locationCandidates.map((c,i)=>`<option value="${i}">${escape(c.displayName)}</option>`).join('');
        $('campus-location-options').hidden=false;locationStatus(t('找到多个校区，请选择对应地址。'));
      }else{lastLocationQuery='';locationStatus(t('未找到校园，请补充城市或完整校名。'));}
    }catch(error){if(request===locationRequest){lastLocationQuery='';locationStatus(t('定位暂时不可用，请检查网络后重试。'));}}
  }
  function setSolarTime(minutes,fromAnimation=false){
    if(!Number.isFinite(minutes))return;
    if(!fromAnimation)sceneController?.setManualTime?.(minutes);
    state.settings.minutes=Math.max(0,Math.min(1439,Math.round(minutes)));
    $('clock').value=state.settings.minutes;
    $('clock-value').textContent=clock(state.settings.minutes);
    $('clock').setAttribute('aria-valuetext',clock(state.settings.minutes));
    updateRanges();
    if(!fromAnimation)requestDraftPlan(true);
    // Render while dragging, instead of postponing every update until release.
    // Automatic plans follow the chosen departure time; manual trees remain fixed.
    if(!timeFrame)timeFrame=requestAnimationFrame(()=>{timeFrame=0;recompute();});
  }
  function renderSunControl(){
    const sun=state.metrics.solar,angle=sun.azimuth*Math.PI/180;
    $('clock').value=state.settings.minutes;
    $('clock').setAttribute('aria-valuetext',clock(state.settings.minutes));
    document.querySelectorAll('[data-solar-time]').forEach(button=>button.setAttribute('aria-pressed',String(+button.dataset.solarTime===state.settings.minutes)));
    const x=28+15*Math.sin(angle),y=28-15*Math.cos(angle);
    const bearing=`<div class="sun-bearing"><svg viewBox="0 0 56 56" role="img" aria-label="${h('太阳方向')}: ${fmt(sun.azimuth,1)}°"><circle cx="28" cy="28" r="15" fill="none" stroke="#d9e0d9"/><path d="M28 12V44 M12 28H44" stroke="#e5e9e3"/><text x="28" y="7" text-anchor="middle">${h('北')}</text><text x="52" y="31" text-anchor="middle">${h('东')}</text><text x="28" y="54" text-anchor="middle">${h('南')}</text><text x="4" y="31" text-anchor="middle">${h('西')}</text>${sun.daylight?`<path d="M28 28L${x} ${y}" stroke="#bc8b35" stroke-width="1.5"/><circle cx="${x}" cy="${y}" r="3.5" fill="#d5a249"/>`:''}<circle cx="28" cy="28" r="1.8" fill="#708071"/></svg></div>`;
    $('sidebar-solar-position').innerHTML=bearing+`<div class="sun-angles"><span><small>${h('太阳方位角')}</small><strong>${fmt(sun.azimuth,1)}°</strong></span><span><small>${h('太阳高度角')}</small><strong>${fmt(sun.altitude,1)}°</strong></span></div>`;
    $('sidebar-sun-status').textContent=t(!sun.daylight?'暂无太阳直射':state.mode==='manual'?'手动方案：仅更新阴影。':'拖动时刻，重新优化树位。');
  }
  function render(){
    requestDraftPlan();
    originalMapController?.update(C);
    const m=state.metrics,cost=state.trees.length*C.treeTemplate.cost,delta=m.baselineThermal-m.meanThermal,thermalOK=m.thermalValid&&Number.isFinite(m.meanUTCI)&&Number.isFinite(m.baselineUTCI);
    $('budget').max=Math.max(5000,Math.ceil(state.budget/1000)*1000);$('budget').step=state.budget%50===0?50:Number.isInteger(state.budget)?1:.01;$('budget').value=state.budget;
    $('budget-maximum').textContent=money(+$('budget').max);$('budget-value').textContent=money(state.budget);$('clock-value').textContent=clock(state.settings.minutes);updateRanges();
    renderSunControl();
    const shadeValue=m.anyDaylight?`<span class="before-value">${pct(m.baselineRate)}</span><span class="arrow">→</span>${pct(m.shadeRate)}`:'—';
    const shadeLabels=h('种植前')+' → '+h('种植后');
    const thermalValue=thermalOK?`${Math.abs(delta)<.005?'':delta>0?'−':'+'}${fmt(Math.abs(delta),2)}<small> °C</small>`:'—';
    const thermalCompare=thermalOK?`${fmt(m.baselineThermal,2)} → ${fmt(m.meanThermal,2)} °C UTCI`:h(m.length?'超出算法适用范围':'请先确认步道网络。');
    $('overview-metrics').innerHTML=metric('路线遮荫率',shadeValue,shadeLabels)+metric('模型体感差值',thermalValue,thermalCompare)+metric('方案支出',money(cost),h('{n} 棵',{n:state.trees.length})+' · '+h('约 {n} 分钟',{n:fmt(m.walkMinutes,2)}));
    const mapMetrics=metric('路线遮荫率',m.anyDaylight?pct(m.shadeRate):'—',h('种植前')+' '+(m.anyDaylight?pct(m.baselineRate):'—'))+metric('模型体感差值',thermalValue,thermalCompare)+metric('新增树木',fmt(state.trees.length,0),money(cost));
    $('sun-metrics').innerHTML=mapMetrics;
    renderComparison();
    renderMapControls();
    $('budget-summary').innerHTML=`<div class="summary-row"><span>${h('新增树木')}</span><strong>${h('{n} 棵',{n:state.trees.length})}</strong></div><div class="summary-row"><span>${h('已用')}</span><strong>${money(cost)}</strong></div><div class="summary-row"><span>${h(cost>state.budget?'超出预算':'剩余')}</span><strong>${money(Math.abs(state.budget-cost))}</strong></div><div class="summary-row"><span>${h('新增收益')}</span><strong>${fmt(state.audit.gain,3)} min</strong></div>`;
    $('budget-brief').innerHTML=`<span>${h('已用')} <strong>${money(cost)}</strong></span><span>${h('{n} 棵',{n:state.trees.length})}</span>`;
    $('over-budget').hidden=cost<=state.budget;$('over-budget').textContent=t('已超出预算 ${n}，请移除树木或提高预算。',{n:fmt(cost-state.budget,0)});
    $('near-summary').textContent=`${t('{n} 棵',{n:state.plan.nearTrees.length})} / ${money(state.plan.nearCost)} · ${pct(state.plan.retention)}`;
    $('apply-near').disabled=!state.plan.gain;$('undo-tree').disabled=!state.trees.length;$('clear-trees').disabled=!state.trees.length;
    $('plan-mode').textContent=t(state.mode==='manual'?'手动方案':state.mode==='near'?'保留 91% 收益':'当前时段优化')+' · '+clock(state.settings.minutes);
    $('auto-mode').setAttribute('aria-pressed',String(state.mode!=='manual'));$('manual-mode').setAttribute('aria-pressed',String(state.mode==='manual'));
    $('budget-map').classList.toggle('manual',state.mode==='manual');
    ['overview','budget','sun'].forEach(kind=>$(kind+'-map').innerHTML=mapSVG(kind));
    renderNetwork();
    $('tree-count').textContent=t('{n} 棵',{n:state.trees.length});
    $('tree-list').innerHTML=state.trees.length?state.trees.map((tree,i)=>`<button class="tree-row ${state.selected===tree.id?'selected':''}" data-select-tree="${escape(tree.id)}"><span>${h('新树 {n}',{n:i+1})} <code>(${fmt(tree.x,1)}, ${fmt(tree.y,1)})</code></span><strong>${money(C.treeTemplate.cost)}</strong></button>`).join(''):`<p class="muted small">${h('暂无新增树木')}</p>`;
    $('solar-position').innerHTML=`<span><small>${h('太阳高度角')}</small>${fmt(m.solar.altitude,2)}°</span><span><small>${h('太阳方位角')}</small>${fmt(m.solar.azimuth,2)}°</span>`;
    $('night-warning').hidden=!m.fullNight||!m.length;
    const w=m.weather;
    $('thermal-detail').innerHTML=`<div class="thermal-grid">${metric('种植前',fmt(m.baselineThermal,2)+'<small> °C</small>')}${metric('种植后',fmt(m.meanThermal,2)+'<small> °C</small>')}${metric('全程热负荷',fmt(m.heatLoad,2)+'<small> °C·min</small>')}${metric('高温暴露',fmt(m.hotMinutes,2)+'<small> min ≥38°C</small>')}</div><p class="small muted">${h('UTCI 基于固定气象假设，仅作方案对比。')}</p>`;
    renderGainChart();renderAudit();if(state.view==='sun')renderDayChart();renderScene();
  }
  function draftGeometry(campus){return JSON.stringify([campus.bounds,campus.paths,campus.buildings,campus.trees,campus.treeTemplate,campus.location]);}
  function requestDraftPlan(force=false){
    const campus=globalThis.ShadeImportUI.scenePreview();
    if(!campus||!campus.paths?.length){
      if(draftRequestKey){clearTimeout(draftTimer);draftEpoch++;globalThis.ShadePreviewPlan.cancel();draftPlan=null;draftSettings=null;draftRequestKey='';draftGeometryKey='';draftBusy=false;}
      return;
    }
    const geometry=draftGeometry(campus),environment=JSON.stringify([state.budget,state.settings.date,state.settings.latitude,state.settings.longitude,state.settings.timezone]);
    const requestKey=geometry+'|'+environment;
    if(!force&&requestKey===draftRequestKey)return;
    if(geometry!==draftGeometryKey||requestKey!==draftRequestKey){draftPlan=null;draftSettings=null;state.mapFocus=null;}
    draftGeometryKey=geometry;draftRequestKey=requestKey;draftBusy=true;draftError='';
    clearTimeout(draftTimer);const epoch=++draftEpoch;
    draftTimer=setTimeout(async()=>{
      const settings={...state.settings};
      try{
        const plan=await globalThis.ShadePreviewPlan.run(campus,state.budget,settings);
        if(epoch!==draftEpoch)return;
        draftPlan=plan;draftSettings=settings;draftBusy=false;draftError='';render();
      }catch(error){if(epoch!==draftEpoch||error.message==='superseded')return;draftBusy=false;draftError=error.message;renderScene();}
    },450);
  }
  function renderScene(){
    if(!sceneController||!state.metrics)return;
    const preview=globalThis.ShadeImportUI.scenePreview();requestDraftPlan();
    if(preview&&draftPlan){const costCell=$('comparison-table').querySelector('[data-metric=cost] [data-after]');if(costCell)costCell.textContent=money(draftPlan.cost)+'（预览）';$('budget-brief').innerHTML=`<span>预览 <strong>${money(draftPlan.cost)}</strong></span><span>新增 ${draftPlan.trees.length} 棵</span>`;$('sun-metrics').innerHTML=metric('预览新增树木',String(draftPlan.trees.length),'距路缘 0.3–2 m')+metric('方案支出',money(draftPlan.cost),'道路确认后纳入正式计算');}
    sceneController.update({campus:preview||C,trees:preview?(draftPlan?.trees||[]):state.trees,solar:state.metrics.solar,minutes:state.settings.minutes,mapPhase:state.mapPhase,view:state.view,recognizedPreview:Boolean(preview),selected:state.selected,planMinute:preview?draftSettings?.minutes:state.settings.minutes,planSolar:preview&&draftSettings?E.solar(draftSettings):state.metrics.solar,planPending:preview&&draftBusy,planError:preview?draftError:'',planCost:preview?(draftPlan?.cost||0):state.trees.length*C.treeTemplate.cost});
  }
  async function loadCampusPreset(){
    await globalThis.ShadeImportUI.loadPrepared(globalThis.ShadeCampusPreset.create());
  }
  function renderComparison(){
    const m=state.metrics,valid=m.thermalValid&&Number.isFinite(m.meanUTCI)&&Number.isFinite(m.baselineUTCI),shade=m.anyDaylight;
    const sunBefore=Math.max(0,m.daylightFraction-m.baselineRate)*m.walkMinutes;
    const sunAfter=Math.max(0,m.daylightFraction-m.shadeRate)*m.walkMinutes;
    const rows=[
      ['shade','路线遮荫率',shade?pct(m.baselineRate):'—',shade?pct(m.shadeRate):'—'],
      ['sun','直晒时间',fmt(sunBefore,2)+' min',fmt(sunAfter,2)+' min'],
      ['utci','平均 UTCI',valid?fmt(m.baselineUTCI,2)+' °C':'—',valid?fmt(m.meanUTCI,2)+' °C':'—'],
      ['cost','方案支出',money(0),money(state.trees.length*C.treeTemplate.cost)]
    ];
    $('comparison-conditions').textContent=state.settings.date+' · '+clock(state.settings.minutes);
    $('comparison-table').innerHTML=`<table aria-label="${h('遮阳效果对比')}"><thead><tr><th scope="col">${h('方案对比')}</th><th scope="col">${h('优化前')}</th><th scope="col">${h('优化后')}</th></tr></thead><tbody>${rows.map(([id,label,before,after])=>`<tr data-metric="${id}"><th scope="row">${h(label)}${id==='load'?'<small>°C·min</small>':''}</th><td data-before>${before}</td><td data-after>${after}</td></tr>`).join('')}</tbody></table>`;
    $('comparison-summary').innerHTML=`<span>${h('遮荫提升')}</span><strong>${shade?'+'+fmt((m.shadeRate-m.baselineRate)*100,1):'—'} <small>${h('百分点')}</small></strong>`;
  }
  function renderMapControls(){
    document.querySelectorAll('[data-map-controls]').forEach(el=>el.innerHTML=`<div class="segmented map-view-switch" role="group" aria-label="${h('校园平面图')}"><button data-map-layer="shade" aria-pressed="${state.mapLayer==='shade'}">${h('遮阳效果')}</button><button data-map-layer="plan" aria-pressed="${state.mapLayer==='plan'}">${h('种植布局')}</button></div><div class="segmented map-phase-switch" role="group" aria-label="${h('方案对比')}"><button data-map-phase="before" aria-pressed="${state.mapPhase==='before'}">${h('优化前')}</button><button data-map-phase="after" aria-pressed="${state.mapPhase==='after'}">${h('优化后')}</button></div><span class="map-time">${clock(state.settings.minutes)}</span>${el.dataset.mapControls==='sun'?`<button class="button subtle" data-map-focus="${state.mapFocus?'all':'trees'}">${state.mapFocus?'查看全图':'新增树近景'}</button>`: ''}`);
    const shadeLegend=`<span><i class="swatch sun-exposed"></i>${h('阳光')}</span><span><i class="swatch base-shade"></i>${h('原有遮荫')}</span>${state.mapPhase==='after'?`<span><i class="swatch added-shade"></i>${h('新增遮荫')}</span>`:''}<span><i class="swatch crown-outline"></i>${h('树冠轮廓')}</span><span><i class="swatch shared"></i>${h('公共树')}</span>`;
    const planLegend=`<span><i class="swatch"></i>${h('原有树')}</span>${state.mapPhase==='after'?`<span><i class="swatch new"></i>${h('新增树')}</span>`:''}<span><i class="swatch route"></i>${h('行走路线')}</span><span><i class="swatch shared"></i>${h('公共树')}</span>`;
    document.querySelectorAll('[data-legend]').forEach(el=>el.innerHTML=state.mapLayer==='shade'?(state.metrics.daylight?shadeLegend:h('暂无太阳直射')):planLegend);
  }
  function services(tree){return state.metrics.treeServices?.find(row=>row.id===tree.id)?.pathIds||tree.servicePathIds||[];}
  function renderNetwork(){
    const network=E.network(C),rows=state.metrics.pathMetrics||[],shared=state.trees.filter(tree=>services(tree).length>1);
    document.querySelectorAll('[data-network-summary]').forEach(el=>el.innerHTML=network.paths.length?`<span>${h('步道')} <strong>${network.paths.length}</strong></span><span>${h('交叉口')} <strong>${network.intersections.length}</strong></span><span>${h('路网总长')} <strong>${fmt(network.length,1)} m</strong></span><span>${h('公共树')} <strong>${shared.length}</strong></span>`:`<span>${h('请先确认步道网络。')}</span>`);
    $('network-table').innerHTML=rows.length?`<table><thead><tr><th>${h('步道')}</th><th>${h('优化前')}</th><th>${h('优化后')}</th><th>${h('公共树')}</th></tr></thead><tbody>${rows.map(row=>`<tr data-path-result="${escape(row.id)}"><th scope="row">${escape(t(row.name||row.id))}<small>${fmt(row.length,1)} m</small></th><td>${state.metrics.anyDaylight?pct(row.baselineRate):'—'}</td><td>${state.metrics.anyDaylight?pct(row.shadeRate):'—'}</td><td>${shared.filter(tree=>services(tree).includes(row.id)).length}</td></tr>`).join('')}</tbody></table>`:`<p class="small muted">${h('图片作为底图；确认的步道参与计算。')}</p>`;
    document.querySelectorAll('[data-campus-length]').forEach(el=>el.textContent=fmt(network.length,1)+' m');
    document.querySelectorAll('[data-campus-provenance]').forEach(el=>el.textContent=t(C.image?'导入校园底图 · 模型估算':'合成校园 · 模型估算，非实测'));
    globalThis.ShadeImportUI.update();
  }
  function mapSVG(kind){
    const preview=globalThis.ShadeImportUI.scenePreview(),mapCampus=preview||C,mapTrees=preview?(draftPlan?.trees||[]):state.trees;
    const focus=kind==='sun'?state.mapFocus:null;
    const m=state.metrics,shadeView=state.mapLayer==='shade',after=state.mapPhase==='after',W=mapCampus.bounds.width,H=mapCampus.bounds.height,u=(focus?focus.width:Math.max(W,H))/220,sy=y=>H-y;
    const network=E.network(mapCampus),base=E.shadows(mapCampus,m.solar,mapCampus.trees),added=E.shadows(mapCampus,m.solar,after?mapTrees:[]);
    const pts=polygon=>polygon.map(p=>`${p.x},${sy(p.y)}`).join(' '),pathLine=points=>points.map((p,i)=>`${i?'L':'M'}${p.x},${sy(p.y)}`).join(' ');
    const ellipse=e=>`<ellipse cx="${e.x}" cy="${sy(e.y)}" rx="${e.rx}" ry="${e.ry}" transform="rotate(${-e.angle*180/Math.PI} ${e.x} ${sy(e.y)})"/>`;
    const baseShapes=base.buildings.map(poly=>`<polygon points="${pts(poly)}"/>`).join('')+base.trees.map(ellipse).join(''),addedShapes=added.trees.map(ellipse).join('');
    const bNames={teaching:'教学楼',library:'图书馆',activity:'活动室',canteen:'食堂'},margin=8*u;
    let out=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${focus?`${focus.x-focus.width/2} ${sy(focus.y)-focus.width*.32} ${focus.width} ${focus.width*.64}`:`${-margin} ${-margin} ${W+2*margin} ${H+2*margin}`}" data-closeup="${Boolean(focus)}" data-phase="${state.mapPhase}" data-layer="${state.mapLayer}" role="group" aria-label="${h(kind==='budget'?'规划校园地图':kind==='sun'?'太阳阴影校园地图':'概览校园地图')} · ${h(after?'优化后':'优化前')}"><defs><pattern id="grid-${kind}" width="${10*u}" height="${10*u}" patternUnits="userSpaceOnUse"><path d="M${10*u} 0H0V${10*u}" fill="none" stroke="#dbe2cf" stroke-width="${.16*u}"/></pattern><clipPath id="clip-${kind}"><rect width="${W}" height="${H}"/></clipPath><clipPath id="base-shade-${kind}" clipPathUnits="userSpaceOnUse">${baseShapes}</clipPath><clipPath id="added-shade-${kind}" clipPathUnits="userSpaceOnUse">${addedShapes}</clipPath><mask id="net-shade-${kind}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" style="mask-type:luminance"><rect width="${W}" height="${H}" fill="white"/><g fill="black">${baseShapes}</g></mask></defs><rect width="${W}" height="${H}" fill="${shadeView?(m.daylight?'#fff4dc':'#edf0f2'):'#edf0e3'}"/>`;
    if(mapCampus.image)out+=`<image class="campus-background" href="${escape(mapCampus.image.dataUrl)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none" pointer-events="none"/>`;
    else out+=`<rect width="${W}" height="${H}" fill="url(#grid-${kind})"/>`;
    out+=`<g clip-path="url(#clip-${kind})">`;
    network.paths.forEach(path=>{out+=`<path class="network-path" data-path-id="${escape(path.id)}" d="${pathLine(path.points)}" fill="none" stroke="${mapCampus.image?'#fffaf0':'#f9f5e9'}" stroke-opacity="${mapCampus.image?.65:1}" stroke-width="${path.width}" stroke-linejoin="round" stroke-linecap="round"><title>${escape(t(path.name||path.id))}</title></path>`;});
    out+=`<rect class="baseline-shadow" width="${W}" height="${H}" fill="#bdcfc1" opacity="${mapCampus.image?.55:1}" clip-path="url(#base-shade-${kind})"/><rect class="added-shadow" width="${W}" height="${H}" fill="#29ba92" opacity="${mapCampus.image?.78:1}" clip-path="url(#added-shade-${kind})" mask="url(#net-shade-${kind})"/>`;
    mapCampus.buildings.forEach(b=>{const xs=b.polygon.map(p=>p.x),ys=b.polygon.map(p=>p.y),x=(Math.min(...xs)+Math.max(...xs))/2,y=sy((Math.min(...ys)+Math.max(...ys))/2);out+=`<polygon points="${pts(b.polygon)}" fill="#e5e8e3" fill-opacity="${mapCampus.image?.65:1}" stroke="#a8b2a5" stroke-width="${.45*u}"><title>${escape(b.name||t(bNames[b.nameKey]||'建筑'))} · ${b.height} m</title></polygon>${mapCampus.image?'':`<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="#75856d" font-size="${3*u}">${escape(b.name||t(bNames[b.nameKey]||'建筑'))}</text><text x="${x}" y="${y+5*u}" text-anchor="middle" fill="#8c9886" font-family="monospace" font-size="${2.2*u}">${b.height} m</text>`}`;});
    if(shadeView&&preview){
      for(const path of network.paths){const line=pathLine(path.points),width=Math.max(path.width*.44,u*.65);out+=`<path d="${line}" fill="none" stroke="#c7994f" stroke-width="${width}" stroke-linejoin="round"/><path d="${line}" fill="none" stroke="#377655" stroke-width="${width}" stroke-linejoin="round" clip-path="url(#base-shade-${kind})"/>${after?`<path d="${line}" fill="none" stroke="#17b89d" stroke-width="${width}" stroke-linejoin="round" clip-path="url(#added-shade-${kind})" mask="url(#net-shade-${kind})"/>`:''}`;}
    }else if(shadeView){
      const profile=m.mapProfile||m.profile;
      profile.forEach((p,i)=>{const next=profile[i+1];if(!next||p.segmentId!==next.segmentId)return;const fraction=after?(p.shadedFraction??Number(p.shaded)):(p.baselineShadedFraction??Number(p.baselineShaded));const color=p.shadeKind==='night'?'#98a4ab':`rgb(${[197,139,49].map((v,i)=>Math.round(v*(1-fraction)+[33,100,62][i]*fraction)).join(',')})`;out+=`<path d="M${p.x} ${sy(p.y)}L${next.x} ${sy(next.y)}" fill="none" stroke="${color}" stroke-width="${1.3*u}"/>`;});
    }else network.paths.forEach(path=>out+=`<path d="${pathLine(path.points)}" fill="none" stroke="#b78336" stroke-width="${.7*u}" stroke-dasharray="${1.5*u} ${1.5*u}"/>`);
    network.intersections.forEach(point=>out+=`<circle class="network-intersection" cx="${point.x}" cy="${sy(point.y)}" r="${1.5*u}" fill="white" stroke="#64839a" stroke-width="${.65*u}"><title>${h('交叉口')} · ${point.pathIds.length} ${h('步道')}</title></circle>`);
    if(kind==='sun')out+=globalThis.ShadeImportUI.overlay();
    if(!preview)mapCampus.trees.forEach(tree=>out+=drawTree(tree,false,0,kind,mapCampus));if(after)mapTrees.forEach((tree,i)=>out+=drawTree(tree,true,i,kind,mapCampus,Boolean(preview)));
    if(preview)out+=`<text class="preview-plan-caption" x="${8*u}" y="${7*u}" font-size="${3*u}" fill="#196554">${draftBusy?'正在生成贴路方案…':draftPlan?'预览新增 '+mapTrees.length+' 棵 · 方案 '+clock(draftSettings.minutes)+' · 路网待确认':'路网待确认'}</text>`;
    out+='</g>';
    const scale=Math.pow(10,Math.floor(Math.log10(W/8))),scaleLength=Math.floor(W/8/scale)*scale;
    out+=`<g transform="translate(${W-9*u},${10*u})"><path d="M0 ${-5*u} L${-1.5*u} 0 H${1.5*u}Z" fill="#526e56"/><path d="M0 0V${5*u}" stroke="#526e56" stroke-width="${.4*u}"/><text y="${-7*u}" text-anchor="middle" fill="#526e56" font-size="${3.5*u}">${h('北')}</text></g><path d="M${8*u} ${H-8*u}v${2*u}h${scaleLength}v${-2*u}" stroke="#7e8e74" stroke-width="${.4*u}" fill="none"/><text x="${8*u+scaleLength/2}" y="${H-10*u}" text-anchor="middle" fill="#7e8e74" font-size="${2.6*u}">${scaleLength} m</text><text x="${W-8*u}" y="${H-7*u}" text-anchor="end" fill="#7e8e74" font-size="${2.5*u}">${h(mapCampus.image?'导入校园底图 · 模型估算':'合成示例 · 非真实校园')}</text></svg>`;
    return out;
  }
  function drawTree(tree,isNew,i,kind,campus=C,isDraft=false){
    const y=campus.bounds.height-tree.y,u=kind==='sun'&&state.mapFocus?Math.max(1,state.mapFocus.width/220):Math.max(campus.bounds.width,campus.bounds.height)/220,selected=state.selected===tree.id,r=tree.radius,shadeView=state.mapLayer==='shade',service=services(tree),shared=isNew&&service.length>1;
    const interactive=isNew&&!isDraft&&(kind==='budget'||kind==='sun'),tag=isNew?` class="new-tree${shared?' shared-tree':''}${isDraft?' draft-tree':''}" data-tree-id="${escape(tree.id)}" data-service-count="${service.length}"${interactive?` role="button" tabindex="0" aria-label="${h('新树 {n}',{n:i+1})}"`:''}`:'';
    const stroke=isNew?'#068e78':'#859581';
    const crown=`<circle cx="${tree.x}" cy="${y}" r="${r}" fill="${isNew?'#65b86e':shadeView?'transparent':'#b0c09a'}" fill-opacity="${isNew?.86:.6}" stroke="${stroke}" stroke-width="${isNew?.45*u:.27}"${!isNew&&shadeView?' stroke-dasharray=".7 .6"':''}/>`;
    const offset=Number.isFinite(tree.roadsideOffset)?' · 距路缘 '+fmt(tree.roadsideOffset,2)+' m':'';
    return `<g${tag}><title>${h(isNew?'新增树木':'原有树')}${isNew?' '+(i+1):''}${offset}${shared?' · '+h('公共树'):''}</title><circle class="tree-halo" cx="${tree.x}" cy="${y}" r="${r+(isNew?1.1*u:1.1)}" fill="none" stroke="${selected?'#e8a32e':isNew?'#04ae93':'transparent'}" stroke-width="${isNew?.65*u:.8}"/>${crown}<circle cx="${tree.x}" cy="${y}" r="${isNew?Math.max(.5,u*.25):.5}" fill="#285c46"/>${isNew?`<text x="${tree.x}" y="${y-r-1.8*u}" text-anchor="middle" fill="#066d59" stroke="white" stroke-width="${.8*u}" paint-order="stroke" font-family="monospace" font-weight="700" font-size="${2.7*u}">+${i+1}</text>`:''}</g>`;
  }
  function chartSVG(lines,{xmax=5000,ymax=3,xLabel='',yFormat=n=>fmt(n,1),xFormat=n=>fmt(n,0),point=null,timeMarker=null,xticks=5}={}){
    const W=620,H=230,L=48,R=22,T=16,B=38,w=W-L-R,hh=H-T-B;
    let out=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(xLabel)}">`;
    for(let i=0;i<5;i++){const value=ymax*i/4,y=T+hh*(1-i/4);out+=`<path d="M${L} ${y}H${W-R}" stroke="#e1e6d9" stroke-width="1"/><text x="${L-10}" y="${y+3}" text-anchor="end" font-size="10" fill="#7a8872" font-family="monospace">${escape(yFormat(value))}</text>`;}
    for(let i=0;i<=xticks;i++){const x=L+w*i/xticks;out+=`<text x="${x}" y="${H-18}" text-anchor="middle" font-size="10" fill="#7a8872" font-family="monospace">${escape(xFormat(xmax*i/xticks))}</text>`;}
    lines.forEach(line=>{let path='',gap=true;for(const p of line.values){if(p.y===null){gap=true;continue;}path+=`${gap?'M':'L'}${L+w*p.x/xmax},${T+hh*(1-p.y/ymax)} `;gap=false;}out+=`<path d="${path}" fill="none" stroke="${line.color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" ${line.dash?'stroke-dasharray="5 4"':''}/>`;});
    if(timeMarker!==null){const x=L+w*timeMarker/xmax,label=clock(timeMarker);out+=`<g class="current-time-marker" aria-label="${h('模拟时刻')} ${label}"><path d="M${x} ${T}V${T+hh}" fill="none" stroke="#9a702c" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${x}" y="${T-5}" text-anchor="${timeMarker<40?'start':timeMarker>1400?'end':'middle'}" font-size="10" fill="#9a702c" font-family="monospace">${label}</text></g>`;}
    else if(point&&point.y!==null)out+=`<circle cx="${L+w*point.x/xmax}" cy="${T+hh*(1-point.y/ymax)}" r="4.5" fill="#fffef7" stroke="#2d6548" stroke-width="2"/>`;
    return out+'</svg>';
  }
  function renderGainChart(){const ceiling=Math.max(5000,state.budget),full=E.optimize(C,ceiling,state.settings);$('gain-chart').innerHTML=chartSVG([{color:'#2d6548',values:full.curve.map(p=>({x:p.cost,y:p.gain}))}],{xmax:ceiling,ymax:Math.max(.5,Math.ceil((full.gain||0)*2)/2),xLabel:t('预算与收益'),xFormat:v=>money(v),point:state.mode==='manual'?null:{x:state.trees.length*C.treeTemplate.cost,y:state.audit.gain}});}
  function renderDayChart(){
    const key=JSON.stringify([state.settings.date,state.settings.latitude,state.settings.longitude,state.settings.timezone,state.budget,state.mode,state.mode==='manual'?state.trees:null]);
    if(curveKey!==key){
      clearTimeout(curveTimer);curveKey=key;dayCurve=[];curvePending=true;
      const generation=++curveGeneration,campus=C,baseSettings={...state.settings},budget=state.budget,mode=state.mode,manualTrees=state.trees.slice();
      let minutes=0;
      // Yield between complete scenarios so a large imported network stays editable.
      const next=()=>{
        if(generation!==curveGeneration||curveKey!==key)return;
        if(state.view!=='sun'){curveKey='';curvePending=false;curveTimer=0;return;}
        const settings={...baseSettings,minutes},plan=mode==='manual'?null:E.optimize(campus,budget,settings),trees=plan?(mode==='near'?plan.nearTrees:plan.trees):manualTrees;
        const m=E.evaluate(campus,trees,settings);
        dayCurve.push({minutes,before:m.anyDaylight?m.baselineRate:null,after:m.anyDaylight?m.shadeRate:null});
        minutes+=30;curvePending=minutes<=1440;drawDayChart();
        curveTimer=curvePending?setTimeout(next,30):0;
      };
      curveTimer=setTimeout(next,60);
    }
    drawDayChart();
  }
  function drawDayChart(){
    $('day-chart').setAttribute('aria-busy',String(curvePending));
    $('day-chart').innerHTML=chartSVG([{color:'#99a98c',dash:true,values:dayCurve.map(p=>({x:p.minutes,y:p.before}))},{color:'#2d6548',values:dayCurve.map(p=>({x:p.minutes,y:p.after}))}],{xmax:1440,ymax:1,xLabel:t('全天路线遮荫率'),yFormat:v=>Math.round(v*100)+'%',xFormat:v=>v===1440?'24:00':clock(v),xticks:6,timeMarker:state.settings.minutes})+(curvePending?`<p class="small muted">${h('正在生成全天曲线…')} ${dayCurve.length}/49</p>`:'');
  }
  function renderAudit(){
    $('optimizer-audit').innerHTML=globalThis.ShadeAuditChart.render({
      campus:C,candidates:E.candidates(C,state.settings),trees:state.trees,
      selectionAudit:state.mode==='manual'?[]:state.plan.audit,
      selected:state.selected,translate:t,format:fmt,treeServices:state.metrics.treeServices
    });
  }
  function download(filename,object){const blob=new Blob([JSON.stringify(object,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出校园数据');}
  function report(){flushPending();return {schemaVersion:1,generatedAt:new Date().toISOString(),provenance:'synthetic-model-not-measured',settings:state.settings,budget:state.budget,mode:state.mode,solar:state.metrics.solar,metrics:state.metrics,optimization:{...state.plan,currentPlanAudit:state.audit,currentTrees:state.trees},algorithmSources:{solar:'https://gml.noaa.gov/grad/solcalc/calcdetails.html',utci:'https://utci.org/utci_calc.php'},limitations:['Synthetic geometry, weather and pedestrian demand','Opaque spherical crowns; convex footprints','UTCI polynomial operating domain enforced; radiation input is synthetic','Greedy solution not global optimum; 91% retained-gain prefix is not a proven knee']};}
  $('language').addEventListener('change',event=>{state.lang=event.target.value;try{localStorage.setItem('shadepath-language',state.lang);}catch{}localize();globalThis.ShadeSidebar.init({translate:t});render();});
  $('budget').addEventListener('input',event=>{state.budget=+event.target.value;$('budget-value').textContent=money(state.budget);updateRanges();schedule();});
  $('clock').addEventListener('input',event=>setSolarTime(+event.target.value));
  document.querySelectorAll('[data-solar-time]').forEach(button=>button.addEventListener('click',()=>setSolarTime(+button.dataset.solarTime)));
  const settingsFields={date:'date'};
  $('locate-campus').addEventListener('click',locateCampus);
  $('campus-name').addEventListener('blur',locateCampus);
  $('campus-name').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();locateCampus();}});
  $('campus-name').addEventListener('input',()=>{locationRequest++;lastLocationQuery='';$('campus-location-options').hidden=true;});
  $('campus-location-options').addEventListener('change',event=>{if(event.target.value!==''){const candidate=locationCandidates[+event.target.value];if(candidate)applyCampusLocation(candidate,$('campus-name').value.trim());}});
  for(const [id,key] of Object.entries(settingsFields))$(id).addEventListener('input',event=>{const el=event.target;if(!el.value||!el.checkValidity())return;state.settings[key]=id==='date'?el.value:+el.value;updateLocationTimezone();updateRanges();schedule();});
  $('auto-mode').addEventListener('click',()=>{state.mode='auto';state.selected=null;recompute();toast('自动优化已恢复');});
  $('manual-mode').addEventListener('click',()=>{state.mode='manual';state.mapPhase='after';state.mapLayer='plan';location.hash='budget';render();toast('手动种植已开启');});
  $('apply-near').addEventListener('click',()=>{state.mode='near';recompute();toast('节省方案已应用');});
  $('clear-trees').addEventListener('click',()=>{state.mode='manual';state.trees=[];state.selected=null;recompute(false);toast('已清空');});
  $('undo-tree').addEventListener('click',()=>{state.mode='manual';state.trees.pop();state.selected=null;recompute(false);toast('已撤销');});
  $('reset-settings').addEventListener('click',()=>{state.settings.date=E.defaults.date;$('date').value=state.settings.date;updateLocationTimezone();recompute();});
  function mapInteraction(event){
    const treeElement=event.target.closest('[data-tree-id]');
    if(treeElement){if(state.mode==='manual'){state.trees=state.trees.filter(t=>t.id!==treeElement.dataset.treeId);recompute(false);toast('已移除一棵树');}else{state.selected=treeElement.dataset.treeId;render();}return;}
    if(state.mode!=='manual'||state.mapPhase==='before')return;
    const svg=event.target.closest('svg');if(!svg)return;const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;const p=point.matrixTransform(svg.getScreenCTM().inverse());
    const position={x:Math.round(p.x*10)/10,y:Math.round((C.bounds.height-p.y)*10)/10},valid=E.validPlant(C,position,state.trees);
    if(!valid.valid){toast({outside:'请在校园范围内种植。',building:'此处与建筑太近。',route:'请保留步道通行空间。',overlap:'此处与其他树太近。'}[valid.reason]||'当前位置无法种树');return;}
    state.trees.push(E.treeAt(C,position.x,position.y,'manual-'+Date.now()));recompute(false);toast('已添加一棵树');
  }
  $('budget-map').addEventListener('click',mapInteraction);
  $('sun-map').addEventListener('click',event=>{if(!globalThis.ShadeImportUI.isEditing()&&event.target.closest('[data-tree-id]')){state.selected=event.target.closest('[data-tree-id]').dataset.treeId;render();}});
  $('budget-map').addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.closest('[data-tree-id]')){event.preventDefault();mapInteraction(event);}});
  $('tree-list').addEventListener('click',event=>{const row=event.target.closest('[data-select-tree]');if(row){state.selected=row.dataset.selectTree;state.mapPhase='after';state.mapLayer='plan';render();}});
  function selectAuditTree(event){
    if(event.type==='keydown'&&event.key!=='Enter'&&event.key!==' ')return;
    const point=event.target.closest('[data-audit-tree]');if(!point)return;
    if(event.type==='keydown')event.preventDefault();
    state.selected=point.dataset.auditTree;state.mapPhase='after';render();
    if(event.type==='keydown')$('optimizer-audit').querySelector(`[data-audit-tree="${CSS.escape(state.selected)}"]`)?.focus();
  }
  $('optimizer-audit').addEventListener('click',selectAuditTree);
  $('optimizer-audit').addEventListener('keydown',selectAuditTree);
  document.querySelectorAll('[data-export]').forEach(button=>button.addEventListener('click',()=>{flushPending();download('campus.json',E.exportCampus(C,state.trees,state.settings,state.budget));}));
  document.querySelectorAll('[data-report]').forEach(button=>button.addEventListener('click',()=>download('shadepath-calculation-report.json',report())));
  document.querySelectorAll('[data-map-controls]').forEach(el=>el.addEventListener('click',event=>{
    const layer=event.target.closest('[data-map-layer]'),phase=event.target.closest('[data-map-phase]');
    if(layer)state.mapLayer=layer.dataset.mapLayer;
    if(phase)state.mapPhase=phase.dataset.mapPhase;
    const focus=event.target.closest('[data-map-focus]');if(focus){if(focus.dataset.mapFocus==='all')state.mapFocus=null;else{const trees=globalThis.ShadeImportUI.scenePreview()?draftPlan?.trees:state.trees;const tree=trees?.[0];if(tree)state.mapFocus={x:tree.x,y:tree.y,width:Math.min(C.bounds.width,110)};}}
    if(layer||phase||focus)render();
  }));
  window.addEventListener('hashchange',setView);
  originalMapController=globalThis.ShadeOriginalMap?.init({container:$('campus-original-map')});
  globalThis.ShadeImportUI.init({getCampus:()=>C,setCampus:replaceCampus,refresh:()=>render(),notify:toast,translate:t});
  sceneController=globalThis.ShadeScene3D?.init({container:$('campus-scene-sidebar'),translate:t,onShowOriginal:()=>originalMapController?.open(),onTimeChange:minutes=>setSolarTime(minutes,true),onManualTimeChange:minutes=>setSolarTime(minutes),onReplan:()=>{if(globalThis.ShadeImportUI.scenePreview())requestDraftPlan(true);else recompute();renderScene();},onPhaseChange:phase=>{state.mapPhase=phase;render();},onFocusPoint:point=>{state.mapFocus={x:point.x,y:-point.z,width:Math.min(C.bounds.width,110)};$('sun-map').innerHTML=mapSVG('sun');renderMapControls();},solarForTime:minutes=>E.solar({...state.settings,minutes}),onLoadPreset:()=>loadCampusPreset().catch(error=>toast(error.message))});
  localize();globalThis.ShadeSidebar.init({translate:t});setView();
  if(globalThis.ShadeCampusPreset)loadCampusPreset().catch(error=>{toast(error.message);recompute();syncCampusLocation();});
  else {recompute();syncCampusLocation();}
  // Read-only inspection hook for reproducible local verification; no network or storage required.
  globalThis.ShadePath=Object.freeze({snapshot:()=>JSON.parse(JSON.stringify({settings:state.settings,budget:state.budget,mode:state.mode,mapLayer:state.mapLayer,mapPhase:state.mapPhase,trees:state.trees,metrics:state.metrics,audit:state.audit,language:state.lang})),report});
})();

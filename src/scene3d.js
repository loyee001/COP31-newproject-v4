/* Offline campus viewer: east=x, north=-z, one physical sun, no baked shadows. */
(function () {
  'use strict';
  function init({container,onLoadPreset,onTimeChange,onManualTimeChange,solarForTime,onPhaseChange,onReplan,onFocusPoint,onShowOriginal}) {
    const T=globalThis.THREE;
    container.innerHTML=`<section class="shade3d">
      <header class="shade3d-head"><div><span class="shade3d-eyebrow">CAMPUS / SUN & SHADE</span><strong>校园 3D 模拟</strong><button type="button" class="shade3d-campus" data-action="original">清华大学校区 · 查看原图 ↗</button></div><time class="shade3d-time"></time>
      <div class="shade3d-controls"><button data-action="overview">全景</button><button data-action="close">近景</button><button data-action="rotate" aria-pressed="false">旋转视角</button><button data-action="follow" aria-pressed="false">跟随行人</button><button data-action="outcome" disabled>查看新增树</button><button data-action="expand">放大面板</button><button data-action="load">加载本图</button></div></header>
      <div class="shade3d-stage"><div class="shade3d-status" role="status"></div><div class="shade3d-light"><span class="shade3d-light-icon">☀</span><span class="shade3d-light-text"></span></div><div class="shade3d-focus-mark" hidden><span>＋</span>对焦中心</div><div class="shade3d-walk-badge"></div></div>
      <div class="shade3d-sun-control"><div><span>太阳时刻</span><span class="shade3d-loop-note">09:00 → 20:00 · 循环</span><button data-action="sun-play" aria-pressed="true">暂停太阳</button></div><input class="shade3d-clock" type="range" min="540" max="1200" step="1" value="540" aria-label="3D 太阳时刻"><small>09:00 <span>1 秒 = 10 分钟</span> 20:00</small></div>
      <div class="shade3d-plan-control"><div class="shade3d-phase"><button data-action="before" aria-pressed="false">优化前</button><button data-action="after" aria-pressed="true">优化后</button><button data-action="replan">优化此时刻</button></div><div class="shade3d-plan-summary"></div><div class="shade3d-plan-comparison"></div></div>
      <div class="shade3d-walk-control"><div class="shade3d-walk-title"><strong>沿路步行</strong><span class="shade3d-walk-distance"></span><button data-action="walk-play">开始行走</button><button data-action="walk-reset" title="回到起点">重走</button></div><div class="shade3d-walk-route"></div><progress class="shade3d-walk-progress" max="1" value="0" aria-label="行走进度"></progress><div class="shade3d-walk-description"></div></div>
      <div class="shade3d-legend"><span><i class="cyan"></i>新增树荫</span><span><i class="orange"></i>日晒</span><span><i class="tree"></i>原有遮荫</span></div>
      <p class="shade3d-hint">拖动平移对焦 · 滚轮缩放 · 双击对焦 · Alt 拖动旋转</p><p class="shade3d-note">楼高 9–15 m、冠心高 8 m 为示意。步行遮荫率采用球冠计算模型，细节树冠为视觉表达。</p>
    </section>`;
    const root=container.querySelector('.shade3d'),stage=root.querySelector('.shade3d-stage'),status=root.querySelector('.shade3d-status');
    if(!T){status.textContent='3D 渲染组件未加载';return{update(){},resize(){},destroy(){container.innerHTML='';}};}
    let renderer;
    try{renderer=new T.WebGLRenderer({antialias:true,alpha:false});}catch(_){status.textContent='当前浏览器无法启动 3D 渲染';return{update(){},resize(){},destroy(){container.innerHTML='';}};}
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
    renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','校园三维场景，使用方向键旋转，加减键缩放');stage.prepend(renderer.domElement);
    const scene=new T.Scene();scene.background=new T.Color(0xe3e8e4);
    const camera=new T.PerspectiveCamera(42,1,.1,10000),ambient=new T.HemisphereLight(0xc9deec,0x8c9074,1),sun=new T.DirectionalLight(0xffecd6,3.1);
    scene.add(ambient,sun,sun.target);sun.castShadow=true;
    const shadowSize=Math.min(4096,renderer.capabilities.maxTextureSize);sun.shadow.mapSize.set(shadowSize,shadowSize);sun.shadow.bias=-.000015;sun.shadow.normalBias=.035;
    const world=new T.Group();scene.add(world);
    let dirty=true,campus=null,signature='',sceneIdentity='',textureToken=0,destroyed=false,dragging=false,lastX=0,lastY=0,span=200;
    let angle=-.8,elevation=.72,distance=300,target=new T.Vector3(),centre=new T.Vector3(),walk=null,following=false;
    let currentSolar=null,currentMinute=540,solarPlaying=true,solarStarted=false,autoTimer=0,sunTick=0,pendingAutoMinute=null,endpointPause=0;
    let currentPlan=null,planSolar=null,planMinute=null,planTreeKey='',phase='after';
    let requestedWalk=false,walkUIStamp=0,savedWalk=null,rotateMode=false,rotatingDrag=false,panAnchor=null,focusTimer;
    const pickRay=new T.Raycaster(),pickPointer=new T.Vector2(),groundPlane=new T.Plane(new T.Vector3(0,1,0),0);
    const disposable=[];
    function track(x){disposable.push(x);return x;}
    const surfaces=globalThis.ShadeSceneSurfaces.create({THREE:T,track,renderer});
    function clear(){textureToken++;walk?.dispose();walk=null;world.clear();while(disposable.length)disposable.pop().dispose();}
    function mat(color,opts={}){return track(new T.MeshStandardMaterial({color,roughness:.85,...opts}));}
    function mesh(geometry,material){const m=new T.Mesh(track(geometry),material);world.add(m);return m;}
    function fitShadow(){
      if(!currentSolar)return;
      sun.updateMatrixWorld();sun.target.updateMatrixWorld();sun.shadow.updateMatrices(sun);
      const focus=target.clone().applyMatrix4(sun.shadow.camera.matrixWorldInverse);
      const extent=Math.min(span*.85,Math.max(35,distance*.8));
      Object.assign(sun.shadow.camera,{left:focus.x-extent,right:focus.x+extent,top:focus.y+extent,bottom:focus.y-extent,near:.2,far:span*4});sun.shadow.camera.updateProjectionMatrix();
    }
    function positionCamera(){elevation=Math.max(.15,Math.min(1.45,elevation));distance=Math.max(18,Math.min(span*3.5,distance));camera.position.set(target.x+distance*Math.cos(elevation)*Math.sin(angle),target.y+distance*Math.sin(elevation),target.z+distance*Math.cos(elevation)*Math.cos(angle));camera.lookAt(target);camera.near=Math.max(.1,span/3000);camera.far=span*10;camera.updateProjectionMatrix();fitShadow();dirty=true;}
    function setFollowing(value){following=Boolean(value);root.querySelector('[data-action=follow]').setAttribute('aria-pressed',String(following));}
    function focusWalker(){const focus=walk?.getFocus();if(!focus)return;setFollowing(true);target.set(focus.point.x,focus.point.y,focus.point.z);angle=-.6;elevation=.9;distance=focus.distance||50;positionCamera();}
    function focusOutcome(){
      const focus=walk?.getOutcomeFocus?.();if(!focus)return;
      walk.seek(focus.progress);walk.setPlaying(false);setFollowing(false);target.set(focus.point.x,focus.point.y,focus.point.z);angle=-.6;elevation=.88;distance=focus.distance||44;positionCamera();updateWalkUI();onFocusPoint?.(focus.point);
    }
    function reset(close){setFollowing(false);target.copy(centre);if(close){target.x-=span*.03;target.z-=span*.12;}angle=close?-.6:-.8;elevation=close?.48:.8;distance=span*(close?.28:1.24);positionCamera();}
    function resize(){const w=stage.clientWidth,h=stage.clientHeight;if(w&&h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();dirty=true;}}
    function instances(rows,geometry,material,cast=false){if(!rows.length)return;const m=track(new T.InstancedMesh(track(geometry),material,rows.length)),d=new T.Object3D();m.castShadow=cast;m.receiveShadow=true;rows.forEach((r,i)=>{d.position.set(r.x,r.y,r.z);d.rotation.set(0,r.angle||0,0);d.scale.set(r.width,r.height,r.depth);d.updateMatrix();m.setMatrixAt(i,d.matrix);});world.add(m);return m;}
    function buildings(c){
      const panes=[],frames=[],mullions=[],sills=[],cornices=[];
      const wallMats=[surfaces.surface(0xc4aa8d,'stone'),surfaces.surface(0xad7f65,'brick'),surfaces.surface(0xd0c4ae,'stone')],roof=surfaces.surface(0x827f73,'roof');
      (c.buildings||[]).forEach((b,i)=>{
        const p=b.polygon||[];if(p.length<3)return;const h=Math.max(1,Number(b.height)||10),shape=new T.Shape();shape.moveTo(p[0].x,p[0].y);p.slice(1).forEach(q=>shape.lineTo(q.x,q.y));shape.closePath();
        const body=mesh(new T.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false}),wallMats[i%3]);body.rotation.x=-Math.PI/2;body.castShadow=body.receiveShadow=true;
        const cap=mesh(new T.ShapeGeometry(shape),roof);cap.rotation.x=-Math.PI/2;cap.position.y=h+.02;cap.receiveShadow=true;
        const winding=p.reduce((s,a,j)=>{const b=p[(j+1)%p.length];return s+a.x*b.y-b.x*a.y;},0)>=0?1:-1;
        p.forEach((a,j)=>{
          const b=p[(j+1)%p.length],dx=b.x-a.x,dy=b.y-a.y,dz=-dy,len=Math.hypot(dx,dy);if(len<2)return;
          const angle=-Math.atan2(dz,dx),nx=dy/len*winding,nz=dx/len*winding;
          const rows=Math.max(1,Math.floor(h/3.5)),cols=Math.max(1,Math.floor(len/3.4));
          for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
            const u=(col+.5)/cols,x=a.x+dx*u,z=-a.y+dz*u,y=h*(row+.55)/rows,w=Math.min(1.95,len/cols*.64),wh=Math.min(2.1,h/rows*.56);
            frames.push({x:x+nx*.08,y,z:z+nz*.08,width:w+.22,height:wh+.2,depth:.22,angle});
            panes.push({x:x+nx*.22,y,z:z+nz*.22,width:w,height:wh,depth:.07,angle});
            mullions.push({x:x+nx*.27,y,z:z+nz*.27,width:.065,height:wh,depth:.08,angle});
            sills.push({x:x+nx*.2,y:y-wh/2-.1,z:z+nz*.2,width:w+.4,height:.12,depth:.48,angle});
          }
          cornices.push({x:(a.x+b.x)/2,y:h+.17,z:-(a.y+b.y)/2,width:len,height:.34,depth:.45,angle});
          cornices.push({x:(a.x+b.x)/2,y:.3,z:-(a.y+b.y)/2,width:len,height:.6,depth:.25,angle});
        });
      });
      const trim=mat(0xc7c3b6),frame=mat(0xbbb8aa),glass=mat(0x54737a,{roughness:.24,metalness:.28}),metal=mat(0x596063,{roughness:.5});
      instances(frames,new T.BoxGeometry(1,1,1),frame);instances(panes,new T.BoxGeometry(1,1,1),glass);instances(mullions,new T.BoxGeometry(1,1,1),metal);instances(sills,new T.BoxGeometry(1,1,1),trim);instances(cornices,new T.BoxGeometry(1,1,1),trim,true);
    }
    function build(c,added,phase,selected){
      const previous=walk?.getState();if(previous?.totalDistance>0)savedWalk=previous;clear();const W=c.bounds.width,H=c.bounds.height;span=Math.max(W,H);centre.set(W/2,0,-H/2);
      const ground=mesh(new T.PlaneGeometry(W,H),surfaces.surface(0xffffff,'terrain'));ground.rotation.x=-Math.PI/2;ground.position.set(W/2,-.06,-H/2);ground.receiveShadow=true;
      if(c.image?.dataUrl){const token=textureToken;surfaces.terrain(c.image.dataUrl,texture=>{if(destroyed||token!==textureToken){texture.dispose();return;}track(texture);ground.material.map=texture;ground.material.needsUpdate=true;dirty=true;});}
      const roadRows=[];
      for(const p of c.paths||[])for(let j=1;j<(p.points||[]).length;j++){const a=p.points[j-1],b=p.points[j],dx=b.x-a.x,dz=-(b.y-a.y),len=Math.hypot(dx,dz);if(len)roadRows.push({x:(a.x+b.x)/2,y:.05,z:-(a.y+b.y)/2,width:Math.max(.6,p.width||3),height:.1,depth:len,angle:Math.atan2(dx,dz)});}
      instances(roadRows,new T.BoxGeometry(1,1,1),surfaces.surface(0xb9b4aa,'paving'));
      buildings(c);
      const all=(c.trees||[]).map(t=>({t,added:false})).concat(phase==='before'?[]:(added||[]).map(t=>({t,added:true})));
      globalThis.ShadeSceneTrees.create({THREE:T,world,track,trees:all,selected});
      walk=globalThis.ShadeSceneWalk?.create({THREE:T,world,track,campus:c,trees:all.map(r=>r.t),comparisonTrees:added||[],planSolar,phase});
      if(savedWalk){if(savedWalk.routeId===walk?.getState().routeId)walk?.seek?.(savedWalk.progress);walk?.setPlaying(savedWalk.playing);}else if(requestedWalk)walk?.setPlaying(true);
      sun.target.position.copy(centre);fitShadow();updateWalkUI();
    }
    function updateWalkUI(){
      const s=walk?.getState();root.querySelector('.shade3d-walk-control').hidden=!s||!s.totalDistance;
      if(!s)return;
      root.querySelector('.shade3d-walk-distance').textContent=Math.round(s.distance)+' / '+Math.round(s.totalDistance)+' m';
      root.querySelector('.shade3d-walk-route').textContent=(s.routeLabel||'演示路线')+' · '+(s.startLabel||'起点 A')+' → '+(s.endLabel||'终点 B');
      root.querySelector('.shade3d-walk-progress').value=s.progress;
      root.querySelector('[data-action=walk-play]').textContent=s.finished?'再走一次':s.playing?'暂停行走':'开始行走';
      const label=s.shadeKind==='night'?'暂无太阳直射':s.shadeKind==='newTree'?'新增行道树荫中':s.shadeKind==='tree'?'树荫中':s.shadeKind==='building'?'建筑阴影中':'阳光直晒';
      root.querySelector('.shade3d-plan-comparison').textContent=s.baselinePercent==null?'示范路线 · 暂无太阳直射':'示范路线遮荫 '+s.baselinePercent.toFixed(1)+'% → '+s.afterPercent.toFixed(1)+'% · +'+s.improvementPercent.toFixed(1)+' 个百分点';
      const badge=root.querySelector('.shade3d-walk-badge');badge.textContent='行人 · '+label;badge.dataset.shade=s.shadeKind;
      root.querySelector('.shade3d-walk-description').textContent='6 倍速演示 · '+(s.shadeKind==='night'?'当前无直射':('当前路线遮荫 '+Math.round(s.shadePercent)+'%'))+(s.finished?' · 已到终点':'');
    }
    function lighting(solar,minute){
      currentSolar=solar;const alt=Number(solar.altitude)||0,az=(Number(solar.azimuth)||0)*Math.PI/180,a=alt*Math.PI/180,dist=span*1.5;
      sun.position.set(centre.x+Math.sin(az)*Math.cos(a)*dist,Math.sin(a)*dist,centre.z-Math.cos(az)*Math.cos(a)*dist);
      const daylight=Math.max(0,Math.min(1,alt/12)),warm=Math.max(0,Math.min(1,(alt-5)/40));
      sun.color.set(0xffb665).lerp(new T.Color(0xfff1df),warm);sun.intensity=alt>0?(2.1+1.2*Math.sin(a))*daylight:0;
      ambient.intensity=alt>0?.56+.35*daylight:.22;scene.background.set(alt>0?0xe2e7e4:0x283746);renderer.toneMappingExposure=alt>0?1.12:.82;
      const time=Math.round(minute);root.querySelector('.shade3d-time').textContent=String(Math.floor(time/60)).padStart(2,'0')+':'+String(time%60).padStart(2,'0');
      root.querySelector('.shade3d-clock').value=Math.max(540,Math.min(1200,time));
      const bearing=((solar.azimuth+180)%360),dirs=['北','东北','东','东南','南','西南','西','西北'];
      root.querySelector('.shade3d-light-text').textContent=alt>0?'太阳高度 '+alt.toFixed(1)+'° · 阴影向'+dirs[Math.round(bearing/45)%8]:'日落后 · 无太阳直射';
      root.querySelector('.shade3d-light-icon').textContent=alt>0?'☀':'◒';
      walk?.updateSolar(solar);fitShadow();dirty=true;
    }
    function solarButtons(){const b=root.querySelector('[data-action=sun-play]');b.textContent=solarPlaying?'暂停太阳':'继续太阳';b.setAttribute('aria-pressed',String(solarPlaying));}
    function syncTime(minute){pendingAutoMinute=Math.round(minute);onTimeChange?.(pendingAutoMinute);}
    function update(next){
      const c=next?.campus,valid=c&&c.metadata?.presetId==='tsinghua-plan'&&c.bounds?.width>0&&c.bounds?.height>0;
      const originalButton=root.querySelector('[data-action=original]');originalButton.hidden=!c?.image?.dataUrl;originalButton.textContent=valid?'清华大学校区 · 查看原图 ↗':'查看校园原图 ↗';
      status.textContent=valid?(next.planError?'方案计算未完成 · '+next.planError:next.planPending?'正在生成贴近步道的种植方案…':next.recognizedPreview?'种植方案预览 · 路网待确认':'示意模型 · 尺寸待校准'):'当前仅提供指定平面图的 3D 场景';status.hidden=false;renderer.domElement.style.visibility=valid?'visible':'hidden';
      if(!valid){if(campus){clear();campus=null;signature='';}return;}
      currentPlan=next.trees||[];planSolar=next.planSolar||next.solar;planMinute=next.planMinute;phase=next.mapPhase||'after';
      root.querySelector('[data-action=outcome]').disabled=!currentPlan.length;
      root.querySelector('[data-action=replan]').disabled=Boolean(next.planPending);
      root.querySelector('[data-action=before]').setAttribute('aria-pressed',String(phase==='before'));root.querySelector('[data-action=after]').setAttribute('aria-pressed',String(phase==='after'));
      const planClock=Number.isFinite(planMinute)?String(Math.floor(planMinute/60)).padStart(2,'0')+':'+String(planMinute%60).padStart(2,'0'):'—';
      root.querySelector('.shade3d-plan-summary').textContent=next.planPending?'正在按真实树影选择树位…':'方案 '+planClock+' · 新增 '+currentPlan.length+' 棵 · $'+(next.planCost||0)+' · 路缘外 0.3–2 m';
      const nextTreeKey=JSON.stringify(currentPlan.map(t=>[t.id,t.x,t.y]));const planArrived=currentPlan.length>0&&planTreeKey!==nextTreeKey;planTreeKey=nextTreeKey;
      const identity=c.metadata.presetId+'|'+c.bounds.width+'|'+c.bounds.height,changed=identity!==sceneIdentity;sceneIdentity=identity;
      const key=JSON.stringify([c.bounds,c.paths,c.buildings,c.trees,next.trees,next.mapPhase,next.selected,currentPlan.length?planSolar:null]);
      if(key!==signature){campus=c;signature=key;build(c,next.trees,next.mapPhase,next.selected);if(changed)reset(false);else positionCamera();}
      const minute=Number(next.minutes)||0;
      if(!solarStarted&&walk?.getState().totalDistance>0){solarStarted=true;currentMinute=540;autoTimer=1;requestedWalk=true;walk.setPlaying(true);focusWalker();syncTime(540);}
      else if(!solarStarted){currentMinute=minute;}
      else if(!solarPlaying){currentMinute=minute;}
      lighting(solarPlaying&&solarForTime?solarForTime(currentMinute):next.solar||{},currentMinute);updateWalkUI();if(planArrived){const playing=walk?.getState().playing;focusOutcome();walk?.setPlaying(playing);}
    }
    function groundAt(e){const rect=renderer.domElement.getBoundingClientRect();pickPointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);camera.updateMatrixWorld();pickRay.setFromCamera(pickPointer,camera);return pickRay.ray.intersectPlane(groundPlane,new T.Vector3());}
    function showFocus(){clearTimeout(focusTimer);root.querySelector('.shade3d-focus-mark').hidden=false;focusTimer=setTimeout(()=>root.querySelector('.shade3d-focus-mark').hidden=true,1000);}
    function pointerDown(e){setFollowing(false);dragging=true;rotatingDrag=(rotateMode||e.altKey||e.button===2)&&!e.shiftKey;panAnchor=groundAt(e);lastX=e.clientX;lastY=e.clientY;renderer.domElement.setPointerCapture(e.pointerId);if(!rotatingDrag)showFocus();}
    function pointerMove(e){if(!dragging)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;if(rotatingDrag){angle-=dx*.008;elevation+=dy*.008;}else{const point=groundAt(e);if(point&&panAnchor){target.x+=panAnchor.x-point.x;target.z+=panAnchor.z-point.z;}else{const scale=distance*.0012;target.x-=dx*Math.cos(angle)*scale+dy*Math.sin(angle)*scale;target.z+=dx*Math.sin(angle)*scale-dy*Math.cos(angle)*scale;}showFocus();}lastX=e.clientX;lastY=e.clientY;positionCamera();}
    function pointerUp(e){dragging=false;panAnchor=null;if(e&&renderer.domElement.hasPointerCapture(e.pointerId))renderer.domElement.releasePointerCapture(e.pointerId);}
    function wheel(e){e.preventDefault();distance*=Math.exp(e.deltaY*.001);positionCamera();}
    function key(e){if(e.key==='ArrowLeft')angle-=.1;else if(e.key==='ArrowRight')angle+=.1;else if(e.key==='ArrowUp')elevation+=.08;else if(e.key==='ArrowDown')elevation-=.08;else if(e.key==='+'||e.key==='=')distance*=.9;else if(e.key==='-')distance*=1.1;else return;e.preventDefault();positionCamera();}
    const canvas=renderer.domElement;canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('keydown',key);canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('dblclick',e=>{const p=groundAt(e);if(p){setFollowing(false);target.set(p.x,0,p.z);positionCamera();showFocus();}});
    root.addEventListener('click',e=>{
      const action=e.target.closest('button')?.dataset.action;
      if(action==='overview')reset(false);if(action==='close')reset(true);if(action==='follow')focusWalker();
      if(action==='before'||action==='after'){solarPlaying=false;walk?.setPlaying(false);syncTime(currentMinute);solarButtons();onPhaseChange?.(action);}
      if(action==='replan'){solarPlaying=false;syncTime(currentMinute);solarButtons();onReplan?.();}
      if(action==='outcome'){solarPlaying=false;if(Number.isFinite(planMinute)){currentMinute=planMinute;lighting(planSolar,currentMinute);syncTime(currentMinute);}solarButtons();focusOutcome();}
      if(action==='rotate'){rotateMode=!rotateMode;e.target.setAttribute('aria-pressed',String(rotateMode));e.target.textContent=rotateMode?'平移对焦':'旋转视角';}
      if(action==='expand'){root.classList.toggle('shade3d-expanded');e.target.textContent=root.classList.contains('shade3d-expanded')?'退出放大':'放大面板';resize();}
      if(action==='load'&&typeof onLoadPreset==='function')onLoadPreset();
      if(action==='original')onShowOriginal?.();
      if(action==='sun-play'){solarPlaying=!solarPlaying;if(solarPlaying&&currentMinute>=1200){currentMinute=540;endpointPause=0;}if(solarPlaying&&currentMinute<540)currentMinute=540;syncTime(currentMinute);solarButtons();}
      if(action==='walk-play'){const s=walk?.getState();if(s?.finished)walk.restart();walk?.setPlaying(!s?.playing);if(!following&&!s?.playing)focusWalker();updateWalkUI();}
      if(action==='walk-reset'){walk?.restart();walk?.setPlaying(true);focusWalker();updateWalkUI();}
      dirty=true;
    });
    root.querySelector('.shade3d-clock').addEventListener('input',e=>{solarPlaying=false;endpointPause=0;solarButtons();currentMinute=Number(e.target.value);lighting(solarForTime?solarForTime(currentMinute):currentSolar,currentMinute);if(onManualTimeChange)onManualTimeChange(currentMinute);else syncTime(currentMinute);updateWalkUI();});
    root.addEventListener('keydown',event=>{if(event.key==='Escape'&&root.classList.contains('shade3d-expanded')){root.classList.remove('shade3d-expanded');root.querySelector('[data-action=expand]').textContent='放大面板';resize();}});
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(resize):null;observer?.observe(stage);window.addEventListener('resize',resize);
    let frame,lastFrame=0;function render(now){
      if(destroyed)return;const dt=lastFrame?Math.min(.1,(now-lastFrame)/1000):0;lastFrame=now;
      if(campus&&document.visibilityState!=='hidden'){
        if(solarPlaying&&solarStarted){
          if(endpointPause>0){endpointPause-=dt;if(endpointPause<=0){currentMinute=540;autoTimer=1;walk?.restart();walk?.setPlaying(true);}}
          else{currentMinute=Math.min(1200,currentMinute+dt*10);if(currentMinute>=1200)endpointPause=1;}
          autoTimer+=dt;sunTick+=dt;
          if(sunTick>=.12){sunTick=0;lighting(solarForTime?solarForTime(currentMinute):currentSolar,currentMinute);}
          if(autoTimer>=1){autoTimer=0;syncTime(currentMinute);}
        }
        const walked=walk?.tick(dt);if(walked)dirty=true;
        if(following&&walked){const f=walk.getFocus();if(f){target.set(f.point.x,f.point.y,f.point.z);positionCamera();}}
        walkUIStamp+=dt;if(walkUIStamp>=.2){walkUIStamp=0;updateWalkUI();}
        if(dirty&&stage.clientWidth){renderer.render(scene,camera);dirty=false;}
      }
      frame=requestAnimationFrame(render);
    }
    resize();frame=requestAnimationFrame(render);
    return{update,resize,setManualTime(minute){solarPlaying=false;endpointPause=0;currentMinute=minute;solarButtons();},destroy(){destroyed=true;clearTimeout(focusTimer);cancelAnimationFrame(frame);observer?.disconnect();window.removeEventListener('resize',resize);clear();renderer.dispose();container.innerHTML='';}};
  }
  globalThis.ShadeScene3D=Object.freeze({init});
})();

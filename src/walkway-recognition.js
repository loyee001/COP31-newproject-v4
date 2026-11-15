/* Local plan-image walkway proposals. No learned semantic model, network call, or image upload.
 * Pixel colour regions -> width/shape filtering -> Zhang-Suen skeleton -> shared-node graph.
 * The caller must show proposals for confirmation: colour alone cannot identify legal walkways.
 */
(function(root){
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const length=pts=>pts.slice(1).reduce((s,p,i)=>s+distance(p,pts[i]),0);
  function simplify(points,epsilon){
    if(points.length<3)return points;
    const a=points[0],b=points.at(-1),dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
    let best=epsilon,index=-1;
    for(let i=1;i<points.length-1;i++){
      const p=points[i],t=den?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/den,0,1):0;
      const d=Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
      if(d>best){best=d;index=i;}
    }
    return index<0?[a,b]:simplify(points.slice(0,index+1),epsilon).slice(0,-1).concat(simplify(points.slice(index),epsilon));
  }
  function resize(image){
    const scale=Math.min(1,768/Math.max(image.width,image.height)),w=Math.max(1,Math.round(image.width*scale)),h=Math.max(1,Math.round(image.height*scale));
    const rgb=new Uint8ClampedArray(w*h*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const src=(Math.min(image.height-1,Math.floor((y+.5)*image.height/h))*image.width+Math.min(image.width-1,Math.floor((x+.5)*image.width/w)))*4;
      const i=(y*w+x)*4;rgb[i]=image.data[src];rgb[i+1]=image.data[src+1];rgb[i+2]=image.data[src+2];rgb[i+3]=image.data[src+3];
    }
    return {rgb,w,h};
  }
  function palette(rgb,seed,w,h){
    if(seed){const i=(clamp(Math.round(seed.y),0,h-1)*w+clamp(Math.round(seed.x),0,w-1))*4;return [{rgb:[rgb[i],rgb[i+1],rgb[i+2]],pixels:1,seed:true}];}
    const bins=new Map();
    for(let i=0;i<rgb.length;i+=4){
      if(rgb[i+3]<128)continue;
      const r=rgb[i],g=rgb[i+1],b=rgb[i+2],hi=Math.max(r,g,b),lo=Math.min(r,g,b);
      if((r+g+b)/3<200||hi-lo>32)continue;
      const key=(r>>3)*1024+(g>>3)*32+(b>>3),v=bins.get(key)||[0,0,0,0];
      v[0]+=r;v[1]+=g;v[2]+=b;v[3]++;bins.set(key,v);
    }
    const candidates=[...bins.values()].sort((a,b)=>b[3]-a[3]).filter(v=>v[3]>=Math.max(20,w*h*.00008)).slice(0,32),out=[];
    for(const v of candidates){
      const c=v.slice(0,3).map(n=>Math.round(n/v[3]));
      if(!out.some(p=>Math.max(...p.rgb.map((n,i)=>Math.abs(n-c[i])))<6))out.push({rgb:c,pixels:v[3]});
    }
    return out;
  }
  function distanceField(mask,w,h){
    const d=new Float32Array(mask.length),diag=Math.SQRT2;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;if(!mask[i])continue;
      d[i]=Math.min(x?d[i-1]+1:1,y?d[i-w]+1:1,x&&y?d[i-w-1]+diag:1,x<w-1&&y?d[i-w+1]+diag:1);
    }
    for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){
      const i=y*w+x;if(!mask[i])continue;
      d[i]=Math.min(d[i],x<w-1?d[i+1]+1:1,y<h-1?d[i+w]+1:1,x<w-1&&y<h-1?d[i+w+1]+diag:1,x&&y<h-1?d[i+w-1]+diag:1);
    }
    return d;
  }
  function regions(mask,w,h){
    const seen=new Uint8Array(mask.length),q=new Int32Array(mask.length),result=[];
    for(let i=0;i<mask.length;i++)if(mask[i]&&!seen[i]){
      let head=0,tail=1; q[0]=i;seen[i]=1;
      let x0=w,y0=h,x1=0,y1=0,border=0;
      while(head<tail){
        const p=q[head++],x=p%w,y=Math.floor(p/w);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
        if(x<3||y<3||x>w-4||y>h-4)border++;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h){
          const j=p+dy*w+dx;if(mask[j]&&!seen[j]){seen[j]=1;q[tail++]=j;}
        }
      }
      result.push({pixels:Array.from(q.subarray(0,tail)),x0,x1,y0,y1,border});
    }
    return result;
  }
  function closeSmall(mask,w,h){
    const dilated=new Uint8Array(mask.length),out=new Uint8Array(mask.length);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const i=y*w+x;for(let dy=-1;dy<=1&&!dilated[i];dy++)for(let dx=-1;dx<=1;dx++)if(mask[i+dy*w+dx]){dilated[i]=1;break;}
    }
    for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
      const i=y*w+x;let keep=true;for(let dy=-1;dy<=1&&keep;dy++)for(let dx=-1;dx<=1;dx++)if(!dilated[i+dy*w+dx]){keep=false;break;}out[i]=keep?1:0;
    }
    return out;
  }
  function thin(mask,w,h){
    const out=mask.slice(),remove=[];
    let changed=true,iteration=0;
    while(changed&&iteration++<160){
      changed=false;
      for(let pass=0;pass<2;pass++){
        remove.length=0;
        for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
          const i=y*w+x;if(!out[i])continue;
          const p=[out[i-w],out[i-w+1],out[i+1],out[i+w+1],out[i+w],out[i+w-1],out[i-1],out[i-w-1]],n=p.reduce((a,b)=>a+b,0);
          if(n<2||n>6)continue;
          let transitions=0;for(let k=0;k<8;k++)if(!p[k]&&p[(k+1)%8])transitions++;
          if(transitions!==1)continue;
          if(pass===0?(p[0]*p[2]*p[4]||p[2]*p[4]*p[6]):(p[0]*p[2]*p[6]||p[0]*p[4]*p[6]))continue;
          remove.push(i);
        }
        if(remove.length)changed=true;for(const i of remove)out[i]=0;
      }
    }
    return out;
  }
  function skeletonGraph(mask,field,w,h){
    const pixels=[],adj=new Map();
    for(let i=0;i<mask.length;i++)if(mask[i]){
      pixels.push(i);const x=i%w,y=Math.floor(i/w),ns=[];
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h){
        const j=i+dy*w+dx;if(!mask[j])continue;
        // Prefer an orthogonal step when present; otherwise diagonal staircase pixels connect.
        if(dx&&dy&&(mask[i+dx]||mask[i+dy*w]))continue;
        ns.push(j);
      }
      adj.set(i,ns);
    }
    const nodeAt=new Map(),nodes=[],special=new Set(pixels.filter(i=>adj.get(i).length!==2));
    for(const i of special)if(!nodeAt.has(i)){
      const node={id:nodes.length,x:0,y:0,pixels:[]},q=[i];nodeAt.set(i,node.id);
      for(let k=0;k<q.length;k++){
        const p=q[k];node.pixels.push(p);node.x+=p%w;node.y+=Math.floor(p/w);
        for(const j of adj.get(p))if(special.has(j)&&!nodeAt.has(j)){nodeAt.set(j,node.id);q.push(j);}
      }
      node.x/=q.length;node.y/=q.length;nodes.push(node);
    }
    // Closed loops have no degree != 2 pixels. Give each loop a stable anchor.
    const componentSeen=new Set();
    for(const i of pixels)if(!componentSeen.has(i)){
      const q=[i];componentSeen.add(i);let hasNode=false;
      for(let k=0;k<q.length;k++){const p=q[k];if(nodeAt.has(p))hasNode=true;for(const j of adj.get(p))if(!componentSeen.has(j)){componentSeen.add(j);q.push(j);}}
      if(!hasNode){const node={id:nodes.length,x:i%w,y:Math.floor(i/w),pixels:[i]};nodes.push(node);nodeAt.set(i,node.id);}
    }
    const visited=new Set(),edges=[],key=(a,b)=>a<b?a*mask.length+b:b*mask.length+a;
    for(const node of nodes)for(const start of node.pixels)for(const next of adj.get(start)){
      if(nodeAt.get(next)===node.id||visited.has(key(start,next)))continue;
      const trace=[{x:node.x,y:node.y}],radii=[];let previous=start,current=next;
      visited.add(key(previous,current));let end;
      for(let guard=0;guard<pixels.length+1;guard++){
        radii.push(field[current]);
        if(nodeAt.has(current)){end=nodes[nodeAt.get(current)];trace.push({x:end.x,y:end.y});break;}
        trace.push({x:current%w,y:Math.floor(current/w)});
        const choices=adj.get(current).filter(p=>p!==previous);if(!choices.length)break;
        const j=choices[0];visited.add(key(current,j));previous=current;current=j;
      }
      if(end&&trace.length>1){radii.sort((a,b)=>a-b);edges.push({a:node.id,b:end.id,points:trace,width:Math.max(2,2*(radii[Math.floor(radii.length*.65)]||1)),length:length(trace)});}
    }
    return {nodes,edges,skeletonPixels:pixels.length};
  }
  function tidyGraph(graph,w,h){
    let edges=graph.edges.filter(e=>e.length>=2),discarded=0;
    const nodes=graph.nodes;
    const degrees=()=>{const d=new Int32Array(nodes.length);for(const e of edges){d[e.a]++;d[e.b]++;}return d;};
    for(let pass=0;pass<8;pass++){
      const deg=degrees(),next=edges.filter(e=>!((deg[e.a]===1||deg[e.b]===1)&&e.length<Math.max(8,e.width*1.65)));
      discarded+=edges.length-next.length;if(next.length===edges.length)break;edges=next;
    }
    // Junction pixels can form several adjacent degree-three nodes. Contract only their
    // very short connecting edge, preserving every other edge and its common endpoint.
    for(let pass=0;pass<graph.nodes.length;pass++){
      const deg=degrees(),short=edges.find(e=>e.a!==e.b&&deg[e.a]>1&&deg[e.b]>1&&e.length<Math.max(3,e.width*.6));
      if(!short)break;
      const a=nodes[short.a],b=nodes[short.b],x=(a.x+b.x)/2,y=(a.y+b.y)/2;a.x=x;a.y=y;
      edges=edges.filter(e=>e!==short);
      for(const e of edges){
        if(e.a===b.id)e.a=a.id;if(e.b===b.id)e.b=a.id;
        if(e.a===a.id)e.points[0]={x,y};if(e.b===a.id)e.points[e.points.length-1]={x,y};
        e.length=length(e.points);
      }
    }
    // Reconnect short collinear occlusions. Both endpoints must point into the same gap.
    let joins=0;
    for(let pass=0;pass<12;pass++){
      const deg=degrees(),ends=[];
      for(const e of edges)for(const side of ['a','b'])if(deg[e[side]]===1){
        const pts=side==='a'?e.points:e.points.slice().reverse(),p=pts[0];let q=pts.at(-1);
        for(let j=1;j<pts.length;j++)if(distance(p,pts[j])>=Math.max(5,e.width)){q=pts[j];break;}
        const norm=distance(p,q)||1;ends.push({id:e[side],edge:e,p,dx:(p.x-q.x)/norm,dy:(p.y-q.y)/norm});
      }
      let best=null;
      for(let i=0;i<ends.length;i++)for(let j=i+1;j<ends.length;j++){
        const a=ends[i],b=ends[j],d=distance(a.p,b.p);if(a.edge===b.edge||d<1||d>Math.max(16,Math.min(45,(a.edge.width+b.edge.width)*1.6)))continue;
        const dx=(b.p.x-a.p.x)/d,dy=(b.p.y-a.p.y)/d;
        if(a.dx*dx+a.dy*dy<.65||-b.dx*dx-b.dy*dy<.65)continue;
        if(!best||d<best.d)best={a,b,d};
      }
      if(!best)break;
      edges.push({a:best.a.id,b:best.b.id,points:[best.a.p,best.b.p],width:Math.min(best.a.edge.width,best.b.edge.width),length:best.d,inferred:true});joins++;
    }
    // Merge degree-two nodes so a corridor is one polyline, while junction endpoints remain shared.
    for(let pass=0;pass<graph.nodes.length;pass++){
      const deg=degrees(),id=Array.from(deg).findIndex((n,i)=>n===2&&edges.filter(e=>e.a===i||e.b===i).length===2);if(id<0)break;
      const es=edges.filter(e=>e.a===id||e.b===id);
      const [a,b]=es,pa=a.b===id?a.points:a.points.slice().reverse(),pb=b.a===id?b.points:b.points.slice().reverse();
      const e={a:a.a===id?a.b:a.a,b:b.a===id?b.b:b.a,points:pa.concat(pb.slice(1)),width:(a.width*a.length+b.width*b.length)/(a.length+b.length),length:a.length+b.length,inferred:a.inferred||b.inferred};
      edges=edges.filter(v=>v!==a&&v!==b);edges.push(e);
    }
    // Keep appreciable networks, not isolated print marks; allow a single genuine long corridor.
    const finalDegree=degrees();
    edges=edges.filter(e=>!(finalDegree[e.a]===1&&finalDegree[e.b]===1&&e.length<Math.max(18,Math.min(w,h)*.045)));
    for(const e of edges)e.points=simplify(e.points,Math.max(1.2,e.width*.14));
    return {nodes,edges,discarded,joins};
  }
  // Graph edges are not necessarily user-facing paths. Pair the straightest continuations
  // at each junction into trails; every physical edge remains exactly once, and junction
  // coordinates remain explicit polyline vertices for shared-node editing.
  function chainGraph(graph){
    const edges=graph.edges,incidence=new Map(),pairs=new Map();
    for(let i=0;i<edges.length;i++)for(const side of ['a','b']){
      const e=edges[i],node=e[side],p=side==='a'?e.points:e.points.slice().reverse(),first=p[0];
      let q=p.at(-1);for(let j=1;j<p.length;j++)if(distance(first,p[j])>=3){q=p[j];break;}
      const n=distance(first,q)||1,entry={key:`${i}:${side}`,edge:i,side,dx:(q.x-first.x)/n,dy:(q.y-first.y)/n};
      if(!incidence.has(node))incidence.set(node,[]);incidence.get(node).push(entry);
    }
    for(const list of incidence.values()){
      const remaining=list.slice();
      while(remaining.length>=2){
        let best=null;
        for(let i=0;i<remaining.length;i++)for(let j=i+1;j<remaining.length;j++){
          const a=remaining[i],b=remaining[j];if(a.edge===b.edge&&remaining.length>2)continue;
          const score=a.dx*b.dx+a.dy*b.dy;
          if(!best||score<best.score)best={i,j,score};
        }
        if(!best)break;const a=remaining[best.i],b=remaining[best.j];pairs.set(a.key,b);pairs.set(b.key,a);remaining.splice(best.j,1);remaining.splice(best.i,1);
      }
    }
    const visited=new Set(),trails=[],starts=[...incidence.values()].flat().sort((a,b)=>Number(pairs.has(a.key))-Number(pairs.has(b.key)));
    for(const start of starts){
      if(visited.has(start.edge))continue;let current=start,points=[],sumWidth=0,sumLength=0,inferred=false;
      while(current&&!visited.has(current.edge)){
        const e=edges[current.edge],p=current.side==='a'?e.points:e.points.slice().reverse();visited.add(current.edge);
        points.push(...(points.length?p.slice(1):p));sumWidth+=e.width*e.length;sumLength+=e.length;inferred=inferred||e.inferred;
        current=pairs.get(`${current.edge}:${current.side==='a'?'b':'a'}`);
      }
      if(points.length>1)trails.push({points,width:sumWidth/sumLength,length:sumLength,inferred});
    }
    return trails;
  }
  function detect(image,options={}){
    if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<2||image.height<2||!image.data||image.data.length!==image.width*image.height*4)throw new Error('需要有效的 RGBA 图片像素');
    const campusWidth=Number(options.campusWidth),campusHeight=Number(options.campusHeight);
    if(!(campusWidth>0&&campusHeight>0&&Number.isFinite(campusWidth+campusHeight)))throw new Error('需要有效的校园米制尺寸');
    const sensitivity=clamp(Number.isFinite(options.sensitivity)?options.sensitivity:.5,0,1),{rgb,w,h}=resize(image);
    const seed=options.seed&&Number.isFinite(options.seed.x)&&Number.isFinite(options.seed.y)?{x:options.seed.x*w/image.width,y:options.seed.y*h/image.height}:null;
    const colors=palette(rgb,seed,w,h),union=new Uint8Array(w*h),acceptedColors=[],diagnostics={sourceWidth:image.width,sourceHeight:image.height,workingWidth:w,workingHeight:h,mode:seed?'seed':'automatic',colors:[],candidateComponents:0,acceptedComponents:0,skeletonPixels:0,pathCount:0,junctionCount:0,totalLength:0,discardedShortBranches:0,bridgedGaps:0,limited:false};
    const tolerance=4+sensitivity*6,maxRadius=Math.max(10,Math.min(w,h)*(.03+sensitivity*.018));
    for(const color of colors){
      const mask=new Uint8Array(w*h);for(let i=0;i<mask.length;i++){const j=i*4;if(rgb[j+3]>127&&Math.max(Math.abs(rgb[j]-color.rgb[0]),Math.abs(rgb[j+1]-color.rgb[1]),Math.abs(rgb[j+2]-color.rgb[2]))<=tolerance)mask[i]=1;}
      const field=distanceField(mask,w,h);let accepted=0,area=0;
      for(const c of regions(mask,w,h)){
        if(c.pixels.length<25)continue;diagnostics.candidateComponents++;
        const bw=c.x1-c.x0+1,bh=c.y1-c.y0+1,long=Math.max(bw,bh),short=Math.min(bw,bh),fill=c.pixels.length/(bw*bh),radius=c.pixels.reduce((m,i)=>Math.max(m,field[i]),0);
        const borderSides=(c.x0<4)+(c.y0<4)+(c.x1>w-5)+(c.y1>h-5);
        if(long<Math.max(18,Math.min(w,h)*.05)||radius<1.8||radius>maxRadius||c.pixels.length>w*h*.3)continue;
        if(borderSides>=2&&(c.border>c.pixels.length*.03||bw>w*.94&&bh>h*.94))continue;
        if(long/short<2.4&&!(fill<.48&&long>45))continue;
        // Thin rectangular borders enclose a large empty interior: the local width is too small.
        if(radius<2.6&&long>50&&short>20)continue;
        for(const i of c.pixels)union[i]=1;accepted++;area+=c.pixels.length;
      }
      if(accepted){acceptedColors.push(color.rgb);diagnostics.colors.push({rgb:color.rgb,components:accepted,pixels:area});diagnostics.acceptedComponents+=accepted;}
    }
    const closed=closeSmall(union,w,h),field=distanceField(closed,w,h),skeleton=thin(closed,w,h),raw=skeletonGraph(skeleton,field,w,h),graph=tidyGraph(raw,w,h);
    diagnostics.skeletonPixels=raw.skeletonPixels;diagnostics.discardedShortBranches=graph.discarded;diagnostics.bridgedGaps=graph.joins;
    const unitX=campusWidth/w,unitY=campusHeight/h,unit=Math.sqrt(unitX*unitY),coordinate=p=>({x:clamp((p.x+.5)*unitX,0,campusWidth),y:clamp(campusHeight-(p.y+.5)*unitY,0,campusHeight)});
    let paths=[],pointCount=0,total=0;
    const maxPaths=clamp(Math.floor(options.maxPaths||128),1,256),maxPoints=clamp(Math.floor(options.maxPoints||2048),2,4096);
    const sorted=chainGraph(graph).sort((a,b)=>b.length-a.length);
    for(const e of sorted){
      const points=e.points.map(coordinate),m=length(points);if(m<.5)continue;
      if(paths.length>=maxPaths||pointCount+points.length>maxPoints||total+m>2000){diagnostics.limited=true;continue;}
      paths.push({id:`detected-path-${paths.length+1}`,name:`识别人行道 ${paths.length+1}`,points,width:clamp(e.width*unit,.5,20),demand:1});pointCount+=points.length;total+=m;
    }
    // Recompute junctions from final kept paths, so limits never leave stale graph annotations.
    const incidence=new Map(),pointKey=p=>`${p.x},${p.y}`;
    for(const path of paths)for(let i=0;i<path.points.length;i++){
      const p=path.points[i],key=pointKey(p),v=incidence.get(key)||{x:p.x,y:p.y,neighbors:new Set(),pathIds:new Set()};
      if(i>0)v.neighbors.add(pointKey(path.points[i-1]));if(i<path.points.length-1)v.neighbors.add(pointKey(path.points[i+1]));
      v.pathIds.add(path.id);incidence.set(key,v);
    }
    const intersections=[...incidence.values()].filter(p=>p.neighbors.size>=3).map(p=>({x:p.x,y:p.y,degree:p.neighbors.size,pathIds:[...p.pathIds]}));
    diagnostics.pathCount=paths.length;diagnostics.junctionCount=intersections.length;diagnostics.totalLength=total;
    const reasons=[];let level='low';
    if(paths.length){
      reasons.push(`按 ${acceptedColors.length} 组路面颜色提取 ${paths.length} 段线状区域`);
      if(intersections.length)reasons.push(`检测到 ${intersections.length} 个共享交叉节点`);
      if(graph.joins)reasons.push(`按方向补连 ${graph.joins} 处窄遮挡，需确认`);
      if(total>5)level=diagnostics.acceptedComponents<=8&&intersections.length&&!graph.joins?'high':'medium';
      if(diagnostics.limited){level='low';reasons.push('结果超过导入容量，仅保留部分较长路段');}
    }else reasons.push('未找到足够连续、宽度合适的线状区域，可点击路面颜色重试');
    if(paths.length)reasons.push('浅色广场和建筑入口可能与道路同色，需要在图上确认');
    reasons.push('规则证据等级，不是识别准确率；请在图上确认道路与交叉口');
    return {paths,intersections,confidence:{level,reasons},diagnostics};
  }
  root.ShadeWalkwayRecognition=Object.freeze({detect});
})(globalThis);

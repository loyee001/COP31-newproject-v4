/* ShadePath deterministic model, no external dependencies.
 * Solar equations: NOAA / Jean Meeus, https://gml.noaa.gov/grad/solcalc/calcdetails.html
 * Time/azimuth conventions: https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 * Refraction uses NOAA's published piecewise correction. NOAA does not certify
 * these calculations; campus, weather and pedestrian demand below are synthetic.
 * Tree height is canopy-centre height; canopy is an opaque sphere of radius r.
 */
(function (root) {
  'use strict';
  const DEG = Math.PI / 180, RAD = 1 / DEG, SPEED = 1.15, COST = 95;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const mod = (x, d) => ((x % d) + d) % d;
  const sq = x => x * x;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const campus = {
    schemaVersion: 1,
    metadata: { title: 'ShadePath synthetic campus', provenance: 'synthetic', units: 'metres', axes: 'x east, y north', treeHeightMeaning: 'canopy centre above ground', weather: 'synthetic diurnal cycle; not forecast', thermal: 'official UTCI approximation from synthetic weather; documented proxy retained separately', measured: false },
    bounds: { width: 220, height: 120 },
    location: { latitude: 31.23, longitude: 121.47, timezone: 8 },
    route: [{ x: 22, y: 28 }, { x: 182, y: 28 }, { x: 182, y: 76 }],
    buildings: [
      { id: 'b1', nameKey: 'teaching', height: 13, polygon: [{x:4,y:10},{x:22,y:10},{x:22,y:51},{x:4,y:51}] },
      { id: 'b2', nameKey: 'library', height: 12, polygon: [{x:51,y:75},{x:101,y:75},{x:101,y:103},{x:51,y:103}] },
      { id: 'b3', nameKey: 'activity', height: 10, polygon: [{x:118,y:86},{x:151,y:86},{x:151,y:108},{x:118,y:108}] },
      { id: 'b4', nameKey: 'canteen', height: 9, polygon: [{x:170,y:76},{x:207,y:76},{x:207,y:106},{x:170,y:106}] }
    ],
    trees: [
      {id:'existing-1',x:37,y:24.5,height:8,radius:4.6,existing:true},
      {id:'existing-2',x:59,y:24.5,height:8,radius:4.6,existing:true},
      {id:'existing-3',x:155,y:24.5,height:8,radius:4.6,existing:true},
      {id:'existing-4',x:185.5,y:44,height:8,radius:4.6,existing:true},
      {id:'existing-5',x:178.5,y:63,height:8,radius:4.6,existing:true},
      {id:'existing-6',x:31,y:66,height:8,radius:4.6,existing:true},
      {id:'existing-7',x:40,y:87,height:8,radius:4.6,existing:true},
      {id:'existing-8',x:110,y:66,height:8,radius:4.6,existing:true},
      {id:'existing-9',x:154,y:64,height:8,radius:4.6,existing:true}
    ],
    treeTemplate: { height: 8, radius: 4.6, cost: COST }
  };
  const DEFAULT = { date: '2026-06-21', minutes: 740, latitude: 31.23, longitude: 121.47, timezone: 8, optimizationMode: 'current' };
  function settingsFor(data, settings = {}) { const s={ ...DEFAULT, ...data.location, ...settings };s.optimizationMode=s.optimizationMode==='lunch'?'lunch':'current';return s; }
  function solar(settings = {}) {
    const s = { ...DEFAULT, ...settings };
    const dateMs = Date.parse(s.date + 'T00:00:00Z');
    if (!Number.isFinite(dateMs) || !Number.isFinite(s.minutes) || !Number.isFinite(s.latitude) || Math.abs(s.latitude) > 90 || !Number.isFinite(s.longitude) || !Number.isFinite(s.timezone)) throw new RangeError('Invalid solar settings');
    const jd = (dateMs + (s.minutes - s.timezone * 60) * 60000) / 86400000 + 2440587.5;
    const t = (jd - 2451545) / 36525;
    const l = mod(280.46646 + t * (36000.76983 + t * 0.0003032), 360) * DEG;
    const m = (357.52911 + t * (35999.05029 - 0.0001537 * t)) * DEG;
    const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    const centre = Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m) * (0.019993 - 0.000101 * t) + Math.sin(3 * m) * 0.000289;
    const omega = (125.04 - 1934.136 * t) * DEG;
    const lambda = l + (centre - 0.00569 - 0.00478 * Math.sin(omega)) * DEG;
    const obliquity = (23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega)) * DEG;
    const declination = Math.asin(Math.sin(obliquity) * Math.sin(lambda));
    const y = sq(Math.tan(obliquity / 2));
    const equationOfTime = 4 * RAD * (y * Math.sin(2 * l) - 2 * eccentricity * Math.sin(m) + 4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l) - 0.5 * y * y * Math.sin(4 * l) - 1.25 * eccentricity * eccentricity * Math.sin(2 * m));
    const hourAngle = (mod(s.minutes + equationOfTime + 4 * s.longitude - 60 * s.timezone, 1440) / 4 - 180) * DEG;
    const latitude = s.latitude * DEG;
    const geometricAltitude = Math.asin(clamp(Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle), -1, 1)) * RAD;
    const tan = Math.tan(geometricAltitude * DEG);
    let correction = 0;
    if (geometricAltitude <= 85 && geometricAltitude > 5) correction = (58.1 / tan - 0.07 / tan ** 3 + 0.000086 / tan ** 5) / 3600;
    else if (geometricAltitude <= 5 && geometricAltitude > -0.575) correction = (1735 + geometricAltitude * (-518.2 + geometricAltitude * (103.4 + geometricAltitude * (-12.79 + geometricAltitude * 0.711)))) / 3600;
    else if (geometricAltitude <= -0.575) correction = -20.774 / tan / 3600;
    const altitude = geometricAltitude + correction;
    const azimuth = mod(Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude)) * RAD + 180, 360);
    const solarNoon = 720 - 4 * s.longitude - equationOfTime + s.timezone * 60;
    const hourCos = (Math.cos(90.833 * DEG) - Math.sin(latitude) * Math.sin(declination)) / (Math.cos(latitude) * Math.cos(declination));
    const hourSpan = hourCos >= -1 && hourCos <= 1 ? Math.acos(hourCos) * RAD * 4 : null;
    return { altitude, geometricAltitude, azimuth, equationOfTime, declination: declination * RAD, sunrise: hourSpan === null ? null : solarNoon - hourSpan, sunset: hourSpan === null ? null : solarNoon + hourSpan, solarNoon, daylight: altitude > 0, dayState: hourCos < -1 ? 'polarDay' : hourCos > 1 ? 'polarNight' : 'normal' };
  }
  function convexHull(points) {
    const p = [...points].sort((a,b) => a.x-b.x || a.y-b.y);
    if (p.length <= 2) return p;
    const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    const low = [], high = [];
    for (const point of p) { while (low.length >= 2 && cross(low[low.length-2],low[low.length-1],point) <= 0) low.pop(); low.push(point); }
    for (let i=p.length-1;i>=0;i--) { while (high.length >= 2 && cross(high[high.length-2],high[high.length-1],p[i]) <= 0) high.pop(); high.push(p[i]); }
    low.pop(); high.pop(); return low.concat(high);
  }
  function pointInPolygon(p, polygon) {
    let inside = false;
    for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
      const a=polygon[i],b=polygon[j];
      // Treat edges as inside; no gaps at a building footprint or shadow edge.
      const cross=(p.x-a.x)*(b.y-a.y)-(p.y-a.y)*(b.x-a.x);
      if (Math.abs(cross)<1e-8 && p.x>=Math.min(a.x,b.x)-1e-8 && p.x<=Math.max(a.x,b.x)+1e-8 && p.y>=Math.min(a.y,b.y)-1e-8 && p.y<=Math.max(a.y,b.y)+1e-8) return true;
      if ((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
    }
    return inside;
  }
  function inEllipse(p, ellipse) {
    const dx=p.x-ellipse.x,dy=p.y-ellipse.y,c=Math.cos(ellipse.angle),s=Math.sin(ellipse.angle);
    return sq((dx*c+dy*s)/ellipse.rx)+sq((-dx*s+dy*c)/ellipse.ry)<=1+1e-10;
  }
  function shadowParameters(sun) {
    const a=sun.altitude*DEG,az=sun.azimuth*DEG;
    return { dx:-Math.sin(az),dy:-Math.cos(az),cot:1/Math.tan(a),sin:Math.sin(a),angle:Math.atan2(-Math.cos(az),-Math.sin(az)) };
  }
  function treeShadow(tree, q) { return { id:tree.id,x:tree.x+tree.height*q.cot*q.dx,y:tree.y+tree.height*q.cot*q.dy,rx:tree.radius/q.sin,ry:tree.radius,angle:q.angle }; }
  function shadows(data, sun, trees = data.trees) {
    if (sun.altitude<=0) return { buildings:[],trees:[] };
    const q=shadowParameters(sun);
    return {
      buildings:data.buildings.map(b=>convexHull(b.polygon.concat(b.polygon.map(p=>({x:p.x+b.height*q.cot*q.dx,y:p.y+b.height*q.cot*q.dy}))))),
      trees:trees.map(tree=>treeShadow(tree,q))
    };
  }
  function shadeKind(p, projection) {
    if (projection.buildings.some(poly=>pointInPolygon(p,poly))) return 'building';
    if (projection.trees.some(ellipse=>inEllipse(p,ellipse))) return 'tree';
    return 'sun';
  }
  function routeLength(route) { let length=0;for(let i=1;i<route.length;i++)length+=distance(route[i-1],route[i]);return length; }
  const topologyCache=new Map();
  function pathDefinitions(data) {
    const sources=Object.prototype.hasOwnProperty.call(data,'paths')?(Array.isArray(data.paths)?data.paths:[]):(Array.isArray(data.route)&&data.route.length>1?[{id:'route',name:'route',points:data.route,width:5,demand:1}]:[]);
    return sources.map((path,index)=>({id:String(path.id??'path-'+index),name:String(path.name??path.id??'path-'+index),points:(path.points||[]).map(p=>({x:p.x,y:p.y})),width:Number.isFinite(path.width)&&path.width>0?path.width:5,demand:Number.isFinite(path.demand)&&path.demand>0?path.demand:1})).map(path=>({...path,length:routeLength(path.points)}));
  }
  function network(data) {
    const paths=pathDefinitions(data),key=JSON.stringify(paths);
    if(topologyCache.has(key))return topologyCache.get(key);
    const raw=[],cross=(a,b)=>a.x*b.y-a.y*b.x,subtract=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
    paths.forEach((path,pathIndex)=>{let startDistance=0;for(let index=1;index<path.points.length;index++){
      const a=path.points[index-1],b=path.points[index],length=distance(a,b);
      if(length>1e-8)raw.push({a,b,length,pathId:path.id,pathIndex,startDistance,cuts:[0,1]});startDistance+=length;
    }});
    const addCut=(segment,t)=>{if(t>=-1e-9&&t<=1+1e-9)segment.cuts.push(clamp(t,0,1));};
    for(let i=0;i<raw.length;i++)for(let j=i+1;j<raw.length;j++){
      const a=raw[i],b=raw[j],r=subtract(a.b,a.a),v=subtract(b.b,b.a),q=subtract(b.a,a.a),den=cross(r,v),scale=a.length*b.length;
      if(Math.abs(den)>1e-10*Math.max(1,scale)){
        const t=cross(q,v)/den,u=cross(q,r)/den;
        if(t>=-1e-9&&t<=1+1e-9&&u>=-1e-9&&u<=1+1e-9){addCut(a,t);addCut(b,u);}
      }else if(Math.abs(cross(q,r))<=1e-8*Math.max(1,a.length)){
        for(const point of [b.a,b.b])addCut(a,((point.x-a.a.x)*r.x+(point.y-a.a.y)*r.y)/(a.length*a.length));
        for(const point of [a.a,a.b])addCut(b,((point.x-b.a.x)*v.x+(point.y-b.a.y)*v.y)/(b.length*b.length));
      }
    }
    const pointKey=p=>Math.round(p.x*1e6)+','+Math.round(p.y*1e6),segmentsByKey=new Map();
    for(const segment of raw){
      const cuts=segment.cuts.sort((a,b)=>a-b).filter((t,index,all)=>!index||t-all[index-1]>1e-9);
      for(let i=1;i<cuts.length;i++){
        const start=cuts[i-1],end=cuts[i];if((end-start)*segment.length<1e-7)continue;
        const p={x:segment.a.x+(segment.b.x-segment.a.x)*start,y:segment.a.y+(segment.b.y-segment.a.y)*start},q={x:segment.a.x+(segment.b.x-segment.a.x)*end,y:segment.a.y+(segment.b.y-segment.a.y)*end};
        const pk=pointKey(p),qk=pointKey(q),forward=pk<qk,id=forward?pk+'|'+qk:qk+'|'+pk;
        let edge=segmentsByKey.get(id);
        if(!edge){edge={id:'segment-'+id,a:forward?p:q,b:forward?q:p,length:distance(p,q),members:[]};segmentsByKey.set(id,edge);}
        edge.members.push({pathId:segment.pathId,pathIndex:segment.pathIndex,startDistance:segment.startDistance+start*segment.length,endDistance:segment.startDistance+end*segment.length,forward});
      }
    }
    const segments=[...segmentsByKey.values()],nodesByKey=new Map();
    for(const edge of segments){
      edge.pathIds=[...new Set(edge.members.map(m=>m.pathId))];
      const cover=paths.filter(path=>edge.pathIds.includes(path.id));
      edge.width=Math.max(...cover.map(path=>path.width));edge.demand=cover.reduce((sum,path)=>sum+path.demand,0)/cover.length;
      for(const point of [edge.a,edge.b]){
        const id=pointKey(point);let node=nodesByKey.get(id);
        if(!node){node={id:'node-'+id,x:point.x,y:point.y,degree:0,pathIds:[],segmentIds:[]};nodesByKey.set(id,node);}
        node.degree++;node.segmentIds.push(edge.id);node.pathIds=[...new Set(node.pathIds.concat(edge.pathIds))];
      }
    }
    const nodes=[...nodesByKey.values()],intersections=nodes.filter(node=>{
      if(node.degree>=3)return true;
      if(node.degree!==2||node.pathIds.length<2)return false;
      const directions=node.segmentIds.map(id=>{const edge=segments.find(s=>s.id===id),other=distance(edge.a,node)<1e-6?edge.b:edge.a;return subtract(other,node);});
      return Math.abs(cross(directions[0],directions[1]))>1e-8;
    });
    const result={paths,segments,nodes,intersections,length:segments.reduce((sum,s)=>sum+s.length,0),weightedLength:segments.reduce((sum,s)=>sum+s.length*s.demand,0),overlapSegments:segments.filter(s=>s.pathIds.length>1).length};
    return boundedSet(topologyCache,key,result,24);
  }
  function pointAlong(route, d) {
    let remaining=d;
    for(let i=1;i<route.length;i++) { const a=route[i-1],b=route[i],length=distance(a,b); if(length<=0)continue; if(remaining<=length || i===route.length-1) {const f=clamp(remaining/length,0,1);return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,tx:(b.x-a.x)/length,ty:(b.y-a.y)/length};} remaining-=length; }
    return {...(route[0]||{x:0,y:0}),tx:1,ty:0};
  }
  function sampleRoute(route, step=0.5) {
    if (!Number.isFinite(step)||step<=0) throw new RangeError('Sample step must be positive');
    const total=routeLength(route);if(total===0)return [];
    const distances=[];for(let d=0;d<total;d+=step)distances.push(d);distances.push(total);
    return distances.map((d,i)=>({ ...pointAlong(route,d),distance:d,weight:((i===0?0:d-distances[i-1])+(i===distances.length-1?0:distances[i+1]-d))/2 }));
  }
  function weather(minutes, settings={}) {
    const ta=settings.airTemperature ?? (29.8+2.5*Math.cos((minutes-870)/1440*2*Math.PI));
    const rh=settings.relativeHumidity ?? 55;
    const wind=settings.windSpeed ?? 1.4; // UTCI expects meteorological wind at 10 m.
    return {ta,rh,wind,source:(settings.airTemperature!==undefined||settings.relativeHumidity!==undefined||settings.windSpeed!==undefined)?'user-input':'synthetic'};
  }
  function thermal(minutes, sun, shaded, settings={}) {
    const w=weather(minutes,settings);
    const vapour=w.rh/100*6.105*Math.exp(17.27*w.ta/(237.7+w.ta)); // hPa, proxy only.
    const radiantExcess=(shaded?1.5:14.5)*Math.max(0,Math.sin(sun.altitude*DEG));
    const meanRadiant=w.ta+radiantExcess;
    const proxy=w.ta+0.12*vapour-1.05*w.wind+0.45*(meanRadiant-w.ta);
    const utci=root.ShadeThermal?root.ShadeThermal.utci({ta:w.ta,tmrt:meanRadiant,wind:w.wind,rh:w.rh}):{value:null,valid:false,reason:'thermal-module-unavailable'};
    return {value:utci.value,valid:utci.valid,reason:utci.reason,proxy,air:w.ta,rh:w.rh,vapour,wind:w.wind,meanRadiant};
  }
  const baselineCache=new Map();
  function geometryKey(data) {return JSON.stringify([Object.prototype.hasOwnProperty.call(data,'paths')?data.paths:data.route,data.buildings,data.trees,data.treeTemplate,data.bounds]);}
  function boundedSet(cache,key,value,limit) {cache.set(key,value);if(cache.size>limit)cache.delete(cache.keys().next().value);return value;}
  function baselineSamples(data,settings) {
    const key=geometryKey(data)+'|'+JSON.stringify(settings);
    if(baselineCache.has(key))return baselineCache.get(key);
    const topology=network(data),timeCache=new Map(),samples=[];
    for(const edge of topology.segments){
      const pathDemand=new Map(edge.pathIds.map(id=>[id,topology.paths.find(path=>path.id===id).demand]));
      const totalDemand=[...pathDemand.values()].reduce((sum,d)=>sum+d,0),repetitions=new Map(edge.pathIds.map(id=>[id,edge.members.filter(member=>member.pathId===id).length]));
      const physical=sampleRoute([edge.a,edge.b]);
      physical.forEach((p,sampleIndex)=>{
        for(const member of edge.members){
          const along=member.forward?p.distance:edge.length-p.distance;
          const pathDistance=member.startDistance+along,time=settings.minutes+pathDistance/SPEED/60;
          let frame=timeCache.get(time);
          if(!frame){const sun=solar({...settings,minutes:time});frame={sun,projection:shadows(data,sun,data.trees),q:sun.daylight?shadowParameters(sun):null,sunThermal:thermal(time,sun,false,settings),shadeThermal:thermal(time,sun,true,settings)};}
          // Keep exact arrival-time frames, but only a small LRU of full tree-shadow
          // arrays. Samples retain their own solar/thermal values, never projections.
          timeCache.delete(time);boundedSet(timeCache,time,frame,16);
          const kind=frame.sun.daylight?shadeKind(p,frame.projection):'night',demand=pathDemand.get(member.pathId),repeat=repetitions.get(member.pathId);
          samples.push({...p,distance:pathDistance,distanceAlongSegment:p.distance,pathId:member.pathId,segmentId:edge.id,sampleId:edge.id+':'+sampleIndex,pathWeight:p.weight,weight:p.weight*demand/totalDemand/repeat,objectiveWeight:p.weight*demand/edge.pathIds.length/repeat,time,sun:frame.sun,kind,q:frame.q,sunThermal:frame.sunThermal,shadeThermal:frame.shadeThermal});
        }
      });
    }
    return boundedSet(baselineCache,key,samples,160);
  }
  function evaluate(data, addedTrees=[], settings={}) {
    const s=settingsFor(data,settings),topology=network(data),samples=baselineSamples(data,s),length=topology.length,walkMinutes=length/SPEED/60;
    let shade=0,baseline=0,mean=0,baselineMean=0,peak=-Infinity,hot=0,heat=0,baselineHeat=0,thermalValid=true,proxyMean=0,proxyBaseline=0,daylightWeight=0;
    const pathTotals=new Map(topology.paths.map(path=>[path.id,{id:path.id,name:path.name,length:path.length,walkMinutes:path.length/SPEED/60,shade:0,baseline:0,mean:0,baselineMean:0,hot:0,heat:0,baselineHeat:0,daylight:0,thermalValid:true}]));
    const services=new Map(addedTrees.map(tree=>[tree.id,new Set()])),physicalMap=new Map(),profile=[];
    for(const p of samples){
      if(p.sun.daylight)daylightWeight+=p.weight;
      const baselineShaded=p.kind==='building'||p.kind==='tree';let addedShade=false;
      if(!baselineShaded&&p.q)for(const tree of addedTrees)if(inEllipse(p,treeShadow(tree,p.q))){addedShade=true;services.get(tree.id).add(p.pathId);}
      const shaded=baselineShaded||addedShade,thermal=shaded?p.shadeThermal:p.sunThermal,baselineThermal=baselineShaded?p.shadeThermal:p.sunThermal;
      const t=thermal.value,bt=baselineThermal.value,minutes=p.weight/SPEED/60,valid=thermal.valid&&baselineThermal.valid;
      if(shaded)shade+=p.weight;if(baselineShaded)baseline+=p.weight;thermalValid=thermalValid&&valid;
      if(valid){mean+=t*p.weight;baselineMean+=bt*p.weight;peak=Math.max(peak,t);if(t>=38)hot+=minutes;heat+=Math.max(t-26,0)*minutes;baselineHeat+=Math.max(bt-26,0)*minutes;}
      proxyMean+=thermal.proxy*p.weight;proxyBaseline+=baselineThermal.proxy*p.weight;
      const path=pathTotals.get(p.pathId),pw=p.pathWeight;
      if(shaded)path.shade+=pw;if(baselineShaded)path.baseline+=pw;if(p.sun.daylight)path.daylight+=pw;path.thermalValid=path.thermalValid&&valid;
      if(valid){path.mean+=t*pw;path.baselineMean+=bt*pw;if(t>=38)path.hot+=pw/SPEED/60;path.heat+=Math.max(t-26,0)*pw/SPEED/60;path.baselineHeat+=Math.max(bt-26,0)*pw/SPEED/60;}
      const record={x:p.x,y:p.y,distance:p.distance,distanceAlongSegment:p.distanceAlongSegment,pathId:p.pathId,segmentId:p.segmentId,time:p.time,weight:p.weight,objectiveWeight:p.objectiveWeight,shaded,baselineShaded,shadeKind:addedShade?'newTree':p.kind,thermal:t,baselineThermal:bt,thermalValid:valid,thermalReason:thermal.reason||baselineThermal.reason,tmrt:thermal.meanRadiant,proxy:thermal.proxy};profile.push(record);
      let map=physicalMap.get(p.sampleId);if(!map){map={x:p.x,y:p.y,segmentId:p.segmentId,distanceAlongSegment:p.distanceAlongSegment,weight:0,shade:0,baseline:0,daylight:0,newShade:0,building:0};physicalMap.set(p.sampleId,map);}
      map.weight+=p.weight;if(shaded)map.shade+=p.weight;if(baselineShaded)map.baseline+=p.weight;if(p.sun.daylight)map.daylight+=p.weight;if(addedShade)map.newShade+=p.weight;if(p.kind==='building')map.building+=p.weight;
    }
    // Merge adjacent-edge endpoint observations belonging to the same path and
    // arrival time. This preserves the legacy single-route 417-point profile.
    const merged=new Map();for(const p of profile){const key=p.pathId+'|'+p.x.toFixed(7)+','+p.y.toFixed(7)+'|'+p.time.toFixed(9);const existing=merged.get(key);if(existing){existing.weight+=p.weight;existing.objectiveWeight+=p.objectiveWeight;}else merged.set(key,{...p});}
    const finalProfile=[...merged.values()].sort((a,b)=>topology.paths.findIndex(p=>p.id===a.pathId)-topology.paths.findIndex(p=>p.id===b.pathId)||a.distance-b.distance);
    const mapProfile=[...physicalMap.values()].map(p=>({x:p.x,y:p.y,segmentId:p.segmentId,distanceAlongSegment:p.distanceAlongSegment,weight:p.weight,shadedFraction:p.weight?p.shade/p.weight:0,baselineShadedFraction:p.weight?p.baseline/p.weight:0,daylightFraction:p.weight?p.daylight/p.weight:0,shaded:p.shade>0,baselineShaded:p.baseline>0,shadeKind:p.newShade>0?'newTree':p.building>0?'building':p.baseline>0?'tree':p.daylight>0?'sun':'night'}));
    const pathMetrics=[...pathTotals.values()].map(p=>({id:p.id,name:p.name,length:p.length,walkMinutes:p.walkMinutes,shadeRate:p.length?p.shade/p.length:0,baselineRate:p.length?p.baseline/p.length:0,daylightFraction:p.length?p.daylight/p.length:0,anyDaylight:p.daylight>0,thermalValid:p.thermalValid,meanUTCI:p.thermalValid&&p.length?p.mean/p.length:null,baselineUTCI:p.thermalValid&&p.length?p.baselineMean/p.length:null,hotMinutes:p.thermalValid?p.hot:null,heatLoad:p.thermalValid?p.heat:null,baselineHeatLoad:p.thermalValid?p.baselineHeat:null}));
    const sun=solar(s),w=weather(s.minutes,s),sunThermal=thermal(s.minutes,sun,false,s),shadeThermal=thermal(s.minutes,sun,true,s);
    const meanUTCI=thermalValid&&length?mean/length:null,baselineUTCI=thermalValid&&length?baselineMean/length:null,peakUTCI=thermalValid&&length?peak:null;
    return {shadeRate:length?shade/length:0,baselineRate:length?baseline/length:0,meanThermal:meanUTCI,baselineThermal:baselineUTCI,peakThermal:peakUTCI,meanUTCI,baselineUTCI,peakUTCI,thermalValid,hotMinutes:thermalValid?hot:null,walkMinutes,heatLoad:thermalValid?heat:null,baselineHeatLoad:thermalValid?baselineHeat:null,meanProxy:length?proxyMean/length:null,baselineProxy:length?proxyBaseline/length:null,length,weightedLength:topology.weightedLength,daylight:sun.daylight,daylightAtDeparture:sun.daylight,daylightFraction:length?daylightWeight/length:0,anyDaylight:daylightWeight>0,fullNight:daylightWeight===0,profile:finalProfile,mapProfile,pathMetrics,network:topology,treeServices:[...services].map(([id,pathIds])=>({id,pathIds:[...pathIds]})),solar:sun,weather:{...w,tmrtSun:sunThermal.meanRadiant,tmrtShade:shadeThermal.meanRadiant}};
  }
  function segmentDistance(p,a,b) { const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;const t=den?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/den,0,1):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy); }
  function roadsideDistance(data,point,topology=null) {
    // Signed clearance from the union of walkway strips, not from a centreline.
    let clearance=Infinity;
    for(const edge of (topology||network(data)).segments)clearance=Math.min(clearance,segmentDistance(point,edge.a,edge.b)-edge.width/2);
    return clearance;
  }
  function validPlant(data,point,addedTrees=[],topology=null) {
    if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<1||point.y<1||point.x>data.bounds.width-1||point.y>data.bounds.height-1)return {valid:false,reason:'outside'};
    const radius=point.radius??data.treeTemplate.radius,centreHeight=point.height??data.treeTemplate.height;
    if(data.buildings.some(b=>{
      if(pointInPolygon(point,b.polygon))return true;
      const horizontal=Math.min(...b.polygon.map((p,i)=>segmentDistance(point,p,b.polygon[(i+1)%b.polygon.length])));
      // The sphere may sit above a low building: use the largest intersecting
      // horizontal crown slice, not a ground-disc radius at every height.
      const verticalGap=Math.max(0,centreHeight-b.height);
      const crownClearance=verticalGap>=radius?0:Math.sqrt(radius*radius-verticalGap*verticalGap);
      return horizontal<1.5||horizontal<crownClearance;
    }))return {valid:false,reason:'building'};
    if(roadsideDistance(data,point,topology)<0)return {valid:false,reason:'route'};
    if(data.trees.concat(addedTrees).some(t=>distance(t,point)<3.5))return {valid:false,reason:'overlap'};
    return {valid:true,reason:null};
  }
  function treeAt(data,x,y,id='manual-'+Math.round(x*100)+'-'+Math.round(y*100)) {return {...data.treeTemplate,id,x,y,existing:false};}
  // Five 4-minute slices per cohort are retained as an explicit legacy objective.
  const departures=[{minutes:710,weight:0.25},{minutes:740,weight:0.45},{minutes:770,weight:0.30}].flatMap(group=>[-8,-4,0,4,8].map(offset=>({minutes:group.minutes+offset,weight:group.weight/5})));
  function activeDepartures(settings) {
    return settings.optimizationMode==='lunch'?departures:[{minutes:settings.minutes,weight:1}];
  }
  function candidates(data,settings={}) {
    const s=settingsFor(data,settings),points=[],seen=new Set(),topology=network(data);
    const candidateTimes=s.optimizationMode==='lunch'?[710,740,770]:[s.minutes];
    const add=(x,y,metadata)=>{
      // Millimetre quantization is only for stable identity/deduplication; actual
      // metre coordinates below retain full precision for projection and scoring.
      const key=Math.round(x*1000)+'-'+Math.round(y*1000);
      if(seen.has(key))return;
      const tree={...treeAt(data,x,y,'candidate-'+key),...metadata};
      const clearance=roadsideDistance(data,tree,topology);
      // Inverse projection is useful only inside the roadside planting band.
      // Low sun must not move a new street tree deep into a lawn to win score.
      if(clearance>2+1e-8||clearance<.3-1e-8)return;
      tree.roadsideOffset=clearance;
      if(validPlant(data,tree,[],topology).valid){seen.add(key);points.push(tree);}
    };
    for(const path of topology.paths){
      const anchorDistances=[];for(let d=3;d<path.length;d+=6)anchorDistances.push(d);
      // Near a shared junction include corner targets, so one public tree can
      // shade more than one arm even when regular samples miss the corner.
      for(const node of topology.intersections.filter(n=>n.pathIds.includes(path.id))){
        for(const edge of topology.segments.filter(e=>e.pathIds.includes(path.id))){
          const atStart=distance(node,edge.a)<1e-6,atEnd=distance(node,edge.b)<1e-6;if(!atStart&&!atEnd)continue;
          for(const member of edge.members.filter(m=>m.pathId===path.id)){
            const d=member.forward?(atStart?member.startDistance:member.endDistance):(atStart?member.endDistance:member.startDistance);
            for(const offset of [0,-(path.width/2+1),path.width/2+1])if(d+offset>0&&d+offset<path.length)anchorDistances.push(d+offset);
          }
        }
      }
      const uniqueDistances=[...new Set(anchorDistances.map(d=>Math.round(d*1e6)/1e6))].sort((a,b)=>a-b);
      for(const d of uniqueDistances) {
      const p=pointAlong(path.points,d),normal={x:-p.ty,y:p.tx};
      for(const departureTime of candidateTimes){
        const arrival=departureTime+d/SPEED/60,sun=solar({...s,minutes:arrival});
        if(!sun.daylight)continue;
        const q=shadowParameters(sun),radius=data.treeTemplate.radius,centreHeight=data.treeTemplate.height;
        const major=radius/q.sin;
        // Radial ellipse radius along the route normal. An offset of 65% or
        // 90% still puts the target route anchor inside the projected canopy.
        const dot=normal.x*q.dx+normal.y*q.dy;
        const radial=1/Math.sqrt(dot*dot/(major*major)+(1-dot*dot)/(radius*radius));
        for(const fraction of [0,-.65,.65,-.9,.9]){
          const offset=radial*fraction;
          const shadowX=p.x+normal.x*offset,shadowY=p.y+normal.y*offset;
          add(shadowX-centreHeight*q.cot*q.dx,shadowY-centreHeight*q.cot*q.dy,{candidateSource:'inverse-shadow',targetPathId:path.id,targetDistance:d,targetTime:arrival,targetX:p.x,targetY:p.y,normalOffset:offset});
        }
        // Sample both verges close to the pavement. Real projected union gain
        // chooses the useful sun-facing side; proximity alone earns no reward.
        for(const setback of [.6,1])for(const side of [-1,1])add(p.x+normal.x*(path.width/2+setback)*side,p.y+normal.y*(path.width/2+setback)*side,{candidateSource:'roadside',targetPathId:path.id,targetDistance:d});
      }
    }
    }
    return points;
  }
  const optimizerCache=new Map();
  function optimizationOrder(data, settings) {
    // Current-time plans include the selected minute; legacy lunch plans do not.
    const {minutes:unused,...environment}=settings;
    const key=geometryKey(data)+'|'+JSON.stringify(settings.optimizationMode==='lunch'?environment:settings);
    if(optimizerCache.has(key))return optimizerCache.get(key);
    const points=candidates(data,settings),elements=[];
    for(const departure of activeDepartures(settings)) {
      for(const p of baselineSamples(data,{...settings,minutes:departure.minutes})) {
        if(p.q&&p.kind==='sun')elements.push({...p,weightedMinutes:p.objectiveWeight/SPEED/60*departure.weight});
      }
    }
    const coverage=points.map(tree=>{
      const indices=[];for(let i=0;i<elements.length;i++)if(inEllipse(elements[i],treeShadow(tree,elements[i].q)))indices.push(i);return indices;
    });
    const covered=new Uint8Array(elements.length),selected=[],curve=[{count:0,cost:0,gain:0}],available=new Set(points.map((_,i)=>i));
    let total=0;
    while(available.size){
      let best=-1,bestGain=1e-12;
      for(const candidate of available){let gain=0;for(const index of coverage[candidate])if(!covered[index])gain+=elements[index].weightedMinutes;if(gain>bestGain+1e-12){best=candidate;bestGain=gain;}}
      if(best<0)break;
      selected.push({...points[best],servicePathIds:[...new Set(coverage[best].map(index=>elements[index].pathId))]});for(const index of coverage[best])covered[index]=1;available.delete(best);total+=bestGain;
      // Near a route bend, two candidates may be close; retain both in the
      // candidate set, then enforce trunk clearance only after an actual pick.
      for(const candidate of available)if(distance(points[candidate],points[best])<3.5)available.delete(candidate);
      curve.push({count:selected.length,cost:selected.length*(data.treeTemplate.cost||COST),gain:total});
    }
    return boundedSet(optimizerCache,key,{trees:selected,curve,candidateCount:points.length,elementCount:elements.length},128);
  }
  function optimize(data,budget,settings={}) {
    if(!Number.isFinite(budget)||budget<0)budget=0;
    const s=settingsFor(data,settings),order=optimizationOrder(data,s),cost=data.treeTemplate.cost||COST;
    const count=Math.min(Math.floor(budget/cost),order.trees.length),curve=order.curve.slice(0,count+1),gain=curve[count].gain;
    const nearCount=gain>0?curve.findIndex(p=>p.gain>=gain*0.91):0;
    return {trees:order.trees.slice(0,count).map(t=>({...t})),cost:count*cost,gain,curve:curve.map(p=>({...p})),nearTrees:order.trees.slice(0,nearCount).map(t=>({...t})),nearCost:nearCount*cost,retention:gain?curve[nearCount].gain/gain:1,candidateCount:order.candidateCount,optimizationMode:s.optimizationMode,objective:s.optimizationMode==='lunch'?'additional weighted shade minutes over 15 lunch departures':'additional shaded minutes for selected departure with arrival-time solar positions',audit:order.trees.slice(0,count).map((t,i)=>({id:t.id,gain:curve[i+1].gain-curve[i].gain,cumulativeGain:curve[i+1].gain,score:(curve[i+1].gain-curve[i].gain)/cost})),departures:activeDepartures(s).map(d=>({...d}))};
  }
  function auditPlan(data,trees,settings={}) {
    const s=settingsFor(data,settings);
    let baselineWeightedMinutes=0,plannedWeightedMinutes=0;
    const cohorts=activeDepartures(s).map(departure=>{
      let baseline=0,planned=0;
      for(const p of baselineSamples(data,{...s,minutes:departure.minutes})) {
        const weight=p.objectiveWeight/SPEED/60;
        const was=p.kind==='building'||p.kind==='tree';
        const now=was||Boolean(p.q&&trees.some(t=>inEllipse(p,treeShadow(t,p.q))));
        if(was)baseline+=weight;if(now)planned+=weight;
      }
      baselineWeightedMinutes+=baseline*departure.weight;plannedWeightedMinutes+=planned*departure.weight;
      return {...departure,baselineMinutes:baseline,plannedMinutes:planned,gain:(planned-baseline)*departure.weight};
    });
    return {gain:plannedWeightedMinutes-baselineWeightedMinutes,baselineWeightedMinutes,plannedWeightedMinutes,departures:cohorts,optimizationMode:s.optimizationMode};
  }
  function exportCampus(data, trees, settings, budget) {
    const s=settingsFor(data,settings),metrics=evaluate(data,trees,s);
    const {profile,mapProfile,network:topology,...summary}=metrics;
    return JSON.parse(JSON.stringify({...data,location:{...data.location,latitude:s.latitude,longitude:s.longitude,timezone:s.timezone},trees:data.trees.concat(trees).map(t=>({...t})),metadata:{...data.metadata,exportedAt:new Date().toISOString(),model:'ShadePath NOAA solar + opaque canopy + official UTCI approximation; synthetic weather',measured:false},scenario:{settings:s,budget,spent:trees.length*(data.treeTemplate.cost||COST),baselineTreeIds:data.trees.map(t=>t.id),addedTreeIds:trees.map(t=>t.id),metrics:summary}}));
  }
  function restoreScenario(exported) {
    if(!exported||exported.schemaVersion!==1||!Array.isArray(exported.trees)||(!Array.isArray(exported.paths)&&!Array.isArray(exported.route))||!Array.isArray(exported.buildings)||!exported.scenario||!Array.isArray(exported.scenario.addedTreeIds))throw new RangeError('Invalid ShadePath scenario');
    const data=JSON.parse(JSON.stringify(exported)),scenario=data.scenario;
    const allIds=data.trees.map(t=>t.id),addedIds=new Set(scenario.addedTreeIds);
    if(allIds.some(id=>typeof id!=='string')||new Set(allIds).size!==allIds.length||[...addedIds].some(id=>!allIds.includes(id)))throw new RangeError('Scenario tree IDs must be unique and refer to scene trees');
    const trees=data.trees.filter(t=>addedIds.has(t.id));
    data.trees=data.trees.filter(t=>!addedIds.has(t.id));
    const settings=settingsFor(data,scenario.settings||{});
    solar(settings); // Validate date and numeric solar inputs before consuming a file.
    data.location={...data.location,latitude:settings.latitude,longitude:settings.longitude,timezone:settings.timezone};
    if(!Number.isFinite(scenario.budget)||scenario.budget<0)throw new RangeError('Invalid scenario budget');
    delete data.scenario;
    return {campus:data,trees,settings,budget:scenario.budget};
  }
  root.ShadeEngine=Object.freeze({campus,defaults:DEFAULT,network,solar,shadows,sampleRoute,evaluate,optimize,validPlant,roadsideDistance,treeAt,exportCampus,restoreScenario,thermal,weather,auditPlan,routeLength,candidates,departures,pointInPolygon,inEllipse,convexHull,speed:SPEED});
})(globalThis);

import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/thermal.js';
import '../src/engine.js';
const E=globalThis.ShadeEngine, campus=E.campus;
const close=(actual,expected,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected} by more than ${tolerance}`);

test('NOAA solar position agrees with independent NREL SPA published reference to 0.01 degree',()=>{
  // NREL/TP-560-34302 Appendix A5: 2003-10-17 12:30:30 MST, Golden CO.
  // https://www.nlr.gov/docs/fy08osti/34302.pdf ; this is a reference test,
  // not an implementation of, or redistribution of, the NREL SPA code.
  const s=E.solar({date:'2003-10-17',minutes:750.5,latitude:39.742476,longitude:-105.1786,timezone:-7});
  close(s.altitude,90-50.111622,0.01); close(s.azimuth,194.340241,0.01);
  assert.ok(s.altitude>s.geometricAltitude);
  close(s.sunrise,6*60+12+43/60,2);close(s.sunset,17*60+20+19/60,2);
});
test('timezone and longitude signs preserve the same physical instant',()=>{
  const local=E.solar({date:'2026-06-21',minutes:740,latitude:31.23,longitude:121.47,timezone:8});
  const utc=E.solar({date:'2026-06-21',minutes:260,latitude:31.23,longitude:121.47,timezone:0});
  close(local.altitude,utc.altitude);close(local.azimuth,utc.azimuth);
  const shifted=E.solar({date:'2026-06-21',minutes:800,latitude:31.23,longitude:121.47,timezone:9});
  close(shifted.altitude,local.altitude);close(shifted.azimuth,local.azimuth);
});
test('summer noon is high, winter lower, morning east, evening west; polar states stay finite',()=>{
  assert.ok(E.solar({minutes:540}).azimuth<180);
  assert.ok(E.solar({minutes:960}).azimuth>180);
  assert.ok(E.solar().altitude>E.solar({date:'2026-12-21'}).altitude+35);
  for(const latitude of [-90,-80,80,90])for(const date of ['2026-06-21','2026-12-21']){
    const s=E.solar({latitude,date});assert.ok(Number.isFinite(s.altitude)&&Number.isFinite(s.azimuth));
    assert.ok(['polarDay','polarNight'].includes(s.dayState));assert.equal(s.sunrise,null);assert.equal(s.sunset,null);
  }
});
test('route trapezoid weights integrate exactly 208 metres and travel 208/1.15 seconds',()=>{
  const points=E.sampleRoute(campus.route); assert.equal(points.length,417);
  close(points.reduce((n,p)=>n+p.weight,0),208); close(E.routeLength(campus.route),208);
  const result=E.evaluate(campus,[]);close(result.walkMinutes,208/1.15/60);
  close(result.profile[0].time,740);close(result.profile.at(-1).time,740+208/1.15/60);
  assert.ok(result.profile.every((p,i)=>!i||p.time>result.profile[i-1].time));
  close(E.sampleRoute([{x:0,y:0},{x:1.2,y:0}],.5).reduce((n,p)=>n+p.weight,0),1.2);
  assert.throws(()=>E.sampleRoute(campus.route,0),RangeError);
});
test('tree ellipses match independent 3D ray/sphere intersections in four solar directions',()=>{
  const tree={id:'sphere',x:20,y:20,height:8,radius:4.6};
  for(const azimuth of [35,90,180,270])for(const altitude of [10,45,80]){
    const a=altitude*Math.PI/180,z=azimuth*Math.PI/180,dir=[Math.sin(z)*Math.cos(a),Math.cos(z)*Math.cos(a),Math.sin(a)];
    const ellipse=E.shadows({...campus,buildings:[]},{altitude,azimuth},[tree]).trees[0];
    for(let x=-50;x<90;x+=3.7)for(let y=-50;y<90;y+=3.7){
      const delta=[x-tree.x,y-tree.y,-tree.height],b=delta.reduce((sum,v,i)=>sum+v*dir[i],0),c=delta.reduce((sum,v)=>sum+v*v,0)-tree.radius**2;
      const discriminant=b*b-c,hit=discriminant>=0&&-b+Math.sqrt(discriminant)>=0;
      assert.equal(E.inEllipse({x,y},ellipse),hit,`az${azimuth} alt${altitude} point${x},${y}`);
    }
  }
});
test('south sun casts building shadow north with exact height/tan length',()=>{
  const block={polygon:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],height:10};
  const shadow=E.shadows({...campus,buildings:[block]},{altitude:45,azimuth:180},[]).buildings[0];
  close(Math.max(...shadow.map(p=>p.y)),20);close(Math.min(...shadow.map(p=>p.y)),0);
  assert.equal(E.pointInPolygon({x:5,y:19.9},shadow),true);
  assert.equal(E.pointInPolygon({x:5,y:-.1},shadow),false);
});
test('union shade never double counts duplicate tree shadows or existing shade',()=>{
  const tree=E.treeAt(campus,90,24.5,'test');
  const once=E.evaluate(campus,[tree]),twice=E.evaluate(campus,[tree,{...tree,id:'duplicate'}]);
  close(once.shadeRate,twice.shadeRate);close(once.meanUTCI,twice.meanUTCI);
  const base=E.evaluate(campus,[]),existing=E.evaluate(campus,campus.trees);
  close(base.shadeRate,existing.shadeRate);close(base.meanUTCI,existing.meanUTCI);
  close(E.auditPlan(campus,campus.trees).gain,0);
});
test('night produces no geometric shade, no differential heat benefit and no polar-night purchases',()=>{
  const opt=E.optimize(campus,2200),night=E.evaluate(campus,opt.trees,{minutes:0});
  assert.equal(night.daylight,false);assert.equal(night.shadeRate,0);assert.equal(night.baselineRate,0);
  close(night.meanUTCI,night.baselineUTCI);assert.deepEqual(E.shadows(campus,night.solar),{buildings:[],trees:[]});
  const polar=E.optimize(campus,5000,{latitude:80,date:'2026-12-21'});assert.equal(polar.cost,0);assert.equal(polar.gain,0);
});
test('placement excludes footprints, road centreline, trunks and campus exterior',()=>{
  assert.equal(E.validPlant(campus,{x:10,y:20}).reason,'building');
  assert.equal(E.validPlant(campus,{x:80,y:28}).reason,'route');
  assert.equal(E.validPlant(campus,{x:37,y:24.5}).reason,'overlap');
  assert.equal(E.validPlant(campus,{x:-1,y:20}).reason,'outside');
  assert.equal(E.validPlant(campus,{x:90,y:24.5}).valid,true);
  for(const candidate of E.candidates(campus))assert.equal(E.validPlant(campus,candidate).valid,true);
  const selected=[];for(const tree of E.optimize(campus,5000).trees){assert.equal(E.validPlant(campus,tree,selected).valid,true);selected.push(tree);}
});
test('all 15 departure slices have normalized cohort weights and a total one-student journey',()=>{
  assert.equal(E.departures.length,15);close(E.departures.reduce((n,p)=>n+p.weight,0),1);
  for(const [i,expected] of [.25,.45,.30].entries())close(E.departures.slice(i*5,i*5+5).reduce((n,p)=>n+p.weight,0),expected);
  assert.deepEqual(E.departures.slice(0,5).map(d=>d.minutes),[702,706,710,714,718]);
  const settings={optimizationMode:'lunch'},plan=E.optimize(campus,2200,settings),audit=E.auditPlan(campus,plan.trees,settings);
  close(audit.gain,plan.gain,1e-9);
  close(audit.departures.reduce((n,d)=>n+d.gain,0),plan.gain,1e-9);
  assert.ok(audit.plannedWeightedMinutes<=208/1.15/60+1e-9);
});
test('budgets never overspend and increasing budget extends a deterministic prefix with nondecreasing benefit',()=>{
  let previous={trees:[],gain:0};
  for(let budget=0;budget<=5000;budget+=50){
    const plan=E.optimize(campus,budget);assert.ok(plan.cost<=budget);assert.equal(plan.cost,plan.trees.length*95);
    assert.deepEqual(plan.trees.slice(0,previous.trees.length),previous.trees);assert.ok(plan.gain>=previous.gain-1e-12);previous=plan;
  }
  for(const invalid of [-1,NaN,Infinity])assert.equal(E.optimize(campus,invalid).cost,0);
  assert.equal(E.optimize(campus,94).cost,0);assert.equal(E.optimize(campus,95).cost,95);
});
test('greedy first three picks maximize independently recomputed marginal union gain',()=>{
  const plan=E.optimize(campus,285),pool=E.candidates(campus),chosen=[];
  let gain=0;
  for(const tree of plan.trees){
    const actual=E.auditPlan(campus,chosen.concat(tree)).gain-gain;
    let best=0;
    for(const candidate of pool)if(!chosen.some(t=>t.id===candidate.id)&&E.validPlant(campus,candidate,chosen).valid)best=Math.max(best,E.auditPlan(campus,chosen.concat(candidate)).gain-gain);
    close(actual,best,1e-9);chosen.push(tree);gain+=actual;
  }
});
test('91% plan is the smallest qualifying prefix and audit marginals sum to total gain',()=>{
  const plan=E.optimize(campus,2200),n=plan.nearTrees.length;
  assert.ok(plan.retention>=.91&&plan.retention<=1);assert.equal(plan.nearCost,n*95);
  if(n>0)assert.ok(plan.curve[n-1].gain<plan.gain*.91);
  close(plan.audit.reduce((sum,p)=>sum+p.gain,0),plan.gain);
  assert.ok(plan.audit.every((p,i)=>p.gain>0&&(!i||p.gain<=plan.audit[i-1].gain+1e-10)));
  for(const p of plan.audit)close(p.score,p.gain/95);
});
test('weather inputs reach official UTCI and the simplified proxy stays separate',()=>{
  const settings={airTemperature:32,relativeHumidity:55,windSpeed:1.2};
  const result=E.evaluate(campus,E.optimize(campus,2200).trees,settings);
  assert.equal(result.thermalValid,true);assert.equal(result.weather.ta,32);assert.equal(result.weather.wind,1.2);assert.equal(result.weather.rh,55);
  const p=result.profile[120],expected=globalThis.ShadeThermal.utci({ta:32,rh:55,wind:1.2,tmrt:p.tmrt});
  close(p.thermal,expected.value);assert.ok(Math.abs(result.meanUTCI-result.meanProxy)>.01);
  assert.ok(result.meanUTCI<result.baselineUTCI);assert.equal(result.meanThermal,result.meanUTCI);
});
test('out-of-domain official thermal inputs remain null, never silently become proxy numbers',()=>{
  const result=E.evaluate(campus,[],{windSpeed:0.1});
  assert.equal(result.thermalValid,false);assert.equal(result.meanUTCI,null);assert.equal(result.meanThermal,null);assert.equal(result.heatLoad,null);assert.equal(result.hotMinutes,null);
  assert.ok(Number.isFinite(result.meanProxy));assert.ok(result.profile.every(p=>p.thermal===null));
});
test('export preserves real model inputs, unchanged source campus and marked provenance',()=>{
  const original=JSON.stringify(campus),plan=E.optimize(campus,2200),json=E.exportCampus(campus,plan.trees,{},2200);
  assert.equal(json.metadata.measured,false);assert.equal(json.metadata.provenance,'synthetic');assert.equal(json.scenario.spent,plan.cost);
  assert.equal(json.trees.length,campus.trees.length+plan.trees.length);assert.equal(json.scenario.addedTreeIds.length,plan.trees.length);
  assert.equal(json.scenario.settings.date,'2026-06-21');assert.ok(Number.isFinite(json.scenario.metrics.meanUTCI));
  assert.equal(JSON.stringify(campus),original);assert.deepEqual(JSON.parse(JSON.stringify(json)),json);
});

test('walks crossing sunrise or sunset preserve a partial daylight fraction independently of departure state',()=>{
  const plan=E.optimize(campus,2200);
  const dawn=E.evaluate(campus,plan.trees,{minutes:291});
  assert.equal(dawn.daylightAtDeparture,false);assert.equal(dawn.daylight,false);
  assert.equal(dawn.anyDaylight,true);assert.equal(dawn.fullNight,false);
  assert.ok(dawn.daylightFraction>0&&dawn.daylightFraction<1);
  close(dawn.daylightFraction,dawn.profile.reduce((sum,p)=>sum+(p.shadeKind==='night'?0:p.weight),0)/208);
  let sunset=null;
  for(let minutes=1130;minutes<1155;minutes+=.5){const result=E.evaluate(campus,plan.trees,{minutes});if(result.daylightAtDeparture&&result.daylightFraction<1){sunset=result;break;}}
  assert.ok(sunset);assert.equal(sunset.anyDaylight,true);assert.equal(sunset.fullNight,false);
  assert.ok(sunset.daylightFraction>0&&sunset.daylightFraction<1);
  assert.ok(sunset.shadeRate<=sunset.daylightFraction);
  const night=E.evaluate(campus,plan.trees,{minutes:0});assert.equal(night.fullNight,true);assert.equal(night.daylightFraction,0);
  const day=E.evaluate(campus,plan.trees);assert.equal(day.daylightFraction,1);
});

test('export/restore roundtrip preserves changed coordinates, baseline identity and every computed metric',()=>{
  const settings={date:'2026-08-09',minutes:630,latitude:60,longitude:20,timezone:1,airTemperature:30,relativeHumidity:60,windSpeed:2};
  const plan=E.optimize(campus,2200,settings),expected=E.evaluate(campus,plan.trees,settings);
  const file=E.exportCampus(campus,plan.trees,settings,2200);
  assert.deepEqual(file.location,{latitude:60,longitude:20,timezone:1});
  assert.deepEqual(file.scenario.baselineTreeIds,campus.trees.map(t=>t.id));
  const restored=E.restoreScenario(file);
  assert.equal(restored.budget,2200);assert.equal(restored.campus.trees.length,campus.trees.length);assert.deepEqual(restored.trees,plan.trees);
  assert.deepEqual(E.evaluate(restored.campus,restored.trees,restored.settings),expected);
  assert.deepEqual(E.auditPlan(restored.campus,restored.trees,restored.settings),E.auditPlan(campus,plan.trees,settings));
  const again=E.exportCampus(restored.campus,restored.trees,restored.settings,restored.budget);
  assert.deepEqual(again.scenario.metrics,file.scenario.metrics);assert.deepEqual(again.trees,file.trees);
  const malformed=JSON.parse(JSON.stringify(file));malformed.trees.push(malformed.trees[0]);assert.throws(()=>E.restoreScenario(malformed),RangeError);
});

test('canopy spheres cannot intersect building prisms while low roofs below the crown remain feasible',()=>{
  // Formerly selected candidates only 4 m from walls overlap a 4.6 m crown.
  assert.equal(E.validPlant(campus,{x:26,y:24.5}).reason,'building');
  assert.equal(E.validPlant(campus,{x:178.5,y:72}).reason,'building');
  const simplified={...campus,trees:[],route:[{x:1,y:1},{x:2,y:1}],buildings:[{height:2,polygon:[{x:10,y:10},{x:20,y:10},{x:20,y:20},{x:10,y:20}]}]};
  assert.equal(E.validPlant(simplified,{x:22,y:15}).valid,true); // roof below 8−4.6=3.4 m crown base
  assert.equal(E.validPlant(simplified,{x:21,y:15}).reason,'building'); // trunk buffer remains
  simplified.buildings[0].height=5;
  assert.equal(E.validPlant(simplified,{x:23,y:15}).reason,'building'); // slice sqrt(4.6²−3²)=3.487 m
  assert.equal(E.validPlant(simplified,{x:24,y:15}).valid,true); // safe though inside ground radius4.6
  simplified.buildings[0].height=13;
  assert.equal(E.validPlant(simplified,{x:24,y:15}).reason,'building');
  const plan=E.optimize(campus,5000);
  for(const tree of plan.trees)for(const b of campus.buildings){
    const nearest=Math.min(...b.polygon.map((a,i)=>{
      const end=b.polygon[(i+1)%b.polygon.length],dx=end.x-a.x,dy=end.y-a.y;
      const ratio=Math.max(0,Math.min(1,((tree.x-a.x)*dx+(tree.y-a.y)*dy)/(dx*dx+dy*dy)));
      return Math.hypot(tree.x-a.x-ratio*dx,tree.y-a.y-ratio*dy);
    }));
    assert.ok(Math.hypot(nearest,Math.max(0,tree.height-b.height))>=tree.radius-1e-9,`${tree.id} overlaps ${b.id}`);
  }
});

test('export and restore retain IANA timezone metadata while actual scenario coordinates and DST offset take precedence',()=>{
  const data={...campus,location:{latitude:31.23,longitude:121.47,timezone:8,timezoneName:'America/New_York',source:'user-confirmed-geocoding',displayName:'New York campus',query:'Example school, New York'}};
  const settings={date:'2026-07-15',minutes:740,latitude:40.7128,longitude:-74.006,timezone:-4};
  const plan=E.optimize(data,950,settings),file=E.exportCampus(data,plan.trees,settings,950),restored=E.restoreScenario(file);
  for(const location of [file.location,restored.campus.location]){
    assert.equal(location.timezoneName,'America/New_York');assert.equal(location.source,'user-confirmed-geocoding');assert.equal(location.displayName,'New York campus');assert.equal(location.query,'Example school, New York');
    assert.equal(location.latitude,40.7128);assert.equal(location.longitude,-74.006);assert.equal(location.timezone,-4);
  }
  assert.deepEqual(E.evaluate(restored.campus,restored.trees,restored.settings),E.evaluate(data,plan.trees,settings));
  // A date change can derive the correct seasonal offset because the timezone
  // identifier survives. The UI owns this conversion; the engine accepts hours.
  const offsetFor=date=>new Intl.DateTimeFormat('en-US',{timeZone:restored.campus.location.timezoneName,timeZoneName:'shortOffset'}).formatToParts(new Date(date+'T12:00:00Z')).find(part=>part.type==='timeZoneName').value;
  assert.equal(offsetFor('2026-07-15'),'GMT-4');assert.equal(offsetFor('2026-01-15'),'GMT-5');
});

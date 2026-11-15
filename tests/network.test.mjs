import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/thermal.js';
import '../src/engine.js';
import '../src/campus-import.js';
const E=globalThis.ShadeEngine;
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
const make=(paths,extra={})=>({...E.campus,bounds:{width:100,height:100},buildings:[],trees:[],paths,...extra});
const crossPaths=[{id:'h',name:'Horizontal',width:4,demand:1,points:[{x:20,y:50},{x:80,y:50}]},{id:'v',name:'Vertical',width:4,demand:1,points:[{x:50,y:20},{x:50,y:80}]}];
const cross=make(crossPaths);

test('interior crossings split into unique physical edges and expose an intersection without duplicating length',()=>{
  const n=E.network(cross);
  assert.equal(n.length,120);assert.equal(n.weightedLength,120);assert.equal(n.segments.length,4);
  assert.equal(n.intersections.length,1);assert.equal(n.intersections[0].x,50);assert.equal(n.intersections[0].y,50);assert.equal(n.intersections[0].degree,4);
  assert.deepEqual(n.intersections[0].pathIds,['h','v']);
  const metrics=E.evaluate(cross,[]);
  close(metrics.profile.reduce((sum,p)=>sum+p.weight,0),120);
  close(metrics.mapProfile.reduce((sum,p)=>sum+p.weight,0),120);
  assert.deepEqual(metrics.pathMetrics.map(p=>[p.id,p.length]),[['h',60],['v',60]]);
  assert.ok(metrics.profile.every(p=>p.pathId&&p.segmentId&&Number.isFinite(p.distanceAlongSegment)));
  for(const segment of n.segments){const samples=metrics.mapProfile.filter(p=>p.segmentId===segment.id);close(samples.reduce((sum,p)=>sum+p.weight,0),segment.length);}
});

test('one globally purchased junction tree serves both paths and costs only once',()=>{
  const plan=E.optimize(cross,95),metrics=E.evaluate(cross,plan.trees);
  assert.equal(plan.trees.length,1);assert.equal(plan.cost,95);
  assert.deepEqual(new Set(plan.trees[0].servicePathIds),new Set(['h','v']));
  assert.deepEqual(new Set(metrics.treeServices[0].pathIds),new Set(['h','v']));
  assert.ok(metrics.pathMetrics.every(path=>path.shadeRate>path.baselineRate));
  close(plan.gain,E.auditPlan(cross,plan.trees).gain);
  close(plan.gain,(metrics.shadeRate-metrics.baselineRate)*metrics.walkMinutes);
  const twice=E.evaluate(cross,plan.trees.concat(plan.trees));
  close(metrics.shadeRate,twice.shadeRate);
});

test('collinear overlap and exact duplicate paths do not double physical length, demand, budget or shade reward',()=>{
  const path={id:'a',name:'A',width:4,demand:2,points:[{x:10,y:50},{x:90,y:50}]};
  const one=make([path]),duplicate=make([path,{...path,id:'copy'}]);
  const a=E.optimize(one,950),b=E.optimize(duplicate,950);
  assert.equal(E.network(one).length,80);assert.equal(E.network(duplicate).length,80);
  assert.equal(E.network(duplicate).weightedLength,160);
  assert.equal(a.cost,b.cost);close(a.gain,b.gain);
  assert.deepEqual(a.trees.map(t=>[t.x,t.y]),b.trees.map(t=>[t.x,t.y]));
  close(E.evaluate(one,a.trees).shadeRate,E.evaluate(duplicate,b.trees).shadeRate);
  const partial=make([{id:'left',points:[{x:10,y:20},{x:70,y:20}],width:3,demand:1},{id:'right',points:[{x:40,y:20},{x:90,y:20}],width:7,demand:3}]);
  const n=E.network(partial);
  assert.equal(n.length,80);assert.equal(n.segments.length,3);assert.equal(n.overlapSegments,1);
  close(n.weightedLength,30*1+30*2+20*3);
  const shared=n.segments.find(segment=>segment.pathIds.length===2);assert.equal(shared.length,30);assert.equal(shared.width,7);
});

test('shared edges average each path arrival by demand while separate path metrics retain their own journeys',()=>{
  const paths=[{id:'out',points:[{x:10,y:50},{x:90,y:50}],width:4,demand:1},{id:'back',points:[{x:90,y:50},{x:10,y:50}],width:4,demand:3}];
  const data=make(paths),settings={minutes:1080},plan=E.optimize(data,285,settings),metrics=E.evaluate(data,plan.trees,settings);
  close(metrics.length,80);close(metrics.weightedLength,160);
  close(metrics.profile.reduce((n,p)=>n+p.weight,0),80);close(metrics.profile.reduce((n,p)=>n+p.objectiveWeight,0),160);
  const out=metrics.profile.find(p=>p.pathId==='out'&&Math.abs(p.x-30)<1e-9),back=metrics.profile.find(p=>p.pathId==='back'&&Math.abs(p.x-30)<1e-9);
  close(out.time,1080+20/E.speed/60);close(back.time,1080+60/E.speed/60);
  paths.forEach(path=>{const own=E.evaluate(make([path]),plan.trees,settings),inNetwork=metrics.pathMetrics.find(p=>p.id===path.id);close(inNetwork.shadeRate,own.shadeRate);close(inNetwork.baselineRate,own.baselineRate);});
  close(metrics.shadeRate,metrics.pathMetrics[0].shadeRate*.25+metrics.pathMetrics[1].shadeRate*.75);
  const independent=metrics.profile.reduce((gain,p)=>gain+(!p.baselineShaded&&p.shaded?p.objectiveWeight/E.speed/60:0),0);
  close(plan.gain,independent);close(plan.gain,E.auditPlan(data,plan.trees,settings).gain);
});

test('network greedy first three choices maximize independently recomputed shared coverage per dollar',()=>{
  const plan=E.optimize(cross,285),pool=E.candidates(cross),chosen=[];let previous=0;
  for(const tree of plan.trees){
    const actual=E.auditPlan(cross,chosen.concat(tree)).gain-previous;let best=0;
    for(const candidate of pool)if(E.validPlant(cross,candidate,chosen).valid)best=Math.max(best,E.auditPlan(cross,chosen.concat(candidate)).gain-previous);
    close(actual,best);chosen.push(tree);previous+=actual;
  }
  close(plan.cost,chosen.length*95);close(plan.gain,previous);
});

test('all path widths and imported bounds constrain candidates, independent of stale legacy route',()=>{
  const large=make([{id:'wide',points:[{x:50,y:200},{x:550,y:200}],width:12,demand:1},{id:'branch',points:[{x:300,y:150},{x:300,y:300}],width:8,demand:1}],{bounds:{width:600,height:400}});
  assert.equal(E.network(large).length,650);
  assert.equal(E.validPlant(large,{x:200,y:205}).reason,'route');assert.equal(E.validPlant(large,{x:303,y:250}).reason,'route');
  const plan=E.optimize(large,950,{minutes:1080}),selected=[];
  assert.ok(plan.trees.length>0);assert.ok(plan.cost<=950);
  for(const tree of plan.trees){assert.equal(E.validPlant(large,tree,selected).valid,true);assert.ok(tree.x>=1&&tree.x<=599&&tree.y>=1&&tree.y<=399);selected.push(tree);}
  assert.ok(E.candidates(large,{minutes:1080}).some(tree=>tree.x>220));
});

test('an explicit empty network stays empty and a paths-only export restores the exact network scenario',()=>{
  const empty=make([]),metrics=E.evaluate(empty,[]),plan=E.optimize(empty,5000);
  assert.equal(metrics.length,0);assert.equal(metrics.walkMinutes,0);assert.equal(metrics.shadeRate,0);assert.deepEqual(metrics.pathMetrics,[]);assert.deepEqual(metrics.profile,[]);
  assert.equal(plan.cost,0);assert.equal(plan.gain,0);assert.deepEqual(plan.trees,[]);assert.deepEqual(E.candidates(empty),[]);
  const data={...cross};delete data.route;
  const trees=E.optimize(data,285).trees,exported=E.exportCampus(data,trees,{},285),restored=E.restoreScenario(exported);
  assert.equal(restored.campus.paths.length,2);assert.deepEqual(E.evaluate(restored.campus,restored.trees,restored.settings),E.evaluate(data,trees));
});

test('the visible four-path campus has three junctions and shares public trees across branches',()=>{
  const data={...E.campus,paths:[{id:'main',points:E.campus.route,width:5,demand:1},{id:'cross',points:[{x:23,y:58},{x:182,y:58}],width:5,demand:1},{id:'library',points:[{x:76,y:58},{x:76,y:75}],width:5,demand:1},{id:'activity',points:[{x:135,y:58},{x:135,y:86}],width:5,demand:1}]};
  const plan=E.optimize(data,1350),metrics=E.evaluate(data,plan.trees);
  assert.equal(metrics.length,412);assert.equal(metrics.network.intersections.length,3);
  assert.equal(plan.trees.length,14);assert.equal(plan.cost,1330);
  assert.ok(metrics.treeServices.filter(tree=>tree.pathIds.length>1).length>=3);
  assert.ok(metrics.shadeRate>metrics.baselineRate);
  assert.ok(metrics.pathMetrics.every(path=>path.shadeRate>=path.baselineRate));
});

test('a maximum-length allowed network exports compact inputs that its own importer can validate and restore',()=>{
  const data={...E.campus,bounds:{width:1000,height:1000},paths:[{id:'long-east',name:'Long east walkway',points:[{x:0,y:500},{x:1000,y:500}],width:5,demand:1},{id:'long-north',name:'Long north walkway',points:[{x:500,y:0},{x:500,y:1000}],width:5,demand:1}]};
  const file=E.exportCampus(data,[],{},2200);
  assert.equal(file.scenario.metrics.length,2000);
  assert.equal(file.scenario.metrics.profile,undefined);assert.equal(file.scenario.metrics.mapProfile,undefined);assert.equal(file.scenario.metrics.network,undefined);
  assert.equal(file.scenario.metrics.pathMetrics.length,2);assert.deepEqual(file.scenario.metrics.treeServices,[]);
  const checked=globalThis.ShadeCampusImport.parseJSON(JSON.stringify(file));
  const restored=E.restoreScenario(checked);
  assert.equal(E.network(restored.campus).length,2000);assert.equal(restored.budget,2200);assert.equal(restored.trees.length,0);
  close(E.evaluate(restored.campus,restored.trees,restored.settings).shadeRate,file.scenario.metrics.shadeRate);
});

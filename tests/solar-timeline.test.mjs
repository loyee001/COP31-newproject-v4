import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/thermal.js';
import '../src/engine.js';

const E=globalThis.ShadeEngine, C=E.campus;
const settings={...E.defaults,airTemperature:32,relativeHumidity:55,windSpeed:1.2};
const times=[540,740,900,1080];
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);

function routeDistance(point) {
  return Math.min(...C.route.slice(1).map((end,index)=>{
    const start=C.route[index],dx=end.x-start.x,dy=end.y-start.y;
    const fraction=Math.max(0,Math.min(1,((point.x-start.x)*dx+(point.y-start.y)*dy)/(dx*dx+dy*dy)));
    return Math.hypot(point.x-start.x-fraction*dx,point.y-start.y-fraction*dy);
  }));
}

test('each selected departure optimizes its own budget-safe positions and current-time union benefit',()=>{
  const plans=times.map(minutes=>{
    const scenario={...settings,minutes},plan=E.optimize(C,1350,scenario),result=E.evaluate(C,plan.trees,scenario),audit=E.auditPlan(C,plan.trees,scenario);
    assert.equal(plan.optimizationMode,'current');
    assert.deepEqual(plan.departures,[{minutes,weight:1}]);
    assert.equal(audit.departures.length,1);assert.equal(audit.departures[0].minutes,minutes);
    assert.ok(plan.cost<=1350);assert.equal(plan.cost,plan.trees.length*95);
    close(plan.gain,audit.gain);close(plan.gain,(result.shadeRate-result.baselineRate)*result.walkMinutes);
    assert.ok(result.shadeRate>result.baselineRate+.35);
    const selected=[];
    for(const tree of plan.trees){assert.equal(E.validPlant(C,tree,selected).valid,true);selected.push(tree);}
    // A larger budget extends this time's order, rather than another time's cached plan.
    const larger=E.optimize(C,5000,scenario);
    assert.deepEqual(larger.trees.slice(0,plan.trees.length),plan.trees);
    assert.ok(larger.gain>=plan.gain);
    return plan;
  });
  for(let i=1;i<plans.length;i++)assert.notDeepEqual(plans[i].trees.map(t=>[t.x,t.y]),plans[i-1].trees.map(t=>[t.x,t.y]));
  const night=E.optimize(C,1350,{...settings,minutes:0});
  assert.deepEqual(night.trees,[]);assert.equal(night.cost,0);assert.equal(night.gain,0);assert.equal(night.candidateCount,0);
});

test('inverse-shadow trees may stand far from the path while their actual arrival-time shadows cover route anchors',()=>{
  let checked=0;
  for(const minutes of times){
    const scenario={...settings,minutes},plan=E.optimize(C,1350,scenario);
    for(const tree of plan.trees.filter(tree=>tree.candidateSource==='inverse-shadow')){
      const sun=E.solar({...scenario,minutes:tree.targetTime});
      const shadow=E.shadows(C,sun,[tree]).trees[0];
      assert.ok(E.inEllipse({x:tree.targetX,y:tree.targetY},shadow),`${tree.id} misses its route target`);
      close(tree.targetTime,minutes+tree.targetDistance/E.speed/60);
      const dx=shadow.x-tree.x,dy=shadow.y-tree.y,length=Math.hypot(dx,dy),az=sun.azimuth*Math.PI/180;
      close((dx*Math.sin(az)+dy*Math.cos(az))/length,-1,1e-12);
      checked++;
    }
  }
  assert.ok(checked>10);
  const evening=E.optimize(C,1350,{...settings,minutes:1080});
  assert.ok(evening.trees.some(tree=>tree.candidateSource==='inverse-shadow'&&tree.targetDistance<160&&routeDistance(tree)>15),'evening inverse projection should find useful trees more than15m from the horizontal road');
  const metrics=E.evaluate(C,evening.trees,{...settings,minutes:1080});
  const duplicates=E.evaluate(C,evening.trees.concat(evening.trees),{...settings,minutes:1080});
  close(metrics.shadeRate,duplicates.shadeRate);
  close(E.auditPlan(C,evening.trees,{...settings,minutes:1080}).gain,E.auditPlan(C,evening.trees.concat(evening.trees),{...settings,minutes:1080}).gain);
  const midnight=E.solar({...settings,minutes:0});
  assert.deepEqual(E.shadows(C,midnight,C.trees),{buildings:[],trees:[]});
});

test('explicit lunch mode remains display-time independent and a dawn-crossing walk is not discarded as night',()=>{
  const first={...settings,optimizationMode:'lunch',minutes:0},second={...first,minutes:1080};
  assert.deepEqual(E.candidates(C,first),E.candidates(C,second));
  const a=E.optimize(C,1350,first),b=E.optimize(C,1350,second);
  assert.deepEqual(a.trees,b.trees);assert.equal(a.departures.length,15);close(a.gain,b.gain);
  close(E.auditPlan(C,a.trees,first).gain,E.auditPlan(C,b.trees,second).gain);
  // A large open mathematical site allows long, near-horizon projections.
  // This detects an incorrect early return based only on departure altitude.
  const openSite={...C,bounds:{width:100000,height:100000},buildings:[],trees:[]};
  const dawn={...settings,minutes:291};
  assert.ok(E.solar(dawn).altitude<0);
  const plan=E.optimize(openSite,1350,dawn),metrics=E.evaluate(openSite,plan.trees,dawn);
  assert.equal(metrics.anyDaylight,true);assert.ok(plan.candidateCount>0);assert.ok(plan.gain>0);
  close(plan.gain,(metrics.shadeRate-metrics.baselineRate)*metrics.walkMinutes);
});

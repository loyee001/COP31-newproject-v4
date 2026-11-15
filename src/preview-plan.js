/* The exact planning engine runs off the UI thread, including for unconfirmed
   map previews. A preview never commits recognition candidates. */
(function () {
  'use strict';
  const source=__SHADE_PLANNER_WORKER__;
  let worker=null,rejectPending=null,url=null;
  function cancel(){worker?.terminate();worker=null;if(rejectPending)rejectPending(new Error('superseded'));rejectPending=null;}
  function run(campus,budget,settings){
    cancel();
    return new Promise((resolve,reject)=>{
      if(typeof Worker==='undefined'){reject(new Error('当前浏览器不支持后台方案计算'));return;}
      if(!url)url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
      worker=new Worker(url);rejectPending=reject;
      worker.onmessage=event=>{const result=event.data;worker.terminate();worker=null;rejectPending=null;if(result.error)reject(new Error(result.error));else resolve(result.plan);};
      worker.onerror=event=>{worker?.terminate();worker=null;rejectPending=null;reject(new Error(event.message||'方案计算未完成'));};
      const {image,...geometry}=campus;
      worker.postMessage({campus:geometry,budget,settings});
    });
  }
  globalThis.ShadePreviewPlan=Object.freeze({run,cancel});
})();

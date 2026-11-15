/* The user's selected campus plan. All heights and the scale remain assumptions. */
(function () {
  'use strict';
  const data = __CAMPUS_PRESET_DATA__;
  const dataUrl = '__CAMPUS_PRESET_IMAGE__';
  const copy = value => JSON.parse(JSON.stringify(value));
  function create() {
    return {...copy(data), image:{dataUrl,pixelWidth:1706,pixelHeight:922,widthMeters:data.bounds.width,northRotation:0}};
  }
  function matches(campus) { return campus?.image?.dataUrl === dataUrl; }
  function attach(campus) {
    if (!matches(campus)) return campus;
    const factor=campus.bounds.width/data.bounds.width;
    return {...campus,metadata:{...campus.metadata,...data.metadata},location:{...data.location},
      buildings:copy(data.buildings).map(building=>({...building,polygon:building.polygon.map(p=>({x:p.x*factor,y:p.y*factor}))}))};
  }
  globalThis.ShadeCampusPreset=Object.freeze({create,matches,attach});
})();

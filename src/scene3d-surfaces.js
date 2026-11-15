/* Semantic terrain and world-scale surface detail. The 2D source is never
   used as a beauty texture: printed tree symbols must not become fixed shadows. */
(function () {
  'use strict';
  function create({THREE:T,track,renderer}) {
    const random = (x,y) => {const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n);};
    function surface(color,kind,options={}) {
      const material=track(new T.MeshStandardMaterial({color,roughness:.88,...options}));
      material.onBeforeCompile=shader=>{
        shader.vertexShader='varying vec3 surfacePosition;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
          vec4 surfaceWorld=vec4(transformed,1.0);
          #ifdef USE_INSTANCING
          surfaceWorld=instanceMatrix*surfaceWorld;
          #endif
          surfacePosition=(modelMatrix*surfaceWorld).xyz;`);
        shader.fragmentShader=`varying vec3 surfacePosition;
          float surfaceHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
          float surfaceJoint(vec2 p,vec2 size,float width){
            vec2 cell=p/size;cell.x+=mod(floor(cell.y),2.0)*.5;
            vec2 edge=min(fract(cell),1.0-fract(cell))*size;
            vec2 aa=max(fwidth(p),vec2(.003));
            return 1.0-min(smoothstep(width-aa.x,width+aa.x,edge.x),smoothstep(width-aa.y,width+aa.y,edge.y));
          }
          `+shader.fragmentShader;
        let detail='';
        if(kind==='terrain') detail=`
          vec3 groundColor=diffuseColor.rgb;
          float grass=step(groundColor.r*1.15,groundColor.g)*step(groundColor.b*1.15,groundColor.g);
          float water=step(groundColor.r*1.2,groundColor.b)*step(groundColor.r*1.3,groundColor.g);
          float paving=(1.0-grass)*(1.0-water)*step(abs(groundColor.r-groundColor.g),.07);
          float joint=surfaceJoint(surfacePosition.xz,vec2(1.2,.6),.018);
          float grain=surfaceHash(floor(surfacePosition.xz*45.0));
          float lawnVariation=surfaceHash(floor(surfacePosition.xz*.3));
          diffuseColor.rgb*=mix(.96+grain*.08,.91+lawnVariation*.09+grain*.05,grass);
          diffuseColor.rgb*=1.0-joint*.19*paving;
          diffuseColor.rgb*=1.0-water*.035*sin(surfacePosition.x*4.0+surfacePosition.z*2.1);`;
        if(kind==='paving') detail=`
          float joint=surfaceJoint(surfacePosition.xz,vec2(1.2,.6),.018);
          vec2 tile=surfacePosition.xz/vec2(1.2,.6);tile.x+=mod(floor(tile.y),2.0)*.5;
          diffuseColor.rgb*=.9+.14*surfaceHash(floor(tile));
          diffuseColor.rgb*=1.0-joint*.25;`;
        if(kind==='brick'||kind==='stone') detail=`
          vec3 face=abs(normalize(cross(dFdx(surfacePosition),dFdy(surfacePosition))));
          vec2 wall=vec2(face.x>face.z?surfacePosition.z:surfacePosition.x,surfacePosition.y);
          vec2 size=${kind==='brick'?'vec2(.46,.22)':'vec2(1.5,.75)'};
          vec2 tile=wall/size;tile.x+=mod(floor(tile.y),2.0)*.5;
          float joint=surfaceJoint(wall,size,${kind==='brick'?'.012':'.014'});
          diffuseColor.rgb*=.86+.22*surfaceHash(floor(tile));
          diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*1.22,joint*.7);
          diffuseColor.rgb*=.96+.06*surfaceHash(floor(wall*70.0));`;
        if(kind==='roof') detail=`
          float joint=surfaceJoint(surfacePosition.xz,vec2(3.0,3.0),.022);
          diffuseColor.rgb*=(.92+.12*surfaceHash(floor(surfacePosition.xz*10.0)))*(1.0-joint*.18);`;
        shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n'+detail);
      };
      material.customProgramCacheKey=()=> 'shade-surface-'+kind;
      return material;
    }
    function terrain(imageUrl,done) {
      const image=new Image();
      image.onload=()=>{
        const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),a=pixels.data;
        for(let i=0;i<a.length;i+=4){
          const r=a[i],g=a[i+1],b=a[i+2],x=(i/4)%canvas.width,y=Math.floor(i/4/canvas.width);
          let c;
          // All green print, including the original circular canopies, is one lawn class.
          if(g>r*1.035 && g>b*1.13)c=[116,143,84];
          else if(g>r*1.12 && b>r*1.1)c=[92,152,166];
          else if(r>g*1.14 && g>b*1.1)c=[177,113,83];
          else if(r>170 && g>160 && b<g*.88)c=[147,158,107];
          else if(r>244 && g>244 && b>244)c=[227,230,220];
          else c=[188,184,172];
          // No printed outlines, canopy circles, or painted drop shadows survive.
          const grain=(random(x,y)-.5)*3;
          a[i]=c[0]+grain;a[i+1]=c[1]+grain;a[i+2]=c[2]+grain;a[i+3]=255;
        }
        ctx.putImageData(pixels,0,0);
        const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
        texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());done(texture);
      };
      image.src=imageUrl;
    }
    return {surface,terrain};
  }
  globalThis.ShadeSceneSurfaces=Object.freeze({create});
})();

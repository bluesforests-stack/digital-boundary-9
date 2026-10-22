/* 被打上的标签 | p5.js + ml5 PoseNet 0.12.2 + Matter.js
   The letter is assigned randomly, not inferred from appearance or personality.
   Video and session state remain in the browser. No uploads, recording or storage.
   A fixed pool of 260 bodies supports continuous emission without unbounded growth. */
const {Engine,Bodies,Body,Composite,Events}=Matter;
const N=260,STEP=1000/120,ABC='ABCDEFGHIJKLMNOPQRSTUVWXYZ',LANES=24;
const $=id=>document.getElementById(id),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,dt,tau)=>a+(b-a)*(1-Math.exp(-dt/tau));
const ease=v=>{v=clamp(v,0,1);return v*v*(3-2*v)};
let engine,letters=[],walls=[],beams=[],ripples=[],echoes=[];
let t=0,acc=0,stage='idle',stageAt=0,label=null,cycle=0,moving=false;
let drive={x:0,y:0,vx:0,vy:0,energy:0},lastSeen=-Infinity,lastMotion=-Infinity,lastPose=null,lastPoseAt=0,inputKind='';
let pointer={x:0,y:0,active:false},demo=false,demoAt=0,hidden=false,lastUI=0,error='';
let cameraState='off',cameraToken=0,stream=null,video=null,net=null,timer=null,cameraSample=null,cameraSeq=0,usedCameraSeq=0;
function setup(){
 createCanvas(windowWidth,windowHeight);pixelDensity(Math.min(window.devicePixelRatio||1,2));textFont('monospace');textAlign(CENTER,CENTER);
 drive.x=width/2;drive.y=height*.51;engine=Engine.create({positionIterations:7,velocityIterations:5});engine.gravity.y=0;createWalls();
 for(let i=0;i<LANES;i++)beams.push({a:i/LANES*TWO_PI+Math.sin(i*5.27)*.065,length:.55+(Math.sin(i*2.71)+1)*.22,phase:(i*.618)%1});
 for(let i=0;i<N;i++){
  const size=random(10,25),r=size*.29,b=Bodies.circle(random(35,width-35),random(35,height-35),r,{density:.0018,restitution:.84,friction:.015,frictionAir:.024,label:'letter',collisionFilter:{category:1,mask:3}});
  Composite.add(engine.world,b);letters.push({b,r,size,lane:i%LANES,phase:(Math.floor(i/LANES)/12+(i%LANES)*.017)%1,char:ABC[i%26],next:0,trail:[],alpha:1,target:null,born:-10000,recycleAt:null,focusStart:null});
 }
 Events.on(engine,'collisionStart',e=>{for(const pair of e.pairs){
  const wall=pair.bodyA.label.startsWith('wall:')?pair.bodyA:pair.bodyB.label.startsWith('wall:')?pair.bodyB:null;if(!wall)continue;
  const b=wall===pair.bodyA?pair.bodyB:pair.bodyA,s=wall.label.slice(5),p=b.position;
  if(stage!=='idle'&&(moving||stage==='burst')&&b.speed>2.5){ripples.push({x:s==='l'?22:s==='r'?width-22:clamp(p.x,22,width-22),y:s==='t'?22:s==='b'?height-22:clamp(p.y,22,height-22),side:s,born:t,power:clamp(b.speed/8,.35,1)});if(ripples.length>60)ripples.shift();}
 }});
}
function createWalls(){
 walls.forEach(b=>Composite.remove(engine.world,b));const T=120,opt=s=>({isStatic:true,label:'wall:'+s,collisionFilter:{category:2,mask:1}});
 walls=[Bodies.rectangle(22-T/2,height/2,T,height+240,opt('l')),Bodies.rectangle(width-22+T/2,height/2,T,height+240,opt('r')),Bodies.rectangle(width/2,22-T/2,width+240,T,opt('t')),Bodies.rectangle(width/2,height-22+T/2,width+240,T,opt('b'))];Composite.add(engine.world,walls);
}
function glyph(){return random()<.15?String(Math.floor(random(2))):ABC[Math.floor(random(26))];}
function begin(){
 label=ABC[Math.floor(random(26))];cycle++;stage='gather';stageAt=t;echoes=[];ripples=[];
 letters.forEach(p=>{p.char=label;p.trail=[];p.alpha=1;p.recycleAt=null;p.focusStart={...p.b.position};p.b.collisionFilter.mask=2;Body.setVelocity(p.b,{x:0,y:0});});
}
function leave(){
 stage='idle';stageAt=t;label=null;moving=false;echoes=[];ripples=[];lastPose=null;lastPoseAt=0;drive.vx=drive.vy=drive.energy=0;
 letters.forEach(p=>{p.char=glyph();p.next=t+random(100,700);p.trail=[];p.target=null;p.recycleAt=null;p.b.collisionFilter.mask=3;Body.setVelocity(p.b,{x:p.b.velocity.x*.2,y:p.b.velocity.y*.2});});
}
function burst(){
 stage='burst';stageAt=t;
 letters.forEach((p,i)=>{const a=i*2.3999632297,speed=8+(i%19)/18*13;Body.setVelocity(p.b,{x:Math.cos(a)*speed,y:Math.sin(a)*speed});p.trail=[];});
}
function demoPose(age){
 const p=age%48;if(p<4||p>=40)return null;
 let x=width*.5,y=height*.49;
 if(p>=11&&p<23){const u=p-11;x+=Math.sin(u*1.8)*width*.29;y+=Math.sin(u*1.1)*height*.17;}
 else if(p>=23&&p<33){x+=Math.sin(12*1.8)*width*.29;y+=Math.sin(12*1.1)*height*.17;}
 else if(p>=33){const u=p-33;x+=(Math.sin(12*1.8)+Math.sin(u*2.1)*.65)*width*.29;y+=Math.sin(12*1.1)*height*.17;}
 return Array.from({length:17},(_,i)=>({x:x+(i%2?1:-1)*width*.045,y:y+(i-8)*height*.009,score:1}));
}
function cameraPoints(pose){
 const vw=video.videoWidth||640,vh=video.videoHeight||480,s=Math.min((width-70)/vw,(height-70)/vh),ox=(width-vw*s)/2,oy=(height-vh*s)/2;
 return pose.keypoints.map(k=>({x:ox+(vw-k.position.x)*s,y:oy+k.position.y*s,score:k.score}));
}
function acceptPose(points,stamp){
 const valid=points?.filter(p=>p.score>.4)||[];if(valid.length<5)return false;
 const torso=[5,6,11,12].map(i=>points[i]).filter(p=>p?.score>.4),anchors=torso.length>=2?torso:valid;
 const x=anchors.reduce((s,p)=>s+p.x,0)/anchors.length,y=anchors.reduce((s,p)=>s+p.y,0)/anchors.length,dt=lastPoseAt?stamp-lastPoseAt:33;
 const span=points[5]?.score>.4&&points[6]?.score>.4?Math.max(45,Math.hypot(points[5].x-points[6].x,points[5].y-points[6].y)):Math.min(width,height)*.15;
 if(lastPose&&dt>0&&dt<350){
  let sx=0,sy=0,weight=0,sum=0,n=0,best={speed:0,vx:0,vy:0};
  points.forEach((p,i)=>{const old=lastPose[i];if(p.score<.4||!old||old.score<.4)return;
   const vx=(p.x-old.x)/dt*16.667,vy=(p.y-old.y)/dt*16.667,speed=Math.hypot(vx,vy);if(speed<span*.009)return;
   const k=Math.min(1,span*.33/Math.max(speed,.001)),w=[5,6,11,12].includes(i)?2:1;sx+=vx*k*w;sy+=vy*k*w;weight+=w;sum+=speed*k;n++;
   if(speed*k>best.speed)best={speed:speed*k,vx:vx*k,vy:vy*k};
  });
  let vx=sx/Math.max(1,weight),vy=sy/Math.max(1,weight);if(Math.hypot(vx,vy)<best.speed*.25){vx=best.vx*.6;vy=best.vy*.6;}
  const energy=clamp(sum/Math.max(1,n)/(span*.09),0,1);drive.vx=smooth(drive.vx,clamp(vx,-26,26),dt,100);drive.vy=smooth(drive.vy,clamp(vy,-26,26),dt,100);drive.energy=smooth(drive.energy,energy,dt,120);if(energy>.14)lastMotion=t;
 }else if(lastPose&&dt>=350){drive.vx=drive.vy=drive.energy=0;lastMotion=-Infinity;}
 drive.x=smooth(drive.x,clamp(x,70,width-70),dt,180);drive.y=smooth(drive.y,clamp(y,70,height-70),dt,180);
 lastPose=points.map(p=>({...p}));lastPoseAt=stamp;lastSeen=t;return true;
}
function updateInput(dt){
 let seen=false,kind='';
 if(demo){kind='demo';if(kind!==inputKind){lastPose=null;lastPoseAt=0;}const p=demoPose((t-demoAt)/1000);if(p)seen=acceptPose(p,t);}
 else if(cameraState==='on'){kind='camera';if(kind!==inputKind){lastPose=null;lastPoseAt=0;}if(cameraSample&&cameraSeq!==usedCameraSeq){usedCameraSeq=cameraSeq;if(cameraSample.points)seen=acceptPose(cameraSample.points,cameraSample.time);}}
 else if(pointer.active){kind='pointer';if(kind!==inputKind){lastPose=null;lastPoseAt=0;}seen=acceptPose(Array.from({length:17},(_,i)=>({x:pointer.x+(i%2?25:-25),y:pointer.y+(i-8)*4,score:1})),t);}
 inputKind=kind;const stale=kind==='camera'&&cameraSample?performance.now()-cameraSample.time>230:!seen;
 if(stale){drive.energy*=Math.exp(-dt/180);drive.vx*=Math.exp(-dt/180);drive.vy*=Math.exp(-dt/180);}
 const present=t-lastSeen<1450;if(present&&stage==='idle')begin();if(!present&&stage!=='idle')leave();
 moving=present&&t-lastMotion<380&&drive.energy>.07;
}
function spawn(p){
 const oldR=p.r;p.size=random()<.09?random(29,39):random(10,27);p.r=p.size*.29;Body.scale(p.b,p.r/oldR,p.r/oldR);
 const source=stage==='idle'?random(36,width-36):clamp(drive.x+random(-width*.34,width*.34),36,width-36);
 Body.setPosition(p.b,{x:clamp(source,22+p.r,width-22-p.r),y:24+p.r});Body.setVelocity(p.b,{x:random(-.4,.4),y:random(.3,1)});
 p.char=label??glyph();p.trail=[];p.born=t;p.recycleAt=null;
}
function flowTarget(p,dt){
 const b=beams[p.lane];p.phase=(p.phase+dt*.00011*(.8+drive.energy*.7))%1;
 const pulse=.4+.6*Math.pow(.5+.5*Math.sin(t*.001+b.phase*9),2),a=b.a+Math.sin(t*.00025+b.phase*8+p.phase*3)*.06;
 const dx=Math.cos(a),dy=Math.sin(a),ex=dx>0?(width-32-drive.x)/dx:(32-drive.x)/dx,ey=dy>0?(height-32-drive.y)/dy:(32-drive.y)/dy;
 const r=(.08+Math.pow(p.phase,.85)*.94)*Math.max(25,Math.min(ex,ey))*b.length;p.alpha=.45+pulse*.55;
 return{x:clamp(drive.x+dx*r,30,width-30),y:clamp(drive.y+dy*r,30,height-30)};
}
function updateTargets(dt){
 const age=t-stageAt;if(stage==='gather'&&age>=1700){stage='hold';stageAt=t;}else if(stage==='hold'&&age>=450)burst();else if(stage==='burst'&&age>=1850){stage='flow';stageAt=t;letters.forEach(p=>p.trail=[]);}
 const falling=stage==='idle'||(stage==='flow'&&!moving);
 for(let i=0;i<N;i++){
  const p=letters[i];p.alpha=1;
  if(stage==='gather'||stage==='hold'){
   // Allow letter bodies to overlap during focus. Physical collision is restored
   // after the burst has separated them, avoiding a false large particle pile.
   const k=stage==='hold'?1:ease(age/1700),a=i*2.3999632297,r=Math.sqrt((i+.5)/N)*1.7;
   const target={x:width/2+Math.cos(a)*r,y:height*.51+Math.sin(a)*r},start=p.focusStart||p.b.position;
   Body.setPosition(p.b,{x:start.x+(target.x-start.x)*k,y:start.y+(target.y-start.y)*k});Body.setVelocity(p.b,{x:0,y:0});p.target=null;
  }else if(stage==='flow'&&moving){p.recycleAt=null;p.target=flowTarget(p,dt);}
  else p.target=null;
  if(stage==='burst'&&t-stageAt>450)p.b.collisionFilter.mask=3;
  if(stage==='flow'||stage==='idle')p.b.collisionFilter.mask=3;
  if(falling){
   // Constant body count; bottom glyphs fade out and are emitted again above.
   // This also runs for a stationary, still-present labelled viewer.
   if(p.b.position.y>height-24-p.r&&p.b.speed<1.3&&p.recycleAt===null)p.recycleAt=t+180+random(180);
   if(p.recycleAt!==null){p.alpha=clamp((p.recycleAt-t)/240,0,1);if(t>=p.recycleAt)spawn(p);}
   p.alpha*=clamp((t-p.born)/280,0,1);
  }
 }
}
function physics(){
 const falling=stage==='idle'||(stage==='flow'&&!moving);
 for(const p of letters){const b=p.b;
  if(p.target){let fx=clamp((p.target.x-b.position.x)*.000022,-.009,.009)+drive.vx*.00046,fy=clamp((p.target.y-b.position.y)*.000022,-.009,.009)+drive.vy*.00046;Body.applyForce(b,b.position,{x:b.mass*fx,y:b.mass*fy});}
  else if(falling)Body.applyForce(b,b.position,{x:b.mass*Math.sin(t*.0004+p.lane)*.000008,y:b.mass*.00025});
  if(b.speed>24)Body.setVelocity(b,{x:b.velocity.x/b.speed*24,y:b.velocity.y/b.speed*24});
 }
 Engine.update(engine,STEP);
 for(const p of letters){const b=p.b,x=clamp(b.position.x,22+p.r,width-22-p.r),y=clamp(b.position.y,22+p.r,height-22-p.r);
  if(x!==b.position.x||y!==b.position.y){let vx=b.velocity.x,vy=b.velocity.y;if(x!==b.position.x)vx=x===22+p.r?Math.abs(vx)*.85:-Math.abs(vx)*.85;if(y!==b.position.y)vy=y===22+p.r?Math.abs(vy)*.85:-Math.abs(vy)*.85;Body.setPosition(b,{x,y});Body.setVelocity(b,{x:vx,y:vy});}
 }
}
function renderLetters(){
 if(stage==='flow'&&moving&&t-(echoes.at(-1)?.born??-Infinity)>180){echoes.push({born:t,pts:letters.filter((_,i)=>i%4===0).map(p=>({x:p.b.position.x,y:p.b.position.y,c:label,size:p.size}))});if(echoes.length>5)echoes.shift();}
 echoes=echoes.filter(e=>t-e.born<1100);noStroke();
 for(const e of echoes){fill(91,182,121,(1-(t-e.born)/1100)*28);for(const q of e.pts){textSize(q.size);text(q.c,q.x,q.y);}}
 for(const p of letters){const b=p.b;
  if(stage==='burst'||(stage==='flow'&&moving)||stage==='gather'){p.trail.push({x:b.position.x,y:b.position.y});if(p.trail.length>12)p.trail.shift();}else p.trail=[];
  if(p.trail.length&&b.speed>1){strokeWeight(.6);for(let j=1;j<p.trail.length;j++){stroke(105,236,151,j/p.trail.length*(45+drive.energy*60)*p.alpha);line(p.trail[j-1].x,p.trail[j-1].y,p.trail[j].x,p.trail[j].y);}}
  if(stage==='idle'&&t>p.next){p.char=glyph();p.next=t+random(170,700);}else if(label!==null)p.char=label;
  const focus=stage==='hold'?1:stage==='gather'?ease((t-stageAt)/1700):0;
  noStroke();fill(160,239,183,(stage==='idle'?98:stage==='hold'?90:220)*p.alpha);textSize(p.size*(1-focus)+5*focus);text(p.char,b.position.x,b.position.y);
 }
 if(stage==='hold'){noStroke();for(let r=18;r>2;r-=3){fill(157,255,185,8);circle(width/2,height*.51,r);}fill(204,255,220,210);circle(width/2,height*.51,4);}
}
function renderBoundary(){
 ripples=ripples.filter(r=>t-r.born<900);
 const digit=(x,y,s,k)=>{let glow=0,bulge=0;for(const r of ripples){if(r.side!==s)continue;const age=(t-r.born)/900,d=Math.hypot(x-r.x,y-r.y);glow=Math.max(glow,Math.exp(-Math.abs(d-age*170)/21)*(1-age)*r.power);bulge+=Math.exp(-d*d/1800)*Math.sin(age*Math.PI)*r.power*8;}
  const sign=s==='l'||s==='t'?-1:1;if(s==='l'||s==='r')x+=sign*bulge;else y+=sign*bulge;
  fill(70+glow*185,119+glow*135,85+glow*170,30+noise(k,t*.003)*40+glow*185);textSize(8+glow*4);text(noise(k*2,Math.floor(t/95))>.5?'1':'0',x,y);
 };
 noStroke();for(let x=22;x<width-22;x+=14){digit(x,22,'t',x);digit(x,height-22,'b',x+1000);}for(let y=36;y<height-22;y+=14){digit(22,y,'l',y+2000);digit(width-22,y,'r',y+3000);}
 for(const r of ripples){const age=(t-r.born)/900;noFill();strokeWeight(.8);stroke(161,255,187,(1-age)*155*r.power);circle(r.x,r.y,age*190+3);stroke(161,255,187,(1-age)*60*r.power);circle(r.x,r.y,age*125+3);}
}
function updateUI(){
 // No visible HUD, title, status text, label card or decorative interface.
 const camera=$('camera');camera.title=error||'开启或关闭摄像头';
 camera.setAttribute('aria-label',error?'开启摄像头：'+error:camera.textContent);
}
function draw(){const dt=Math.min(deltaTime,50);t+=dt;background(0);updateInput(dt);updateTargets(dt);acc+=dt;while(acc>=STEP){physics();acc-=STEP;}renderLetters();renderBoundary();updateUI();}
function setHidden(v){hidden=v;document.body.classList.toggle('exhibition',v);}
function reset(){leave();lastSeen=-Infinity;lastMotion=-Infinity;lastPose=null;lastPoseAt=0;cameraSample=null;usedCameraSeq=cameraSeq;error='';if(demo)demoAt=t;}
function setDemo(v){if(v)stopCamera();demo=v;demoAt=t;pointer.active=false;reset();$('demo').textContent=v?'停止演示':'自动演示';$('demo').setAttribute('aria-pressed',String(v));}
function input(e){if(demo&&e.type!=='pointerdown')return;lastUI=t;if(e.target.tagName!=='CANVAS'){pointer.active=false;return;}if(hidden)setHidden(false);if(demo)setDemo(false);pointer={x:e.clientX,y:e.clientY,active:true};}
window.addEventListener('pointerdown',e=>{input(e);if(e.target.tagName==='CANVAS')e.target.setPointerCapture(e.pointerId);});window.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'||e.buttons)input(e);});
window.addEventListener('pointerup',e=>{if(e.pointerType!=='mouse')pointer.active=false;});window.addEventListener('pointercancel',()=>pointer.active=false);window.addEventListener('blur',()=>pointer.active=false);window.addEventListener('pointerout',e=>{if(!e.relatedTarget)pointer.active=false;});
$('demo').onclick=()=>setDemo(!demo);$('reset').onclick=reset;$('hide').onclick=()=>setHidden(true);
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(e){error='此浏览器不支持全屏，可使用浏览器的全屏功能';}}
$('full').onclick=fullscreen;window.addEventListener('keydown',e=>{lastUI=t;if(e.key.toLowerCase()==='h')setHidden(!hidden);if(e.key.toLowerCase()==='f')fullscreen();if(e.key.toLowerCase()==='r')reset();});
function cameraText(text){$('camera').textContent=text;}
function stopCamera(){cameraToken++;clearTimeout(timer);if(net)net.removeAllListeners('pose');net=null;if(stream)stream.getTracks().forEach(v=>v.stop());stream=null;if(video){video.pause();video.srcObject=null;video.remove();video=null;}cameraState='off';cameraSample=null;lastPose=null;lastPoseAt=0;cameraText('开启摄像头');}
$('camera').onclick=async()=>{
 if(cameraState!=='off'){stopCamera();return;}if(!window.isSecureContext||!navigator.mediaDevices){error='摄像头需要 HTTPS 或 localhost，仍可使用自动演示。';return;}
 if(demo)setDemo(false);pointer.active=false;const token=++cameraToken;cameraState='loading';error='';cameraText('取消加载');timer=setTimeout(()=>{if(token===cameraToken){stopCamera();error='模型加载超时，请重试或使用自动演示。';}},60000);
 try{const s=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:'user'},audio:false});if(token!==cameraToken){s.getTracks().forEach(v=>v.stop());return;}stream=s;
  const v=document.createElement('video');video=v;v.muted=true;v.playsInline=true;v.width=640;v.height=480;v.srcObject=s;document.body.appendChild(v);await v.play();if(token!==cameraToken)return;
  net=ml5.poseNet(v,{detectionType:'single',architecture:'MobileNetV1',outputStride:16,inputResolution:257,multiplier:.75,quantBytes:2,modelUrl:'model/model.json',flipHorizontal:false},()=>{if(token!==cameraToken)return;clearTimeout(timer);cameraState='on';cameraText('关闭摄像头');});
  net.on('pose',results=>{if(token!==cameraToken||cameraState!=='on')return;const p=results[0]?.pose;cameraSample={points:p&&p.score>.2?cameraPoints(p):null,time:performance.now()};cameraSeq++;});
 }catch(e){if(token===cameraToken){stopCamera();error='摄像头不可用，可使用自动演示：'+e.message;}}
};
function windowResized(){const ow=width,oh=height;resizeCanvas(windowWidth,windowHeight);createWalls();letters.forEach(p=>{Body.setPosition(p.b,{x:clamp(p.b.position.x/ow*width,22+p.r,width-22-p.r),y:clamp(p.b.position.y/oh*height,22+p.r,height-22-p.r)});p.trail=[];p.focusStart={...p.b.position};});drive.x=clamp(drive.x/ow*width,70,width-70);drive.y=clamp(drive.y/oh*height,70,height-70);lastPose=null;lastPoseAt=0;cameraSample=null;echoes=[];ripples=[];acc=0;}
window.addEventListener('pagehide',stopCamera);

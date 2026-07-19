import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const API = '';   // same-origin: server.py serves both the game and the /npc API
const $ = s => document.querySelector(s);
const boot = [];
function log(t, ok){ boot.unshift((ok?'▸ ':'· ')+t); if(boot.length>7)boot.pop();
  $('#boot').innerHTML = boot.map((l,i)=>i===0&&ok?`<b>${l}</b>`:l).join('<br>'); }

/* ── renderer / scene ───────────────────────────────────────────── */
const renderer = new THREE.WebGLRenderer({canvas:$('#c'),antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1315);
scene.fog = new THREE.FogExp2(0x0c1315, 0.021);

const camera = new THREE.PerspectiveCamera(72, innerWidth/innerHeight, 0.1, 400);
const yaw = new THREE.Object3D(), pitch = new THREE.Object3D();
yaw.add(pitch); pitch.add(camera); scene.add(yaw);
yaw.position.set(0, 1.7, 14);

/* lights: dim hemi + reddish key + amber rim */
scene.add(new THREE.HemisphereLight(0x35484d, 0x0a0f11, 0.6));
const key = new THREE.DirectionalLight(0xffd8c8, 1.15);
key.position.set(-8,16,6); key.castShadow=true; key.shadow.mapSize.set(2048,2048);
key.shadow.camera.top=30;key.shadow.camera.bottom=-30;key.shadow.camera.left=-30;key.shadow.camera.right=30;
scene.add(key);
const amber = new THREE.PointLight(0xffb527, 60, 40, 2); amber.position.set(10,7,-6); scene.add(amber);
const red = new THREE.PointLight(0xe23b3b, 30, 34, 2); red.position.set(-12,5,-2); scene.add(red);

/* ground: dark plane + grid */
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200,200),
  new THREE.MeshStandardMaterial({color:0x121c1f,roughness:.95,metalness:.05}));
ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);
const grid = new THREE.GridHelper(200,80,0x2a4247,0x18282c); grid.position.y=0.02; scene.add(grid);
const glow = new THREE.GridHelper(28,14,0xe23b3b,0x000000); // faint red drop-zone ring near center
glow.material.opacity=.12; glow.material.transparent=true; glow.position.y=0.03; scene.add(glow);

/* scatter crates + pillars for cover */
const crateMat = new THREE.MeshStandardMaterial({color:0x1b2a2e,roughness:.8,metalness:.2});
function box(w,h,d,x,z,ry=0){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),crateMat);
  m.position.set(x,h/2,z);m.rotation.y=ry;m.castShadow=m.receiveShadow=true;scene.add(m);return m;}
for(const [x,z] of [[-9,-8],[9,-9],[-14,2],[13,3],[-4,-16],[6,-15]]) box(2.2,2.2,2.2,x,z,Math.random());
for(const [x,z] of [[-20,-10],[20,-12],[-19,8],[19,9]]){const p=box(1.4,9,1.4,x,z);p.material=new THREE.MeshStandardMaterial({color:0x0e1719,roughness:.9});}

/* ── GLB helpers ────────────────────────────────────────────────── */
const loader = new GLTFLoader();
function normalize(obj, targetH=1.8){
  const b=new THREE.Box3().setFromObject(obj), s=new THREE.Vector3(); b.getSize(s);
  const k=targetH/(s.y||1); obj.scale.setScalar(k);
  const b2=new THREE.Box3().setFromObject(obj), c=new THREE.Vector3(); b2.getCenter(c);
  obj.position.x-=c.x; obj.position.z-=c.z; obj.position.y-=b2.min.y;      // feet on 0
  obj.traverse(o=>{if(o.isMesh){o.castShadow=true;o.frustumCulled=false;}});
  return obj;
}
function loadGLB(url){ return new Promise((res,rej)=>loader.load(url,g=>res(g.scene),undefined,rej)); }

const units = [];  // {root, patrolT, base}
async function spawnExisting(url, x, z, tag){
  try{ const g = normalize(await loadGLB(url));
    const holder = new THREE.Group(); holder.add(g); holder.position.set(x,0,z);
    holder.rotation.y = Math.random()*6.28; scene.add(holder);
    units.push({root:holder, base:new THREE.Vector3(x,0,z), t:Math.random()*6});
    log(tag+' online', true);
  }catch(e){ log(tag+' load failed'); console.error(e); }
}

/* ── requisition + call-in (background processing) ──────────────── */
let job=null, t0=0, callActive=false, dropQ=null;
const stageText = {queued:'Queued for fabrication', select:'Selecting best angles',
  enhance:'Normalizing lighting', generating:'Fabricating geometry + PBR',
  IN_PROGRESS:'Fabricating geometry + PBR', SUCCEEDED:'Drop authorized', done:'Drop authorized'};

function setCall(on){ callActive=on; $('#callin').classList.toggle('on',on); }
function fmt(ms){const s=Math.max(0,ms/1000|0);return String(s/60|0).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}

$('#reqBtn').onclick = ()=> $('#file').click();
addEventListener('keydown',e=>{ if(e.key==='r'||e.key==='R') $('#file').click(); });
$('#file').onchange = e => { const f=[...e.target.files]; if(f.length) requisition(f); };

async function requisition(files){
  if(callActive) return;
  const name = 'GRUNT_'+String(2+units.length-1).padStart(2,'0');
  $('#callName').textContent='UNIT—'+name; $('#inboundSub').textContent='UNIT—'+name+' · DROP CONFIRMED';
  $('#reqBtn').disabled=true; setCall(true); t0=performance.now();
  $('#pfill').style.width='4%'; $('#ppct').textContent='0%'; $('#pstage').textContent='UPLINK';
  $('#callStage').textContent='Uplink established';
  // roster: pending
  const li=document.createElement('div'); li.className='unit';
  li.innerHTML='<span class="dot pending"></span><span class="nm">'+name+'</span><span class="st">CALL-IN</span>';
  $('#roster').appendChild(li);
  log('requisition '+name+' — '+files.length+' photos uplinked', true);
  window.__stage='uplink';

  const fd=new FormData(); fd.append('name',name.toLowerCase());
  for(const f of files) fd.append('images',f);
  let jobId;
  try{ const r=await fetch(API+'/npc/generate',{method:'POST',body:fd}); jobId=(await r.json()).job_id; }
  catch(err){ $('#callStage').textContent='UPLINK FAILED — is server on :8799?'; log('uplink failed'); return; }

  // poll in background — player keeps playing
  const poll=setInterval(async()=>{
    let s; try{ s=await (await fetch(API+'/npc/status/'+jobId)).json(); }catch{ return; }
    const stg=(s.stage==='generating'||s.status==='IN_PROGRESS')?'FABRICATING':(s.stage||s.status||'').toUpperCase();
    $('#pstage').textContent=stg||'…';
    const pct = s.progress!=null && s.status ? s.progress : ({queued:5,select:10,enhance:18,generating:30}[s.stage]||8);
    $('#pfill').style.width=Math.max(4,pct)+'%'; $('#ppct').textContent=(pct|0)+'%';
    $('#callStage').textContent=stageText[s.status]||stageText[s.stage]||'Working';
    li.querySelector('.st').textContent=stg||'…';
    window.__stage=s.stage||s.status;
    if(s.download_url){ clearInterval(poll); onReady(name, API+s.download_url, li); }
    if(s.stage==='error'){ clearInterval(poll); $('#callStage').textContent='FABRICATION ERROR'; log('error: '+s.error); }
  }, 2500);
}

async function onReady(name, url, li){
  $('#pfill').style.width='100%'; $('#ppct').textContent='100%'; $('#pstage').textContent='INBOUND';
  const runtime=performance.now()-t0; window.__runtime=Math.round(runtime/1000);
  log(name+' fabricated in '+(runtime/1000|0)+'s — drop inbound', true);
  // INBOUND banner
  $('#inbound').classList.add('on');
  setTimeout(()=>$('#inbound').classList.remove('on'), 2600);
  setTimeout(()=>setCall(false), 1200);
  // load + drop
  const g = normalize(await loadGLB(url));
  const holder=new THREE.Group(); holder.add(g);
  const fwd=new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y=0; fwd.normalize(); // drop ahead of view
  const px=yaw.position.x+fwd.x*9, pz=yaw.position.z+fwd.z*9;
  holder.position.set(px,42,pz);
  holder.rotation.y=Math.atan2(yaw.position.x-px, yaw.position.z-pz);   // face the player
  scene.add(holder); window.__dropping=true;
  dropDrama(holder, px, pz);
  units.push({root:holder, base:new THREE.Vector3(px,0,pz), t:0, dropping:true});
  li.querySelector('.dot').classList.remove('pending'); li.querySelector('.st').textContent='ACTIVE';
  $('#reqBtn').disabled=false;
  $('#reqCredits').textContent='◆ '+String(6-units.length).padStart(2,'0');
  window.__ready=true; window.__lastName=name;
}

/* orbital-drop beam + impact */
let shake=0;
function dropDrama(holder, x, z){
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.1,60,24,1,true),
    new THREE.MeshBasicMaterial({color:0xffb527,transparent:true,opacity:.28,side:THREE.DoubleSide,
      blending:THREE.AdditiveBlending,depthWrite:false}));
  beam.position.set(x,30,z); scene.add(beam);
  const ring=new THREE.Mesh(new THREE.RingGeometry(0.1,0.4,48),
    new THREE.MeshBasicMaterial({color:0xffb527,transparent:true,opacity:.9,side:THREE.DoubleSide,blending:THREE.AdditiveBlending}));
  ring.rotation.x=-Math.PI/2; ring.position.set(x,0.05,z); scene.add(ring);
  holder.userData.drop={t:0, beam, ring, x, z};
}

/* ── controls (pointer-lock look + WASD) + idle sway ────────────── */
const keys={}; addEventListener('keydown',e=>keys[e.code]=1); addEventListener('keyup',e=>keys[e.code]=0);
let locked=false;
$('#c').addEventListener('click',()=>{ if(!locked) renderer.domElement.requestPointerLock?.(); });
document.addEventListener('pointerlockchange',()=>{ locked=document.pointerLockElement===renderer.domElement;
  $('#hintbar').style.opacity=locked?0:.9; });
addEventListener('mousemove',e=>{ if(!locked) return;
  yaw.rotation.y-=e.movementX*0.0022; pitch.rotation.x=Math.max(-1.2,Math.min(1.2,pitch.rotation.x-e.movementY*0.0022)); });
/* shoot */
let ammo=31, flash=0;
addEventListener('mousedown',()=>{ if(!locked)return; if(ammo>0){ammo--;$('#ammo').textContent=ammo;flash=1;} });

/* ── loop ───────────────────────────────────────────────────────── */
let hp=100, idle=0;
const clock=new THREE.Clock();
function tick(){
  const dt=Math.min(clock.getDelta(),0.05); idle+=dt;
  // movement
  const sp=6*dt; const fwd=new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y=0; fwd.normalize();
  const rt=new THREE.Vector3().crossVectors(fwd,new THREE.Vector3(0,1,0));
  if(keys.KeyW)yaw.position.addScaledVector(fwd,sp); if(keys.KeyS)yaw.position.addScaledVector(fwd,-sp);
  if(keys.KeyD)yaw.position.addScaledVector(rt,sp);  if(keys.KeyA)yaw.position.addScaledVector(rt,-sp);
  if(!locked && !window.__dropping){ yaw.rotation.y+=dt*0.055; pitch.rotation.x=-0.04+Math.sin(idle*0.4)*0.03; } // idle sway
  // callin timer
  if(callActive) $('#callTimer').textContent=fmt(performance.now()-t0);
  // enemies patrol + drop anim
  for(const u of units){ u.t+=dt;
    if(u.root.userData.drop){ const d=u.root.userData.drop; d.t+=dt;
      const k=Math.min(1,d.t/1.15), e=1-Math.pow(1-k,3);           // easeOutCubic descend
      u.root.position.y=42*(1-e); d.beam.material.opacity=.28*(1-k);
      const rr=0.4+e*4.2; d.ring.geometry.dispose(); d.ring.geometry=new THREE.RingGeometry(rr*0.86,rr,48);
      d.ring.material.opacity=.9*(1-k);
      if(k>=1){ u.root.position.y=0; scene.remove(d.beam,d.ring); u.root.userData.drop=null; shake=0.5; window.__dropping=false; }
    } else { u.root.position.y=Math.sin(u.t*1.4)*0.04; u.root.rotation.y+=dt*0.12; }
  }
  // muzzle flash on crosshair
  if(flash>0){ flash-=dt*4; $('#cross').style.filter=`drop-shadow(0 0 6px rgba(226,59,59,${Math.max(0,flash)}))`; }
  // camera shake
  if(shake>0){ shake-=dt; camera.position.set((Math.random()-.5)*shake*0.3,(Math.random()-.5)*shake*0.3,0); }
  else camera.position.set(0,0,0);
  amber.intensity=55+Math.sin(idle*3)*8;
  renderer.render(scene,camera);
  requestAnimationFrame(tick);
}

/* ── boot ───────────────────────────────────────────────────────── */
addEventListener('resize',()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight); });
log('SIEGE ops terminal online');
log('link · requisition net :8799');
spawnExisting('assets/grunt.glb', -3, -6, 'GRUNT_01');
tick();

/* Playwright / integration hooks */
window.DEMO = { requisition, get state(){return{stage:window.__stage,runtime:window.__runtime,ready:window.__ready};} };

// ---------- utils ----------
const $ = (s) => document.querySelector(s);
const setText = (el, t) => { if (el) el.textContent = t; };
const log = (m) => { const g = $('#global-status'); if (g) g.textContent = m; console.log('[ELORA]', m); };

(function(){
  const ok = window.isSecureContext || ['localhost','127.0.0.1'].includes(location.hostname);
  const tip = $('#secure-tip');
  if (!ok && tip) { tip.hidden = false; log('Microphone requires HTTPS or localhost.'); }
})();
window.addEventListener('error', e => log(`JS error: ${e.message}`));

// ---------- state ----------
let CURRENT_LANG = 'en-US';
let camStream = null;
let faceUnlocked = false;
const FACE_KEY = 'elora_face_signature_v1';
let DEVICES = { audioIn: [], videoIn: [] };
const API_BASE = window.API_BASE || 'http://127.0.0.1:8000';

// ---------- auth helpers ----------
function getToken(){ try{ return localStorage.getItem('elora_access_token'); }catch{return null;} }
async function postJSON(path, body){
  const headers = { 'Content-Type': 'application/json' };
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const r = await fetch(`${API_BASE}${path}`, { method:'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
async function askQA(text){
  try{
    const headers = { 'Content-Type': 'application/json' };
    const tok = getToken?.();
    if (tok) headers.Authorization = `Bearer ${tok}`;
    const res = await fetch(`${API_BASE}/qa/ask`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ question: text })
    });
    if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const j = await res.json();
    return (j.answer || '').trim();
  }catch(e){
    return '';
  }
}

// ---------- boot ----------
function safeInit(name, fn) { try { fn(); } catch (e) { log(`${name} init error: ${e.message}`); } }
document.addEventListener('DOMContentLoaded', () => {
  safeInit('locale', initLocale);
  safeInit('permBadges', initPermBadges);
  safeInit('devices', initDevices);
  safeInit('face', initFace);
  safeInit('ui', bindUI);
  log('READY ✓');
});

// ---------- locale ----------
function initLocale(){
  const langInput = $('#language-input');
  const miniLang = $('#mini-lang');
  $('#country-input').value = 'India';
  langInput.value = 'or-IN';
  CURRENT_LANG = langInput.value;
  miniLang.textContent = `LANGUAGE: ${CURRENT_LANG}`;

  $('#lang-apply')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    CURRENT_LANG = (langInput.value || 'en-US').trim();
    miniLang.textContent = `LANGUAGE: ${CURRENT_LANG}`;
    Voice.setLanguage(CURRENT_LANG);
    setText($('#lang-status'), `Applied language: ${CURRENT_LANG}`);
  });
  $('#lang-test')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    Voice.speak("ନମସ୍କାର! Hello! こんにちは！Hola!", CURRENT_LANG);
  });
}

// ---------- permissions badges ----------
async function queryPerm(name){
  if (!navigator.permissions?.query) return 'unknown';
  try{ return (await navigator.permissions.query({ name })).state; }catch{ return 'unknown'; }
}
async function refreshPermBadges(){
  setText($('#cam-perm'), await queryPerm('camera'));
  setText($('#mic-perm'), await queryPerm('microphone'));
}
function initPermBadges(){
  refreshPermBadges();
  $('#perm-refresh')?.addEventListener('click', refreshPermBadges);
}

// ---------- devices ----------
async function enumerateDevices(){
  try{
    const list = await navigator.mediaDevices.enumerateDevices();
    DEVICES.audioIn = list.filter(d => d.kind === 'audioinput');
    DEVICES.videoIn = list.filter(d => d.kind === 'videoinput');

    const camSel = $('#camera-select'); const micSel = $('#mic-select');
    if (camSel) camSel.innerHTML = '';
    if (micSel) micSel.innerHTML = '';

    DEVICES.videoIn.forEach((d, i) => {
      const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || `Camera ${i+1}`;
      camSel?.appendChild(o);
    });
    DEVICES.audioIn.forEach((d, i) => {
      const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || `Mic ${i+1}`;
      micSel?.appendChild(o);
    });
  }catch(e){ log(`enumerateDevices error: ${e.message}`); }
}
async function initDevices(){
  if (!navigator.mediaDevices?.enumerateDevices){ log('enumerateDevices not supported'); return; }
  await enumerateDevices();
  $('#dev-refresh')?.addEventListener('click', enumerateDevices);
}

// ---------- face unlock ----------
async function askCameraPermission() {
  const devId = $('#camera-select')?.value;
  const constraints = devId ? { video: { deviceId: { exact: devId } } } : { video: true };
  try {
    const s = await navigator.mediaDevices.getUserMedia(constraints);
    s.getTracks().forEach(t => t.stop());
    setText($('#face-status'), 'Camera permission OK.');
    await enumerateDevices(); await refreshPermBadges();
  } catch (e) {
    const name = e.name || 'Error';
    let fix = `• Lock icon → Camera → Allow → Reload
• Windows: Settings → Privacy → Camera → Allow
• Close Zoom/Teams/Meet
• Use Chrome/Edge on desktop`;
    if (name === 'NotFoundError') fix = 'No camera found. Plug in a webcam.\n' + fix;
    if (name === 'NotAllowedError' || name === 'SecurityError') fix = 'Permission blocked. Set Camera to Allow and reload.\n' + fix;
    setText($('#face-status'), `Camera error: ${name}\n${fix}`);
    await refreshPermBadges();
  }
}

function initFace(){
  const cam = $('#cam');
  const faceStatus = $('#face-status');
  const faceLED = $('#face-led');
  function setFaceLED(text, cls='idle'){ setText(faceLED, `● ${text.toUpperCase()}`); faceLED.className = `led ${cls}`; }

  async function startCamera(){
    if (!navigator.mediaDevices?.getUserMedia){ setText(faceStatus, 'Camera API not supported.'); return; }
    const devId = $('#camera-select')?.value;
    const base = devId ? { deviceId: { exact: devId } } : { facingMode: { ideal: "user" } };
    try{
      camStream = await navigator.mediaDevices.getUserMedia({ video: { ...base, width:{ideal:640}, height:{ideal:480} }, audio:false });
    }catch(e1){
      try{ camStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:false }); }
      catch(e2){
        const name = e2.name || 'Error';
        let fix = `• Lock icon → Camera → Allow → Reload
• Windows: Settings → Privacy → Camera → Allow
• Close Zoom/Teams/Meet
• Use Chrome/Edge on desktop`;
        if (name === 'NotFoundError') fix = `No camera found.\n` + fix;
        if (name === 'NotAllowedError' || name === 'SecurityError') fix = `Permission blocked.\n` + fix;
        setText(faceStatus, `Camera error: ${name}\n${fix}`);
        await refreshPermBadges(); return;
      }
    }
    cam.srcObject = camStream;
    cam.onloadedmetadata = () => cam.play().catch(err => setText(faceStatus, `Video play error: ${err.message}`));
    cam.addEventListener('playing', ()=> setText(faceStatus,'Camera ready. Keep your face inside the dashed box.'), {once:true});
    await enumerateDevices(); await refreshPermBadges();
  }
  function stopCamera(){ if (camStream) camStream.getTracks().forEach(t=>t.stop()); camStream=null; cam.srcObject=null; setText(faceStatus,'Camera stopped.'); }

  function captureSignature(){
    if (!cam.videoWidth) throw new Error('Camera not ready. Click “START CAMERA”.');
    const tw=240, th=240;
    const cx=Math.max(0,(cam.videoWidth-tw)/2), cy=Math.max(0,(cam.videoHeight-th)/2);
    const tmp=document.createElement('canvas'); tmp.width=tw; tmp.height=th;
    const tctx=tmp.getContext('2d',{willReadFrequently:true});
    tctx.drawImage(cam, cx, cy, tw, th, 0, 0, tw, th);
    const s=24, small=document.createElement('canvas'); small.width=s; small.height=s;
    const sctx=small.getContext('2d'); sctx.drawImage(tmp,0,0,tw,th,0,0,s,s);
    const img=sctx.getImageData(0,0,s,s).data; const arr=new Float32Array(s*s);
    for(let i=0,j=0;i<img.length;i+=4,j++){ const r=img[i],g=img[i+1],b=img[i+2]; arr[j]=(0.299*r+0.587*g+0.114*b)/255; }
    return Array.from(arr);
  }
  function mse(a,b){ if(!a||!b||a.length!==b.length) return 999; let s=0; for(let i=0;i<a.length;i++){ const d=a[i]-b[i]; s+=d*d; } return s/a.length; }
  function saveSig(sig){ localStorage.setItem(FACE_KEY, JSON.stringify(sig)); }
  function loadSig(){ try{ return JSON.parse(localStorage.getItem(FACE_KEY)||'null'); }catch{return null;} }

  $('#cam-permission')?.addEventListener('click', (e)=>{ e.preventDefault(); askCameraPermission(); });
  $('#cam-start')?.addEventListener('click', (e)=>{ e.preventDefault(); startCamera(); });
  $('#cam-stop')?.addEventListener('click', (e)=>{ e.preventDefault(); stopCamera(); });
  $('#face-enroll')?.addEventListener('click', async (e)=>{
    e.preventDefault();
    try{
      const sig=captureSignature(); saveSig(sig);
      setText(faceStatus,'Face enrolled. Click “UNLOCK WITH FACE”.');
      await postJSON('/biometrics/face', { version:'v1', signature:{ size:24, data:sig }});
    }catch(err){ setText(faceStatus, err.message||String(err)); }
  });
  $('#face-clear')?.addEventListener('click', (e)=>{ e.preventDefault(); localStorage.removeItem(FACE_KEY); faceUnlocked=false; window.faceUnlocked=false; setFaceLED('locked','idle'); setText(faceStatus,'Cleared face enrollment.'); $('#voice-start').disabled=true; });
  $('#face-unlock')?.addEventListener('click', (e)=>{
    e.preventDefault();
    try{
      const ref=loadSig(); if(!ref){ setText(faceStatus,'No face enrolled. Click “ENROLL FACE”.'); return; }
      const cur=captureSignature(); const score=mse(ref,cur); const THRESH=0.035;
      if(score<THRESH){ faceUnlocked=true; window.faceUnlocked=true; setFaceLED('unlocked','active'); setText(faceStatus,`Unlocked ✓ (match ${score.toFixed(3)})`); $('#voice-start').disabled=false; }
      else { setText(faceStatus,`Face not matched (score ${score.toFixed(3)}). Move closer / better light.`); }
    }catch(err){ setText(faceStatus, err.message||String(err)); }
  });
  $('#face-testshot')?.addEventListener('click', (e)=>{ e.preventDefault(); try { captureSignature(); setText(faceStatus,'Snapshot OK.'); }catch(err){ setText(faceStatus, err.message||String(err)); }});
}

// ---------- voice ----------
const Voice = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  let langCode = 'en-US';
  function setLanguage(code){ langCode = code || 'en-US'; $('#mini-lang').textContent = `LANGUAGE: ${langCode}`; }
  function speak(text, lang){ try{ const u=new SpeechSynthesisUtterance(text); u.lang=lang||langCode; speechSynthesis.speak(u);}catch{} }

  let heldMicStream = null;
  let stream=null, ctx=null, analyser=null, dataTime=null;
  let running=false, rec=null, recActive=false, wakeLocked=false;

  const micBar = $('#mic-bar');
  const PROFILE_KEY='elora_voice_profile_v1';
  const di = {
    wake:$('#wake-status'), owner:$('#owner-status'), mood:$('#mood-status'),
    pitch:$('#pitch-status'), vol:$('#vol-status'), led:$('#voice-led'),
    status:$('#voice-status'), snr:$('#snr-status'), health:$('#health-status'), profile:$('#profile-status')
  };
  const settings = { mode:'both', ownerEnforce:true, aiName:'ELORA', micMode:'near' };

  function setLED(state,text){ setText(di.led,`● ${text ? text.toUpperCase(): state.toUpperCase()}`); di.led.className=`led ${state}`; }
  function setWake(text){ setText($('#wake-status'), text.toUpperCase()); }
  function setOwnerText(text){ setText($('#owner-status'), text); }
  function updateMeter(vol){ const pct = Math.max(0, Math.min(100, Math.round(vol * 500))); micBar.style.width = pct + '%'; }

  function rms(buf){ let s=0; for(let i=0;i<buf.length;i++) s+=buf[i]*buf[i]; return Math.sqrt(s/buf.length); }
  function zcr(buf){ let c=0; for(let i=1;i<buf.length;i++){ if((buf[i-1] >= 0 && buf[i] < 0) || (buf[i-1] < 0 && buf[i] >= 0)) c++; } return c/buf.length; }
  function pitch(td,sr){
    const N=td.length; let best=-1,bc=0, e=0;
    for(let i=0;i<N;i++) e+=td[i]*td[i]; e=Math.sqrt(e/N); if(e<0.008) return 0;
    for(let off=2;off<N/2;off++){ let c=0; for(let i=0;i<N-off;i++) c+=td[i]*td[i+off]; c/=(N-off); if(c>bc){bc=c;best=off;} }
    if(best<0) return 0; const f=sr/best; if(f<60||f>450) return 0; return f;
  }

  // Far-field robustness
  let noiseRms = 0.01;
  const alphaNoise = 0.95;
  function updateNoiseFloor(R, talking){
    if (!talking) noiseRms = alphaNoise*noiseRms + (1-alphaNoise)*R;
    if (noiseRms < 0.001) noiseRms = 0.001;
  }
  function snrDb(R){ return 20*Math.log10((R+1e-6)/(noiseRms+1e-6)); }
  function isTalking(R){ return R > (noiseRms * 1.8); }

  const mood={P:[],V:[]}; function push(a,v,m=30){ a.push(v); if(a.length>m) a.shift(); }

  const clap={ cooldown:0 }; function detectClap(R){ if(clap.cooldown>0) clap.cooldown--; const loud=R>0.12; if(loud&&clap.cooldown===0){clap.cooldown=30; return true;} return false; }
  let lastSample={pitch:0, rms:0, snr_db:0, zcr:0};

  // ---------------- Permission (holds stream) ----------------
  async function requestMicPermission(){
    try{
      const devId = $('#mic-select')?.value;
      const mode = ($('#mic-mode')?.value)||'near';
      const audio = devId
        ? { deviceId: { exact: devId }, echoCancellation: mode==='far', noiseSuppression: mode==='far', autoGainControl: mode==='far', sampleRate:48000 }
        : { echoCancellation: mode==='far', noiseSuppression: mode==='far', autoGainControl: mode==='far', sampleRate:48000 };

      heldMicStream = await navigator.mediaDevices.getUserMedia({ audio });
      setText(di.status,'Mic permission OK. (stream is held) Click START ALWAYS-ON.');
      await enumerateDevices(); await refreshPermBadges();

      const aud = document.getElementById('hidden-audio') || Object.assign(document.createElement('audio'), { id:'hidden-audio', muted:true });
      aud.srcObject = heldMicStream; aud.play?.().catch(()=>{});
      if (!document.body.contains(aud)) document.body.appendChild(aud);

      $('#voice-start').disabled = false;
    }catch(e){
      const name=e.name||'Error';
      let fix=`• Lock icon → Microphone → Allow → Reload
• Windows: Settings → Privacy → Microphone → Allow
• Close Zoom/Teams/Meet (device busy)
• Use Chrome/Edge on desktop`;
      if (name==='NotFoundError') fix='No microphone found. Plug in a mic or enable internal mic.\n'+fix;
      if (name==='NotAllowedError' || name==='SecurityError') fix='Permission blocked. Allow mic in Site settings, then reload.\n'+fix;
      if (name==='NotReadableError') fix='Device is in use by another app (Zoom/Teams). Close them and try again.\n'+fix;
      setText(di.status, `Mic error: ${name}\n${fix}`);
      await refreshPermBadges();
    }
  }

  // ---------------- Loop & wake ----------------
  let pingTimer = 0;
  let sessionId = null;

  async function sendPing(sample){
    if (!sessionId) return;
    try{
      const res = await postJSON('/biometrics/voice/ping', {
        session_id: sessionId,
        pitch_hz: sample.pitch||0,
        rms: sample.rms||0,
        zcr: sample.zcr||0,
        snr_db: sample.snr_db||0
      });
      setText($('#mood-status'), res.emotion);
      setText($('#snr-status'), (res.snr_db!=null?res.snr_db.toFixed(1):'–'));
      setText($('#profile-status'), res.matched_profile_tag || '—');
      setOwnerText(res.is_owner ? `owner ✓ (server ${res.similarity.toFixed(2)})` : `unknown ✗ (server ${res.similarity.toFixed(2)})`);
      setText($('#health-status'), res.health_flag ? 'possible issue' : 'ok');
    }catch(e){
      setText(di.status, `Ping error: ${e.message}`);
    }
  }

  function loop(ts){
    if(!running) return;
    analyser.getFloatTimeDomainData(dataTime);
    const sr=ctx.sampleRate;
    const R = rms(dataTime);
    const P = pitch(dataTime,sr);
    const Z = zcr(dataTime);
    const talking = isTalking(R);
    updateNoiseFloor(R, talking);
    const SNR = snrDb(R);

    lastSample = { pitch:P||0, rms:R, snr_db:SNR, zcr:Z };
    push(mood.P, P||0); push(mood.V, R||0);
    setText($('#pitch-status'), P ? P.toFixed(0) : '—');
    setText($('#vol-status'), R.toFixed(2));
    setText($('#mood-status'), inferMoodLocal(P, R));
    updateMeter(R);

    if((settings.mode==='clap'||settings.mode==='both') && detectClap(R)) triggerWake('clap');

    if (!pingTimer || (performance.now() - pingTimer) > 800) {
      pingTimer = performance.now();
      if (SNR > 6.0) sendPing(lastSample);
      setText($('#snr-status'), isFinite(SNR) ? SNR.toFixed(1) : '—');
    }
    requestAnimationFrame(loop);
  }

  function inferMoodLocal(P,R){
    const p=mood.P.filter(Boolean), v=mood.V;
    if(p.length<6||v.length<6) return 'listening';
    const avgP=p.reduce((a,b)=>a+b)/p.length, varP=Math.sqrt(p.map(x=>(x-avgP)**2).reduce((a,b)=>a+b)/p.length), avgV=v.reduce((a,b)=>a+b)/v.length;
    if(avgV>0.08 && varP>20 && avgP>180) return 'angry/excited';
    if(avgV<0.03 && avgP<140) return 'sad/tired';
    if(avgP>170 && avgV>0.05) return 'happy/bright';
    return 'calm';
  }

  function startWakeRecognizer(){
    const SRc = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SRc) { setText(di.status,'SpeechRecognition not supported (use Chrome/Edge).'); return; }
    if(recActive) return;
    const name=(settings.aiName||'ELORA').toLowerCase();
    rec = new SRc(); rec.lang = langCode; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (ev)=>{
      let text=''; for(let i=ev.resultIndex;i<ev.results.length;i++){ if(ev.results[i].isFinal) text += ev.results[i][0].transcript + ' '; }
      const n=text.toLowerCase();
      if(n.includes(name) || /(hey|hai|hei|hola|namaste|嗨)/i.test(n)) triggerWake('phrase');
    };
    rec.onerror = (e) => { setText(di.status, `Wake recognizer error: ${e.error||e.name||e}`); recActive=false; if(running) setTimeout(startWakeRecognizer, 800); };
    rec.onend   = () => { recActive=false; if(running) setTimeout(startWakeRecognizer, 300); };
    try{ rec.start(); recActive=true; }catch(e){ setText(di.status, `Wake recognizer start failed: ${e.message}`); }
  }
  function stopWakeRecognizer(){ try{ rec && rec.stop(); }catch{} recActive=false; }

  function triggerWake(kind){
    if(wakeLocked) return;
    wakeLocked=true; setTimeout(()=>wakeLocked=false,1500);
    setWake(kind); setOwnerText('listening…');
    startCommandCapture();
  }

  function startCommandCapture(){
    const SRc = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SRc){ setText(di.status,'SpeechRecognition not supported.'); return; }
    const c = new SRc(); c.lang = langCode; c.continuous = false; c.interimResults = false;
    c.onstart = () => { setText(di.status, 'Listening for command…'); setLED('active','command'); };
    c.onresult = (ev) => {
      const t = (ev.results?.[0]?.[0]?.transcript || '').toLowerCase().trim();
      setText(di.status, `Heard: "${t}"`);
      handleCommand(t);
    };
    c.onerror = (e) => setText(di.status, `Command error: ${e.error || e}`);
    c.onend = () => setLED('listening','listening');
    try{ c.start(); }catch(e){ setText(di.status, `Could not start command capture: ${e.message}`); }
  }

  function matchOwnerLocal(sample){
    let prof=null; try{ prof=JSON.parse(localStorage.getItem(PROFILE_KEY)||'null'); }catch{}
    if(!prof) return {ok: !settings.ownerEnforce, score:999};
    const sc={ pitch:Math.min(400,sample.pitch||0)/400, rms:Math.min(0.2,sample.rms||0)/0.2 };
    const pr={ pitch:Math.min(400,prof.pitch||0)/400, rms:Math.min(0.2,prof.rms||0)/0.2 };
    const d=Math.hypot(sc.pitch-pr.pitch, sc.rms-pr.rms);
    return {ok:d<0.45, score:d};
  }
  function adapt(sample){
    let prof=null; try{ prof=JSON.parse(localStorage.getItem(PROFILE_KEY)||'null'); }catch{}
    if(!prof) return;
    const a=0.05;
    prof.pitch=(1-a)*prof.pitch+a*(sample.pitch||0);
    prof.rms=(1-a)*prof.rms+a*(sample.rms||0);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(prof));
  }

  function handleCommand(t){
    const {ok, score} = matchOwnerLocal(lastSample);
    setOwnerText(ok ? `owner ✓ (local ${score.toFixed(2)})` : `unknown ✗ (local ${score.toFixed(2)})`);
    if(settings.ownerEnforce && !ok){ setText(di.status,'YOU ARE NOT MY OWNER.'); speak('YOU ARE NOT MY OWNER.', langCode); return; }

    adapt(lastSample);

    // Example hard-coded rule (kept)
    if (/who\s+is\s+the\s+prime\s+minister\s+of\s+india\??/i.test(t)) {
      const answer = 'Narendra Modi';
      setText(di.status, answer);
      speak(answer, langCode);
      return;
    }

    if(/open .*file/.test(t)){ setText(di.status,'Opening file (demo).'); speak('Opening your file.', langCode); return; }
    if(/shutdown|sleep|stop/.test(t)){ setText(di.status,'Going idle.'); speak('Standing by.', langCode); return; }

    // NEW: general QA fallback
    (async () => {
      const ans = await askQA(t);
      if (ans) { setText(di.status, ans); speak(ans, langCode); }
      else { setText(di.status, 'Sorry, I do not know yet.'); speak('Sorry, I do not know yet.', langCode); }
    })();
  }

  // ---------------- Start/Stop ----------------
  async function start(){
    const micState = await (navigator.permissions?.query ? (await navigator.permissions.query({name:'microphone'})).state : 'unknown');
    if (micState === 'denied') { setText(di.status,'Mic permission is blocked. Lock icon → Microphone → Allow → Reload.'); await refreshPermBadges(); return; }
    if(running) return;

    settings.mode = ($('#activation-mode')?.value)||'both';
    settings.ownerEnforce = ($('#owner-enforce')?.value)!=='off';
    settings.aiName = ($('#agent-name')?.value||'ELORA').trim()||'ELORA';
    settings.micMode = ($('#mic-mode')?.value)||'near';

    try{
      if (heldMicStream) { stream = heldMicStream; heldMicStream = null; }
      else {
        const devId = $('#mic-select')?.value;
        const mode = settings.micMode;
        const audio = devId
          ? { deviceId: { exact: devId }, echoCancellation: mode==='far', noiseSuppression: mode==='far', autoGainControl: mode==='far', sampleRate:48000 }
          : { echoCancellation: mode==='far', noiseSuppression: mode==='far', autoGainControl: mode==='far', sampleRate:48000 };
        stream = await navigator.mediaDevices.getUserMedia({ audio });
      }
    }catch(e){
      setText(di.status, `Mic error: ${e.name||e.message}. Click GRANT MIC ACCESS, allow, then START.`);
      await refreshPermBadges(); return;
    }

    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    if (ctx.state === 'suspended') { try{ await ctx.resume(); }catch{} }

    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
    dataTime = new Float32Array(analyser.fftSize);
    src.connect(analyser);

    try{
      const startRes = await postJSON('/biometrics/voice/session/start', {
        origin: location.origin, device_label: $('#mic-select')?.selectedOptions?.[0]?.textContent || null
      });
      sessionId = startRes.session_id;
    }catch(e){ setText(di.status, `Session start error: ${e.message}`); }

    running = true; setLED('listening','listening');
    setText(di.status,'Listening… say “hey ELORA” or clap.');
    setText($('#wake-status'),'—'); setText($('#owner-status'),'—');
    loop();
    startWakeRecognizer();
  }

  function stop(){
    running=false;
    try{ stopWakeRecognizer(); }catch{}
    if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
    if(ctx && ctx.state!=='closed') ctx.close();
    setLED('idle','idle'); setText(di.status,'Voice stopped.');
    const bar = $('#mic-bar'); if (bar) bar.style.width = '0%';
    if (sessionId){ postJSON('/biometrics/voice/session/stop?session_id='+sessionId, {} ).catch(()=>{}); sessionId=null; }
  }

  async function enrollOwner(secs=10, tag=null){
    if(!analyser){ setText($('#enroll-status'),'Start ALWAYS-ON first to enroll.'); return; }
    const sr = (new (window.AudioContext||window.webkitAudioContext)()).sampleRate;
    let sumP=0,cP=0,sumR=0,frames=0;
    setText($('#enroll-status'),'Recording… speak naturally.');
    const t0 = performance.now();
    await new Promise((resolve)=>{
      const step = ()=>{
        const bufT = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(bufT);
        const R = rms(bufT), P=pitch(bufT,sr);
        if(R>0.02){ if(P){sumP+=P;cP++;} sumR+=R; frames++; }
        if ((performance.now()-t0) < secs*1000) requestAnimationFrame(step); else resolve();
      };
      step();
    });
    const prof = { pitch: cP?(sumP/cP):0, rms: frames?(sumR/frames):0 };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(prof));
    setText($('#enroll-status'), `Saved voice profile: pitch≈${(prof.pitch||0).toFixed(0)}Hz`);

    try{
      await postJSON('/biometrics/voice/enroll', {
        version:'v1', avg_pitch_hz: prof.pitch||0, avg_rms: prof.rms||0, condition_tag: tag || null
      });
    }catch(e){ setText($('#enroll-status'), `Saved locally; server error: ${e.message}`); }
  }

  return {
    setLanguage, speak,
    requestMicPermission,
    start, stop,
    enrollOwner
  };
})();

window.Voice = Voice;

// ---------- UI binds ----------
function bindUI(){
  $('#lang-apply')?.addEventListener('click', (e)=>e.preventDefault());
  $('#lang-test')?.addEventListener('click', (e)=>e.preventDefault());

  $('#cam-permission')?.addEventListener('click', (e)=>{ e.preventDefault(); });
  $('#cam-start')?.addEventListener('click', (e)=>e.preventDefault());
  $('#cam-stop')?.addEventListener('click', (e)=>e.preventDefault());
  $('#face-enroll')?.addEventListener('click', (e)=>e.preventDefault());
  $('#face-clear')?.addEventListener('click', (e)=>e.preventDefault());
  $('#face-unlock')?.addEventListener('click', (e)=>e.preventDefault());
  $('#face-testshot')?.addEventListener('click', (e)=>e.preventDefault());

  $('#mic-permission')?.addEventListener('click', (e)=>{ e.preventDefault(); Voice.requestMicPermission(); });
  $('#voice-start')?.addEventListener('click', (e)=>{ e.preventDefault(); Voice.start(); });
  $('#voice-stop')?.addEventListener('click', (e)=>{ e.preventDefault(); Voice.stop(); });
  $('#sr-test')?.addEventListener('click', (e)=>{ e.preventDefault(); /* optional one-shot test */ });

  $('#enroll-start')?.addEventListener('click', async (e)=>{
    e.preventDefault();
    const tag = ($('#enroll-tag')?.value||'').trim() || null;
    await Voice.enrollOwner(10, tag);
  });
  $('#enroll-clear')?.addEventListener('click', (e)=>{ e.preventDefault(); localStorage.removeItem('elora_voice_profile_v1'); setText($('#enroll-status'),'Voice profile cleared.'); setText($('#owner-status'),'no profile'); });
}

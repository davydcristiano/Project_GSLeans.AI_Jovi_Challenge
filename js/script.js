/* ═══════════════════════════════════════════════════
   CameraStudio V2 — script.js
   22 funcionalidades: Câmera · Filtros iPhone · AR
   Vídeo · Slow-Mo · PWA · IndexedDB · Web Share
   Temporizador · Exposição · Pinch Zoom · Desenho
   Texto · Molduras · IA · Lote PDF · Dashboard
   Tema · Álbuns · Seleção múltipla · Acessibilidade
═══════════════════════════════════════════════════ */
'use strict';

const { jsPDF } = window.jspdf;

/* ══════════════════════════════════════
   ESTADO GLOBAL
══════════════════════════════════════ */
let stream         = null;
let useFront       = true;
let currentFilter  = 'none';
let currentMode    = 'foto';
let currentAR      = 'grid';
let afEnabled      = true;
let gridEnabled    = false;
let flashEnabled   = false;
let zoomLevel      = 1;
let timerDelay     = 0;
let timerInterval  = null;
let evLevel        = 0;
let evStripVisible = false;

/* AR */
let arAnimId    = null;
let arRunning   = false;
let arParticles = [];
let arMatrix    = [];
let arRain      = [];
let arConfetti  = [];

/* Vídeo */
let mediaRecorder   = null;
let recordedChunks  = [];
let isRecording     = false;
let recordTimer     = null;
let recordSeconds   = 0;

/* Pinch */
let pinchStartDist = 0;
let pinchStartZoom = 1;

/* Edição */
let photos         = [];
let editingIdx     = -1;
let originalDataUrl= null;
let cropRatio      = { w:0, h:0 };
let cropState      = { down:false, sx:0, sy:0, ex:0, ey:0 };
let drawTool       = 'brush';
let isDrawing      = false;
let lastDraw       = { x:0, y:0 };
let textPending    = null;
let currentFrame   = 'none';

/* Galeria */
let albumFilter    = 'all';
let selectMode     = false;
let selectedIds    = new Set();
let galFrom        = 'camera';

/* DB */
let db = null;

/* PWA */
let deferredPrompt = null;

/* Toast */
let toastTimer = null;

/* Tema */
let isDark = true;

/* i18n simples */
const i18n = {
  'pt-BR': {
    cameraReady:'📷 Câmera pronta!',
    captured:'📸 Foto capturada!',
    videoStart:'🎬 Gravando vídeo...',
    videoStop:'🎬 Vídeo salvo!',
    filterApplied:'🎨 ',
    noShare:'Seu navegador não suporta compartilhamento.',
    pdfSaved:'✅ PDF salvo!',
    jpgSaved:'⬇️ JPG salvo!',
    deleted:'🗑️ Excluído',
    cropApplied:'✂️ Recorte aplicado!',
    drawApplied:'✏️ Desenho aplicado!',
    textApplied:'💬 Texto adicionado!',
    frameApplied:'🖼️ Moldura aplicada!',
    aiDone:'🤖 IA concluída!',
  }
};
const t = k => (i18n['pt-BR'][k] || k);


/* ══════════════════════════════════════
   1. IndexedDB — PERSISTÊNCIA LOCAL
══════════════════════════════════════ */
function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('CameraStudioV2', 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'id' });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror   = () => reject(req.error);
  });
}

async function savePhotoToDB(photo) {
  if (!db) return;
  return new Promise((res, rej) => {
    const tx = db.transaction('photos','readwrite');
    tx.objectStore('photos').put(photo);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}

async function deletePhotoFromDB(id) {
  if (!db) return;
  return new Promise((res, rej) => {
    const tx = db.transaction('photos','readwrite');
    tx.objectStore('photos').delete(id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}

async function loadPhotosFromDB() {
  if (!db) return [];
  return new Promise((res, rej) => {
    const tx  = db.transaction('photos','readonly');
    const req = tx.objectStore('photos').getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror   = () => rej(req.error);
  });
}


/* ══════════════════════════════════════
   2. PWA — INSTALAÇÃO
══════════════════════════════════════ */
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  /* CORREÇÃO: 'installBtn' não existe neste HTML (só 'installBtn2').
     Sem a verificação, esta linha lançava erro e o botão nunca aparecia. */
  ['installBtn','installBtn2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });
});

function installPWA() {
  if (!deferredPrompt) { toast('📱 Abra no Chrome e use "Adicionar à tela inicial"'); return; }
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(r => {
    if (r.outcome === 'accepted') toast('📲 App instalado!');
    deferredPrompt = null;
  });
}

/* Service Worker */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}


/* ══════════════════════════════════════
   3. TEMA CLARO / ESCURO
══════════════════════════════════════ */
function toggleTheme() {
  isDark = !isDark;
  document.body.classList.toggle('theme-dark',  isDark);
  document.body.classList.toggle('theme-light', !isDark);
  localStorage.setItem('cs_theme', isDark ? 'dark' : 'light');
  toast(isDark ? '🌙 Tema Escuro' : '☀️ Tema Claro');
}

function loadTheme() {
  const saved = localStorage.getItem('cs_theme') || 'dark';
  isDark = saved === 'dark';
  document.body.classList.toggle('theme-dark',  isDark);
  document.body.classList.toggle('theme-light', !isDark);
}


/* ══════════════════════════════════════
   4. INICIALIZAÇÃO
══════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  loadTheme();
  try {
    await initDB();
    const saved = await loadPhotosFromDB();
    photos = saved.sort((a,b) => b.id - a.id);
    updateThumbFromPhotos();
  } catch(e) { console.warn('IndexedDB:', e); }

  // Pinch zoom
  const vf = document.getElementById('viewfinder');
  vf.addEventListener('touchstart', onPinchStart, { passive:true });
  vf.addEventListener('touchmove',  onPinchMove,  { passive:false });
  vf.addEventListener('click', onTapFocus);
});

function updateThumbFromPhotos() {
  if (!photos.length) return;
  const p = photos[0];
  const thumb = document.getElementById('lastThumb');
  thumb.src = p.dataUrl || p.url || '';
  thumb.classList.remove('hidden');
  document.getElementById('thumbPlaceholder').style.display = 'none';
  const badge = document.getElementById('countBadge');
  badge.classList.remove('hidden');
  badge.textContent = photos.length;
}


/* ══════════════════════════════════════
   5. CÂMERA
══════════════════════════════════════ */
async function initCamera() {
  try {
    const constraints = {
      video: {
        facingMode: useFront ? 'user' : 'environment',
        width:  { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: true
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    const video = document.getElementById('video');
    video.srcObject = stream;
    await video.play();

    document.getElementById('homeScreen').style.display = 'none';
    document.getElementById('cameraScreen').classList.remove('screen-hidden');
    document.getElementById('statusDot').classList.add('active');

    /* CORREÇÃO: o visor só ganha tamanho depois que a tela aparece,
       então dimensiona a AR no frame seguinte (antes ficava 0x0). */
    requestAnimationFrame(resizeARCanvas);
    window.addEventListener('resize', resizeARCanvas);
    /* Reaplica o filtro ativo ao (re)abrir a câmera */
    video.style.filter = CSS_FILTER_PREVIEW[currentFilter] || 'none';
    applyContinuousAF();
    showPinchHint();
    toast(t('cameraReady'));
  } catch(e) {
    alert('Não foi possível acessar a câmera.\n' + e.message);
  }
}

function goHome() {
  stopStream(); stopAR(); stopRecording();
  document.getElementById('cameraScreen').classList.add('screen-hidden');
  document.getElementById('homeScreen').style.display = '';
  document.getElementById('statusDot').classList.remove('active');
}

function stopStream() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
}

async function flipCamera() {
  useFront = !useFront;
  stopStream();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: useFront ? 'user' : 'environment', width:{ideal:1920}, height:{ideal:1080} },
      audio: true
    });
    const v = document.getElementById('video');
    v.srcObject = stream;
    v.style.transform = useFront ? 'scaleX(-1)' : 'scaleX(1)';
    await v.play();
    toast(useFront ? '🤳 Câmera frontal' : '📷 Câmera traseira');
  } catch(e) { toast('Erro ao trocar câmera'); }
}

function openGalleryDirect() {
  galFrom = 'home';
  document.getElementById('homeScreen').style.display = 'none';
  goGallery();
}


/* ══════════════════════════════════════
   6. FLASH / GRADE / AF
══════════════════════════════════════ */
function toggleFlash() {
  flashEnabled = !flashEnabled;
  const btn = document.getElementById('flashBtn');
  const svg = document.getElementById('flashSvg');
  btn.classList.toggle('active', flashEnabled);
  if (flashEnabled) {
    svg.innerHTML = '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor"/>';
    applyTorch(true);
    toast('⚡ Flash ON');
  } else {
    svg.innerHTML = '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/><line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2"/>';
    applyTorch(false);
    toast('Flash OFF');
  }
}

function applyTorch(on) {
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  if (caps.torch) track.applyConstraints({ advanced:[{ torch:on }] }).catch(()=>{});
}

function toggleGrid() {
  gridEnabled = !gridEnabled;
  document.getElementById('gridOverlay').classList.toggle('hidden', !gridEnabled);
  document.getElementById('gridBtn').classList.toggle('active', gridEnabled);
  toast(gridEnabled ? '📐 Grade ON' : 'Grade OFF');
}

function toggleAF() {
  afEnabled = !afEnabled;
  document.getElementById('afBtn').classList.toggle('active', afEnabled);
  document.getElementById('afBadge').classList.toggle('hidden', !afEnabled);
  if (afEnabled) { applyContinuousAF(); toast('🎯 Auto Foco ON'); }
  else toast('Foco manual');
}

function applyContinuousAF() {
  if (!stream || !afEnabled) return;
  const track = stream.getVideoTracks()[0];
  if (!track || !track.getCapabilities) return;
  const caps = track.getCapabilities();
  if (caps.focusMode && caps.focusMode.includes('continuous'))
    track.applyConstraints({ advanced:[{ focusMode:'continuous' }] }).catch(()=>{});
}

function onTapFocus(e) {
  if (currentMode === 'ar') return;
  const vf = document.getElementById('viewfinder');
  const rect = vf.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  showFocusRing(x, y);
  applyPointFocus(x / rect.width, y / rect.height);
}

function showFocusRing(x, y) {
  const ring = document.getElementById('focusRing');
  ring.style.left = x + 'px'; ring.style.top = y + 'px';
  ring.classList.add('show');
  clearTimeout(ring._t);
  ring._t = setTimeout(() => ring.classList.remove('show'), 1800);
}

function applyPointFocus(nx, ny) {
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  if (!track || !track.getCapabilities) return;
  const caps = track.getCapabilities();
  if (caps.focusMode) {
    track.applyConstraints({ advanced:[{ focusMode:'manual', pointOfInterest:{ x:nx, y:ny } }] }).catch(()=>{});
    if (afEnabled) setTimeout(() => track.applyConstraints({ advanced:[{ focusMode:'continuous' }] }).catch(()=>{}), 3000);
  }
}


/* ══════════════════════════════════════
   7. ZOOM + PINCH
══════════════════════════════════════ */
function setZoom(val) {
  zoomLevel = parseFloat(val);
  document.getElementById('zoomPill').textContent = zoomLevel.toFixed(1) + '×';
  if (stream) {
    const track = stream.getVideoTracks()[0];
    if (track && track.getCapabilities) {
      const caps = track.getCapabilities();
      if (caps.zoom) {
        track.applyConstraints({ advanced:[{ zoom: Math.min(caps.zoom.max, Math.max(caps.zoom.min, zoomLevel)) }] }).catch(()=>{});
        return;
      }
    }
  }
  document.getElementById('video').style.transform = `scaleX(${useFront?-1:1}) scale(${zoomLevel})`;
}

function onPinchStart(e) {
  if (e.touches.length < 2) return;
  pinchStartDist = Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY
  );
  pinchStartZoom = zoomLevel;
}

function onPinchMove(e) {
  if (e.touches.length < 2) return;
  e.preventDefault();
  const dist = Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY
  );
  const newZoom = Math.min(5, Math.max(1, pinchStartZoom * (dist / pinchStartDist)));
  document.getElementById('zoomSlider').value = newZoom;
  setZoom(newZoom);
}

function showPinchHint() {
  const h = document.getElementById('pinchHint');
  h.classList.remove('hidden');
  setTimeout(() => h.classList.add('hidden'), 2500);
}


/* ══════════════════════════════════════
   8. EXPOSIÇÃO
══════════════════════════════════════ */
function toggleEvStrip() {
  evStripVisible = !evStripVisible;
  document.getElementById('evStrip').classList.toggle('hidden', !evStripVisible);
}

function setExposure(val) {
  evLevel = parseFloat(val);
  document.getElementById('evVal').textContent = evLevel > 0 ? '+'+evLevel.toFixed(1) : evLevel.toFixed(1);
  document.getElementById('evBadge').textContent = 'EV ' + (evLevel > 0 ? '+' : '') + evLevel.toFixed(1);
  document.getElementById('evBadge').classList.toggle('hidden', evLevel === 0);
  if (stream) {
    const track = stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return;
    const caps = track.getCapabilities();
    if (caps.exposureCompensation)
      track.applyConstraints({ advanced:[{ exposureCompensation: evLevel }] }).catch(()=>{});
  }
}


/* ══════════════════════════════════════
   9. TEMPORIZADOR
══════════════════════════════════════ */
function setTimerDelay(s) {
  timerDelay = s;
  document.querySelectorAll('.timer-sel').forEach(b => b.classList.remove('active'));
  document.getElementById('ts' + s).classList.add('active');
  if (s > 0) toast(`⏱️ Temporizador: ${s}s`);
}

function triggerCapture() {
  if (currentMode === 'video' || currentMode === 'slowmo') { toggleRecording(); return; }
  if (timerDelay === 0) { capture(); return; }
  let count = timerDelay;
  const overlay = document.getElementById('timerOverlay');
  const num     = document.getElementById('timerNumber');
  overlay.classList.remove('hidden');
  num.textContent = count;
  timerInterval = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(timerInterval);
      overlay.classList.add('hidden');
      capture();
    } else {
      num.textContent = count;
    }
  }, 1000);
}


/* ══════════════════════════════════════
   10. FILTROS
══════════════════════════════════════ */
/* Pré-visualização ao vivo dos filtros (CSS) — o processamento real
   por pixel continua sendo feito em applyFilter() na captura. */
const CSS_FILTER_PREVIEW = {
  none:       'none',
  vivid:      'saturate(1.7) contrast(1.12)',
  dramatic:   'contrast(1.5) grayscale(.18) brightness(.92)',
  noir:       'grayscale(1) contrast(1.3) brightness(.9)',
  silvertone: 'grayscale(.85) brightness(1.06) contrast(1.05)',
  fade:       'saturate(.65) brightness(1.15) contrast(.85)',
  chrome:     'saturate(1.1) contrast(1.15) brightness(1.05)',
  warm:       'sepia(.28) saturate(1.35) hue-rotate(-6deg)',
  cool:       'saturate(1.15) hue-rotate(9deg) brightness(1.03)',
  process:    'sepia(.25) saturate(1.5) hue-rotate(15deg)',
  tonal:      'grayscale(1) contrast(1.1)',
  transfer:   'sepia(.4) saturate(1.6) contrast(1.05)',
  sepia:      'sepia(.85)'
};

function setFilter(fx, el) {
  currentFilter = fx;
  document.querySelectorAll('.fi').forEach(f => f.classList.remove('active'));
  if (el) el.classList.add('active');

  /* CORREÇÃO: aplica o filtro ao vídeo para que apareça na tela da câmera */
  const video = document.getElementById('video');
  if (video) video.style.filter = CSS_FILTER_PREVIEW[fx] || 'none';

  toast(t('filterApplied') + (el ? el.querySelector('span').textContent : fx));
}

function applyFilter(ctx, w, h, fx, alpha) {
  if (fx === 'none' || !alpha) return;
  const id = ctx.getImageData(0, 0, w, h);
  const d  = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i+1], b = d[i+2];
    const lv = lum(r,g,b);
    let nr=r, ng=g, nb=b;
    switch(fx) {
      case 'vivid':      nr=cl(lv+(r-lv)*2.5); ng=cl(lv+(g-lv)*2.5); nb=cl(lv+(b-lv)*2.5); break;
      case 'dramatic':   nr=ng=nb=cl((lv-128)*1.8+128); break;
      case 'noir':       nr=ng=nb=cl(((lv-128)*2+128)*.82); break;
      case 'silvertone': nr=cl(lv*.97+8); ng=cl(lv*.97+8); nb=cl(lv*1.05+10); break;
      case 'fade':       nr=cl(r*.75+50); ng=cl(g*.75+42); nb=cl(b*.70+50); break;
      case 'chrome':     nr=cl(lv+(r-lv)*.4+20); ng=cl(lv+(g-lv)*.4+25); nb=cl(lv+(b-lv)*.4+50); break;
      case 'warm':       nr=cl(r*1.12+18); ng=cl(g*1.02+4); nb=cl(b*.82); break;
      case 'cool':       nr=cl(r*.82); ng=cl(g*1.0+4); nb=cl(b*1.18+22); break;
      case 'process':    nr=cl(r+10); ng=cl(g+18); nb=cl(b*.85+10); break;
      case 'tonal':      { const t2=lv/255; nr=cl(lv+(t2>.5?12:-12)); ng=cl(lv+(t2>.5?10:-10)); nb=cl(lv+(t2>.5?8:-8)); break; }
      case 'transfer':   nr=cl(r*.9+g*.1+15); ng=cl(g*.9+b*.1+5); nb=cl(b*.8+r*.2+20); break;
      case 'sepia':      nr=cl(r*.393+g*.769+b*.189); ng=cl(r*.349+g*.686+b*.168); nb=cl(r*.272+g*.534+b*.131); break;
    }
    d[i]=lerp(r,nr,alpha); d[i+1]=lerp(g,ng,alpha); d[i+2]=lerp(b,nb,alpha);
  }
  ctx.putImageData(id, 0, 0);
}

const lum  = (r,g,b) => 0.299*r+0.587*g+0.114*b;
const cl   = v => Math.max(0, Math.min(255, Math.round(v)));
const lerp = (a,b,t) => Math.round(a+(b-a)*t);


/* ══════════════════════════════════════
   11. MODOS
══════════════════════════════════════ */
function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  const ids = { noite:'modeNoite', retrato:'modeRetrato', foto:'modeFoto', video:'modeVideo', slowmo:'modeSlowMo', ar:'modeAR' };
  document.getElementById(ids[mode]).classList.add('active');
  const labels = { noite:'NOITE', retrato:'RETRATO', foto:'FOTO', video:'VÍDEO', slowmo:'SLOW-MO', ar:'AR' };
  document.getElementById('modeBadge').textContent = labels[mode];

  document.getElementById('arPanel').classList.add('hidden');
  document.getElementById('arBadge').classList.add('hidden');
  stopAR();
  if (isRecording) stopRecording();

  const shutterEl = document.querySelector('.shutter');
  shutterEl.classList.remove('recording');

  if (mode === 'ar') {
    document.getElementById('arPanel').classList.remove('hidden');
    document.getElementById('arBadge').classList.remove('hidden');
    startAR(currentAR);
    toast('🔮 Realidade Aumentada');
  } else if (mode === 'noite')   toast('🌙 Modo Noite');
  else if (mode === 'retrato')   { document.getElementById('afBadge').classList.remove('hidden'); toast('🤳 Modo Retrato'); }
  else if (mode === 'video')     toast('🎬 Toque para gravar');
  else if (mode === 'slowmo')    toast('🐌 Slow Motion — Toque para gravar');
  else { document.getElementById('afBadge').classList.add('hidden'); toast('📷 Modo Foto'); }
}


/* ══════════════════════════════════════
   12. GRAVAÇÃO DE VÍDEO
══════════════════════════════════════ */
function toggleRecording() {
  if (isRecording) stopRecording();
  else startRecording();
}

function startRecording() {
  if (!stream) return;
  recordedChunks = [];
  const opts = { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' };

  if (currentMode === 'slowmo') {
    const track = stream.getVideoTracks()[0];
    if (track && track.getCapabilities) {
      const caps = track.getCapabilities();
      if (caps.frameRate && caps.frameRate.max >= 60)
        track.applyConstraints({ frameRate:{ ideal:60, max:caps.frameRate.max } }).catch(()=>{});
    }
  }

  try {
    mediaRecorder = new MediaRecorder(stream, opts);
  } catch(e) {
    mediaRecorder = new MediaRecorder(stream);
  }

  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = saveVideo;
  mediaRecorder.start(100);
  isRecording = true;

  document.querySelector('.shutter').classList.add('recording');
  document.getElementById('recBadge').classList.remove('hidden');
  recordSeconds = 0;
  recordTimer = setInterval(() => {
    recordSeconds++;
    document.getElementById('recBadge').innerHTML =
      `<span class="rec-dot"></span>REC ${String(Math.floor(recordSeconds/60)).padStart(2,'0')}:${String(recordSeconds%60).padStart(2,'0')}`;
  }, 1000);
  toast(t('videoStart'));
}

function stopRecording() {
  if (!mediaRecorder || !isRecording) return;
  mediaRecorder.stop();
  isRecording = false;
  clearInterval(recordTimer);
  document.querySelector('.shutter').classList.remove('recording');
  document.getElementById('recBadge').classList.add('hidden');
}

async function saveVideo() {
  const blob = new Blob(recordedChunks, { type:'video/webm' });
  const url  = URL.createObjectURL(blob);
  const id   = Date.now();
  const photo = {
    id, dataUrl: url, type:'video', mode: currentMode,
    filter: currentFilter, w:1280, h:720
  };
  photos.unshift(photo);
  updateThumbFromPhotos();
  toast(t('videoStop'));
  renderGallery();
}


/* ══════════════════════════════════════
   13. AR
══════════════════════════════════════ */
function resizeARCanvas() {
  const vf = document.getElementById('viewfinder');
  const c  = document.getElementById('arCanvas');
  if (!vf || !c) return;
  const w = vf.offsetWidth, h = vf.offsetHeight;
  /* CORREÇÃO: se o visor ainda não tem tamanho, tenta de novo no próximo frame.
     Antes o canvas ficava 0x0 e a AR desenhava no vazio (parecia "não funcionar"). */
  if (!w || !h) { requestAnimationFrame(resizeARCanvas); return; }
  if (c.width === w && c.height === h) return;
  c.width = w; c.height = h;
  /* Redimensionar o canvas limpa o conteúdo — reinicia a animação em andamento. */
  if (arRunning) { stopAR(); startAR(currentAR); }
}

function setAR(type, el) {
  currentAR = type;
  document.querySelectorAll('.ar-opt').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  stopAR(); resizeARCanvas(); startAR(type);
}

function stopAR() {
  arRunning = false;
  cancelAnimationFrame(arAnimId);
  const c = document.getElementById('arCanvas');
  if (c) c.getContext('2d').clearRect(0,0,c.width,c.height);
  arParticles=[]; arMatrix=[]; arRain=[]; arConfetti=[];
}

function startAR(type) {
  const canvas = document.getElementById('arCanvas');
  if (!canvas) return;
  /* CORREÇÃO: garante que o canvas tenha dimensões antes de gerar as partículas */
  if (!canvas.width || !canvas.height) {
    const vf = document.getElementById('viewfinder');
    if (vf && vf.offsetWidth) { canvas.width = vf.offsetWidth; canvas.height = vf.offsetHeight; }
    else { requestAnimationFrame(() => startAR(type)); return; }
  }
  arRunning = true;
  const ctx = canvas.getContext('2d');
  const W=canvas.width, H=canvas.height;

  if (['particles','neon','bokeh','hearts','stars'].includes(type)) {
    const n = type==='bokeh'?22:(type==='hearts'||type==='stars')?15:55;
    arParticles = Array.from({length:n},()=>({ x:Math.random()*W, y:Math.random()*H, vx:(Math.random()-.5)*1.2, vy:(Math.random()-.5)*1.2, size:Math.random()*(type==='bokeh'?44:14)+4, alpha:Math.random()*.7+.2, hue:Math.random()*360, phase:Math.random()*Math.PI*2 }));
  }
  if (type==='matrix') {
    const cols=Math.floor(W/14);
    arMatrix=Array.from({length:cols},(_,i)=>({x:i*14,y:Math.random()*H,speed:Math.random()*3+1}));
  }
  if (type==='rain') {
    arRain=Array.from({length:80},()=>({x:Math.random()*W,y:Math.random()*H,len:Math.random()*18+8,speed:Math.random()*5+3,alpha:Math.random()*.5+.2,hue:180+Math.random()*40}));
  }
  if (type==='confetti') {
    arConfetti=Array.from({length:100},()=>({x:Math.random()*W,y:Math.random()*H-H,vx:(Math.random()-.5)*3,vy:Math.random()*4+2,rot:Math.random()*360,rotV:Math.random()*5-2.5,size:Math.random()*10+6,color:`hsl(${Math.random()*360},90%,65%)`}));
  }

  function loop(ts) {
    ctx.clearRect(0,0,W,H);
    const t=ts*.001;
    switch(type) {
      case 'grid':      drawARGrid(ctx,W,H,t);           break;
      case 'particles': drawARParticles(ctx,W,H,t);      break;
      case 'neon':      drawARNeon(ctx,W,H,t);            break;
      case 'bokeh':     drawARBokeh(ctx,W,H,t);           break;
      case 'matrix':    drawARMatrix(ctx,W,H);            break;
      case 'hearts':    drawAREmoji(ctx,W,H,t,'❤️');      break;
      case 'stars':     drawAREmoji(ctx,W,H,t,'⭐');       break;
      case 'rain':      drawARRain(ctx,W,H,t);            break;
      case 'confetti':  drawARConfetti(ctx,W,H);          break;
    }
    arAnimId=requestAnimationFrame(loop);
  }
  arAnimId=requestAnimationFrame(loop);
}

function drawARGrid(ctx,W,H,t){
  ctx.strokeStyle=`rgba(245,166,35,${.18+Math.sin(t)*.06})`;ctx.lineWidth=.8;
  for(let x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let y=0;y<H;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  const cx=W/2,cy=H/2,p=.5+Math.sin(t*2)*.2;
  ctx.strokeStyle=`rgba(0,229,255,${p})`;ctx.lineWidth=1.5;
  ctx.beginPath();ctx.arc(cx,cy,34,0,Math.PI*2);ctx.stroke();
}
function drawARParticles(ctx,W,H,t){
  arParticles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;if(p.x<0)p.x=W;if(p.x>W)p.x=0;if(p.y<0)p.y=H;if(p.y>H)p.y=0;ctx.beginPath();ctx.arc(p.x,p.y,p.size/2,0,Math.PI*2);ctx.fillStyle=`hsla(${p.hue},100%,70%,${p.alpha*(.7+Math.sin(t+p.phase)*.3)})`;ctx.fill();});
}
function drawARNeon(ctx,W,H,t){
  arParticles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;if(p.x<0)p.x=W;if(p.x>W)p.x=0;if(p.y<0)p.y=H;if(p.y>H)p.y=0;const a=.4+Math.sin(t+p.phase)*.35,h=(p.hue+t*30)%360,g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.size*2.5);g.addColorStop(0,`hsla(${h},100%,70%,${a})`);g.addColorStop(1,`hsla(${h},100%,50%,0)`);ctx.beginPath();ctx.arc(p.x,p.y,p.size*2.5,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();});
}
function drawARBokeh(ctx,W,H,t){
  arParticles.forEach(p=>{p.x+=p.vx*.3;p.y+=p.vy*.3;if(p.x<-p.size)p.x=W+p.size;if(p.x>W+p.size)p.x=-p.size;if(p.y<-p.size)p.y=H+p.size;if(p.y>H+p.size)p.y=-p.size;const a=.06+Math.sin(t+p.phase)*.05;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.strokeStyle=`hsla(${p.hue},80%,80%,${a*3})`;ctx.lineWidth=1.5;ctx.stroke();ctx.fillStyle=`hsla(${p.hue},80%,80%,${a})`;ctx.fill();});
}
function drawARMatrix(ctx,W,H){
  ctx.fillStyle='rgba(0,0,0,0.05)';ctx.fillRect(0,0,W,H);ctx.fillStyle='#0f0';ctx.font='13px monospace';
  arMatrix.forEach(c=>{ctx.fillText(String.fromCharCode(0x30A0+Math.floor(Math.random()*96)),c.x,c.y);c.y+=c.speed*4;if(c.y>H+14)c.y=0;});
}
function drawAREmoji(ctx,W,H,t,emoji){
  ctx.font='26px serif';
  arParticles.forEach(p=>{p.y-=.6+p.vy*.2;p.x+=Math.sin(t*.8+p.phase)*.6;if(p.y<-30){p.y=H+30;p.x=Math.random()*W;}ctx.globalAlpha=.5+Math.sin(t+p.phase)*.3;ctx.fillText(emoji,p.x,p.y);});
  ctx.globalAlpha=1;
}
function drawARRain(ctx,W,H,t){
  arRain.forEach(d=>{d.y+=d.speed*2;if(d.y>H+d.len)d.y=-d.len;ctx.strokeStyle=`hsla(${d.hue},80%,70%,${d.alpha*(.7+Math.sin(t+d.x)*.2)})`;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(d.x,d.y);ctx.lineTo(d.x-2,d.y+d.len);ctx.stroke();});
}
function drawARConfetti(ctx,W,H){
  arConfetti.forEach(c=>{c.x+=c.vx;c.y+=c.vy;c.rot+=c.rotV;if(c.y>H+10){c.y=-10;c.x=Math.random()*W;}ctx.save();ctx.translate(c.x,c.y);ctx.rotate(c.rot*Math.PI/180);ctx.fillStyle=c.color;ctx.fillRect(-c.size/2,-c.size/4,c.size,c.size/2);ctx.restore();});
}


/* ══════════════════════════════════════
   14. CAPTURA
══════════════════════════════════════ */
function capture() {
  const video  = document.getElementById('video');
  const canvas = document.getElementById('processCanvas');
  const vw=video.videoWidth, vh=video.videoHeight;
  if (!vw||!vh) { toast('⚠️ Câmera não pronta'); return; }

  canvas.width=vw; canvas.height=vh;
  const ctx=canvas.getContext('2d');

  if (useFront) { ctx.translate(vw,0); ctx.scale(-1,1); }
  ctx.drawImage(video,0,0,vw,vh);
  if (useFront) ctx.setTransform(1,0,0,1,0,0);

  if (currentMode==='noite') {
    const id=ctx.getImageData(0,0,vw,vh);
    for(let i=0;i<id.data.length;i+=4){id.data[i]=cl(id.data[i]*1.4+18);id.data[i+1]=cl(id.data[i+1]*1.3+12);id.data[i+2]=cl(id.data[i+2]*1.2+8);}
    ctx.putImageData(id,0,0);
  }
  /* CORREÇÃO: grava a AR na foto sempre que a animação estiver rodando,
     não apenas quando o modo selecionado for exatamente 'ar'. */
  if (arRunning) {
    const arc = document.getElementById('arCanvas');
    if (arc && arc.width && arc.height) ctx.drawImage(arc, 0, 0, vw, vh);
  }
  applyFilter(ctx,vw,vh,currentFilter,1);

  const dataUrl=canvas.toDataURL('image/jpeg',.93);
  const fl=document.getElementById('flashOverlay');
  fl.classList.add('flash'); setTimeout(()=>fl.classList.remove('flash'),350);

  const id=Date.now();
  const photo={ id, dataUrl, w:vw, h:vh, filter:currentFilter, mode:currentMode, type:'photo' };
  photos.unshift(photo);
  savePhotoToDB(photo).catch(()=>{});

  updateThumbFromPhotos();
  toast(t('captured'));
  renderGallery();
}


/* ══════════════════════════════════════
   15. GALERIA
══════════════════════════════════════ */
function goGallery() {
  galFrom = galFrom || 'camera';
  document.getElementById('cameraScreen').classList.add('screen-hidden');
  document.getElementById('galleryScreen').classList.remove('screen-hidden');
  renderGallery();
}

function backToCamera() {
  document.getElementById('galleryScreen').classList.add('screen-hidden');
  if (galFrom === 'home') {
    document.getElementById('homeScreen').style.display = '';
    galFrom = 'camera';
  } else {
    document.getElementById('cameraScreen').classList.remove('screen-hidden');
  }
}

function galBack() { backToCamera(); }

function filterAlbum(filter, el) {
  albumFilter = filter;
  document.querySelectorAll('.album-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderGallery();
}

function renderGallery() {
  const grid  = document.getElementById('galGrid');
  const count = document.getElementById('galCount');
  const list  = getFilteredPhotos();
  count.textContent = list.length + (list.length===1?' foto':' fotos');
  grid.innerHTML='';
  if (!list.length) { grid.appendChild(document.getElementById('galEmpty')); document.getElementById('galEmpty').style.display=''; return; }
  list.forEach((p,idx)=>{
    const cell=document.createElement('div');
    cell.className='gal-cell'+(selectedIds.has(p.id)?' selected':'');
    if (selectMode) cell.classList.add('select-mode-cell');

    const isVideo = p.type==='video';
    const media=document.createElement(isVideo?'video':'img');
    media.src=p.dataUrl||p.url||'';
    if (isVideo) { media.muted=true; media.loop=true; media.playsInline=true; }
    media.loading='lazy'; media.alt='foto '+(idx+1);

    const ov=document.createElement('div');
    ov.className='gal-cell-overlay';
    ov.textContent=(isVideo?'🎬 ':'')+(p.filter&&p.filter!=='none'?p.filter:'original');

    const check=document.createElement('div');
    check.className='gal-cell-check';
    check.textContent='✓';

    cell.appendChild(media); cell.appendChild(ov); cell.appendChild(check);
    cell.onclick=()=>{ if(selectMode) toggleSelect(p.id,cell); else openEditModal(photos.findIndex(x=>x.id===p.id)); };
    grid.appendChild(cell);
  });
  if (selectMode) grid.classList.add('select-mode');
  else grid.classList.remove('select-mode');
}

function getFilteredPhotos() {
  if (albumFilter==='all') return photos;
  return photos.filter(p => p.mode===albumFilter || (albumFilter==='video'&&p.type==='video'));
}

/* Seleção múltipla */
function toggleSelectMode() {
  selectMode=!selectMode;
  if (!selectMode) { selectedIds.clear(); }
  document.getElementById('selectModeBtn').classList.toggle('active',selectMode);
  document.getElementById('batchBar').classList.toggle('hidden',!selectMode);
  renderGallery();
}
function cancelSelectMode() { selectMode=false; selectedIds.clear(); document.getElementById('selectModeBtn').classList.remove('active'); document.getElementById('batchBar').classList.add('hidden'); renderGallery(); }

function toggleSelect(id,cell) {
  if (selectedIds.has(id)) { selectedIds.delete(id); cell.classList.remove('selected'); }
  else { selectedIds.add(id); cell.classList.add('selected'); }
  document.getElementById('selectedCount').textContent=selectedIds.size+' selecionada'+(selectedIds.size!==1?'s':'');
}

function batchDelete() {
  if (!selectedIds.size) { toast('Selecione fotos primeiro'); return; }
  selectedIds.forEach(id => {
    const idx=photos.findIndex(p=>p.id===id);
    if (idx!==-1) photos.splice(idx,1);
    deletePhotoFromDB(id).catch(()=>{});
  });
  selectedIds.clear();
  cancelSelectMode();
  updateThumbFromPhotos();
  toast(t('deleted'));
}

function batchPDF() {
  if (!selectedIds.size) { toast('Selecione fotos primeiro'); return; }
  document.getElementById('batchInfo').textContent=selectedIds.size+' fotos selecionadas';
  document.getElementById('batchModal').classList.remove('hidden');
}
function closeBatchModal() { document.getElementById('batchModal').classList.add('hidden'); }


/* ══════════════════════════════════════
   16. EXPORT EM LOTE PDF
══════════════════════════════════════ */
function generateBatchPDF(layout) {
  const selected = photos.filter(p=>selectedIds.has(p.id));
  if (!selected.length) return;
  const pdf=new jsPDF({orientation:'p',unit:'mm',format:'a4'});
  const pw=210,ph=297;

  const done=()=>{ pdf.save('CameraStudio-lote.pdf'); closeBatchModal(); cancelSelectMode(); toast('✅ PDF em lote salvo!'); };

  if (layout==='onepage') {
    let i=0;
    const next=()=>{
      if (i>=selected.length){done();return;}
      const p=selected[i++];
      if (p.type==='video'){next();return;}
      const tmp=new Image();
      tmp.onload=()=>{
        if(i>1)pdf.addPage();
        pdf.setFillColor(255,255,255);pdf.rect(0,0,pw,ph,'F');
        const ratio=Math.min((pw-20)/tmp.width,(ph-20)/tmp.height);
        const iw=tmp.width*ratio,ih=tmp.height*ratio;
        pdf.addImage(p.dataUrl,'JPEG',(pw-iw)/2,(ph-ih)/2,iw,ih);
        next();
      };
      tmp.src=p.dataUrl;
    };
    next();
  } else {
    // grid 2x2
    const perPage=4;
    const pages=Math.ceil(selected.length/perPage);
    let pageIdx=0;
    const renderPage=()=>{
      if(pageIdx>=pages){done();return;}
      const batch=selected.slice(pageIdx*perPage,(pageIdx+1)*perPage);
      if(pageIdx>0)pdf.addPage();
      pdf.setFillColor(255,255,255);pdf.rect(0,0,pw,ph,'F');
      let done2=0;
      batch.forEach((p,bi)=>{
        if(p.type==='video'){done2++;if(done2===batch.length)renderPage();return;}
        const tmp=new Image();
        const col=bi%2,row=Math.floor(bi/2);
        const cx=10+col*95,cy=10+row*138,cw=90,ch=133;
        tmp.onload=()=>{
          const ratio=Math.min(cw/tmp.width,ch/tmp.height);
          const iw=tmp.width*ratio,ih=tmp.height*ratio;
          pdf.addImage(p.dataUrl,'JPEG',cx+(cw-iw)/2,cy+(ch-ih)/2,iw,ih);
          done2++;if(done2===batch.length){pageIdx++;renderPage();}
        };
        tmp.src=p.dataUrl;
      });
    };
    renderPage();
  }
}


/* ══════════════════════════════════════
   17. MODAL EDIÇÃO
══════════════════════════════════════ */
function openEditModal(idx) {
  editingIdx=idx;
  _fxToken++;            /* cancela qualquer efeito/moldura pendente da foto anterior */
  originalDataUrl=photos[idx].dataUrl;
  document.getElementById('editModal').classList.remove('hidden');
  const isVideo=photos[idx].type==='video';
  document.getElementById('modalImg').classList.toggle('hidden',isVideo);
  document.getElementById('modalVideo').classList.toggle('hidden',!isVideo);
  if (isVideo) { document.getElementById('modalVideo').src=photos[idx].dataUrl||photos[idx].url; }
  else { document.getElementById('modalImg').src=originalDataUrl; }
  document.getElementById('modalMeta').textContent=photos[idx].w+'×'+photos[idx].h;
  openTab('adjust',document.querySelector('.etab'));
  resetAdjust(); resetCropUI(); currentFrame='none';
  document.querySelectorAll('.fxchip').forEach(c=>c.classList.remove('active'));
  document.querySelector('.fxchip[data-e="none"]').classList.add('active');
  document.querySelectorAll('.frame-btn').forEach(c=>c.classList.remove('active'));
  document.querySelector('.frame-btn[data-frame="none"]').classList.add('active');
  clearDrawCanvas(); clearText();
  setupCropEvents();
}

function closeModal() { document.getElementById('editModal').classList.add('hidden'); cleanupCropEvents(); clearDrawCanvas(); }

function openTab(tab,el) {
  document.querySelectorAll('.etab').forEach(t=>t.classList.remove('active'));
  if(el)el.classList.add('active');
  const panelMap={adjust:'panelAdjust',effects:'panelEffects',crop:'panelCrop',draw:'panelDraw',text:'panelText',frame:'panelFrame',ai:'panelAI',export:'panelExport'};
  Object.values(panelMap).forEach(id=>document.getElementById(id).classList.add('hidden'));
  document.getElementById(panelMap[tab]).classList.remove('hidden');
  const cropOv=document.getElementById('cropOverlay');
  const drawCv=document.getElementById('drawCanvas');
  if(tab==='crop'){cropOv.classList.remove('hidden');drawCv.classList.add('hidden');}
  else if(tab==='draw'||tab==='text'){cropOv.classList.add('hidden');setupDrawCanvas();drawCv.classList.remove('hidden');resetCropUI();}
  else{cropOv.classList.add('hidden');drawCv.classList.add('hidden');resetCropUI();}
}


/* ══════════════════════════════════════
   18. AJUSTES
══════════════════════════════════════ */
function liveAdjust() {
  const B=+document.getElementById('slBrightness').value;
  const C=+document.getElementById('slContrast').value;
  const S=+document.getElementById('slSaturation').value;
  const BL=+document.getElementById('slBlur').value;
  const V=+document.getElementById('slVignette').value;
  ['Brightness','Contrast','Saturation','Sharpness','Blur','Vignette'].forEach(k=>{
    const el=document.getElementById('sl'+k);
    if(el) document.getElementById('v'+k).textContent=el.value;
  });
  const p=photos[editingIdx]; if(!p||p.type==='video') return;
  const canvas=document.getElementById('processCanvas');
  const tmpImg=new Image();
  tmpImg.onload=()=>{
    canvas.width=tmpImg.width; canvas.height=tmpImg.height;
    const ctx=canvas.getContext('2d');
    ctx.filter=BL>0?`blur(${BL}px)`:'none';
    ctx.drawImage(tmpImg,0,0);
    ctx.filter='none';
    const id=ctx.getImageData(0,0,canvas.width,canvas.height);
    const d=id.data; const bv=B/255,cv=(C+100)/100,sf=(S+100)/100;
    for(let i=0;i<d.length;i+=4){
      let r=d[i]/255,g=d[i+1]/255,b=d[i+2]/255;
      r+=bv;g+=bv;b+=bv;
      r=(r-.5)*cv+.5;g=(g-.5)*cv+.5;b=(b-.5)*cv+.5;
      const lv2=r*.299+g*.587+b*.114;
      r=lv2+(r-lv2)*sf;g=lv2+(g-lv2)*sf;b=lv2+(b-lv2)*sf;
      d[i]=cl(r*255);d[i+1]=cl(g*255);d[i+2]=cl(b*255);
    }
    ctx.putImageData(id,0,0);
    if(V>0) applyVignette(ctx,canvas.width,canvas.height,V/100);
    document.getElementById('modalImg').src=canvas.toDataURL('image/jpeg',.93);
  };
  tmpImg.src=originalDataUrl;
}

function applyVignette(ctx,w,h,strength){
  const grad=ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,Math.max(w,h)*.7);
  grad.addColorStop(0,'transparent');
  grad.addColorStop(1,`rgba(0,0,0,${strength})`);
  ctx.fillStyle=grad; ctx.fillRect(0,0,w,h);
}

function resetAdjust() {
  ['slBrightness','slContrast','slSaturation','slSharpness','slBlur','slVignette'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value=0;
  });
  ['vBrightness','vContrast','vSaturation','vSharpness','vBlur','vVignette'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.textContent=0;
  });
  if(editingIdx>=0&&photos[editingIdx].type!=='video'){
    document.getElementById('modalImg').src=originalDataUrl;
  }
}


/* ══════════════════════════════════════
   19. EFEITOS PÓS / MOLDURAS
══════════════════════════════════════ */

/* Cache do bitmap de origem já decodificado.
   CORREÇÃO: antes cada clique criava um new Image() e dependia do onload
   disparar de novo. Quando o navegador servia o data-URL do cache, o onload
   podia não disparar e NADA acontecia — era o motivo de não conseguir
   trocar de efeito depois do primeiro. */
let _fxCache = { url:null, img:null };
/* Token para descartar resultados obsoletos (cliques rápidos seguidos). */
let _fxToken = 0;

function carregarOrigemEfeito(url){
  return new Promise((resolve,reject)=>{
    if(_fxCache.url===url && _fxCache.img && _fxCache.img.complete){
      resolve(_fxCache.img); return;
    }
    const img=new Image();
    img.onload =()=>{ _fxCache={url,img}; resolve(img); };
    img.onerror=()=>reject(new Error('Falha ao carregar a imagem de origem'));
    img.src=url;
    /* Se já veio pronto do cache do navegador, resolve na hora. */
    if(img.complete && img.naturalWidth){ _fxCache={url,img}; resolve(img); }
  });
}

function applyEffect(fx,el) {
  document.querySelectorAll('.fxchip').forEach(c=>c.classList.remove('active'));
  if(el) el.classList.add('active');

  const p=photos[editingIdx];
  if(!p||p.type==='video') return;

  if(fx==='none'){
    _fxToken++;                       /* cancela qualquer efeito em andamento */
    p.dataUrl=originalDataUrl;
    document.getElementById('modalImg').src=p.dataUrl;
    savePhotoToDB(p).catch(()=>{});
    renderGallery();
    return;
  }

  const meuToken=++_fxToken;

  carregarOrigemEfeito(originalDataUrl).then(tmpImg=>{
    /* Descarta se o usuário já escolheu outro efeito nesse meio-tempo. */
    if(meuToken!==_fxToken) return;

    /* CORREÇÃO: canvas próprio. O 'processCanvas' é compartilhado com
       liveAdjust/applyFrame/applyCrop e podia ser sobrescrito no meio da
       operação assíncrona, gerando resultado errado ou nenhum. */
    const canvas=document.createElement('canvas');
    canvas.width=tmpImg.naturalWidth; canvas.height=tmpImg.naturalHeight;
    const ctx=canvas.getContext('2d');
    const W=canvas.width, H=canvas.height;

    if(fx==='whitebg'){
      /* O código original pintava branco e desenhava a foto POR CIMA.
         Como JPEG é opaco, o branco ficava coberto e não fazia nada.
         Aqui o fundo claro é realmente convertido em branco puro. */
      ctx.drawImage(tmpImg,0,0);
      whitenBackground(ctx,W,H);
    }
    else if(fx==='bokeh'){
      const cv2=document.createElement('canvas');
      cv2.width=W; cv2.height=H;
      const c2=cv2.getContext('2d');
      c2.filter='blur(8px)';
      c2.drawImage(tmpImg,0,0);
      c2.filter='none';
      ctx.drawImage(cv2,0,0);                       /* fundo desfocado */
      const gr=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*.45);
      gr.addColorStop(0,'rgba(0,0,0,0)');
      gr.addColorStop(1,'rgba(0,0,0,.55)');
      ctx.save();
      ctx.beginPath();                              /* centro nítido */
      ctx.ellipse(W/2,H/2,W*.36,H*.36,0,0,Math.PI*2);
      ctx.clip();
      ctx.drawImage(tmpImg,0,0);
      ctx.restore();
      ctx.fillStyle=gr; ctx.fillRect(0,0,W,H);
    }
    else{
      ctx.drawImage(tmpImg,0,0);
      applyFilter(ctx,W,H,fx,1);
    }

    if(meuToken!==_fxToken) return;   /* checa de novo antes de gravar */

    p.dataUrl=canvas.toDataURL('image/jpeg',.93);
    document.getElementById('modalImg').src=p.dataUrl;
    savePhotoToDB(p).catch(()=>{});
    renderGallery();
    toast('🎨 Efeito aplicado!');
  }).catch(err=>{
    /* CORREÇÃO: antes uma falha era silenciosa — o usuário só via "não funciona". */
    console.error('applyEffect:',err);
    toast('⚠️ Não foi possível aplicar o efeito');
  });
}


/* Converte o fundo claro em branco puro, mantendo o conteúdo escuro
   (texto, objeto) em primeiro plano. Usado pelo efeito "Fundo Branco". */
function whitenBackground(ctx,w,h){
  const id=ctx.getImageData(0,0,w,h);
  const d=id.data;

  /* 1) Estima o nível do fundo pelas bordas da imagem, que quase sempre
        são fundo — assim funciona tanto em foto clara quanto escura. */
  let soma=0,n=0;
  const passo=Math.max(1,Math.floor(w/100));
  for(let x=0;x<w;x+=passo){
    for(const y of [0,h-1]){
      const i=(y*w+x)*4;
      soma+=lum(d[i],d[i+1],d[i+2]); n++;
    }
  }
  for(let y=0;y<h;y+=passo){
    for(const x of [0,w-1]){
      const i=(y*w+x)*4;
      soma+=lum(d[i],d[i+1],d[i+2]); n++;
    }
  }
  const fundo=n?soma/n:200;

  /* 2) Tudo que for tão claro quanto o fundo vira branco puro;
        a faixa de transição é suavizada para não serrilhar as bordas.
        Calibrado para que o nível do fundo caia acima de (limite+suave). */
  const limite=Math.max(90,fundo-70);
  const suave=40;

  for(let i=0;i<d.length;i+=4){
    const lv=lum(d[i],d[i+1],d[i+2]);
    if(lv>=limite+suave){
      d[i]=d[i+1]=d[i+2]=255;
    } else if(lv>limite){
      const k=(lv-limite)/suave;
      d[i]=cl(d[i]+(255-d[i])*k);
      d[i+1]=cl(d[i+1]+(255-d[i+1])*k);
      d[i+2]=cl(d[i+2]+(255-d[i+2])*k);
    }
  }
  ctx.putImageData(id,0,0);
}

function applyFrame(frame,el) {
  currentFrame=frame;
  document.querySelectorAll('.frame-btn').forEach(c=>c.classList.remove('active')); el.classList.add('active');
  const p=photos[editingIdx]; if(!p||p.type==='video') return;
  if(frame==='none'){_fxToken++;p.dataUrl=originalDataUrl;document.getElementById('modalImg').src=p.dataUrl;savePhotoToDB(p).catch(()=>{});renderGallery();return;}
  const meuToken=++_fxToken;
  carregarOrigemEfeito(originalDataUrl).then(tmpImg=>{
    if(meuToken!==_fxToken) return;
    /* CORREÇÃO: canvas próprio (antes usava o processCanvas compartilhado,
       que podia ser sobrescrito por outra operação assíncrona). */
    const canvas=document.createElement('canvas');
    const iw=tmpImg.naturalWidth,ih=tmpImg.naturalHeight;
    const pad=frame==='polaroid'?Math.round(iw*.08):Math.round(iw*.04);
    const bpad=frame==='polaroid'?Math.round(iw*.22):pad;
    canvas.width=iw+pad*2; canvas.height=ih+pad+bpad;
    const ctx=canvas.getContext('2d');
    // fundo
    if(frame==='white'||frame==='polaroid')ctx.fillStyle='#fff';
    else if(frame==='black')ctx.fillStyle='#111';
    else if(frame==='gold')ctx.fillStyle='#f5a623';
    else if(frame==='film'){ctx.fillStyle='#111';applyFilmBorder(ctx,canvas.width,canvas.height);}
    else ctx.fillStyle='#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    if(frame==='rounded'){ctx.save();roundRect(ctx,pad,pad,iw,ih,iw*.06);ctx.clip();}
    ctx.drawImage(tmpImg,pad,pad,iw,ih);
    if(frame==='rounded')ctx.restore();
    if(frame==='shadow'){ctx.shadowColor='rgba(0,0,0,.4)';ctx.shadowBlur=24;ctx.shadowOffsetY=8;ctx.drawImage(tmpImg,pad,pad,iw,ih);ctx.shadowColor='transparent';}
    if(meuToken!==_fxToken) return;
    p.dataUrl=canvas.toDataURL('image/jpeg',.93);
    document.getElementById('modalImg').src=p.dataUrl;
    savePhotoToDB(p).catch(()=>{});
    renderGallery(); toast(t('frameApplied'));
  }).catch(err=>{
    console.error('applyFrame:',err);
    toast('⚠️ Não foi possível aplicar a moldura');
  });
}

function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();}

function applyFilmBorder(ctx,w,h){
  const sprocketH=12,spacing=20;
  ctx.fillStyle='#fff';
  for(let y=sprocketH;y<h-sprocketH*2;y+=spacing){
    ctx.fillRect(4,y,8,8); ctx.fillRect(w-12,y,8,8);
  }
}


/* ══════════════════════════════════════
   20. RECORTE
══════════════════════════════════════ */
function setupCropEvents() {
  const overlay=document.getElementById('cropOverlay');
  overlay.addEventListener('mousedown',onCropDown);
  overlay.addEventListener('touchstart',onCropDownT,{passive:true});
  document.addEventListener('mousemove',onCropMove);
  document.addEventListener('touchmove',onCropMoveT,{passive:true});
  document.addEventListener('mouseup',onCropUp);
  document.addEventListener('touchend',onCropUp);
}
function cleanupCropEvents() {
  const overlay=document.getElementById('cropOverlay');
  overlay.removeEventListener('mousedown',onCropDown);
  overlay.removeEventListener('touchstart',onCropDownT);
  document.removeEventListener('mousemove',onCropMove);
  document.removeEventListener('touchmove',onCropMoveT);
  document.removeEventListener('mouseup',onCropUp);
  document.removeEventListener('touchend',onCropUp);
}
function getRelPos(e,el){const r=el.getBoundingClientRect(),cx=e.touches?e.touches[0].clientX:e.clientX,cy=e.touches?e.touches[0].clientY:e.clientY;return{x:cx-r.left,y:cy-r.top};}
function onCropDown(e){const p=getRelPos(e,document.getElementById('modalPreview'));cropState={down:true,sx:p.x,sy:p.y,ex:p.x,ey:p.y};document.getElementById('cropBox').classList.remove('visible');}
function onCropDownT(e){onCropDown(e);}
function onCropMove(e){if(!cropState.down)return;if(document.getElementById('cropOverlay').classList.contains('hidden'))return;const p=getRelPos(e,document.getElementById('modalPreview'));cropState.ex=p.x;cropState.ey=p.y;if(cropRatio.w&&cropRatio.h){const dw=p.x-cropState.sx,sign=Math.sign(p.y-cropState.sy)||1;cropState.ey=cropState.sy+sign*Math.abs(dw)/(cropRatio.w/cropRatio.h);}renderCropBox();}
function onCropMoveT(e){onCropMove(e);}
function onCropUp(){cropState.down=false;}
function renderCropBox(){const box=document.getElementById('cropBox');const x=Math.min(cropState.sx,cropState.ex),y=Math.min(cropState.sy,cropState.ey),w=Math.abs(cropState.ex-cropState.sx),h=Math.abs(cropState.ey-cropState.sy);box.style.cssText=`left:${x}px;top:${y}px;width:${w}px;height:${h}px`;box.classList.add('visible');}
function setCropRatio(w,h){cropRatio={w,h};resetCropUI();toast(w===0?'Recorte livre':`Proporção ${w}:${h}`);}
function resetCropUI(){cropState={down:false,sx:0,sy:0,ex:0,ey:0};const b=document.getElementById('cropBox');if(b){b.classList.remove('visible');b.style.cssText='';}}
function resetCrop(){resetCropUI();}
function applyCrop(){
  const p=photos[editingIdx];if(!p||p.type==='video')return;
  const preview=document.getElementById('modalPreview'),img=document.getElementById('modalImg');
  if(!img.naturalWidth){toast('Imagem ainda carregando');return;}

  /* CORREÇÃO: mede a IMAGEM renderizada, não o contêiner. Como o <img> usa
     object-fit:contain, o conteúdo fica "encaixotado" dentro do elemento —
     usar o retângulo do contêiner recortava a região errada. */
  const prevRect=preview.getBoundingClientRect();
  const imgRect=img.getBoundingClientRect();
  const scale=Math.min(imgRect.width/img.naturalWidth, imgRect.height/img.naturalHeight);
  const drawW=img.naturalWidth*scale, drawH=img.naturalHeight*scale;
  /* deslocamento do conteúdo visível em relação ao contêiner onde o mouse é medido */
  const offX=(imgRect.left-prevRect.left)+(imgRect.width-drawW)/2;
  const offY=(imgRect.top-prevRect.top)+(imgRect.height-drawH)/2;

  let sx=(Math.min(cropState.sx,cropState.ex)-offX)/scale;
  let sy=(Math.min(cropState.sy,cropState.ey)-offY)/scale;
  let sw=Math.abs(cropState.ex-cropState.sx)/scale;
  let sh=Math.abs(cropState.ey-cropState.sy)/scale;

  /* CORREÇÃO: limita a seleção à imagem (antes gerava bordas pretas ou erro) */
  sx=Math.max(0,Math.min(sx,img.naturalWidth-1));
  sy=Math.max(0,Math.min(sy,img.naturalHeight-1));
  sw=Math.max(1,Math.min(sw,img.naturalWidth-sx));
  sh=Math.max(1,Math.min(sh,img.naturalHeight-sy));

  if(sw<10||sh<10){toast('Área muito pequena');return;}
  const canvas=document.getElementById('processCanvas');
  canvas.width=Math.round(sw);canvas.height=Math.round(sh);
  const ctx=canvas.getContext('2d');
  const tmpImg=new Image();
  tmpImg.onload=()=>{ctx.drawImage(tmpImg,sx,sy,sw,sh,0,0,sw,sh);p.dataUrl=canvas.toDataURL('image/jpeg',.93);p.w=Math.round(sw);p.h=Math.round(sh);p.whitebg=false;originalDataUrl=p.dataUrl;document.getElementById('modalImg').src=p.dataUrl;document.getElementById('modalMeta').textContent=p.w+'×'+p.h;resetCropUI();savePhotoToDB(p).catch(()=>{});renderGallery();toast(t('cropApplied'));};
  tmpImg.src=p.dataUrl;
}


/* ══════════════════════════════════════
   21. DESENHO E TEXTO
══════════════════════════════════════ */
function setupDrawCanvas() {
  const preview=document.getElementById('modalPreview');
  const dc=document.getElementById('drawCanvas');
  const rect=preview.getBoundingClientRect();
  dc.width=rect.width; dc.height=rect.height;
  dc.removeEventListener('mousedown',onDrawStart);
  dc.removeEventListener('touchstart',onDrawStartT);
  dc.addEventListener('mousedown',onDrawStart);
  dc.addEventListener('touchstart',onDrawStartT,{passive:false});
  document.addEventListener('mousemove',onDrawMove);
  document.addEventListener('touchmove',onDrawMoveT,{passive:false});
  document.addEventListener('mouseup',onDrawEnd);
  document.addEventListener('touchend',onDrawEnd);
}

function setDrawTool(tool,el) {
  drawTool=tool;
  document.querySelectorAll('.draw-tool').forEach(b=>b.classList.remove('active')); el.classList.add('active');
}

function onDrawStart(e){isDrawing=true;const pos=getDrawPos(e);lastDraw=pos;}
function onDrawStartT(e){e.preventDefault();isDrawing=true;const pos=getDrawPos(e.touches[0]);lastDraw=pos;}
function onDrawMove(e){if(!isDrawing)return;const pos=getDrawPos(e);drawStroke(lastDraw,pos);lastDraw=pos;}
function onDrawMoveT(e){if(!isDrawing)return;e.preventDefault();const pos=getDrawPos(e.touches[0]);drawStroke(lastDraw,pos);lastDraw=pos;}
function onDrawEnd(){isDrawing=false;}

function getDrawPos(e){const dc=document.getElementById('drawCanvas'),r=dc.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}

function drawStroke(from,to){
  const dc=document.getElementById('drawCanvas');
  const ctx=dc.getContext('2d');
  const size=+document.getElementById('brushSize').value;
  const color=document.getElementById('brushColor').value;
  ctx.lineWidth=size; ctx.lineCap='round'; ctx.lineJoin='round';
  if(drawTool==='eraser'){ctx.globalCompositeOperation='destination-out';ctx.strokeStyle='rgba(0,0,0,1)';}
  else{ctx.globalCompositeOperation='source-over';ctx.strokeStyle=color;}
  ctx.beginPath(); ctx.moveTo(from.x,from.y); ctx.lineTo(to.x,to.y); ctx.stroke();
}

function clearDraw(){const dc=document.getElementById('drawCanvas');dc.getContext('2d').clearRect(0,0,dc.width,dc.height);}
function clearDrawCanvas(){const dc=document.getElementById('drawCanvas');if(dc)dc.getContext('2d').clearRect(0,0,dc.width,dc.height);}

function applyDraw(){
  const p=photos[editingIdx];if(!p||p.type==='video')return;
  const dc=document.getElementById('drawCanvas');
  const tmpImg=new Image();
  tmpImg.onload=()=>{
    const canvas=document.getElementById('processCanvas');
    canvas.width=tmpImg.width;canvas.height=tmpImg.height;
    const ctx=canvas.getContext('2d');
    ctx.drawImage(tmpImg,0,0);
    ctx.drawImage(dc,0,0,dc.width,dc.height,0,0,canvas.width,canvas.height);
    p.dataUrl=canvas.toDataURL('image/jpeg',.93);
    originalDataUrl=p.dataUrl;
    document.getElementById('modalImg').src=p.dataUrl;
    clearDrawCanvas(); savePhotoToDB(p).catch(()=>{}); renderGallery(); toast(t('drawApplied'));
  };
  tmpImg.src=originalDataUrl;
}

/* Texto */
function setupTextCanvas() {
  const dc=document.getElementById('drawCanvas');
  dc.onclick=onTextPlace;
}

function onTextPlace(e){
  const text=document.getElementById('textInput').value.trim();
  if(!text)return;
  const dc=document.getElementById('drawCanvas'),r=dc.getBoundingClientRect();
  const x=e.clientX-r.left,y=e.clientY-r.top;
  const size=document.getElementById('textSize').value;
  const color=document.getElementById('textColor').value;
  const font=document.getElementById('textFont').value;
  const ctx=dc.getContext('2d');
  ctx.font=`${size}px ${font}`;
  ctx.fillStyle=color;
  ctx.shadowColor='rgba(0,0,0,.5)';ctx.shadowBlur=4;
  ctx.fillText(text,x,y);
  ctx.shadowBlur=0;
  toast(t('textApplied'));
}

function applyText(){applyDraw();}
function clearText(){clearDrawCanvas();}


/* ══════════════════════════════════════
   22. IA (simulada localmente)
══════════════════════════════════════ */
function aiAutoEnhance() {
  const p=photos[editingIdx];if(!p||p.type==='video')return;
  showAIResult('Analisando luminosidade, contraste e saturação...');
  setTimeout(()=>{
    // Ajusta sliders para valores "ótimos" simulados
    document.getElementById('slBrightness').value=10;
    document.getElementById('slContrast').value=15;
    document.getElementById('slSaturation').value=20;
    liveAdjust();
    showAIResult('✨ Melhoria aplicada: +10 brilho, +15 contraste, +20 saturação');
    toast(t('aiDone'));
  },1200);
}

function aiAutoCrop() {
  const p=photos[editingIdx];if(!p||p.type==='video')return;
  showAIResult('Detectando área principal da cena...');
  setTimeout(()=>{
    // Simula recorte para 4:3 centrado
    setCropRatio(4,3);
    showAIResult('📐 Proporção 4:3 sugerida com enquadramento centrado. Arraste para ajustar.');
    toast('IA: enquadramento 4:3 aplicado');
  },1000);
}

function aiColorBalance() {
  const p=photos[editingIdx];if(!p||p.type==='video')return;
  showAIResult('Analisando temperatura de cor...');
  setTimeout(()=>{
    applyEffect('chrome',document.querySelector('.fxchip[data-e="chrome"]'));
    showAIResult('🎨 Balanço de cores ajustado com filtro Chrome para temperatura neutra.');
    toast('IA: balanço de cores aplicado');
  },900);
}

function aiRemoveBg() {
  const p=photos[editingIdx];if(!p||p.type==='video')return;
  showAIResult('Processando remoção de fundo (simulado)...');
  setTimeout(()=>{
    applyEffect('whitebg',document.querySelector('.fxchip[data-e="whitebg"]'));
    showAIResult('⬜ Fundo substituído por branco. Para remoção real, integre com Remove.bg API.');
    toast('IA: fundo branco aplicado');
  },1500);
}

function showAIResult(msg){
  const r=document.getElementById('aiResult');
  r.classList.remove('hidden');
  document.getElementById('aiResultText').textContent=msg;
}


/* ══════════════════════════════════════
   WEB SHARE API
══════════════════════════════════════ */
async function sharePhoto() {
  const p=photos[editingIdx];if(!p)return;
  if(!navigator.share){toast(t('noShare'));return;}
  try {
    const blob=await (await fetch(p.dataUrl)).blob();
    const file=new File([blob],'CameraStudio.jpg',{type:'image/jpeg'});
    await navigator.share({title:'CameraStudio',files:[file]});
    toast('📤 Compartilhado!');
  } catch(e) { if(e.name!=='AbortError') toast('Erro ao compartilhar'); }
}

async function shareLastPhoto() {
  if(!photos.length){toast('Nenhuma foto capturada');return;}
  const p=photos[0];
  if(!navigator.share){toast(t('noShare'));return;}
  try {
    const blob=await (await fetch(p.dataUrl)).blob();
    const file=new File([blob],'CameraStudio.jpg',{type:'image/jpeg'});
    await navigator.share({title:'CameraStudio',files:[file]});
  } catch(e) { if(e.name!=='AbortError') toast('Erro ao compartilhar'); }
}


/* ══════════════════════════════════════
   EXPORTAR
══════════════════════════════════════ */
function exportPDF(addWhiteBg) {
  const p=photos[editingIdx];if(!p||p.type==='video'){toast('Vídeos não podem ser exportados como PDF');return;}
  toast('📄 Gerando PDF...');
  const tmpImg=new Image();
  tmpImg.onload=()=>{
    const landscape=tmpImg.width>tmpImg.height;
    const pdf=new jsPDF({orientation:landscape?'l':'p',unit:'mm',format:'a4'});
    const pw=landscape?297:210,ph=landscape?210:297;
    pdf.setFillColor(255,255,255);pdf.rect(0,0,pw,ph,'F');
    let src=p.dataUrl;
    if(addWhiteBg){const c2=document.getElementById('processCanvas');c2.width=tmpImg.width;c2.height=tmpImg.height;const ctx2=c2.getContext('2d');ctx2.fillStyle='#fff';ctx2.fillRect(0,0,c2.width,c2.height);ctx2.drawImage(tmpImg,0,0);src=c2.toDataURL('image/jpeg',.95);}
    const ratio=Math.min((pw-20)/tmpImg.width,(ph-20)/tmpImg.height);
    const iw=tmpImg.width*ratio,ih=tmpImg.height*ratio;
    pdf.addImage(src,'JPEG',(pw-iw)/2,(ph-ih)/2,iw,ih);
    pdf.save(`CameraStudio-${p.id}.pdf`);
    toast(t('pdfSaved'));
  };
  tmpImg.src=p.dataUrl;
}

function downloadJPG() {
  const p=photos[editingIdx];if(!p)return;
  if(p.type==='video'){
    const a=document.createElement('a');a.href=p.dataUrl||p.url;a.download=`CameraStudio-${p.id}.webm`;a.click();toast('⬇️ Vídeo salvo!');return;
  }
  const a=document.createElement('a');a.href=p.dataUrl;a.download=`CameraStudio-${p.id}.jpg`;a.click();toast(t('jpgSaved'));
}

function deletePhoto() {
  if(editingIdx<0)return;
  const id=photos[editingIdx].id;
  photos.splice(editingIdx,1);
  deletePhotoFromDB(id).catch(()=>{});
  closeModal();
  renderGallery();
  updateThumbFromPhotos();
  toast(t('deleted'));
}


/* ══════════════════════════════════════
   DASHBOARD / ESTATÍSTICAS
══════════════════════════════════════ */
function openDashboard() {
  document.getElementById('cameraScreen').classList.add('screen-hidden');
  document.getElementById('homeScreen').style.display='none';
  document.getElementById('dashboardScreen').classList.remove('screen-hidden');
  renderDashboard();
}

function closeDashboard() {
  document.getElementById('dashboardScreen').classList.add('screen-hidden');
  if(stream) document.getElementById('cameraScreen').classList.remove('screen-hidden');
  else document.getElementById('homeScreen').style.display='';
}

function renderDashboard() {
  const body=document.getElementById('dashboardBody');
  const total=photos.length;
  const videos=photos.filter(p=>p.type==='video').length;
  const pdfs=0; // poderia ser rastreado

  // contagens por filtro
  const filterCounts={};
  photos.forEach(p=>{filterCounts[p.filter||'none']=(filterCounts[p.filter||'none']||0)+1;});
  const topFilters=Object.entries(filterCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);

  // contagens por modo
  const modeCounts={};
  photos.forEach(p=>{modeCounts[p.mode||'foto']=(modeCounts[p.mode||'foto']||0)+1;});

  // fotos por dia (últimos 7 dias)
  const dayCount={};
  const today=new Date();
  for(let i=6;i>=0;i--){const d=new Date(today);d.setDate(d.getDate()-i);dayCount[d.toLocaleDateString('pt-BR',{weekday:'short'})]=0;}
  photos.forEach(p=>{
    const d=new Date(p.id);
    const key=d.toLocaleDateString('pt-BR',{weekday:'short'});
    if(key in dayCount) dayCount[key]++;
  });

  body.innerHTML=`
    <div class="stat-cards">
      <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-lbl">Total de Fotos</div></div>
      <div class="stat-card"><div class="stat-num">${videos}</div><div class="stat-lbl">Vídeos</div></div>
      <div class="stat-card"><div class="stat-num">${total-videos}</div><div class="stat-lbl">Fotos</div></div>
      <div class="stat-card"><div class="stat-num">${Object.keys(filterCounts).length}</div><div class="stat-lbl">Filtros Usados</div></div>
    </div>
    <div class="chart-card">
      <h4>📅 Fotos por dia (últimos 7 dias)</h4>
      <div class="chart-wrap"><canvas id="chartDays"></canvas></div>
    </div>
    <div class="chart-card">
      <h4>🎨 Filtros mais usados</h4>
      <div class="chart-wrap"><canvas id="chartFilters"></canvas></div>
    </div>
    <div class="chart-card">
      <h4>📷 Modos de captura</h4>
      <div class="chart-wrap"><canvas id="chartModes"></canvas></div>
    </div>
  `;

  const chartOpts={responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:isDark?'#f0f0ff':'#1a1a2e',font:{size:11}}}}};

  new Chart(document.getElementById('chartDays'),{type:'bar',data:{labels:Object.keys(dayCount),datasets:[{label:'Fotos',data:Object.values(dayCount),backgroundColor:'rgba(0,229,255,.6)',borderColor:'rgba(0,229,255,1)',borderWidth:1,borderRadius:4}]},options:{...chartOpts,scales:{y:{ticks:{color:isDark?'#888':'#444'},grid:{color:isDark?'rgba(255,255,255,.06)':'rgba(0,0,0,.06)'}},x:{ticks:{color:isDark?'#888':'#444'},grid:{display:false}}}}});

  new Chart(document.getElementById('chartFilters'),{type:'doughnut',data:{labels:topFilters.map(f=>f[0]),datasets:[{data:topFilters.map(f=>f[1]),backgroundColor:['rgba(0,229,255,.8)','rgba(245,166,35,.8)','rgba(50,215,75,.8)','rgba(255,69,58,.8)','rgba(160,100,255,.8)']}]},options:chartOpts});

  const modeKeys=Object.keys(modeCounts),modeVals=Object.values(modeCounts);
  new Chart(document.getElementById('chartModes'),{type:'polarArea',data:{labels:modeKeys,datasets:[{data:modeVals,backgroundColor:['rgba(0,229,255,.6)','rgba(245,166,35,.6)','rgba(50,215,75,.6)','rgba(255,69,58,.6)','rgba(10,132,255,.6)','rgba(160,100,255,.6)']}]},options:chartOpts});
}


/* ══════════════════════════════════════
   TOAST
══════════════════════════════════════ */
function toast(msg) {
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),2600);
}

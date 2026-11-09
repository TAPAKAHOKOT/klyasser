// Нарисованные «снимки» для демо и скриншотов: разные по цвету, светлоте, теплоте и кучности.
// Подключается в браузере: window.klyasserScenes([['sunset', 0], ...]) → File[] (JPEG 900×1200),
// window.klyasserSceneUrl('sea', 1) → data:URL превью.
(function(){
  const W = 900, H = 1200;
  const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const grad = (c, x0, y0, x1, y1, stops) => { const g = c.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, col]) => g.addColorStop(o, col)); return g; };
  const vgrad = (c, y0, y1, stops) => grad(c, 0, y0, 0, y1, stops);
  const circle = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
  const ellipse = (c, x, y, rx, ry, rot = 0, a0 = 0, a1 = Math.PI * 2) => { c.beginPath(); c.ellipse(x, y, rx, ry, rot, a0, a1); c.fill(); };
  const pick = (arr, v) => arr[v % arr.length];

  const scenes = {
    sunset(c, r, v){
      const [top, mid, low, sun] = pick([['#3b2a5c', '#c85a6a', '#f3a35c', '#ffe2a8'], ['#2b2550', '#9a4f8a', '#ee8a6a', '#ffd7b0']], v);
      c.fillStyle = vgrad(c, 0, H * .62, [[0, top], [.5, mid], [.85, low], [1, '#f8cf8a']]); c.fillRect(0, 0, W, H * .62);
      c.fillStyle = sun; circle(c, W * .62, H * .55, 92);
      c.fillStyle = vgrad(c, H * .62, H, [[0, '#d7835f'], [1, '#2f2442']]); c.fillRect(0, H * .62, W, H * .38);
      c.fillStyle = 'rgba(255,226,168,.5)';
      for (let i = 0; i < 16; i++){ const w = 170 - i * 8 + r() * 30; c.fillRect(W * .62 - w / 2 + (r() - .5) * 24, H * .64 + i * 22, w, 4); }
      c.fillStyle = '#2a1f33'; c.beginPath(); c.moveTo(0, H * .63);
      for (let x = 0; x <= W * .42; x += 20) c.lineTo(x, H * .62 - 30 - Math.sin(x / 70) * 40 - r() * 10);
      c.lineTo(W * .42, H * .63); c.fill();
    },
    sea(c, r, v){
      c.fillStyle = vgrad(c, 0, H * .45, pick([[[0, '#9cc9ea'], [1, '#e3f1f8']], [[0, '#7fb0d8'], [1, '#d5e8f2']]], v)); c.fillRect(0, 0, W, H * .45);
      for (let i = 0; i < 5; i++){ c.fillStyle = 'rgba(255,255,255,.7)'; ellipse(c, r() * W, 60 + r() * 300, 80 + r() * 90, 18 + r() * 14); }
      c.fillStyle = vgrad(c, H * .45, H * .78, [[0, '#3f86b8'], [1, '#1f557f']]); c.fillRect(0, H * .45, W, H * .33);
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 3;
      for (let i = 0; i < 26; i++){ const y = H * .47 + r() * H * .3, x = r() * W; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 30, y - 6, x + 60 + r() * 40, y); c.stroke(); }
      c.fillStyle = '#e8d2ad'; c.beginPath(); c.moveTo(0, H * .8);
      for (let x = 0; x <= W; x += 30) c.lineTo(x, H * .78 + Math.sin(x / 90) * 18); c.lineTo(W, H); c.lineTo(0, H); c.fill();
      c.fillStyle = 'rgba(255,255,255,.75)'; c.beginPath(); c.moveTo(0, H * .79);
      for (let x = 0; x <= W; x += 30) c.lineTo(x, H * .775 + Math.sin(x / 90) * 18); c.lineTo(W, H * .8); c.lineTo(0, H * .81); c.fill();
    },
    forest(c, r, v){
      c.fillStyle = vgrad(c, 0, H, pick([[[0, '#d9e4d0'], [1, '#7c9a74']], [[0, '#e6e0c8'], [1, '#8a9a64']]], v)); c.fillRect(0, 0, W, H);
      const layers = ['#9db394', '#7a9a6f', '#58794f', '#3d5c38', '#25402a'];
      layers.forEach((col, li) => {
        c.fillStyle = col; const base = H * (.42 + li * .13), size = 70 + li * 45;
        for (let x = -40; x < W + 40; x += size * .55 + r() * 30){
          const h = size * (2.2 + r()); c.beginPath(); c.moveTo(x, base - h); c.lineTo(x + size * .55, base + 10); c.lineTo(x - size * .55, base + 10); c.fill();
        }
        c.fillRect(0, base, W, H - base);
      });
    },
    flowers(c, r, v){
      c.fillStyle = vgrad(c, 0, H, [[0, '#4d7a45'], [1, '#26401f']]); c.fillRect(0, 0, W, H);
      const cols = pick([['#f2a0b5', '#e5536f', '#fff1f2', '#f6c2d0'], ['#f6d36b', '#f2a04a', '#fff4d6', '#e8743b']], v);
      for (let i = 0; i < 900; i++){
        const x = r() * W, y = r() * H, s = 6 + r() * 16; c.fillStyle = cols[(r() * cols.length) | 0];
        for (let k = 0; k < 5; k++){ const a = k / 5 * Math.PI * 2; circle(c, x + Math.cos(a) * s * .6, y + Math.sin(a) * s * .6, s * .5); }
        c.fillStyle = '#f7d24a'; circle(c, x, y, s * .28);
      }
    },
    interior(c, r, v){
      c.fillStyle = vgrad(c, 0, H * .72, pick([[[0, '#efe3d1'], [1, '#dcc7aa']], [[0, '#e9e4dc'], [1, '#cfc4b4']]], v)); c.fillRect(0, 0, W, H * .72);
      c.fillStyle = '#fbf6ec'; c.fillRect(W * .18, H * .12, W * .4, H * .42);
      c.fillStyle = 'rgba(255,248,230,.6)'; c.beginPath(); c.moveTo(W * .18, H * .54); c.lineTo(W * .58, H * .54); c.lineTo(W * .92, H * .95); c.lineTo(W * .3, H * .95); c.fill();
      c.strokeStyle = '#b89a78'; c.lineWidth = 8; c.strokeRect(W * .18, H * .12, W * .4, H * .42);
      c.beginPath(); c.moveTo(W * .38, H * .12); c.lineTo(W * .38, H * .54); c.moveTo(W * .18, H * .33); c.lineTo(W * .58, H * .33); c.stroke();
      c.fillStyle = vgrad(c, H * .72, H, [[0, '#b58560'], [1, '#8a5f3f']]); c.fillRect(0, H * .72, W, H * .28);
      c.strokeStyle = 'rgba(70,40,20,.25)'; c.lineWidth = 2; for (let y = H * .74; y < H; y += 34){ c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      c.fillStyle = '#c0663f'; c.beginPath(); c.moveTo(W * .7, H * .62); c.lineTo(W * .86, H * .62); c.lineTo(W * .83, H * .76); c.lineTo(W * .73, H * .76); c.fill();
      for (let i = 0; i < 14; i++){ c.fillStyle = pick(['#4f7a3e', '#3e6a33', '#6a944f'], i); ellipse(c, W * .78 + (r() - .5) * 120, H * .5 + (r() - .5) * 180, 22, 60, (r() - .5) * 1.6); }
    },
    night(c, r, v){
      c.fillStyle = vgrad(c, 0, H, pick([[[0, '#0e1530'], [1, '#2a2f5c']], [[0, '#14112a'], [1, '#3a2850']]], v)); c.fillRect(0, 0, W, H);
      c.fillStyle = '#f4ecd0'; circle(c, W * .78, H * .14, 44);
      for (let i = 0; i < 80; i++){ c.fillStyle = `rgba(255,255,255,${.3 + r() * .5})`; circle(c, r() * W, r() * H * .4, 1 + r() * 1.5); }
      let x = -20;
      while (x < W){
        const w = 90 + r() * 120, h = H * (.3 + r() * .4); c.fillStyle = r() < .5 ? '#12172b' : '#1a2038'; c.fillRect(x, H - h, w, h);
        for (let yy = H - h + 20; yy < H - 20; yy += 26) for (let xx = x + 12; xx < x + w - 12; xx += 20) if (r() < .45){ c.fillStyle = r() < .8 ? '#f5c96a' : '#9fd0f0'; c.fillRect(xx, yy, 9, 13); }
        x += w + 6;
      }
    },
    portrait(c, r, v){
      const [b0, b1] = pick([['#e9d6c4', '#c9a98f'], ['#a9c3d9', '#6f8fae'], ['#d8c2d8', '#9c7fa0']], v);
      c.fillStyle = vgrad(c, 0, H, [[0, b0], [1, b1]]); c.fillRect(0, 0, W, H);
      for (let i = 0; i < 14; i++){ c.fillStyle = `rgba(255,255,255,${.06 + r() * .14})`; circle(c, r() * W, r() * H * .7, 30 + r() * 70); }
      const cx = W * .5 + (v - 1) * 40, skin = pick(['#e8b99a', '#d9a17e', '#f0c7aa'], v), hair = pick(['#3b2a20', '#c99b58', '#1d1a1c'], v);
      c.fillStyle = hair; ellipse(c, cx, H * .5, 190, 330);
      c.fillStyle = pick(['#2d3a5c', '#7a3b3b', '#f2efe6'], v); ellipse(c, cx, H * 1.04, 380, 340, 0, Math.PI, Math.PI * 2);
      c.fillStyle = skin; c.fillRect(cx - 55, H * .56, 110, 150); ellipse(c, cx, H * .44, 135, 172);
      c.fillStyle = 'rgba(120,60,40,.13)'; ellipse(c, cx + 45, H * .46, 80, 150);
      c.fillStyle = hair; ellipse(c, cx, H * .36, 160, 120, 0, Math.PI, Math.PI * 2); ellipse(c, cx - 70, H * .33, 110, 70, -.5);
      if (v === 1){ c.fillStyle = '#1b1b22'; ellipse(c, cx - 55, H * .43, 48, 30); ellipse(c, cx + 55, H * .43, 48, 30); c.fillRect(cx - 12, H * .425, 24, 6); }
      else { c.strokeStyle = '#4a2e25'; c.lineWidth = 5; c.beginPath(); c.arc(cx - 52, H * .435, 22, .2, Math.PI - .2); c.moveTo(cx + 74, H * .435); c.arc(cx + 52, H * .435, 22, .2, Math.PI - .2); c.stroke(); }
      c.fillStyle = '#c4626a'; ellipse(c, cx, H * .53, 34, 13);
    },
    mountains(c, r, v){
      c.fillStyle = vgrad(c, 0, H * .6, pick([[[0, '#b9d4ea'], [1, '#eef4f7']], [[0, '#c9c3e2'], [1, '#f3eef3']]], v)); c.fillRect(0, 0, W, H * .6);
      const ridge = (base, amp, col, snow) => {
        c.fillStyle = col; c.beginPath(); c.moveTo(0, H); const pts = [];
        for (let x = 0; x <= W; x += 60){ const y = base - amp * (.4 + r() * .6); pts.push([x, y]); c.lineTo(x, y); }
        c.lineTo(W, H); c.fill();
        if (snow){ c.fillStyle = 'rgba(255,255,255,.92)'; pts.forEach(([x, y], i) => { if (i && y < base - amp * .7){ c.beginPath(); c.moveTo(x, y); c.lineTo(x - 30, y + 50); c.lineTo(x + 30, y + 50); c.fill(); } }); }
      };
      ridge(H * .55, 260, '#8ea5c2', true); ridge(H * .62, 160, '#6f86a6', false); ridge(H * .7, 90, '#50677f', false);
      c.fillStyle = vgrad(c, H * .72, H, [[0, '#7f9fbe'], [1, '#3c536b']]); c.fillRect(0, H * .72, W, H * .28);
      c.fillStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 18; i++) c.fillRect(r() * W, H * .74 + r() * H * .24, 60 + r() * 120, 3);
    },
    coffee(c, r, v){
      c.fillStyle = pick(['#8a5a3b', '#6f4a33'], v); c.fillRect(0, 0, W, H);
      c.strokeStyle = 'rgba(40,20,10,.25)'; c.lineWidth = 3;
      for (let x = 0; x < W; x += 9){ c.beginPath(); c.moveTo(x + r() * 4, 0); c.bezierCurveTo(x + 20, H * .3, x - 20, H * .7, x + r() * 6, H); c.stroke(); }
      c.fillStyle = 'rgba(0,0,0,.25)'; circle(c, W * .48, H * .5, 250);
      c.fillStyle = '#f4efe7'; circle(c, W * .46, H * .48, 250); c.fillStyle = '#e4ddd2'; circle(c, W * .46, H * .48, 175);
      c.fillStyle = '#f7f3ec'; circle(c, W * .46, H * .48, 160); c.fillStyle = '#4a2a17'; circle(c, W * .46, H * .48, 130);
      c.fillStyle = '#c99566'; circle(c, W * .46, H * .48, 95); c.fillStyle = '#4a2a17'; ellipse(c, W * .46, H * .47, 40, 70);
      c.fillStyle = '#d9a35a'; ellipse(c, W * .78, H * .86, 150, 70, -.4); c.fillStyle = '#b7782f'; for (let i = -2; i <= 2; i++) ellipse(c, W * .78 + i * 45, H * .86 - i * 18, 20, 66, -.4);
    },
    arches(c, r, v){
      c.fillStyle = pick(['#c8714f', '#d99a6c'], v); c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(0,0,0,.08)'; for (let i = 0; i < 400; i++) c.fillRect(r() * W, r() * H, 2 + r() * 3, 2 + r() * 3);
      for (let i = 0; i < 3; i++){
        const x = 90 + i * 260, w = 200, top = H * .22, bot = H * .9;
        c.fillStyle = vgrad(c, top, bot, [[0, '#7fb3d9'], [1, '#d7e8f2']]);
        c.beginPath(); c.moveTo(x, bot); c.lineTo(x, top + w / 2); c.arc(x + w / 2, top + w / 2, w / 2, Math.PI, 0); c.lineTo(x + w, bot); c.fill();
        c.fillStyle = 'rgba(70,30,20,.25)'; c.fillRect(x + w, top + w / 2, 18, bot - top - w / 2);
      }
      c.fillStyle = 'rgba(60,25,15,.18)'; c.fillRect(0, H * .9, W, H * .1);
    },
    lavender(c, r, v){
      c.fillStyle = vgrad(c, 0, H * .38, pick([[[0, '#f2c6c8'], [1, '#e8d8ea']], [[0, '#f4d5b3'], [1, '#ece0ee']]], v)); c.fillRect(0, 0, W, H * .38);
      c.fillStyle = '#7c8a5a'; c.fillRect(0, H * .36, W, H * .64);
      for (let row = 0; row < 26; row++){
        const t = row / 26, y = H * .38 + t * t * H * .62, spread = 40 + t * 900;
        for (let k = -8; k <= 8; k++){
          const x = W / 2 + k * spread * .12 + (r() - .5) * 8; c.fillStyle = pick(['#8e6fc1', '#a68ad4', '#7558a8'], row + k + 8);
          ellipse(c, x, y, 4 + t * 26, 2 + t * 10);
        }
      }
    },
    desert(c, r, v){
      c.fillStyle = vgrad(c, 0, H * .45, pick([[[0, '#f7e2c0'], [1, '#f2c792']], [[0, '#f3d9d0'], [1, '#eab48a']]], v)); c.fillRect(0, 0, W, H * .45);
      const dune = (y, amp, c0, c1) => { c.fillStyle = vgrad(c, y - amp, H, [[0, c0], [1, c1]]); c.beginPath(); c.moveTo(0, H); for (let x = 0; x <= W; x += 20) c.lineTo(x, y + Math.sin(x / 160 + y) * amp); c.lineTo(W, H); c.fill(); };
      dune(H * .45, 40, '#e9a866', '#d98a4a'); dune(H * .6, 60, '#f0b77a', '#c9773d'); dune(H * .78, 50, '#f5c48d', '#d48a4c');
    },
    lemons(c, r, v){
      c.fillStyle = '#2c5c9e'; c.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += 150) for (let x = 0; x < W; x += 150){ c.fillStyle = '#f3f0e6'; c.fillRect(x + 4, y + 4, 142, 142); c.fillStyle = '#2c5c9e'; circle(c, x + 75, y + 75, 40); c.fillStyle = '#f3f0e6'; circle(c, x + 75, y + 75, 20); }
      for (let i = 0; i < 18; i++){
        const x = r() * W, y = r() * H, a = r() * 3;
        c.fillStyle = pick(['#3f7a3a', '#5b9a4a'], i); ellipse(c, x + 50, y - 40, 22, 55, a + .8);
        c.fillStyle = pick(['#f4d23c', '#f0c22a', '#f7dc5a'], i); ellipse(c, x, y, 70, 52, a);
        c.fillStyle = 'rgba(255,255,255,.35)'; ellipse(c, x - 18, y - 14, 20, 10, a);
      }
    },
    snow(c, r, v){
      c.fillStyle = vgrad(c, 0, H, [[0, '#e9eef2'], [1, '#ffffff']]); c.fillRect(0, 0, W, H);
      c.fillStyle = '#dfe6ec'; c.beginPath(); c.moveTo(0, H * .7); for (let x = 0; x <= W; x += 40) c.lineTo(x, H * .66 + Math.sin(x / 140) * 30); c.lineTo(W, H); c.lineTo(0, H); c.fill();
      for (let i = 0; i < 7; i++){
        const x = 60 + i * 130 + (r() - .5) * 40, base = H * (.66 + r() * .1), h = 160 + r() * 200;
        c.strokeStyle = '#3d4650'; c.lineWidth = 6; c.beginPath(); c.moveTo(x, base); c.lineTo(x, base - h); c.stroke();
        c.lineWidth = 3; for (let k = 0; k < 8; k++){ const y = base - h * (k + 1) / 9, len = (9 - k) * 9; c.beginPath(); c.moveTo(x, y); c.lineTo(x - len, y + len * .6); c.moveTo(x, y); c.lineTo(x + len, y + len * .6); c.stroke(); }
      }
      c.fillStyle = 'rgba(255,255,255,.9)'; for (let i = 0; i < 160; i++) circle(c, r() * W, r() * H, 1 + r() * 3);
    },
  };

  function render(kind, v, seed, w = W, h = H){
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d', { willReadFrequently: true }), r = rng(seed * 7919 + kind.length * 131 + v * 17);
    scenes[kind](c, r, v);
    const g = c.createRadialGradient(W / 2, H / 2, H * .3, W / 2, H / 2, H * .78); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.26)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const d = c.getImageData(0, 0, W, H), a = d.data; // плёночное зерно
    for (let i = 0; i < a.length; i += 4){ const n = (r() - .5) * 16; a[i] += n; a[i + 1] += n; a[i + 2] += n; }
    c.putImageData(d, 0, 0);
    if (w === W && h === H) return cv;
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const oc = out.getContext('2d'); oc.imageSmoothingQuality = 'high'; oc.drawImage(cv, 0, 0, w, h);
    return out;
  }
  window.klyasserScenes = async function(list, seed = 7){
    const files = [];
    for (const [kind, v = 0] of list){
      const cv = render(kind, v, seed);
      const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', .9));
      files.push(new File([blob], `${kind}-${v + 1}.jpg`, { type: 'image/jpeg' }));
    }
    return files;
  };
  window.klyasserSceneUrl = (kind, v = 0, seed = 7) => render(kind, v, seed, 450, 600).toDataURL('image/jpeg', .9);
  window.klyasserSceneKinds = Object.keys(scenes);
})();

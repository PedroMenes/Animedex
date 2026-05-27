(function () {
  'use strict';

  // ── Background canvas ─────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.style.cssText = [
    'position:fixed', 'top:0', 'left:0',
    'width:100%', 'height:100%',
    'pointer-events:none', 'z-index:0',
  ].join(';');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  // ── Draw one Umbreon onto a given context at origin (0,0) ─────
  // s = base size unit (≈ half the body radius)
  function drawUmbreon(c, s) {
    const body  = '#3a3a90';
    const ring  = '#FFD700';
    const eye   = '#FF3344';
    const hi    = '#ffaaaa';

    // helper: filled ellipse
    function fe(cx, cy, rx, ry, rot) {
      c.beginPath();
      c.ellipse(cx, cy, rx, ry, rot || 0, 0, Math.PI * 2);
      c.fill();
    }
    // helper: stroked ellipse
    function se(cx, cy, rx, ry, rot) {
      c.beginPath();
      c.ellipse(cx, cy, rx, ry, rot || 0, 0, Math.PI * 2);
      c.stroke();
    }

    c.fillStyle   = body;
    c.shadowColor = '#6060c0';
    c.shadowBlur  = s * 0.3;

    // ── Tail (behind body, draw first) ──────────────────────────
    c.beginPath();
    c.ellipse(s * 0.78, s * 0.18, s * 0.22, s * 0.14, -0.5, 0, Math.PI * 2);
    c.fill();

    // ── Body ────────────────────────────────────────────────────
    fe(0, s * 0.28, s * 0.72, s * 0.55);

    // ── Legs (4 rounded pillars) ─────────────────────────────────
    const legTop = s * 0.7;
    const legH   = s * 0.38;
    const legW   = s * 0.2;
    const legR   = s * 0.07;
    [-s * 0.46, -s * 0.18, s * 0.18, s * 0.46].forEach(lx => {
      c.beginPath();
      c.roundRect(lx - legW / 2, legTop, legW, legH, legR);
      c.fill();
    });

    // ── Head ─────────────────────────────────────────────────────
    fe(0, -s * 0.18, s * 0.56, s * 0.5);

    // ── Ears (pointy triangles) ───────────────────────────────────
    [[-1], [1]].forEach(([side]) => {
      const ex = side * s * 0.34;
      c.beginPath();
      c.moveTo(ex - side * s * 0.04, -s * 0.6);
      c.lineTo(ex + side * s * 0.2,  -s * 1.1);
      c.lineTo(ex + side * s * 0.22, -s * 0.56);
      c.closePath();
      c.fill();
    });

    c.shadowBlur = 0;

    // ── Yellow rings ──────────────────────────────────────────────
    c.shadowColor = ring;
    c.shadowBlur  = s * 0.35;
    c.strokeStyle = ring;
    c.lineWidth   = s * 0.09;

    // forehead oval
    se(0, -s * 0.22, s * 0.28, s * 0.13);

    // ear rings
    se(-s * 0.44, -s * 0.82, s * 0.09, s * 0.05,  0.25);
    se( s * 0.44, -s * 0.82, s * 0.09, s * 0.05, -0.25);

    // body band 1
    se(0, s * 0.12, s * 0.42, s * 0.14);
    // body band 2
    se(0, s * 0.42, s * 0.46, s * 0.14);

    // tail ring
    se(s * 0.78, s * 0.18, s * 0.15, s * 0.09, -0.5);

    // paw rings
    c.lineWidth = s * 0.06;
    [-s * 0.46, -s * 0.18, s * 0.18, s * 0.46].forEach(lx => {
      se(lx, legTop + legH * 0.28, s * 0.11, s * 0.05);
    });

    c.shadowBlur = 0;

    // ── Red eyes ─────────────────────────────────────────────────
    c.shadowColor = eye;
    c.shadowBlur  = s * 0.28;
    c.fillStyle   = eye;
    fe(-s * 0.2,  -s * 0.22, s * 0.09, s * 0.08);
    fe( s * 0.2,  -s * 0.22, s * 0.09, s * 0.08);

    c.shadowBlur = 0;

    // eye highlights
    c.fillStyle = hi;
    fe(-s * 0.175, -s * 0.245, s * 0.03, s * 0.025);
    fe( s * 0.225, -s * 0.245, s * 0.03, s * 0.025);
  }

  // ── Pre-render variants to offscreen canvases ─────────────────
  const VARIANTS = [
    { s: 52, alpha: 0.65 },
    { s: 38, alpha: 0.58 },
    { s: 38, alpha: 0.48 },
    { s: 26, alpha: 0.55 },
  ];

  const IMAGES = VARIANTS.map(({ s, alpha }) => {
    const pad = s * 1.2;
    const oc  = document.createElement('canvas');
    oc.width  = s * 2.4 + pad * 2;
    oc.height = s * 2.4 + pad * 2;
    const c   = oc.getContext('2d');
    c.translate(oc.width / 2, oc.height / 2 - s * 0.1);
    drawUmbreon(c, s);
    return { img: oc, w: oc.width, h: oc.height, alpha };
  });

  // ── Umbreon instances ─────────────────────────────────────────
  const COUNT = 6;

  function make(i) {
    const v = IMAGES[i % IMAGES.length];
    return {
      x:     Math.random() * (window.innerWidth  - v.w),
      y:     Math.random() * (window.innerHeight - v.h),
      phase: Math.random() * Math.PI * 2,
      speed: 0.0005 + Math.random() * 0.0004,
      amp:   5 + Math.random() * 5,
      v,
    };
  }

  const umbreons = Array.from({ length: COUNT }, (_, i) => make(i));

  // ── Animation loop ────────────────────────────────────────────
  function loop(ts) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    umbreons.forEach(u => {
      u.phase += u.speed * (ts || 1);
      const dy = Math.sin(u.phase) * u.amp;
      u.x     += Math.sin(u.phase * 0.3) * 0.03;

      ctx.globalAlpha = u.v.alpha;
      ctx.drawImage(u.v.img, Math.round(u.x), Math.round(u.y + dy));
    });

    ctx.globalAlpha = 1;
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();

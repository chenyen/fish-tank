/* 鱼类外观库：前台鱼缸与后台外观预览共用同一套 Canvas 绘制逻辑。 */
(function () {
  'use strict';

  const LOOKS = [
    { key: 'carp', label: '鲤鱼', icon: '🐟', hue: 28, desc: '圆润身体 + 扇尾，最通用的小鱼' },
    { key: 'clown', label: '小丑鱼', icon: '🐠', hue: 22, desc: '橙底白纹，中层穿梭很灵动' },
    { key: 'shark', label: '鲨鱼', icon: '🦈', hue: 205, desc: '尖吻大背鳍，巡游范围广' },
    { key: 'shrimp', label: '小虾', icon: '🦐', hue: 12, desc: '分节身体和长触须，贴底爬行' },
    { key: 'clam', label: '砗磲', icon: '🐚', hue: 186, desc: '落底不动，两片壳慢慢开合' },
    { key: 'goldfish', label: '金鱼', icon: '🐡', hue: 35, desc: '鼓眼睛 + 双纱尾，慢悠悠地摆动' },
    { key: 'koi', label: '锦鲤', icon: '🐟', hue: 8, desc: '白底红斑的宽尾锦鲤，气定神闲' },
    { key: 'guppy', label: '孔雀鱼', icon: '🐠', hue: 168, desc: '小巧身体拖着彩色大尾巴' },
    { key: 'angelfish', label: '神仙鱼', icon: '🐟', hue: 46, desc: '三角侧扁身体，长鳍优雅漂游' },
    { key: 'tetra', label: '灯鱼', icon: '🐟', hue: 190, desc: '细长身形，侧边一条霓虹灯带' },
    { key: 'puffer', label: '河豚', icon: '🐡', hue: 46, desc: '圆鼓鼓的身体，小鳍快速扑腾' },
    { key: 'seahorse', label: '海马', icon: '🐴', hue: 150, desc: '卷曲尾巴，悬停在水中微微起伏' },
  ];
  const LOOK_MAP = Object.fromEntries(LOOKS.map((x) => [x.key, x]));
  const TAU = Math.PI * 2;

  function normalize(look, species) {
    const v = String(look || '').trim().toLowerCase();
    if (LOOK_MAP[v]) return v;
    if (LOOK_MAP[species]) return species;
    return 'carp';
  }

  function labelOf(look) {
    return (LOOK_MAP[normalize(look)] || LOOK_MAP.carp).label;
  }

  function iconOf(look) {
    return (LOOK_MAP[normalize(look)] || LOOK_MAP.carp).icon;
  }

  const hsla = (h, s, l, a) => a == null
    ? `hsl(${(h + 360) % 360}, ${s}%, ${l}%)`
    : `hsla(${(h + 360) % 360}, ${s}%, ${l}%, ${a})`;

  function ellipse(ctx, x, y, rx, ry, rot, fill, stroke, lw) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lw || 1; ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function polygon(ctx, pts, fill, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lw || 1; ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function eye(ctx, x, y, r, ink) {
    ellipse(ctx, x, y, r, r, 0, '#fff', ink, Math.max(0.8, r * 0.28));
    ellipse(ctx, x + r * 0.18, y, r * 0.5, r * 0.5, 0, '#08222e');
    ellipse(ctx, x + r * 0.02, y - r * 0.28, r * 0.16, r * 0.16, 0, 'rgba(255,255,255,.9)');
  }

  /* ------------------------------------------------------------ 原有造型 */

  function drawCarp(ctx, o) {
    const { r, hue, sat, light, ink, inkW, wag } = o;
    const body = hsla(hue, sat, light);
    const finC = hsla(hue, sat, light - 8, 0.85);

    ctx.save();
    ctx.translate(-r * 0.82, 0);
    ctx.rotate(wag);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-r * 0.86, -r * 0.58);
    ctx.quadraticCurveTo(-r * 0.62, 0, -r * 0.86, r * 0.58);
    ctx.closePath();
    ctx.fillStyle = finC;
    ctx.fill();
    ctx.restore();

    polygon(ctx, [[-r * 0.1, -r * 0.42], [r * 0.1, -r * 0.95], [r * 0.42, -r * 0.36]], finC);
    polygon(ctx, [[-r * 0.05, r * 0.34], [r * 0.05, r * 0.72], [r * 0.38, r * 0.3]], finC);

    const bg = ctx.createLinearGradient(0, -r * 0.5, 0, r * 0.5);
    bg.addColorStop(0, hsla(hue, sat + 8, light + 14));
    bg.addColorStop(1, body);
    ellipse(ctx, 0, 0, r * 1.06, r * 0.62, 0, bg, ink, Math.max(1, r * 0.07 * inkW));
    ellipse(ctx, -r * 0.12, -r * 0.16, r * 0.42, r * 0.22, -0.25, 'rgba(255,255,255,.16)');
    eye(ctx, r * 0.6, -r * 0.13, r * 0.15, ink);

    ctx.beginPath();
    ctx.arc(r * 0.95, r * 0.06, r * 0.11, 0.4, 1.55);
    ctx.strokeStyle = 'rgba(10,40,55,.5)';
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.stroke();
  }

  function drawShark(ctx, o) {
    const { r, hue, sat, light, ink, inkW } = o;
    const shue = hue + 205;
    const hs = Math.min(45, sat * 0.55);
    const finC = hsla(shue, hs, light - 16, 0.92);

    ctx.save();
    ctx.translate(-r * 0.9, 0);
    ctx.rotate(Math.sin(hue + r) * 0.05);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-r * 0.5, -r * 1.0, -r * 0.7, -r * 0.22);
    ctx.quadraticCurveTo(-r * 0.42, -r * 0.05, -r * 0.7, r * 0.72);
    ctx.quadraticCurveTo(-r * 0.34, r * 0.4, 0, 0);
    ctx.closePath();
    ctx.fillStyle = finC;
    ctx.fill();
    ctx.restore();

    polygon(ctx, [[-r * 0.22, -r * 0.4], [r * 0.02, -r * 1.28], [r * 0.46, -r * 0.3]], finC);
    ctx.beginPath();
    ctx.moveTo(r * 0.16, r * 0.26);
    ctx.quadraticCurveTo(-r * 0.12, r * 0.95, r * 0.44, r * 0.4);
    ctx.closePath();
    ctx.fillStyle = finC;
    ctx.fill();

    const bg = ctx.createLinearGradient(0, -r * 0.55, 0, r * 0.55);
    bg.addColorStop(0, hsla(shue, hs, light + 10));
    bg.addColorStop(0.55, hsla(shue, hs, light));
    bg.addColorStop(1, hsla(shue, hs, light - 12));
    ctx.beginPath();
    ctx.moveTo(r * 1.32, r * 0.02);
    ctx.quadraticCurveTo(r * 0.55, -r * 0.6, -r * 0.3, -r * 0.5);
    ctx.quadraticCurveTo(-r * 1.02, -r * 0.3, -r * 1.0, 0);
    ctx.quadraticCurveTo(-r * 1.02, r * 0.3, -r * 0.3, r * 0.5);
    ctx.quadraticCurveTo(r * 0.55, r * 0.6, r * 1.32, r * 0.02);
    ctx.closePath();
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.05 * inkW);
    ctx.strokeStyle = ink;
    ctx.stroke();

    ellipse(ctx, r * 0.08, r * 0.26, r * 0.72, r * 0.16, 0, 'rgba(238,248,255,.55)');
    ctx.strokeStyle = 'rgba(8,34,46,.35)';
    ctx.lineWidth = Math.max(1, r * 0.045);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(r * (0.42 - i * 0.13), -r * 0.18);
      ctx.quadraticCurveTo(r * (0.34 - i * 0.13), 0, r * (0.44 - i * 0.13), r * 0.16);
      ctx.stroke();
    }
    eye(ctx, r * 0.74, -r * 0.15, r * 0.1, ink);
    ctx.beginPath();
    ctx.moveTo(r * 1.12, r * 0.16);
    ctx.quadraticCurveTo(r * 0.86, r * 0.3, r * 0.6, r * 0.2);
    ctx.strokeStyle = 'rgba(8,34,46,.45)';
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.stroke();
  }

  function drawClown(ctx, o) {
    const { r, ink, inkW, wag } = o;
    const orange = 'hsl(22, 92%, 60%)';
    const orangeD = 'hsl(16, 88%, 50%)';
    const lw = Math.max(1.2, r * 0.085 * inkW);

    ctx.save();
    ctx.translate(-r * 0.9, 0);
    ctx.rotate(wag);
    ellipse(ctx, -r * 0.26, 0, r * 0.4, r * 0.46, 0, orangeD, ink, lw);
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(-r * 0.3, -r * 0.36);
    ctx.quadraticCurveTo(0, -r * 0.95, r * 0.42, -r * 0.34);
    ctx.closePath();
    ctx.fillStyle = orangeD;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = ink;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-r * 0.22, r * 0.32);
    ctx.quadraticCurveTo(r * 0.02, r * 0.82, r * 0.36, r * 0.3);
    ctx.closePath();
    ctx.fillStyle = orangeD;
    ctx.fill();
    ctx.stroke();

    const bg = ctx.createLinearGradient(0, -r * 0.55, 0, r * 0.55);
    bg.addColorStop(0, 'hsl(28, 96%, 68%)');
    bg.addColorStop(1, orangeD);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.6, 0, 0, TAU);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.clip();
    const bands = [
      { x: r * 0.56, w: r * 0.2, tilt: -0.18 },
      { x: r * 0.02, w: r * 0.27, tilt: 0.05 },
      { x: -r * 0.56, w: r * 0.17, tilt: 0.2 },
    ];
    for (const b of bands) {
      ctx.save();
      ctx.translate(b.x, 0);
      ctx.rotate(b.tilt);
      ctx.fillStyle = 'rgba(255, 252, 245, .97)';
      ctx.fillRect(-b.w / 2, -r * 0.75, b.w, r * 1.5);
      ctx.strokeStyle = 'rgba(18, 26, 34, .55)';
      ctx.lineWidth = Math.max(1, r * 0.04);
      ctx.beginPath();
      ctx.moveTo(-b.w / 2, -r * 0.75);
      ctx.lineTo(-b.w / 2, r * 0.75);
      ctx.moveTo(b.w / 2, -r * 0.75);
      ctx.lineTo(b.w / 2, r * 0.75);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    ellipse(ctx, 0, 0, r, r * 0.6, 0, null, ink, lw);
    eye(ctx, r * 0.64, -r * 0.14, r * 0.16, ink);
    ctx.beginPath();
    ctx.arc(r * 0.92, r * 0.08, r * 0.1, 0.5, 1.5);
    ctx.strokeStyle = 'rgba(40,26,16,.55)';
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.stroke();
  }

  function drawShrimp(ctx, o) {
    const { r, hue, sat, light } = o;
    const c1 = hsla(hue, sat, light + 14);
    const c2 = hsla(hue, sat, light - 4);
    const line = hsla(hue, sat, light, 0.85);

    ctx.save();
    ctx.translate(-r * 1.15, 0);
    for (let i = -1; i <= 1; i++) {
      ellipse(ctx, -r * 0.12, i * r * 0.16, r * 0.3, r * 0.11, i * 0.55, c2);
    }
    ctx.restore();

    for (let i = 0; i < 5; i++) {
      const px = -r * 0.88 + i * r * 0.34;
      const py = Math.sin(i * 0.9) * r * 0.05;
      const rad = r * (0.15 + i * 0.045);
      ellipse(ctx, px, py, rad * 1.1, rad, 0, i % 2 ? c2 : c1);
    }
    ellipse(ctx, r * 0.66, 0, r * 0.4, r * 0.3, 0.08, c1);
    ellipse(ctx, r * 0.84, -r * 0.12, r * 0.09, r * 0.09, 0, '#08222e');

    ctx.beginPath();
    ctx.moveTo(r * 0.92, -r * 0.08);
    ctx.quadraticCurveTo(r * 1.7, -r * 0.66, r * 2.05, -r * 0.2);
    ctx.moveTo(r * 0.92, 0);
    ctx.quadraticCurveTo(r * 1.6, r * 0.24, r * 1.98, r * 0.04);
    ctx.strokeStyle = line;
    ctx.lineWidth = Math.max(0.8, r * 0.055);
    ctx.stroke();

    ctx.strokeStyle = line;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(r * 0.34 - i * r * 0.26, r * 0.2);
      ctx.lineTo(r * 0.3 - i * r * 0.26, r * 0.52);
      ctx.lineWidth = Math.max(0.7, r * 0.045);
      ctx.stroke();
    }
  }

  function drawClam(ctx, o) {
    const { r, hue, sat, light, gape } = o;
    const g = Math.max(0, Math.min(0.85, (gape || 0) * 0.9));
    const shell = hsla(hue, Math.min(48, sat), light);
    const shellD = hsla(hue, Math.min(48, sat), light - 16);
    const lip = hsla(hue + 320, 55, 72, 0.9);

    ellipse(ctx, 0, r * 0.28, r, r * 0.46, 0, shellD);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.16, r * 0.76, r * 0.22, 0, 0, Math.PI);
    ctx.fillStyle = lip;
    ctx.fill();

    ctx.save();
    ctx.translate(-r * 0.92, r * 0.1);
    ctx.rotate(-g);
    ctx.translate(r * 0.92, -r * 0.1);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.06, r, r * 0.58, 0, Math.PI, 0);
    ctx.fillStyle = shell;
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.06, r, r * 0.58, 0, Math.PI, 0);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,.13)';
    ctx.lineWidth = Math.max(1, r * 0.045);
    for (let i = -4; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.05);
      ctx.lineTo(i * r * 0.24, -r * 0.68);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  /* ------------------------------------------------------------ 新增造型 */

  function drawGoldfish(ctx, o) {
    const { r, hue, sat, light, ink, inkW, wag } = o;
    const c = hsla(hue, Math.min(96, sat + 20), Math.min(78, light + 6));
    const cd = hsla(hue - 8, Math.min(96, sat + 18), light - 4);

    // 双纱尾
    ctx.save();
    ctx.translate(-r * 0.88, 0);
    ctx.rotate(wag);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-r * 0.75, -r * 1.15, -r * 1.05, -r * 0.28);
    ctx.quadraticCurveTo(-r * 1.5, 0, -r * 1.05, r * 0.28);
    ctx.quadraticCurveTo(-r * 0.75, r * 1.15, 0, 0);
    ctx.closePath();
    ctx.fillStyle = hsla(hue, sat, light + 8, 0.72);
    ctx.fill();
    ctx.strokeStyle = hsla(hue, sat, light - 12, 0.5);
    ctx.lineWidth = Math.max(1, r * 0.045);
    ctx.stroke();
    ctx.restore();

    // 背鳍
    ctx.beginPath();
    ctx.moveTo(-r * 0.36, -r * 0.36);
    ctx.quadraticCurveTo(-r * 0.12, -r * 1.18, r * 0.44, -r * 0.28);
    ctx.closePath();
    ctx.fillStyle = hsla(hue, sat, light + 2, 0.82);
    ctx.fill();

    const bg = ctx.createLinearGradient(0, -r * 0.55, 0, r * 0.55);
    bg.addColorStop(0, c);
    bg.addColorStop(1, cd);
    ellipse(ctx, 0, 0, r * 0.98, r * 0.72, 0, bg, ink, Math.max(1, r * 0.06 * inkW));
    ellipse(ctx, -r * 0.12, -r * 0.2, r * 0.44, r * 0.22, -0.25, 'rgba(255,255,255,.24)');
    // 鼓眼睛
    eye(ctx, r * 0.62, -r * 0.2, r * 0.19, ink);
    eye(ctx, r * 0.3, -r * 0.3, r * 0.12, ink);
    ctx.beginPath();
    ctx.arc(r * 0.94, r * 0.06, r * 0.09, 0.2, 1.7);
    ctx.strokeStyle = 'rgba(80,36,10,.55)';
    ctx.lineWidth = Math.max(1, r * 0.045);
    ctx.stroke();
  }

  function drawKoi(ctx, o) {
    const { r, hue, sat, light, ink, inkW, wag } = o;
    const fin = hsla(hue + 20, 35, light + 12, 0.7);
    const patch = hsla(hue, Math.min(92, sat + 24), light - 2);

    ctx.save();
    ctx.translate(-r * 0.86, 0);
    ctx.rotate(wag);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-r * 0.7, -r * 0.9, -r * 1.0, -r * 0.4);
    ctx.quadraticCurveTo(-r * 0.62, 0, -r * 1.0, r * 0.4);
    ctx.quadraticCurveTo(-r * 0.7, r * 0.9, 0, 0);
    ctx.closePath();
    ctx.fillStyle = fin;
    ctx.fill();
    ctx.restore();

    polygon(ctx, [[-r * 0.2, -r * 0.38], [r * 0.1, -r * 0.92], [r * 0.4, -r * 0.3]], fin);
    const bg = ctx.createLinearGradient(0, -r * 0.5, 0, r * 0.5);
    bg.addColorStop(0, '#fffdf8');
    bg.addColorStop(1, hsla(hue, 20, 86));
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.1, r * 0.64, 0, 0, TAU);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.clip();
    ellipse(ctx, -r * 0.42, -r * 0.2, r * 0.34, r * 0.26, -0.3, patch);
    ellipse(ctx, r * 0.2, r * 0.16, r * 0.3, r * 0.2, 0.25, patch);
    ellipse(ctx, r * 0.56, -r * 0.26, r * 0.2, r * 0.14, -0.2, patch);
    ctx.restore();
    ellipse(ctx, 0, 0, r * 1.1, r * 0.64, 0, null, ink, Math.max(1, r * 0.055 * inkW));
    ellipse(ctx, -r * 0.12, -r * 0.2, r * 0.42, r * 0.18, -0.2, 'rgba(255,255,255,.3)');
    eye(ctx, r * 0.66, -r * 0.12, r * 0.13, ink);
    ctx.beginPath();
    ctx.arc(r * 0.98, r * 0.08, r * 0.1, 0.3, 1.5);
    ctx.strokeStyle = 'rgba(90,42,32,.45)';
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.stroke();
  }

  function drawGuppy(ctx, o) {
    const { r, hue, sat, light, ink, inkW, wag } = o;
    const body = hsla(hue, Math.min(90, sat + 10), light + 8);
    const tail1 = hsla(hue + 55, 82, light + 6, 0.82);
    const tail2 = hsla(hue - 35, 86, light, 0.78);

    ctx.save();
    ctx.translate(-r * 0.78, 0);
    ctx.rotate(wag * 1.5);
    const grad = ctx.createLinearGradient(-r * 1.35, 0, 0, 0);
    grad.addColorStop(0, tail1);
    grad.addColorStop(1, tail2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-r * 0.55, -r * 1.25, -r * 1.35, -r * 0.86);
    ctx.quadraticCurveTo(-r * 1.05, 0, -r * 1.35, r * 0.86);
    ctx.quadraticCurveTo(-r * 0.55, r * 1.25, 0, 0);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    for (let i = 0; i < 6; i++) {
      const a = -0.8 + i * 0.32;
      ellipse(ctx, -r * (0.8 + 0.24 * Math.abs(a)), Math.sin(a) * r * 0.5, r * 0.09, r * 0.09, 0,
        hsla(hue + i * 30, 80, 82, 0.65));
    }
    ctx.restore();

    polygon(ctx, [[-r * 0.16, -r * 0.3], [r * 0.12, -r * 0.7], [r * 0.36, -r * 0.24]],
      hsla(hue + 40, 70, light + 4, 0.8));
    const bg = ctx.createLinearGradient(0, -r * 0.4, 0, r * 0.4);
    bg.addColorStop(0, body);
    bg.addColorStop(1, hsla(hue, sat, light - 6));
    ellipse(ctx, 0, 0, r * 0.86, r * 0.42, 0, bg, ink, Math.max(1, r * 0.055 * inkW));
    ellipse(ctx, r * 0.1, 0, r * 0.62, r * 0.1, 0, hsla(hue + 90, 88, 66, 0.6));
    eye(ctx, r * 0.56, -r * 0.08, r * 0.13, ink);
  }

  function drawAngelfish(ctx, o) {
    const { r, hue, sat, light, ink, inkW, wag } = o;
    const body = hsla(hue, Math.min(90, sat + 18), light + 4);
    const dark = hsla(hue - 12, sat, light - 12);

    // 长背鳍 / 臀鳍
    ctx.save();
    ctx.translate(-r * 0.08, 0);
    ctx.rotate(wag * 0.4);
    ctx.beginPath();
    ctx.moveTo(-r * 0.24, -r * 0.62);
    ctx.quadraticCurveTo(-r * 0.9, -r * 1.48, r * 0.42, -r * 1.12);
    ctx.quadraticCurveTo(r * 0.12, -r * 0.86, r * 0.24, -r * 0.4);
    ctx.closePath();
    ctx.fillStyle = hsla(hue, sat, light + 8, 0.72);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, r * 0.58);
    ctx.quadraticCurveTo(-r * 0.8, r * 1.3, r * 0.4, r * 1.0);
    ctx.quadraticCurveTo(r * 0.08, r * 0.8, r * 0.22, r * 0.38);
    ctx.closePath();
    ctx.fillStyle = hsla(hue, sat, light - 2, 0.7);
    ctx.fill();
    ctx.restore();

    // 尾鳍
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, 0);
    ctx.quadraticCurveTo(-r * 1.15, -r * 0.5, -r * 1.05, 0);
    ctx.quadraticCurveTo(-r * 1.15, r * 0.5, -r * 0.6, 0);
    ctx.fillStyle = hsla(hue, sat, light + 2, 0.8);
    ctx.fill();

    // 侧扁三角形身体
    ctx.beginPath();
    ctx.moveTo(r * 0.86, 0);
    ctx.quadraticCurveTo(r * 0.4, -r * 0.92, -r * 0.5, -r * 0.72);
    ctx.quadraticCurveTo(-r * 0.82, 0, -r * 0.5, r * 0.72);
    ctx.quadraticCurveTo(r * 0.4, r * 0.92, r * 0.86, 0);
    ctx.closePath();
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.06 * inkW);
    ctx.strokeStyle = ink;
    ctx.stroke();

    ctx.save();
    ctx.clip();
    ctx.strokeStyle = dark;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1.5, r * 0.11);
    for (const x of [-0.34, 0.06, 0.44]) {
      ctx.beginPath();
      ctx.moveTo(r * x, -r * 0.95);
      ctx.quadraticCurveTo(r * (x + 0.12), 0, r * x, r * 0.95);
      ctx.stroke();
    }
    ctx.restore();
    eye(ctx, r * 0.58, -r * 0.14, r * 0.12, ink);
  }

  function drawTetra(ctx, o) {
    const { r, hue, sat, light, ink, inkW, wag } = o;
    const body = hsla(hue, Math.min(60, sat), light + 6);

    ctx.save();
    ctx.translate(-r * 0.9, 0);
    ctx.rotate(wag);
    polygon(ctx, [[0, 0], [-r * 0.55, -r * 0.48], [-r * 0.36, 0], [-r * 0.55, r * 0.48]],
      hsla(hue, sat, light, 0.75));
    ctx.restore();

    polygon(ctx, [[-r * 0.2, -r * 0.3], [r * 0.02, -r * 0.68], [r * 0.3, -r * 0.24]],
      hsla(hue + 40, 60, light, 0.8));

    const bg = ctx.createLinearGradient(0, -r * 0.35, 0, r * 0.35);
    bg.addColorStop(0, body);
    bg.addColorStop(1, hsla(hue, sat, light - 10));
    ellipse(ctx, 0, 0, r * 1.02, r * 0.38, 0, bg, ink, Math.max(1, r * 0.05 * inkW));

    ctx.beginPath();
    ctx.moveTo(-r * 0.72, r * 0.02);
    ctx.quadraticCurveTo(0, r * 0.14, r * 0.68, r * 0.02);
    ctx.strokeStyle = 'rgba(90,238,255,.95)';
    ctx.lineWidth = Math.max(1.5, r * 0.11);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.62, r * 0.14);
    ctx.lineTo(r * 0.05, r * 0.18);
    ctx.strokeStyle = 'rgba(255,92,86,.92)';
    ctx.lineWidth = Math.max(1.2, r * 0.08);
    ctx.stroke();
    eye(ctx, r * 0.66, -r * 0.08, r * 0.11, ink);
  }

  function drawPuffer(ctx, o) {
    const { r, hue, sat, light, ink, inkW, wag } = o;
    const body = hsla(hue, Math.min(88, sat + 16), light + 8);
    const radius = r * 0.78;

    // 小圆鳍
    ctx.save();
    ctx.translate(-r * 0.78, 0);
    ctx.rotate(wag);
    ellipse(ctx, -r * 0.12, 0, r * 0.22, r * 0.3, 0, hsla(hue, sat, light, 0.8));
    ctx.restore();
    ellipse(ctx, r * 0.06, -r * 0.68, r * 0.2, r * 0.12, -0.3, hsla(hue, sat, light, 0.75));
    ellipse(ctx, r * 0.06, r * 0.68, r * 0.2, r * 0.12, 0.3, hsla(hue, sat, light, 0.75));

    // 刺
    const bg = ctx.createRadialGradient(-r * 0.18, -r * 0.22, r * 0.1, 0, 0, radius);
    bg.addColorStop(0, hsla(hue, sat, light + 18));
    bg.addColorStop(1, body);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const x = Math.cos(a) * radius;
      const y = Math.sin(a) * radius * 0.92;
      polygon(ctx, [
        [x * 0.86 - Math.sin(a) * r * 0.1, y * 0.86 + Math.cos(a) * r * 0.1],
        [x * 1.22, y * 1.22],
        [x * 0.86 + Math.sin(a) * r * 0.1, y * 0.86 - Math.cos(a) * r * 0.1],
      ], hsla(hue, sat, light - 6));
    }
    ellipse(ctx, 0, 0, radius, radius * 0.92, 0, bg, ink, Math.max(1, r * 0.06 * inkW));
    ellipse(ctx, -r * 0.16, -r * 0.3, r * 0.3, r * 0.16, -0.3, 'rgba(255,255,255,.28)');
    eye(ctx, r * 0.36, -r * 0.2, r * 0.17, ink);
    // 小嘴
    ellipse(ctx, r * 0.7, r * 0.1, r * 0.1, r * 0.08, 0, hsla(hue - 20, 70, 44));
  }

  function drawSeahorse(ctx, o) {
    const { r, hue, sat, light, ink, inkW, phase } = o;
    const body = hsla(hue, Math.min(88, sat + 14), light + 6);
    const dark = hsla(hue, sat, light - 12);
    const sway = Math.sin(phase || 0) * r * 0.05;

    // 卷曲尾巴
    ctx.beginPath();
    ctx.moveTo(-r * 0.12, r * 0.3);
    ctx.bezierCurveTo(-r * 0.75, r * 0.5, -r * 0.72, r * 1.15, -r * 0.18, r * 1.02);
    ctx.bezierCurveTo(r * 0.22, r * 0.94, r * 0.06, r * 0.6, -r * 0.2, r * 0.72);
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(2, r * 0.2);
    ctx.lineCap = 'round';
    ctx.stroke();

    // 头颈与身体
    ctx.save();
    ctx.translate(sway, 0);
    const bg = ctx.createLinearGradient(-r * 0.4, 0, r * 0.4, 0);
    bg.addColorStop(0, dark);
    bg.addColorStop(1, body);
    ctx.beginPath();
    ctx.moveTo(-r * 0.22, r * 0.5);
    ctx.quadraticCurveTo(-r * 0.58, -r * 0.05, -r * 0.28, -r * 0.62);
    ctx.quadraticCurveTo(0, -r * 0.98, r * 0.28, -r * 0.78);
    ctx.quadraticCurveTo(r * 0.5, -r * 0.56, r * 0.24, -r * 0.36);
    ctx.quadraticCurveTo(r * 0.08, -r * 0.18, r * 0.3, r * 0.18);
    ctx.quadraticCurveTo(r * 0.4, r * 0.48, r * 0.1, r * 0.58);
    ctx.closePath();
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.05 * inkW);
    ctx.strokeStyle = ink;
    ctx.stroke();

    // 吻管
    ctx.beginPath();
    ctx.moveTo(r * 0.2, -r * 0.7);
    ctx.quadraticCurveTo(r * 0.85, -r * 0.78, r * 0.95, -r * 0.5);
    ctx.quadraticCurveTo(r * 0.6, -r * 0.48, r * 0.24, -r * 0.55);
    ctx.closePath();
    ctx.fillStyle = dark;
    ctx.fill();

    // 背鳍
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, -r * 0.12);
    ctx.quadraticCurveTo(-r * 0.95, -r * 0.28, -r * 0.5, r * 0.16);
    ctx.fillStyle = hsla(hue + 40, 75, light + 10, 0.72);
    ctx.fill();

    eye(ctx, r * 0.1, -r * 0.72, r * 0.13, ink);
    // 冠刺
    for (let i = -1; i <= 1; i++) {
      polygon(ctx, [
        [r * (0.02 + i * 0.14), -r * 0.86],
        [r * (0.06 + i * 0.16), -r * 1.18],
        [r * (0.14 + i * 0.14), -r * 0.82],
      ], dark);
    }
    ctx.restore();
  }

  const DRAWERS = {
    carp: drawCarp, clown: drawClown, shark: drawShark, shrimp: drawShrimp, clam: drawClam,
    goldfish: drawGoldfish, koi: drawKoi, guppy: drawGuppy, angelfish: drawAngelfish,
    tetra: drawTetra, puffer: drawPuffer, seahorse: drawSeahorse,
  };

  function draw(ctx, opts) {
    const o = Object.assign({
      look: 'carp', r: 24, hue: 28, sat: 62, light: 62,
      ink: 'rgba(18,44,58,.35)', inkW: 1, wag: 0, gape: 0.3, phase: 0,
    }, opts || {});
    o.look = normalize(o.look);
    const fn = DRAWERS[o.look] || drawCarp;
    ctx.save();
    fn(ctx, o);
    ctx.restore();
  }

  window.FishArt = { LOOKS, draw, normalize, labelOf, iconOf };
})();

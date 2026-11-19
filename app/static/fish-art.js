/* 鱼类外观库：前台鱼缸与后台外观预览共用同一套 Canvas 绘制逻辑。 */
(function () {
  'use strict';

  const LOOKS = [
    { key: 'carp', label: '鲤鱼', icon: '🐟', hue: 28, cat: '淡水鱼', desc: '圆润身体 + 扇尾，最通用的小鱼' },
    { key: 'clown', label: '小丑鱼', icon: '🐠', hue: 22, cat: '海水鱼', desc: '橙底白纹，中层穿梭很灵动' },
    { key: 'shark', label: '鲨鱼', icon: '🦈', hue: 205, cat: '海水鱼', desc: '尖吻大背鳍，巡游范围广' },
    { key: 'clam', label: '砗磲', icon: '🐚', hue: 186, cat: '特色生物', desc: '落底不动，两片壳慢慢开合' },
    { key: 'goldfish', label: '金鱼', icon: '🐡', hue: 35, cat: '淡水鱼', desc: '鼓眼睛 + 双纱尾，慢悠悠地摆动' },
    { key: 'koi', label: '锦鲤', icon: '🐟', hue: 8, cat: '淡水鱼', desc: '白底红斑的宽尾锦鲤，气定神闲' },
    { key: 'guppy', label: '孔雀鱼', icon: '🐠', hue: 168, cat: '淡水鱼', desc: '小巧身体拖着彩色大尾巴' },
    { key: 'angelfish', label: '神仙鱼', icon: '🐟', hue: 46, cat: '淡水鱼', desc: '三角侧扁身体，长鳍优雅漂游' },
    { key: 'tetra', label: '灯鱼', icon: '🐟', hue: 190, cat: '淡水鱼', desc: '细长身形，侧边一条霓虹灯带' },
    { key: 'puffer', label: '河豚', icon: '🐡', hue: 46, cat: '海水鱼', desc: '圆鼓鼓的身体，小鳍快速扑腾' },
    { key: 'seahorse', label: '海马', icon: '🐴', hue: 150, cat: '特色生物', desc: '卷曲尾巴，悬停在水中微微起伏' },
  ];
  const LOOK_MAP = Object.fromEntries(LOOKS.map((x) => [x.key, x]));

  /* ------------------------------------------------ 图片素材（优先于手绘）
     已换成图片的鱼种列在 IMG_KEYS；缺图 / 图未加载好时自动回退原手绘，
     保证素材缺失也不会让鱼消失。 */
  const IMG_DIR = '/static/fish/';
  const IMG_V = 18; // 素材变更后自增，避免浏览器缓存旧的拆分图
  const IMG_Q = '?v=' + IMG_V;
  // 每种鱼：body 整块鱼身 + tail 独立尾鳍（绕 joint 旋转摆尾），joint 为尾柄轴心在源图的像素坐标
  // fins：可独立摆动的鳍，box 为裁剪图层在原图的包围盒，pivot 为旋转轴（原图像素坐标），
  //       amp 为摆幅（弧度），offset 为相位偏移，让各鳍节奏错开更自然
  const FISH_IMG = {
    // warp：整图竖条行波形变，不拆片、无切缝；鲨鱼用，保留精致画面又能全身摆动
    shark: { body: 'shark.png', warp: { bands: 26, amp: 0.085, freq: 2.0 } },
    // carp：整图行波形变摆尾。鲤鱼身体白+描边，拆片过渡会露背景，故用 warp 无接缝方案
    carp: { body: 'carp.png', warp: { bands: 26, amp: 0.075, freq: 1.9, tailBoost: 2.2 } },
    // goldfish：圆胖身+双纱尾，行波小幅慢频，圆身不宜大幅扭动
    goldfish: { body: 'goldfish.png', warp: { bands: 26, amp: 0.055, freq: 1.5, tailBoost: 2.0 } },
    // koi：细长流线身，行波尾部幅度大，气定神闲摆宽尾
    koi: { body: 'koi.png', warp: { bands: 26, amp: 0.07, freq: 1.8, tailBoost: 2.2 } },
    // guppy：小身+大扇尾，尾部大幅摆动带动整片彩虹尾
    guppy: { body: 'guppy.png', warp: { bands: 26, amp: 0.09, freq: 2.0, tailBoost: 2.4 } },
    // tetra：细长灵动小鱼，中幅高频摆尾
    tetra: { body: 'tetra.png', warp: { bands: 26, amp: 0.075, freq: 2.2, tailBoost: 1.8 } },
    // puffer：圆球身体不适合行波（会把圆球扭变形），用 still 悬浮起伏；puff=true 时低频「红温变大」
    puffer: { body: 'puffer.png', still: { bobAmp: 0.035, swayAmp: 0.05, freq: 1.1, puff: true } },
    // angelfish：侧扁三角+长鳍飘带， warp 行波让飘带自然波动，尾侧摆幅大
    angelfish: { body: 'angelfish.png', warp: { bands: 26, amp: 0.06, freq: 1.7, tailBoost: 1.9 } },
    clown: {
      body: 'clown_body.png', tail: 'clown_tail.png', joint: [135, 165],
      fins: [
        { src: 'clown_dorsal_rear.png', box: [132, 51, 258, 133], pivot: [190, 118], amp: 0.10, offset: 2.2 },
        { src: 'clown_dorsal_front.png', box: [266, 6, 415, 73], pivot: [340, 70], amp: 0.08, offset: 1.6 },
        { src: 'clown_pect.png', box: [280, 156, 393, 251], pivot: [340, 168], amp: 0.22, offset: 0.8 },
      ],
    },
    // seahorse：拆三层独立形变——尾巴纵向拉伸做「直/卷」、吻管横向伸缩做「长/短」、低频吐泡泡
    seahorse: {
      body: 'seahorse.png', anim: true,
      layers: { top: 'horse_top.png', tail: 'horse_tail.png', snout: 'horse_snout.png' },
    },
  };
  const IMG_KEYS = new Set(Object.keys(FISH_IMG));
  const imgCache = new Map();

  function loadImg(src, done) {
    const rec = { img: new Image(), ready: false, cbs: [] };
    const fire = () => { rec.cbs.splice(0).forEach((fn) => fn()); };
    rec.img.onload = () => { rec.ready = true; if (done) done(); fire(); };
    rec.img.onerror = () => { rec.ready = false; fire(); }; // 失败也放行，避免等待方卡死
    rec.img.src = IMG_DIR + src + IMG_Q;
    return rec;
  }

  function fishParts(key) {
    let rec = imgCache.get(key);
    if (rec) return rec;
    const spec = FISH_IMG[key];
    const layerImgs = spec.layers ? Object.fromEntries(
      Object.entries(spec.layers).map(([k, src]) => [k, loadImg(src)])
    ) : null;
    rec = {
      body: loadImg(spec.body),
      tail: spec.tail ? loadImg(spec.tail) : null,
      joint: spec.joint,
      tailAmp: spec.tailAmp,
      warp: spec.warp || null,
      still: !!spec.still,
      stillCfg: spec.still || null,
      anim: !!spec.anim,
      layers: layerImgs,
      fins: (spec.fins || []).map((f) => Object.assign({}, f, { img: loadImg(f.src) })),
    };
    imgCache.set(key, rec);
    return rec;
  }

  // 图片素材异步加载：等给定造型的全部素材就绪后回调，供静态预览（后台外观库）重画。
  // 非图片造型会被忽略；若全部已就绪则同步回调。
  function whenReady(keys, cb) {
    const list = (Array.isArray(keys) ? keys : [keys]).filter((k) => FISH_IMG[k]);
    if (!list.length) { if (cb) cb(); return; }
    const recs = [];
    list.forEach((k) => {
      const p = fishParts(k);
      const layerRecs = p.layers ? Object.values(p.layers) : [];
      [p.body, p.tail].concat(layerRecs).concat(p.fins.map((f) => f.img)).forEach((r) => {
        if (r && recs.indexOf(r) < 0) recs.push(r);
      });
    });
    let left = recs.filter((r) => !r.ready).length;
    if (!left) { if (cb) cb(); return; }
    const check = () => { if (--left <= 0 && cb) cb(); };
    recs.forEach((r) => { if (!r.ready) r.cbs.push(check); });
  }

  // 整图行波形变：把图片切成竖条，每条按正弦波上下错位。u=0 尾部、u=1 头部，
  // 尾部位移最大、头部最小，形成从前往后传播的行波，像真鱼游动，且无切片裂缝。
  function drawWarpFish(ctx, o, img, cfg) {
    const bands = cfg.bands || 44;
    const amp = cfg.amp == null ? 0.08 : cfg.amp;
    const freq = cfg.freq || 2;
    const h = o.r * 2.15;
    const w = h * img.naturalWidth / img.naturalHeight;
    const phase = o.phase || 0;
    const x0 = -w / 2, y0 = -h / 2;
    const sw = img.naturalWidth / bands;   // 每条源宽
    const dw = w / bands;                  // 每条目标宽
    // 叠加时相邻条留 0.6px 重叠，避免缩放取整产生的竖缝
    const dwDraw = dw + 0.6, swDraw = sw + 0.6;

    ctx.save();
    if (o.sat < 45) {
      try {
        const k = Math.max(0.2, o.sat / 62);
        ctx.filter = `saturate(${k.toFixed(2)})`;
      } catch (_) {}
    }
    const tailBoost = cfg.tailBoost || 1;
    for (let i = 0; i < bands; i++) {
      const u = i / (bands - 1);                       // 0 尾 -> 1 头
      const weight = Math.pow(1 - u, 1.5 * tailBoost); // 尾部幅度大，头部趋近 0
      const dy = Math.sin(phase - u * freq) * h * amp * weight;
      ctx.drawImage(
        img,
        i * sw, 0, Math.min(swDraw, img.naturalWidth - i * sw), img.naturalHeight,
        x0 + i * dw, y0 + dy, dwDraw, h
      );
    }
    ctx.restore();
  }

  // still 模式：整图静态绘制，只随水流轻微起伏，不拆片不摆尾
  // cfg 可选 {bobAmp, swayAmp, freq}：河豚用更明显的悬浮起伏，区别于海马的静止感
  function drawStillFish(ctx, o, img, cfg) {
    const h = o.r * 2.15;
    const w = h * img.naturalWidth / img.naturalHeight;
    const phase = o.phase || 0;
    const isHorse = o.look === 'seahorse';
    const freq = (cfg && cfg.freq) || (isHorse ? 0.8 : 0.5);
    const bobAmp = (cfg && cfg.bobAmp) || (isHorse ? 0.02 : 0.008);
    const swayAmp = (cfg && cfg.swayAmp) || (isHorse ? 0.03 : 0.01);
    const bob = Math.sin(phase * freq) * h * bobAmp;
    const sway = Math.sin(phase * freq * 0.75) * swayAmp;
    ctx.save();
    if (o.sat < 45) {
      try { ctx.filter = `saturate(${Math.max(0.2, o.sat / 62).toFixed(2)})`; } catch (_) {}
    }
    ctx.translate(0, bob);
    ctx.rotate(sway);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  // 河豚「红温变大」：低频随机充气——身体涨大、金黄体色转橙红。
  // 用 id + 绝对时间维护跨帧状态；后台静态预览无 id/time，保持常态不触发。
  const puffState = new Map(); // id -> {next, start}
  const PUFF_DUR = 2.2;        // 单次红温时长（秒）
  function drawPufferFish(ctx, o, img, cfg) {
    const h = o.r * 2.15;
    const w = h * img.naturalWidth / img.naturalHeight;
    const phase = o.phase || 0;
    const freq = (cfg && cfg.freq) || 1.1;
    const bobAmp = (cfg && cfg.bobAmp) || 0.035;
    const swayAmp = (cfg && cfg.swayAmp) || 0.05;
    const bob = Math.sin(phase * freq) * h * bobAmp;
    const sway = Math.sin(phase * freq * 0.75) * swayAmp;

    let heat = 0; // 0 常态 -> 1 最红最鼓
    if (o.id != null && typeof o.time === 'number') {
      let st = puffState.get(o.id);
      if (!st) { st = { next: o.time + 8 + Math.random() * 16, start: -1 }; puffState.set(o.id, st); }
      if (o.time >= st.next) { st.start = o.time; st.next = o.time + PUFF_DUR + 12 + Math.random() * 14; }
      if (st.start >= 0) {
        const u = (o.time - st.start) / PUFF_DUR;
        if (u >= 1) st.start = -1;
        else heat = Math.pow(Math.sin(u * Math.PI), 0.85); // 迅速冲红、缓慢消退
      }
    }

    ctx.save();
    let filters = [];
    if (o.sat < 45) filters.push(`saturate(${Math.max(0.2, o.sat / 62).toFixed(2)})`);
    ctx.translate(0, bob);
    ctx.rotate(sway);
    const scale = 1 + heat * 0.22; // 充气涨大最多 22%
    ctx.scale(scale, scale);
    if (heat > 0.02) {
      // 金黄体色(高饱和)转橙红；白肚/高光(低饱和)几乎不变，保留自然质感
      filters.push(`hue-rotate(${(-44 * heat).toFixed(1)}deg)`);
      filters.push(`saturate(${(1 + 0.8 * heat).toFixed(2)})`);
    }
    if (filters.length) { try { ctx.filter = filters.join(' '); } catch (_) {} }
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /* 海马：三层独立形变。
     素材切分（源图 300x400）：top=头部+上半身(y<212,吻管区挖空)、
     tail=下半身+卷尾(y>=208)、snout=吻管(x>=204,y 102..160)。
     - 尾巴「直/卷」：以接缝 y=208 为锚纵向拉伸，卷紧->拉直循环，并轻微摆动。
     - 嘴巴「长/短」：以根部 x=204 为锚横向伸缩。
     - 吐泡泡：低频随机，从嘴尖冒出向上飘散。 */
  const SEAM_Y = 208;    // 尾/身接缝源图 y
  const SNOUT_X = 204;   // 吻管根部源图 x
  const TIP_X = 250;     // 吻管尖端源图 x
  const TIP_Y = 130;     // 吻管尖端源图 y
  const bubbleState = new Map(); // id -> {next, bubbles:[]}

  function drawSeahorseAnim(ctx, o, parts) {
    const L = parts.layers;
    if (!L || ['top', 'tail', 'snout'].some((k) => !L[k] || !L[k].ready)) {
      drawStillFish(ctx, o, parts.body.img); // 某层没加载好，整图兜底
      return;
    }
    const img = parts.body.img;
    const iw = img.naturalWidth, ih = img.naturalHeight; // 300 x 400
    const h = o.r * 2.15;
    const w = h * iw / ih;
    const kw = w / iw, kh = h / ih;
    const x0 = -w / 2, y0 = -h / 2;
    const phase = o.phase || 0;

    // 整体随水流轻微起伏（三层共用同一变换，接缝始终对齐）
    const bob = Math.sin(phase * 0.8) * h * 0.018;
    const sway = Math.sin(phase * 0.6) * 0.028;

    // 直/卷：curl 0(卷紧) .. 1(拉直)
    const curl = 0.5 + 0.5 * Math.sin(phase * 0.6 - 0.8);
    const tailSY = 1 + curl * 0.24;          // 纵向拉长，螺旋被拉开
    const tailSX = 1 - curl * 0.05;          // 略收窄
    const tailRot = Math.sin(phase * 1.15) * 0.05;
    // 嘴巴长/短
    const extend = 0.5 + 0.5 * Math.sin(phase * 0.85 + 1.1);
    const snoutSX = 0.74 + extend * 0.5;     // 0.74 .. 1.24

    ctx.save();
    if (o.sat < 45) {
      try { ctx.filter = `saturate(${Math.max(0.2, o.sat / 62).toFixed(2)})`; } catch (_) {}
    }
    ctx.translate(0, bob);
    ctx.rotate(sway);

    // 1) 上半身（头部）
    ctx.drawImage(L.top.img, x0, y0, w, h);

    // 2) 尾巴：以接缝为锚纵向拉伸 + 尾根处轻微摆动
    const seamScreenY = y0 + SEAM_Y * kh;
    const rootX = x0 + 150 * kw, rootY = y0 + 250 * kh;
    ctx.save();
    ctx.translate(rootX, rootY);
    ctx.rotate(tailRot);
    ctx.translate(-rootX, -rootY);
    ctx.translate(0, seamScreenY);
    ctx.scale(tailSX, tailSY);
    ctx.translate(0, -seamScreenY);
    ctx.drawImage(L.tail.img, x0, y0, w, h);
    ctx.restore();

    // 3) 吻管：以根部为锚横向伸缩
    const snoutAnchorX = x0 + SNOUT_X * kw;
    ctx.save();
    ctx.translate(snoutAnchorX, 0);
    ctx.scale(snoutSX, 1);
    ctx.translate(-snoutAnchorX, 0);
    ctx.drawImage(L.snout.img, x0, y0, w, h);
    ctx.restore();

    // 4) 吐泡泡（仅前台有 id/绝对时间时；后台静态预览不吐）
    if (o.id != null && typeof o.time === 'number') {
      const tipX = x0 + (SNOUT_X + (TIP_X - SNOUT_X) * snoutSX) * kw;
      const tipY = y0 + TIP_Y * kh;
      drawBubbles(ctx, o.id, o.time, tipX, tipY, r0(h));
    }
    ctx.restore();
  }

  // 吐泡泡用的气泡半径基准（随鱼大小）
  function r0(h) { return Math.max(1.5, h * 0.03); }

  function drawBubbles(ctx, id, now, tipX, tipY, base) {
    let st = bubbleState.get(id);
    if (!st) { st = { next: now + 2 + Math.random() * 4, bubbles: [] }; bubbleState.set(id, st); }
    // 低频：平均十几秒吐一次，一次 1~3 颗
    if (now >= st.next) {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        st.bubbles.push({
          born: now + i * 0.16,
          life: 1.8 + Math.random() * 1.4,
          r: base * (0.5 + Math.random() * 0.7),
          drift: (Math.random() - 0.5) * base * 2.2,
          rise: base * (1.6 + Math.random() * 1.2),
        });
      }
      st.next = now + 8 + Math.random() * 10;
    }
    if (st.bubbles.length) {
      ctx.save();
      st.bubbles = st.bubbles.filter((b) => now - b.born < b.life);
      for (const b of st.bubbles) {
        const age = now - b.born;
        if (age < 0) continue;
        const k = age / b.life;
        const bx = tipX + b.drift * k;
        const by = tipY - b.rise * age - base * 1.5;
        const rr = b.r * (1 + k * 0.35);
        ctx.globalAlpha = 0.75 * (1 - k) * Math.min(1, k * 6 + 0.2);
        ctx.beginPath();
        ctx.arc(bx, by, rr, 0, TAU);
        ctx.fillStyle = 'rgba(230,248,255,.55)';
        ctx.fill();
        ctx.lineWidth = Math.max(0.8, base * 0.28);
        ctx.strokeStyle = 'rgba(255,255,255,.9)';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(bx - rr * 0.3, by - rr * 0.32, Math.max(0.5, rr * 0.25), 0, TAU);
        ctx.fillStyle = 'rgba(255,255,255,.95)';
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawImageFish(ctx, o) {
    const parts = fishParts(o.look);
    if (!parts.body.ready) return false; // 未加载好，回退手绘
    // warp 模式：整图按竖条行波形变，尾巴摆幅大、头部几乎不动，无切缝
    if (parts.warp) {
      drawWarpFish(ctx, o, parts.body.img, parts.warp);
      return true;
    }
    // anim 模式：海马三层独立形变
    if (parts.anim) {
      drawSeahorseAnim(ctx, o, parts);
      return true;
    }
    // still 模式：整图静态绘制
    if (parts.still) {
      if (parts.stillCfg && parts.stillCfg.puff) drawPufferFish(ctx, o, parts.body.img, parts.stillCfg);
      else drawStillFish(ctx, o, parts.body.img, parts.stillCfg);
      return true;
    }
    if (!parts.tail || !parts.tail.ready) return false;
    if (parts.fins.some((f) => !f.img.ready)) return false;
    const body = parts.body.img, tail = parts.tail.img;
    const h = o.r * 2.15;                     // 素材按高度 ≈ 2r 缩放，宽度按原图比例
    const w = h * body.naturalWidth / body.naturalHeight;
    const sx = w / body.naturalWidth, sy = h / body.naturalHeight; // 源图像素 -> 画布缩放
    const phase = o.phase || 0;               // 前台 s.phase 持续递增，驱动摆动
    const x0 = -w / 2, y0 = -h / 2;

    ctx.save();
    if (o.sat < 45) {                          // 饥饿时去饱和，贴近原手绘的灰白
      try {
        const k = Math.max(0.2, o.sat / 62);
        ctx.filter = `saturate(${k.toFixed(2)})`;
      } catch (_) {}
    }

    // 身体轻微起伏
    const bodySway = Math.sin(phase - 0.5) * 0.035;       // 身体微小摇摆（弧度）
    const bodyBob = Math.sin(phase - 0.5) * h * 0.012;    // 身体轻微上下浮动
    ctx.save();
    ctx.translate(0, bodyBob);
    ctx.rotate(bodySway);
    ctx.drawImage(body, x0, y0, w, h);

    // 各鳍：跟随身体起伏，再绕各自根部小幅度摆动
    for (const fin of parts.fins) {
      const px = x0 + fin.pivot[0] * sx;
      const py = y0 + fin.pivot[1] * sy;
      const ang = Math.sin(phase + fin.offset) * fin.amp;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.translate(-px, -py);
      ctx.drawImage(
        fin.img.img,
        x0 + fin.box[0] * sx, y0 + fin.box[1] * sy,
        (fin.box[2] - fin.box[0]) * sx, (fin.box[3] - fin.box[1]) * sy
      );
      ctx.restore();
    }
    ctx.restore();

    // 尾鳍：绕尾柄轴心旋转，摆幅比身体大得多
    const jx = x0 + parts.joint[0] * sx;
    const jy = y0 + parts.joint[1] * sy;
    const tailAngle = Math.sin(phase) * (parts.tailAmp || 0.38); // 摆幅可配，缺省 ±0.38 弧度
    ctx.save();
    ctx.translate(jx, jy);
    ctx.rotate(tailAngle);
    ctx.translate(-jx, -jy);
    ctx.drawImage(tail, x0, y0, w, h);
    ctx.restore();

    ctx.restore();
    return true;
  }
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
    const finC = hsla(hue, sat - 6, light + 4, 0.82);
    const finDeep = hsla(hue, sat + 4, light - 14, 0.9);
    const lw = Math.max(0.9, r * 0.055 * inkW);

    // 尾鳍：分叉的扇形，随摆尾摆动。先画在身体后面。
    ctx.save();
    ctx.translate(-r * 0.92, 0);
    ctx.rotate(wag * 1.15);
    const tail = ctx.createLinearGradient(0, -r * 0.7, 0, r * 0.7);
    tail.addColorStop(0, finC);
    tail.addColorStop(1, finDeep);
    ctx.beginPath();
    ctx.moveTo(r * 0.1, 0);
    ctx.quadraticCurveTo(-r * 0.42, -r * 0.22, -r * 1.02, -r * 0.82);
    ctx.quadraticCurveTo(-r * 0.72, 0, -r * 1.02, r * 0.82);
    ctx.quadraticCurveTo(-r * 0.42, r * 0.22, r * 0.1, 0);
    ctx.closePath();
    ctx.fillStyle = tail;
    ctx.fill();
    ctx.lineWidth = lw * 0.7;
    ctx.strokeStyle = ink;
    ctx.stroke();
    // 尾鳍纹理
    ctx.strokeStyle = hsla(hue, sat, light + 18, 0.4);
    ctx.lineWidth = lw * 0.6;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.18, 0);
      ctx.quadraticCurveTo(-r * 0.62, i * r * 0.18, -r * 0.92, i * r * 0.6);
      ctx.stroke();
    }
    ctx.restore();

    // 背鳍：带弧度的帆状鳍
    ctx.beginPath();
    ctx.moveTo(-r * 0.42, -r * 0.42);
    ctx.quadraticCurveTo(-r * 0.18, -r * 1.16, r * 0.22, -r * 0.86);
    ctx.quadraticCurveTo(r * 0.1, -r * 0.5, r * 0.3, -r * 0.4);
    ctx.closePath();
    ctx.fillStyle = finDeep;
    ctx.fill();
    ctx.lineWidth = lw * 0.8;
    ctx.strokeStyle = ink;
    ctx.stroke();

    // 腹鳍
    ctx.beginPath();
    ctx.moveTo(-r * 0.28, r * 0.42);
    ctx.quadraticCurveTo(-r * 0.1, r * 0.94, r * 0.28, r * 0.5);
    ctx.closePath();
    ctx.fillStyle = finDeep;
    ctx.fill();
    ctx.stroke();

    // 身体：头圆、背缓、尾柄收窄的流畅轮廓
    const bg = ctx.createLinearGradient(0, -r * 0.6, 0, r * 0.62);
    bg.addColorStop(0, hsla(hue, sat + 10, light + 18));
    bg.addColorStop(0.45, hsla(hue, sat + 4, light + 4));
    bg.addColorStop(1, hsla(hue, sat, light - 10));
    ctx.beginPath();
    ctx.moveTo(r * 1.12, 0);                                   // 吻端
    ctx.bezierCurveTo(r * 1.12, -r * 0.42, r * 0.6, -r * 0.66, -r * 0.1, -r * 0.6);
    ctx.bezierCurveTo(-r * 0.62, -r * 0.56, -r * 0.86, -r * 0.3, -r * 1.0, 0);
    ctx.bezierCurveTo(-r * 0.86, r * 0.3, -r * 0.62, r * 0.56, -r * 0.1, r * 0.6);
    ctx.bezierCurveTo(r * 0.6, r * 0.66, r * 1.12, r * 0.42, r * 1.12, 0);
    ctx.closePath();
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = ink;
    ctx.stroke();

    // 鳃盖弧线
    ctx.beginPath();
    ctx.arc(r * 0.56, -r * 0.02, r * 0.44, -1.15, 1.15);
    ctx.strokeStyle = hsla(hue, sat + 6, light - 16, 0.45);
    ctx.lineWidth = lw * 0.9;
    ctx.stroke();

    // 鳞片高光：几排错落的浅色弧，营造层次
    ctx.strokeStyle = hsla(hue, sat, light + 24, 0.3);
    ctx.lineWidth = lw * 0.7;
    for (let row = -1; row <= 1; row++) {
      for (let col = 0; col < 3; col++) {
        const sx = -r * 0.45 + col * r * 0.42;
        const sy = row * r * 0.3 + (col % 2 ? r * 0.14 : 0);
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.22, -1.0, 1.0);
        ctx.stroke();
      }
    }

    // 背脊高光
    ctx.beginPath();
    ctx.moveTo(r * 0.62, -r * 0.34);
    ctx.quadraticCurveTo(r * 0.05, -r * 0.56, -r * 0.6, -r * 0.4);
    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.lineWidth = lw * 1.3;
    ctx.stroke();

    // 眼睛：琥珀色眼眶 + 黑瞳 + 高光，比纯白眼更传神
    ellipse(ctx, r * 0.72, -r * 0.16, r * 0.19, r * 0.19, 0, hsla(hue, sat + 20, 78), ink, Math.max(0.8, r * 0.06));
    ellipse(ctx, r * 0.77, -r * 0.16, r * 0.1, r * 0.1, 0, '#16232b');
    ellipse(ctx, r * 0.74, -r * 0.2, r * 0.035, r * 0.035, 0, 'rgba(255,255,255,.95)');

    // 鲤鱼胡须
    ctx.strokeStyle = hsla(hue, sat, light - 20, 0.75);
    ctx.lineWidth = Math.max(0.8, r * 0.045);
    ctx.beginPath();
    ctx.moveTo(r * 1.04, r * 0.12);
    ctx.quadraticCurveTo(r * 1.28, r * 0.28, r * 1.34, r * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r * 1.0, r * 0.2);
    ctx.quadraticCurveTo(r * 1.16, r * 0.46, r * 1.12, r * 0.72);
    ctx.stroke();
  }

  // 矢量鲨鱼：所有会动的鳍先画，再画身体盖住鳍根，从根本上避免位图切片的旋转裂缝。
  // 渐变背 / 白腹 / 大眼 / 微笑与图片素材一致，但纯代码绘制、任意缩放都清晰。
  function drawShark(ctx, o) {
    const { r, phase } = o;
    const p = phase || 0;
    const shue = 205;                                  // 固定冷蓝灰，避免主题 hue 绕回暖色
    const back = hsla(shue, 30, 47);
    const mid = hsla(shue, 24, 60);
    const belly = hsla(shue, 18, 91);
    const finTop = hsla(shue, 28, 50);
    const finBot = hsla(shue, 24, 40);
    const ink = 'rgba(18, 44, 62, .82)';               // 稳定深蓝灰描边，贴近图片素材
    const lw = Math.max(1, r * 0.045);
    // 饥饿时整体去饱和
    if (o.sat < 45) {
      const k = Math.max(0.25, o.sat / 62);
      ctx.filter = `saturate(${k.toFixed(2)})`;
    }

    // 尾鳍（绕尾柄旋转，先画，根部稍后被身体覆盖）
    const tailA = Math.sin(p) * 0.34;
    ctx.save();
    ctx.translate(-r * 1.02, 0);
    ctx.rotate(tailA);
    const tg = ctx.createLinearGradient(0, -r * 0.9, 0, r * 0.9);
    tg.addColorStop(0, finTop); tg.addColorStop(1, finBot);
    ctx.beginPath();
    ctx.moveTo(0.12 * r, 0);
    ctx.bezierCurveTo(-0.28 * r, -0.42 * r, -0.62 * r, -0.92 * r, -0.86 * r, -0.96 * r);
    ctx.bezierCurveTo(-0.72 * r, -0.42 * r, -0.52 * r, -0.14 * r, -0.44 * r, 0);
    ctx.bezierCurveTo(-0.52 * r, 0.14 * r, -0.72 * r, 0.42 * r, -0.86 * r, 0.96 * r);
    ctx.bezierCurveTo(-0.62 * r, 0.92 * r, -0.28 * r, 0.42 * r, 0.12 * r, 0);
    ctx.closePath();
    ctx.fillStyle = tg; ctx.fill();
    ctx.lineWidth = lw * 0.9; ctx.strokeStyle = ink; ctx.stroke();
    ctx.restore();

    // 大背鳍（绕根部小幅摆动，根部被身体覆盖）
    ctx.save();
    ctx.translate(-r * 0.16, -r * 0.42);
    ctx.rotate(Math.sin(p + 1.3) * 0.07);
    const dg = ctx.createLinearGradient(0, -r, 0, 0);
    dg.addColorStop(0, finTop); dg.addColorStop(1, finBot);
    ctx.beginPath();
    ctx.moveTo(-r * 0.42, 0.04 * r);
    ctx.quadraticCurveTo(-r * 0.34, -r * 0.92, r * 0.14, -r * 0.98);
    ctx.quadraticCurveTo(r * 0.3, -r * 0.62, r * 0.44, 0.02 * r);
    ctx.closePath();
    ctx.fillStyle = dg; ctx.fill();
    ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.stroke();
    ctx.restore();

    // 小背鳍（近尾部）
    ctx.beginPath();
    ctx.moveTo(-r * 0.82, -r * 0.2);
    ctx.quadraticCurveTo(-r * 0.72, -r * 0.52, -r * 0.54, -r * 0.26);
    ctx.closePath();
    ctx.fillStyle = finBot; ctx.fill();
    ctx.lineWidth = lw * 0.8; ctx.stroke();

    // 腹鳍（身体下方小鳍）
    ctx.beginPath();
    ctx.moveTo(-r * 0.46, r * 0.36);
    ctx.quadraticCurveTo(-r * 0.34, r * 0.72, -r * 0.12, r * 0.42);
    ctx.closePath();
    ctx.fillStyle = finBot; ctx.fill();
    ctx.lineWidth = lw * 0.8; ctx.stroke();

    // 身体：蓝灰渐变背 -> 白腹，盖住上面各鳍的根部
    const bg = ctx.createLinearGradient(0, -r * 0.55, 0, r * 0.55);
    bg.addColorStop(0, back);
    bg.addColorStop(0.58, mid);
    bg.addColorStop(1, belly);
    ctx.beginPath();
    ctx.moveTo(r * 1.44, -r * 0.02);
    ctx.bezierCurveTo(r * 1.02, -r * 0.42, r * 0.42, -r * 0.53, -r * 0.3, -r * 0.5);
    ctx.bezierCurveTo(-r * 0.72, -r * 0.46, -r * 0.98, -r * 0.24, -r * 1.06, 0);
    ctx.bezierCurveTo(-r * 0.98, r * 0.24, -r * 0.72, r * 0.46, -r * 0.3, r * 0.5);
    ctx.bezierCurveTo(r * 0.42, r * 0.53, r * 1.02, r * 0.4, r * 1.44, -r * 0.02);
    ctx.closePath();
    ctx.fillStyle = bg; ctx.fill();
    ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.stroke();

    // 背部高光条
    ctx.beginPath();
    ctx.moveTo(r * 0.42, -r * 0.34);
    ctx.quadraticCurveTo(r * 0.04, -r * 0.44, -r * 0.36, -r * 0.36);
    ctx.strokeStyle = 'rgba(255,255,255,.32)';
    ctx.lineWidth = r * 0.07; ctx.lineCap = 'round'; ctx.stroke();

    // 胸鳍根部阴影（覆盖旋转时根部的所有位置，遮住接缝）
    ctx.beginPath();
    ctx.ellipse(r * 0.34, r * 0.26, r * 0.3, r * 0.2, -0.3, 0, TAU);
    ctx.fillStyle = 'rgba(20,48,66,.32)'; ctx.fill();
    // 胸鳍（压在身体上，绕根部旋转）
    ctx.save();
    ctx.translate(r * 0.34, r * 0.28);
    ctx.rotate(Math.sin(p + 0.7) * 0.14);
    const pg = ctx.createLinearGradient(0, 0, -r * 0.2, r);
    pg.addColorStop(0, finTop); pg.addColorStop(1, finBot);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-r * 0.42, r * 0.52, -r * 0.5, r * 0.98);
    ctx.quadraticCurveTo(-r * 0.02, r * 0.8, r * 0.34, r * 0.3);
    ctx.closePath();
    ctx.fillStyle = pg; ctx.fill();
    ctx.lineWidth = lw * 0.9; ctx.strokeStyle = ink; ctx.stroke();
    ctx.restore();

    // 鳃缝
    ctx.strokeStyle = 'rgba(18,46,64,.42)';
    ctx.lineWidth = lw * 0.9;
    for (let i = 0; i < 3; i++) {
      const gx = r * (0.62 - i * 0.17);
      ctx.beginPath();
      ctx.moveTo(gx, -r * 0.2);
      ctx.quadraticCurveTo(gx - r * 0.08, 0, gx - r * 0.02, r * 0.2);
      ctx.stroke();
    }

    // 嘴：微笑弧线 + 一颗小牙
    ctx.beginPath();
    ctx.moveTo(r * 1.4, r * 0.12);
    ctx.quadraticCurveTo(r * 1.06, r * 0.4, r * 0.74, r * 0.26);
    ctx.strokeStyle = 'rgba(14,40,56,.8)';
    ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r * 1.18, r * 0.3);
    ctx.lineTo(r * 1.14, r * 0.4);
    ctx.lineTo(r * 1.08, r * 0.31);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fill();

    // 眼睛：白眼球 + 黑瞳孔 + 高光
    ellipse(ctx, r * 0.98, -r * 0.16, r * 0.2, r * 0.21, 0, '#f7fbfc', ink, lw * 0.8);
    ellipse(ctx, r * 1.03, -r * 0.14, r * 0.105, r * 0.12, 0, '#0e2230');
    ellipse(ctx, r * 1.0, -r * 0.2, r * 0.035, r * 0.04, 0, 'rgba(255,255,255,.95)');
    // 眉毛/眼眶上缘
    ctx.beginPath();
    ctx.moveTo(r * 0.82, -r * 0.34);
    ctx.quadraticCurveTo(r * 1.02, -r * 0.44, r * 1.16, -r * 0.3);
    ctx.strokeStyle = 'rgba(18,44,62,.55)';
    ctx.lineWidth = lw * 0.8; ctx.stroke();

    ctx.filter = 'none';
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

  function drawClam(ctx, o) {
    const { r, hue, sat, light, gape, ink, inkW } = o;
    const g = Math.max(0, Math.min(0.8, (gape || 0) * 0.9));
    const cs = Math.min(52, sat);
    const shell = hsla(hue, cs, light + 2);
    const shellD = hsla(hue, cs, light - 18);
    const mantle = hsla(hue + 320, 58, 76, 0.95);
    const lw = Math.max(0.8, r * 0.035 * inkW);

    // 下壳（底座）
    ctx.beginPath();
    ctx.ellipse(0, r * 0.24, r * 1.02, r * 0.44, 0, 0, Math.PI);
    ctx.lineTo(-r * 1.02, r * 0.24);
    ctx.closePath();
    const lower = ctx.createLinearGradient(0, r * 0.2, 0, r * 0.68);
    lower.addColorStop(0, shell);
    lower.addColorStop(1, shellD);
    ctx.fillStyle = lower;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = ink;
    ctx.stroke();

    // 蚌肉 / 外套膜
    ctx.beginPath();
    ctx.ellipse(0, r * 0.16, r * 0.78, r * 0.24, 0, 0, Math.PI);
    ctx.fillStyle = mantle;
    ctx.fill();
    // 珍珠
    ellipse(ctx, r * 0.12, r * 0.1, r * 0.15, r * 0.15, 0, '#fbfdff', 'rgba(120,150,170,.5)', lw);
    ellipse(ctx, r * 0.07, r * 0.05, r * 0.05, r * 0.05, 0, 'rgba(255,255,255,.95)');

    // 上壳：绕左端铰链张开，扇形带放射棱
    ctx.save();
    ctx.translate(-r * 0.98, r * 0.22);
    ctx.rotate(-g);
    ctx.translate(r * 0.98, -r * 0.22);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.14, r * 1.02, r * 0.9, 0, Math.PI, 0);
    ctx.closePath();
    const upper = ctx.createLinearGradient(0, -r * 0.76, 0, r * 0.14);
    upper.addColorStop(0, hsla(hue, cs, light + 10));
    upper.addColorStop(1, shellD);
    ctx.fillStyle = upper;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = ink;
    ctx.stroke();

    // 放射棱纹
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, r * 0.14, r * 1.02, r * 0.9, 0, Math.PI, 0);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,.16)';
    ctx.lineWidth = Math.max(1, r * 0.05);
    for (let i = -5; i <= 5; i++) {
      ctx.beginPath();
      ctx.moveTo(0, r * 0.14);
      ctx.lineTo(i * r * 0.26, -r * 0.8);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = lw;
    for (let i = -4; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, r * 0.14);
      ctx.quadraticCurveTo(i * r * 0.16, -r * 0.2, i * r * 0.24, -r * 0.7);
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
    const body = hsla(hue, Math.min(92, sat + 20), light + 6);
    const dark = hsla(hue - 14, sat + 4, light - 16);
    const finC = hsla(hue, sat + 6, light + 10, 0.78);
    const lw = Math.max(1, r * 0.05 * inkW);

    // 飘逸的长背鳍 / 臀鳍（先画在身体后）
    ctx.save();
    ctx.translate(-r * 0.06, 0);
    ctx.rotate(wag * 0.35);
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, -r * 0.58);
    ctx.quadraticCurveTo(-r * 1.0, -r * 1.9, r * 0.5, -r * 1.5);
    ctx.quadraticCurveTo(r * 0.16, -r * 0.96, r * 0.28, -r * 0.42);
    ctx.closePath();
    ctx.fillStyle = finC;
    ctx.fill();
    ctx.lineWidth = lw * 0.7;
    ctx.strokeStyle = ink;
    ctx.stroke();
    // 背鳍细丝
    ctx.strokeStyle = hsla(hue, sat, light + 18, 0.5);
    ctx.lineWidth = lw * 0.6;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(r * (-0.1 + i * 0.16), -r * 0.7);
      ctx.quadraticCurveTo(r * (-0.3 + i * 0.2), -r * 1.3, r * (0.16 + i * 0.14), -r * 1.42);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-r * 0.26, r * 0.56);
    ctx.quadraticCurveTo(-r * 0.9, r * 1.7, r * 0.46, r * 1.36);
    ctx.quadraticCurveTo(r * 0.12, r * 0.9, r * 0.24, r * 0.4);
    ctx.closePath();
    ctx.fillStyle = hsla(hue, sat, light + 4, 0.74);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.restore();

    // 尾鳍：带长飘带
    ctx.save();
    ctx.translate(-r * 0.62, 0);
    ctx.rotate(wag * 0.5);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-r * 0.62, -r * 0.55, -r * 0.98, -r * 0.36);
    ctx.quadraticCurveTo(-r * 0.66, 0, -r * 0.98, r * 0.36);
    ctx.quadraticCurveTo(-r * 0.62, r * 0.55, 0, 0);
    ctx.closePath();
    ctx.fillStyle = finC;
    ctx.fill();
    ctx.lineWidth = lw * 0.7;
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.restore();

    // 侧扁高身体：更接近菱形的优雅轮廓
    const bg = ctx.createLinearGradient(0, -r * 0.92, 0, r * 0.92);
    bg.addColorStop(0, hsla(hue, sat + 12, light + 16));
    bg.addColorStop(0.55, body);
    bg.addColorStop(1, hsla(hue, sat + 6, light - 8));
    ctx.beginPath();
    ctx.moveTo(r * 0.94, -r * 0.06);                 // 尖吻
    ctx.quadraticCurveTo(r * 0.62, -r * 0.7, r * 0.06, -r * 0.94);
    ctx.quadraticCurveTo(-r * 0.5, -r * 0.98, -r * 0.62, -r * 0.2);
    ctx.quadraticCurveTo(-r * 0.7, 0, -r * 0.62, r * 0.2);
    ctx.quadraticCurveTo(-r * 0.5, r * 0.98, r * 0.06, r * 0.94);
    ctx.quadraticCurveTo(r * 0.62, r * 0.7, r * 0.94, -r * 0.06);
    ctx.closePath();
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = ink;
    ctx.stroke();

    // 三条自然弯曲的竖纹
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = dark;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(1.5, r * 0.1);
    for (const x of [-0.34, 0.04, 0.42]) {
      ctx.beginPath();
      ctx.moveTo(r * x, -r * 1.0);
      ctx.quadraticCurveTo(r * (x + 0.16), 0, r * (x - 0.04), r * 1.0);
      ctx.stroke();
    }
    ctx.restore();

    // 腹鳍细丝
    ctx.strokeStyle = hsla(hue, sat, light - 6, 0.7);
    ctx.lineWidth = lw * 0.8;
    ctx.beginPath();
    ctx.moveTo(r * 0.3, r * 0.5);
    ctx.quadraticCurveTo(r * 0.5, r * 0.95, r * 0.24, r * 1.06);
    ctx.stroke();

    eye(ctx, r * 0.62, -r * 0.2, r * 0.11, ink);
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
    const radius = r * 0.8;
    const lw = Math.max(0.8, r * 0.035 * inkW);

    // 小圆鳍（尾 + 胸鳍）
    ctx.save();
    ctx.translate(-r * 0.78, 0);
    ctx.rotate(wag);
    ellipse(ctx, -r * 0.14, 0, r * 0.2, r * 0.26, 0, hsla(hue, sat, light - 2, 0.85));
    ctx.restore();
    ellipse(ctx, -r * 0.02, -r * 0.68, r * 0.19, r * 0.12, -0.4, hsla(hue, sat, light, 0.8));
    ellipse(ctx, -r * 0.02, r * 0.68, r * 0.19, r * 0.12, 0.4, hsla(hue, sat, light, 0.8));

    // 细密的刺：两圈错位的小三角
    const spike = hsla(hue, sat, light - 4);
    const rings = [{ n: 20, rad: 1.2, len: 0.16, w: 0.07 }, { n: 14, rad: 1.02, len: 0.11, w: 0.055 }];
    for (const ring of rings) {
      for (let i = 0; i < ring.n; i++) {
        const a = (i / ring.n) * TAU + (ring.rad < 1.1 ? 0.15 : 0);
        const x = Math.cos(a) * radius * ring.rad;
        const y = Math.sin(a) * radius * ring.rad * 0.94;
        const nx = Math.cos(a), ny = Math.sin(a);
        const px = -ny * r * ring.w, py = nx * r * ring.w;
        polygon(ctx, [
          [x * 0.9 - px, y * 0.9 - py],
          [x + nx * r * ring.len, y + ny * r * ring.len],
          [x * 0.9 + px, y * 0.9 + py],
        ], spike);
      }
    }

    // 圆鼓鼓的身体
    const bg = ctx.createRadialGradient(-r * 0.22, -r * 0.28, r * 0.08, 0, 0, radius);
    bg.addColorStop(0, hsla(hue, sat, light + 22));
    bg.addColorStop(0.65, body);
    bg.addColorStop(1, hsla(hue, sat, light - 8));
    ellipse(ctx, 0, 0, radius, radius * 0.94, 0, bg, ink, Math.max(1, r * 0.055 * inkW));

    // 背部斑点和腹部浅色
    ellipse(ctx, -r * 0.16, -r * 0.34, r * 0.3, r * 0.16, -0.3, 'rgba(255,255,255,.3)');
    ellipse(ctx, r * 0.05, r * 0.42, r * 0.4, r * 0.18, 0, 'rgba(255,255,255,.22)');
    ctx.fillStyle = hsla(hue, sat, light - 12, 0.45);
    for (const [dx, dy] of [[-0.32, -0.1], [-0.12, -0.34], [-0.44, 0.16]]) {
      ellipse(ctx, r * dx, r * dy, r * 0.05, r * 0.05, 0, ctx.fillStyle);
    }

    // 腮红
    ellipse(ctx, r * 0.34, r * 0.12, r * 0.13, r * 0.08, 0, 'rgba(235,120,110,.35)');

    // 大眼
    eye(ctx, r * 0.34, -r * 0.22, r * 0.19, ink);

    // 嘟起的 small 嘴：短横线 + 上翘嘴角
    ctx.beginPath();
    ctx.moveTo(r * 0.7, r * 0.08);
    ctx.quadraticCurveTo(r * 0.84, r * 0.14, r * 0.72, r * 0.22);
    ctx.strokeStyle = hsla(hue - 18, 60, 38, 0.8);
    ctx.lineWidth = lw;
    ctx.stroke();
    ellipse(ctx, r * 0.74, r * 0.15, r * 0.06, r * 0.05, 0, hsla(hue - 20, 68, 46, 0.9));
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
    carp: drawCarp, clown: drawClown, shark: drawShark, clam: drawClam,
    goldfish: drawGoldfish, koi: drawKoi, guppy: drawGuppy, angelfish: drawAngelfish,
    tetra: drawTetra, puffer: drawPuffer, seahorse: drawSeahorse,
  };

  function draw(ctx, opts) {
    const o = Object.assign({
      look: 'carp', r: 24, hue: 28, sat: 62, light: 62,
      ink: 'rgba(18,44,58,.35)', inkW: 1, wag: 0, gape: 0.3, phase: 0,
    }, opts || {});
    o.look = normalize(o.look);
    // 已换图的鱼种优先画图片；没图或还没加载好就回退原手绘
    if (IMG_KEYS.has(o.look) && drawImageFish(ctx, o)) return;
    const fn = DRAWERS[o.look] || drawCarp;
    ctx.save();
    fn(ctx, o);
    ctx.restore();
  }

  window.FishArt = { LOOKS, draw, normalize, labelOf, iconOf, whenReady, needsImage: (k) => IMG_KEYS.has(normalize(k)) };
})();

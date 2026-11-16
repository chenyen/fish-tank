/* 虚拟养鱼 - 前端：Canvas 手绘鱼 + 交互 */
(() => {
  const $ = (s) => document.querySelector(s);

  let state = null;
  let pollTimer = null;
  const sims = new Map();      // id -> {x, y, tx, ty, dir, phase}
  const particles = [];        // 气泡 / 爱心
  const bubbles = [];
  let hoverId = null;

  const canvas = $('#tank');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  /* ------------------------------------------------------------ 接口 */

  async function api(path, method = 'GET', body = null) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch (e) { }
    if (!res.ok) {
      let msg = data.detail || '请求失败';
      if (Array.isArray(msg)) msg = '参数不合法';
      throw new Error(msg);
    }
    return data;
  }

  function toast(text, ms = 1800) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  /* ------------------------------------------------------------ 登录 */

  let mode = 'login';
  $('#tabLogin').onclick = () => switchMode('login');
  $('#tabReg').onclick = () => switchMode('register');

  function switchMode(m) {
    mode = m;
    $('#tabLogin').classList.toggle('on', m === 'login');
    $('#tabReg').classList.toggle('on', m === 'register');
    $('#submitAuth').textContent = m === 'login' ? '进入鱼缸' : '创建鱼缸';
    $('#authHint').textContent = '';
    $('#authHint').classList.remove('error');
  }

  function hint(text, isErr) {
    const el = $('#authHint');
    el.textContent = text || '';
    el.classList.toggle('error', !!isErr);
  }

  $('#submitAuth').onclick = doAuth;
  $('#password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });

  async function doAuth() {
    const username = $('#username').value.trim();
    const password = $('#password').value;
    if (!username || !password) return hint('用户名和密码都要填', true);
    const btn = $('#submitAuth');
    btn.disabled = true;
    hint(mode === 'login' ? '登录中…' : '创建中…');
    try {
      await api(mode === 'login' ? '/api/login' : '/api/register', 'POST', { username, password });
      hint('');
      await enterGame();
    } catch (e) {
      hint(e.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  $('#logout').onclick = async () => {
    try { await api('/api/logout', 'POST', {}); } catch (e) { }
    clearInterval(pollTimer);
    $('#game').classList.add('hidden');
    $('#auth').classList.remove('hidden');
    sims.clear();
    state = null;
  };

  async function enterGame() {
    $('#auth').classList.add('hidden');
    $('#game').classList.remove('hidden');
    resize();
    await refresh();
    clearInterval(pollTimer);
    pollTimer = setInterval(refresh, 5000);
    loopStart();
  }

  /* ------------------------------------------------------------ 状态 */

  async function refresh() {
    try {
      const data = await api('/api/state');
      applyState(data);
    } catch (e) {
      if (/登录/.test(e.message)) {
        clearInterval(pollTimer);
        $('#game').classList.add('hidden');
        $('#auth').classList.remove('hidden');
      }
    }
  }

  let clockBase = 0;
  let clockSyncAt = 0;

  function applyState(data) {
    const prevCoins = state ? state.coins_exact : null;
    state = data;
    $('#coins').textContent = (data.coins_exact !== undefined ? data.coins_exact : data.coins).toFixed(1);
    $('#pending').textContent = '+' + (data.pending || 0).toFixed(1);
    $('#income').textContent = (data.income_per_hour || 0).toFixed(1);
    $('#food').textContent = data.food;
    $('#foodMax').textContent = '/' + data.food_cap;
    $('#who').textContent = data.username || '';
    const brandEl = $('#brandTitle');
    if (brandEl && !editingNode) brandEl.textContent = data.title || 'AQUARIUM';

    clockBase = data.next_payout_in || 0;
    clockSyncAt = Date.now();
    tickClock();

    if (prevCoins !== null && data.coins_exact !== prevCoins) {
      const pill = document.querySelector('.pill.gold');
      pill.classList.remove('pop');
      void pill.offsetWidth;
      pill.classList.add('pop');
    }
    notifyGain(data.gain);

    // 新鱼加入动画池
    const seen = new Set();
    for (const f of data.fish) {
      seen.add(f.id);
      if (!sims.has(f.id)) {
        sims.set(f.id, newSim());
      }
    }
    for (const id of [...sims.keys()]) if (!seen.has(id)) sims.delete(id);

    if (!editingNode) renderList(data);

    const free = data.capacity - data.fish.length;
    $('#btnFish').textContent = free > 0
      ? `买鱼苗 · ${data.prices.fish}`
      : `鱼缸已满 ${data.fish.length}/${data.capacity}`;
    $('#btnFish').disabled = free <= 0 || data.coins < data.prices.fish;
    $('#btnFood').textContent = `换饲料 x${data.prices.food_pack_size} · ${data.prices.food_pack}`;
    $('#btnFood').disabled = data.coins < data.prices.food_pack || data.food >= data.food_cap;

    const ft = $('#foodTimer');
    ft.textContent = data.next_food_in == null
      ? '饲料已满，不会继续增加'
      : `下一份饲料：约 ${Math.ceil(data.next_food_in / 60)} 分钟后`;
  }

  function tickClock() {
    const left = Math.max(0, clockBase - (Date.now() - clockSyncAt) / 1000);
    const m = Math.floor(left / 60);
    const sec = Math.floor(left % 60);
    $('#clock').textContent = String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  setInterval(() => { if (state) tickClock(); }, 1000);

  function notifyGain(gain) {
    if (!gain) return;
    const parts = [];
    if (gain.payout_amount > 0) {
      parts.push('整点结算 ' + gain.payout_count + ' 小时 +' + gain.payout_amount + ' 金币');
    }
    if (gain.advances && gain.advances.length) {
      const a = gain.advances[0];
      const more = gain.advances.length > 1 ? ' 等 ' + gain.advances.length + ' 条鱼' : '';
      parts.push(a.fish + more + ' 进阶 ' + a.stage + ' +' + gain.reward_total + ' 金币');
    }
    if (parts.length) toast(parts.join(' ｜ '), 3000);
  }

  function renderList(data) {
    const box = $('#fishList');
    if (!data.fish.length) {
      box.innerHTML = '<div class="empty">鱼缸空空如也，去买一条鱼吧。</div>';
      return;
    }
    box.innerHTML = data.fish.map((f) => {
      const hunger = Math.round(f.hunger);
      const growPct = Math.round(f.stage.progress * 100);
      const ageH = (f.age / 3600).toFixed(1);
      return `<div class="fishitem" data-id="${f.id}" title="点击喂食">
        <div class="top"><b class="fname" data-id="${f.id}" title="点击给这条鱼改名">${esc(f.name)}</b><span class="stag">${f.stage.name}</span></div>
        <div class="bar grow"><i style="width:${growPct}%"></i></div>
        <div class="bar hunger"><i style="width:${hunger}%"></i></div>
        <div class="meta"><span>${f.coin_rate} 币/时${f.eff < 1 ? ' · 产能 ' + Math.round(f.eff * 100) + '%' : ''}</span><span>已养 ${ageH}h</span></div>
        <div class="meta"><span>饱食 ${hunger}%</span><span>${f.stage.next_name ? '距' + f.stage.next_name + ' ' + Math.max(0, Math.round(f.stage.next_at - f.growth)) : '已满级'}</span></div>
      </div>`;
    }).join('');

    box.querySelectorAll('.fishitem').forEach((el) => {
      el.onclick = (ev) => {
        const nameEl = ev.target.closest('.fname');
        if (nameEl) {
          ev.stopPropagation();
          renameFish(+nameEl.dataset.id, nameEl);
          return;
        }
        feed(+el.dataset.id);
      };
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* ------------------------------------------------------------ 改名 */

  let editingNode = null;          // 正在编辑的元素，编辑期间不重建列表

  function inlineEdit(el, value, maxLen, onCommit) {
    if (!el || editingNode) return;
    editingNode = el;
    const prev = el.textContent;
    el.classList.add('editing');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'renaming';
    input.maxLength = maxLen;
    input.value = value == null ? prev : value;
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const val = input.value;
      el.classList.remove('editing');
      el.textContent = prev;
      editingNode = null;
      if (commit) onCommit(val);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('dblclick', (e) => e.stopPropagation());
  }

  function editTankTitle() {
    const el = $('#brandTitle');
    if (!el || editingNode) return;
    const cur = (state && state.title) || el.textContent;
    inlineEdit(el, cur, 24, async (val) => {
      const title = val.replace(/[\r\n]/g, ' ').trim();
      if (!title) { toast('鱼缸名不能为空'); return; }
      if (state && title === state.title) return;
      try {
        const data = await api('/api/title', 'POST', { title });
        applyState(data);
        toast('鱼缸名已改为「' + data.title + '」');
      } catch (e) {
        toast(e.message, 1800);
      }
    });
  }

  function renameFish(id, nameEl) {
    const f = state && state.fish.find((x) => x.id === id);
    if (!f || editingNode) return;
    const el = nameEl || $('#fishList').querySelector('.fishitem[data-id="' + id + '"] .fname');
    inlineEdit(el, f.name, 16, async (val) => {
      const name = val.replace(/[\r\n]/g, ' ').trim();
      if (!name) { toast('鱼名不能为空'); return; }
      if (name === f.name) return;
      try {
        const data = await api('/api/fish/name', 'POST', { fish_id: id, name });
        applyState(data);
        toast('它叫「' + name + '」了');
      } catch (e) {
        toast(e.message, 1800);
      }
    });
  }

  $('#brandTitle').onclick = () => editTankTitle();

  /* ------------------------------------------------------------ 操作 */

  async function feed(id) {
    const sim = sims.get(id);
    try {
      const data = await api('/api/feed', 'POST', { fish_id: id });
      applyState(data);
      if (sim) { sim.eat = 1; spawnHearts(sim.x, sim.y); }
      const f = data.fish.find((x) => x.id === id);
      toast(`${f ? f.name : '鱼'} 吃到了，饱食度 ${Math.round(f ? f.hunger : 0)}%`);
    } catch (e) {
      toast(e.message, 1600);
    }
  }

  $('#btnFish').onclick = async () => {
    try {
      const data = await api('/api/fish', 'POST', { name: '' });
      applyState(data);
      const last = data.fish[data.fish.length - 1];
      toast(`${last.name} 游进了鱼缸`);
    } catch (e) { toast(e.message, 1600); }
  };

  $('#btnFood').onclick = async () => {
    try {
      const data = await api('/api/food', 'POST', {});
      applyState(data);
      toast('饲料 +' + data.prices.food_pack_size);
    } catch (e) { toast(e.message, 1600); }
  };

  $('#btnBoard').onclick = async () => {
    try {
      const res = await api('/api/leaderboard');
      showBoard(res.rank);
    } catch (e) { toast(e.message, 1600); }
  };

  function showBoard(rank) {
    const old = document.querySelector('#boardOverlay');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = 'boardOverlay';
    wrap.style.cssText = `position:fixed;inset:0;background:rgba(3,16,24,.66);display:flex;
      align-items:center;justify-content:center;z-index:20;padding:20px;backdrop-filter:blur(4px)`;
    const rows = rank.length
      ? rank.map((r, i) => `<tr>
          <td style="width:34px;color:#8fb3c7">${i + 1}</td>
          <td>${esc(r.username)}</td>
          <td style="color:#4be0c8">${r.best_stage}</td>
          <td style="text-align:right;color:#ffcc4d">${r.total_growth}</td>
        </tr>`).join('')
      : '<tr><td colspan="4" style="color:#8fb3c7">还没有鱼缸被创建</td></tr>';
    wrap.innerHTML = `<div class="card" style="max-width:420px">
      <h1 style="font-size:19px">成长排行榜</h1>
      <p class="sub">按全缸鱼的成长值总和排序</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="color:#8fb3c7;font-size:11px">
          <th style="text-align:left;padding-bottom:6px">#</th>
          <th style="text-align:left;padding-bottom:6px">玩家</th>
          <th style="text-align:left;padding-bottom:6px">最好阶段</th>
          <th style="text-align:right;padding-bottom:6px">总成长</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <button class="btn full" id="boardClose">关闭</button>
    </div>`;
    document.body.appendChild(wrap);
    wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
    wrap.querySelector('#boardClose').onclick = () => wrap.remove();
  }

  /* ------------------------------------------------------------ 渲染 */

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!bubbles.length) {
      for (let i = 0; i < 26; i++) bubbles.push(newBubble(true));
    }
  }

  window.addEventListener('resize', () => { if (state) resize(); });

  function newBubble(init) {
    return {
      x: Math.random() * W,
      y: init ? Math.random() * H : H + 10,
      r: 1 + Math.random() * 3.2,
      v: 12 + Math.random() * 26,
      ph: Math.random() * 6.28,
    };
  }

  function spawnHearts(x, y) {
    for (let i = 0; i < 7; i++) {
      particles.push({
        x, y, life: 1,
        vx: (Math.random() - 0.5) * 40,
        vy: -20 - Math.random() * 30,
        heart: Math.random() > 0.45,
        r: 2 + Math.random() * 2.5,
      });
    }
  }

  let last = performance.now();
  let running = false;

  function loopStart() {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw(now / 1000);
    if (state) requestAnimationFrame(frame);
    else running = false;
  }

  function fishRadius(f, sim) {
    const depth = 0.72 + 0.55 * (sim.y / Math.max(1, H));
    return 26 * f.stage.scale * depth;
  }

  /* ---------------------------------------------- 每条鱼独立的游动性格
     pattern  游动模式    speedK 速度系数   wobble/amp 摆尾节奏与幅度
     bandLo/Hi 偏好水深带  idle 停顿   burst 冲刺
     参数在鱼入场时随机生成，因此同一缸里不会有两条轨迹重合。            */

  const PATTERNS = ['cruise', 'cruise', 'sine', 'circle', 'hover', 'bottom'];
  const rnd = (a, b) => a + Math.random() * (b - a);

  function newSim() {
    const lo = rnd(0.12, 0.45);
    let hi = Math.min(0.9, lo + rnd(0.15, 0.4));
    const s = {
      x: W * rnd(0.15, 0.85),
      y: H * rnd(lo, hi),
      tx: W * rnd(0.1, 0.9),
      ty: H * rnd(lo, hi),
      dir: Math.random() > 0.5 ? 1 : -1,
      phase: rnd(0, 6.2832),
      eat: 0,
      hold: 0,
      pattern: PATTERNS[Math.floor(Math.random() * PATTERNS.length)],
      speedK: rnd(0.55, 1.5),
      wobble: rnd(0.45, 2.5),
      amp: rnd(5, 22),
      bandLo: lo,
      bandHi: hi,
      idle: 0,
      burst: 0,
      angle: rnd(0, 6.2832),
      radiusXR: rnd(0.05, 0.15),
      radiusYR: rnd(0.05, 0.17),
      cxr: rnd(0.28, 0.72),
      cyr: rnd(0.32, 0.68),
      drift: rnd(0.12, 0.5),
    };
    if (s.pattern === 'bottom') {           // 贴底巡游
      s.bandLo = 0.68; s.bandHi = 0.9;
      s.ty = H * rnd(0.72, 0.88);
      s.speedK *= 0.75;
    }
    if (s.pattern === 'hover') {            // 小范围悬停
      s.bandLo = rnd(0.2, 0.55);
      s.bandHi = Math.min(0.9, s.bandLo + rnd(0.08, 0.2));
      s.amp = rnd(10, 26);
    }
    return s;
  }

  function pickTarget(s) {
    const lo = Math.max(40, H * s.bandLo);
    const hi = Math.min(H - 40, Math.max(lo + 30, H * s.bandHi));
    s.tx = W * rnd(0.08, 0.92);
    s.ty = rnd(lo, hi);
  }

  function stepFish(s, dt, speed) {
    // 随机打盹：让节奏错开，避免整缸鱼同步
    if (s.idle > 0) {
      s.idle -= dt;
      s.x += Math.cos(s.phase * s.wobble) * 5 * dt;
      s.y += Math.sin(s.phase * s.wobble * 1.3) * 7 * dt;
      return;
    }
    if (s.burst > 0) s.burst = Math.max(0, s.burst - dt);
    else if (Math.random() < dt * 0.1) s.burst = rnd(0.45, 1.1);
    const v = speed * s.speedK * (s.burst > 0 ? 1.75 : 1);

    if (s.pattern === 'circle') {
      // 沿自己的椭圆轨迹巡游，圆心缓慢漂移
      s.angle += dt * (0.45 + s.speedK * 0.4) * (s.dir > 0 ? 1 : -1);
      s.cxr += Math.sin(s.angle * s.drift) * dt * 0.05;
      s.cyr += Math.cos(s.angle * s.drift * 1.3) * dt * 0.04;
      s.cxr = Math.max(0.2, Math.min(0.8, s.cxr));
      s.cyr = Math.max(0.24, Math.min(0.76, s.cyr));
      const nx = W * s.cxr + Math.cos(s.angle) * W * s.radiusXR;
      const ny = H * s.cyr + Math.sin(s.angle) * H * s.radiusYR;
      const k = Math.min(1, dt * 4.5);
      if (Math.abs(nx - s.x) > 0.5) s.dir = nx > s.x ? 1 : -1;
      s.x += (nx - s.x) * k;
      s.y += (ny - s.y) * k;
      return;
    }

    if (s.pattern === 'sine') {
      // 横向波浪前进，只在自己那条水层里起伏
      s.x += s.dir * v * dt;
      const mid = H * (s.bandLo + s.bandHi) / 2;
      const pull = (mid - s.y) * 0.55 * dt;
      s.y += Math.cos(s.phase * s.wobble) * s.amp * dt * 1.4 + pull;
      if (s.x > W - 30) { s.x = W - 30; s.dir = -1; }
      if (s.x < 30) { s.x = 30; s.dir = 1; }
      return;
    }

    if (s.pattern === 'hover') {
      // 原地小幅摆尾，偶尔换一个落脚点
      if (Math.random() < dt * 0.18) pickTarget(s);
      const k = Math.min(1, dt * 0.7);
      s.x += (s.tx - s.x) * k + Math.cos(s.phase * s.wobble * 0.7) * s.amp * dt * 0.7;
      s.y += (s.ty - s.y) * k + Math.sin(s.phase * s.wobble) * s.amp * dt * 0.8;
      if (Math.abs(s.tx - s.x) > 1) s.dir = s.tx > s.x ? 1 : -1;
      return;
    }

    // cruise / bottom：朝自己的目标点游，叠加摆动
    const dx = s.tx - s.x, dy = s.ty - s.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 14) {
      if (Math.random() < 0.42) s.idle = rnd(0.4, 2.2);
      pickTarget(s);
      return;
    }
    s.x += (dx / dist) * v * dt;
    s.y += (dy / dist) * v * dt + Math.sin(s.phase * s.wobble) * s.amp * dt * 0.65;
    if (Math.abs(dx) > 2) s.dir = dx > 0 ? 1 : -1;
  }

  function update(dt) {
    if (!state) return;
    for (const f of state.fish) {
      const s = sims.get(f.id);
      if (!s) continue;

      // 被拖拽的鱼完全跟随指针，不参与自主游动
      if (drag && drag.id === f.id) {
        s.phase += dt * 6;
        continue;
      }
      // 刚放下的鱼先原地停留一会儿
      if (s.hold > 0) {
        s.hold = Math.max(0, s.hold - dt);
        s.phase += dt * 1.8;
        continue;
      }

      const energy = f.hunger < 15 ? 0.45 : 1;
      const speed = (26 + f.stage.scale * 22) * energy;
      stepFish(s, dt, speed);

      // 边界兜底
      s.x = Math.max(30, Math.min(W - 30, s.x));
      s.y = Math.max(40, Math.min(H - 40, s.y));
      s.phase += dt * (2.2 + speed * 0.05) * (0.7 + s.speedK * 0.4);
      if (s.eat > 0) s.eat = Math.max(0, s.eat - dt * 1.6);
    }

    for (const b of bubbles) {
      b.y -= b.v * dt;
      b.x += Math.sin((b.y + b.ph * 40) / 34) * 8 * dt;
      if (b.y < -12) Object.assign(b, newBubble(false));
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt * 0.85;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 14 * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function draw(t) {
    // 水体
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#14607f');
    g.addColorStop(0.45, '#0c3f58');
    g.addColorStop(1, '#06202e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 顶部光柱
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const x = W * (0.15 + i * 0.22) + Math.sin(t * 0.25 + i) * 26;
      const lg = ctx.createLinearGradient(x, 0, x + 70, H * 0.8);
      lg.addColorStop(0, 'rgba(140, 235, 255, 0.10)');
      lg.addColorStop(1, 'rgba(140, 235, 255, 0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(x - 30, 0);
      ctx.lineTo(x + 40, 0);
      ctx.lineTo(x + 110, H);
      ctx.lineTo(x - 70, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 水草
    drawPlants(t);

    // 气泡
    for (const b of bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, 6.2832);
      ctx.strokeStyle = 'rgba(200, 240, 255, 0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (!state) return;

    // 鱼（远小近大，按 y 排序）
    const list = state.fish
      .map((f) => ({ f, s: sims.get(f.id) }))
      .filter((o) => o.s)
      .sort((a, b) => {
        const ad = drag && drag.id === a.f.id ? 1 : 0;
        const bd = drag && drag.id === b.f.id ? 1 : 0;
        return ad - bd || a.s.y - b.s.y;   // 拖拽中的鱼画在最上层
      });

    for (const { f, s } of list) {
      drawFish(f, s, t);
    }

    // 粒子
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      if (p.heart) {
        ctx.fillStyle = '#ff8fb1';
        ctx.font = `${10 + p.r * 2}px sans-serif`;
        ctx.fillText('♥', p.x, p.y);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fillStyle = 'rgba(200,245,255,.85)';
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawPlants(t) {
    const baseY = H - 4;
    ctx.save();
    for (let i = 0; i < 9; i++) {
      const x = 26 + i * (W / 9) + (i % 2) * 12;
      const h = 40 + ((i * 37) % 60);
      const sway = Math.sin(t * 0.9 + i) * 10;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.quadraticCurveTo(x + sway * 0.5, baseY - h * 0.55, x + sway, baseY - h);
      ctx.lineWidth = 3 + (i % 3);
      ctx.strokeStyle = i % 2 ? 'rgba(40, 150, 120, .45)' : 'rgba(30, 120, 100, .38)';
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    // 沙底
    const sg = ctx.createLinearGradient(0, H - 26, 0, H);
    sg.addColorStop(0, 'rgba(30, 70, 88, 0)');
    sg.addColorStop(1, 'rgba(12, 40, 54, .95)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, H - 26, W, 26);
    ctx.restore();
  }

  function drawFish(f, s, t) {
    const r = fishRadius(f, s);
    const hungry = f.hunger < 15;
    const wag = Math.sin(s.phase) * 0.32;
    const tilt = Math.sin(s.phase * 0.6) * 0.05;
    const sat = hungry ? 26 : 62;
    const light = hungry ? 50 : 62;
    const body = `hsl(${f.hue}, ${sat}%, ${light}%)`;
    const finC = `hsla(${f.hue}, ${sat}%, ${light - 8}%, .85)`;

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(s.dir, 1);
    ctx.rotate(tilt);

    // 影子
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.95, r * 0.85, r * 0.22, 0, 0, 6.2832);
    ctx.fillStyle = '#00131c';
    ctx.fill();
    ctx.restore();

    // 尾巴
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

    // 上鳍
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, -r * 0.42);
    ctx.quadraticCurveTo(r * 0.1, -r * 0.95, r * 0.42, -r * 0.36);
    ctx.closePath();
    ctx.fillStyle = finC;
    ctx.fill();

    // 下鳍
    ctx.beginPath();
    ctx.moveTo(-r * 0.05, r * 0.34);
    ctx.quadraticCurveTo(r * 0.05, r * 0.72, r * 0.38, r * 0.3);
    ctx.closePath();
    ctx.fillStyle = finC;
    ctx.fill();

    // 身体
    const bg = ctx.createLinearGradient(0, -r * 0.5, 0, r * 0.5);
    bg.addColorStop(0, `hsl(${f.hue}, ${sat + 8}%, ${light + 14}%)`);
    bg.addColorStop(1, body);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.06, r * 0.62, 0, 0, 6.2832);
    ctx.fillStyle = bg;
    ctx.fill();

    // 鳞片高光
    ctx.beginPath();
    ctx.ellipse(-r * 0.12, -r * 0.16, r * 0.42, r * 0.22, -0.25, 0, 6.2832);
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    ctx.fill();

    // 眼睛
    const ex = r * 0.6, ey = -r * 0.13;
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.15, 0, 6.2832);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + r * 0.04, ey, r * 0.075, 0, 6.2832);
    ctx.fillStyle = '#08222e';
    ctx.fill();

    // 嘴
    ctx.beginPath();
    ctx.arc(r * 0.95, r * 0.06, r * 0.11, 0.4, 1.55);
    ctx.strokeStyle = 'rgba(10,40,55,.5)';
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.stroke();

    // 饥饿标记
    if (hungry) {
      ctx.scale(s.dir, 1); // 还原方向，避免文字镜像
      ctx.fillStyle = 'rgba(255, 190, 120, .95)';
      ctx.font = `${Math.max(11, r * 0.55)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('!', 0, -r * 1.15);
      ctx.textAlign = 'left';
    }
    ctx.restore();

    // 饱食条（悬停或刚喂食时显示）
    if (hoverId === f.id || s.eat > 0) {
      const w = r * 1.7, bx = s.x - w / 2, by = s.y - r * 1.35;
      ctx.save();
      ctx.globalAlpha = Math.max(0.35, s.eat);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath();
      ctx.roundRect(bx, by, w, 5, 3);
      ctx.fill();
      const pct = Math.max(0.02, f.hunger / 100);
      ctx.fillStyle = f.hunger > 40 ? '#4be0c8' : '#ffcc4d';
      ctx.beginPath();
      ctx.roundRect(bx, by, w * pct, 5, 3);
      ctx.fill();
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------ 交互 */

  // 拖拽：按住鱼跟着指针走；点鱼不再喂食，喂食只在右侧「我的鱼」列表里触发
  let drag = null;      // {id, ox, oy, moved, px, py}
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function localPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!state) return;
    const { x, y } = localPos(e);
    const id = hitTest(x, y);
    if (id == null) return;          // 空白处交给 pointerup 处理
    const s = sims.get(id);
    if (!s) return;
    drag = { id, ox: s.x - x, oy: s.y - y, moved: false, px: x, py: y };
    s.hold = 0;
    hoverId = id;
    canvas.style.cursor = 'grabbing';
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!state) return;
    const { x, y } = localPos(e);
    if (drag) {
      const s = sims.get(drag.id);
      if (!s) { drag = null; return; }
      if (Math.hypot(x - drag.px, y - drag.py) > 3) drag.moved = true;
      // 指针位移映射成鱼的位移，保留抓取时的相对偏移，手感更自然
      s.x = clamp(x + drag.ox, 26, Math.max(26, W - 26));
      s.y = clamp(y + drag.oy, 36, Math.max(36, H - 36));
      s.tx = s.x; s.ty = s.y;
      if (Math.abs(x - drag.px) > 0.5) s.dir = x > drag.px ? 1 : -1;
      drag.px = x; drag.py = y;
      e.preventDefault();
      return;
    }
    hoverId = hitTest(x, y);
    canvas.style.cursor = hoverId != null ? 'grab' : 'default';
  });

  function endDrag(e) {
    if (!state) { drag = null; return; }
    const { x, y } = localPos(e);
    if (drag) {
      const s = sims.get(drag.id);
      if (s) {
        s.hold = 1.2;                // 松手后先原地停留，不要立刻游走
        s.tx = s.x; s.ty = s.y;
      }
      if (!drag.moved) toast('按住鱼可以拖动它；喂食请点右侧「我的鱼」', 2400);
      drag = null;
      canvas.style.cursor = hoverId != null ? 'grab' : 'default';
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { }
      return;
    }
    // 空白处轻点：附近的鱼朝该处游去
    for (const [, s] of sims) {
      if (Math.random() > 0.6) { s.tx = x; s.ty = y; s.hold = 0; }
    }
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', (e) => {
    drag = null;
    canvas.style.cursor = 'default';
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { }
  });
  canvas.addEventListener('pointerleave', () => {
    if (drag) return;
    hoverId = null;
    canvas.style.cursor = 'default';
  });

  function hitTest(mx, my) {
    let best = null, bestD = 1e9;
    for (const f of state.fish) {
      const s = sims.get(f.id);
      if (!s) continue;
      const r = fishRadius(f, s) * 1.15;
      const d = Math.hypot(mx - s.x, my - s.y);
      if (d < r && d < bestD) { bestD = d; best = f.id; }
    }
    return best;
  }

  /* ------------------------------------------------------------ 启动 */

  (async function boot() {
    resize();
    try {
      const me = await api('/api/me');
      if (me.logged_in) {
        await enterGame();
      }
    } catch (e) { }
  })();
})();

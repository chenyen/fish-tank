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

  // 静态背景缓存：水体 / 顶部柔光 / 沙底只在尺寸或主题变化时重画，平时一次贴图
  const bgCanvas = document.createElement('canvas');
  const bgCtx = bgCanvas.getContext('2d');
  let bgDirty = true;

  /* ------------------------------------------------------------ 界面风格
     配色全部来自 style.css 的 CSS 变量，切换主题只改 <html data-theme>，
     canvas 的水体与鱼也读同一套变量（--water-* / --fish-*），保证不撞色。 */
  const THEME_KEY = 'fishTank.theme';
  const THEME_LABEL = { deep: '经典深海', cartoon: '明亮卡通' };

  const pal = {
    waterTop: '#14607f', waterMid: '#0c3f58', waterBot: '#06202e',
    beam: 'rgba(140,235,255,.10)', beamFade: 'rgba(140,235,255,0)',
    bubble: 'rgba(200,240,255,.28)', bubbleFill: 'rgba(200,245,255,.85)',
    plantA: 'rgba(40,150,120,.45)', plantB: 'rgba(30,120,100,.38)',
    sandA: 'rgba(30,70,88,0)', sandB: 'rgba(12,40,54,.95)',
    fishInk: 'rgba(18,44,58,.3)', fishShadow: '#00131c',
    satK: 1, lightK: 1, inkW: 1,
  };

  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const str = (name, fb) => {
      const raw = cs.getPropertyValue(name);
      return raw && raw.trim() ? raw.trim() : fb;
    };
    const num = (name, fb) => {
      const n = parseFloat(str(name, ''));
      return Number.isFinite(n) ? n : fb;
    };
    pal.waterTop = str('--water-top', pal.waterTop);
    pal.waterMid = str('--water-mid', pal.waterMid);
    pal.waterBot = str('--water-bot', pal.waterBot);
    pal.beam = str('--beam', pal.beam);
    pal.beamFade = str('--beam-fade', pal.beamFade);
    pal.bubble = str('--bubble-stroke', pal.bubble);
    pal.bubbleFill = str('--bubble-fill', pal.bubbleFill);
    pal.plantA = str('--plant-a', pal.plantA);
    pal.plantB = str('--plant-b', pal.plantB);
    pal.sandA = str('--sand-a', pal.sandA);
    pal.sandB = str('--sand-b', pal.sandB);
    pal.fishInk = str('--fish-ink', pal.fishInk);
    pal.fishShadow = str('--fish-shadow', pal.fishShadow);
    pal.satK = num('--fish-sat-k', 1);
    pal.lightK = num('--fish-light-k', 1);
    pal.inkW = num('--fish-ink-w', 1);
    bgDirty = true;   // 配色变化，静态背景需重建
  }

  function currentTheme() {
    return document.documentElement.dataset.theme === 'cartoon' ? 'cartoon' : 'deep';
  }

  function syncThemeMenu() {
    const cur = currentTheme();
    document.querySelectorAll('.themeItem').forEach((el) => {
      const on = el.dataset.theme === cur;
      el.classList.toggle('on', on);
      el.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function applyTheme(key, remember) {
    const k = key === 'cartoon' ? 'cartoon' : 'deep';
    document.documentElement.dataset.theme = k;
    if (remember) {
      try { localStorage.setItem(THEME_KEY, k); } catch (e) { }
    }
    readPalette();
    syncThemeMenu();
  }

  function closeThemeMenu() {
    const menu = $('#themeMenu');
    const wrap = $('#userMenu');
    if (menu) menu.classList.add('hidden');
    if (wrap) wrap.classList.remove('open');
    const btn = $('#userBtn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    const hdr = document.querySelector('#game header');
    if (hdr) hdr.classList.remove('menu-open');
  }

  function toggleThemeMenu() {
    const menu = $('#themeMenu');
    const wrap = $('#userMenu');
    if (!menu) return;
    const open = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !open);
    if (wrap) wrap.classList.toggle('open', open);
    const btn = $('#userBtn');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    const hdr = document.querySelector('#game header');
    if (hdr) hdr.classList.toggle('menu-open', open);
  }

  applyTheme(currentTheme(), false);

  $('#userBtn').onclick = (ev) => {
    ev.stopPropagation();
    if (document.querySelector('#shopOverlay') || editingNode) return;
    toggleThemeMenu();
  };

  document.querySelectorAll('.themeItem').forEach((el) => {
    el.onclick = (ev) => {
      ev.stopPropagation();
      const k = el.dataset.theme === 'cartoon' ? 'cartoon' : 'deep';
      const changed = k !== currentTheme();
      applyTheme(k, true);
      closeThemeMenu();
      if (changed) toast('界面风格：' + THEME_LABEL[k], 1600);
    };
  });

  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('#userMenu')) closeThemeMenu();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeThemeMenu();
  });

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

  function applyState(data) {
    const prevCoins = state ? state.coins_exact : null;
    state = data;
    $('#coins').textContent = (data.coins_exact !== undefined ? data.coins_exact : data.coins).toFixed(1);
    $('#pending').textContent = '+' + (data.pending || 0).toFixed(1);
    $('#income').textContent = (data.income_per_hour || 0).toFixed(1);
    const fcount = $('#fishCount');
    if (fcount) fcount.textContent = data.fish.length + ' 条';
    $('#food').textContent = data.food;
    const fm = $('#foodMax');           // 饲料不设上限，已无分母
    if (fm) fm.textContent = data.food_cap ? '/' + data.food_cap : '';
    $('#who').textContent = data.username || '';
    const brandEl = $('#brandTitle');
    if (brandEl && !editingNode) brandEl.textContent = data.title || 'AQUARIUM';

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
      const sim = sims.get(f.id);
      // 新鱼，或者鱼种变了（老数据迁移）都重建运动状态
      if (!sim || sim.species !== (f.species || 'carp')) {
        sims.set(f.id, newSim(f.look || f.species));
      }
    }
    for (const id of [...sims.keys()]) if (!seen.has(id)) sims.delete(id);

    if (!editingNode) renderList(data);

    const cap = (typeof data.capacity === 'number' && data.capacity > 0) ? data.capacity : null;
    const free = cap === null ? Infinity : cap - data.fish.length;
    // 容量为 null 表示后台把上限设为「不限」，此时只按金币判断能否购买
    $('#btnFish').textContent = free > 0 ? '买鱼苗' : `鱼缸已满 ${data.fish.length}/${cap}`;
    $('#btnFish').disabled = free <= 0;      // 价格随鱼种变化，交给弹窗判断
    $('#btnFood').textContent = '买饲料';
    $('#btnFood').disabled = data.coins < data.prices.food_pack;

    const ft = $('#foodTimer');
    ft.textContent = data.next_food_in == null
      ? '饲料不设上限，可以一直囤'
      : `下一份饲料：约 ${Math.ceil(data.next_food_in / 60)} 分钟后（不设上限）`;

    // 买鱼苗弹窗开着时，同步刷新余额 / 空位 / 可买上限
    if (shopEl) syncShopBar();
  }

  function notifyGain(gain) {
    if (!gain) return;
    const parts = [];
    if (gain.payout_amount > 0) {
      parts.push('结算 ' + gain.payout_count + ' 次 +' + gain.payout_amount + ' 金币');
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
      box.innerHTML = '<div class="empty">鱼缸空空如也，去买一条鱼苗吧。</div>';
      return;
    }
    box.innerHTML = data.fish.map((f) => {
      const hunger = Math.round(f.hunger);
      const ageH = (f.age / 3600).toFixed(1);
      const maxed = !f.stage.next_name;          // 已达最高阶段
      const growPct = Math.round(f.stage.progress * 100);
      const rateTxt = f.growth_per_hour ? ` · ${f.growth_per_hour}/时` : '';
      // 距离文案统一用「距升级」，具体目标阶段放到悬停提示里
      const stageGap = Math.max(0, Math.round(f.stage.next_at - f.growth));
      const stageTxt = f.stage.next_name ? '距升级 ' + stageGap : '已满级';
      const stageTip = f.stage.next_name
        ? '当前「' + f.stage.name + '」，再长 ' + stageGap + ' 成长值进入「' + f.stage.next_name + '」'
        : '已达最高阶段';
      const sell = f.sell || {};
      const sellable = !!sell.sellable;
      const sellBar = sellable
        ? `<div class="sellBar"><span class="sellVal" title="可获得 ${fmtCoins(sell.price || 0)} 金币">可卖 <b>${fmtCoins(sell.price || 0)}</b> 金币</span><button class="sellBtn" type="button" data-id="${f.id}">卖出</button></div>`
        : '';
      // 满级后不再显示成长相关（成长进度/成长速率/距下一阶段）
      const growBlock = maxed ? '' : `
        <div class="bar grow"><i style="width:${growPct}%"></i></div>
        <div class="meta"><span>成长 ${growPct}%${rateTxt}</span><span title="${esc(stageTip)}">${stageTxt}</span></div>`;
      return `<div class="fishitem ${sellable ? 'is-max' : ''}" data-id="${f.id}" title="点击喂食">
        <div class="top"><b class="fname" data-id="${f.id}" title="点击给这条鱼改名">${esc(f.name)}</b><span class="topRight"><span class="stag">${esc(f.species_name || '鱼苗')} · ${esc(f.stage.name)}</span></span></div>
        ${growBlock}
        <div class="bar hunger"><i style="width:${hunger}%"></i></div>
        <div class="meta"><span>饱食 ${hunger}% · 已养 ${ageH}h</span><span>${f.coin_rate} 币/时${f.eff < 1 ? ' · 产能 ' + Math.round(f.eff * 100) + '%' : ''}</span></div>
        ${sellBar}
      </div>`;
    }).join('');

    box.querySelectorAll('.fishitem').forEach((el) => {
      el.onclick = (ev) => {
        const sellBtn = ev.target.closest('.sellBtn');
        if (sellBtn) {
          ev.stopPropagation();
          askSellFish(+sellBtn.dataset.id);
          return;
        }
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

  /* ------------------------------------------------------------ 卖出满级鱼 */

  function askSellFish(id) {
    const f = state && state.fish.find((x) => x.id === id);
    if (!f || !f.sell || !f.sell.sellable) return;
    const s = f.sell;
    if (document.querySelector('#sellOverlay')) return;
    const wrap = document.createElement('div');
    wrap.id = 'sellOverlay';
    wrap.className = 'overlay';
    wrap.innerHTML = `<div class="card sellcard">
      <h1>卖出「${esc(f.name)}」</h1>
      <p class="sub">这条鱼已养到满级，确定要卖掉换金币吗？卖出后无法找回。</p>
      <div class="sellAmount"><span>可获得</span><b>${fmtCoins(s.price)}</b><i>金币</i></div>
      <div class="sellActions">
        <button class="btn ghost" id="sellCancel" type="button">再养养</button>
        <button class="btn sellConfirm" id="sellConfirm" type="button">确认卖出</button>
      </div>
    </div>`;
    document.body.appendChild(wrap);
    wrap.onclick = (e) => { if (e.target === wrap) closeSell(); };
    wrap.querySelector('#sellCancel').onclick = closeSell;
    wrap.querySelector('#sellConfirm').onclick = () => doSell(id, wrap);
  }

  function closeSell() {
    const el = document.querySelector('#sellOverlay');
    if (el) el.remove();
  }

  async function doSell(id, wrap) {
    const btn = wrap.querySelector('#sellConfirm');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '卖出中…';
    try {
      const data = await api('/api/fish/sell', 'POST', { fish_id: id });
      closeSell();
      applyState(data);   // 鱼已从 state 移除，sim 由 applyState 统一清理
      const sold = data.sold || {};
      toast(`卖出「${sold.name || '鱼'}」，到手 ${fmtCoins(sold.price || 0)} 金币`, 2600);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '确认卖出';
      toast(e.message, 2000);
    }
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

  $('#btnFish').onclick = () => openShop();

  /* ---------------------------------------------- 「我的鱼」折叠记忆 */
  const FOLD_KEY = 'fishTank.panelCollapsed';

  function applyFold(collapsed, remember) {
    const panel = $('#panel');
    panel.classList.toggle('collapsed', collapsed);
    // 箭头方向完全交给 CSS（#panel.collapsed 时旋转 180°）：展开 ▲ / 折叠 ▼
    const tgl = $('#foldToggle');
    if (tgl) {
      tgl.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      tgl.title = collapsed ? '展开我的鱼' : '折叠我的鱼';
      const head = $('#panelHead');
      if (head) head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
    if (remember) {
      try { localStorage.setItem(FOLD_KEY, collapsed ? '1' : '0'); } catch (e) { }
    }
  }

  function restoreFold() {
    let collapsed = false;
    try { collapsed = localStorage.getItem(FOLD_KEY) === '1'; } catch (e) { }
    applyFold(collapsed, false);
  }

  $('#panelHead').onclick = (ev) => {
    if (ev.target.closest('#btnFeedAll')) return;   // 一键投喂按钮不触发折叠
    applyFold(!$('#panel').classList.contains('collapsed'), true);
  };

  restoreFold();

  /* ---------------------------------------------- 一键投喂（把饱食 <=80% 的鱼喂到 >80%） */
  async function feedAll() {
    const btn = $('#btnFeedAll');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const data = await api('/api/feed-all', 'POST', {});
      applyState(data);
      const r = data.feed_all || { packs: 0, fish: 0, need: 0, short: 0, hungry: 0, cap: 80, fed_ids: [] };
      const cap = r.cap || 80;
      const fed = new Set(r.fed_ids || []);
      let hearts = 0;
      for (const f of data.fish) {
        if (!fed.has(f.id)) continue;       // 只有本次真正喂到的鱼才播吃食动画
        const sim = sims.get(f.id);
        if (!sim) continue;
        sim.eat = 1;
        if (hearts < 8) { spawnHearts(sim.x, sim.y); hearts++; }
      }
      if (!r.hungry) {
        toast(`鱼的饱食都超过 ${cap}%，不用喂`);
      } else if (r.short > 0) {
        toast(`喂了 ${r.fish} 条 · 消耗 ${r.packs} 包饲料，还差 ${r.short} 包才能都喂到 ${cap}% 以上`, 3200);
      } else {
        toast(`已把 ${r.fish} 条鱼喂到 ${cap}% 以上 · 消耗 ${r.packs} 包饲料`, 2600);
      }
    } catch (e) {
      toast(e.message, 2000);
    } finally {
      btn.disabled = false;
    }
  }

  $('#btnFeedAll').onclick = (ev) => { ev.stopPropagation(); feedAll(); };

  /* ------------------------------------------------------ 买鱼苗弹窗 */

  let shopEl = null;        // 当前打开的买鱼苗弹窗
  let shopCart = {};        // key -> 数量，支持一次选多种鱼
  let shopAbort = null;     // 弹窗内监听器的 AbortController，关闭时统一解绑

  function fmtCoins(v) {
    const n = Number(v) || 0;
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  // 金币与鱼缸容量信息（容量 0/null 表示不限）
  function shopCtx() {
    const cap = (typeof state.capacity === 'number' && state.capacity > 0) ? state.capacity : null;
    const free = cap === null ? Infinity : Math.max(0, cap - state.fish.length);
    const coins = state.coins_exact !== undefined ? state.coins_exact : state.coins;
    return { cap: cap, free: free, coins: coins };
  }

  function closeShop() {
    if (shopAbort) { shopAbort.abort(); shopAbort = null; }
    if (shopEl) shopEl.remove();
    shopEl = null;
  }

  function openShop() {
    if (!state) return;
    closeShop();
    shopCart = {};   // 每次打开都从空购物车开始
    shopAbort = new AbortController();

    const wrap = document.createElement('div');
    wrap.id = 'shopOverlay';
    wrap.className = 'overlay';
    wrap.innerHTML = `<div class="card shopcard">
      <h1>选择鱼苗</h1>
      <p class="sub" id="shopSub"></p>
      <div class="speciesGrid" id="shopGrid"></div>
      <div class="buyBar">
        <div class="buyPick"><b id="shopPickName">已选鱼苗</b><span id="shopUnit">点卡片右下角 ＋ 加数量</span></div>
        <div class="buyTotal"><span>合计 <b id="shopCount">0</b> 条</span><span><b class="sum" id="shopTotal">0</b> 金币</span></div>
        <div class="buyHint" id="shopHint"></div>
        <button class="btn" id="shopBuy" type="button">确认购买</button>
      </div>
      <button class="btn full ghost" id="shopClose" type="button">关闭</button>
    </div>`;
    document.body.appendChild(wrap);
    shopEl = wrap;
    wrap.onclick = (e) => { if (e.target === wrap) closeShop(); };
    wrap.querySelector('#shopClose').onclick = closeShop;
    wrap.querySelector('#shopBuy').onclick = () => buyFish();
    renderShopCards();
    syncShopBar();
  }

  // 鱼苗卡片：右下角带独立数量步进器，可同时选多种鱼，最后统一确认购买
  function renderShopCards() {
    if (!shopEl || !state) return;
    const grid = shopEl.querySelector('#shopGrid');
    if (!grid) return;
    const c = shopCtx();
    const list = (state.prices && state.prices.species) || [];
    grid.innerHTML = list.map((sp) => {
      const poor = c.coins < sp.price;
      const full = c.free <= 0;
      const off = poor || full;
      const qty = shopCart[sp.key] || 0;
      const tag = full ? '鱼缸已满' : (poor ? '金币不足' : '点 ＋ 选购');
      return `<div class="species${off ? ' off' : ''}${qty > 0 ? ' picked' : ''}" data-key="${sp.key}">
        <span class="spIcon">${FishArt.iconOf(sp.look || sp.key)}</span>
        <span class="spTop"><b>${esc(sp.name)}</b><i class="spPrice">${sp.price} 币</i></span>
        <span class="spDesc">${esc(sp.desc)}</span>
        <span class="spFoot">
          <span class="spTag">${tag}</span>
          <span class="cardStepper" data-key="${sp.key}">
            <button class="cardStep" type="button" data-key="${sp.key}" data-delta="-1" aria-label="减少${esc(sp.name)}" ${off || qty <= 0 ? 'disabled' : ''}>−</button>
            <b class="cardQty">${qty}</b>
            <button class="cardStep" type="button" data-key="${sp.key}" data-delta="1" aria-label="增加${esc(sp.name)}" ${off ? 'disabled' : ''}>＋</button>
          </span>
        </span>
      </div>`;
    }).join('');
    grid.querySelectorAll('.cardStep').forEach((btn) => {
      bindCardStep(btn, shopAbort ? shopAbort.signal : undefined);
    });
  }

  function changeQty(key, delta) {
    const cur = shopCart[key] || 0;
    const next = Math.max(0, Math.min(999, cur + delta));
    if (next === 0) delete shopCart[key];
    else shopCart[key] = next;

    // 就地更新这张卡片，不重建整个网格：避免卡片闪烁抖动，也保证长按连加时按钮不被销毁
    const card = shopEl && shopEl.querySelector(`#shopGrid .species[data-key="${key}"]`);
    if (card) {
      const qtyEl = card.querySelector('.cardQty');
      if (qtyEl) qtyEl.textContent = String(next);
      const minus = card.querySelector('.cardStep[data-delta="-1"]');
      if (minus) minus.disabled = next <= 0;
      card.classList.toggle('picked', next > 0);
    }
    syncShopBar();
  }

  // 点按加减一次，按住 400ms 后按 70ms 节奏连续调整
  // 所有监听器带 signal：弹窗关闭时统一 abort，避免 window.pointerup 反复累积
  function bindCardStep(el, signal) {
    let delay = null, tick = null;
    const key = el.dataset.key;
    const delta = parseInt(el.dataset.delta, 10);
    const stop = () => {
      if (delay) { clearTimeout(delay); delay = null; }
      if (tick) { clearInterval(tick); tick = null; }
    };
    const fire = () => { if (!el.disabled) changeQty(key, delta); };
    const opt = { signal };
    el.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      ev.preventDefault();
      stop();
      fire();
      delay = setTimeout(() => { delay = null; tick = setInterval(fire, 70); }, 400);
    }, opt);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((n) => el.addEventListener(n, stop, opt));
    window.addEventListener('pointerup', stop, opt);
    el.addEventListener('click', (ev) => { ev.preventDefault(); if (ev.detail === 0) fire(); }, opt);
  }

  // 同步底部购买栏：合计数量、合计金额、主按钮文案与提示
  function syncShopBar() {
    if (!shopEl || !state) return;
    const c = shopCtx();
    const list = (state.prices && state.prices.species) || [];
    const priceOf = {};
    list.forEach((s) => { priceOf[s.key] = Number(s.price) || 0; });

    let count = 0, total = 0, kinds = 0;
    Object.keys(shopCart).forEach((key) => {
      const qty = shopCart[key];
      if (qty > 0) { count += qty; total += priceOf[key] * qty; kinds += 1; }
    });
    total = Math.round(total * 100) / 100;

    const q = (sel) => shopEl.querySelector(sel);
    const subEl = q('#shopSub');
    const nameEl = q('#shopPickName');
    const unitEl = q('#shopUnit');
    const countEl = q('#shopCount');
    const totalEl = q('#shopTotal');
    const buyEl = q('#shopBuy');
    const hintEl = q('#shopHint');

    if (subEl) {
      subEl.textContent = (c.cap === null ? `鱼缸 ${state.fish.length} 条` : `鱼缸 ${state.fish.length}/${c.cap}`)
        + ` · 金币 ${c.coins.toFixed(1)}`;
    }
    if (countEl) countEl.textContent = String(count);
    if (totalEl) totalEl.textContent = fmtCoins(total);
    if (nameEl) nameEl.textContent = kinds ? `已选 ${kinds} 种鱼苗` : '已选鱼苗';
    if (unitEl) unitEl.textContent = kinds ? `共 ${count} 条` : '点卡片右下角 ＋ 加数量';

    const overCap = c.free !== Infinity && count > c.free;
    const overCoin = total > c.coins + 1e-9;
    const can = count > 0 && !overCap && !overCoin;
    if (buyEl) {
      buyEl.disabled = !can;
      buyEl.textContent = can ? `确认购买 ${count} 条`
        : (count < 1 ? '请先选择鱼苗' : (overCap ? '超出鱼缸容量' : '金币不足'));
    }
    if (hintEl) {
      let txt = '', warn = false;
      if (!list.length) { txt = '暂无可购买鱼种'; warn = true; }
      else if (c.free <= 0) { txt = '鱼缸已经满了，先养大现有的鱼吧'; warn = true; }
      else if (count < 1) { txt = '点鱼苗卡片右下角 ＋ 添加数量，可一次选购多种'; }
      else if (overCap) { txt = `鱼缸只剩 ${c.free} 个空位，请减少数量`; warn = true; }
      else if (overCoin) { txt = `金币不足，还差 ${fmtCoins(Math.round((total - c.coins) * 100) / 100)} 金币`; warn = true; }
      else { txt = `金币 ${c.coins.toFixed(1)}，鱼缸空位 ${c.free === Infinity ? '不限' : c.free}`; }
      hintEl.textContent = txt;
      hintEl.classList.toggle('warn', warn);
    }
  }

  // 购买：一次请求带上全部所选鱼种与数量，后端校验总价与容量后原子扣费
  async function buyFish() {
    if (!shopEl || !state) return;
    const list = (state.prices && state.prices.species) || [];
    const valid = {};
    list.forEach((s) => { valid[s.key] = true; });
    const items = Object.keys(shopCart)
      .filter((key) => valid[key] && shopCart[key] > 0)
      .map((key) => ({ species: key, count: shopCart[key] }));
    if (!items.length) return;
    const buyEl = shopEl.querySelector('#shopBuy');
    if (buyEl) { buyEl.disabled = true; buyEl.textContent = '购买中…'; }
    try {
      const data = await api('/api/fish/batch', 'POST', { items });
      afterBuy(data);
    } catch (e) {
      toast(e.message, 2400);
    } finally {
      // 购买成功后 afterBuy 会关闭弹窗；失败时只恢复按钮状态，不重建卡片网格
      if (shopEl) syncShopBar();
    }
  }

  function afterBuy(data) {
    applyState(data);      // 余额、鱼数即时刷新
    const bought = data.bought || {};
    const n = bought.count || 0;
    if (n > 0) {
      const spent = bought.spent || 0;
      toast(`买了 ${n} 条鱼苗 · 花掉 ${fmtCoins(spent)} 金币`, 2400);
      shopCart = {};       // 结算后清空购物车
      closeShop();         // 购买成功后关闭弹窗
    }
  }

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
    wrap.className = 'overlay';
    const rows = rank.length
      ? rank.map((r, i) => `<tr>
          <td class="idx">${i + 1}</td>
          <td>${esc(r.username)}</td>
          <td class="stage">${r.best_stage}</td>
          <td class="num">${r.total_growth}</td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="blank">还没有鱼缸被创建</td></tr>';
    wrap.innerHTML = `<div class="card boardcard">
      <h1>成长排行榜</h1>
      <p class="sub">按全缸鱼的成长值总和排序</p>
      <table class="boardTable">
        <thead><tr>
          <th>#</th>
          <th>玩家</th>
          <th>最好阶段</th>
          <th class="num">总成长</th>
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
    // 离屏背景同尺寸、同 DPR 变换
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    bgCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    bgDirty = true;
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

  /* 性能探针：URL 加 ?perf=1 开启，默认完全关闭、零开销。
     统计 FPS / update+draw 耗时 / JS 堆内存，用于量化优化效果。 */
  const PERF = (function () {
    const on = new URLSearchParams(location.search).get('perf') === '1';
    if (!on) return { on: false, begin() {}, tick() {} };
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;pointer-events:none;'
      + 'font:12px/1.5 ui-monospace,Consolas,monospace;color:#9fe;'
      + 'background:rgba(2,18,26,.82);border:1px solid rgba(120,220,200,.4);'
      + 'border-radius:8px;padding:6px 10px;white-space:pre;';
    document.body.appendChild(el);
    let frames = 0, acc = 0, updMs = 0, drawMs = 0, t0 = performance.now();
    let tUpdate = 0;
    return {
      on: true,
      begin() { tUpdate = performance.now(); },
      tick(updateDone) {
        const u = updateDone - tUpdate;
        const total = performance.now() - updateDone;
        updMs += u; drawMs += total;
        frames++; acc++;
        const now = performance.now();
        if (now - t0 >= 500) {
          const fps = frames * 1000 / (now - t0);
          const mem = performance.memory
            ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + ' MB'
            : 'n/a';
          el.textContent = `FPS ${fps.toFixed(1)}  update ${(updMs / acc).toFixed(2)}ms`
            + `  draw ${(drawMs / acc).toFixed(2)}ms  heap ${mem}`;
          frames = 0; updMs = 0; drawMs = 0; acc = 0; t0 = now;
        }
      },
    };
  })();

  function loopStart() {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  function frame(now) {
    if (document.hidden) { running = false; return; }  // 页面隐藏时停止调度，避免空转耗电降频
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    PERF.begin();
    update(dt);
    const updateDone = performance.now();
    draw(now / 1000);
    PERF.tick(updateDone);
    if (state) requestAnimationFrame(frame);
    else running = false;
  }

  // 切回前台时恢复动画；隐藏时 frame 内已停止调度
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state && !running) loopStart();
  });

  function fishRadius(f, sim) {
    const depth = 0.72 + 0.55 * (sim.y / Math.max(1, H));
    // 体型系数来自后台配置（接口下发的 f.size），缺省回落到内置表现参数
    const size = (typeof f.size === 'number' && f.size > 0)
      ? f.size
      : speciesFx(f.look || f.species || 'carp').size;
    return 26 * f.stage.scale * depth * size;
  }

  /* ---------------------------------------------- 每条鱼独立的游动性格
     pattern  游动模式    speedK 速度系数   wobble/amp 摆尾节奏与幅度
     bandLo/Hi 偏好水深带  idle 停顿   burst 冲刺
     参数在鱼入场时随机生成，因此同一缸里不会有两条轨迹重合。            */

  const PATTERNS = ['cruise', 'cruise', 'sine', 'circle', 'hover', 'bottom'];
  const rnd = (a, b) => a + Math.random() * (b - a);

  // 鱼种表现参数：size 体型、行为在 newSim 里按种类覆写
  const SPECIES_FX = {
    carp: { size: 0.85 }, clown: { size: 0.75 }, shark: { size: 1.9 },
    clam: { size: 1.0 }, goldfish: { size: 0.95 },
    koi: { size: 1.05 }, guppy: { size: 0.6 }, angelfish: { size: 1.1 },
    tetra: { size: 0.52 }, puffer: { size: 0.8 }, seahorse: { size: 0.75 },
  };
  const speciesFx = (key) => SPECIES_FX[key] || SPECIES_FX.carp;

  function newSim(look) {
    // 外观造型决定游动性格；后台新增鱼种未选造型时回落到鲤鱼外形与游法
    const key = FishArt.normalize(look);
    const lo = rnd(0.12, 0.45);
    let hi = Math.min(0.9, lo + rnd(0.15, 0.4));
    const s = {
      species: key,
      x: W * rnd(0.15, 0.85),
      y: H * rnd(lo, hi),
      tx: W * rnd(0.1, 0.9),
      ty: H * rnd(lo, hi),
      dir: Math.random() > 0.5 ? 1 : -1,
      flipCd: 0,               // 朝向翻转冷却计时（秒），配合 faceToward 防抖动
      vx: 0, vy: 0,            // 当前速度向量（px/s），由线性加速度平滑驱动
      hsgn: 1,                 // 横向方向粘滞符号（避免目标在正上下方时逐帧左右翻）
      boost: 1,                // 冲刺倍率（渐变，不是瞬时跳变）
      tempo: rnd(0.6, 1.1),    // 自然游动节奏倍率：0=停顿、1=常速，平滑换挡
      tempoT: rnd(0.6, 1.1),   // 节奏目标倍率
      tempoCd: rnd(1, 4),      // 距下次换挡的倒计时（秒）
      tailFreq: rnd(0.55, 1.75), // 固定摆尾频率个体差异：拉开各鱼摆尾周期，避免整缸同频
      wagAmp: rnd(0.72, 1.25),   // 固定摆尾幅度个体差异：有的鱼摆得大、有的含蓄
      omega: 0,                // circle 模式的角速度（平滑过渡）
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
      idleChance: 0.42,
      idleRange: [0.4, 2.2],
      burst: 0,
      angle: rnd(0, 6.2832),
      radiusXR: rnd(0.05, 0.15),
      radiusYR: rnd(0.05, 0.17),
      cxr: rnd(0.28, 0.72),
      cyr: rnd(0.32, 0.68),
      drift: rnd(0.12, 0.5),
      gape: 0.18,              // 砗磲开合程度
      gapeT: rnd(0, 6),
    };
    s.spin = s.phase > 3.1416 ? 1 : -1;   // circle 固定绕行方向，避免来回抖动
    s.sineDir = s.dir;                    // sine 横向行进方向
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

    if (key === 'shark') {
      // 鲨鱼：体型大、巡游范围广、速度快、很少打盹
      s.pattern = 'cruise';
      s.bandLo = rnd(0.1, 0.28);
      s.bandHi = Math.min(0.74, s.bandLo + rnd(0.34, 0.5));
      s.speedK = rnd(1.0, 1.55);
      s.wobble = rnd(0.7, 1.4);
      s.amp = rnd(4, 12);
      s.idleChance = 0.06;
      s.idleRange = [0.2, 0.8];
      s.y = H * rnd(s.bandLo, s.bandHi);
    } else if (key === 'clown') {
      // 小丑鱼：中层来回穿梭，速度偏快、起伏明显、很少停
      s.pattern = Math.random() < 0.5 ? 'sine' : 'cruise';
      s.bandLo = rnd(0.24, 0.4);
      s.bandHi = Math.min(0.72, s.bandLo + rnd(0.16, 0.3));
      s.speedK = rnd(0.95, 1.45);
      s.wobble = rnd(1.1, 2.0);
      s.amp = rnd(10, 20);
      s.idleChance = 0.18;
      s.idleRange = [0.3, 1.2];
      s.y = H * rnd(s.bandLo, s.bandHi);
    } else if (key === 'clam') {
      // 砗磲：落底不动，只开合贝壳
      s.pattern = 'sessile';
      s.speedK = rnd(0.4, 0.85);
      s.x = W * rnd(0.14, 0.86);
      s.y = Math.min(H - 44, H * rnd(0.86, 0.93));
      s.tx = s.x; s.ty = s.y;
      s.dir = 1;
      s.idle = 0;
      s.idleChance = 1;
      s.gape = rnd(0.1, 0.4);
    } else if (key === 'goldfish' || key === 'koi') {
      // 金鱼 / 锦鲤：慢悠悠 MID 层巡游，宽鳍大幅摆动
      s.pattern = Math.random() < 0.5 ? 'cruise' : 'sine';
      s.bandLo = rnd(0.2, 0.42);
      s.bandHi = Math.min(0.78, s.bandLo + rnd(0.2, 0.34));
      s.speedK = rnd(0.5, 0.9);
      s.wobble = rnd(1.2, 2.2);
      s.amp = rnd(14, 24);
      s.idleChance = 0.26;
      s.idleRange = [0.7, 2.6];
    } else if (key === 'guppy' || key === 'tetra') {
      // 孔雀鱼 / 灯鱼：小鱼群活跃穿梭，摆尾频率高
      s.pattern = Math.random() < 0.6 ? 'sine' : 'cruise';
      s.bandLo = rnd(0.22, 0.5);
      s.bandHi = Math.min(0.8, s.bandLo + rnd(0.18, 0.32));
      s.speedK = rnd(0.95, 1.45);
      s.wobble = rnd(2, 3.2);
      s.amp = rnd(7, 16);
      s.idleChance = 0.12;
    } else if (key === 'angelfish') {
      // 神仙鱼：长鳍慢摆，偏中层小范围悬停
      s.pattern = Math.random() < 0.5 ? 'hover' : 'sine';
      s.bandLo = rnd(0.28, 0.46);
      s.bandHi = Math.min(0.72, s.bandLo + rnd(0.14, 0.26));
      s.speedK = rnd(0.42, 0.78);
      s.wobble = rnd(0.7, 1.3);
      s.amp = rnd(12, 22);
      s.idleChance = 0.3;
    } else if (key === 'puffer') {
      // 河豚：圆滚滚，小鳍快速扑腾，活动范围小
      s.pattern = 'hover';
      s.bandLo = rnd(0.3, 0.55);
      s.bandHi = Math.min(0.78, s.bandLo + rnd(0.12, 0.22));
      s.speedK = rnd(0.32, 0.66);
      s.wobble = rnd(2.6, 4);
      s.amp = rnd(5, 11);
      s.idleChance = 0.22;
    } else if (key === 'seahorse') {
      // 海马：悬停为主，只在中层微微起伏
      s.pattern = 'hover';
      s.bandLo = rnd(0.24, 0.48);
      s.bandHi = Math.min(0.74, s.bandLo + rnd(0.1, 0.2));
      s.speedK = rnd(0.15, 0.32);
      s.wobble = rnd(0.6, 1.2);
      s.amp = rnd(3, 8);
      s.idleChance = 0.55;
      s.idleRange = [1.2, 3.6];
    }
    s.hsgn = s.dir;            // 横向粘滞方向与初始朝向一致
    // 固定绘制层级：只在建鱼时按初始 y 定一次，之后不再随实时位置变化。
    // 否则两条鱼上下游动、y 一交叉，前后顺序每帧翻转，看起来像相互穿体。
    s.layer = s.y;
    return s;
  }

  function pickTarget(s) {
    const lo = Math.max(40, H * s.bandLo);
    const hi = Math.min(H - 40, Math.max(lo + 30, H * s.bandHi));
    s.tx = W * rnd(0.08, 0.92);
    s.ty = rnd(lo, hi);
  }

  // 统一朝向翻转：滞回阈值 + 转向冷却，避免鱼停在目标点附近时每帧左右镜像翻转
  const FLIP_HYST = 12;          // 水平差值小于该值（px）时保持当前朝向，不翻转
  const FLIP_COOLDOWN = 0.3;     // 两次翻转之间的最小间隔（秒）

  function faceToward(s, dx) {
    if (Math.abs(dx) < FLIP_HYST) return;        // 距离太近，维持原朝向
    const want = dx > 0 ? 1 : -1;
    if (want === s.dir) return;                  // 已经是这个朝向
    if (s.flipCd > 0) return;                    // 转向冷却中，暂不翻转
    s.dir = want;
    s.flipCd = FLIP_COOLDOWN;
  }

  // 线性加速度 + 角度插值的统一游动积分：速度大小与航向都只能按上限逐帧逼近目标，
  // 位置始终连续推进，因此不会再出现「到点 return」造成的整帧静止。
  const TILT_CRUISE = 0.80;    // 巡航时相对水平的最大倾角（约 46°），保证横向一直在动
  const TILT_HOVER = 0.80;     // 悬停时允许的上下摆尾倾角（约 46°）
  const TILT_CIRCLE = 1.15;    // 绕圈时限制在椭圆左右端点处的垂直切向，避免只上下平移
  const TILT_BOTTOM = 0.62;    // 贴底慢速巡游更偏水平，慢速下也保证横向位移够大

  function normAng(a) {
    return Math.atan2(Math.sin(a), Math.cos(a));
  }

  // 把目标航向限制在「接近水平」的锥形范围内，避免出现只上下平移、横向卡死的泳姿。
  // 期望航向本身接近正上/正下（横向分量极小）时，横向一侧改用粘滞符号 hsgn，
  // 避免目标在本鱼正上/正下方时航向逐帧在左右两侧来回翻、结果只剩上下动。
  function clampTilt(ang, maxTilt, hsgn) {
    const down = Math.sin(ang) >= 0;
    const cosA = Math.cos(ang);
    let sgnH;
    if (Math.abs(cosA) >= 0.25) sgnH = cosA > 0 ? 1 : -1;
    else sgnH = (hsgn === undefined || hsgn === null) ? (cosA >= 0 ? 1 : -1) : (hsgn >= 0 ? 1 : -1);
    if (sgnH > 0) return down ? maxTilt : -maxTilt;
    return down ? Math.PI - maxTilt : -Math.PI + maxTilt;
  }

  function stepFish(s, dt, speed) {
    if (s.flipCd > 0) s.flipCd = Math.max(0, s.flipCd - dt);   // 冷却计时
    // 砗磲：钉在原位，只做开合贝壳
    if (s.pattern === 'sessile') {
      s.gapeT += dt;
      const wave = 0.5 + 0.5 * Math.sin(s.gapeT * (0.4 + s.speedK * 0.45) + s.phase * 0.3);
      const target = Math.pow(wave, 2.4);       // 多数时间微张，偶尔大张
      s.gape += (target - s.gape) * Math.min(1, dt * 2.0);
      s.x = s.tx; s.y = s.ty;
      s.vx = 0; s.vy = 0;
      return;
    }

    const vCruise = Math.max(5, speed * s.speedK);   // 该鱼的巡航速度（含鱼种个性）
    const acc = vCruise * 3.4 + 30;                  // 加速度上限 px/s²
    const dec = vCruise * 4.2 + 36;                  // 减速上限 px/s²
    const turn = 3.0 + s.speedK * 1.1;                // 最大转向角速度 rad/s

    // 冲刺：倍率逐帧渐变到 1.45，不再出现瞬时 ×1.75 的速度阶跃
    if (s.burst > 0) s.burst = Math.max(0, s.burst - dt);
    else if (Math.random() < dt * 0.06) s.burst = rnd(0.6, 1.2);
    const boostT = s.burst > 0 ? 1.45 : 1;
    s.boost += (boostT - s.boost) * Math.min(1, dt * 2.2);

    // 自然游动节奏：每条鱼独立在「停顿 / 慢游 / 常速 / 快游」之间平滑换挡，
    // 让同一条鱼时快时慢、偶尔停下来，而不是一直匀速。
    s.tempoCd -= dt;
    if (s.tempoCd <= 0) {
      const r = Math.random();
      if (r < 0.16) {              // 停顿：真正停下来悬着
        s.tempoT = rnd(0, 0.06);
        s.tempoCd = rnd(1.6, 4.2);
      } else if (r < 0.42) {       // 慢游
        s.tempoT = rnd(0.22, 0.52);
        s.tempoCd = rnd(2.5, 5.5);
      } else if (r < 0.82) {       // 常速
        s.tempoT = rnd(0.82, 1.12);
        s.tempoCd = rnd(2.5, 6);
      } else {                     // 快游
        s.tempoT = rnd(1.22, 1.5);
        s.tempoCd = rnd(1.8, 4);
      }
    }
    s.tempo += (s.tempoT - s.tempo) * Math.min(1, dt * 0.9);   // 平滑换挡，不突变

    // 打盹：到点小憩时进一步压低节奏
    if (s.idle > 0) s.idle = Math.max(0, s.idle - dt);
    const idleK = s.idle > 0 ? (s.pattern === 'crawl' ? 0.12 : 0.28) : 1;
    const vTop = vCruise * s.boost * s.tempo * idleK;

    // 正弦波浪：横向匀速往返，贴边直接折返（速度大小不变，位置不抖）
    if (s.pattern === 'sine') {
      const v = vTop * 0.9;
      const mid = H * (s.bandLo + s.bandHi) / 2;
      const wobK = Math.min(1, s.tempo * 2.5);   // 停顿时上下摆动也停
      const vyWob = (Math.cos(s.phase * s.wobble) * s.amp * 1.4 + (mid - s.y) * 0.55) * wobK;
      s.x += s.sineDir * v * dt;
      s.y += vyWob * dt;
      if (s.x > W - 30) { s.x = W - 30; s.sineDir = -1; }
      if (s.x < 30) { s.x = 30; s.sineDir = 1; }
      s.vx = s.sineDir * v;
      s.vy = vyWob;
      faceToward(s, s.sineDir * 100);
      return;
    }

    let dvx = 0, dvy = 0;      // 本帧的目标速度向量

    if (s.pattern === 'circle') {
      // 沿椭圆切线前进：角速度按「本鱼巡航速度 / 当前切向半径」换算，
      // 让轨迹点与鱼同速，鱼不会追不上轨迹点也不会被拖着瞬移
      const aE = W * s.radiusXR, bE = H * s.radiusYR;
      const tang = Math.max(20, Math.hypot(aE * Math.sin(s.angle), bE * Math.cos(s.angle)));
      const omegaT = s.spin * Math.min(2.2, (vTop * 0.85) / tang);
      s.omega += (omegaT - s.omega) * Math.min(1, dt * 2.5);
      s.angle += s.omega * dt;
      s.cxr += Math.sin(s.angle * s.drift) * dt * 0.05;
      s.cyr += Math.cos(s.angle * s.drift * 1.3) * dt * 0.04;
      s.cxr = Math.max(0.2, Math.min(0.8, s.cxr));
      s.cyr = Math.max(0.24, Math.min(0.76, s.cyr));
      const nx = W * s.cxr + Math.cos(s.angle) * aE;
      const ny = H * s.cyr + Math.sin(s.angle) * bE;
      const sgn = s.omega >= 0 ? 1 : -1;
      const tx2 = -Math.sin(s.angle) * aE * sgn;
      const ty2 = Math.cos(s.angle) * bE * sgn;
      const tl = Math.hypot(tx2, ty2) || 1;
      const spd2 = vTop * 0.85;
      const corrK = Math.min(1, s.tempo * 2.5);   // 停顿时纠偏也停，不被拖着走
      const corrX = Math.max(-18, Math.min(18, (nx - s.x) * 0.25)) * corrK;   // 纠偏有上限，避免误差累积后速度失控
      const corrY = Math.max(-18, Math.min(18, (ny - s.y) * 0.25)) * corrK;
      dvx = (tx2 / tl) * spd2 + corrX;     // 切线速度 + 限幅纠偏
      dvy = (ty2 / tl) * spd2 + corrY;
      // 切向在椭圆左右端点附近接近垂直，这里限制倾角，让鱼横向兜过去而不是只上下平移
      const magC = Math.hypot(dvx, dvy) || 1;
      const magCap = Math.max(spd2 * 1.12, 12 * Math.min(1, s.tempo * 2.5));   // 目标速度上限：巡游切速附近，避免纠偏把速度顶飞
      const angC = clampTilt(Math.atan2(dvy, dvx), TILT_CIRCLE);
      dvx = Math.cos(angC) * magC;
      dvy = Math.sin(angC) * magC;
      if (magC > magCap) {
        const kc = magCap / magC;
        dvx *= kc; dvy *= kc;
      }
    } else {
      // 悬停：隔一会儿换个落脚点，但换点不为零位移
      if (s.pattern === 'hover' && Math.random() < dt * 0.18) pickTarget(s);
      let dx = s.tx - s.x, dy = s.ty - s.y;
      let dist = Math.hypot(dx, dy);
      const reach = Math.max(s.pattern === 'crawl' ? 8 : 16, vTop * dt * 2.2);
      if (dist < reach) {
        // 到点只换目标，本帧继续按新目标推进，不再 return 静止一帧
        if (Math.random() < s.idleChance) s.idle = rnd(s.idleRange[0], s.idleRange[1]);
        pickTarget(s);
        dx = s.tx - s.x; dy = s.ty - s.y;
        dist = Math.hypot(dx, dy) || 1;
      }
      const inv = 1 / (dist || 1);
      // 接近目标线性减速，但保留最低巡航分量，避免速度塌陷成停顿
      const floorK = s.pattern === 'hover' ? 0.5 : 0.42;
      const slowK = Math.min(1, dist / (vCruise * 0.9 + 1));
      const spd = vTop * (floorK + (1 - floorK) * slowK);
      const wobK = Math.min(1, s.tempo * 2.5);   // 停顿时摆尾位移归零
      dvx = dx * inv * spd;
      dvy = dy * inv * spd + Math.sin(s.phase * s.wobble) * s.amp * 0.5 * wobK;
      // 限制泳姿倾角，保证横向始终有位移（不会出现"只上下动"的卡顿）
      const mag = Math.hypot(dvx, dvy) || 1;
      const tiltCap = s.pattern === 'hover' ? TILT_HOVER
        : (s.pattern === 'bottom' ? TILT_BOTTOM : TILT_CRUISE);
      // 横向粘滞方向：只有明显偏到另一侧才改，避免目标在本鱼正上/正下方时航向左右逐帧翻
      if (dx > 6) s.hsgn = 1;
      else if (dx < -6) s.hsgn = -1;
      const ang = clampTilt(Math.atan2(dvy, dvx), tiltCap, s.hsgn);
      dvx = Math.cos(ang) * mag;
      dvy = Math.sin(ang) * mag;
    }

    // ---- 线性加速度 + 角度插值 ----
    const spdT = Math.hypot(dvx, dvy);
    let spdNow = Math.hypot(s.vx, s.vy);
    const dSpd = spdT - spdNow;
    const maxDSpd = (dSpd > 0 ? acc : dec) * dt;
    spdNow = Math.max(0, spdNow + Math.max(-maxDSpd, Math.min(maxDSpd, dSpd)));
    // 速度下限跟随节奏：停顿挡（tempo 接近 0）允许真正停下，其余挡位保留少量漂移避免卡顿观感
    if (s.pattern !== 'crawl') {
      const minMove = Math.max(24, vCruise * 0.40) * Math.min(1, s.tempo * 2.5);
      if (spdNow < minMove) spdNow = minMove;
    }

    const angT = Math.atan2(dvy, dvx);
    let angNow = (spdNow > 1e-3 && (Math.abs(s.vx) + Math.abs(s.vy) > 1e-3))
      ? Math.atan2(s.vy, s.vx) : angT;
    const maxTurn = turn * dt;
    let dif = normAng(angT - angNow);
    if (Math.abs(dif) > maxTurn) dif = Math.sign(dif) * maxTurn;
    angNow = normAng(angNow + dif);

    s.vx = Math.cos(angNow) * spdNow;
    s.vy = Math.sin(angNow) * spdNow;
    // 横向位移硬下限：转向过程中航向会经过正上/正下，此时纯竖直位移看起来像"横向卡住"。
    // 这里只把横向分量抬到总速度的 55%（纵向分量不动，速度大小最多涨 9%），
    // 横向符号沿用粘滞方向，因此是连续滑行而不是左右抖动。
    if (s.pattern !== 'crawl') {
      const gx = s.tx - s.x;
      if (gx > 6) s.hsgn = 1;
      else if (gx < -6) s.hsgn = -1;
      const minVx = spdNow * 0.55 * Math.min(1, s.tempo * 2.5);
      if (Math.abs(s.vx) < minVx) s.vx = s.hsgn * minVx;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;

    // 朝向只影响镜面翻转，不参与位移，因此翻转不会打断位置连续性
    faceToward(s, Math.cos(angNow) * 100);
  }

  function update(dt) {
    if (!state) return;
    for (const f of state.fish) {
      const s = sims.get(f.id);
      if (!s) continue;

      // 被拖拽的鱼完全跟随指针，不参与自主游动
      if (drag && drag.id === f.id) {
        s.phase += dt * 6;
        s.vx = 0; s.vy = 0;
        continue;
      }
      // 刚放下的鱼先原地停留一会儿
      if (s.hold > 0) {
        s.hold = Math.max(0, s.hold - dt);
        s.phase += dt * 1.8;
        s.vx = 0; s.vy = 0;
        continue;
      }

      const energy = f.hunger < 15 ? 0.45 : 1;
      // 后台「游动速度倍率」统一缩放游速（缺省 1 兼容旧状态）
      const speedK = (state.rules && state.rules.swim_speed) || 1;
      const speed = (26 + f.stage.scale * 22) * energy * speedK;
      stepFish(s, dt, speed);

      // 边界兜底
      s.x = Math.max(30, Math.min(W - 30, s.x));
      s.y = Math.max(40, Math.min(H - 40, s.y));
      // 摆尾节奏跟随游动速度：停顿时摆尾也慢下来，快游时更欢快
      s.phase += dt * (1.2 + speed * 0.05 * s.tempo) * (0.7 + s.speedK * 0.4) * (0.35 + 0.65 * s.tempo) * s.tailFreq;
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
    // 静态背景一次贴图（水体 / 柔光 / 沙底）
    if (bgDirty) buildBackground();
    ctx.drawImage(bgCanvas, 0, 0, W, H);

    // 动态水草叶片
    drawPlants(t);

    // 气泡
    for (const b of bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, 6.2832);
      ctx.strokeStyle = pal.bubble;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (!state) return;

    // 鱼（按固定层级排序：谁在前面就一直在前面，不随游动时的 y 变化来回翻转）
    const list = state.fish
      .map((f) => ({ f, s: sims.get(f.id) }))
      .filter((o) => o.s);
    // 惰性补齐固定层级（兼容尚未重建的旧 sim）：按当前 y 定一次后不再变化
    for (const o of list) {
      if (o.s.layer === undefined) o.s.layer = o.s.y;
    }
    list.sort((a, b) => {
      const ad = drag && drag.id === a.f.id ? 1 : 0;
      const bd = drag && drag.id === b.f.id ? 1 : 0;
      if (ad !== bd) return ad - bd;     // 拖拽中的鱼画在最上层
      return (a.s.layer - b.s.layer) || (a.f.id - b.f.id);  // 固定层级；相同时用 id 兜底保证稳定
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
        ctx.fillStyle = pal.bubbleFill;
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
      ctx.strokeStyle = i % 2 ? pal.plantA : pal.plantB;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }

  // 静态背景（水体渐变 / 顶部柔光 / 沙底）画到离屏画布，仅在尺寸或配色变化时重建
  function buildBackground() {
    const c = bgCtx;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, pal.waterTop);
    g.addColorStop(0.45, pal.waterMid);
    g.addColorStop(1, pal.waterBot);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    // 顶部柔光：两主题统一用静态横向柔光，替代原来的 4 条动态光柱（省 4 个渐变 + 多边形）
    const cartoon = currentTheme() === 'cartoon';
    const glow = c.createLinearGradient(0, 0, 0, H * 0.55);
    if (cartoon) {
      glow.addColorStop(0, 'rgba(205,238,255,.6)');
      glow.addColorStop(0.45, 'rgba(180,230,255,.24)');
      glow.addColorStop(1, 'rgba(180,230,255,0)');
    } else {
      glow.addColorStop(0, pal.beam);
      glow.addColorStop(0.5, pal.beamFade);
      glow.addColorStop(1, 'rgba(140,235,255,0)');
    }
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H * 0.55);

    // 沙底
    const sg = c.createLinearGradient(0, H - 26, 0, H);
    sg.addColorStop(0, pal.sandA);
    sg.addColorStop(1, pal.sandB);
    c.fillStyle = sg;
    c.fillRect(0, H - 26, W, 26);

    bgDirty = false;
  }

  // 饥饿标记画在世界坐标里，不受鱼的朝向/旋转影响
  function drawHungerMark(s, r) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 190, 120, .95)';
    ctx.font = `${Math.max(11, r * 0.55)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('!', s.x, s.y - r * 1.15);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // 影子（吃到东西时随水面投影）
  function drawShadow(r) {
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.95, r * 0.85, r * 0.22, 0, 0, 6.2832);
    ctx.fillStyle = pal.fishShadow;
    ctx.fill();
    ctx.restore();
  }

  function drawFish(f, s, t) {
    const r = fishRadius(f, s);
    const look = FishArt.normalize(f.look || f.species);
    const hungry = f.hunger < 15;
    const wag = Math.sin(s.phase) * 0.32 * s.wagAmp;
    const tilt = Math.sin(s.phase * 0.6) * 0.05;
    // 饱和度/明度按主题微调：明亮卡通更饱和明亮，经典深海保持原样
    const sat = Math.min(96, (hungry ? 26 : 62) * pal.satK);
    const light = Math.min(80, (hungry ? 50 : 62) * pal.lightK);

    ctx.save();
    ctx.translate(s.x, s.y);
    if (look !== 'clam') {
      ctx.scale(s.dir, 1);
      ctx.rotate(tilt);
      drawShadow(r);
    }
    FishArt.draw(ctx, {
      look, r, hue: f.hue, sat, light, wag, id: f.id, time: t,
      ink: pal.fishInk, inkW: pal.inkW, gape: s.gape, phase: s.phase,
    });
    ctx.restore();

    if (hungry) drawHungerMark(s, r);

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
  let topSeq = 0;       // 拖动置顶序号：拖动过的鱼 layer 设为 TOP_BASE + 序号，永远画在未拖动的鱼前面
  const TOP_BASE = 1e9; // 远高于普通鱼的 layer（初始 y，范围 0~H）
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
        s.layer = TOP_BASE + (++topSeq);  // 拖动过的鱼固定置顶，放开后依然画在最前；最后拖的在最前
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

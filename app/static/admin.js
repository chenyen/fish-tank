/* 中后台管理：读取 / 保存鱼缸运行参数与鱼种表 */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));

  let cfg = null;
  let toastTimer = null;

  const TOAST_MIN_MS = 1800;

  /* 提示条：单实例，连续触发只重置计时并重播入场动画，不叠加多层 */
  function toast(msg, opts) {
    const el = $('#toast');
    if (!el) return;

    let ms = TOAST_MIN_MS;
    let type = 'success';
    if (typeof opts === 'number') {
      ms = Math.max(opts, TOAST_MIN_MS);
    } else if (opts && typeof opts === 'object') {
      if (typeof opts.ms === 'number') ms = Math.max(opts.ms, TOAST_MIN_MS);
      if (opts.type) type = opts.type;
    }
    const failed = type === 'error' || type === 'fail';

    el.className = failed ? 'toast--error' : 'toast--success';
    while (el.firstChild) el.removeChild(el.firstChild);
    const icon = document.createElement('span');
    icon.className = 'toastIcon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = failed ? '✕' : '✓';
    const text = document.createElement('span');
    text.className = 'toastText';
    text.textContent = msg;
    el.appendChild(icon);
    el.appendChild(text);
    el.setAttribute('role', failed ? 'alert' : 'status');
    el.setAttribute('aria-live', failed ? 'assertive' : 'polite');

    /* 重播入场动画：先移除 show 触发回流，再加回，保证淡入从 -8px 开始 */
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      toastTimer = null;
    }, ms);
  }

  async function api(path, method, body) {
    const opt = { method: method || 'GET', headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    const res = await fetch(path, opt);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const detail = data && (data.detail || data.message);
      const err = new Error(typeof detail === 'string' && detail ? detail : `请求失败（${res.status}）`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ------------------------------------------------------------ 登录 */

  function showLogin() {
    $('#console').classList.add('hidden');
    $('#login').classList.remove('hidden');
    const pwd = $('#adPwd');
    if (pwd) { pwd.value = ''; pwd.focus(); }
  }

  async function enterConsole() {
    $('#login').classList.add('hidden');
    $('#console').classList.remove('hidden');
    await loadConfig();
  }

  async function doLogin() {
    const username = $('#adUser').value.trim();
    const password = $('#adPwd').value;
    const hint = $('#loginHint');
    hint.textContent = '';
    if (!username || !password) { hint.textContent = '请输入账号和密码'; return; }
    try {
      await api('/api/admin/login', 'POST', { username, password });
      $('#adWho').textContent = username;
      await enterConsole();
      toast('登录成功');
    } catch (e) {
      hint.textContent = e.message;
    }
  }

  $('#adLogin').onclick = doLogin;
  $('#adPwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

  $('#btnOut').onclick = async () => {
    try { await api('/api/admin/logout', 'POST', {}); } catch (e) { /* 忽略 */ }
    showLogin();
    toast('已退出后台');
  };

  /* ------------------------------------------------------------ 读取 / 渲染 */

  async function loadConfig() {
    try {
      applyConfig(await api('/api/admin/config'));
    } catch (e) {
      if (e.status === 401) { showLogin(); return; }
      toast(e.message, { ms: 3500, type: 'error' });
    }
  }

  function applyConfig(data) {
    cfg = data;
    if (data.admin && data.admin.username) $('#adWho').textContent = data.admin.username;
    renderParams();
    renderSpecies();
  }

  function renderParams() {
    const grid = $('#paramGrid');
    let lastGroup = null;
    grid.innerHTML = cfg.fields.map((f) => {
      const value = cfg.params[f.key];
      const unit = f.unit ? `<span class="unit">${esc(f.unit)}</span>` : '';
      let head = '';
      if (f.group && f.group !== lastGroup) {
        lastGroup = f.group;
        head = `<div class="pGroup">${esc(f.group)}</div>`;
      }
      return `${head}<div class="pField" data-key="${f.key}">
        <label>${esc(f.label)}<i>${f.min} ~ ${f.max}</i></label>
        <div class="row">
          <input type="number" data-pkey="${f.key}" value="${value}"
                 min="${f.min}" max="${f.max}" step="${f.step || 1}" />
          ${unit}
        </div>
        <div class="phint">${esc(f.hint || '')}</div>
      </div>`;
    }).join('');

    const capInput = grid.querySelector('[data-pkey="tank_capacity"]');
    if (capInput) {
      const hint = capInput.closest('.pField').querySelector('.phint');
      const sync = () => {
        const v = Number(capInput.value);
        hint.textContent = v > 0
          ? `当前限制：最多 ${v} 条鱼，缸满后前台会拒绝购鱼`
          : '当前状态：不限容量，缸内养鱼数量没有上限';
      };
      capInput.addEventListener('input', sync);
      sync();
    }
  }

  /* ------------------------------------------------------------ 外观库 */

  function allLooks() {
    return (cfg && cfg.looks && cfg.looks.length) ? cfg.looks : FishArt.LOOKS;
  }

  function lookItem(key) {
    const k = FishArt.normalize(key);
    return allLooks().find((x) => x.key === k) || {
      key: k, label: FishArt.labelOf(k), icon: FishArt.iconOf(k), hue: 28, desc: '',
    };
  }

  function lookOptionsHtml(selected) {
    const raw = String(selected == null ? '' : selected).trim();
    const cur = raw ? FishArt.normalize(raw) : '';   // 空值（新增行）不预选任何造型
    const opts = allLooks().map((l) => {
      const key = FishArt.normalize(l.key);
      return `<option value="${esc(key)}"${key === cur ? ' selected' : ''}>${esc(l.label || FishArt.labelOf(key))}</option>`;
    }).join('');
    // 占位项：有选中造型时仍排在最前（便于改回），但不会重复出现两个选中项
    return `<option value=""${cur ? '' : ' selected'}>请选择外观</option>` + opts;
  }

  // 选了外观后，名称 / 描述跟着该造型同步；已手动改过的字段不再覆盖
  function applyLookMeta(tr, lookKey) {
    if (!tr) return;
    if (tr.dataset.new !== '1') return;   // 只同步新增行，已有鱼种的名称描述保持原样
    const item = lookKey ? lookItem(lookKey) : null;
    const nameInp = tr.querySelector('[data-f="name"]');
    const descInp = tr.querySelector('[data-f="desc"]');
    if (nameInp && tr.dataset.nameDirty !== '1') {
      const prev = tr.dataset.autoName || '';
      const cur = nameInp.value.trim();
      if (!cur || cur === prev) {
        nameInp.value = item ? (item.label || FishArt.labelOf(lookKey)) : '';
        tr.dataset.autoName = nameInp.value;
      }
    }
    if (descInp && tr.dataset.descDirty !== '1') {
      const prev = tr.dataset.autoDesc || '';
      const cur = descInp.value.trim();
      if (!cur || cur === prev) {
        descInp.value = item ? (item.desc || '') : '';
        tr.dataset.autoDesc = descInp.value;
      }
    }
  }

  function drawLookPreview(canvas, look, hue, ready) {
    if (!canvas) return;
    const item = lookItem(look);
    const cssW = canvas.clientWidth || Number(canvas.getAttribute('width')) || 104;
    const cssH = canvas.clientHeight || Number(canvas.getAttribute('height')) || 62;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, cssW, cssH);
    const bg = c.createLinearGradient(0, 0, 0, cssH);
    bg.addColorStop(0, '#164860');
    bg.addColorStop(1, '#082634');
    c.fillStyle = bg;
    c.fillRect(0, 0, cssW, cssH);
    const key = FishArt.normalize(item.key);
    const tall = key === 'angelfish' || key === 'seahorse';
    const r = Math.min(cssW / 3.1, cssH / (tall ? 2.9 : 2.5));
    c.save();
    c.translate(cssW / 2, cssH / 2 + (tall ? 3 : 1));
    if (key !== 'clam') c.scale(-1, 1);   // 造型朝左，和鱼缸里的默认朝向一致
    FishArt.draw(c, {
      look: key, r, hue: Number(hue == null ? item.hue : hue),
      sat: 72, light: 64, ink: 'rgba(8,30,42,.55)', inkW: 1.1,
      wag: 0.16, gape: 0.46, phase: 0.7,
    });
    c.restore();
    // 图片造型首帧会回退手绘；素材就绪后自动重画为真实图片（ready 标记避免重复登记）
    if (!ready && FishArt.needsImage && FishArt.needsImage(key) && FishArt.whenReady) {
      FishArt.whenReady(key, () => {
        if (canvas.isConnected) drawLookPreview(canvas, look, hue, true);
      });
    }
  }

  let currentCat = '全部';   // 当前外观分类；'全部' 表示不过滤
  try { currentCat = sessionStorage.getItem('adLookCat') || '全部'; } catch (e) { /* 忽略隐私模式 */ }
  const CAT_ORDER = ['淡水鱼', '海水鱼', '特色生物'];

  function renderLookCatTabs() {
    const box = $('#lookCatTabs');
    if (!box) return;
    const looks = allLooks();
    // 按预置顺序归类外观，未标注 cat 的归入「其他」，保证不丢项
    const groups = new Map();
    looks.forEach((l) => {
      const c = (l.cat && String(l.cat).trim()) || '其他';
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(l);
    });
    const cats = ['全部', ...CAT_ORDER.filter((c) => groups.has(c)),
      ...Array.from(groups.keys()).filter((c) => c !== '全部' && !CAT_ORDER.includes(c))];
    // 记住的分类若已不存在（如配置变更），回落到「全部」
    if (!cats.includes(currentCat)) currentCat = '全部';

    box.innerHTML = cats.map((c) => {
      const n = c === '全部' ? looks.length : groups.get(c).length;
      return `<button class="lookCatTab${c === currentCat ? ' is-active' : ''}" type="button"
        role="tab" aria-selected="${c === currentCat ? 'true' : 'false'}" data-cat="${esc(c)}">${esc(c)}<span class="catNum">${n}</span></button>`;
    }).join('');

    box.querySelectorAll('.lookCatTab').forEach((b) => {
      b.onclick = () => {
        currentCat = b.dataset.cat;
        try { sessionStorage.setItem('adLookCat', currentCat); } catch (e) { /* 忽略隐私模式 */ }
        renderLookCatTabs();
        renderLookGallery();
      };
    });
  }

  function renderLookGallery() {
    const box = $('#lookGallery');
    if (!box) return;
    const looks = currentCat === '全部'
      ? allLooks()
      : allLooks().filter((l) => (((l.cat && String(l.cat).trim()) || '其他') === currentCat));
    box.innerHTML = looks.map((l) => {
      const key = FishArt.normalize(l.key);
      return `<div class="lookCard" data-look="${esc(key)}">
        <canvas class="lookCanvas" width="104" height="62"></canvas>
        <span class="lookMeta"><b>${esc(l.label || FishArt.labelOf(key))}</b><i>${esc(l.desc || '')}</i></span>
      </div>`;
    }).join('');
    box.querySelectorAll('.lookCanvas').forEach((canvas) => {
      drawLookPreview(canvas, canvas.closest('.lookCard').dataset.look);
    });
  }

  function drawRowPreview(tr) {
    if (!tr) return;
    const sel = tr.querySelector('[data-f="look"]');
    const canvas = tr.querySelector('[data-look-preview]');
    if (!sel || !canvas) return;
    if (!sel.value) { drawLookPlaceholder(canvas); return; }
    drawLookPreview(canvas, sel.value);
  }

  function drawLookPlaceholder(canvas) {
    if (!canvas) return;
    const cssW = canvas.clientWidth || Number(canvas.getAttribute('width')) || 96;
    const cssH = canvas.clientHeight || Number(canvas.getAttribute('height')) || 52;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, cssW, cssH);
    const bg = c.createLinearGradient(0, 0, 0, cssH);
    bg.addColorStop(0, '#123c52');
    bg.addColorStop(1, '#061f2b');
    c.fillStyle = bg;
    c.fillRect(0, 0, cssW, cssH);
    c.fillStyle = 'rgba(190, 225, 240, .45)';
    c.font = '11px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('待选外观', cssW / 2, cssH / 2);
  }

  function rowHtml(sp) {
    const locked = (sp.used || 0) > 0;   // 已有鱼在用的鱼种，标识不允许改，避免老数据失联
    const isNew = !!sp._new;             // 新增但尚未保存的行：允许「移除」撤销
    return `<tr data-key="${esc(sp.key)}" data-used="${sp.used || 0}"${isNew ? ' data-new="1"' : ''}>
      <td class="colKey">
        <input type="text" data-f="key" value="${esc(sp.key)}" ${locked ? 'disabled' : ''} />
      </td>
      <td class="colName">
        <input type="text" data-f="name" value="${esc(sp.name)}" maxlength="20" />
        ${locked ? `<span class="usedTag">${sp.used} 条鱼在用</span>` : ''}
      </td>
      <td class="colLook">
        <span class="lookCell">
          <canvas class="lookThumb" width="96" height="52" data-look-preview></canvas>
          <select data-f="look">${lookOptionsHtml(sp.look || sp.key)}</select>
        </span>
      </td>
      <td class="colNum"><input type="number" data-f="price" value="${sp.price}" min="0" step="1" /></td>
      <td class="colNum"><input type="number" data-f="size" value="${sp.size}" min="0.2" max="4" step="0.05" /></td>
      <td class="colNum"><input type="number" data-f="coin" value="${sp.coin}" min="0" max="100" step="0.05" /></td>
      <td class="colDesc"><textarea class="spDescBox" data-f="desc" maxlength="200">${esc(sp.desc)}</textarea></td>
      <td class="colOn"><input type="checkbox" data-f="enabled" ${sp.enabled ? 'checked' : ''} /></td>
      <td class="colDel">${isNew
        ? '<button class="spDel" type="button" title="撤销这条未保存的新增">移除</button>'
        : '<span class="spNoDel" title="已添加的鱼种不能删除，请取消「上架」来下架">已入库</span>'}</td>
    </tr>`;
  }

  function bindRows() {
    const tbody = $('#spTable').querySelector('tbody');
    tbody.querySelectorAll('tr').forEach(drawRowPreview);
    tbody.querySelectorAll('[data-f="look"]').forEach((sel) => {
      sel.onchange = () => {
        const tr = sel.closest('tr');
        applyLookMeta(tr, sel.value);     // 名称 / 描述随外观同步
        drawRowPreview(tr);
      };
    });
    // 手动改过名称或描述后，不再被外观同步覆盖
    tbody.querySelectorAll('[data-f="name"]').forEach((inp) => {
      inp.oninput = () => { inp.closest('tr').dataset.nameDirty = '1'; };
    });
    tbody.querySelectorAll('[data-f="desc"]').forEach((inp) => {
      inp.oninput = () => { inp.closest('tr').dataset.descDirty = '1'; };
    });
    tbody.querySelectorAll('.spDel').forEach((btn) => {
      btn.onclick = () => {
        const tr = btn.closest('tr');
        const name = tr.querySelector('[data-f="name"]').value || tr.dataset.key;
        tr.remove();
        toast(`已从列表移除「${name}」，点「保存全部」后生效`);
      };
    });
  }

  function renderSpecies() {
    renderLookCatTabs();
    renderLookGallery();
    $('#spTable').querySelector('tbody').innerHTML = cfg.species.map(rowHtml).join('');
    bindRows();
  }

  function addSpecies() {
    const tbody = $('#spTable').querySelector('tbody');
    const blank = {
      key: '', name: '', price: 20, size: 1, coin: 1, desc: '',
      enabled: 1, used: 0, look: '', _new: true,
    };
    tbody.insertAdjacentHTML('beforeend', rowHtml(blank));
    bindRows();
    const tr = tbody.lastElementChild;
    tr.querySelector('[data-f="key"]').focus();
    toast('已新增一行，填写标识与名称后保存');
  }

  /* ------------------------------------------------------------ 保存 */

  function collectParams() {
    const out = {};
    document.querySelectorAll('[data-pkey]').forEach((inp) => {
      if (inp.value === '') return;      // 留空视为不修改
      out[inp.dataset.pkey] = Number(inp.value);
    });
    return out;
  }

  function collectSpecies() {
    const rows = Array.prototype.map.call(
      document.querySelectorAll('#spTable tbody tr'),
      (tr) => {
        const get = (f) => tr.querySelector(`[data-f="${f}"]`);
        return {
          key: get('key').value.trim().toLowerCase(),
          name: get('name').value.trim(),
          price: Number(get('price').value),
          size: Number(get('size').value),
          coin: Number(get('coin').value),
          desc: get('desc').value.trim(),
          look: get('look') ? get('look').value.trim() : '',
          enabled: get('enabled').checked ? 1 : 0,
        };
      }
    );
    // 「标识」列已隐藏：新增行的标识由所选外观自动生成，并保证不与已有标识重复
    const used = new Set(rows.map((r) => r.key).filter(Boolean));
    rows.forEach((r) => {
      if (r.key) return;
      const base = (r.look || 'fish').replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'fish';
      let k = base, i = 2;
      while (used.has(k)) { k = base + i; i += 1; }
      used.add(k);
      r.key = k;
      r.autoKey = true;      // 保存后回传，方便提示用户新增鱼种的标识
    });
    return rows;
  }

  function showWarnings(list) {
    const box = $('#saveHint');
    if (!list || !list.length) { box.textContent = ''; return; }
    box.innerHTML = '<span style="color:#ffcc4d">' + list.map(esc).join('<br>') + '</span>';
  }

  async function saveAll() {
    const params = collectParams();
    const species = collectSpecies();
    // 新增鱼种必须先选定外观造型，避免保存出一个外观不明的鱼种
    const noLook = species.find((sp) => !sp.look);
    if (noLook) {
      toast(`请先为「${noLook.name || '新增鱼种'}」选择外观造型`, { ms: 3500, type: 'error' });
      return;
    }
    const btns = [$('#btnSave'), $('#btnSave2')];
    btns.forEach((b) => { if (b) b.disabled = true; });
    showWarnings([]);
    try {
      const data = await api('/api/admin/config', 'POST', { params, species });
      applyConfig(data);
      showWarnings(data.warnings);
      const newKeys = species.filter((s) => s.autoKey).map((s) => `${s.name || s.key}(${s.key})`);
      $('#saveHint2').textContent = '已保存 ' + new Date().toLocaleTimeString();
      toast(data.warnings && data.warnings.length
        ? '已保存，前台立即生效（' + data.warnings.length + ' 条提示）'
        : '已保存，前台立即生效' + (newKeys.length ? '，新增标识 ' + newKeys.join('、') : ''));
    } catch (e) {
      if (e.status === 401) { showLogin(); toast('登录状态已过期，请重新登录', { ms: 3000, type: 'error' }); return; }
      toast(e.message, { ms: 4000, type: 'error' });
      showWarnings([e.message]);
    } finally {
      btns.forEach((b) => { if (b) b.disabled = false; });
    }
  }

  $('#btnSave').onclick = saveAll;
  $('#btnSave2').onclick = saveAll;
  $('#btnAddSp').onclick = addSpecies;

  $('#btnReset').onclick = () => {
    cfg.params = Object.assign({}, cfg.defaults.params);
    cfg.species = cfg.defaults.species.map((sp) => Object.assign({ used: 0 }, sp));
    renderParams();
    renderSpecies();
    toast('已填入出厂参数，点「保存全部」后生效');
  };

  /* ------------------------------------------------------------ 修改密码 */

  $('#btnPwd').onclick = () => {
    $('#oldPwd').value = '';
    $('#newPwd').value = '';
    $('#newPwd2').value = '';
    $('#pwdHint').textContent = '';
    $('#pwdOverlay').classList.remove('hidden');
    $('#oldPwd').focus();
  };

  $('#pwdCancel').onclick = () => $('#pwdOverlay').classList.add('hidden');

  $('#pwdOk').onclick = async () => {
    const oldPwd = $('#oldPwd').value;
    const newPwd = $('#newPwd').value;
    const again = $('#newPwd2').value;
    const hint = $('#pwdHint');
    if (newPwd.length < 6) { hint.textContent = '新密码至少 6 位'; return; }
    if (newPwd !== again) { hint.textContent = '两次输入的新密码不一致'; return; }
    try {
      await api('/api/admin/password', 'POST', { old: oldPwd, new: newPwd });
      $('#pwdOverlay').classList.add('hidden');
      toast('密码已更新，请牢记新密码');
    } catch (e) {
      hint.textContent = e.message;
    }
  };

  /* ------------------------------------------------------------ 外观预览折叠 */

  function initFoldLooks() {
    const box = $('#lookLibrary');
    const btn = $('#btnFoldLooks');
    if (!box || !btn) return;

    function setFolded(folded, remember) {
      box.classList.toggle('folded', folded);
      btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
      // 展开时重绘：折叠期间 canvas 尺寸为 0，首帧是错的
      if (!folded) {
        box.querySelectorAll('.lookCanvas').forEach((canvas) => {
          drawLookPreview(canvas, canvas.closest('.lookCard').dataset.look);
        });
      }
      if (remember) {
        try { sessionStorage.setItem('adLooksFolded', folded ? '1' : '0'); } catch (e) { /* 忽略隐私模式 */ }
      }
    }

    btn.addEventListener('click', () => {
      setFolded(!box.classList.contains('folded'), true);
    });

    let saved = '';
    try { saved = sessionStorage.getItem('adLooksFolded') || ''; } catch (e) { /* 忽略 */ }
    setFolded(saved === '1', false);
  }

  initFoldLooks();

  /* ------------------------------------------------------------ 分类 Tabs */

  function initTabs() {
    const tabs = Array.prototype.slice.call(document.querySelectorAll('.adTab[data-tab]'));
    const panels = Array.prototype.slice.call(document.querySelectorAll('.tabPanel[data-panel]'));
    if (!tabs.length || !panels.length) return;

    function activate(name, remember) {
      tabs.forEach((b) => {
        const on = b.dataset.tab === name;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panels.forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
      // 面板隐藏时 canvas 取不到真实宽度，切回可见后重绘外观预览
      if (name === 'species') {
        renderLookGallery();
        document.querySelectorAll('#spTable tbody tr').forEach(drawRowPreview);
      }
      if (remember) {
        try { sessionStorage.setItem('adTab', name); } catch (e) { /* 忽略隐私模式 */ }
      }
    }

    tabs.forEach((b) => b.addEventListener('click', () => activate(b.dataset.tab, true)));

    let saved = '';
    try { saved = sessionStorage.getItem('adTab') || ''; } catch (e) { /* 忽略 */ }
    activate(saved === 'species' ? 'species' : 'global', false);
  }

  initTabs();

  /* ------------------------------------------------------------ 启动 */

  (async function boot() {
    try {
      const me = await api('/api/admin/me');
      if (me && me.logged_in) {
        $('#adWho').textContent = me.username || 'admin';
        await enterConsole();
        return;
      }
    } catch (e) { /* 忽略，落到登录页 */ }
    showLogin();
  })();
})();

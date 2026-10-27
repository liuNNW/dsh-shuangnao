/**
 * 双脑模型 · 浏览器半侧
 *
 * 手写 lazy-CJS bundle 协议（window.__ModuleLoader__.load + factory），无构建步骤：
 *   - require('react') 由宿主平台模块表提供
 *   - 数据来自宿主半侧的 /dual-brain/* 路由
 *
 * 交互：每个脑一个"选择模型"控件，点开是「渠道分组 + 模型行 + 搜索」的菜单，
 * 一次点击同时定下 provider 与 model（不存在"选了渠道模型还空着"的中间态）。
 * 菜单用 fixed 定位，能逃出设置页的滚动容器，不会被卡片裁切。
 *
 * 视觉约束：单一强调色（品牌蓝）、无渐变、无 emoji 图标（全部内联 SVG）、
 * 无位移动画；只保留 border/background 的 120ms 状态过渡。
 *
 * 槽位：settings.models.footer（主入口）/ plugins.item（后备），都带 try/catch
 * 和 error boundary——任一失败只丢一张卡片，不让设置页白屏。
 */
window.__ModuleLoader__.load({
  id: 'dsh-dual-brain-live',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const react = require('react');
    const h = react.createElement;
    const useState = react.useState;
    const useEffect = react.useEffect;
    const useMemo = react.useMemo;
    const useRef = react.useRef;

    const API = 'dual-brain';
    const EFFORTS = ['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    const BRAINS = [
      { key: 'plan', title: '规划脑', hint: '出框架、拆步骤，主脑用 delegate(mode="plan") 调它。' },
      { key: 'exec', title: '执行脑', hint: '按框架动手，主脑用 delegate(mode="exec") 调它。' },
    ];

    function apiUrl(route) {
      try {
        return new URL(API + '/' + route, document.baseURI).href;
      } catch {
        return '/' + API + '/' + route;
      }
    }

    async function getJson(route) {
      const response = await fetch(apiUrl(route), { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }

    async function postJson(route, payload) {
      const response = await fetch(apiUrl(route), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      let parsed = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      if (!response.ok) throw new Error((parsed && parsed.error) || ('HTTP ' + response.status));
      return parsed;
    }

    /* ---------- 图标：内联 SVG，不用 emoji 也不用字符箭头 ---------- */

    function icon(paths, size) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      }, paths.map((d, index) => h('path', { key: index, d })));
    }

    const chevronDown = (size) => icon(['M4.5 6.5 8 10 11.5 6.5'], size ?? 14);
    const chevronUp = (size) => icon(['M4.5 9.5 8 6 11.5 9.5'], size ?? 14);
    const checkMark = (size) => icon(['M3.5 8.4 6.6 11.4 12.5 4.8'], size ?? 14);
    const magnifier = (size) => icon(['M7.2 11.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Z', 'M10.4 10.4 13 13'], size ?? 14);

    /* ---------- 样式 ---------- */
    /* 令牌优先取宿主主题变量，取不到才用本地回退值。中性色阶 4 级 + 1 个强调色。 */

    const CSS = [
      '.dbl-card{--dbl-fg:var(--dsw-alias-label-primary,#1f2328);--dbl-fg2:var(--dsw-alias-label-secondary,#5b6270);--dbl-fg3:var(--dsw-alias-label-tertiary,#747c88);',
      '--dbl-line:var(--dsw-alias-border-l1,#eceef1);--dbl-line2:var(--dsw-alias-border-l2,#cdd3da);--dbl-surface:var(--dsw-alias-bg-layer-1,#fff);',
      '--dbl-surface2:var(--dsw-alias-bg-layer-2,#f6f7f9);--dbl-hover:var(--dsw-alias-bg-hover,rgba(17,24,39,.045));--dbl-accent:var(--dsw-alias-brand,#2563eb);',
      '--dbl-shadow:0 12px 32px rgba(17,24,39,.10),0 2px 6px rgba(17,24,39,.06);',
      'box-sizing:border-box;font:inherit;color:var(--dbl-fg);border:1px solid var(--dbl-line);border-radius:10px;padding:16px;margin-top:14px;background:var(--dbl-surface)}',
      '.dbl-card *{box-sizing:border-box}',
      '.dbl-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:4px}',
      '.dbl-title{font-size:13px;font-weight:600;line-height:1.4;margin:0;flex:none}',
      '.dbl-desc{font-size:12px;line-height:1.65;color:var(--dbl-fg2);margin:0 0 14px}',
      '.dbl-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}',
      '@media (max-width:640px){.dbl-grid{grid-template-columns:minmax(0,1fr)}}',
      '.dbl-brain{min-width:0}',
      '.dbl-brain-hd{display:flex;align-items:baseline;gap:6px;margin-bottom:4px}',
      '.dbl-brain-name{font-size:12px;font-weight:600}',
      '.dbl-brain-hint{font-size:11px;line-height:1.5;color:var(--dbl-fg3);margin:0 0 8px;min-height:3em;',
      'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.dbl-trigger{display:flex;align-items:center;gap:10px;width:100%;min-height:42px;padding:8px 10px;font:inherit;text-align:left;color:inherit;',
      'border:1px solid var(--dbl-line2);border-radius:8px;background:var(--dbl-surface);cursor:pointer;transition:border-color 120ms ease-out,background-color 120ms ease-out}',
      '.dbl-trigger:hover{border-color:#a9b1bb;background:var(--dbl-hover)}',
      '.dbl-trigger:focus-visible{outline:2px solid var(--dbl-accent);outline-offset:1px}',
      '.dbl-trigger[disabled]{opacity:.55;cursor:default}',
      '.dbl-trigger-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.dbl-trigger-main{font-size:13px;font-weight:500;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dbl-trigger-meta{font-size:11px;line-height:1.3;color:var(--dbl-fg3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dbl-trigger-empty .dbl-trigger-main{font-weight:400;color:var(--dbl-fg3)}',
      '.dbl-chev{flex:none;color:var(--dbl-fg2);display:flex}',
      '.dbl-menu{position:fixed;z-index:900;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dbl-line2);border-radius:10px;',
      'background:var(--dbl-surface);box-shadow:var(--dbl-shadow)}',
      '.dbl-search-row{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dbl-line);color:var(--dbl-fg3)}',
      '.dbl-search{flex:1;min-width:0;border:0;background:transparent;font:inherit;font-size:12px;color:var(--dbl-fg);outline:none;padding:0}',
      '.dbl-search::placeholder{color:var(--dbl-fg3)}',
      '.dbl-list{overflow-y:auto;overscroll-behavior:contain;padding:6px 0 6px;min-height:0}',
      '.dbl-group-title{padding:7px 12px 3px;font-size:11px;font-weight:500;color:var(--dbl-fg3);background:var(--dbl-surface)}',
      '.dbl-group-title + .dbl-item{margin-top:1px}',
      '.dbl-item{display:flex;align-items:center;gap:8px;width:calc(100% - 12px);margin:0 6px;padding:7px 12px;border:0;border-radius:6px;background:transparent;font:inherit;',
      'text-align:left;color:inherit;cursor:pointer}',
      '.dbl-item:hover{background:var(--dbl-hover)}',
      '.dbl-item:focus-visible{outline:2px solid var(--dbl-accent);outline-offset:-2px}',
      '.dbl-item[data-current="1"]{font-weight:600;background:rgba(37,99,235,.06)}',
      '.dbl-item-name{flex:1;min-width:0;font-size:13px;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dbl-item-id{flex:none;max-width:42%;font-size:10px;line-height:1.5;color:var(--dbl-fg3);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dbl-item-check{flex:none;display:flex;color:var(--dbl-accent);width:14px}',
      '.dbl-clear{margin-top:4px;color:var(--dbl-fg2)}',
      '.dbl-clear:hover{color:#b42318;background:rgba(180,35,24,.07)}',
      '.dbl-empty{padding:14px 12px;font-size:12px;line-height:1.6;color:var(--dbl-fg2)}',
      '.dbl-empty-btn{margin-top:8px;font:inherit;font-size:12px;padding:0;border:0;background:none;color:var(--dbl-accent);cursor:pointer;text-decoration:underline}',
      '.dbl-empty-btn:focus-visible{outline:2px solid var(--dbl-accent);outline-offset:2px;border-radius:3px}',
      '.dbl-effort{display:flex;align-items:center;gap:8px;margin-top:8px}',
      '.dbl-effort-label{font-size:11px;color:var(--dbl-fg3);flex:none}',
      '.dbl-select{flex:1;min-width:0;font:inherit;font-size:12px;padding:4px 8px;border:1px solid var(--dbl-line2);border-radius:6px;',
      'background:var(--dbl-surface);color:var(--dbl-fg);cursor:pointer}',
      '.dbl-select:focus-visible{outline:2px solid var(--dbl-accent);outline-offset:1px}',
      '.dbl-select[disabled]{opacity:.55;cursor:default}',
      '.dbl-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:16px;padding-top:12px;border-top:1px solid var(--dbl-line)}',
      '.dbl-btn{font:inherit;font-size:12px;font-weight:500;padding:6px 14px;border-radius:7px;border:1px solid transparent;background:var(--dbl-accent);color:#fff;cursor:pointer;',
      'transition:opacity 120ms ease-out}',
      '.dbl-btn:hover{opacity:.9}',
      '.dbl-btn:focus-visible{outline:2px solid var(--dbl-accent);outline-offset:2px}',
      '.dbl-btn[disabled]{opacity:.5;cursor:default}',
      '.dbl-btn-ghost{background:transparent;color:var(--dbl-fg2);border-color:var(--dbl-line2)}',
      '.dbl-btn-ghost:hover{background:var(--dbl-hover);opacity:1}',
      '.dbl-status{font-size:11px;line-height:1.5;margin:0;color:var(--dbl-fg2)}',
      '.dbl-top .dbl-status{flex:0 1 62%;text-align:right}',
      '.dbl-status-ok{color:#15803d}',
      '.dbl-status-err{color:#b42318}',
      '.dbl-path{margin:8px 0 0;font-size:10px;line-height:1.5;color:var(--dbl-fg3);word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
      '.dbl-hintline{margin:12px 0 0;font-size:11px;line-height:1.6;color:var(--dbl-fg3)}',
    ].join('');

    function ensureCss() {
      try {
        if (typeof document === 'undefined') return;
        if (document.querySelector('style[data-dbl-css]') !== null) return;
        const style = document.createElement('style');
        style.dataset.dblCss = '1';
        style.textContent = CSS;
        document.head.appendChild(style);
      } catch {
        /* 样式失败不影响功能 */
      }
    }

    function emptySlot() {
      return { provider: '', model: '', reasoningEffort: '' };
    }

    function normalize(raw) {
      const source = raw !== null && typeof raw === 'object' ? raw : {};
      const pick = (slot) => {
        const value = slot !== null && typeof slot === 'object' ? slot : {};
        return {
          provider: typeof value.provider === 'string' ? value.provider : '',
          model: typeof value.model === 'string' ? value.model : '',
          reasoningEffort: typeof value.reasoningEffort === 'string' ? value.reasoningEffort : '',
        };
      };
      return { plan: pick(source.plan), exec: pick(source.exec) };
    }

    /** 把目录摊平成可搜索的行，保留渠道顺序。 */
    function flatten(catalog) {
      const rows = [];
      for (const provider of catalog) {
        for (const model of provider.models || []) {
          rows.push({
            provider: provider.id,
            providerName: provider.name || provider.id,
            model: model.id,
            modelName: model.name || model.id,
            haystack: (provider.name + ' ' + provider.id + ' ' + model.name + ' ' + model.id).toLowerCase(),
          });
        }
      }
      return rows;
    }

    function matches(row, query) {
      const needle = query.trim().toLowerCase();
      if (needle === '') return true;
      if (row.haystack.indexOf(needle) !== -1) return true;
      let index = 0;
      for (const char of row.haystack) {
        if (char === needle[index]) index += 1;
        if (index === needle.length) return true;
      }
      return false;
    }

    /* ---------- 模型选择器 ---------- */

    function ModelPicker(props) {
      const catalog = props.catalog;
      const slot = props.slot;
      const onChange = props.onChange;
      const onReload = props.onReload;
      const disabled = props.disabled;

      const [open, setOpen] = useState(false);
      const [query, setQuery] = useState('');
      const [box, setBox] = useState(null);
      const anchorRef = useRef(null);
      const searchRef = useRef(null);
      const rafRef = useRef(0);

      const rows = useMemo(() => flatten(catalog), [catalog]);
      const groups = useMemo(() => {
        const filtered = rows.filter((row) => matches(row, query));
        const order = [];
        const byProvider = new Map();
        for (const row of filtered) {
          if (!byProvider.has(row.provider)) {
            byProvider.set(row.provider, { id: row.provider, name: row.providerName, rows: [] });
            order.push(row.provider);
          }
          byProvider.get(row.provider).rows.push(row);
        }
        return order.map((id) => byProvider.get(id));
      }, [rows, query]);

      const current = rows.find((row) => row.provider === slot.provider && row.model === slot.model);
      const title = current !== undefined ? current.modelName : slot.model;
      const subtitle = current !== undefined ? current.providerName : slot.provider;

      const place = () => {
        try {
          const anchor = anchorRef.current;
          if (anchor === null) return;
          const rect = anchor.getBoundingClientRect();
          const width = Math.min(Math.max(rect.width, 320), Math.max(280, window.innerWidth - 24));
          const spaceBelow = window.innerHeight - rect.bottom - 12;
          const spaceAbove = rect.top - 12;
          const height = Math.min(360, Math.max(200, Math.max(spaceBelow, spaceAbove)));
          const below = spaceBelow >= 200 || spaceBelow >= spaceAbove;
          const left = Math.min(rect.left, Math.max(12, window.innerWidth - width - 12));
          setBox({
            left: Math.max(12, left),
            top: below ? rect.bottom + 6 : undefined,
            bottom: below ? undefined : window.innerHeight - rect.top + 6,
            width,
            maxHeight: height,
          });
        } catch {
          setBox(null);
        }
      };

      /** 合并到下一帧：滚动时每帧最多重算一次，不抖动。 */
      const schedule = () => {
        if (rafRef.current !== 0) return;
        const raf = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : (callback) => setTimeout(callback, 16);
        rafRef.current = raf(() => {
          rafRef.current = 0;
          place();
        });
      };

      useEffect(() => {
        if (!open) return undefined;

        place();
        try {
          if (searchRef.current !== null) searchRef.current.focus({ preventScroll: true });
        } catch {
          try {
            if (searchRef.current !== null) searchRef.current.focus();
          } catch { /* 忽略 */ }
        }

        const onDown = (event) => {
          const anchor = anchorRef.current;
          if (anchor !== null && anchor.contains(event.target)) return;
          if (event.target && typeof event.target.closest === 'function' && event.target.closest('.dbl-menu') !== null) return;
          setOpen(false);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        // 滚动只重算位置，不关闭；菜单内部的滚动直接忽略（fixed 定位不受影响）
        const onScroll = (event) => {
          const target = event.target;
          if (target && typeof target.closest === 'function' && target.closest('.dbl-menu') !== null) return;
          const anchor = anchorRef.current;
          if (anchor === null) return;
          const rect = anchor.getBoundingClientRect();
          if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
            setOpen(false);
            return;
          }
          schedule();
        };
        const onResize = () => schedule();

        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        return () => {
          if (rafRef.current !== 0) {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current);
            else clearTimeout(rafRef.current);
            rafRef.current = 0;
          }
          document.removeEventListener('mousedown', onDown);
          document.removeEventListener('keydown', onKey);
          window.removeEventListener('scroll', onScroll, true);
          window.removeEventListener('resize', onResize);
        };
      }, [open]);

      const choose = (row) => {
        onChange({ provider: row.provider, model: row.model });
        setOpen(false);
        setQuery('');
      };

      const trigger = h('button', {
        type: 'button',
        ref: anchorRef,
        className: 'dbl-trigger' + (title === '' ? ' dbl-trigger-empty' : ''),
        'aria-expanded': open ? 'true' : 'false',
        'aria-haspopup': 'dialog',
        disabled: disabled,
        onClick: () => setOpen((value) => !value),
      },
      h('span', { className: 'dbl-trigger-body' },
        h('span', { className: 'dbl-trigger-main' }, title === '' ? '未选择' : title),
        h('span', { className: 'dbl-trigger-meta' }, title === '' ? '点击选择渠道与模型' : subtitle)),
      h('span', { className: 'dbl-chev' }, open ? chevronUp(16) : chevronDown(16)));

      let listBody;
      if (groups.length === 0) {
        const noCatalog = catalog.length === 0;
        listBody = h('div', { className: 'dbl-empty' },
          noCatalog ? '没读到模型目录。' : '没有匹配「' + query + '」的模型。',
          noCatalog
            ? h('div', null, h('button', {
              type: 'button',
              className: 'dbl-empty-btn',
              onClick: () => { onReload(); },
            }, '重新读取目录'), ' · 或确认插件已在「插件」页启用')
            : h('div', null, h('button', {
              type: 'button',
              className: 'dbl-empty-btn',
              onClick: () => setQuery(''),
            }, '清空搜索')));
      } else {
        listBody = groups.map((group) => h('div', { key: group.id },
          h('div', { className: 'dbl-group-title' }, group.name),
          group.rows.map((row) => {
            const selected = row.provider === slot.provider && row.model === slot.model;
            return h('button', {
              key: row.provider + '\u0000' + row.model,
              type: 'button',
              className: 'dbl-item',
              'data-current': selected ? '1' : undefined,
              'aria-pressed': selected ? 'true' : 'false',
              onClick: () => choose(row),
            },
            h('span', { className: 'dbl-item-name' }, row.modelName),
            row.modelName === row.model ? null : h('span', { className: 'dbl-item-id' }, row.model),
            h('span', { className: 'dbl-item-check' }, selected ? checkMark(14) : null));
          })));
      }

      const menuStyle = box === null
        ? { display: 'none' }
        : {
          left: box.left,
          top: box.top === undefined ? 'auto' : box.top,
          bottom: box.bottom === undefined ? 'auto' : box.bottom,
          width: box.width,
          maxHeight: box.maxHeight,
        };

      const menu = open
        ? h('div', { className: 'dbl-menu', style: menuStyle, role: 'group', 'aria-label': '模型列表' },
          h('div', { className: 'dbl-search-row' },
            magnifier(14),
            h('input', {
              className: 'dbl-search',
              type: 'search',
              value: query,
              placeholder: '搜索渠道或模型',
              ref: searchRef,
              onChange: (event) => setQuery(event.target.value),
            })),
          h('div', { className: 'dbl-list' },
            listBody,
            (slot.provider !== '' || slot.model !== '')
              ? h('button', {
                type: 'button',
                className: 'dbl-item dbl-clear',
                onClick: () => {
                  onChange({ provider: '', model: '' });
                  setOpen(false);
                  setQuery('');
                },
              }, h('span', { className: 'dbl-item-name' }, '清空这个脑的模型'))
              : null))
        : null;

      return h('div', null, trigger, menu);
    }

    /* ---------- 卡片 ---------- */

    function DualBrainCard() {
      const [config, setConfig] = useState(null);
      const [catalog, setCatalog] = useState(null);
      const [catalogError, setCatalogError] = useState('');
      const [busy, setBusy] = useState(false);
      const [status, setStatus] = useState(null);
      const [file, setFile] = useState('');

      const loadCatalog = async () => {
        try {
          const models = await getJson('models');
          if (models && Array.isArray(models.providers)) setCatalog(models.providers);
          setCatalogError(models && Array.isArray(models.errors) ? models.errors.join('；') : '');
        } catch (error) {
          setCatalogError(String(error.message || error));
        }
      };

      useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const loaded = await getJson('config');
            if (!alive) return;
            setConfig(normalize(loaded.config));
            setFile(typeof loaded.file === 'string' ? loaded.file : '');
          } catch (error) {
            if (!alive) return;
            setConfig({ plan: emptySlot(), exec: emptySlot() });
            setStatus({ kind: 'err', text: '读取配置失败：' + String(error.message || error) });
          }
          if (alive) await loadCatalog();
        })();
        return () => {
          alive = false;
        };
      }, []);

      const patchSlot = (key, next) => {
        setConfig((current) => {
          const value = normalize(current);
          value[key] = Object.assign({}, value[key], next);
          return value;
        });
        setStatus(null);
      };

      const providers = Array.isArray(catalog) ? catalog : [];

      const save = async () => {
        setBusy(true);
        setStatus(null);
        try {
          const result = await postJson('config', { config: normalize(config) });
          setConfig(normalize(result.config));
          const warnings = Array.isArray(result.warnings) ? result.warnings : [];
          setStatus(warnings.length > 0
            ? { kind: 'err', text: '已保存，但有警告：' + warnings.join('；') }
            : { kind: 'ok', text: '已保存，下一次 delegate 调用就生效' });
        } catch (error) {
          setStatus({ kind: 'err', text: '保存失败：' + String(error.message || error) });
        } finally {
          setBusy(false);
        }
      };

      const reload = async () => {
        try {
          const loaded = await getJson('config');
          setConfig(normalize(loaded.config));
          await loadCatalog();
          setStatus({ kind: 'ok', text: '已重新读取' });
        } catch (error) {
          setStatus({ kind: 'err', text: '读取失败：' + String(error.message || error) });
        }
      };

      const renderBrain = (meta) => {
        const slot = config === null ? emptySlot() : config[meta.key];
        return h('div', { className: 'dbl-brain', key: meta.key },
          h('div', { className: 'dbl-brain-hd' }, h('span', { className: 'dbl-brain-name' }, meta.title)),
          h('p', { className: 'dbl-brain-hint' }, meta.hint),
          h(ModelPicker, {
            catalog: providers,
            slot,
            disabled: busy,
            onChange: (next) => patchSlot(meta.key, next),
            onReload: () => { loadCatalog(); },
          }),
          h('div', { className: 'dbl-effort' },
            h('span', { className: 'dbl-effort-label' }, '推理强度'),
            h('select', {
              className: 'dbl-select',
              value: slot.reasoningEffort,
              disabled: busy,
              'aria-label': meta.title + ' 的推理强度',
              onChange: (event) => patchSlot(meta.key, { reasoningEffort: event.target.value }),
            },
            EFFORTS.map((effort) => h('option', { key: effort, value: effort }, effort === '' ? '默认' : effort)))));
      };

      const body = [];
      body.push(h('div', { className: 'dbl-top', key: 'top' },
        h('h3', { className: 'dbl-title' }, '双脑模型'),
        status !== null && status.text !== undefined
          ? h('p', {
            className: 'dbl-status' + (status.kind === 'err' ? ' dbl-status-err' : status.kind === 'ok' ? ' dbl-status-ok' : ''),
            key: 'status',
            role: 'status',
          }, status.text)
          : null));
      body.push(h('p', { className: 'dbl-desc', key: 'desc' },
        '主脑派活时用的两个子模型：规划脑出框架，执行脑动手。列表与对话里的模型选择器同源。主脑自己仍用上方模型选择器。'));

      if (config === null) {
        body.push(h('p', { className: 'dbl-status', key: 'loading' }, '读取中…'));
      } else {
        body.push(h('div', { className: 'dbl-grid', key: 'grid' }, BRAINS.map(renderBrain)));
        body.push(h('p', { className: 'dbl-hintline', key: 'planmode' },
          '进入 /plan 计划模式时，主脑会自动换成上面的规划脑来列计划；/plan off 或提交计划后立即还原成你选的模型。'));
        body.push(h('div', { className: 'dbl-foot', key: 'foot' },
          h('button', { type: 'button', className: 'dbl-btn', disabled: busy, onClick: save },
            busy ? '保存中…' : '保存'),
          h('button', { type: 'button', className: 'dbl-btn dbl-btn-ghost', disabled: busy, onClick: reload },
            '重新读取')));
        if (file !== '') {
          body.push(h('p', { className: 'dbl-path', key: 'path' }, '配置文件 · ' + file));
        }
        if (providers.length === 0) {
          body.push(h('p', { className: 'dbl-status dbl-status-err', key: 'nocatalog' },
            '没读到模型目录' + (catalogError === '' ? '' : '：' + catalogError)));
        }
      }

      return h('section', { className: 'dbl-card' }, body);
    }

    /* 渲染错误只毁掉这张卡片，不毁掉整个设置页。 */
    class Boundary extends react.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error: error };
      }
      render() {
        if (this.state.error !== null) {
          return h('p', { className: 'dbl-status dbl-status-err' },
            '双脑面板渲染失败：' + String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error));
        }
        return this.props.children;
      }
    }

    function Card(props) {
      return h(Boundary, null, h(DualBrainCard, props));
    }

    function apply(ctx) {
      ensureCss();
      var ok = 0;

      try {
        ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
          name: 'settings.models.footer',
          id: 'dualBrainModels',
          order: 20,
          label: '双脑模型',
          inject: () => ({}),
        }, Card));
        ok += 1;
      } catch (error) {
        console.error('[dual-brain] settings.models.footer 注册失败：', error);
      }

      try {
        ctx.slots.inject('plugins.item', () => ctx.slots.register({
          name: 'plugins.item',
          id: 'dualBrainCard',
          order: 70,
          label: '双脑模型',
          inject: () => ({}),
        }, Card));
        ok += 1;
      } catch (error) {
        console.error('[dual-brain] plugins.item 注册失败：', error);
      }

      try {
        ctx.logger?.info?.('[dual-brain] 浏览器半侧已挂载（' + ok + ' 个入口）');
      } catch {
        /* 日志失败忽略 */
      }
    }

    exports.name = 'dsh-dual-brain-live';
    exports.inject = ['slots'];
    exports.apply = apply;
    return module.exports;
  },
});

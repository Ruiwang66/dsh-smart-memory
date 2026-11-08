window.__ModuleLoader__.load({
  id: "dsh-smart-memory",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const h = React.createElement;
    const API = "/api/smart-memory";

    const CSS = `
.dsm-root {
  --dsm-border: var(--dsw-alias-border-l2, #e5e6eb);
  --dsm-bg: var(--dsw-alias-bg-primary, #ffffff);
  --dsm-bg-soft: var(--dsw-alias-bg-secondary, #f7f8fa);
  --dsm-text: var(--dsw-alias-label-primary, #1f2329);
  --dsm-text-2: var(--dsw-alias-label-secondary, #4e5969);
  --dsm-text-3: var(--dsw-alias-label-tertiary, #86909c);
  --dsm-brand: var(--dsw-alias-brand-primary, #1664ff);
  --dsm-danger: var(--dsw-alias-state-error-primary, #d92d20);
  --dsm-warn: var(--dsw-alias-state-warn-primary, #b54708);
  --dsm-success: var(--dsw-alias-state-success-primary, #067647);
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  min-width: 0;
  color: var(--dsm-text);
  font-size: 13px;
  line-height: 1.55;
  padding-bottom: 8px;
}
/* The settings shell owns the scroll container around this page. Hide its
   scrollbar only while this page is mounted, so the tab strip and content do
   not show a stray vertical bar at the right edge. Wheel/keyboard scrolling
   still works. */
*:has(> .dsm-root) { scrollbar-width: none; -ms-overflow-style: none; }
*:has(> .dsm-root)::-webkit-scrollbar { display: none; width: 0; height: 0; }
.dsm-header { display: flex; align-items: flex-start; gap: 12px; }
.dsm-header-main { flex: 1; min-width: 0; }
.dsm-title { margin: 0; font-size: 20px; line-height: 1.3; font-weight: 650; letter-spacing: -.01em; }
.dsm-sub { margin-top: 3px; color: var(--dsm-text-3); font-size: 12px; }
.dsm-header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.dsm-status {
  display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
  border: 1px solid var(--dsm-border); border-radius: 999px; padding: 4px 9px;
  color: var(--dsm-text-2); font-size: 11px; background: var(--dsm-bg-soft);
}
.dsm-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsm-success); }
.dsm-dot[data-off=true] { background: var(--dsm-text-3); }
.dsm-tabs { display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid var(--dsm-border); overflow: visible; }
.dsm-tabs::-webkit-scrollbar { display: none; width: 0; height: 0; }
.dsm-tab {
  appearance: none; border: 0; background: transparent; color: var(--dsm-text-2);
  padding: 8px 12px 10px; cursor: pointer; font: inherit; white-space: nowrap;
  border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.dsm-tab:hover { color: var(--dsm-text); }
.dsm-tab[data-active=true] { color: var(--dsm-brand); border-bottom-color: var(--dsm-brand); font-weight: 600; }
.dsm-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.dsm-card { border: 1px solid var(--dsm-border); border-radius: 12px; background: var(--dsm-bg); padding: 14px; min-width: 0; }
.dsm-card-title { font-weight: 600; font-size: 13px; }
.dsm-stat-label { color: var(--dsm-text-3); font-size: 11px; }
.dsm-stat-value { font-size: 23px; line-height: 1.2; font-weight: 650; margin-top: 3px; }
.dsm-stat-hint { color: var(--dsm-text-3); font-size: 11px; margin-top: 3px; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
.dsm-path { display: block; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsm-path-row { min-width: 0; margin-top: -2px; }
.dsm-path-row .dsm-path { margin-top: 2px; }
.dsm-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsm-between { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.dsm-muted { color: var(--dsm-text-3); }
.dsm-small { font-size: 11px; }
.dsm-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsm-toolbar .dsm-search { flex: 1 1 220px; min-width: 160px; }
.dsm-input, .dsm-select, .dsm-textarea {
  border: 1px solid var(--dsm-border); border-radius: 8px; background: var(--dsm-bg);
  color: var(--dsm-text); font: inherit; padding: 7px 9px; min-height: 32px;
  outline: none; box-sizing: border-box;
}
.dsm-input:focus, .dsm-select:focus, .dsm-textarea:focus { border-color: var(--dsm-brand); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsm-brand) 14%, transparent); }
.dsm-textarea { resize: vertical; min-height: 100px; width: 100%; }
.dsm-select { cursor: pointer; }
.dsm-select-control { position: relative; min-width: 0; }
.dsm-select-trigger {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; min-height: 32px; padding: 7px 9px; box-sizing: border-box;
  border: 1px solid var(--dsm-border); border-radius: 8px;
  background: var(--dsm-bg); color: var(--dsm-text); font: inherit;
  text-align: left; cursor: pointer;
}
.dsm-select-trigger:hover { background: var(--dsm-bg-soft); }
.dsm-select-trigger:focus-visible { outline: none; border-color: var(--dsm-brand); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsm-brand) 14%, transparent); }
.dsm-select-trigger[aria-expanded=true] { border-color: var(--dsm-brand); }
.dsm-select-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsm-select-arrow { flex: none; width: 12px; height: 12px; color: var(--dsm-text-3); transition: transform .15s ease; }
.dsm-select-trigger[aria-expanded=true] .dsm-select-arrow { transform: rotate(180deg); }
.dsm-select-menu {
  position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 40;
  padding: 4px; max-height: 280px; overflow: auto; box-sizing: border-box;
  background: var(--dsm-bg); border: 1px solid var(--dsm-border); border-radius: 10px;
  box-shadow: 0 10px 28px rgba(15, 23, 42, .14);
}
.dsm-select-option {
  display: block; width: 100%; box-sizing: border-box; padding: 7px 9px;
  border: 0; border-radius: 6px; background: transparent; color: var(--dsm-text);
  font: inherit; text-align: left; cursor: pointer;
}
.dsm-select-option:hover { background: var(--dsm-bg-soft); }
.dsm-select-option[data-selected=true] { background: color-mix(in srgb, var(--dsm-brand) 9%, var(--dsm-bg)); color: var(--dsm-brand); font-weight: 600; }
.dsm-select-option:focus-visible { outline: none; box-shadow: inset 0 0 0 1px var(--dsm-brand); }
.dsm-toolbar .dsm-select-control { flex: 0 0 auto; min-width: 128px; }
.dsm-btn {
  appearance: none; border: 1px solid var(--dsm-border); background: var(--dsm-bg);
  color: var(--dsm-text); border-radius: 8px; padding: 6px 10px; font: inherit;
  cursor: pointer; white-space: nowrap; min-height: 32px;
}
.dsm-btn:hover { background: var(--dsm-bg-soft); }
.dsm-btn:disabled { opacity: .55; cursor: not-allowed; }
.dsm-btn-primary { background: var(--dsm-brand); border-color: var(--dsm-brand); color: #fff; }
.dsm-btn-primary:hover { filter: brightness(.96); background: var(--dsm-brand); }
.dsm-btn-danger { color: var(--dsm-danger); border-color: color-mix(in srgb, var(--dsm-danger) 35%, var(--dsm-border)); }
.dsm-btn-danger:hover { background: color-mix(in srgb, var(--dsm-danger) 8%, var(--dsm-bg)); }
.dsm-btn-ghost { border-color: transparent; background: transparent; color: var(--dsm-text-2); }
.dsm-btn-ghost:hover { background: var(--dsm-bg-soft); }
.dsm-list { display: flex; flex-direction: column; gap: 8px; }
.dsm-memory { display: flex; gap: 12px; border: 1px solid var(--dsm-border); border-radius: 12px; padding: 12px 14px; background: var(--dsm-bg); }
.dsm-memory[data-pinned=true] { border-color: color-mix(in srgb, var(--dsm-brand) 30%, var(--dsm-border)); }
.dsm-memory-main { flex: 1; min-width: 0; }
.dsm-memory-title { font-weight: 600; font-size: 13px; overflow-wrap: anywhere; }
.dsm-memory-content { color: var(--dsm-text-2); margin-top: 4px; white-space: pre-wrap; overflow-wrap: anywhere; }
.dsm-badges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 7px; }
.dsm-badge { border-radius: 999px; padding: 1px 7px; font-size: 10px; background: var(--dsm-bg-soft); color: var(--dsm-text-3); border: 1px solid var(--dsm-border); }
.dsm-badge-brand { color: var(--dsm-brand); border-color: color-mix(in srgb, var(--dsm-brand) 30%, var(--dsm-border)); background: color-mix(in srgb, var(--dsm-brand) 7%, var(--dsm-bg)); }
.dsm-badge-warn { color: var(--dsm-warn); border-color: color-mix(in srgb, var(--dsm-warn) 30%, var(--dsm-border)); background: color-mix(in srgb, var(--dsm-warn) 7%, var(--dsm-bg)); }
.dsm-badge-danger { color: var(--dsm-danger); border-color: color-mix(in srgb, var(--dsm-danger) 30%, var(--dsm-border)); background: color-mix(in srgb, var(--dsm-danger) 7%, var(--dsm-bg)); }
.dsm-actions { display: flex; gap: 2px; align-items: flex-start; flex-wrap: wrap; justify-content: flex-end; max-width: 190px; }
.dsm-empty { border: 1px dashed var(--dsm-border); border-radius: 12px; padding: 26px 16px; text-align: center; color: var(--dsm-text-3); background: var(--dsm-bg-soft); }
.dsm-error { border: 1px solid color-mix(in srgb, var(--dsm-danger) 35%, var(--dsm-border)); background: color-mix(in srgb, var(--dsm-danger) 6%, var(--dsm-bg)); color: var(--dsm-danger); border-radius: 10px; padding: 9px 12px; }
.dsm-loading { color: var(--dsm-text-3); padding: 18px 0; text-align: center; }
.dsm-project-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.dsm-project { text-align: left; cursor: pointer; transition: border-color .15s ease, transform .15s ease; }
.dsm-project:hover { border-color: color-mix(in srgb, var(--dsm-brand) 45%, var(--dsm-border)); }
.dsm-project-name { font-weight: 600; overflow-wrap: anywhere; }
.dsm-project-path { color: var(--dsm-text-3); font-size: 11px; margin-top: 3px; overflow-wrap: anywhere; word-break: break-word; }
.dsm-project-stats { display: flex; gap: 12px; margin-top: 9px; color: var(--dsm-text-2); font-size: 11px; flex-wrap: wrap; }
.dsm-detail-head { display: flex; gap: 10px; align-items: flex-start; }
.dsm-detail-head .dsm-header-main { flex: 1; }
.dsm-detail-title { font-size: 16px; font-weight: 650; }
.dsm-form { display: flex; flex-direction: column; gap: 12px; }
.dsm-field { display: flex; flex-direction: column; gap: 5px; }
.dsm-field-label { font-size: 12px; color: var(--dsm-text-2); font-weight: 500; }
.dsm-field-hint { font-size: 11px; color: var(--dsm-text-3); }
.dsm-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.dsm-three { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.dsm-switch-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 11px 0; border-bottom: 1px solid var(--dsm-border); }
.dsm-switch-row:last-child { border-bottom: 0; }
.dsm-switch-label { font-weight: 500; }
.dsm-switch-desc { color: var(--dsm-text-3); font-size: 11px; margin-top: 2px; }
.dsm-switch { position: relative; width: 36px; height: 20px; flex: none; margin-top: 2px; }
.dsm-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.dsm-switch-track { position: absolute; inset: 0; border-radius: 999px; background: var(--dsm-border); transition: background .15s ease; pointer-events: none; }
.dsm-switch-track::after { content: ""; position: absolute; width: 16px; height: 16px; left: 2px; top: 2px; border-radius: 50%; background: #fff; transition: transform .15s ease; box-shadow: 0 1px 2px rgba(0,0,0,.18); }
.dsm-switch input:checked + .dsm-switch-track { background: var(--dsm-brand); }
.dsm-switch input:checked + .dsm-switch-track::after { transform: translateX(16px); }
.dsm-modal-mask { position: fixed; inset: 0; z-index: 80; background: rgba(15,23,42,.38); display: flex; align-items: center; justify-content: center; padding: 20px; }
.dsm-modal { width: min(600px, 100%); max-height: calc(100vh - 40px); overflow: auto; background: var(--dsm-bg); border: 1px solid var(--dsm-border); border-radius: 14px; padding: 18px; box-shadow: 0 24px 64px rgba(15,23,42,.22); }
.dsm-modal-title { font-size: 16px; font-weight: 650; }
.dsm-modal-sub { color: var(--dsm-text-3); font-size: 12px; margin-top: 3px; }
.dsm-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
.dsm-danger-zone { border-color: color-mix(in srgb, var(--dsm-danger) 28%, var(--dsm-border)); }
.dsm-toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 100; background: #1f2329; color: #fff; border-radius: 999px; padding: 8px 15px; font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.22); max-width: min(520px, calc(100vw - 40px)); }
.dsm-recent { display: flex; flex-direction: column; gap: 0; }
.dsm-recent-row { display: flex; align-items: baseline; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--dsm-border); }
.dsm-recent-row:last-child { border-bottom: 0; }
.dsm-recent-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsm-pre { white-space: pre-wrap; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; }
@media (max-width: 760px) {
  .dsm-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dsm-project-grid { grid-template-columns: 1fr; }
  .dsm-three { grid-template-columns: 1fr; }
  .dsm-two { grid-template-columns: 1fr; }
  .dsm-actions { max-width: none; }
}
`;

    function api(endpoint, body) {
      return fetch(API + "/" + endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body === undefined ? {} : body),
      }).then(function (res) {
        var type = res.headers.get("content-type") || "";
        if (type.indexOf("application/json") === -1) {
          throw new Error("记忆服务暂不可用（HTTP " + res.status + "）");
        }
        return res.json().then(function (payload) {
          if (payload && payload.ok) return payload.value;
          var error = payload && payload.error;
          throw new Error(error && error.message ? error.message : "操作失败");
        });
      });
    }

    function fmtTime(value) {
      if (!value) return "—";
      try {
        return new Date(value).toLocaleString("zh-CN", { hour12: false });
      } catch (error) {
        return "—";
      }
    }

    function fmtRelative(value) {
      if (!value) return "—";
      var diff = Date.now() - value;
      if (diff < 60_000) return "刚刚";
      if (diff < 3_600_000) return Math.floor(diff / 60_000) + " 分钟前";
      if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + " 小时前";
      if (diff < 30 * 86_400_000) return Math.floor(diff / 86_400_000) + " 天前";
      return fmtTime(value).slice(0, 10);
    }

    function bytesLabel(bytes) {
      if (!bytes) return "0 KB";
      if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
      return (bytes / 1024 / 1024).toFixed(1) + " MB";
    }

    function scopeLabel(scope) {
      return scope === "global" ? "全局" : "项目";
    }

    var CATEGORY_LABELS = {
      profile: "基本情况", background: "长期背景", preference: "长期偏好", language: "语言习惯",
      style: "回答风格", skill: "技术水平", tool: "工具与环境", interest: "兴趣领域",
      requirement: "长期要求", correction: "纠正记录", habit: "工作习惯", project_overview: "项目概况",
      tech_stack: "技术栈", progress: "开发进度", completed: "已完成", in_progress: "进行中",
      issue: "未解决问题", bug_fix: "Bug 修复", decision: "技术决策", database: "数据库",
      api: "API 约定", deployment: "部署信息", environment: "环境配置", constraint: "项目约束",
      plan: "后续计划", failed_attempt: "失败尝试", other: "其他",
    };
    var CATEGORY_OPTIONS = Object.keys(CATEGORY_LABELS);

    function badge(text, tone) {
      return h("span", { className: "dsm-badge" + (tone ? " dsm-badge-" + tone : "") }, text);
    }

    function MemoryIcon(props) {
      var size = props && typeof props.size === "number" ? props.size : 16;
      return h("svg", {
        width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false",
      },
        h("path", {
          d: "M5.2 2.7c-1.7 0-3 1.25-3 2.8 0 .75.32 1.43.85 1.94-.45.45-.72 1.05-.72 1.7 0 1.22.92 2.25 2.15 2.48.27 1.1 1.28 1.9 2.52 1.9.7 0 1.34-.25 1.82-.66.48.41 1.12.66 1.82.66 1.24 0 2.25-.8 2.52-1.9 1.23-.23 2.15-1.26 2.15-2.48 0-.65-.27-1.25-.72-1.7.53-.51.85-1.19.85-1.94 0-1.55-1.3-2.8-3-2.8-.55 0-1.07.14-1.52.38A2.9 2.9 0 0 0 8 2.2c-.54 0-1.05.18-1.47.5A2.9 2.9 0 0 0 5.2 2.7Z",
          fill: "none", stroke: "currentColor", strokeWidth: "1.2",
        }),
        h("path", { d: "M5.6 6.1h.01M10.4 6.1h.01M5.8 9.2c.6.55 1.35.85 2.2.85s1.6-.3 2.2-.85", fill: "none", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" }),
      );
    }

    function SwitchRow(props) {
      return h("label", { className: "dsm-switch-row" },
        h("span", { style: { minWidth: 0 } },
          h("span", { className: "dsm-switch-label" }, props.label),
          props.desc ? h("div", { className: "dsm-switch-desc" }, props.desc) : null,
        ),
        h("span", { className: "dsm-switch" },
          h("input", { type: "checkbox", checked: !!props.checked, onChange: function (event) { props.onChange(event.target.checked); } }),
          h("span", { className: "dsm-switch-track" }),
        ),
      );
    }

    function Select(props) {
      var options = (props.options || []).map(function (option) {
        return typeof option === "string" ? { value: option, label: option } : option;
      });
      var value = props.value === undefined || props.value === null ? "" : String(props.value);
      var selected = null;
      for (var i = 0; i < options.length; i += 1) {
        if (String(options[i].value) === value) { selected = options[i]; break; }
      }
      var [open, setOpen] = React.useState(false);
      var rootRef = React.useRef(null);
      React.useEffect(function () {
        if (!open) return undefined;
        function onPointerDown(event) {
          if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
        }
        function onKeyDown(event) {
          if (event.key === "Escape") setOpen(false);
        }
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return function () {
          document.removeEventListener("mousedown", onPointerDown);
          document.removeEventListener("keydown", onKeyDown);
        };
      }, [open]);
      function choose(option) {
        setOpen(false);
        if (typeof props.onChange === "function") props.onChange(option.value);
      }
      return h("div", { className: "dsm-select-control", ref: rootRef },
        h("button", {
          type: "button",
          className: "dsm-select-trigger",
          "aria-haspopup": "listbox",
          "aria-expanded": open ? "true" : "false",
          "aria-label": props.ariaLabel || undefined,
          onClick: function () { setOpen(!open); },
          onKeyDown: function (event) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
            }
          },
        },
          h("span", { className: "dsm-select-value" }, selected ? selected.label : (props.placeholder || "请选择")),
          h("svg", { className: "dsm-select-arrow", viewBox: "0 0 12 12", "aria-hidden": "true", focusable: "false" },
            h("path", { d: "M2.5 4.5 6 8l3.5-3.5", fill: "none", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }),
          ),
        ),
        open ? h("div", { className: "dsm-select-menu", role: "listbox", "aria-label": props.ariaLabel || undefined },
          options.map(function (option, index) {
            var isSelected = String(option.value) === value;
            return h("button", {
              type: "button",
              key: String(option.value) + "-" + index,
              className: "dsm-select-option",
              role: "option",
              "aria-selected": isSelected ? "true" : "false",
              "data-selected": isSelected ? "true" : "false",
              onClick: function () { choose(option); },
            }, option.label);
          }),
        ) : null,
      );
    }

    function MemoryCard(props) {
      var memory = props.memory;
      var source = memory.source || {};
      var sourceText = source.kind || "unknown";
      if (source.sessionId) sourceText += " · 会话 " + String(source.sessionId).slice(-8);
      if (typeof source.turn === "number") sourceText += " · turn " + source.turn;
      var actions = [];
      actions.push(h("button", { key: "pin", className: "dsm-btn dsm-btn-ghost", onClick: function () { props.onPin(memory); } }, memory.pinned ? "取消固定" : "固定"));
      actions.push(h("button", { key: "edit", className: "dsm-btn dsm-btn-ghost", onClick: function () { props.onEdit(memory); } }, "编辑"));
      actions.push(h("button", { key: "lock", className: "dsm-btn dsm-btn-ghost", onClick: function () { props.onLock(memory); } }, memory.locked ? "解锁" : "锁定"));
      actions.push(h("button", { key: "delete", className: "dsm-btn dsm-btn-ghost", onClick: function () { props.onDelete(memory); } }, "删除"));
      var tone = memory.status === "conflict" || memory.status === "pending_confirmation" ? "warn" : null;
      return h("div", { className: "dsm-memory", "data-pinned": memory.pinned ? "true" : "false" },
        h("div", { className: "dsm-memory-main" },
          h("div", { className: "dsm-memory-title" }, memory.title),
          h("div", { className: "dsm-memory-content" }, memory.content),
          h("div", { className: "dsm-badges" },
            badge(scopeLabel(memory.scope), memory.scope === "global" ? "brand" : null),
            badge(CATEGORY_LABELS[memory.category] || memory.category),
            badge("重要度 " + memory.importance),
            memory.pinned ? badge("已固定", "brand") : null,
            memory.locked ? badge("已锁定") : null,
            memory.status !== "active" ? badge(memory.status === "conflict" ? "冲突待确认" : memory.status === "pending_confirmation" ? "待确认" : memory.status, tone) : null,
            h("span", { className: "dsm-muted dsm-small", style: { marginLeft: 2 }, title: source.excerpt || "" }, "来源 " + sourceText),
          ),
          h("div", { className: "dsm-muted dsm-small", style: { marginTop: 4 }, title: source.excerpt || "" },
            "创建 " + fmtTime(memory.createdAt) + " · 更新 " + fmtTime(memory.updatedAt),
          ),
        ),
        h("div", { className: "dsm-actions" }, actions),
      );
    }

    function MemoryList(props) {
      if (props.loading) return h("div", { className: "dsm-loading" }, "正在加载记忆…");
      if (!props.memories || props.memories.length === 0) {
        return h("div", { className: "dsm-empty" },
          h("div", { style: { fontWeight: 600, color: "var(--dsm-text-2)" } }, props.emptyTitle || "还没有记忆"),
          h("div", { className: "dsm-small", style: { marginTop: 4 } }, props.emptyHint || "在对话中让 AI 记住重要信息，或点击“新增记忆”。"),
        );
      }
      return h("div", { className: "dsm-list" }, props.memories.map(function (memory) {
        return h(MemoryCard, {
          key: memory.id, memory: memory,
          onPin: props.onPin, onEdit: props.onEdit, onLock: props.onLock, onDelete: props.onDelete,
        });
      }));
    }

    function OverviewTab(props) {
      var overview = props.overview;
      if (!overview) return h("div", { className: "dsm-loading" }, "正在加载概览…");
      var stats = [
        { label: "记忆总数", value: overview.total, hint: "全局 " + overview.global + " · 项目 " + overview.project },
        { label: "活跃记忆", value: overview.active, hint: "归档 " + overview.archived + " · 待确认 " + overview.pending },
        { label: "已识别项目", value: overview.projects, hint: "每个项目独立隔离" },
        { label: "存储占用", value: bytesLabel(overview.storageBytes), hint: "本地 DSH 存储" },
      ];
      var storagePath = overview.settings.storagePath || "—";
      return h("div", { className: "dsm-root" },
        h("div", { className: "dsm-grid" }, stats.map(function (item) {
          return h("div", { className: "dsm-card", key: item.label },
            h("div", { className: "dsm-stat-label" }, item.label),
            h("div", { className: "dsm-stat-value" }, item.value),
            h("div", { className: "dsm-stat-hint" }, item.hint),
          );
        })),
        h("div", { className: "dsm-path-row" },
          h("div", { className: "dsm-muted dsm-small" }, "存储位置"),
          h("div", { className: "dsm-muted dsm-small dsm-path", title: storagePath }, storagePath),
        ),
        h("div", { className: "dsm-card" },
          h("div", { className: "dsm-between" },
            h("div", null,
              h("div", { className: "dsm-card-title" }, "自动记忆状态"),
              h("div", { className: "dsm-muted dsm-small", style: { marginTop: 2 } }, "异步提取，不阻塞正常对话"),
            ),
            h("span", { className: "dsm-status" },
              h("span", { className: "dsm-dot", "data-off": overview.autoStatus.enabled ? "false" : "true" }),
              overview.autoStatus.running ? "正在整理" : overview.autoStatus.enabled ? "运行中" : "已暂停",
            ),
          ),
          h("div", { className: "dsm-three", style: { marginTop: 12 } },
            h("div", null, h("div", { className: "dsm-stat-label" }, "最近运行"), h("div", null, fmtTime(overview.autoStatus.lastRunAt))),
            h("div", null, h("div", { className: "dsm-stat-label" }, "待处理队列"), h("div", null, overview.autoStatus.queueDepth + " 项")),
            h("div", null, h("div", { className: "dsm-stat-label" }, "上次提取方式"), h("div", null, overview.autoStatus.lastMode === "llm" ? "模型总结" : overview.autoStatus.lastMode === "heuristic" ? "规则提取" : "—")),
          ),
          overview.autoStatus.lastError ? h("div", { className: "dsm-error", style: { marginTop: 10 } }, overview.autoStatus.lastError) : null,
        ),
        h("div", { className: "dsm-card" },
          h("div", { className: "dsm-card-title" }, "最近新增"),
          overview.recent && overview.recent.length > 0
            ? h("div", { className: "dsm-recent" }, overview.recent.map(function (memory) {
                return h("div", { className: "dsm-recent-row", key: memory.id },
                  h("span", { className: "dsm-badge" }, scopeLabel(memory.scope)),
                  h("span", { className: "dsm-recent-title" }, memory.title),
                  h("span", { className: "dsm-muted dsm-small" }, fmtRelative(memory.createdAt)),
                );
              }))
            : h("div", { className: "dsm-empty", style: { marginTop: 10 } }, "还没有记忆。和 AI 正常对话，重要的长期信息会自动出现。"),
        ),
        h("div", { className: "dsm-card" },
          h("div", { className: "dsm-card-title" }, "记忆边界"),
          h("div", { className: "dsm-muted dsm-small", style: { marginTop: 6, whiteSpace: "pre-wrap" } },
            "全局记忆跨会话共享；项目记忆只属于当前工作区。不同位置的同名项目也会被视为不同项目。项目 A 的技术细节不会在项目 B 中自动召回。"),
        ),
      );
    }

    function GlobalTab(props) {
      return h("div", { className: "dsm-root" },
        h("div", { className: "dsm-toolbar" },
          h("input", { className: "dsm-input dsm-search", placeholder: "搜索全局记忆，例如：中文、回答风格、开发工具", value: props.query, onChange: function (event) { props.setQuery(event.target.value); } }),
          h(Select, {
            value: props.category,
            ariaLabel: "分类筛选",
            options: [{ value: "", label: "全部分类" }].concat(CATEGORY_OPTIONS.map(function (key) { return { value: key, label: CATEGORY_LABELS[key] }; })),
            onChange: props.setCategory,
          }),
          h("button", { className: "dsm-btn dsm-btn-primary", onClick: function () { props.onAdd("global"); } }, "新增记忆"),
        ),
        h("div", { className: "dsm-between" },
          h("div", { className: "dsm-muted dsm-small" }, "共 " + props.total + " 条全局记忆"),
          h("div", { className: "dsm-row" },
            h("button", { className: "dsm-btn", onClick: props.onExport }, "导出"),
            h("button", { className: "dsm-btn", onClick: props.onRefresh }, "刷新"),
          ),
        ),
        h(MemoryList, {
          memories: props.memories, loading: props.loading,
          onPin: props.onPin, onEdit: props.onEdit, onLock: props.onLock, onDelete: props.onDelete,
          emptyTitle: "还没有全局记忆",
          emptyHint: "全局记忆保存你的长期偏好、语言习惯、回答风格、常用工具和明确要求。",
        }),
      );
    }

    function ProjectsTab(props) {
      if (props.selectedProject) {
        return h("div", { className: "dsm-root" },
          h("div", { className: "dsm-detail-head" },
            h("button", { className: "dsm-btn dsm-btn-ghost", onClick: props.onBack }, "← 返回项目"),
            h("div", { className: "dsm-header-main" },
              h("div", { className: "dsm-detail-title" }, props.selectedProject.name),
              h("div", { className: "dsm-project-path" }, props.selectedProject.rootPath),
              h("div", { className: "dsm-muted dsm-small", style: { marginTop: 3 } }, "项目 ID " + props.selectedProject.id + " · 记忆 " + props.projectTotal),
            ),
            h("div", { className: "dsm-row" },
              h("button", { className: "dsm-btn", onClick: props.onRename }, "重命名"),
              h("button", { className: "dsm-btn", onClick: props.onExportProject }, "导出"),
              h("button", { className: "dsm-btn dsm-btn-danger", onClick: props.onClearProject }, "清除项目记忆"),
            ),
          ),
          h("div", { className: "dsm-toolbar" },
            h("input", { className: "dsm-input dsm-search", placeholder: "搜索当前项目记忆", value: props.query, onChange: function (event) { props.setQuery(event.target.value); } }),
            h(Select, {
              value: props.category,
              ariaLabel: "分类筛选",
              options: [{ value: "", label: "全部分类" }].concat(CATEGORY_OPTIONS.map(function (key) { return { value: key, label: CATEGORY_LABELS[key] }; })),
              onChange: props.setCategory,
            }),
            h("button", { className: "dsm-btn dsm-btn-primary", onClick: function () { props.onAdd("project"); } }, "新增项目记忆"),
          ),
          h(MemoryList, {
            memories: props.memories, loading: props.loading,
            onPin: props.onPin, onEdit: props.onEdit, onLock: props.onLock, onDelete: props.onDelete,
            emptyTitle: "当前项目还没有记忆",
            emptyHint: "项目记忆保存技术栈、进度、未解决问题、技术决策、接口、数据库和部署信息。",
          }),
        );
      }
      if (props.loading) return h("div", { className: "dsm-loading" }, "正在加载项目…");
      if (!props.projects || props.projects.length === 0) {
        return h("div", { className: "dsm-empty" }, "还没有识别到项目。在项目目录中开始对话后，项目会自动出现。");
      }
      return h("div", { className: "dsm-root" },
        h("div", { className: "dsm-between" },
          h("div", { className: "dsm-muted dsm-small" }, "已识别 " + props.projects.length + " 个项目，项目之间严格隔离。"),
          h("button", { className: "dsm-btn", onClick: props.onRefresh }, "刷新"),
        ),
        h("div", { className: "dsm-project-grid" }, props.projects.map(function (project) {
          return h("button", { key: project.id, className: "dsm-card dsm-project", onClick: function () { props.onSelect(project); } },
            h("div", { className: "dsm-project-name" }, project.name),
            h("div", { className: "dsm-project-path" }, project.rootPath || "路径未记录"),
            h("div", { className: "dsm-project-stats" },
              h("span", null, "记忆 " + project.memoryCount),
              h("span", null, "活跃 " + project.activeCount),
              h("span", null, "最近活动 " + fmtRelative(project.lastActiveAt)),
            ),
          );
        })),
      );
    }

    function SettingsTab(props) {
      var form = props.form;
      if (!form) return h("div", { className: "dsm-loading" }, "正在加载设置…");
      function set(key, value) {
        props.setForm(Object.assign({}, form, { [key]: value }));
      }
      return h("div", { className: "dsm-root" },
        h("div", { className: "dsm-card" },
          h("div", { className: "dsm-card-title" }, "自动记忆"),
          h("div", { className: "dsm-muted dsm-small", style: { marginBottom: 4 } }, "关闭后仍会保留已有记忆，但不再自动提取或召回。"),
          h(SwitchRow, { label: "全局自动记忆", desc: "自动提取跨会话的用户偏好、背景、语言和长期要求。", checked: form.autoGlobal, onChange: function (v) { set("autoGlobal", v); } }),
          h(SwitchRow, { label: "项目自动记忆", desc: "自动提取当前项目的进度、决策、问题、接口和部署信息。", checked: form.autoProject, onChange: function (v) { set("autoProject", v); } }),
          h(SwitchRow, { label: "自动总结（使用当前模型）", desc: "关闭后改用轻量规则提取，不发起额外的模型请求。", checked: form.autoSummarize, onChange: function (v) { set("autoSummarize", v); } }),
          h(SwitchRow, { label: "自动召回", desc: "在每个模型步骤动态注入相关的全局与项目记忆。", checked: form.autoRecall, onChange: function (v) { set("autoRecall", v); } }),
          h(SwitchRow, { label: "敏感信息过滤", desc: "保存和总结前过滤 API Key、密码、私钥、身份证号等。", checked: form.sensitiveFilter, onChange: function (v) { set("sensitiveFilter", v); } }),
        ),
        h("div", { className: "dsm-card" },
          h("div", { className: "dsm-card-title" }, "检索与上下文"),
          h("div", { className: "dsm-two", style: { marginTop: 10 } },
            h("label", { className: "dsm-field" },
              h("span", { className: "dsm-field-label" }, "每次召回的记忆数量"),
              h("input", { className: "dsm-input", type: "number", min: 1, max: 30, value: form.retrievalLimit, onChange: function (e) { set("retrievalLimit", Number(e.target.value)); } }),
              h("span", { className: "dsm-field-hint" }, "1-30，默认 8。"),
            ),
            h("label", { className: "dsm-field" },
              h("span", { className: "dsm-field-label" }, "上下文 Token 预算"),
              h("input", { className: "dsm-input", type: "number", min: 200, max: 8000, step: 100, value: form.contextTokenBudget, onChange: function (e) { set("contextTokenBudget", Number(e.target.value)); } }),
              h("span", { className: "dsm-field-hint" }, "200-8000，按本地估算截断。"),
            ),
            h("label", { className: "dsm-field" },
              h("span", { className: "dsm-field-label" }, "记忆冲突处理"),
              h(Select, {
                value: form.conflictPolicy,
                ariaLabel: "记忆冲突处理",
                options: [
                  { value: "merge", label: "自动合并补充" },
                  { value: "prefer_new", label: "以最新信息为准" },
                  { value: "keep_both", label: "保留双方并标记冲突" },
                  { value: "ask", label: "保留双方，等待用户确认" },
                ],
                onChange: function (value) { set("conflictPolicy", value); },
              }),
            ),
            h("label", { className: "dsm-field" },
              h("span", { className: "dsm-field-label" }, "自动归档天数"),
              h("input", { className: "dsm-input", type: "number", min: 0, max: 3650, value: form.autoArchiveDays, onChange: function (e) { set("autoArchiveDays", Number(e.target.value)); } }),
              h("span", { className: "dsm-field-hint" }, "0 表示关闭；低重要度且长期未更新的记忆会归档。"),
            ),
          ),
          h("label", { className: "dsm-field", style: { marginTop: 12 } },
            h("span", { className: "dsm-field-label" }, "忽略目录和文件规则"),
            h("textarea", { className: "dsm-textarea", rows: 4, value: (form.ignorePaths || []).join("\n"), onChange: function (e) { set("ignorePaths", e.target.value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean)); } }),
            h("span", { className: "dsm-field-hint" }, "每行一条，支持 * 通配；例如 node_modules、.git、build。"),
          ),
          h("label", { className: "dsm-field", style: { marginTop: 12 } },
            h("span", { className: "dsm-field-label" }, "存储位置"),
            h("input", { className: "dsm-input", value: props.storagePath || form.storagePath || "", readOnly: true, title: props.storagePath || form.storagePath || "" }),
            h("span", { className: "dsm-field-hint" }, "由 DSH 的 storage-domain JSON 后端管理，不会写入会话日志。"),
          ),
          h("div", { className: "dsm-modal-actions", style: { justifyContent: "flex-start" } },
            h("button", { className: "dsm-btn dsm-btn-primary", disabled: props.saving, onClick: props.onSave }, props.saving ? "保存中…" : "保存设置"),
            h("button", { className: "dsm-btn", onClick: props.onReload }, "重新加载"),
          ),
        ),
        h("div", { className: "dsm-card dsm-danger-zone" },
          h("div", { className: "dsm-card-title" }, "危险操作"),
          h("div", { className: "dsm-muted dsm-small", style: { marginTop: 4, marginBottom: 10 } }, "这些操作不可撤销。建议先导出记忆。"),
          h("div", { className: "dsm-row" },
            h("button", { className: "dsm-btn", onClick: props.onExportAll }, "导出全部记忆"),
            h("button", { className: "dsm-btn", onClick: props.onImport }, "导入记忆"),
            h("button", { className: "dsm-btn dsm-btn-danger", onClick: props.onForgetAll }, "清空全部记忆"),
          ),
        ),
      );
    }

    function EditorModal(props) {
      var initial = props.memory || {};
      var [title, setTitle] = React.useState(initial.title || "");
      var [content, setContent] = React.useState(initial.content || "");
      var [category, setCategory] = React.useState(initial.category || (props.scope === "project" ? "progress" : "preference"));
      var [tags, setTags] = React.useState((initial.tags || []).join(", "));
      var [importance, setImportance] = React.useState(initial.importance || 3);
      var [pinned, setPinned] = React.useState(!!initial.pinned);
      var [locked, setLocked] = React.useState(!!initial.locked);
      var [saving, setSaving] = React.useState(false);
      var [error, setError] = React.useState("");
      function submit() {
        if (!title.trim() || !content.trim()) { setError("标题和内容不能为空"); return; }
        setSaving(true);
        setError("");
        var payload = {
          id: initial.id,
          scope: props.scope,
          projectId: props.projectId,
          title: title.trim(),
          content: content.trim(),
          category: category,
          tags: tags.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
          importance: Number(importance),
          pinned: pinned,
          locked: locked,
          force: true,
        };
        var call = initial.id ? api("update", payload) : api("save", payload);
        call.then(function () {
          props.onSaved();
        }).catch(function (err) {
          setError(err.message || String(err));
          setSaving(false);
        });
      }
      return h("div", { className: "dsm-modal-mask", onMouseDown: function (e) { if (e.target === e.currentTarget) props.onClose(); } },
        h("div", { className: "dsm-modal" },
          h("div", { className: "dsm-modal-title" }, initial.id ? "编辑记忆" : "新增记忆"),
          h("div", { className: "dsm-modal-sub" }, props.scope === "project" ? "保存到当前项目，不会影响其他项目。" : "保存到用户全局记忆，所有项目共享。"),
          h("div", { className: "dsm-form", style: { marginTop: 14 } },
            h("label", { className: "dsm-field" }, h("span", { className: "dsm-field-label" }, "标题"), h("input", { className: "dsm-input", value: title, onChange: function (e) { setTitle(e.target.value); }, maxLength: 200, autoFocus: true })),
            h("label", { className: "dsm-field" }, h("span", { className: "dsm-field-label" }, "内容"), h("textarea", { className: "dsm-textarea", rows: 6, value: content, onChange: function (e) { setContent(e.target.value); }, maxLength: 8000 })),
            h("div", { className: "dsm-three" },
              h("label", { className: "dsm-field" }, h("span", { className: "dsm-field-label" }, "分类"), h(Select, { value: category, ariaLabel: "记忆分类", options: CATEGORY_OPTIONS.map(function (key) { return { value: key, label: CATEGORY_LABELS[key] }; }), onChange: setCategory })),
              h("label", { className: "dsm-field" }, h("span", { className: "dsm-field-label" }, "重要度"), h(Select, { value: importance, ariaLabel: "重要度", options: [1,2,3,4,5].map(function (n) { return { value: n, label: n + " / 5" }; }), onChange: function (value) { setImportance(Number(value)); } })),
              h("label", { className: "dsm-field" }, h("span", { className: "dsm-field-label" }, "标签"), h("input", { className: "dsm-input", value: tags, onChange: function (e) { setTags(e.target.value); }, placeholder: "用逗号分隔" })),
            ),
            h("div", { className: "dsm-row" },
              h("label", { className: "dsm-row" }, h("input", { type: "checkbox", checked: pinned, onChange: function (e) { setPinned(e.target.checked); } }), "固定（优先召回）"),
              h("label", { className: "dsm-row" }, h("input", { type: "checkbox", checked: locked, onChange: function (e) { setLocked(e.target.checked); } }), "锁定（禁止自动覆盖）"),
            ),
            error ? h("div", { className: "dsm-error" }, error) : null,
          ),
          h("div", { className: "dsm-modal-actions" },
            h("button", { className: "dsm-btn", onClick: props.onClose, disabled: saving }, "取消"),
            h("button", { className: "dsm-btn dsm-btn-primary", onClick: submit, disabled: saving }, saving ? "保存中…" : "保存"),
          ),
        ),
      );
    }

    function ConfirmModal(props) {
      return h("div", { className: "dsm-modal-mask", onMouseDown: function (e) { if (e.target === e.currentTarget) props.onClose(); } },
        h("div", { className: "dsm-modal", style: { width: "min(460px, 100%)" } },
          h("div", { className: "dsm-modal-title" }, props.title),
          h("div", { className: "dsm-muted", style: { marginTop: 8, whiteSpace: "pre-wrap" } }, props.message),
          h("div", { className: "dsm-modal-actions" },
            h("button", { className: "dsm-btn", onClick: props.onClose }, "取消"),
            h("button", { className: props.danger === false ? "dsm-btn dsm-btn-primary" : "dsm-btn dsm-btn-danger", onClick: props.onConfirm }, props.confirmLabel || "确认"),
          ),
        ),
      );
    }

    function SmartMemoryPage() {
      var [tab, setTab] = React.useState("overview");
      var [overview, setOverview] = React.useState(null);
      var [projects, setProjects] = React.useState([]);
      var [projectsLoading, setProjectsLoading] = React.useState(false);
      var [selectedProject, setSelectedProject] = React.useState(null);
      var [memories, setMemories] = React.useState([]);
      var [total, setTotal] = React.useState(0);
      var [loading, setLoading] = React.useState(false);
      var [query, setQuery] = React.useState("");
      var [category, setCategory] = React.useState("");
      var [settingsForm, setSettingsForm] = React.useState(null);
      var [storagePath, setStoragePath] = React.useState("");
      var [savingSettings, setSavingSettings] = React.useState(false);
      var [editor, setEditor] = React.useState(null);
      var [confirm, setConfirm] = React.useState(null);
      var [toast, setToast] = React.useState("");
      var [error, setError] = React.useState("");
      var fileInputRef = React.useRef(null);

      function notify(message) {
        setToast(message);
        setTimeout(function () { setToast(""); }, 2600);
      }

      function loadOverview() {
        return api("overview").then(function (value) { setOverview(value); }).catch(function (err) { setError(err.message || String(err)); });
      }
      function loadProjects() {
        setProjectsLoading(true);
        return api("projects").then(function (value) { setProjects(value.projects || []); })
          .catch(function (err) { setError(err.message || String(err)); })
          .finally(function () { setProjectsLoading(false); });
      }
      function loadSettings() {
        return api("settings/get").then(function (value) {
          setSettingsForm(value.settings);
          setStoragePath(value.storagePath || "");
        }).catch(function (err) { setError(err.message || String(err)); });
      }
      function loadMemories(scope, projectId, q, cat) {
        setLoading(true);
        return api("memories", { scope: scope, projectId: projectId, query: q || "", category: cat || "", limit: 200 })
          .then(function (value) { setMemories(value.memories || []); setTotal(value.total || 0); })
          .catch(function (err) { setError(err.message || String(err)); })
          .finally(function () { setLoading(false); });
      }

      React.useEffect(function () {
        loadOverview();
        loadProjects();
        loadSettings();
      }, []);

      React.useEffect(function () {
        var timer = setTimeout(function () {
          if (tab === "global") loadMemories("global", null, query, category);
          else if (tab === "projects" && selectedProject) loadMemories("project", selectedProject.id, query, category);
        }, 220);
        return function () { clearTimeout(timer); };
      }, [tab, selectedProject && selectedProject.id, query, category]);

      function refreshCurrent() {
        loadOverview();
        loadProjects();
        if (tab === "global") loadMemories("global", null, query, category);
        else if (tab === "projects" && selectedProject) loadMemories("project", selectedProject.id, query, category);
      }

      function openAdd(scope) {
        if (scope === "project" && !selectedProject) { notify("请先选择一个项目"); return; }
        setEditor({ scope: scope, projectId: scope === "project" ? selectedProject.id : undefined, memory: null });
      }
      function openEdit(memory) {
        setEditor({ scope: memory.scope, projectId: memory.projectId, memory: memory });
      }
      function closeEditor() { setEditor(null); }

      function onSaved() {
        setEditor(null);
        notify("已保存记忆");
        refreshCurrent();
      }

      function deleteMemory(memory) {
        setConfirm({
          title: "删除这条记忆？",
          message: "「" + memory.title + "」\n删除后无法恢复。固定或锁定的记忆需要先确认。",
          confirmLabel: "删除",
          onConfirm: function () {
            api("delete", { id: memory.id }).then(function () {
              setConfirm(null);
              notify("已删除记忆");
              refreshCurrent();
            }).catch(function (err) { setError(err.message || String(err)); setConfirm(null); });
          },
        });
      }

      function pinMemory(memory) {
        api("pin", { id: memory.id, pinned: !memory.pinned }).then(function () {
          notify(memory.pinned ? "已取消固定" : "已固定");
          refreshCurrent();
        }).catch(function (err) { setError(err.message || String(err)); });
      }
      function lockMemory(memory) {
        api("lock", { id: memory.id, locked: !memory.locked }).then(function () {
          notify(memory.locked ? "已解锁" : "已锁定");
          refreshCurrent();
        }).catch(function (err) { setError(err.message || String(err)); });
      }

      function exportData(scope, projectId) {
        api("export", { scope: scope, projectId: projectId, includeSettings: scope === "all" }).then(function (bundle) {
          var blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url;
          a.download = "dsh-smart-memory-" + new Date().toISOString().slice(0, 10) + ".json";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
          notify("已导出 " + (bundle.memories ? bundle.memories.length : 0) + " 条记忆");
        }).catch(function (err) { setError(err.message || String(err)); });
      }

      function clearProject() {
        if (!selectedProject) return;
        setConfirm({
          title: "清除项目记忆？",
          message: "将删除项目「" + selectedProject.name + "」的全部记忆。项目本身和磁盘文件不会被删除。此操作不可撤销。",
          confirmLabel: "清除",
          onConfirm: function () {
            api("project/clear", { id: selectedProject.id, confirm: true }).then(function (value) {
              setConfirm(null);
              notify("已清除 " + value.deleted + " 条项目记忆");
              refreshCurrent();
            }).catch(function (err) { setError(err.message || String(err)); setConfirm(null); });
          },
        });
      }

      function forgetAll() {
        setConfirm({
          title: "清空全部记忆？",
          message: "将删除全局记忆和所有项目的记忆，且无法恢复。建议先导出。",
          confirmLabel: "清空全部",
          onConfirm: function () {
            api("forget", { scope: "all", confirm: true }).then(function (value) {
              setConfirm(null);
              notify("已清除 " + value.deleted + " 条记忆");
              setSelectedProject(null);
              refreshCurrent();
            }).catch(function (err) { setError(err.message || String(err)); setConfirm(null); });
          },
        });
      }

      function saveSettings() {
        if (!settingsForm) return;
        setSavingSettings(true);
        api("settings/update", { settings: settingsForm }).then(function (value) {
          setSettingsForm(value.settings);
          setStoragePath(value.storagePath || "");
          notify("设置已保存");
          loadOverview();
        }).catch(function (err) { setError(err.message || String(err)); })
          .finally(function () { setSavingSettings(false); });
      }

      function renameProject() {
        if (!selectedProject) return;
        var next = window.prompt("项目名称", selectedProject.name);
        if (!next || !next.trim() || next.trim() === selectedProject.name) return;
        api("project/rename", { id: selectedProject.id, name: next.trim() }).then(function (value) {
          setSelectedProject(value.project);
          notify("项目已重命名");
          loadProjects();
        }).catch(function (err) { setError(err.message || String(err)); });
      }

      function importFile(event) {
        var file = event.target.files && event.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var data = JSON.parse(String(reader.result || ""));
            api("import", { data: data, mode: "merge" }).then(function (value) {
              notify("导入完成：新增 " + value.imported + " 条，更新 " + value.updated + " 条");
              refreshCurrent();
            }).catch(function (err) { setError(err.message || String(err)); });
          } catch (err) {
            setError("导入文件不是有效 JSON");
          }
        };
        reader.readAsText(file);
        event.target.value = "";
      }

      var autoEnabled = settingsForm ? (settingsForm.autoGlobal || settingsForm.autoProject) : false;
      var tabs = [
        ["overview", "概览"],
        ["global", "全局记忆"],
        ["projects", "项目记忆"],
        ["settings", "自动记忆设置"],
      ];
      return h("div", { className: "dsm-root" },
        h("div", { className: "dsm-header" },
          h("div", { className: "dsm-header-main" },
            h("h2", { className: "dsm-title" }, "智能记忆"),
            h("div", { className: "dsm-sub" }, "跨会话记住你的习惯与偏好，并为每个项目保留独立上下文。"),
          ),
          h("div", { className: "dsm-header-actions" },
            h("span", { className: "dsm-status" },
              h("span", { className: "dsm-dot", "data-off": autoEnabled ? "false" : "true" }),
              autoEnabled ? "自动记忆已开启" : "自动记忆已关闭",
            ),
            h("button", { className: "dsm-btn", onClick: function () { refreshCurrent(); loadOverview(); } }, "刷新"),
          ),
        ),
        h("div", { className: "dsm-tabs" }, tabs.map(function (item) {
          return h("button", { key: item[0], className: "dsm-tab", "data-active": tab === item[0] ? "true" : "false", onClick: function () { setTab(item[0]); } }, item[1]);
        })),
        error ? h("div", { className: "dsm-error" }, error, h("button", { className: "dsm-btn dsm-btn-ghost", style: { marginLeft: 8 }, onClick: function () { setError(""); } }, "关闭")) : null,
        tab === "overview" ? h(OverviewTab, { overview: overview }) : null,
        tab === "global" ? h(GlobalTab, {
          memories: memories, total: total, loading: loading, query: query, category: category,
          setQuery: setQuery, setCategory: setCategory,
          onAdd: openAdd, onExport: function () { exportData("global"); }, onRefresh: refreshCurrent,
          onPin: pinMemory, onEdit: openEdit, onLock: lockMemory, onDelete: deleteMemory,
        }) : null,
        tab === "projects" ? h(ProjectsTab, {
          projects: projects, loading: projectsLoading, selectedProject: selectedProject,
          memories: memories, projectTotal: total, query: query, category: category,
          setQuery: setQuery, setCategory: setCategory,
          onSelect: function (project) { setSelectedProject(project); setQuery(""); setCategory(""); },
          onBack: function () { setSelectedProject(null); setMemories([]); setTotal(0); },
          onAdd: openAdd, onRefresh: refreshCurrent,
          onPin: pinMemory, onEdit: openEdit, onLock: lockMemory, onDelete: deleteMemory,
          onExportProject: function () { if (selectedProject) exportData("project", selectedProject.id); },
          onClearProject: clearProject, onRename: renameProject,
        }) : null,
        tab === "settings" ? h(SettingsTab, {
          form: settingsForm, setForm: setSettingsForm, storagePath: storagePath,
          saving: savingSettings, onSave: saveSettings,
          onReload: loadSettings,
          onExportAll: function () { exportData("all"); },
          onImport: function () { if (fileInputRef.current) fileInputRef.current.click(); },
          onForgetAll: forgetAll,
        }) : null,
        h("input", { type: "file", accept: "application/json,.json", ref: fileInputRef, style: { display: "none" }, onChange: importFile }),
        editor ? h(EditorModal, {
          scope: editor.scope, projectId: editor.projectId, memory: editor.memory,
          onClose: closeEditor, onSaved: onSaved,
        }) : null,
        confirm ? h(ConfirmModal, {
          title: confirm.title, message: confirm.message, confirmLabel: confirm.confirmLabel,
          onClose: function () { setConfirm(null); }, onConfirm: confirm.onConfirm,
        }) : null,
        toast ? h("div", { className: "dsm-toast" }, toast) : null,
      );
    }

    function apply(ctx) {
      try {
        ctx.effect(function () {
          if (typeof styles !== "undefined" && styles && typeof styles.insert === "function") {
            return styles.insert(CSS);
          }
          if (typeof document !== "undefined") {
            var el = document.createElement("style");
            el.setAttribute("data-plugin", "dsh-smart-memory");
            el.textContent = CSS;
            document.head.appendChild(el);
            return function () { el.remove(); };
          }
        }, "smart-memory: styles");
      } catch (error) {
        console.warn("[smart-memory] style injection failed", error);
      }
      var slots = null;
      try { slots = typeof ctx.get === "function" ? ctx.get("slots") : null; } catch (error) { slots = null; }
      if (!slots) {
        try { slots = ctx.slots; } catch (error) { slots = null; }
      }
      if (!slots || typeof slots.inject !== "function" || typeof slots.register !== "function") {
        console.warn("[smart-memory] settings.section slot unavailable");
        return;
      }
      try {
        slots.inject("settings.section", function () {
          return slots.register(
            { name: "settings.section", id: "smart-memory", order: 18, label: function () { return "智能记忆"; } },
            function (props) { return h(SmartMemoryPage, props); },
          );
        });
      } catch (error) {
        console.warn("[smart-memory] settings.section registration failed", error);
      }
      try {
        slots.inject("settings.section.icon", function () {
          return slots.register(
            { name: "settings.section.icon", id: "smart-memory", order: 0 },
            function (props) { return h(MemoryIcon, props); },
          );
        });
      } catch (error) {
        console.warn("[smart-memory] settings.section.icon registration failed", error);
      }
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  },
});

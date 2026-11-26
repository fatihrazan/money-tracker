// Small progressive enhancements: amount preview, custom select/date pickers,
// transaction kind toggle, quick-fill chips, confirm dialogs, auto-submitting filters,
// and in-place page navigation with transitions.
(function () {
  "use strict";

  const MULTIPLIERS = { rb: 1e3, ribu: 1e3, k: 1e3, jt: 1e6, juta: 1e6 };

  // Mirrors parse_amount() in money.py; the server stays the source of truth.
  function parseAmount(text) {
    let s = text.trim().toLowerCase().replace(/\s+/g, "");
    const negative = s.startsWith("-");
    if (negative) s = s.slice(1);
    if (s.startsWith("rp")) s = s.slice(2);
    const m = s.match(/^(\d[\d.,]*)(rb|ribu|k|jt|juta)?$/);
    if (!m) return null;

    let value;
    if (m[2]) {
      const n = Number(m[1].replace(",", "."));
      if (!Number.isFinite(n)) return null;
      value = Math.round(n * MULTIPLIERS[m[2]] * 1000) / 1000;
      if (!Number.isInteger(value)) return null;
    } else if (/^\d+$/.test(m[1])) {
      value = Number(m[1]);
    } else if (/^\d{1,3}(\.\d{3})+$/.test(m[1]) || /^\d{1,3}(,\d{3})+$/.test(m[1])) {
      value = Number(m[1].replace(/[.,]/g, ""));
    } else {
      return null;
    }
    return negative ? -value : value;
  }

  function formatRupiah(n) {
    return (n < 0 ? "-" : "") + "Rp" + Math.abs(n).toLocaleString("id-ID");
  }

  function updatePreview(input) {
    const preview = input.closest(".field").querySelector(".amount-preview");
    if (!preview) return;
    if (!input.value.trim()) {
      preview.textContent = "";
      preview.classList.remove("invalid");
      return;
    }
    const value = parseAmount(input.value);
    preview.textContent = value === null ? "Format tidak dikenali" : "= " + formatRupiah(value);
    preview.classList.toggle("invalid", value === null);
  }

  // Custom pickers. The native <select>/<input> stays in the form as the source
  // of truth (and as the no-JS fallback); these widgets only drive its value.

  const ICONS = {
    chevDown: '<path d="m6 9 6 6 6-6"/>',
    chevLeft: '<path d="m15 18-6-6 6-6"/>',
    chevRight: '<path d="m9 18 6-6-6-6"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  };

  function svg(name, size, cls) {
    return `<svg class="icon ${cls || ""}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
      `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  }

  function el(tag, className, attrs) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  let uid = 0;
  let openPicker = null;

  // Open below the trigger, or above when there is no room; keep clear of the mobile nav.
  function place(trigger, panel) {
    panel.classList.remove("up", "end");
    if (getComputedStyle(panel).position === "fixed") return; // bottom sheet on phones
    const r = trigger.getBoundingClientRect();
    const nav = document.querySelector(".nav-mobile");
    // The tab bar floats, so what it blocks runs from its top edge to the bottom of the screen.
    const navRect = nav && nav.getBoundingClientRect();
    const navH = navRect && navRect.height ? window.innerHeight - navRect.top : 0;
    const need = panel.offsetHeight + 12;
    if (window.innerHeight - navH - r.bottom < need && r.top - 72 >= need) panel.classList.add("up");
    if (r.left + panel.offsetWidth > document.documentElement.clientWidth - 8) panel.classList.add("end");
    panel.scrollIntoView({ block: "nearest" });
  }

  function popover(wrap, trigger, panel, onOpen) {
    panel.classList.add("popover");
    panel.hidden = true;
    panel.tabIndex = -1;
    // Picker panels sit inside <label>s; stop clicks on them from re-activating the trigger.
    if (wrap.closest("label")) panel.addEventListener("click", (event) => event.preventDefault());

    const api = {
      wrap,
      open() {
        if (openPicker) openPicker.close(false);
        panel.hidden = false;
        wrap.classList.add("open");
        trigger.setAttribute("aria-expanded", "true");
        place(trigger, panel);
        openPicker = api;
        onOpen();
      },
      close(focusTrigger) {
        if (panel.hidden) return;
        panel.hidden = true;
        wrap.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
        if (openPicker === api) openPicker = null;
        if (focusTrigger) trigger.focus();
      },
    };
    trigger.addEventListener("click", () => (panel.hidden ? api.open() : api.close(true)));
    wrap.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) {
        event.preventDefault();
        api.close(true);
      }
    });
    wrap.addEventListener("focusout", (event) => {
      if (!wrap.contains(event.relatedTarget)) api.close(false);
    });
    return api;
  }

  document.addEventListener("pointerdown", (event) => {
    if (openPicker && !openPicker.wrap.contains(event.target)) openPicker.close(false);
  });

  function enhanceSelect(select) {
    const id = "picker-" + ++uid;
    const wrap = el("div", "cselect");
    const trigger = el("button", "picker-trigger", { type: "button", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-controls": id });
    trigger.innerHTML = '<span class="picker-value"></span>' + svg("chevDown", 18, "chev");
    const valueEl = trigger.firstChild;
    const menu = el("ul", "cselect-menu", { id, role: "listbox" });

    select.parentNode.insertBefore(wrap, select);
    wrap.append(trigger, select, menu);
    select.classList.add("native-hidden");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    let active = -1;
    let typed = "";
    let typedAt = 0;

    function render() {
      const opt = select.options[select.selectedIndex];
      valueEl.textContent = opt ? opt.textContent.trim() : "";
      valueEl.classList.toggle("placeholder", !opt || opt.value === "");
      trigger.disabled = select.disabled;
    }

    function build() {
      menu.innerHTML = "";
      Array.from(select.options).forEach((opt, i) => {
        const li = el("li", opt.value === "" ? "placeholder" : "", {
          role: "option", id: `${id}-${i}`, "data-index": i, "aria-selected": String(i === select.selectedIndex),
        });
        li.innerHTML = "<span></span>" + svg("check", 16);
        li.firstChild.textContent = opt.textContent.trim();
        menu.append(li);
      });
    }

    function setActive(i, scroll) {
      const items = menu.children;
      if (!items.length) return;
      active = (i + items.length) % items.length;
      Array.from(items).forEach((li, j) => li.classList.toggle("active", j === active));
      menu.setAttribute("aria-activedescendant", items[active].id);
      if (scroll !== false) items[active].scrollIntoView({ block: "nearest" });
    }

    function choose(i) {
      if (i !== select.selectedIndex) {
        select.selectedIndex = i;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      picker.close(true);
    }

    const picker = popover(wrap, trigger, menu, () => {
      menu.focus();
      setActive(Math.max(select.selectedIndex, 0));
    });
    const openOnce = picker.open;
    picker.open = () => { build(); openOnce(); };

    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        picker.open();
      }
    });

    menu.addEventListener("keydown", (event) => {
      const last = menu.children.length - 1;
      const moves = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: last };
      if (event.key in moves) {
        event.preventDefault();
        setActive(Math.min(Math.max(moves[event.key], 0), last));
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        choose(active);
      } else if (event.key.length === 1 && /\S/.test(event.key)) {
        // Type-ahead: jump to the next option starting with what was typed.
        typed = (Date.now() - typedAt > 600 ? "" : typed) + event.key.toLowerCase();
        typedAt = Date.now();
        const labels = Array.from(menu.children, (li) => li.textContent.toLowerCase());
        const start = typed.length === 1 ? active + 1 : active;
        for (let k = 0; k <= last; k++) {
          const j = (start + k) % (last + 1);
          if (labels[j].startsWith(typed)) { setActive(j); break; }
        }
      }
    });

    menu.addEventListener("pointermove", (event) => {
      const li = event.target.closest("li");
      if (li && +li.dataset.index !== active) setActive(+li.dataset.index, false);
    });
    menu.addEventListener("click", (event) => {
      const li = event.target.closest("li");
      if (li) choose(+li.dataset.index);
    });

    select.addEventListener("change", render);
    new MutationObserver(render).observe(select, { attributes: true, attributeFilter: ["disabled"] });
    render();
  }

  const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
  const fmtMonth = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" });
  const fmtDay = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" });
  const fmtWeekday = new Intl.DateTimeFormat("id-ID", { weekday: "long" });
  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const startOfToday = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };

  function fromISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function describeDate(d) {
    const diff = Math.round((d - startOfToday()) / 864e5);
    const rel = { "-1": "Kemarin", 0: "Hari ini", 1: "Besok" }[diff] || fmtWeekday.format(d);
    return `${rel}, ${fmtDay.format(d)}`;
  }

  function enhanceDate(input) {
    const wrap = el("div", "cdate");
    const trigger = el("button", "picker-trigger", { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" });
    trigger.innerHTML = svg("calendar", 18) + '<span class="picker-value"></span>' + svg("chevDown", 18, "chev");
    const valueEl = trigger.querySelector(".picker-value");

    const panel = el("div", "cdate-panel", { role: "dialog", "aria-label": "Pilih tanggal" });
    panel.innerHTML =
      '<div class="cdate-head">' +
        `<button type="button" class="cdate-nav" data-step="-1" aria-label="Bulan sebelumnya">${svg("chevLeft", 18)}</button>` +
        '<strong aria-live="polite"></strong>' +
        `<button type="button" class="cdate-nav" data-step="1" aria-label="Bulan berikutnya">${svg("chevRight", 18)}</button>` +
      "</div>" +
      '<div class="cdate-grid" role="grid"></div>' +
      '<div class="cdate-foot">' +
        '<button type="button" class="btn btn-small" data-offset="-1">Kemarin</button>' +
        '<button type="button" class="btn btn-small" data-offset="0">Hari ini</button>' +
      "</div>";
    const title = panel.querySelector("strong");
    const grid = panel.querySelector(".cdate-grid");
    WEEKDAYS.forEach((w) => grid.append(Object.assign(el("span", "cdate-weekday"), { textContent: w })));
    // 6 weeks of day buttons, reused across renders so keyboard focus never gets dropped.
    const days = Array.from({ length: 42 }, () => grid.appendChild(el("button", "cdate-day", { type: "button" })));

    input.parentNode.insertBefore(wrap, input);
    input.type = "hidden";
    wrap.append(trigger, input, panel);

    let focusDate = fromISO(input.value) || startOfToday();

    function renderTrigger() {
      const d = fromISO(input.value);
      valueEl.textContent = d ? describeDate(d) : "Pilih tanggal";
      valueEl.classList.toggle("placeholder", !d);
    }

    function renderGrid() {
      const first = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
      const start = addDays(first, -((first.getDay() + 6) % 7));
      const today = toISO(startOfToday());
      title.textContent = fmtMonth.format(first);
      days.forEach((btn, i) => {
        const d = addDays(start, i);
        const iso = toISO(d);
        btn.textContent = d.getDate();
        btn.dataset.date = iso;
        btn.tabIndex = iso === toISO(focusDate) ? 0 : -1;
        btn.classList.toggle("outside", d.getMonth() !== first.getMonth());
        btn.classList.toggle("today", iso === today);
        btn.classList.toggle("selected", iso === input.value);
        btn.setAttribute("aria-pressed", String(iso === input.value));
        btn.setAttribute("aria-label", describeDate(d));
      });
    }

    function moveFocus(d) {
      focusDate = d;
      renderGrid();
      grid.querySelector(`[data-date="${toISO(d)}"]`).focus();
    }

    function pick(d) {
      input.value = toISO(d);
      input.dispatchEvent(new Event("change", { bubbles: true }));
      renderTrigger();
      picker.close(true);
    }

    const picker = popover(wrap, trigger, panel, () => moveFocus(fromISO(input.value) || startOfToday()));

    panel.addEventListener("click", (event) => {
      const btn = event.target.closest("button");
      if (!btn) return;
      if (btn.dataset.step) {
        focusDate = new Date(focusDate.getFullYear(), focusDate.getMonth() + +btn.dataset.step, 1);
        renderGrid();
      } else if (btn.dataset.offset) {
        pick(addDays(startOfToday(), +btn.dataset.offset));
      } else if (btn.dataset.date) {
        pick(fromISO(btn.dataset.date));
      }
    });

    grid.addEventListener("keydown", (event) => {
      const d = focusDate;
      const weekday = (d.getDay() + 6) % 7;
      const moves = {
        ArrowLeft: addDays(d, -1), ArrowRight: addDays(d, 1), ArrowUp: addDays(d, -7), ArrowDown: addDays(d, 7),
        Home: addDays(d, -weekday), End: addDays(d, 6 - weekday),
        PageUp: new Date(d.getFullYear(), d.getMonth() - 1, d.getDate()),
        PageDown: new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()),
      };
      if (event.key in moves) {
        event.preventDefault();
        moveFocus(moves[event.key]);
      }
    });

    renderTrigger();
  }

  let confirmModal = null;

  function confirmDialog(message) {
    if (!confirmModal) {
      confirmModal = el("dialog", "modal", { "aria-labelledby": "modal-msg" });
      confirmModal.innerHTML =
        '<form method="dialog">' +
          `<span class="modal-icon">${svg("alert", 24)}</span>` +
          '<p class="modal-msg" id="modal-msg"></p>' +
          '<div class="modal-actions">' +
            '<button class="btn" value="cancel" autofocus>Batal</button>' +
            '<button class="btn btn-danger-solid" value="ok">Ya, lanjutkan</button>' +
          "</div>" +
        "</form>";
      // Clicking the dimmed backdrop cancels.
      confirmModal.addEventListener("click", (event) => {
        if (event.target === confirmModal) confirmModal.close("cancel");
      });
      document.body.append(confirmModal);
    }
    confirmModal.querySelector(".modal-msg").textContent = message;
    confirmModal.returnValue = "";
    confirmModal.showModal();
    return new Promise((resolve) => {
      confirmModal.addEventListener("close", () => resolve(confirmModal.returnValue === "ok"), { once: true });
    });
  }

  function initTxForm(form, root) {
    const applyKind = () => {
      const kind = form.querySelector('input[name="kind"]:checked').value;
      form.querySelectorAll("[data-kinds]").forEach((el) => {
        const active = el.dataset.kinds.split(" ").includes(kind);
        el.hidden = !active;
        el.querySelectorAll("input, select").forEach((field) => { field.disabled = !active; });
      });
      const label = form.querySelector("[data-account-label]");
      if (label) label.textContent = kind === "transfer" ? "Dari akun" : "Akun";
    };
    form.addEventListener("change", (event) => {
      if (event.target.name === "kind") applyKind();
    });

    root.querySelectorAll("[data-fill]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const fill = JSON.parse(chip.dataset.fill);
        form.querySelector('input[name="kind"][value="expense"]').checked = true;
        applyKind();
        const amount = form.elements.amount;
        amount.value = fill.amount.toLocaleString("id-ID");
        updatePreview(amount);
        // Fire change so the custom pickers show the new values.
        const setValue = (field, value) => {
          field.value = value;
          field.dispatchEvent(new Event("change", { bubbles: true }));
        };
        setValue(form.elements.account_id, fill.account_id);
        setValue(form.querySelector('select[name="category_id"]:not([disabled])'), fill.category_id);
        form.elements.note.value = fill.note;
        form.querySelector('button[type="submit"]').focus();
      });
    });
  }

  // Swipe-to-delete rows: drag the row left to reveal the action behind it. Horizontal
  // drags are ours; vertical ones are left to the browser (touch-action: pan-y) for scrolling.
  let openSwipe = null;

  function closeSwipe() {
    if (openSwipe) openSwipe.classList.remove("open");
    openSwipe = null;
  }

  function initSwipe(row) {
    const content = row.querySelector(".cat-row");
    let start = null;

    content.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const width = row.querySelector(".swipe-action").offsetWidth + 8;
      start = { x: event.clientX, y: event.clientY, base: row.classList.contains("open") ? -width : 0, width, dragging: false };
    });

    content.addEventListener("pointermove", (event) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!start.dragging) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { start = null; return; }
        if (Math.abs(dx) < 8) return;
        start.dragging = true;
        row.classList.add("dragging");
        content.setPointerCapture(event.pointerId);
        if (openSwipe !== row) closeSwipe();
      }
      let x = Math.min(0, start.base + dx);
      // Rubber-band past the button's width.
      if (x < -start.width) x = -start.width - (-start.width - x) * 0.3;
      content.style.transform = `translateX(${x}px)`;
      start.x0 = x;
    });

    const end = () => {
      if (!start) return;
      if (start.dragging) {
        const open = start.x0 < -start.width / 2;
        row.classList.remove("dragging");
        content.style.transform = "";
        row.classList.toggle("open", open);
        if (open) openSwipe = row;
        else if (openSwipe === row) openSwipe = null;
      } else if (row.classList.contains("open")) {
        closeSwipe(); // a tap on an open row closes it
      }
      start = null;
    };
    content.addEventListener("pointerup", end);
    content.addEventListener("pointercancel", end);
  }

  document.addEventListener("pointerdown", (event) => {
    if (openSwipe && !openSwipe.contains(event.target)) closeSwipe();
  });

  // Everything bound to elements inside <main>; runs on first load and after every page swap.
  function initPage(root) {
    root.querySelectorAll("[data-amount]").forEach((input) => {
      input.addEventListener("input", () => updatePreview(input));
      updatePreview(input);
    });
    root.querySelectorAll("select").forEach(enhanceSelect);
    root.querySelectorAll('input[type="date"]').forEach(enhanceDate);

    const form = root.querySelector("#tx-form");
    if (form) initTxForm(form, root);

    root.querySelectorAll("[data-dismiss]").forEach((flash) => {
      const close = () => {
        flash.classList.add("leaving");
        setTimeout(() => flash.remove(), 250);
      };
      flash.querySelector(".flash-close").addEventListener("click", close);
      setTimeout(close, 5000);
    });

    openSwipe = null;
    root.querySelectorAll("[data-swipe]").forEach(initSwipe);

    root.querySelectorAll("[data-reveal]").forEach((button) => {
      const input = button.parentElement.querySelector("input");
      button.addEventListener("click", () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        button.classList.toggle("on", show);
        button.setAttribute("aria-label", show ? "Sembunyikan kata sandi" : "Tampilkan kata sandi");
      });
    });

    root.querySelectorAll("[data-autosubmit]").forEach((select) => {
      select.addEventListener("change", () => select.form.requestSubmit());
    });
  }

  // In-place navigation: links and forms are fetched and only <main>, the nav highlight
  // and the title are swapped, with a slide in the direction of travel. Anything
  // unexpected (network error, a page without <main>) falls back to a normal page load.

  const TABS = Array.from(document.querySelectorAll(".nav-mobile a"), (a) => a.pathname);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const progress = document.body.appendChild(el("div", "progress", { "aria-hidden": "true" }));
  let currentUrl = new URL(location.href);
  let navToken = 0;

  function direction(from, to) {
    if (from.pathname === to.pathname) {
      const a = from.searchParams.get("month");
      const b = to.searchParams.get("month");
      return a && b && a !== b ? (b > a ? "forward" : "back") : "fade";
    }
    const a = TABS.indexOf(from.pathname);
    const b = TABS.indexOf(to.pathname);
    if (a >= 0 && b >= 0) return b > a ? "forward" : "back";
    if (b < 0) return "forward"; // into a detail page
    return "back"; // back out to a tab
  }

  function startProgress() {
    const timer = setTimeout(() => { progress.className = "progress active"; }, 120);
    return () => {
      clearTimeout(timer);
      if (progress.classList.contains("active")) progress.className = "progress done";
    };
  }

  function swap(doc, to, scroll) {
    if (openPicker) openPicker.close(false);
    const dir = direction(currentUrl, to);
    currentUrl = to;

    const update = () => {
      document.title = doc.title;
      document.querySelector("main").replaceWith(doc.querySelector("main"));
      [".nav-desktop", ".nav-mobile"].forEach((sel) => {
        const fresh = doc.querySelectorAll(`${sel} a`);
        // Pages rendered from a POST (validation errors) mark no tab; keep the current one.
        if (!doc.querySelector(`${sel} [aria-current]`)) return;
        document.querySelectorAll(`${sel} a`).forEach((a, i) => {
          if (fresh[i] && fresh[i].hasAttribute("aria-current")) a.setAttribute("aria-current", "page");
          else a.removeAttribute("aria-current");
        });
      });
      window.scrollTo(0, scroll);
      const main = document.querySelector("main");
      initPage(main);
      if (!document.startViewTransition) main.classList.add("page-enter");
      // Only autofocus with a mouse; on phones it would pop the keyboard on every tab switch.
      const focusTarget = window.matchMedia("(pointer: fine)").matches && main.querySelector("[autofocus]");
      (focusTarget || main).focus({ preventScroll: true });
    };

    document.documentElement.dataset.nav = dir;
    if (document.startViewTransition && !reducedMotion.matches) document.startViewTransition(update);
    else update();
  }

  // Resolves true once the page is swapped in, false when the caller should fall back.
  async function navigate(url, { method = "GET", body = null, push = true, scroll = 0 } = {}) {
    const token = ++navToken;
    const done = startProgress();
    try {
      const response = await fetch(url, { method, body, headers: { "X-Requested-With": "fetch" } });
      if (!(response.headers.get("content-type") || "").includes("text/html")) return false;
      const html = await response.text();
      if (token !== navToken) return true; // a newer navigation took over
      const doc = new DOMParser().parseFromString(html, "text/html");
      if (!doc.querySelector("main")) return false;
      // Crossing between the login pages and the app (e.g. the session ran out): the bars
      // around <main> differ, so load that page properly instead of swapping.
      if (doc.body.dataset.shell !== document.body.dataset.shell) {
        location.assign(response.url);
        return true;
      }

      // A POST that re-rendered (validation errors) has no URL of its own: stay put.
      const to = new URL(response.redirected || method === "GET" ? response.url : location.href);
      if (push) {
        if (to.href === location.href) history.replaceState({ scroll: 0 }, "", to.href);
        else history.pushState({ scroll: 0 }, "", to.href);
      }
      swap(doc, to, scroll);
      return true;
    } catch (err) {
      return false;
    } finally {
      done();
    }
  }

  function submitForm(form, submitter) {
    if (form.dataset.busy) return;
    form.dataset.busy = "1";
    const button = submitter || form.querySelector('button[type="submit"], button:not([type])');
    const spin = setTimeout(() => button && button.classList.add("is-loading"), 120);

    const data = new URLSearchParams(new FormData(form, submitter));
    // submitter.formAction falls back to the page URL, not form.action, when the attribute is absent.
    const action = submitter && submitter.hasAttribute("formaction") ? submitter.formAction : form.action;
    const method = form.method.toUpperCase();
    let request;
    if (method === "GET") {
      const url = new URL(action);
      url.search = data;
      request = navigate(url.href);
    } else {
      request = navigate(action, { method, body: data });
    }
    request.then((ok) => {
      clearTimeout(spin);
      delete form.dataset.busy;
      if (button) button.classList.remove("is-loading");
      if (!ok) HTMLFormElement.prototype.submit.call(form);
    });
  }

  document.addEventListener("click", (event) => {
    const a = event.target.closest("a[href]");
    if (!a || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (a.target || a.hasAttribute("download") || a.hasAttribute("data-native") || a.origin !== location.origin) return;
    if (a.pathname.startsWith("/static/")) return;
    if (a.hash && a.pathname === location.pathname && a.search === location.search) return;
    event.preventDefault();
    navigate(a.href).then((ok) => { if (!ok) location.href = a.href; });
  });

  document.addEventListener("submit", (event) => {
    const target = event.target;
    if (target.getAttribute("method") === "dialog" || target.hasAttribute("data-native")) return;
    event.preventDefault();
    const submitter = event.submitter;
    const message = target.dataset.confirm;
    if (!message) submitForm(target, submitter);
    else confirmDialog(message).then((ok) => { if (ok) submitForm(target, submitter); });
  });

  history.scrollRestoration = "manual";
  history.replaceState({ scroll: window.scrollY }, "");
  let scrollSave;
  window.addEventListener("scroll", () => {
    clearTimeout(scrollSave);
    scrollSave = setTimeout(() => history.replaceState({ ...history.state, scroll: window.scrollY }, ""), 150);
  }, { passive: true });

  window.addEventListener("popstate", (event) => {
    const scroll = (event.state && event.state.scroll) || 0;
    navigate(location.href, { push: false, scroll }).then((ok) => { if (!ok) location.reload(); });
  });

  // Press feedback: an ink ripple from the touch point on buttons, tabs and list rows.
  const RIPPLE = ".btn, .chip, .nav-mobile a, .nav-desktop a, .segmented span, .picker-trigger, .tx, .balance";
  document.addEventListener("pointerdown", (event) => {
    const host = event.target.closest(RIPPLE);
    if (!host || host.disabled || reducedMotion.matches) return;
    const r = host.getBoundingClientRect();
    const x = event.clientX - r.left;
    const y = event.clientY - r.top;
    const size = 2 * Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));
    const ink = el("i", "ripple");
    Object.assign(ink.style, { width: `${size}px`, height: `${size}px`, left: `${x - size / 2}px`, top: `${y - size / 2}px` });
    host.classList.add("ripple-host");
    host.append(ink);
    setTimeout(() => ink.remove(), 600);
  });

  // Theme toggle. The choice is saved per device; until one is made the system setting is
  // followed (the script in base.html applies it before first paint).
  const themeToggle = document.querySelector("[data-theme-toggle]");
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  function savedTheme() {
    try { return localStorage.getItem("theme"); } catch (err) { return null; }
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeMeta.content = theme === "dark" ? "#15141b" : "#fbf4ea";
    const label = theme === "dark" ? "Ganti ke mode terang" : "Ganti ke mode gelap";
    themeToggle.setAttribute("aria-label", label);
    themeToggle.title = label;
  }

  themeToggle.addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", theme); } catch (err) { /* private mode: just don't remember */ }
    if (!document.startViewTransition || reducedMotion.matches) {
      applyTheme(theme);
      return;
    }
    const r = themeToggle.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const style = document.documentElement.style;
    style.setProperty("--reveal-x", `${x}px`);
    style.setProperty("--reveal-y", `${y}px`);
    style.setProperty("--reveal-r", `${Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))}px`);
    document.documentElement.dataset.nav = "theme";
    document.startViewTransition(() => applyTheme(theme)).finished.finally(() => {
      if (document.documentElement.dataset.nav === "theme") delete document.documentElement.dataset.nav;
    });
  });

  systemDark.addEventListener("change", (event) => {
    if (!savedTheme()) applyTheme(event.matches ? "dark" : "light");
  });
  applyTheme(document.documentElement.dataset.theme || (systemDark.matches ? "dark" : "light"));

  // Avatar menu in the top bar (username and log out). The top bar is never swapped,
  // so this is set up once.
  const userMenu = document.querySelector("[data-user-menu]");
  if (userMenu) {
    const trigger = userMenu.querySelector(".avatar");
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");
    popover(userMenu, trigger, userMenu.querySelector(".user-menu-panel"), () => {
      userMenu.querySelector(".user-menu-logout").focus();
    });
  }

  initPage(document.querySelector("main"));
})();

(() => {
  const STORAGE_KEY = "notes";
  const PREFS_KEY = "notes-prefs";
  const DRAFT_KEY = "notes-draft";
  const COLORS = [
    ["none", "White"], ["sun", "Sunshine"], ["peach", "Peach"], ["rose", "Rose"],
    ["grape", "Grape"], ["sky", "Sky"], ["mint", "Mint"], ["lime", "Lime"],
  ];
  const TAG_HUES = ["#7c3aed", "#ec4899", "#f59e0b", "#10b981", "#0ea5e9", "#ef4444", "#8b5cf6", "#14b8a6"];
  const VIEWS = [["all", "🗂 All"], ["pinned", "📌 Pinned"], ["tasks", "☑ Tasks"], ["due", "⏰ Due"], ["archive", "📦 Archive"], ["trash", "🗑 Trash"]];

  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

  const popup = $("notes-popup"), backdrop = $("notes-backdrop"), openBtn = $("open-notes"), closeBtn = $("close-notes");
  const form = $("note-form"), titleIn = $("note-title"), input = $("note-input"), dueIn = $("note-due");
  const saveBtn = $("save-note"), cancelBtn = $("cancel-edit"), pinToggle = $("pin-toggle");
  const search = $("note-search"), sortSel = $("sort"), colorSel = $("color-filter");
  const list = $("note-list"), empty = $("empty-state"), viewsBox = $("views"), tagsBox = $("tags");

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable; keep in memory */ } },
    raw(k) { try { return localStorage.getItem(k); } catch { return null; } },
  };

  const normalize = (n) => ({
    id: n.id || uid(), title: n.title || "", text: n.text || "", color: n.color || "none",
    pinned: !!n.pinned, archived: !!n.archived, trashed: !!n.trashed, due: n.due || "",
    created: n.created || Date.now(), updated: n.updated || n.created || Date.now(),
  });
  function uid() { return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now(); }

  let notes = store.get(STORAGE_KEY, []).map(normalize);
  if (!notes.length && store.raw(STORAGE_KEY) == null) notes = examples();
  const prefs = Object.assign({ view: "all", sort: "updated", layout: "grid" }, store.get(PREFS_KEY, {}));
  let tagFilter = null, editingId = null, draftColor = "none", draftPinned = false, undoFn = null, toastTimer;

  function examples() {
    const t = Date.now(), day = 864e5, iso = (d) => new Date(t + d).toISOString().slice(0, 10);
    return [
      { title: "Example: garden weekend", text: "- [x] Buy mulch for the maple bed\n- [ ] Call the arborist about pruning\n- [ ] Repot the fig #garden", color: "mint", pinned: true, due: iso(2 * day), created: t - 3 * day, updated: t - 600e3 },
      { title: "Example: book ideas", text: "**The Overstory** by Richard Powers\n*Braiding Sweetgrass* next? #reading", color: "grape", created: t - 5 * day, updated: t - 2 * day },
      { title: "Example: quick formatting", text: "Try `code`, **bold**, *italic*, and links like https://example.com #tips", color: "sun", created: t - day, updated: t - day },
      { title: "Example: overdue", text: "Renew library card #errands", color: "rose", due: iso(-day), created: t - 9 * day, updated: t - 4 * day },
    ].map(normalize);
  }

  const persist = () => { store.set(STORAGE_KEY, notes); updateBadge(); };
  const savePrefs = () => store.set(PREFS_KEY, prefs);
  const tagsOf = (n) => [...new Set(((n.title + " " + n.text).match(/(^|\s)#[\p{L}\p{N}_-]+/gu) || []).map((s) => s.trim().slice(1).toLowerCase()))];
  const tasksOf = (n) => { const m = n.text.match(/^\s*[-*] \[( |x|X)\]/gm) || []; return { total: m.length, done: m.filter((s) => /x/i.test(s)).length }; };
  const tagColor = (t) => { let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TAG_HUES[h % TAG_HUES.length]; };
  const words = (s) => (s.trim().match(/\S+/g) || []).length;
  const formatDate = (ts) => new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const daysUntil = (d) => { const [y, m, dd] = d.split("-").map(Number); const due = new Date(y, m - 1, dd); const now = new Date(); now.setHours(0, 0, 0, 0); return Math.round((due - now) / 864e5); };

  // ---- inline formatting (escape first, then apply safe patterns) ----
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function fmt(line, q) {
    let h = esc(line);
    const codes = [];
    h = h.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    h = h.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    h = h.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, '$1<span class="tag" data-tag="$2">#$2</span>');
    h = h.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
    if (q) {
      const re = new RegExp("(" + esc(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")(?![^<]*>)(?![^&\\s]*;)", "gi");
      h = h.replace(re, "<mark>$1</mark>");
    }
    return h;
  }

  function renderBody(n, q) {
    const box = el("div", { className: "note-text" });
    n.text.split("\n").forEach((line, i) => {
      const m = line.match(/^\s*[-*] \[( |x|X)\]\s?(.*)$/);
      if (m) {
        const done = m[1] !== " ";
        const cb = el("input", { type: "checkbox", checked: done });
        cb.addEventListener("change", () => toggleTask(n.id, i));
        const span = el("span"); span.innerHTML = fmt(m[2], q);
        box.append(el("label", { className: "check" + (done ? " done" : "") }, cb, span));
      } else {
        const div = el("div"); div.innerHTML = fmt(line, q) || "&nbsp;";
        box.append(div);
      }
    });
    return box;
  }

  function inView(n) {
    switch (prefs.view) {
      case "trash": return n.trashed;
      case "archive": return n.archived && !n.trashed;
      case "pinned": return n.pinned && !n.archived && !n.trashed;
      case "tasks": return tasksOf(n).total > 0 && !n.archived && !n.trashed;
      case "due": return !!n.due && !n.archived && !n.trashed;
      default: return !n.archived && !n.trashed;
    }
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const colorIdx = Object.fromEntries(COLORS.map(([k], i) => [k, i]));
    const cmp = {
      updated: (a, b) => b.updated - a.updated,
      created: (a, b) => b.created - a.created,
      title: (a, b) => (a.title || a.text).localeCompare(b.title || b.text),
      color: (a, b) => colorIdx[a.color] - colorIdx[b.color] || b.updated - a.updated,
      due: (a, b) => (a.due || "9999").localeCompare(b.due || "9999") || b.updated - a.updated,
    }[prefs.sort];
    const visible = notes
      .filter(inView)
      .filter((n) => !q || (n.title + "\n" + n.text).toLowerCase().includes(q))
      .filter((n) => !tagFilter || tagsOf(n).includes(tagFilter))
      .filter((n) => !colorSel.value || n.color === colorSel.value)
      .sort((a, b) => (prefs.view === "all" ? b.pinned - a.pinned : 0) || cmp(a, b));

    list.className = "note-list" + (prefs.layout === "list" ? " list-view" : "");
    list.replaceChildren(...visible.map((n) => noteCard(n, q)));

    empty.hidden = visible.length > 0;
    const emptyMsg = { trash: ["🧹", "Trash is empty."], archive: ["📦", "Nothing archived."], pinned: ["📌", "No pinned notes."], tasks: ["☑", "No checklists yet. Try “- [ ] task”."], due: ["⏰", "No due dates set."] }[prefs.view];
    const [icon, msg] = q || tagFilter || colorSel.value ? ["🔍", "No matching notes."] : emptyMsg || ["🌈", "No notes yet. Write your first one above!"];
    empty.replaceChildren(el("b", { textContent: icon }), msg);

    $("empty-trash").hidden = prefs.view !== "trash" || !notes.some((n) => n.trashed);
    renderViews(); renderTags(); renderStats();
  }

  function noteCard(n, q) {
    const li = el("li", { className: "note" + (n.pinned ? " pinned" : "") });
    li.style.background = `var(--c-${n.color})`;
    if (n.title) { const h = el("h3"); h.innerHTML = fmt(n.title, q); li.append(h); }
    li.append(renderBody(n, q));

    const t = tasksOf(n), badges = el("div", { className: "badges" });
    if (t.total) {
      const bar = el("div", { className: "progress", title: `${t.done}/${t.total} done` }, el("i"));
      bar.firstChild.style.width = (100 * t.done / t.total) + "%";
      li.append(bar);
      badges.append(el("span", { className: "due", textContent: `☑ ${t.done}/${t.total}` }));
    }
    if (n.due) {
      const d = daysUntil(n.due);
      const label = d < 0 ? `Overdue ${-d}d` : d === 0 ? "Due today" : d === 1 ? "Due tomorrow" : `Due in ${d}d`;
      badges.append(el("span", { className: "due" + (d < 0 ? " late" : d <= 2 ? " soon" : ""), textContent: "⏰ " + label, title: n.due }));
    }
    if (badges.childNodes.length) li.append(badges);

    const acts = el("span", { className: "actions" });
    const act = (icon, title, fn) => { const b = el("button", { type: "button", textContent: icon, title }); b.setAttribute("aria-label", title); b.addEventListener("click", fn); acts.append(b); };
    if (n.trashed) {
      act("♻️", "Restore", () => update(n.id, { trashed: false }, "Restored"));
      act("❌", "Delete forever", () => destroy(n.id));
    } else {
      act("✏️", "Edit", () => startEdit(n.id));
      act(n.pinned ? "📍" : "📌", n.pinned ? "Unpin" : "Pin", () => update(n.id, { pinned: !n.pinned }));
      act("🎨", "Next color", () => update(n.id, { color: COLORS[(COLORS.findIndex(([k]) => k === n.color) + 1) % COLORS.length][0] }));
      act("⧉", "Duplicate", () => duplicate(n.id));
      act("📋", "Copy text", () => copy((n.title ? n.title + "\n\n" : "") + n.text, "Copied to clipboard"));
      act(n.archived ? "📤" : "📦", n.archived ? "Unarchive" : "Archive", () => update(n.id, { archived: !n.archived }, n.archived ? "Unarchived" : "Archived"));
      act("🗑", "Move to trash", () => update(n.id, { trashed: true }, "Moved to trash"));
    }
    li.append(el("div", { className: "note-meta" }, el("span", { textContent: formatDate(n.updated), title: "Created " + formatDate(n.created) }), acts));
    li.addEventListener("dblclick", (e) => { if (!n.trashed && !e.target.closest("button,input,a")) startEdit(n.id); });
    li.addEventListener("click", (e) => { const t = e.target.closest(".tag"); if (t) setTag(t.dataset.tag); });
    return li;
  }

  function renderViews() {
    viewsBox.replaceChildren(...VIEWS.map(([k, label]) => {
      const c = notes.filter((n) => { const v = prefs.view; prefs.view = k; const r = inView(n); prefs.view = v; return r; }).length;
      const b = el("button", { type: "button", className: "chip" }, label, el("span", { className: "n", textContent: c }));
      b.setAttribute("aria-pressed", prefs.view === k);
      b.addEventListener("click", () => { prefs.view = k; savePrefs(); render(); });
      return b;
    }));
  }

  function renderTags() {
    const counts = {};
    notes.filter((n) => !n.trashed).forEach((n) => tagsOf(n).forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
    const tags = Object.keys(counts).sort();
    if (tagFilter && !counts[tagFilter]) tagFilter = null;
    tagsBox.hidden = !tags.length;
    tagsBox.replaceChildren(...tags.map((t) => {
      const b = el("button", { type: "button", className: "chip tag-chip" }, "#" + t, el("span", { className: "n", textContent: counts[t] }));
      b.style.setProperty("--tagc", tagColor(t));
      b.setAttribute("aria-pressed", tagFilter === t);
      b.addEventListener("click", () => setTag(t));
      return b;
    }));
  }

  function renderStats() {
    const live = notes.filter((n) => !n.trashed);
    const t = live.reduce((a, n) => { const x = tasksOf(n); return [a[0] + x.done, a[1] + x.total]; }, [0, 0]);
    $("stats").textContent = `${live.length} notes · ${live.reduce((a, n) => a + words(n.title + " " + n.text), 0)} words` + (t[1] ? ` · ${t[0]}/${t[1]} tasks` : "");
  }

  function updateBadge() { $("fab-count").textContent = notes.filter((n) => !n.trashed && !n.archived).length; }
  function setTag(t) { tagFilter = tagFilter === t ? null : t; if (["trash"].includes(prefs.view)) prefs.view = "all"; render(); }

  // ---- mutations ----
  function snapshot() { const before = JSON.stringify(notes); return () => { notes = JSON.parse(before); persist(); render(); }; }
  function update(id, patch, msg) {
    const undo = snapshot();
    const n = notes.find((x) => x.id === id); if (!n) return;
    Object.assign(n, patch, "text" in patch || "title" in patch ? { updated: Date.now() } : {});
    if (patch.trashed && editingId === id) resetForm();
    persist(); render();
    if (msg) toast(msg, undo);
  }
  function destroy(id) { const undo = snapshot(); notes = notes.filter((n) => n.id !== id); persist(); render(); toast("Deleted forever", undo); }
  function duplicate(id) {
    const n = notes.find((x) => x.id === id); if (!n) return;
    const now = Date.now();
    notes.push({ ...n, id: uid(), title: n.title ? n.title + " (copy)" : "", pinned: false, created: now, updated: now });
    persist(); render(); toast("Duplicated");
  }
  function toggleTask(id, lineIdx) {
    const n = notes.find((x) => x.id === id); if (!n) return;
    const lines = n.text.split("\n");
    lines[lineIdx] = lines[lineIdx].replace(/\[( |x|X)\]/, (m, c) => (c === " " ? "[x]" : "[ ]"));
    n.text = lines.join("\n"); n.updated = Date.now();
    persist(); render();
  }

  // ---- editor ----
  function buildSwatches() {
    $("swatches").replaceChildren(...COLORS.map(([k, name]) => {
      const b = el("button", { type: "button", className: "sw", title: name });
      b.style.background = `var(--c-${k})`;
      b.setAttribute("aria-label", name);
      b.addEventListener("click", () => setDraftColor(k));
      return b;
    }));
    COLORS.forEach(([k, name]) => colorSel.append(el("option", { value: k, textContent: name })));
  }
  function setDraftColor(k) {
    draftColor = k; form.style.background = `var(--c-${k})`;
    [...$("swatches").children].forEach((b, i) => b.setAttribute("aria-pressed", COLORS[i][0] === k));
    saveDraft();
  }
  function setDraftPinned(v) { draftPinned = v; pinToggle.setAttribute("aria-pressed", v); pinToggle.style.background = v ? "color-mix(in srgb, var(--accent) 25%, transparent)" : ""; saveDraft(); }
  function updateCount() { const s = titleIn.value + " " + input.value; $("count").textContent = `${words(s)} words · ${input.value.length} chars`; }

  function startEdit(id) {
    const n = notes.find((x) => x.id === id); if (!n) return;
    editingId = id; titleIn.value = n.title; input.value = n.text; dueIn.value = n.due;
    setDraftColor(n.color); setDraftPinned(n.pinned);
    saveBtn.textContent = "Save"; cancelBtn.hidden = false; form.classList.add("editing");
    updateCount(); form.scrollIntoView({ block: "nearest" }); input.focus();
  }
  function resetForm() {
    editingId = null; titleIn.value = ""; input.value = ""; dueIn.value = "";
    setDraftColor("none"); setDraftPinned(false);
    saveBtn.textContent = "Add note"; cancelBtn.hidden = true; form.classList.remove("editing");
    updateCount(); store.set(DRAFT_KEY, null);
  }
  function saveDraft() { if (!editingId) store.set(DRAFT_KEY, { title: titleIn.value, text: input.value, due: dueIn.value, color: draftColor, pinned: draftPinned }); }
  function loadDraft() {
    const d = store.get(DRAFT_KEY, null); if (!d) return;
    titleIn.value = d.title || ""; input.value = d.text || ""; dueIn.value = d.due || "";
    setDraftColor(d.color || "none"); setDraftPinned(!!d.pinned); updateCount();
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = titleIn.value.trim(), text = input.value.replace(/\s+$/, "");
    if (!title && !text.trim()) { input.focus(); return; }
    const now = Date.now(), data = { title, text, color: draftColor, pinned: draftPinned, due: dueIn.value };
    if (editingId) {
      const n = notes.find((x) => x.id === editingId);
      if (n) Object.assign(n, data, { updated: now });
      toast("Saved");
    } else {
      notes.push(normalize({ ...data, id: uid(), created: now, updated: now }));
      if (["trash", "archive"].includes(prefs.view)) prefs.view = "all";
      toast("Note added 🎉");
    }
    persist(); resetForm(); render();
  });

  $("add-check").addEventListener("click", () => {
    const pos = input.selectionStart, before = input.value.slice(0, pos);
    const ins = (before && !before.endsWith("\n") ? "\n" : "") + "- [ ] ";
    input.setRangeText(ins, pos, input.selectionEnd, "end"); input.focus(); updateCount(); saveDraft();
  });
  pinToggle.addEventListener("click", () => setDraftPinned(!draftPinned));
  [titleIn, input, dueIn].forEach((x) => x.addEventListener("input", () => { updateCount(); saveDraft(); }));
  [titleIn, input].forEach((x) => x.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } }));
  cancelBtn.addEventListener("click", resetForm);

  // ---- controls ----
  search.addEventListener("input", render);
  sortSel.addEventListener("change", () => { prefs.sort = sortSel.value; savePrefs(); render(); });
  colorSel.addEventListener("change", render);
  $("layout-btn").addEventListener("click", () => { prefs.layout = prefs.layout === "grid" ? "list" : "grid"; savePrefs(); syncLayoutBtn(); render(); });
  const syncLayoutBtn = () => { $("layout-btn").textContent = prefs.layout === "grid" ? "☰" : "▦"; $("layout-btn").title = prefs.layout === "grid" ? "Switch to list" : "Switch to grid"; };
  $("empty-trash").addEventListener("click", () => { const undo = snapshot(); notes = notes.filter((n) => !n.trashed); persist(); render(); toast("Trash emptied", undo); });
  $("help-btn").addEventListener("click", () => { $("help-panel").hidden = !$("help-panel").hidden; $("io-panel").hidden = true; });
  $("io-btn").addEventListener("click", () => { $("io-panel").hidden = !$("io-panel").hidden; $("help-panel").hidden = true; });

  // ---- export / import ----
  function copy(text, msg) {
    const fallback = () => { $("io-panel").hidden = false; $("io-text").value = text; $("io-text").select(); toast("Selected — press Ctrl+C to copy"); };
    try { navigator.clipboard.writeText(text).then(() => toast(msg), fallback); } catch { fallback(); }
  }
  $("copy-export").addEventListener("click", () => { const j = JSON.stringify(notes, null, 2); $("io-text").value = j; copy(j, `Copied ${notes.length} notes as JSON`); });
  $("copy-md").addEventListener("click", () => {
    const md = notes.filter((n) => !n.trashed).map((n) => `## ${n.title || "Untitled"}${n.due ? ` (due ${n.due})` : ""}\n\n${n.text}`).join("\n\n---\n\n");
    $("io-text").value = md; copy(md, "Copied as Markdown");
  });
  function importJSON(str) {
    let data;
    try { data = JSON.parse(str); } catch { toast("That isn't valid JSON"); return; }
    if (!Array.isArray(data)) data = data && Array.isArray(data.notes) ? data.notes : null;
    if (!data) { toast("Expected a list of notes"); return; }
    const undo = snapshot(), ids = new Set(notes.map((n) => n.id));
    const incoming = data.filter((n) => n && (typeof n.text === "string" || typeof n.title === "string")).map((n) => normalize({ ...n, title: String(n.title || ""), text: String(n.text || ""), id: ids.has(n.id) ? uid() : n.id }));
    notes.push(...incoming); persist(); render(); toast(`Imported ${incoming.length} notes`, undo);
  }
  $("import-text").addEventListener("click", () => importJSON($("io-text").value));
  $("import-file").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => importJSON(String(r.result)); r.readAsText(f); e.target.value = "";
  });

  // ---- toast ----
  function toast(msg, undo) {
    clearTimeout(toastTimer);
    $("toast-msg").textContent = msg; undoFn = undo || null; $("toast-undo").hidden = !undo; $("toast").hidden = false;
    toastTimer = setTimeout(() => ($("toast").hidden = true), undo ? 6000 : 2200);
  }
  $("toast-undo").addEventListener("click", () => { if (undoFn) undoFn(); undoFn = null; $("toast").hidden = true; });

  // ---- open / close ----
  function open() { popup.hidden = false; backdrop.hidden = false; render(); input.focus(); }
  function close() { popup.hidden = true; backdrop.hidden = true; if (editingId) resetForm(); openBtn.focus(); }
  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", close);

  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "n" && e.shiftKey && (e.ctrlKey || e.metaKey)) { e.preventDefault(); popup.hidden ? open() : close(); return; }
    if (popup.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); if (editingId) resetForm(); else close(); }
    else if (e.key === "/" && !e.target.closest("input,textarea,select")) { e.preventDefault(); search.focus(); }
  });

  // Keep multiple tabs in sync.
  window.addEventListener("storage", (e) => { if (e.key === STORAGE_KEY) { notes = store.get(STORAGE_KEY, []).map(normalize); updateBadge(); if (!popup.hidden) render(); } });

  buildSwatches();
  sortSel.value = prefs.sort; syncLayoutBtn();
  const draft = store.get(DRAFT_KEY, null); resetForm(); if (draft) { store.set(DRAFT_KEY, draft); loadDraft(); } updateBadge();
  open();
})();

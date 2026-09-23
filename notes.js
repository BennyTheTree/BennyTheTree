(() => {
  const STORAGE_KEY = "notes";

  const $ = (id) => document.getElementById(id);
  const popup = $("notes-popup");
  const backdrop = $("notes-backdrop");
  const openBtn = $("open-notes");
  const closeBtn = $("close-notes");
  const form = $("note-form");
  const input = $("note-input");
  const saveBtn = $("save-note");
  const cancelBtn = $("cancel-edit");
  const search = $("note-search");
  const list = $("note-list");
  const empty = $("empty-state");

  let notes = load();
  let editingId = null;

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch {
      // Storage unavailable (private mode, quota); notes stay in memory.
    }
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const visible = notes
      .filter((n) => n.text.toLowerCase().includes(query))
      .sort((a, b) => b.updated - a.updated);

    list.replaceChildren(
      ...visible.map((note) => {
        const li = document.createElement("li");
        li.className = "note";

        const text = document.createElement("p");
        text.className = "note-text";
        text.textContent = note.text;

        const meta = document.createElement("div");
        meta.className = "note-meta";

        const time = document.createElement("span");
        time.textContent = formatDate(note.updated);

        const actions = document.createElement("span");
        const edit = document.createElement("button");
        edit.textContent = "Edit";
        edit.addEventListener("click", () => startEdit(note.id));
        const del = document.createElement("button");
        del.textContent = "Delete";
        del.className = "delete";
        del.addEventListener("click", () => remove(note.id));
        actions.append(edit, del);

        meta.append(time, actions);
        li.append(text, meta);
        return li;
      })
    );

    empty.hidden = visible.length > 0;
    empty.textContent = notes.length ? "No matching notes." : "No notes yet.";
  }

  function startEdit(id) {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    editingId = id;
    input.value = note.text;
    saveBtn.textContent = "Save";
    cancelBtn.hidden = false;
    input.focus();
  }

  function resetForm() {
    editingId = null;
    input.value = "";
    saveBtn.textContent = "Add note";
    cancelBtn.hidden = true;
  }

  function remove(id) {
    notes = notes.filter((n) => n.id !== id);
    if (editingId === id) resetForm();
    persist();
    render();
  }

  function open() {
    popup.hidden = false;
    backdrop.hidden = false;
    render();
    input.focus();
  }

  function close() {
    popup.hidden = true;
    backdrop.hidden = true;
    resetForm();
    openBtn.focus();
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const now = Date.now();
    if (editingId) {
      const note = notes.find((n) => n.id === editingId);
      if (note) Object.assign(note, { text, updated: now });
    } else {
      notes.push({ id: crypto.randomUUID?.() ?? String(now), text, created: now, updated: now });
    }
    persist();
    resetForm();
    render();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit();
  });

  cancelBtn.addEventListener("click", resetForm);
  search.addEventListener("input", render);
  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", close);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !popup.hidden) close();
    if (e.key.toLowerCase() === "n" && e.shiftKey && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      popup.hidden ? open() : close();
    }
  });

  // Keep multiple tabs in sync.
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      notes = load();
      render();
    }
  });
})();

/* NimNote app — DOM glue over the Nim engine (js/nncore.js). */
(function () {
  'use strict';

  var LS_NOTES = 'nn_notes_v1';

  var el = {
    q: document.getElementById('q'),
    clearQ: document.getElementById('clearQ'),
    meta: document.getElementById('meta'),
    editorCard: document.getElementById('editorCard'),
    eTitle: document.getElementById('eTitle'),
    eBody: document.getElementById('eBody'),
    eTags: document.getElementById('eTags'),
    formError: document.getElementById('formError'),
    saveBtn: document.getElementById('saveBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    resultsCard: document.getElementById('resultsCard'),
    results: document.getElementById('results'),
    emptyMsg: document.getElementById('emptyMsg'),
    langSel: document.getElementById('langSel'),
    engineVer: document.getElementById('engineVer')
  };

  var state = {
    notes: loadNotes(),
    query: '',
    editingId: null   // null = new note
  };

  function loadNotes() {
    try {
      var raw = localStorage.getItem(LS_NOTES);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (n) { return n && typeof n.id === 'string'; });
    } catch (e) { return []; }
  }

  function saveLocal() {
    try { localStorage.setItem(LS_NOTES, JSON.stringify(state.notes)); } catch (e) {}
  }

  /* ---------- engine bridge ---------- */

  function api(action, payload) {
    var res = nn_api(action, JSON.stringify(payload));
    return JSON.parse(res);
  }

  function runSearch() {
    var r = api('search', { state: state.notes, q: state.query });
    renderResults(r.results || []);
  }

  /* ---------- rendering ---------- */

  function fmtMeta(count, isSearch) {
    var t = NN_I18N.tr(isSearch ? 'ui.metaHits' : 'ui.metaAll');
    return t.replace('{n}', String(count)).replace('{q}', state.query);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderResults(results) {
    var searching = state.query.length > 0;
    el.results.innerHTML = '';

    if (results.length === 0) {
      el.emptyMsg.textContent = NN_I18N.tr(searching ? 'ui.noMatches' : 'ui.noResults');
      el.emptyMsg.hidden = false;
    } else {
      el.emptyMsg.hidden = true;
    }

    var frag = document.createDocumentFragment();
    results.forEach(function (n) {
      var li = document.createElement('li');
      li.className = 'note-item' + (n.inTitle ? ' hit-title' : '');

      var title = document.createElement('div');
      title.className = 'note-title';
      title.textContent = n.title || '(untitled)';
      li.appendChild(title);

      if (searching && n.snippet) {
        var sn = document.createElement('div');
        sn.className = 'note-snippet';
        sn.textContent = n.snippet;
        li.appendChild(sn);
      }

      var foot = document.createElement('div');
      foot.className = 'note-foot';
      if (n.tags && n.tags.length > 0) {
        var tags = document.createElement('span');
        tags.className = 'note-tags';
        tags.textContent = '#' + String(n.tags).split(',').filter(Boolean).join(' #');
        foot.appendChild(tags);
      }
      var when = document.createElement('span');
      when.className = 'note-when';
      when.textContent = fmtDate(n.updated);
      foot.appendChild(when);

      var actions = document.createElement('div');
      actions.className = 'note-actions';
      var bEdit = document.createElement('button');
      bEdit.className = 'mini-btn';
      bEdit.dataset.act = 'edit';
      bEdit.dataset.id = n.id;
      bEdit.textContent = NN_I18N.tr('ui.edit');
      var bDel = document.createElement('button');
      bDel.className = 'mini-btn danger';
      bDel.dataset.act = 'del';
      bDel.dataset.id = n.id;
      bDel.textContent = NN_I18N.tr('ui.delete');
      actions.appendChild(bEdit);
      actions.appendChild(bDel);
      foot.appendChild(actions);

      li.appendChild(foot);
      frag.appendChild(li);
    });
    el.results.appendChild(frag);

    el.meta.textContent = fmtMeta(results.length, searching);
    el.clearQ.hidden = state.query.length === 0;
    el.resultsCard.hidden = false;
  }

  function fmtDate(ms) {
    try {
      return new Date(Number(ms) || Date.now()).toLocaleDateString(NN_I18N.getLang());
    } catch (e) { return ''; }
  }

  /* ---------- editor ---------- */

  function openEditor(note) {
    state.editingId = note ? note.id : null;
    el.eTitle.value = note ? note.title : '';
    el.eBody.value = note ? note.body : '';
    el.eTags.value = note && note.tags ? String(note.tags).split(',').join(', ') : '';
    el.formError.hidden = true;
    el.editorCard.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    el.eTitle.focus();
  }

  function closeEditor() {
    el.editorCard.hidden = true;
    state.editingId = null;
  }

  function saveNote() {
    var payload = {
      id: state.editingId || undefined,
      title: el.eTitle.value,
      body: el.eBody.value,
      tags: el.eTags.value
    };
    // validate BEFORE upsert so we can show a localized error inline
    if (!payload.title.trim() && !payload.body.trim()) {
      showFormError(NN_I18N.tr('ui.errorEmpty'));
      return;
    }
    var v = api('validate', { body: payload.body });
    if (!v.ok) {
      showFormError(NN_I18N.tr('ui.errorTooLong'));
      return;
    }
    var r = api('upsert', { note: payload, state: state.notes, now: Date.now() });
    if (!r.ok) {
      if (r.error === 'empty-note') showFormError(NN_I18N.tr('ui.errorEmpty'));
      else showFormError(r.error || 'error');
      return;
    }
    state.notes = r.state;
    saveLocal();
    closeEditor();
    runSearch();
  }

  function showFormError(msg) {
    el.formError.textContent = msg;
    el.formError.hidden = false;
  }

  function deleteNote(id) {
    if (!window.confirm(NN_I18N.tr('ui.confirmDelete'))) return;
    var r = api('delete', { id: id, state: state.notes });
    if (r.ok) {
      state.notes = r.state;
      saveLocal();
      if (state.editingId === id) closeEditor();
      runSearch();
    }
  }

  /* ---------- events ---------- */

  var debounceT = null;
  el.q.addEventListener('input', function () {
    clearTimeout(debounceT);
    debounceT = setTimeout(function () {
      state.query = el.q.value;
      runSearch();
    }, 60);
  });

  el.clearQ.addEventListener('click', function () {
    el.q.value = '';
    state.query = '';
    runSearch();
    el.q.focus();
  });

  el.saveBtn.addEventListener('click', saveNote);
  el.cancelBtn.addEventListener('click', closeEditor);

  el.results.addEventListener('click', function (evt) {
    var btn = evt.target.closest('button.mini-btn');
    if (!btn) return;
    if (btn.dataset.act === 'edit') {
      var found = null;
      for (var i = 0; i < state.notes.length; i++) {
        if (state.notes[i].id === btn.dataset.id) { found = state.notes[i]; break; }
      }
      openEditor(found);
    } else if (btn.dataset.act === 'del') {
      deleteNote(btn.dataset.id);
    }
  });

  /* ---------- i18n ---------- */

  function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      node.textContent = NN_I18N.tr(node.getAttribute('data-i18n'), node.textContent);
    });
    document.querySelectorAll('[data-i18n-attr]').forEach(function (node) {
      var spec = node.getAttribute('data-i18n-attr'); // "placeholder:key"
      var parts = spec.split(':');
      if (parts.length === 2) node.setAttribute(parts[0], NN_I18N.tr(parts[1], node.getAttribute(parts[0])));
    });
  }

  el.langSel.value = NN_I18N.getLang();
  el.langSel.addEventListener('change', function () {
    NN_I18N.setLang(el.langSel.value);
  });

  NN_I18N.onChange(function () {
    applyStaticI18n();
    runSearch();
  });

  /* ---------- boot ---------- */

  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  } catch (e) {}

  if (typeof nn_version === 'function') {
    el.engineVer.textContent = 'v' + nn_version();
  }

  NN_I18N.load(function () {
    applyStaticI18n();
    runSearch();
  });
})();

// modules/search.js — Search logic + stage animation

import { currentMode, searching, allResults, renderedCount, dom, modeState, lastRenderedMode,
  setSearchMode, setSearching, setAllResults, setRenderedCount, setLastRenderedMode,
  setAiKeywords, setAiExcludes, setCurrentMode } from './state.js';
import { aiKeywords, aiExcludes } from './state.js';
import { saveHistory } from './history.js';
import { renderPage, syncResults } from './render.js';
import { selectedTags } from './tags.js';

// ── Placeholder rotation ──
var EXAMPLES_GAME = ['Co-op shooter, not too grindy, good story'];
var EXAMPLES_MOVIE = ['Something light and funny to watch while eating'];
var _exampleTimer = null;
var _exampleIdx = 0;
var _exampleStopped = false;

export function startPlaceholderRotation() {
  var examples = currentMode === 'game' ? EXAMPLES_GAME : EXAMPLES_MOVIE;
  _exampleIdx = 0;
  _exampleStopped = false;
  dom.input.placeholder = 'Try: ' + examples[0];
  clearInterval(_exampleTimer);
  // Don't rotate if only one example
  if (examples.length <= 1) return;
  _exampleTimer = setInterval(function() {
    if (_exampleStopped) return;
    _exampleIdx = (_exampleIdx + 1) % examples.length;
    dom.input.style.transition = 'opacity .3s';
    dom.input.style.opacity = '0.4';
    setTimeout(function() {
      dom.input.placeholder = 'Try: ' + examples[_exampleIdx];
      dom.input.style.opacity = '1';
    }, 300);
  }, 3500);
}

export function stopPlaceholderRotation() {
  _exampleStopped = true;
  clearInterval(_exampleTimer);
}

// ── Stage animation ──
var _stageTimers = [];

function resetStages() {
  _stageTimers.forEach(function(t) { clearTimeout(t); });
  _stageTimers = [];
  [dom.stageParse, dom.stageSearch, dom.stageSelect].forEach(function(s) {
    s.classList.remove('active', 'done');
  });
}

function typeWriter(el, text, speed, callback) {
  var dotSpan = el.querySelector('.stage-dot');
  var dotHtml = dotSpan ? dotSpan.outerHTML : '';
  el.innerHTML = dotHtml;
  el.classList.add('active');
  var i = 0;
  function type() {
    if (i < text.length) {
      el.innerHTML = dotHtml + text.substring(0, i + 1);
      i++;
      var t = setTimeout(type, speed);
      _stageTimers.push(t);
    } else if (callback) { callback(); }
  }
  type();
}

function animateStages() {
  resetStages();
  var searchLabel = currentMode === 'game' ? 'Searching the game library…' : 'Searching the movie library…';
  var stages = [
    { el: dom.stageParse, text: 'AI is understanding your request…', delay: 0 },
    { el: dom.stageSearch, text: searchLabel, delay: 1200 },
    { el: dom.stageSelect, text: 'Curating recommendations…', delay: 1200 }
  ];
  var totalDelay = 0;
  stages.forEach(function(s, i) {
    var t = setTimeout(function() {
      for (var j = 0; j < i; j++) stages[j].el.classList.remove('active'), stages[j].el.classList.add('done');
      typeWriter(s.el, s.text, 80);
    }, totalDelay);
    _stageTimers.push(t);
    totalDelay += s.delay + s.text.length * 80 + 300;
  });
}

// ── AI understanding editable ──
var _aiKws = [];
var _aiExcs = [];

export function getAiKeywords() { return _aiKws; }
export function getAiExcludes() { return _aiExcs; }

export function renderAiUnderstand(summary) {
  var tagsHtml = _aiKws.map(function(t) {
    return '<span class="tag-chip" data-tag="' + t.replace(/"/g,'&quot;') + '">' + t.replace(/</g,'&lt;') + '<span class="tag-remove" data-tag="' + t.replace(/"/g,'&quot;') + '">×</span></span>';
  }).join('');
  var avoidHtml = _aiExcs.map(function(t) {
    return '<span class="tag-chip avoid-chip" data-tag="' + t.replace(/"/g,'&quot;') + '">-' + t.replace(/</g,'&lt;') + '<span class="tag-remove" data-tag="' + t.replace(/"/g,'&quot;') + '">×</span></span>';
  }).join('');
  dom.aiEl.innerHTML =
    '<div class="label">AI Understanding</div>' +
    '<div class="summary">' + (summary || '').replace(/</g,'&lt;') + '</div>' +
    '<div class="tags-row">' + tagsHtml + avoidHtml + '</div>' +
    '<div class="add-tag-row">' +
    '<input class="add-tag-input" type="text" placeholder="Add keyword..." maxlength="20">' +
    '<button class="add-tag-btn">Add</button>' +
    '</div>';
  dom.aiEl.classList.remove('hidden');
}

function reSearchWithAiTags() {
  if (_aiKws.length === 0 && _aiExcs.length === 0) return;
  var query = _aiKws.join(' ');
  if (dom.input.value.trim() !== query) dom.input.value = query;
  doSearch(query);
}

export function initAiUnderstand() {
  dom.aiEl.addEventListener('click', function(e) {
    var removeBtn = e.target.closest('.tag-remove');
    if (removeBtn) {
      e.stopPropagation();
      var tag = removeBtn.dataset.tag;
      var kwIdx = _aiKws.indexOf(tag);
      if (kwIdx >= 0) _aiKws.splice(kwIdx, 1);
      var exIdx = _aiExcs.indexOf(tag);
      if (exIdx >= 0) _aiExcs.splice(exIdx, 1);
      var summary = dom.aiEl.querySelector('.summary');
      renderAiUnderstand(summary ? summary.textContent : '');
      reSearchWithAiTags();
      return;
    }
    var addBtn = e.target.closest('.add-tag-btn');
    if (addBtn) {
      var input = dom.aiEl.querySelector('.add-tag-input');
      var val = (input.value || '').trim();
      if (!val) return;
      if (_aiKws.indexOf(val) < 0 && _aiExcs.indexOf(val) < 0) _aiKws.push(val);
      input.value = '';
      var summary = dom.aiEl.querySelector('.summary');
      renderAiUnderstand(summary ? summary.textContent : '');
      reSearchWithAiTags();
    }
  });

  dom.aiEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.classList.contains('add-tag-input')) {
      e.preventDefault();
      var addBtn = dom.aiEl.querySelector('.add-tag-btn');
      if (addBtn) addBtn.click();
    }
  });
}

// ── Search core ──
var _searchDebounce = null;

export function doSearch(query) {
  if (searching || !query.trim()) return;

  // Debounce: 300ms, only execute last search
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(function() {
    _doSearchActual(query);
  }, 300);
}

function _doSearchActual(query) {
  setSearching(true);
  setSearchMode(currentMode);
  setLastRenderedMode('');
  dom.btn.disabled = true;
  stopPlaceholderRotation();
  dom.loadingEl.classList.remove('hidden');
  dom.emptyEl.classList.add('hidden');
  dom.aiEl.classList.add('hidden');
  dom.resultsEl.innerHTML = '';
  dom.altEl.innerHTML = '';
  dom.loadMoreBtn.classList.add('hidden');
  var oldShare = document.querySelector('.share-bar');
  if (oldShare) oldShare.remove();
  setAllResults([]);
  setRenderedCount(0);
  _aiKws = [];
  _aiExcs = [];
  syncResults([]);
  saveHistory(query.trim());
  animateStages();

  var endpoint = currentMode === 'game' ? '/api/game/search' : '/api/movie/search';
  var body = { query: query.trim() };
  if (selectedTags.length > 0) body.selected_tags = selectedTags;

  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function(r) { return r.json(); }).then(function(data) {
    dom.loadingEl.classList.add('hidden');
    resetStages();

    if (data.error) {
      dom.emptyEl.classList.remove('hidden');
      dom.emptyEl.querySelector('p').textContent = data.error;
      return;
    }

    if (data.parsed) {
      var p = data.parsed;
      var kws = (p.keywords || p.must_have || []).map(function(k) { return typeof k === 'object' ? k.w : k; });
      var nice = (p.nice_to_have || []).map(function(k) { return typeof k === 'object' ? k.w : k; });
      var excludes = (p.exclude_tags || p.exclude || []);
      _aiKws = kws.concat(nice).slice();
      _aiExcs = excludes.slice();
      renderAiUnderstand(p.summary || '');
    }

    // Search expansion hint (hidden)
    var hintEl = document.getElementById('search-hint');
    if (hintEl) hintEl.remove();

    var items = currentMode === 'game' ? data.games : data.results;
    if (!items || items.length === 0) {
      dom.emptyEl.classList.remove('hidden');
      _aiKws = [];
      _aiExcs = [];
      if (data.alternatives && data.alternatives.length > 0) {
        dom.altEl.innerHTML = '<div class="alt-label">Try these:</div>' +
          data.alternatives.map(function(a) {
            return '<div class="alt-chip" data-query="' + a.replace(/"/g,'&quot;') + '">' + a.replace(/</g,'&lt;') + '</div>';
          }).join('');
      }
      return;
    }

    setAllResults(items);
    syncResults(items);
    setRenderedCount(0);
    renderPage();
    setLastRenderedMode(currentMode);

    modeState[currentMode] = {
      input: query.trim(), results: items.slice(), rendered: renderedCount,
      aiHtml: dom.aiEl.innerHTML, aiVisible: !dom.aiEl.classList.contains('hidden'),
      query: query.trim(), aiKeywords: _aiKws.slice(), aiExcludes: _aiExcs.slice()
    };

    // Share link
    renderShareBar(query.trim());

  }).catch(function() {
    dom.loadingEl.classList.add('hidden');
    resetStages();
    dom.emptyEl.classList.remove('hidden');
    dom.emptyEl.querySelector('p').textContent = 'Search failed. Please try again later.';
    _aiKws = [];
    _aiExcs = [];
  }).finally(function() {
    setSearching(false);
    dom.btn.disabled = false;
  });
}

// ── Share link ──
function renderShareBar(query) {
  // Remove old share bar
  var old = document.querySelector('.share-bar');
  if (old) old.remove();

  var base = window.location.origin + window.location.pathname;
  var url = base + '?q=' + encodeURIComponent(query) + '&m=' + currentMode;

  var bar = document.createElement('div');
  bar.className = 'share-bar';
  bar.innerHTML = '<button class="btn-share"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>Share results</button>';

  // Insert after loadMoreBtn
  if (dom.loadMoreBtn.nextSibling) {
    dom.loadMoreBtn.parentNode.insertBefore(bar, dom.loadMoreBtn.nextSibling);
  } else {
    dom.loadMoreBtn.parentNode.appendChild(bar);
  }

  bar.querySelector('.btn-share').addEventListener('click', function() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function() {
        import('./utils.js').then(function(m) { m.showToast('Link copied to clipboard'); });
      });
    } else {
      var input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      import('./utils.js').then(function(m) { m.showToast('Link copied to clipboard'); });
    }
  });
}

// ── Mode state save/restore ──
export function saveModeState() {
  modeState[currentMode] = {
    input: dom.input.value,
    results: allResults.slice(),
    rendered: renderedCount,
    aiHtml: dom.aiEl.innerHTML,
    aiVisible: !dom.aiEl.classList.contains('hidden'),
    query: allResults.length > 0 ? (dom.input.value.trim() || modeState[currentMode].query || '') : '',
    aiKeywords: _aiKws.slice(),
    aiExcludes: _aiExcs.slice()
  };
}

export function restoreModeState() {
  var s = modeState[currentMode];
  dom.input.value = s.input;
  dom.input.style.height = 'auto';
  if (s.input) dom.input.style.height = Math.min(dom.input.scrollHeight, 80) + 'px';
  setSearchMode(currentMode);
  _aiKws = (s.aiKeywords || []).slice();
  _aiExcs = (s.aiExcludes || []).slice();

  if (s.results.length > 0) {
    if (lastRenderedMode === currentMode && renderedCount === s.rendered) return;
    setAllResults(s.results);
    syncResults(s.results);
    setRenderedCount(0);
    dom.resultsEl.innerHTML = '';
    renderPage();
    setLastRenderedMode(currentMode);
    dom.aiEl.innerHTML = s.aiHtml;
    if (s.aiVisible) dom.aiEl.classList.remove('hidden');
    else dom.aiEl.classList.add('hidden');
    dom.emptyEl.classList.add('hidden');
  } else {
    setAllResults([]);
    syncResults([]);
    setRenderedCount(0);
    setLastRenderedMode(currentMode);
    dom.resultsEl.innerHTML = '';
    dom.aiEl.classList.add('hidden');
    dom.aiEl.innerHTML = '';
    _aiKws = [];
    _aiExcs = [];
    dom.emptyEl.classList.add('hidden');
    dom.loadMoreBtn.classList.add('hidden');
  }
}

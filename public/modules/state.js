// modules/state.js — Shared state

export var currentMode = 'game';
export var searching = false;
export var allResults = [];
export var renderedCount = 0;
export var PAGE_SIZE = 10;
export var searchMode = 'game';
export var aiKeywords = [];
export var aiExcludes = [];

export function setCurrentMode(m) { currentMode = m; }
export function setSearching(v) { searching = v; }
export function setAllResults(r) { allResults = r; }
export function setRenderedCount(v) { renderedCount = v; }
export function setSearchMode(m) { searchMode = m; }
export function setAiKeywords(k) { aiKeywords = k; }
export function setAiExcludes(e) { aiExcludes = e; }

// Dual mode state isolation
export var modeState = {
  game: { input: '', results: [], rendered: 0, aiHtml: '', aiVisible: false, query: '', aiKeywords: [], aiExcludes: [] },
  movie: { input: '', results: [], rendered: 0, aiHtml: '', aiVisible: false, query: '', aiKeywords: [], aiExcludes: [] }
};
export var lastRenderedMode = '';
export function setLastRenderedMode(m) { lastRenderedMode = m; }

// DOM references (initialized by app.js)
export var dom = {};
export function initDom() {
  dom.input = document.getElementById('search-input');
  dom.btn = document.getElementById('search-btn');
  dom.aiEl = document.getElementById('ai-understand');
  dom.resultsEl = document.getElementById('results');
  dom.loadingEl = document.getElementById('loading');
  dom.emptyEl = document.getElementById('empty');
  dom.altEl = document.getElementById('alternatives');
  dom.loadMoreBtn = document.getElementById('load-more');
  dom.histEl = document.getElementById('search-history');
  dom.histToggle = document.getElementById('history-toggle');
  dom.wishEl = document.getElementById('wishlist-panel');
  dom.wishToggle = document.getElementById('wishlist-toggle');
  dom.tagSelector = document.getElementById('tag-selector');
  dom.tagPanel = document.getElementById('tag-panel');
  dom.tagLabels = dom.tagSelector ? dom.tagSelector.querySelectorAll('.tag-label') : [];
  dom.modeTabs = document.querySelectorAll('.mode-tab');
  dom.themeToggle = document.getElementById('theme-toggle');
  dom.iconSun = document.getElementById('icon-sun');
  dom.iconMoon = document.getElementById('icon-moon');
  dom.stageParse = document.getElementById('stage-parse');
  dom.stageSearch = document.getElementById('stage-search');
  dom.stageSelect = document.getElementById('stage-select');
  dom.toastEl = document.getElementById('toast');
}

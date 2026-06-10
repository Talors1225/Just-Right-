// modules/render.js — Result rendering + card details

import { currentMode, searchMode, allResults, renderedCount, PAGE_SIZE, dom, setRenderedCount } from './state.js';
import { esc, formatNum, getTagClass } from './utils.js';
import { isInWishlist, toggleWishlist, renderWishlist } from './wishlist.js';

var _allResults = allResults;

export function syncResults(arr) { _allResults = arr; }

// ── Game card HTML ──
function renderGameCard(g, idx) {
  var imgHtml = g.header_image ? '<img class="card-img" src="' + esc(g.header_image) + '" alt="' + esc(g.name) + '" onerror="if(!this.dataset.retried){this.dataset.retried=1;this.src=\'/api/proxy-image?url=\'+encodeURIComponent(this.src)}else{var d=document.createElement(\'div\');d.className=\'card-img card-img-placeholder\';d.innerHTML=\'<span>\'+this.alt.charAt(0)+\'</span>\';this.replaceWith(d)}">' : '<div class="card-img card-img-placeholder"><span>' + esc(g.name.charAt(0)) + '</span></div>';
  var priceHtml = g.price ? '<span>' + esc(g.price) + '</span>' : '';
  var ratioClass = g.positive_ratio >= 85 ? 'ratio-high' : g.positive_ratio >= 70 ? 'ratio-mid' : 'ratio-low';
  var ratioHtml = g.positive_ratio > 0 ? '<span class="ratio-badge ' + ratioClass + '">' + g.positive_ratio + '% Positive</span>' : '';

  var score = g.match_score || 70;
  var scoreClass = score >= 85 ? 'high' : score >= 65 ? 'mid' : 'low';
  var scoreBadge = score >= 85 ? 'Top Pick' : score >= 65 ? 'Recommended' : 'Decent';
  var scoreHtml = '<div class="card-score"><span class="score-label">Match</span><div class="score-bar"><div class="score-fill ' + scoreClass + '" style="width:' + score + '%"></div></div><span class="score-num">' + score + '%</span><span class="score-badge ' + scoreClass + '">' + scoreBadge + '</span></div>';

  var matchedKws = (g.matched_keywords || []).map(function(k) { return k.toLowerCase(); });
  var tagsHtml = (g.tags || []).slice(0, 6).map(function(t) {
    var isHit = matchedKws.some(function(k) { return t.toLowerCase().includes(k) || k.includes(t.toLowerCase()); });
    if (isHit) {
      var catCls = getTagClass(t);
      return '<span class="tag-hit ' + catCls + '">' + esc(t) + '</span>';
    }
    return '<span>' + esc(t) + '</span>';
  }).join('');

  var d = g.match_details || {};
  var detailHtml = '<div class="match-breakdown">' +
    '<span class="bd-item">Hits ' + (d.keyword_hits || 0) + '/' + (d.keyword_total || 0) + '</span>' +
    '<span class="bd-item">' + formatNum(d.total_reviews || g.total_reviews || 0) + ' reviews</span>' +
    '</div>';
  var topBadge = idx < 3 ? '<div class="top-badge">TOP ' + (idx + 1) + '</div>' : '';

  var inWish = isInWishlist(g);
  var actionsHtml = '<div class="card-actions">' +
    '<button class="btn-action btn-wishlist' + (inWish ? ' active' : '') + '" data-idx="' + idx + '" title="Want to play">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="' + (inWish ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
    '</button>' +
    '<button class="btn-expand" data-idx="' + idx + '" title="Details">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' +
    '</button>' +
    '</div>';

  return '<div class="game-card-wrap">' +
    '<a class="game-card" href="' + esc(g.steam_url) + '" target="_blank" rel="noopener">' +
    topBadge + imgHtml +
    '<div class="card-body">' +
    '<div class="card-name">' + esc(g.name) + '</div>' +
    scoreHtml +
    '<div class="card-meta">' + ratioHtml + '<span>' + formatNum(g.total_reviews) + ' reviews</span>' + priceHtml + '</div>' +
    '<div class="card-reason">' + esc(g.match_reason) + '</div>' +
    detailHtml +
    '<div class="card-tags">' + tagsHtml + '</div>' +
    '</div></a>' +
    actionsHtml +
    '</div>';
}

// ── Movie card HTML ──
function renderMovieCard(m, idx) {
  var typeLabel = m.type === 'tv' ? 'TV' : 'Movie';
  var ratingHtml = m.rating ? '<span class="badge badge-rating">' + m.rating + '</span>' : '';
  var yearHtml = m.year ? '<span class="badge badge-year">' + m.year + '</span>' : '';
  var meta = [m.country, (m.genres || []).join(' · '), m.seasons ? m.seasons + ' season(s)' : ''].filter(Boolean);
  var tagsHtml = (m.tags || []).slice(0, 6).map(function(t) { return '<span>' + esc(t) + '</span>'; }).join('');
  var platformsHtml = (m.platforms || []).length ? '<span style="color:var(--accent);opacity:.6">' + esc(m.platforms.join(' · ')) + '</span>' : '';
  var imgHtml = m.poster
    ? '<img class="card-poster" src="' + esc(m.poster) + '" alt="' + esc(m.name) + '" onerror="if(!this.dataset.retried){this.dataset.retried=1;this.src=\'/api/proxy-image?url=\'+encodeURIComponent(this.src)}else{var d=document.createElement(\'div\');d.className=\'card-poster card-poster-placeholder\';d.innerHTML=\'<span>\'+this.alt.charAt(0)+\'</span>\';this.replaceWith(d)}">'
    : '<div class="card-poster card-poster-placeholder"><span>' + esc(m.name.charAt(0)) + '</span></div>';

  var score = m.match_score || 0;
  var scoreHtml = '';
  if (score > 0) {
    var scoreClass = score >= 85 ? 'high' : score >= 65 ? 'mid' : 'low';
    var scoreBadge = score >= 85 ? 'Top Pick' : score >= 65 ? 'Recommended' : 'Decent';
    scoreHtml = '<div class="card-score"><span class="score-label">Match</span><div class="score-bar"><div class="score-fill ' + scoreClass + '" style="width:' + score + '%"></div></div><span class="score-num">' + score + '%</span><span class="score-badge ' + scoreClass + '">' + scoreBadge + '</span></div>';
  }

  var inWish = isInWishlist(m);
  var actionsHtml = '<div class="card-actions">' +
    '<button class="btn-action btn-wishlist' + (inWish ? ' active' : '') + '" data-idx="' + idx + '" title="Want to watch">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="' + (inWish ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
    '</button>' +
    '<button class="btn-expand" data-idx="' + idx + '" title="Details">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' +
    '</button>' +
    '</div>';

  return '<div class="game-card-wrap">' +
    '<div class="movie-card">' +
    imgHtml +
    '<div class="card-body">' +
    '<div class="card-top"><div class="card-name">' + esc(m.name) + '</div>' +
    '<div class="card-badges"><span class="badge badge-type">' + typeLabel + '</span>' + yearHtml + ratingHtml + '</div></div>' +
    scoreHtml +
    '<div class="card-meta">' + meta.map(function(x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' +
    (m.match_reason ? '<div class="card-reason">' + esc(m.match_reason) + '</div>' : '') +
    '<div class="card-desc">' + esc(m.desc || '') + '</div>' +
    '<div class="card-tags">' + tagsHtml + platformsHtml + '</div>' +
    '</div></div>' +
    actionsHtml +
    '</div>';
}

// ── Render a page ──
export function renderPage() {
  var batch = _allResults.slice(renderedCount, renderedCount + PAGE_SIZE);
  var html = '';
  var isGame = searchMode === 'game';

  html = batch.map(function(item, i) {
    var idx = renderedCount + i;
    return isGame ? renderGameCard(item, idx) : renderMovieCard(item, idx);
  }).join('');

  dom.resultsEl.insertAdjacentHTML('beforeend', html);
  setRenderedCount(renderedCount + batch.length);

  if (renderedCount < _allResults.length) {
    dom.loadMoreBtn.classList.remove('hidden');
    dom.loadMoreBtn.textContent = 'Load more (' + (_allResults.length - renderedCount) + ')';
  } else {
    dom.loadMoreBtn.classList.add('hidden');
  }
}

// ── Card expand details ──
export function toggleCardDetail(idx, wrapEl) {
  var existing = wrapEl.querySelector('.card-detail');
  var expandBtn = wrapEl.querySelector('.btn-expand');
  if (existing) {
    existing.remove();
    if (expandBtn) expandBtn.classList.remove('active');
    return;
  }
  var g = _allResults[idx];
  if (!g) return;

  var desc = g.short_description || g.desc || '';
  desc = desc.replace(/<[^>]+>/g, '');
  if (desc.length > 300) desc = desc.substring(0, 300) + '…';

  var detailTags = (g.tags || []).map(function(t) { return '<span>' + esc(t) + '</span>'; }).join('');
  var html = '<div class="card-detail">';
  html += '<button class="btn-detail-close" title="Close">✕</button>';
  if (desc) html += '<div class="detail-desc">' + esc(desc) + '</div>';
  if (g.match_reason) html += '<div class="detail-reason"><span class="detail-reason-icon">✦</span> ' + esc(g.match_reason) + '</div>';
  if (detailTags) html += '<div class="detail-row">' + detailTags + '</div>';

  if (searchMode === 'game') {
    var genreRow = (g.genres || []).length ? '<div class="detail-row detail-genres">' + g.genres.map(function(x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' : '';
    html += genreRow;
    var infoItems = [];
    var devs = g.developers || (g.developer ? g.developer.split(';') : []);
    var pubs = g.publishers || (g.publisher ? [g.publisher] : []);
    if (devs.length) infoItems.push('Developer: ' + devs.join(', '));
    if (pubs.length) infoItems.push('Publisher: ' + pubs.join(', '));
    if (g.release_date) infoItems.push('Release: ' + g.release_date);
    if (g.price) infoItems.push('Price: ' + g.price);
    if (g.platforms && g.platforms.length) infoItems.push('Platforms: ' + g.platforms.join(' / '));
    if (infoItems.length) html += '<div class="detail-info">' + infoItems.map(function(x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>';
    html += '<div class="detail-actions">';
    html += '<a class="btn-detail-action primary" href="' + esc(g.steam_url) + '" target="_blank" rel="noopener">View on Steam</a>';
    html += '</div>';
  } else {
    var genreRow = (g.genres || []).length ? '<div class="detail-row detail-genres">' + g.genres.map(function(x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' : '';
    html += genreRow;
    var infoItems = [];
    if (g.country) infoItems.push('Region: ' + g.country);
    if (g.year) infoItems.push('Year: ' + g.year);
    if (g.seasons) infoItems.push('Seasons: ' + g.seasons);
    if (g.platforms && g.platforms.length) infoItems.push('Platforms: ' + g.platforms.join(' / '));
    if (infoItems.length) html += '<div class="detail-info">' + infoItems.map(function(x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>';
    var searchUrl = 'https://www.imdb.com/find?q=' + encodeURIComponent(g.name);
    html += '<div class="detail-actions">';
    html += '<a class="btn-detail-action primary" href="' + searchUrl + '" target="_blank" rel="noopener">Search on IMDB</a>';
    html += '</div>';
  }

  html += '</div>';
  wrapEl.insertAdjacentHTML('beforeend', html);
  if (expandBtn) expandBtn.classList.add('active');
}

// ── Card action events ──
export function initCardActions() {
  dom.resultsEl.addEventListener('click', function(e) {
    // Close button
    var closeBtn = e.target.closest('.btn-detail-close');
    if (closeBtn) {
      e.preventDefault();
      e.stopPropagation();
      var detail = closeBtn.closest('.card-detail');
      var wrap = closeBtn.closest('.game-card-wrap');
      if (detail) detail.remove();
      if (wrap) {
        var expandBtn = wrap.querySelector('.btn-expand');
        if (expandBtn) expandBtn.classList.remove('active');
      }
      return;
    }

    var btn = e.target.closest('.btn-action') || e.target.closest('.btn-expand');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    var idx = parseInt(btn.dataset.idx);
    var game = _allResults[idx];
    if (!game) return;

    if (btn.classList.contains('btn-wishlist')) {
      var added = toggleWishlist(game);
      btn.classList.toggle('active', added);
      var svg = btn.querySelector('svg');
      if (svg) svg.setAttribute('fill', added ? 'currentColor' : 'none');
      renderWishlist();
      return;
    }

    if (btn.classList.contains('btn-expand')) {
      var wrap = btn.closest('.game-card-wrap');
      if (wrap) toggleCardDetail(idx, wrap);
      return;
    }
  });
}

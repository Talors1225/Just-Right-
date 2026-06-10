// modules/tags.js — Tag selector

import { currentMode, dom } from './state.js';
import { esc } from './utils.js';

export var selectedTags = [];

export var TAG_GROUPS_GAME = [
  { name: 'Genre', tags: ['Story-driven','Exploration','Action-packed','Strategy','Simulation','Survival','Puzzle','Co-op','Collection','Sandbox'] },
  { name: 'Mood', tags: ['Relaxing','Thrilling','Challenging','Immersive','Stress relief','Brain teaser','Addictive','Emotional','Achievement','Social'] },
  { name: 'Scene', tags: ['Quick break','Before bed','Short sessions','Weekend dive','Long-term','Solo play','With partner','With friends','Background play','Competitive'] }
];

export var TAG_GROUPS_MOVIE = [
  { name: 'Genre', tags: ['Action','Mystery','Comedy','Romance','Sci-fi','Fantasy','Crime','Animation','Documentary','Historical'] },
  { name: 'Mood', tags: ['Relaxing','Thought-provoking','Exciting','Heartwarming','Emotional','Thrilling','Hilarious','Educational','Philosophical','Cathartic'] },
  { name: 'Scene', tags: ['With meals','Late night','Weekend binge','With friends','Date night','Family time','Commute','Under 1 hour','Currently airing','Marathon'] }
];

export function getTagGroups() { return currentMode === 'game' ? TAG_GROUPS_GAME : TAG_GROUPS_MOVIE; }

var _activeGroup = -1;

export function renderTagLabels() {
  var groups = getTagGroups();
  dom.tagLabels.forEach(function(label, i) {
    if (!groups[i]) return;
    var textEl = label.querySelector('.tag-label-text');
    var countEl = label.querySelector('.tag-label-count');
    if (textEl) textEl.textContent = groups[i].name;
    var count = selectedTags.filter(function(t) {
      return groups[i].tags.indexOf(t) >= 0;
    }).length;
    if (countEl) countEl.textContent = count > 0 ? count : '';
    label.classList.toggle('has-selected', count > 0);
  });
}

export function renderTagPanel(groupIdx) {
  var group = getTagGroups()[groupIdx];
  dom.tagPanel.setAttribute('data-group', groupIdx);
  dom.tagPanel.innerHTML = group.tags.map(function(t) {
    var sel = selectedTags.indexOf(t) >= 0 ? ' selected' : '';
    return '<span class="tag-item' + sel + '" data-tag="' + esc(t) + '">' + esc(t) + '</span>';
  }).join('');
}

export function clearSelectedTags() {
  selectedTags = [];
  dom.tagSelector.querySelectorAll('.tag-item.selected').forEach(function(t) { t.classList.remove('selected'); });
  _activeGroup = -1;
  dom.tagPanel.classList.add('hidden');
  dom.tagLabels.forEach(function(l) { l.classList.remove('active'); });
  renderTagLabels();
}

export function initTags(inputEl) {
  dom.tagSelector.addEventListener('click', function(e) {
    var label = e.target.closest('.tag-label');
    if (label) {
      var groupIdx = parseInt(label.dataset.group);
      if (_activeGroup === groupIdx) {
        _activeGroup = -1;
        dom.tagPanel.classList.add('hidden');
        dom.tagLabels.forEach(function(l) { l.classList.remove('active'); });
      } else {
        _activeGroup = groupIdx;
        dom.tagLabels.forEach(function(l) { l.classList.remove('active'); });
        label.classList.add('active');
        renderTagPanel(groupIdx);
        dom.tagPanel.classList.remove('hidden');
      }
      return;
    }

    var tag = e.target.closest('.tag-item');
    if (!tag) return;
    var tagName = tag.dataset.tag;
    var idx = selectedTags.indexOf(tagName);
    if (idx >= 0) {
      selectedTags.splice(idx, 1);
      tag.classList.remove('selected');
    } else {
      selectedTags.push(tagName);
      tag.classList.add('selected');
    }
    renderTagLabels();
    if (selectedTags.length > 0) {
      var suffix = currentMode === 'game' ? ' games' : ' movies';
      inputEl.value = selectedTags.join(', ') + suffix;
    }
  });

  document.addEventListener('click', function(e) {
    if (_activeGroup >= 0 && !dom.tagSelector.contains(e.target)) {
      _activeGroup = -1;
      dom.tagPanel.classList.add('hidden');
      dom.tagLabels.forEach(function(l) { l.classList.remove('active'); });
    }
  });
}

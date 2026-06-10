// modules/tags.js — 标签选择器

import { currentMode, dom } from './state.js';
import { esc } from './utils.js';

export var selectedTags = [];

export var TAG_GROUPS_GAME = [
  { name: '玩什么类型', tags: ['剧情沉浸','探索冒险','战斗爽玩','动脑策略','模拟经营','生存挑战','解谜推理','联机开黑','收集养成','创意沙盒'] },
  { name: '要什么感觉', tags: ['放松一下','爽一把','挑战自己','沉浸世界','发泄压力','烧烧脑子','上头停不下','感受故事','找点成就感','和朋友乐'] },
  { name: '在什么场景', tags: ['摸鱼神器','睡前玩会','碎片时间','周末开坑','长期养成','一个人玩','和对象玩','和朋友开黑','边听歌边玩','电竞上分'] }
];

export var TAG_GROUPS_MOVIE = [
  { name: '看什么类型', tags: ['动作刺激','悬疑推理','欢乐搞笑','爱情情感','科幻脑洞','奇幻冒险','犯罪故事','动画佳作','真实纪录','历史传奇'] },
  { name: '要什么感觉', tags: ['放松一下','烧烧脑子','热血一点','想被治愈','感动一下','看点刺激','开怀大笑','长点见识','思考人生','哭一场'] },
  { name: '在什么场景', tags: ['下饭必备','深夜独享','周末补片','和朋友看','约会必看','全家一起','通勤路上','一小时内','追更中','一口气刷完'] }
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
      var suffix = currentMode === 'game' ? '的游戏' : '的影视';
      inputEl.value = selectedTags.join('、') + suffix;
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

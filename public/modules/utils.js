// modules/utils.js — 工具函数

var _toastTimer = null;

export function showToast(msg, duration) {
  duration = duration || 2000;
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() { el.classList.remove('show'); }, duration);
}

export function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

export function formatNum(n) {
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n;
}

export function hexToRgba(hex, alpha) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  if (!text) return 0;
  var chars = text.split('');
  var line = '';
  var lines = 0;
  for (var i = 0; i < chars.length; i++) {
    var testLine = line + chars[i];
    if (ctx.measureText(testLine).width > maxWidth && line.length > 0) {
      lines++;
      if (lines >= maxLines) {
        var trunc = line;
        while (trunc.length > 0 && ctx.measureText(trunc + '…').width > maxWidth) {
          trunc = trunc.substring(0, trunc.length - 1);
        }
        ctx.fillText(trunc + '…', x, y);
        return lines;
      }
      ctx.fillText(line, x, y);
      line = chars[i];
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) { ctx.fillText(line, x, y); lines++; }
  return lines;
}

// ── 标签分类 → 颜色映射 ──
export var TAG_CATEGORIES = {
  type: { tags: ['RPG剧情向','开放世界','像素独立','策略烧脑','动作爽游','模拟经营','恐怖悬疑','休闲治愈','电影','剧集','动画','纪录片','综艺','短片'], cls: 'tag-type' },
  mood: { tags: ['想放松','想动脑','想爽一把','想看剧情','想消磨时间','想和朋友玩','想挑战自我','想探索世界','想烧脑','想哭一场','想笑出声','想思考人生','想找刺激','想治愈','想怀旧'], cls: 'tag-mood' },
  feature: { tags: ['剧情神作','操作简单','耐玩百小时','联机欢乐','画面精美','音乐好听','自由度高','短小精悍','高分经典','冷门宝藏','反转神作','节奏紧凑','演技炸裂','配乐好听'], cls: 'tag-feature' },
  scene: { tags: ['下班放松','10分钟一局','冷门宝藏','下雨天看','深夜独享','和朋友一起','适合周末','下饭必备','1小时搞定'], cls: 'tag-scene' }
};

export function getTagClass(tag) {
  var lower = tag.toLowerCase();
  for (var cat in TAG_CATEGORIES) {
    for (var i = 0; i < TAG_CATEGORIES[cat].tags.length; i++) {
      var t = TAG_CATEGORIES[cat].tags[i].toLowerCase();
      if (lower.includes(t) || t.includes(lower)) return TAG_CATEGORIES[cat].cls;
    }
  }
  return '';
}

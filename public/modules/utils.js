// modules/utils.js — Utility functions

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
        while (trunc.length > 0 && ctx.measureText(trunc + '...').width > maxWidth) {
          trunc = trunc.substring(0, trunc.length - 1);
        }
        ctx.fillText(trunc + '...', x, y);
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

// Tag category -> color mapping
export var TAG_CATEGORIES = {
  type: { tags: ['Story-driven','RPG','Open World','Pixel Art','Strategy','Action','Simulation','Horror','Casual','Movie','TV','Animation','Documentary','Variety','Short Film'], cls: 'tag-type' },
  mood: { tags: ['Relaxing','Brain teaser','Thrilling','Emotional','Chilling','Social','Challenging','Exploration','Mind-bending','Cathartic','Hilarious','Philosophical','Adrenaline','Healing','Nostalgic'], cls: 'tag-mood' },
  feature: { tags: ['Masterpiece story','Easy to pick up','100h+ content','Co-op fun','Beautiful visuals','Great soundtrack','High freedom','Short & sweet','Top rated','Hidden gem','Plot twist','Fast paced','Great acting','Amazing OST'], cls: 'tag-feature' },
  scene: { tags: ['After work','One round','Rainy day','Late night','With friends','Weekend pick','Quick meal','One hour finish'], cls: 'tag-scene' }
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

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import initSqlJs from 'sql.js';

// ── 工具函数 ──

function sanitizeInput(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\b(ignore|forget|disregard)\s+(all|previous|above)\s+(instructions?|prompts?|rules?)\b/gi, '[filtered]')
    .replace(/\b(you\s+are\s+now|act\s+as|pretend\s+to\s+be|new\s+instructions?)\b/gi, '[filtered]')
    .replace(/\b(system\s*prompt|reveal\s+your\s+instructions?)\b/gi, '[filtered]')
    .replace(/忽略(之前|以上|所有)(的)?(指令|提示|规则|要求)/g, '[filtered]')
    .replace(/(忘掉|不要管|抛弃)(之前|以上|所有)(的)?(指令|提示|规则|要求)/g, '[filtered]')
    .replace(/(你现在|假装|扮演|你是).{0,20}(助手|AI|模型|系统)/g, '[filtered]')
    .replace(/(新|新的)(指令|提示词|规则|要求)/g, '[filtered]')
    .replace(/(显示|输出|打印|告诉我)(你的|系统)(指令|提示词|规则|prompt)/g, '[filtered]')
    .trim();
}

function extractJSON(raw, type = 'object') {
  if (!raw || typeof raw !== 'string') return null;
  try { const r = JSON.parse(raw); if (type === 'array' ? Array.isArray(r) : typeof r === 'object') return r; } catch {}
  const open = type === 'array' ? '[' : '{';
  const close = type === 'array' ? ']' : '}';
  const candidates = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== open) continue;
    let depth = 0;
    for (let j = i; j < raw.length; j++) {
      if (raw[j] === open) depth++;
      else if (raw[j] === close) depth--;
      if (depth === 0) { candidates.push(raw.slice(i, j + 1)); break; }
    }
  }
  candidates.sort((a, b) => b.length - a.length);
  for (const c of candidates) { try { return JSON.parse(c); } catch {} }
  return null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 加载 .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  });
}

const app = express();
const PORT = process.env.PORT || 13000;
const LLM_BASE_URL = (process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';

app.use(express.json({ limit: '2mb', type: 'application/json' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── 搜索配置常量 ──
const SEARCH = {
  CANDIDATE_LIMIT: 80,          // 搜索候选上限
  BOOST_LIMIT: 200,             // 地区 boost 模式候选上限
  SQL_LIMIT: 1000,              // SQL 查询上限
  LLM_SELECT_TOP: 15,           // 送入 LLM 精选的候选数
  LLM_RESULT_COUNT: '8-12',     // LLM 精选返回数量描述
  MIN_REVIEWS: 100,             // 游戏最低评论数（动态门槛基础值）
  GAME_MIN_RATIO: 55,           // 游戏好评率底线
  GAME_MIN_RATIO_NICHE: 45,     // 冷门游戏好评率底线
  MOVIE_MIN_RATING: 6.0,        // 影视评分底线
  MOVIE_MIN_RATING_NICHE: 5.0,  // 冷门影视评分底线
  AND_MIN_RESULTS: 5,           // AND 逻辑最低结果数
};

// ── 反馈权重构建 + 应用 ──
function buildFeedbackMaps(items, nameKey = 'name') {
  const likedTags = new Map();
  const dislikedTags = new Map();
  const dislikedNames = new Set();
  for (const item of (items.liked || [])) {
    for (const t of (item.tags || [])) likedTags.set(t.toLowerCase(), (likedTags.get(t.toLowerCase()) || 0) + 1);
  }
  for (const item of (items.disliked || [])) {
    dislikedNames.add(item[nameKey]?.toLowerCase());
    for (const t of (item.tags || [])) dislikedTags.set(t.toLowerCase(), (dislikedTags.get(t.toLowerCase()) || 0) + 1);
  }
  return { likedTags, dislikedTags, dislikedNames };
}

function applyFeedback(item, { likedTags, dislikedTags, dislikedNames }, minQuality, ratingField = 'positive_ratio') {
  const tags = (item.tags || []).map(t => t.toLowerCase());
  if (dislikedNames.has(item.name?.toLowerCase())) return null;
  if ((item[ratingField] || 0) < minQuality) return null;
  let bonus = 0;
  bonus += tags.filter(t => likedTags.has(t)).length * 1.5;
  const overlap = tags.filter(t => dislikedTags.has(t)).length;
  if (overlap >= 3) return null;
  bonus -= overlap * 1.0;
  item._score += bonus;
  return item;
}

// ── 中文同义词映射（数据库已有中英双语标签） ──
const TAG_SYNONYMS = {
  '挂机': ['挂机', '放置', 'idle', 'clicker', 'incremental'],
  '像素': ['像素', 'pixel art', 'pixel graphics', 'retro', '复古'],
  '开放世界': ['开放世界', 'open world', '沙盒', 'sandbox'],
  '生存': ['生存', 'survival', '生存恐怖', 'survival horror'],
  '肉鸽': ['肉鸽', 'roguelike', 'roguelite', '肉鸽lite'],
  '合作': ['合作', 'co-op', 'cooperative', '在线合作', 'online co-op'],
  '回合制': ['回合制', 'turn-based', '回合制策略'],
  '恐怖': ['恐怖', 'horror', '生存恐怖', 'survival horror'],
  '射击': ['射击', 'shooter', 'fps', '第一人称射击'],
  '角色扮演': ['角色扮演', 'rpg', 'action rpg', '动作rpg', 'jrpg'],
  '策略': ['策略', 'strategy', '即时战略', '战术'],
  '解谜': ['解谜', 'puzzle'],
  '竞速': ['竞速', 'racing', '赛车'],
  '模拟': ['模拟', 'simulation', '模拟器'],
  '建造': ['建造', 'building', 'base building', '基地建造', '城市建设'],
  '经营': ['经营', 'management'],
  '卡牌': ['卡牌', 'card game', '构筑牌组', 'deckbuilder'],
  '剧情': ['剧情', '剧情丰富', 'story rich', 'narrative', '叙事'],
  '平台': ['平台', '平台跳跃', 'platformer'],
  '动作': ['动作', 'action', '砍杀', 'hack and slash'],
  '冒险': ['冒险', 'adventure', '动作冒险'],
  '单人': ['单人', 'single player', 'singleplayer'],
  '多人': ['多人', 'multiplayer', '在线多人', '本地多人'],
  '潜行': ['潜行', 'stealth'],
  '塔防': ['塔防', 'tower defense'],
  '动漫': ['动漫', 'anime', '日系'],
  '科幻': ['科幻', 'sci-fi', 'science fiction'],
  '奇幻': ['奇幻', 'fantasy'],
  '末日': ['末日', 'post-apocalyptic'],
  '僵尸': ['僵尸', 'zombies'],
  '战争': ['战争', 'war', 'warfare', '军事'],
  '中世纪': ['中世纪', 'medieval'],
  '赛博朋克': ['赛博朋克', 'cyberpunk'],
  '氛围': ['氛围', 'atmospheric'],
  '探索': ['探索', 'exploration'],
  '放松': ['放松', 'relaxing', '治愈'],
  '高难度': ['高难度', 'difficult', 'souls-like', '魂类'],
  '黑暗': ['黑暗', 'dark'],
  '可爱': ['可爱', 'cute'],
  '搞笑': ['搞笑', 'funny', 'comedy', '喜剧'],
  '喜剧': ['喜剧', 'comedy', '搞笑', 'funny'],
  '暴力': ['暴力', 'violent', '血腥', 'gore'],
  '体育': ['体育', 'sports'],
  '音乐': ['音乐', 'music', '节奏'],
  '视觉小说': ['视觉小说', 'visual novel'],
  '大逃杀': ['大逃杀', 'battle royale'],
  '聚会': ['聚会', 'party'],
  '太空': ['太空', 'space'],
  '休闲': ['休闲', 'casual'],
  '独立': ['独立', 'indie'],
  '免费': ['免费', 'free to play'],
  '复古': ['复古', 'retro', '经典', 'classic'],
  '第一人称': ['第一人称', 'first-person'],
  '第三人称': ['第三人称', 'third person'],
  '制作': ['制作', 'crafting'],
  '女性主角': ['女性主角', '女主角', 'female protagonist'],
  '像素风': ['像素', 'pixel art', 'pixel graphics', 'retro'],
  '挂机游戏': ['挂机', '放置', 'idle'],
  'roguelike': ['肉鸽', 'roguelike', 'roguelite'],
  'fps': ['射击', 'fps', 'shooter', '第一人称射击'],
  'rpg': ['角色扮演', 'rpg'],
  'mmo': ['大型多人在线', 'mmo', 'mmorpg'],
  // 国家/地区映射
  '国产': ['China', 'CN', '中国', 'Chinese', 'Mainland China'],
  '中国': ['China', 'CN', '中国', 'Chinese', 'Mainland China'],
  '华语': ['China', 'CN', '中国', 'Hong Kong', 'Taiwan', 'Chinese'],
  '港片': ['Hong Kong', 'HK', '香港'],
  '港剧': ['Hong Kong', 'HK', '香港'],
  '香港': ['Hong Kong', 'HK', '香港'],
  '台湾': ['Taiwan', 'TW', '台湾'],
  '台剧': ['Taiwan', 'TW', '台湾'],
  '日本': ['Japan', 'JP', '日本', 'Japanese'],
  '日剧': ['Japan', 'JP', '日本', 'Japanese'],
  '日漫': ['Japan', 'JP', '日本', 'Japanese', 'anime'],
  '韩国': ['South Korea', 'KR', '韩国', 'Korean'],
  '韩剧': ['South Korea', 'KR', '韩国', 'Korean'],
  '美国': ['United States of America', 'US', 'USA', '美国'],
  '美剧': ['United States of America', 'US', 'USA'],
  '英国': ['United Kingdom', 'GB', 'UK', '英国', 'British'],
  '英剧': ['United Kingdom', 'GB', 'UK', 'British'],
  '法国': ['France', 'FR', '法国', 'French'],
  '印度': ['India', 'IN', '印度', 'Indian'],
  '泰国': ['Thailand', 'TH', '泰国', 'Thai'],
  '欧洲': ['France', 'Germany', 'Italy', 'Spain', 'United Kingdom', 'Sweden', 'Denmark', 'Norway'],
};

// 心情标签 → 硬排除规则（SQL 层直接过滤，比让 AI 猜靠谱）
const TAG_EXCLUDES = {
  '想放松': ['souls', 'soulslike', 'dark souls', '高难度', 'roguelike', '肉鸽', 'PVP', '竞技', '大逃杀', '魂'],
  '想动脑': ['idle', '放置', '挂机', 'clicker'],
  '想爽一把': ['回合制', 'turn-based', '策略', '文字冒险', 'visual novel'],
  '想看剧情': ['大逃杀', 'battle royale'],
  '想消磨时间': [],
  '想和朋友玩': ['单人', 'singleplayer', 'visual novel', '文字冒险'],
  '想挑战自我': ['idle', '放置', '挂机', 'casual', '休闲', 'clicker', 'easy'],
  '想探索世界': ['线性', 'linear', '竞技', 'PVP'],
  '想赢一把': ['souls', 'soulslike', '高难度', 'roguelike', '肉鸽'],
  '想发泄': ['回合制', 'turn-based', '策略', '文字冒险', 'visual novel', '休闲', 'casual'],
  '睡前玩': ['恐怖', 'horror', 'gore', '血腥', '暴力', 'violent', '惊悚', 'thriller', 'action', '动作'],
  '想放松看': ['恐怖', 'horror', '惊悚', 'thriller', '犯罪', '悬疑', '血腥', '暴力'],
  '想烧脑': ['儿童', 'kids', '动画片'],
  '想哭一场': ['恐怖', 'horror', '喜剧', 'comedy'],
  '想笑出声': ['恐怖', 'horror', '悲剧', '犯罪'],
  '想找刺激': ['儿童', 'kids', '剧情'],
  '想治愈': ['恐怖', 'horror', '犯罪', '血腥', '暴力', '惊悚'],
  '想怀旧': [],
  '想思考人生': ['儿童', 'kids', '搞笑'],
};

// 标签扩展
function expandTags(tags) {
  const expanded = new Set();
  for (const tag of tags) {
    const t = tag.trim();
    if (!t) continue;
    expanded.add(t);
    const lower = t.toLowerCase();
    // 精确匹配
    if (TAG_SYNONYMS[lower]) {
      TAG_SYNONYMS[lower].forEach(s => expanded.add(s));
      continue;
    }
    // 中文模糊匹配
    for (const [key, synonyms] of Object.entries(TAG_SYNONYMS)) {
      if (key.includes(lower) || lower.includes(key)) {
        synonyms.forEach(s => expanded.add(s));
        break;
      }
    }
  }
  return [...expanded];
}

// ── Rate Limiter ──
const rateMap = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60 * 1000;
const RATE_MAX_ENTRIES = 10000;

function checkRateLimit(req) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (entry && now - entry.start <= RATE_WINDOW && entry.count > RATE_LIMIT) {
    return false;
  }
  if (!entry || now - entry.start > RATE_WINDOW) {
    if (rateMap.size >= RATE_MAX_ENTRIES) {
      rateMap.delete(rateMap.keys().next().value);
    }
    rateMap.set(ip, { start: now, count: 1 });
  } else {
    entry.count++;
  }
  return true;
}

function rateLimiter(req, res, next) {
  if (!checkRateLimit(req)) return res.status(429).json({ error: '请求太频繁，请稍后再试' });
  next();
}

// ── LLM 调用（兼容所有 OpenAI 格式 API）──

async function callLLM(messages, maxTokens = 1000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await fetch(LLM_BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LLM_API_KEY },
      body: JSON.stringify({ model: LLM_MODEL, messages, max_tokens: maxTokens, temperature: 0.5 }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      throw new Error('LLM API error: ' + resp.status);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('LLM API timeout');
    throw e;
  }
}

// ── 搜索缓存（LRU 200 条 + TTL 10 分钟）──
const searchCache = new Map();
const CACHE_MAX = 200;
const CACHE_TTL = 10 * 60 * 1000;

function getCached(key) {
  if (!searchCache.has(key)) return null;
  const entry = searchCache.get(key);
  if (Date.now() - entry.ts > CACHE_TTL) { searchCache.delete(key); return null; }
  searchCache.delete(key);
  searchCache.set(key, entry);
  return entry.data;
}

function setCache(key, val) {
  if (searchCache.size >= CACHE_MAX) { searchCache.delete(searchCache.keys().next().value); }
  searchCache.set(key, { data: val, ts: Date.now() });
}

// ══════════════════════════════════════════
//  SQLite 数据库
// ══════════════════════════════════════════

let db = null;

async function initDatabase() {
  const dbPath = path.join(__dirname, 'data/games.db');
  if (!fs.existsSync(dbPath)) {
    console.error('[db] 未找到 games.db');
    return;
  }
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(dbPath);
  db = new SQL.Database(buffer);
  console.log('[db] SQLite 数据库已加载');

  // 检查数量
  const gameCount = db.exec('SELECT COUNT(*) FROM games')[0]?.values[0]?.[0] || 0;
  const movieCount = db.exec('SELECT COUNT(*) FROM movies')[0]?.values[0]?.[0] || 0;
  console.log(`[db] 游戏: ${gameCount} 款 | 影视: ${movieCount} 部`);
}

// ══════════════════════════════════════════
//  游戏部分
// ══════════════════════════════════════════

function rowToGame(row) {
  return {
    appid: row[0],
    name: row[1],
    header_image: row[2],
    short_description: row[3],
    tags: JSON.parse(row[4] || '[]'),
    genres: JSON.parse(row[5] || '[]'),
    platforms: JSON.parse(row[6] || '[]'),
    release_date: row[7],
    rating: row[8],
    total_reviews: row[9],
    positive_ratio: row[10],
    has_chinese: row[11] === 1,
    metacritic: row[12],
    source: row[13]
  };
}

// ── 年份提取（兼容 ISO 和中文日期格式）──
function extractYear(dateStr) {
  if (!dateStr) return 2020;
  const m = dateStr.match(/(\d{4})/);
  return m ? parseInt(m[1]) : 2020;
}

// ── 提取主制片国（第一个国家）──
function getPrimaryCountry(country) {
  if (!country) return '';
  return country.split('/')[0].trim().toLowerCase();
}

// ── 关键词匹配计数（用于 AND 逻辑过滤）──
function countKeywordMatches(item, keywords) {
  const tags = (item.tags || []).map(t => t.toLowerCase());
  const name = (item.name || '').toLowerCase();
  const desc = (item.short_description || item.desc || '').toLowerCase();
  const genres = (item.genres || []).map(t => t.toLowerCase());
  const country = (item.country || '').toLowerCase();

  let count = 0;
  for (const kw of keywords) {
    if (tags.some(t => t.includes(kw) || kw.includes(t))) { count++; continue; }
    if (genres.some(t => t.includes(kw) || kw.includes(t))) { count++; continue; }
    if (name.includes(kw)) { count++; continue; }
    if (desc.includes(kw)) { count++; continue; }
    if (country.includes(kw)) { count++; continue; }
  }
  return count;
}

// AND 逻辑渐进放松过滤：优先全匹配，不够则逐步降低要求
function filterByStrictKeywords(scored, strictKws, minResults = 5) {
  if (!strictKws.length || !scored.length) return { results: scored, relaxed: false };
  for (let req = strictKws.length; req >= 1; req--) {
    const filtered = scored.filter(item => countKeywordMatches(item, strictKws) >= req);
    if (filtered.length >= minResults) {
      return { results: filtered, relaxed: req < strictKws.length };
    }
  }
  return { results: scored, relaxed: true };
}

// ── 多字段模糊搜索 + 评分 ──
function searchGamesMultiField(keywords, excludeTags, limit = 50, mustHaveTags = []) {
  if (!db || !keywords.length) return [];
  const excludes = (excludeTags || []).map(t => t.toLowerCase());
  const kws = keywords.map(k => k.toLowerCase().trim()).filter(Boolean);
  if (!kws.length) return [];
  const mustSet = new Set((mustHaveTags || []).map(t => t.toLowerCase()));

  // 用所有关键词匹配 tags/name/short_description/genres，收集候选
  const conditions = kws.map(() => "(tags LIKE ? OR name LIKE ? OR short_description LIKE ? OR genres LIKE ?)").join(' OR ');
  const params = [];
  for (const w of kws) {
    const like = '%' + w + '%';
    params.push(like, like, like, like);
  }
  const sql = `SELECT * FROM games WHERE (${conditions}) AND total_reviews >= ${SEARCH.MIN_REVIEWS} LIMIT ${SEARCH.SQL_LIMIT}`;
  const result = db.exec(sql, params);
  if (!result.length) return [];

  const candidates = result[0].values.map(rowToGame);

  // 评分
  const scored = candidates.map(g => {
    const tags = (g.tags || []).map(t => t.toLowerCase());
    const name = (g.name || '').toLowerCase();
    const desc = (g.short_description || '').toLowerCase();
    const genres = (g.genres || []).map(t => t.toLowerCase());

    // 排除检查
    for (const ex of excludes) {
      if (tags.some(t => t.includes(ex) || ex.includes(t))) return null;
    }

    let score = 0;
    const matchedKws = [];

    for (const kw of kws) {
      let kwMatched = false;
      // 核心标签权重 ×3，普通标签 ×1
      const kwWeight = mustSet.has(kw) ? 3 : 1;
      // 标签命中 +3（精确匹配优先，子串匹配降权）
      if (tags.some(t => t === kw)) { score += 3 * kwWeight; kwMatched = true; }
      else if (tags.some(t => t.includes(kw) || kw.includes(t))) { score += 2 * kwWeight; kwMatched = true; }
      // 类型命中 +2
      if (genres.some(t => t.includes(kw) || kw.includes(t))) { score += 2 * kwWeight; kwMatched = true; }
      // 名称命中 +2
      if (name.includes(kw)) { score += 2 * kwWeight; kwMatched = true; }
      // 简介命中 +1
      if (desc.includes(kw)) { score += 1 * kwWeight; kwMatched = true; }
      if (kwMatched) matchedKws.push(kw);
    }

    if (score === 0) return null;

    // 标签特异性惩罚：标签越多的游戏，单个标签匹配的权重越低（TF-IDF 思路）
    // 下限 0.50 防止惩罚过重导致零结果
    const tagCount = tags.length;
    const specificityPenalty = Math.max(0.50, 1 / Math.sqrt(Math.max(tagCount, 1)));
    score = score * specificityPenalty;

    // 质量系数（乘法，0.65~1.0）
    const ratio = g.positive_ratio || 0;
    const reviews = g.total_reviews || 0;
    const reviewScore = 1 / (1 + Math.exp(4 - reviews / 250)); // 50→0.10, 500→0.50, 2000→0.82, 10000→0.98
    const qualityBase = Math.min(1.0, 0.65 + 0.35 * (ratio / 100) + 0.20 * reviewScore);
    // 动态评价门槛：年份越远要求越多
    const year = extractYear(g.release_date);
    const age = Math.max(0, new Date().getFullYear() - year);
    const minReviews = 100 + age * (70 + 10 * age);
    if (reviews < minReviews) return null;
    score = score * qualityBase;

    return { ...g, _score: score, _matchedKws: matchedKws };
  }).filter(Boolean).sort((a, b) => b._score - a._score);

  return scored.slice(0, limit);
}

function searchGamesByName(name, limit = 10) {
  if (!db || !name) return [];
  const sql = `SELECT * FROM games WHERE name LIKE ? ORDER BY total_reviews DESC LIMIT ?`;
  const result = db.exec(sql, ['%' + name + '%', limit]);
  if (!result.length) return [];
  return result[0].values.map(rowToGame);
}

// ── 图片代理（避免 canvas 跨域污染）──
app.get('/api/proxy-image', rateLimiter, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  // 只允许代理 Steam 和 TMDB 图片
  const allowed = ['steamstatic.com', 'steamcdn-a.akamaihd.net', 'image.tmdb.org', 'media.rawg.io', 'images.igdb.com'];
  try {
    const u = new URL(url);
    const host = u.hostname;
    const allowed_ = allowed.some(h => host === h || host.endsWith('.' + h));
    if (!allowed_) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return res.status(resp.status).json({ error: 'Fetch failed' });
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const contentLength = parseInt(resp.headers.get('content-length') || '0', 10);
    if (contentLength > 10 * 1024 * 1024) return res.status(413).json({ error: 'Image too large' });
    const buffer = await resp.arrayBuffer();
    if (buffer.byteLength > 10 * 1024 * 1024) return res.status(413).json({ error: 'Image too large' });
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Fetch timeout' });
    console.error('[proxy-image] error:', e.message);
    res.status(500).json({ error: 'Proxy failed' });
  }
});

app.get('/api/game/catalog-status', (req, res) => {
  if (!db) return res.json({ loaded: 0 });
  const count = db.exec('SELECT COUNT(*) FROM games')[0]?.values[0]?.[0] || 0;
  res.json({ loaded: count });
});

app.post('/api/game/search', async (req, res) => {
  try {
    const { query: rawQuery, selected_tags, liked_games, disliked_games } = req.body;
    if (!rawQuery?.trim()) return res.status(400).json({ error: '请输入描述' });
    if (rawQuery.length > 2000) return res.status(400).json({ error: '描述过长，请精简' });
    const query = sanitizeInput(rawQuery);

    // 缓存 key 不含反馈（反馈会变化）
    const cacheKey = 'g:' + query.trim().toLowerCase() + '|' + (selected_tags || []).sort().join(',');
    const cached = getCached(cacheKey);
    if (cached && !liked_games?.length && !disliked_games?.length) return res.json(cached);

    // 缓存未命中时才限流
    if (!checkRateLimit(req)) return res.status(429).json({ error: '请求太频繁，请稍后再试' });

    const tagContext = (selected_tags && selected_tags.length > 0) ? '用户选择的标签：' + selected_tags.join('、') : '';

    // 构建反馈上下文
    let feedbackContext = '';
    if (liked_games?.length > 0) {
      const likedDesc = liked_games.slice(0, 5).map(g => g.name + '(' + (g.tags || []).join('/') + ')').join('、');
      feedbackContext += '\n用户喜欢的游戏：' + likedDesc + '。推荐类似风格的游戏。';
    }
    if (disliked_games?.length > 0) {
      const dislikedNames = disliked_games.slice(0, 8).map(g => g.name).join('、');
      feedbackContext += '\n用户不感兴趣的游戏：' + dislikedNames + '。避免推荐这些和类似的游戏。';
    }

    // 1. 意图解析 + 初步搜索并行
    const parsePrompt = [{
      role: 'system',
      content: `你是游戏搜索意图分析助手。分析用户描述，提取搜索意图。

输出严格JSON：
{
  "must_have": ["核心标签1", "核心标签2"],
  "nice_to_have": ["加分标签1", "加分标签2"],
  "search_tags": ["搜索标签1", "搜索标签2"],
  "exclude": ["排除标签1"],
  "summary": "一句话概括用户需求"
}

规则：
- must_have：用户明确要求的核心特性（1-3个），用中文标签
- nice_to_have：用户提到但非必须的特性（0-3个），用中文标签
- search_tags：用于数据库搜索的标签（包含 must_have + nice_to_have + 相关扩展，共 4-8 个），用中文标签
- exclude：用户明确不要的特性（0-2个），用中文标签
- 标签优先用中文，数据库已包含中英双语标签

用户: "好玩的独立游戏 剧情好"
→ must_have:["独立"], nice_to_have:["剧情丰富"], search_tags:["独立","剧情丰富","叙事","冒险","单人"]

用户: "多人合作射击游戏"
→ must_have:["多人","射击"], nice_to_have:["合作"], search_tags:["多人","合作","射击","第一人称射击","动作"]

不要推荐具体游戏名，只分析意图。
${feedbackContext}`
    }, {
      role: 'user',
      content: tagContext ? query.trim() + '\n\n【用户标签】\n' + tagContext : query.trim()
    }];

    // 意图解析 + 初步搜索并行（节省 2-3s）
    const rawKws = query.toLowerCase().split(/[,，\s]+/).filter(w => w.length > 1);
    const parsed = await callLLM(parsePrompt, 400).then(raw => {
      const p = extractJSON(raw, 'object');
      if (!p) throw new Error('JSON extraction failed');
      if (p.must_have?.length && p.search_tags?.length) {
        for (const t of p.must_have) {
          if (!p.search_tags.some(s => s.toLowerCase() === t.toLowerCase())) p.search_tags.push(t);
        }
      }
      if (!p.search_tags?.length && !p.must_have?.length) {
        p.search_tags = rawKws;
      }
      return p;
    }).catch(e => {
      console.error('[game-parse] failed:', e.message);
      return { must_have: [], nice_to_have: [], search_tags: rawKws, exclude: [], summary: query };
    });

    // 2. 多字段搜索 + 评分（标签+名称+简介+类型）
    const expandedAll = expandTags([...(parsed.must_have || []), ...(parsed.nice_to_have || []), ...(parsed.search_tags || [])]);
    const allSearchTags = expandedAll;
    // AND 逻辑只用 must_have（核心标签），不用 search_tags（含扩展同义词）
    const strictKeywords = (parsed.must_have || []).map(t => t.toLowerCase().trim()).filter(Boolean);
    const excludeTags = parsed.exclude || [];
    const mustHaveExpanded = expandTags(parsed.must_have || []);

    // 心情标签 → 硬排除（从 selected_tags 中提取）
    if (selected_tags?.length > 0) {
      for (const tag of selected_tags) {
        if (TAG_EXCLUDES[tag]) {
          for (const ex of TAG_EXCLUDES[tag]) {
            if (!excludeTags.includes(ex)) excludeTags.push(ex);
          }
        }
      }
    }

    const isNicheQuery = /冷门|小众|独立|像素|indie|niche/.test(query.toLowerCase());
    const minRatio = isNicheQuery ? SEARCH.GAME_MIN_RATIO_NICHE : SEARCH.GAME_MIN_RATIO;

    const feedback = buildFeedbackMaps({ liked: liked_games, disliked: disliked_games });
    let scored = searchGamesMultiField(allSearchTags, excludeTags, SEARCH.CANDIDATE_LIMIT, mustHaveExpanded);

    // 应用反馈权重 + 质量底线
    scored = scored
      .map(g => applyFeedback(g, feedback, minRatio, 'positive_ratio'))
      .filter(Boolean)
      .sort((a, b) => b._score - a._score);

    if (scored.length === 0) {
      return res.json({ parsed, games: [] });
    }

    // 归一化分数到 50-95 区间
    const maxScore = scored[0]._score || 1;
    for (const g of scored) {
      g._score = Math.round(50 + (g._score / maxScore) * 45);
    }

    // AND 逻辑：要求原始关键词全部命中，不够则渐进放松
    let searchExpanded = false;
    if (strictKeywords.length > 1) {
      const strict = filterByStrictKeywords(scored, strictKeywords, SEARCH.AND_MIN_RESULTS);
      scored = strict.results;
      searchExpanded = strict.relaxed;
    }

    // 3. 精选（给 LLM 丰富上下文，精简候选减少 token）
    const topN = scored.slice(0, SEARCH.LLM_SELECT_TOP);

    const gamesDesc = topN.map((g, i) => {
      const tags = (g.tags || []).slice(0, 5).join('/');
      const ratio = g.positive_ratio ? `${g.positive_ratio}%好评` : '';
      const desc = (g.short_description || '').slice(0, 60);
      return `${i + 1}. ${g.name} [${tags}] ${ratio} ${desc}`;
    }).join('\n');

    // 结构化用户上下文
    const priorityTags = (parsed.must_have || []).join('、');
    const timeBudget = /百小时|几百|耐玩|长期/.test(query) ? '长局（100h+）' :
      /10分钟|短|快速|一局/.test(query) ? '短局（10-30min）' : '不限';
    const likedSummary = (liked_games || []).slice(0, 3).map(g => g.name + '(' + (g.tags || []).slice(0, 3).join('/') + ')').join('、');
    const dislikedSummary = (disliked_games || []).slice(0, 3).map(g => g.name).join('、');
    const hardExcludes = excludeTags.length > 0 ? excludeTags.join('、') : '无';

    const userContext = `
【用户画像】
- 最高优先级：${priorityTags || parsed.summary || query}
- 游玩时长：${timeBudget}
- 硬排除标签：${hardExcludes}
${likedSummary ? '- 喜欢：' + likedSummary : ''}
${dislikedSummary ? '- 不喜欢：' + dislikedSummary : ''}`;

    const selectPrompt = [{
      role: 'system',
      content: `你是游戏推荐助手。从候选中精选最匹配的 8-12 款。

需求：${parsed.summary} | 原始：${query}
${userContext}
${tagContext ? '标签：' + tagContext : ''}

候选（已按匹配度排序）：
${gamesDesc}

输出JSON：{ "selected": [{"index":1,"reason":"具体匹配理由(40字内)"}] }
- reason 必须引用具体标签/特性，禁止空话
- 找最符合核心需求的，不是最知名的
- 硬排除命中的一律不选`
    }];

    let games = [];
    try {
      const raw = await callLLM(selectPrompt, 600);
      let parsed_select = extractJSON(raw, 'object');
      let selected, excludedSample;
      if (parsed_select && Array.isArray(parsed_select.selected)) {
        selected = parsed_select.selected;
        excludedSample = parsed_select.excluded_sample || [];
      } else {
        const arr = extractJSON(raw, 'array');
        if (!arr) throw new Error('JSON extraction failed');
        selected = arr;
        excludedSample = [];
      }

      if (excludedSample.length > 0) {
        console.log('[game-select] excluded:', excludedSample.map(e => `#${e.index}: ${e.why}`).join(' | '));
      }

      const searchTags = allSearchTags;
      const selectedIds = new Set();
      for (const sel of selected) {
        const g = topN[sel.index - 1];
        if (!g) continue;
        selectedIds.add(g.appid);
        const mk = (g._matchedKws || g._matchedTags || []).filter(Boolean);
        const algoScore = Math.round(g._score || 0);
        games.push({
          ...g,
          ai_selected: true,
          match_reason: sel.reason,
          match_score: algoScore,
          matched_keywords: mk.length > 0 ? mk : searchTags.slice(0, 3),
          match_details: { score: algoScore, matched_keywords: mk, positive_ratio: g.positive_ratio || 0, total_reviews: g.total_reviews || 0 },
          steam_url: 'https://store.steampowered.com/app/' + g.appid,
          header_image: g.header_image || ''
        });
      }
      // 追加未被AI选中的候选，供"加载更多"使用
      for (const g of scored) {
        if (selectedIds.has(g.appid)) continue;
        const mk = (g._matchedKws || g._matchedTags || []).filter(Boolean);
        const algoScore = Math.round(g._score || 0);
        games.push({
          ...g,
          ai_selected: false,
          match_reason: '相关推荐',
          match_score: algoScore,
          matched_keywords: mk.length > 0 ? mk : searchTags.slice(0, 3),
          match_details: { score: algoScore, matched_keywords: mk, positive_ratio: g.positive_ratio || 0, total_reviews: g.total_reviews || 0 },
          steam_url: 'https://store.steampowered.com/app/' + g.appid,
          header_image: g.header_image || ''
        });
      }
    } catch (e) {
      console.error('[game-select] failed:', e.message);
      const searchTags = allSearchTags;
      games = scored.slice(0, SEARCH.LLM_SELECT_TOP).map(g => ({
        ...g,
        ai_selected: false,
        match_reason: '算法推荐',
        match_score: Math.round(g._score || 0),
        matched_keywords: (g._matchedKws || g._matchedTags || []).filter(Boolean).length > 0 ? (g._matchedKws || g._matchedTags || []) : searchTags.slice(0, 3),
        match_details: { score: Math.round(g._score || 0), matched_keywords: g._matchedKws || [], positive_ratio: g.positive_ratio || 0, total_reviews: g.total_reviews || 0 },
        steam_url: 'https://store.steampowered.com/app/' + g.appid,
        header_image: g.header_image || ''
      }));
    }

    // 最终按匹配度排序
    games.sort((a, b) => (b.match_score || 0) - (a.match_score || 0));

    const result = { parsed, games, search_expanded: searchExpanded };
    setCache(cacheKey, result);
    res.json(result);

  } catch (e) {
    console.error('[game-search] error:', e);
    res.status(500).json({ error: '搜索失败，请稍后再试' });
  }
});

// ══════════════════════════════════════════
//  影视部分
// ══════════════════════════════════════════

function rowToMovie(row) {
  return {
    id: row[0],
    type: row[1],
    name: row[2],
    original_name: row[3],
    year: row[4],
    country: row[5],
    genres: JSON.parse(row[6] || '[]'),
    tags: JSON.parse(row[7] || '[]'),
    rating: row[8],
    vote_count: row[9],
    desc: row[10],
    poster: row[11],
    seasons: row[12],
    tmdb_id: row[13]
  };
}

// ── 多字段模糊搜索 + 评分（影视版）──
function searchMoviesMultiField(keywords, excludeTags, limit = 50, regionVariants = []) {
  if (!db || !keywords.length) return [];
  const excludes = (excludeTags || []).map(t => t.toLowerCase());
  const kws = keywords.map(k => k.toLowerCase().trim()).filter(Boolean);
  if (!kws.length) return [];
  const hasRegionBoost = regionVariants.length > 0;
  const regionLower = regionVariants.map(v => v.toLowerCase());

  // 用所有关键词匹配 tags/name/desc/genres/country，收集候选
  const conditions = kws.map(() => "(tags LIKE ? OR name LIKE ? OR desc LIKE ? OR genres LIKE ? OR country LIKE ?)").join(' OR ');
  const params = [];
  for (const w of kws) {
    const like = '%' + w + '%';
    params.push(like, like, like, like, like);
  }
  const sql = `SELECT * FROM movies WHERE (${conditions}) ORDER BY rating DESC LIMIT ${SEARCH.SQL_LIMIT}`;
  const result = db.exec(sql, params);
  if (!result.length) return [];

  const candidates = result[0].values.map(rowToMovie);

  // 评分
  const scored = candidates.map(m => {
    const tags = (m.tags || []).map(t => t.toLowerCase());
    const name = (m.name || '').toLowerCase();
    const desc = (m.desc || '').toLowerCase();
    const genres = (m.genres || []).map(t => t.toLowerCase());
    const country = (m.country || '').toLowerCase();

    // 排除检查
    for (const ex of excludes) {
      if (tags.some(t => t.includes(ex) || ex.includes(t))) return null;
    }

    let score = 0;
    const matchedKws = [];

    for (const kw of kws) {
      let kwMatched = false;
      // 标签命中 +3
      if (tags.some(t => t.includes(kw) || kw.includes(t))) { score += 3; kwMatched = true; }
      // 类型命中 +2
      if (genres.some(t => t.includes(kw) || kw.includes(t))) { score += 2; kwMatched = true; }
      // 名称命中 +2
      if (name.includes(kw)) { score += 2; kwMatched = true; }
      // 简介命中 +1
      if (desc.includes(kw)) { score += 1; kwMatched = true; }
      // 国家命中 +1
      if (country.includes(kw)) { score += 1; kwMatched = true; }
      if (kwMatched) matchedKws.push(kw);
    }

    if (score === 0) return null;

    // 地区 boost：只匹配主制片国（第一个国家），避免联合制片干扰
    if (hasRegionBoost) {
      const primary = getPrimaryCountry(country);
      if (regionLower.some(v => primary.includes(v))) {
        score += 8;
      }
    }

    // 标签特异性惩罚：标签越多，单个匹配权重越低，下限 0.50
    const tagCount = tags.length;
    const specificityPenalty = Math.max(0.50, 1 / Math.sqrt(Math.max(tagCount, 1)));
    score = score * specificityPenalty;

    // 质量系数（乘法，0.65~1.0，影视不加年代衰减）
    const rating = m.rating || 0;
    const voteCount = m.vote_count || 0;
    const reviewScore = 1 / (1 + Math.exp(4 - voteCount / 250));
    const qualityBase = Math.min(1.0, 0.65 + 0.35 * (rating / 10) + 0.20 * reviewScore);
    score = score * qualityBase;

    return { ...m, _score: score, _matchedKws: matchedKws };
  }).filter(Boolean).sort((a, b) => b._score - a._score);

  return scored.slice(0, limit);
}

// 按地区搜索（SQL 层面先过滤国家，避免被其他地区挤掉）
function searchMoviesMultiFieldByRegion(keywords, regionVariants, excludeTags, limit = 50) {
  if (!db || !keywords.length || !regionVariants?.length) return [];
  const excludes = (excludeTags || []).map(t => t.toLowerCase());
  const kws = keywords.map(k => k.toLowerCase().trim()).filter(Boolean);
  if (!kws.length) return [];

  // 构建地区条件：只匹配主制片国（country 以 variant 开头）
  const regionConds = regionVariants.map(() => "country LIKE ?").join(' OR ');
  const regionParams = regionVariants.map(v => v + '%');

  // 关键词条件
  const kwConds = kws.map(() => "(tags LIKE ? OR name LIKE ? OR desc LIKE ? OR genres LIKE ?)").join(' OR ');
  const kwParams = [];
  for (const w of kws) {
    const like = '%' + w + '%';
    kwParams.push(like, like, like, like);
  }

  const sql = `SELECT * FROM movies WHERE (${regionConds}) AND (${kwConds}) ORDER BY rating DESC LIMIT ${SEARCH.SQL_LIMIT}`;
  const result = db.exec(sql, [...regionParams, ...kwParams]);
  if (!result.length) return [];

  const candidates = result[0].values.map(rowToMovie);

  return candidates.map(m => {
    const tags = (m.tags || []).map(t => t.toLowerCase());
    const name = (m.name || '').toLowerCase();
    const desc = (m.desc || '').toLowerCase();
    const genres = (m.genres || []).map(t => t.toLowerCase());
    const country = (m.country || '').toLowerCase();

    for (const ex of excludes) {
      if (tags.some(t => t.includes(ex) || ex.includes(t))) return null;
    }

    let score = 0;
    const matchedKws = [];
    for (const kw of kws) {
      let kwMatched = false;
      if (tags.some(t => t.includes(kw) || kw.includes(t))) { score += 3; kwMatched = true; }
      if (genres.some(t => t.includes(kw) || kw.includes(t))) { score += 2; kwMatched = true; }
      if (name.includes(kw)) { score += 2; kwMatched = true; }
      if (desc.includes(kw)) { score += 1; kwMatched = true; }
      if (kwMatched) matchedKws.push(kw);
    }

    if (score === 0) return null;

    // 标签特异性惩罚，下限 0.50
    const tagCount = tags.length;
    const specificityPenalty = Math.max(0.50, 1 / Math.sqrt(Math.max(tagCount, 1)));
    score = score * specificityPenalty;

    const rating = m.rating || 0;
    const voteCount = m.vote_count || 0;
    const reviewScore = 1 / (1 + Math.exp(4 - voteCount / 250));
    const qualityBase = Math.min(1.0, 0.65 + 0.35 * (rating / 10) + 0.20 * reviewScore);
    const mYear = m.year || 2020;
    const mAge = Math.max(0, new Date().getFullYear() - mYear);
    const mYearPenalty = mAge <= 3 ? 1.0 : Math.max(0.50, 1.0 - (mAge - 3) * 0.04);
    score = score * qualityBase * mYearPenalty;

    return { ...m, _score: score, _matchedKws: matchedKws };
  }).filter(Boolean).sort((a, b) => b._score - a._score).slice(0, limit);
}

function searchMoviesByName(name, limit = 5) {
  if (!db || !name) return [];
  const sql = `SELECT * FROM movies WHERE name LIKE ? ORDER BY rating DESC LIMIT ?`;
  const result = db.exec(sql, ['%' + name + '%', limit]);
  if (!result.length) return [];
  return result[0].values.map(rowToMovie);
}

app.get('/api/movie/catalog-status', (req, res) => {
  if (!db) return res.json({ loaded: 0 });
  const count = db.exec('SELECT COUNT(*) FROM movies')[0]?.values[0]?.[0] || 0;
  res.json({ loaded: count });
});

app.post('/api/movie/search', async (req, res) => {
  try {
    const { query: rawQuery, selected_tags, liked_movies, disliked_movies } = req.body;
    if (!rawQuery?.trim()) return res.status(400).json({ error: '请输入描述' });
    if (rawQuery.length > 2000) return res.status(400).json({ error: '描述过长，请精简' });
    const query = sanitizeInput(rawQuery);

    // 缓存 key 不含反馈
    const cacheKey = 'm:' + query.trim().toLowerCase() + '|' + (selected_tags || []).sort().join(',');
    const cached = getCached(cacheKey);
    if (cached && !liked_movies?.length && !disliked_movies?.length) return res.json(cached);

    // 缓存未命中时才限流
    if (!checkRateLimit(req)) return res.status(429).json({ error: '请求太频繁，请稍后再试' });

    const tagContext = (selected_tags && selected_tags.length > 0) ? '用户选择的标签：' + selected_tags.join('、') : '';

    // 构建反馈上下文
    let feedbackContext = '';
    if (liked_movies?.length > 0) {
      const likedDesc = liked_movies.slice(0, 5).map(m => m.name + '(' + (m.tags || []).join('/') + ')').join('、');
      feedbackContext += '\n用户喜欢的影视：' + likedDesc + '。推荐类似风格的作品。';
    }
    if (disliked_movies?.length > 0) {
      const dislikedNames = disliked_movies.slice(0, 8).map(m => m.name).join('、');
      feedbackContext += '\n用户不感兴趣的影视：' + dislikedNames + '。避免推荐这些和类似的作品。';
    }

    // 1. 解析 + 原始搜索并行
    const parsePrompt = [{
      role: 'system',
      content: `你是影视搜索助手。分析用户描述，提取搜索意图。

输出JSON：
{
  "keywords": ["关键词1", "keyword2", ...],
  "region": "国家/地区，没有则空",
  "suggested_titles": ["影视名1", ...],
  "summary": "一句话概括需求"
}

规则：
- keywords 用用户语言（中文就中文），3-5个
- region 提取明确提到的地区（"国产"→"中国"，"日剧"→"日本"，无则空）
- suggested_titles 8-10部，须符合 region 限制，覆盖不同年代
${feedbackContext}`
    }, { role: 'user', content: tagContext ? query.trim() + '\n\n【用户标签】\n' + tagContext : query.trim() }];

    const parsed = await callLLM(parsePrompt, 400).then(raw => {
      const p = extractJSON(raw, 'object');
      if (!p) throw new Error('JSON extraction failed');
      return p;
    }).catch(e => {
      console.error('[movie-parse] failed:', e.message);
      return { keywords: [query], suggested_titles: [], summary: query };
    });

    // 规则预处理：从 query 直接提取地区+类型关键词（不依赖 LLM）
    const REGION_PATTERNS = [
      { pattern: /国产|中国|华语|国内/, region: '中国' },
      { pattern: /港片|港剧|香港/, region: '香港' },
      { pattern: /台剧|台片|台湾/, region: '台湾' },
      { pattern: /日剧|日影|日漫|日本/, region: '日本' },
      { pattern: /韩剧|韩影|韩国/, region: '韩国' },
      { pattern: /美剧|美国|好莱坞/, region: '美国' },
      { pattern: /英剧|英国/, region: '英国' },
      { pattern: /法剧|法国/, region: '法国' },
      { pattern: /印度|宝莱坞/, region: '印度' },
      { pattern: /泰剧|泰国/, region: '泰国' },
    ];
    let ruleRegion = '';
    let ruleTypeKeywords = [];
    for (const { pattern, region } of REGION_PATTERNS) {
      if (pattern.test(query)) {
        ruleRegion = region;
        const cleaned = query.replace(pattern, '').trim();
        if (cleaned) ruleTypeKeywords = cleaned.split(/[,，\s]+/).filter(w => w.length > 1);
        break;
      }
    }

    // 2. 多字段搜索 + 评分（标签+名称+简介+类型+国家）
    // 国家/地区过滤（从 query + parsed.region 中提取）
    const REGION_KEYWORDS = {
      '国产': '中国', '中国': '中国', '华语': '华语', '国内': '中国',
      '港片': '香港', '港剧': '香港', '香港': '香港',
      '台湾': '台湾', '台剧': '台湾', '台片': '台湾',
      '日剧': '日本', '日影': '日本', '日本': '日本', '日漫': '日本',
      '韩剧': '韩国', '韩影': '韩国', '韩国': '韩国',
      '美剧': '美国', '美国': '美国', '好莱坞': '美国',
      '英剧': '英国', '英国': '英国',
      '法剧': '法国', '法国': '法国',
      '印度': '印度', '宝莱坞': '印度',
      '泰国': '泰国', '泰剧': '泰国',
      '德国': '德国', '西班牙': '西班牙', '意大利': '意大利',
      '加拿大': '加拿大', '澳大利亚': '澳大利亚', '墨西哥': '墨西哥',
      '巴西': '巴西', '俄罗斯': '俄罗斯', '瑞典': '瑞典',
      '丹麦': '丹麦', '挪威': '挪威',
    };

    // 从搜索关键词中剥离地区词（"国产""港片"等不是内容标签，不应参与搜索匹配）
    const REGION_ONLY_KEYWORDS = new Set(Object.keys(REGION_KEYWORDS));
    const filteredKeywords = (parsed.keywords || []).filter(k => !REGION_ONLY_KEYWORDS.has(k));
    // 优先用规则提取的类型关键词，其次 LLM，最后硬编码
    const finalKeywords = ruleTypeKeywords.length > 0
      ? ruleTypeKeywords
      : (filteredKeywords.length > 0 ? filteredKeywords : ['喜剧']);
    const expandedAll = expandTags(finalKeywords);
    const allSearchTags = expandedAll;

    let regionRaw = (parsed.region || '').trim();
    // 优先从 query 中正则匹配（比 AI 提取更准确，如"港片"→"香港"）
    let regionFromQuery = '';
    for (const [kw, region] of Object.entries(REGION_KEYWORDS)) {
      if (query.includes(kw)) { regionFromQuery = region; break; }
    }
    // 规则提取 > query 匹配 > AI 提取
    regionRaw = ruleRegion || regionFromQuery || regionRaw;
    console.log('[movie-search] region:', regionRaw, '| query:', query.substring(0, 30));
    const COUNTRY_MAP = {
      '中国': ['China', 'CN', 'Mainland China'],
      '香港': ['Hong Kong', 'HK'],
      '台湾': ['Taiwan', 'TW'],
      '日本': ['Japan', 'JP'],
      '韩国': ['South Korea', 'KR'],
      '美国': ['United States of America', 'US', 'USA'],
      '英国': ['United Kingdom', 'GB', 'UK'],
      '法国': ['France', 'FR'],
      '印度': ['India', 'IN'],
      '泰国': ['Thailand', 'TH'],
      '德国': ['Germany', 'DE'],
      '西班牙': ['Spain', 'ES'],
      '意大利': ['Italy', 'IT'],
      '加拿大': ['Canada', 'CA'],
      '澳大利亚': ['Australia', 'AU'],
      '墨西哥': ['Mexico', 'MX'],
      '巴西': ['Brazil', 'BR'],
      '俄罗斯': ['Russia', 'RU'],
      '瑞典': ['Sweden', 'SE'],
      '丹麦': ['Denmark', 'DK'],
      '挪威': ['Norway', 'NO'],
    };
    // 华语 = 中国+香港+台湾
    const regionVariants = regionRaw === '华语'
      ? ['China', 'CN', 'Mainland China', 'Hong Kong', 'HK', 'Taiwan', 'TW']
      : (COUNTRY_MAP[regionRaw] || []);

    const isNicheQuery = /冷门|小众|文艺|独立|cult|indie/.test(query.toLowerCase());
    const minRating = isNicheQuery ? SEARCH.MOVIE_MIN_RATING_NICHE : SEARCH.MOVIE_MIN_RATING;

    // 心情标签 → 硬排除
    const movieExcludes = [];
    if (selected_tags?.length > 0) {
      for (const tag of selected_tags) {
        if (TAG_EXCLUDES[tag]) {
          for (const ex of TAG_EXCLUDES[tag]) {
            if (!movieExcludes.includes(ex)) movieExcludes.push(ex);
          }
        }
      }
    }

    const feedback = buildFeedbackMaps({ liked: liked_movies, disliked: disliked_movies }, 'name');

    // 有地区时先在该地区内搜索，结果不足则扩大到全库但给地区匹配加分
    let scored;
    if (regionVariants.length > 0) {
      scored = searchMoviesMultiFieldByRegion(allSearchTags, regionVariants, movieExcludes, SEARCH.CANDIDATE_LIMIT);
      if (scored.length < SEARCH.AND_MIN_RESULTS) {
        console.log(`[movie-search] region strict results too few (${scored.length}), using boost mode`);
        const boosted = searchMoviesMultiField(allSearchTags, movieExcludes, SEARCH.BOOST_LIMIT, regionVariants);
        const seen = new Set(scored.map(m => m.name));
        for (const m of boosted) {
          if (!seen.has(m.name)) { scored.push(m); seen.add(m.name); }
        }
      }
    } else {
      scored = searchMoviesMultiField(allSearchTags, movieExcludes, SEARCH.CANDIDATE_LIMIT);
    }

    // 应用反馈权重 + 质量底线 + 国家过滤
    function applyFilters(list, doRegionFilter) {
      return list
        .map(m => {
          if (feedback.dislikedNames.has(m.name?.toLowerCase())) return null;
          if ((m.rating || 0) < minRating) return null;
          if (doRegionFilter && regionVariants.length > 0) {
            const primary = getPrimaryCountry(m.country || '');
            if (!regionVariants.some(v => primary.includes(v.toLowerCase()))) return null;
          }
          return applyFeedback(m, feedback, -Infinity, 'rating');
        })
        .filter(Boolean)
        .sort((a, b) => b._score - a._score);
    }

    // 应用反馈权重 + 质量底线（国家过滤已在搜索层完成）
    scored = applyFilters(scored, false);

    // 追加名称搜索结果（也过滤国家）
    const nameResults = [];
    for (const name of (parsed.suggested_titles || []).slice(0, 10)) {
      nameResults.push(...searchMoviesByName(name, 3));
    }
    const seen = new Set(scored.map(m => m.name));
    for (const item of nameResults) {
      if (seen.has(item.name)) continue;
      // 国家过滤（只匹配主制片国）
      if (regionVariants.length > 0) {
        const primary = getPrimaryCountry(item.country || '');
        if (!regionVariants.some(v => primary.includes(v.toLowerCase()))) continue;
      }
      seen.add(item.name);
      scored.push({ ...item, _score: 0, _matchedKws: [] });
    }

    if (scored.length === 0) return res.json({ parsed, results: [] });

    // 归一化分数到 50-95 区间
    const maxScore = scored[0]._score || 1;
    for (const m of scored) {
      m._score = Math.round(50 + (m._score / maxScore) * 45);
    }

    // AND 逻辑：要求原始关键词全部命中，不够则渐进放松
    // 有规则提取地区时，只用规则提取的类型关键词（避免 LLM 扩展词导致 AND 过松）
    const andSource = ruleRegion ? ruleTypeKeywords : finalKeywords;
    const strictKeywords = andSource.map(t => t.toLowerCase().trim()).filter(Boolean);
    let searchExpanded = false;
    if (strictKeywords.length > 1) {
      const strict = filterByStrictKeywords(scored, strictKeywords, SEARCH.AND_MIN_RESULTS);
      scored = strict.results;
      searchExpanded = strict.relaxed;
    }

    // 用户明确指定地区时，硬过滤主制片国（规则提取的地区优先级最高）
    if (ruleRegion && regionVariants.length > 0) {
      const regionFiltered = scored.filter(m => {
        const primary = getPrimaryCountry(m.country || '');
        return regionVariants.some(v => primary.includes(v.toLowerCase()));
      });
      // 只有地区内有结果时才过滤，否则保留全部（避免零结果）
      if (regionFiltered.length >= 3) {
        scored = regionFiltered;
      }
    }

    const candidates = scored;

    // 3. 精选（给 LLM 丰富上下文，精简候选减少 token）
    const topN = candidates.slice(0, SEARCH.LLM_SELECT_TOP);

    const moviesDesc = topN.map((m, i) => {
      const tags = (m.tags || []).slice(0, 4).join('/');
      const rating = m.rating ? `${m.rating}分` : '';
      return `${i + 1}. ${m.name}(${m.year || '?'}${m.country ? ',' + m.country : ''}) [${tags}] ${rating}`;
    }).join('\n');

    const regionHint = regionVariants.length > 0 ? `\n⚠️ 用户指定了国家/地区：${regionRaw}。只推荐该地区的影视，其他国家/地区的影视一律排除，即使质量很高也不要选。` : '';

    // 结构化用户上下文
    const moviePriority = (parsed.keywords || []).slice(0, 3).join('、');
    const movieLikedSummary = (liked_movies || []).slice(0, 3).map(m => m.name + '(' + (m.tags || []).slice(0, 3).join('/') + ')').join('、');
    const movieDislikedSummary = (disliked_movies || []).slice(0, 3).map(m => m.name).join('、');
    const movieHardExcludes = movieExcludes.length > 0 ? movieExcludes.join('、') : '无';

    const movieUserContext = `
【用户画像】
- 最高优先级：${moviePriority || parsed.summary || query}
- 硬排除标签：${movieHardExcludes}
${movieLikedSummary ? '- 喜欢：' + movieLikedSummary : ''}
${movieDislikedSummary ? '- 不喜欢：' + movieDislikedSummary : ''}`;

    const selectPrompt = [{
      role: 'system',
      content: `你是影视推荐助手。从候选中精选最匹配的 8-12 部。

需求：${parsed.summary} | 原始：${query}
${regionHint}
${movieUserContext}
${tagContext ? '标签：' + tagContext : ''}

候选（已按匹配度排序）：
${moviesDesc}

输出JSON：{ "selected": [{"index":1,"reason":"具体匹配理由(40字内)"}] }
- reason 必须引用具体标签/特性，禁止空话
- 找最符合核心需求的，不是最知名的
- 硬排除命中的一律不选
- 冷门高分至少占40%`
    }];

    let results = [];
    try {
      const raw = await callLLM(selectPrompt, 600);
      let parsed_select = extractJSON(raw, 'object');
      let selected, excludedSample;
      if (parsed_select && Array.isArray(parsed_select.selected)) {
        selected = parsed_select.selected;
        excludedSample = parsed_select.excluded_sample || [];
      } else {
        const arr = extractJSON(raw, 'array');
        if (!arr) throw new Error('JSON extraction failed');
        selected = arr;
        excludedSample = [];
      }

      if (excludedSample.length > 0) {
        console.log('[movie-select] excluded:', excludedSample.map(e => `#${e.index}: ${e.why}`).join(' | '));
      }

      const searchTags = allSearchTags;
      const selectedIds = new Set();
      for (const sel of selected) {
        const m = topN[sel.index - 1];
        if (!m) continue;
        selectedIds.add(m.tmdb_id);
        const mk = (m._matchedKws || []).filter(Boolean);
        const algoScore = Math.round(m._score || 0);
        results.push({
          ...m,
          ai_selected: true,
          match_reason: sel.reason,
          match_score: algoScore,
          matched_keywords: mk.length > 0 ? mk : searchTags.slice(0, 3),
          match_details: { score: algoScore, matched_keywords: mk, rating: m.rating || 0, vote_count: m.vote_count || 0 }
        });
      }
      // 追加未被AI选中的候选，供"加载更多"使用
      for (const m of candidates) {
        if (selectedIds.has(m.tmdb_id)) continue;
        const mk = (m._matchedKws || []).filter(Boolean);
        const algoScore = Math.round(m._score || 0);
        results.push({
          ...m,
          ai_selected: false,
          match_reason: '相关推荐',
          match_score: algoScore,
          matched_keywords: mk.length > 0 ? mk : searchTags.slice(0, 3),
          match_details: { score: algoScore, matched_keywords: mk, rating: m.rating || 0, vote_count: m.vote_count || 0 }
        });
      }
    } catch (e) {
      console.error('[movie-select] failed:', e.message);
      const searchTags = allSearchTags;
      results = candidates.slice(0, SEARCH.LLM_SELECT_TOP).map(m => ({
        ...m,
        ai_selected: false,
        match_reason: '算法推荐',
        match_score: Math.round(m._score || 0),
        matched_keywords: (m._matchedKws || []).filter(Boolean).length > 0 ? m._matchedKws : searchTags.slice(0, 3),
        match_details: { score: Math.round(m._score || 0), matched_keywords: m._matchedKws || [], rating: m.rating || 0, vote_count: m.vote_count || 0 }
      }));
    }

    // 最终按匹配度排序
    results.sort((a, b) => (b.match_score || 0) - (a.match_score || 0));

    const result = { parsed, results, search_expanded: searchExpanded };
    setCache(cacheKey, result);
    res.json(result);

  } catch (e) {
    console.error('[movie-search] error:', e);
    res.status(500).json({ error: '搜索失败，请稍后再试' });
  }
});

// ── 启动 ──

async function start() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`  ◈ 对味了 · http://localhost:${PORT}`);
  });
}

start().catch(e => {
  console.error('启动失败:', e);
  process.exit(1);
});

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import initSqlJs from 'sql.js';

// ── Utilities ──

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

// Load .env
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

// ── Search config constants ──
const SEARCH = {
  CANDIDATE_LIMIT: 80,          // Max search candidates
  BOOST_LIMIT: 200,             // Region boost mode candidate limit
  SQL_LIMIT: 1000,              // SQL query limit
  LLM_SELECT_TOP: 15,           // Candidates sent to LLM for final selection
  LLM_RESULT_COUNT: '8-12',     // LLM return count description
  MIN_REVIEWS: 100,             // Min reviews for games (dynamic threshold base)
  GAME_MIN_RATIO: 55,           // Game positive ratio floor
  GAME_MIN_RATIO_NICHE: 45,     // Niche game positive ratio floor
  MOVIE_MIN_RATING: 6.0,        // Movie rating floor
  MOVIE_MIN_RATING_NICHE: 5.0,  // Niche movie rating floor
  AND_MIN_RESULTS: 5,           // AND logic minimum results
};

// ── Feedback weight building + application ──
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

// ── Tag synonym mapping (database has bilingual tags) ──
const TAG_SYNONYMS = {
  'idle': ['idle', 'clicker', 'incremental', '挂机', '放置'],
  'pixel art': ['pixel art', 'pixel graphics', 'retro', '像素', '复古'],
  'open world': ['open world', 'sandbox', '开放世界', '沙盒'],
  'survival': ['survival', 'survival horror', '生存', '生存恐怖'],
  'roguelike': ['roguelike', 'roguelite', '肉鸽'],
  'co-op': ['co-op', 'cooperative', 'online co-op', '合作', '在线合作'],
  'turn-based': ['turn-based', '回合制'],
  'horror': ['horror', 'survival horror', '恐怖', '生存恐怖'],
  'shooter': ['shooter', 'fps', 'first-person shooter', '射击', '第一人称射击'],
  'rpg': ['rpg', 'action rpg', 'jrpg', '角色扮演', '动作rpg'],
  'strategy': ['strategy', 'rts', 'tactics', '策略', '即时战略'],
  'puzzle': ['puzzle', '解谜'],
  'racing': ['racing', '竞速', '赛车'],
  'simulation': ['simulation', 'simulator', '模拟', '模拟器'],
  'building': ['building', 'base building', 'city builder', '建造', '基地建造'],
  'management': ['management', '经营'],
  'card game': ['card game', 'deckbuilder', '卡牌', '构筑牌组'],
  'story rich': ['story rich', 'narrative', '剧情', '剧情丰富', '叙事'],
  'platformer': ['platformer', '平台跳跃', '平台'],
  'action': ['action', 'hack and slash', '动作', '砍杀'],
  'adventure': ['adventure', 'action adventure', '冒险', '动作冒险'],
  'single player': ['single player', 'singleplayer', '单人'],
  'multiplayer': ['multiplayer', 'online multiplayer', '多人', '在线多人'],
  'stealth': ['stealth', '潜行'],
  'tower defense': ['tower defense', '塔防'],
  'anime': ['anime', '动漫', '日系'],
  'sci-fi': ['sci-fi', 'science fiction', '科幻'],
  'fantasy': ['fantasy', '奇幻'],
  'post-apocalyptic': ['post-apocalyptic', '末日'],
  'zombies': ['zombies', '僵尸'],
  'war': ['war', 'warfare', 'military', '战争', '军事'],
  'medieval': ['medieval', '中世纪'],
  'cyberpunk': ['cyberpunk', '赛博朋克'],
  'atmospheric': ['atmospheric', '氛围'],
  'exploration': ['exploration', '探索'],
  'relaxing': ['relaxing', 'chill', '放松', '治愈'],
  'souls-like': ['souls-like', 'difficult', '高难度', '魂类'],
  'dark': ['dark', '黑暗'],
  'cute': ['cute', '可爱'],
  'funny': ['funny', 'comedy', '搞笑', '喜剧'],
  'violent': ['violent', 'gore', '暴力', '血腥'],
  'sports': ['sports', '体育'],
  'music': ['music', 'rhythm', '音乐', '节奏'],
  'visual novel': ['visual novel', '视觉小说'],
  'battle royale': ['battle royale', '大逃杀'],
  'party': ['party', '聚会'],
  'space': ['space', '太空'],
  'casual': ['casual', '休闲'],
  'indie': ['indie', '独立'],
  'free to play': ['free to play', '免费'],
  'retro': ['retro', 'classic', '复古', '经典'],
  'first-person': ['first-person', '第一人称'],
  'third person': ['third person', '第三人称'],
  'crafting': ['crafting', '制作'],
  'female protagonist': ['female protagonist', '女性主角'],
  'mmorpg': ['mmorpg', 'mmo', '大型多人在线'],
};

// Mood tags → hard exclusion rules (SQL-level filtering, more reliable than AI guessing)
const TAG_EXCLUDES = {
  'Relaxing': ['souls', 'soulslike', 'dark souls', 'roguelike', 'pvp', 'competitive', 'battle royale'],
  'Brain teaser': ['idle', 'clicker'],
  'Thrilling': ['turn-based', 'strategy', 'visual novel'],
  'Emotional': ['battle royale'],
  'Chilling': [],
  'Social': ['singleplayer', 'visual novel'],
  'Challenging': ['idle', 'casual', 'clicker', 'easy'],
  'Exploration': ['linear', 'competitive', 'pvp'],
  'Mind-bending': ['souls', 'soulslike', 'roguelike'],
  'Cathartic': ['turn-based', 'strategy', 'visual novel', 'casual'],
  'Hilarious': ['horror', 'tragedy', 'crime'],
  'Philosophical': ['kids', 'comedy'],
  'Adrenaline': ['kids', 'drama'],
  'Healing': ['horror', 'crime', 'gore', 'violent', 'thriller'],
  'Nostalgic': [],
};

// Tag expansion
function expandTags(tags) {
  const expanded = new Set();
  for (const tag of tags) {
    const t = tag.trim();
    if (!t) continue;
    expanded.add(t);
    const lower = t.toLowerCase();
    // Exact match
    if (TAG_SYNONYMS[lower]) {
      TAG_SYNONYMS[lower].forEach(s => expanded.add(s));
      continue;
    }
    // Fuzzy match
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
  if (!checkRateLimit(req)) return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  next();
}

// ── LLM call (compatible with all OpenAI-format APIs) ──

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

// ── Search cache (LRU 200 entries + TTL 10 min) ──
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
//  SQLite Database
// ══════════════════════════════════════════

let db = null;

async function initDatabase() {
  const dbPath = path.join(__dirname, 'data/games.db');
  if (!fs.existsSync(dbPath)) {
    console.error('[db] games.db not found');
    return;
  }
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(dbPath);
  db = new SQL.Database(buffer);
  console.log('[db] SQLite database loaded');

  // Check counts
  const gameCount = db.exec('SELECT COUNT(*) FROM games')[0]?.values[0]?.[0] || 0;
  const movieCount = db.exec('SELECT COUNT(*) FROM movies')[0]?.values[0]?.[0] || 0;
  console.log(`[db] Games: ${gameCount} | Movies: ${movieCount}`);
}

// ══════════════════════════════════════════
//  Games
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

// ── Year extraction (ISO and various date formats) ──
function extractYear(dateStr) {
  if (!dateStr) return 2020;
  const m = dateStr.match(/(\d{4})/);
  return m ? parseInt(m[1]) : 2020;
}

// ── Extract primary production country (first country) ──
function getPrimaryCountry(country) {
  if (!country) return '';
  return country.split('/')[0].trim().toLowerCase();
}

// ── Keyword match count (for AND logic filtering) ──
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

// AND logic progressive relaxation: prefer full match, gradually relax if not enough
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

// ── Multi-field fuzzy search + scoring ──
function searchGamesMultiField(keywords, excludeTags, limit = 50, mustHaveTags = []) {
  if (!db || !keywords.length) return [];
  const excludes = (excludeTags || []).map(t => t.toLowerCase());
  const kws = keywords.map(k => k.toLowerCase().trim()).filter(Boolean);
  if (!kws.length) return [];
  const mustSet = new Set((mustHaveTags || []).map(t => t.toLowerCase()));

  // Match all keywords against tags/name/short_description/genres, collect candidates
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

  // Scoring
  const scored = candidates.map(g => {
    const tags = (g.tags || []).map(t => t.toLowerCase());
    const name = (g.name || '').toLowerCase();
    const desc = (g.short_description || '').toLowerCase();
    const genres = (g.genres || []).map(t => t.toLowerCase());

    // Exclusion check
    for (const ex of excludes) {
      if (tags.some(t => t.includes(ex) || ex.includes(t))) return null;
    }

    let score = 0;
    const matchedKws = [];

    for (const kw of kws) {
      let kwMatched = false;
      // Core tag weight ×3, normal tag ×1
      const kwWeight = mustSet.has(kw) ? 3 : 1;
      // Tag match +3 (exact match priority, substring match downweighted)
      if (tags.some(t => t === kw)) { score += 3 * kwWeight; kwMatched = true; }
      else if (tags.some(t => t.includes(kw) || kw.includes(t))) { score += 2 * kwWeight; kwMatched = true; }
      // Genre match +2
      if (genres.some(t => t.includes(kw) || kw.includes(t))) { score += 2 * kwWeight; kwMatched = true; }
      // Name match +2
      if (name.includes(kw)) { score += 2 * kwWeight; kwMatched = true; }
      // Description match +1
      if (desc.includes(kw)) { score += 1 * kwWeight; kwMatched = true; }
      if (kwMatched) matchedKws.push(kw);
    }

    if (score === 0) return null;

    // Tag specificity penalty: more tags = lower weight per match (TF-IDF approach)
    // Floor 0.50 to prevent zero results from over-penalizing
    const tagCount = tags.length;
    const specificityPenalty = Math.max(0.50, 1 / Math.sqrt(Math.max(tagCount, 1)));
    score = score * specificityPenalty;

    // Quality coefficient (multiplicative, 0.65~1.0)
    const ratio = g.positive_ratio || 0;
    const reviews = g.total_reviews || 0;
    const reviewScore = 1 / (1 + Math.exp(4 - reviews / 250)); // 50→0.10, 500→0.50, 2000→0.82, 10000→0.98
    const qualityBase = Math.min(1.0, 0.65 + 0.35 * (ratio / 100) + 0.20 * reviewScore);
    // Dynamic review threshold: older games need more reviews
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

// ── Image proxy (avoid canvas CORS issues) ──
app.get('/api/proxy-image', rateLimiter, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  // Only proxy Steam and TMDB images
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
    if (!rawQuery?.trim()) return res.status(400).json({ error: 'Please enter a description' });
    if (rawQuery.length > 2000) return res.status(400).json({ error: 'Description too long. Please shorten it.' });
    const query = sanitizeInput(rawQuery);

    // Cache key excludes feedback (feedback changes)
    const cacheKey = 'g:' + query.trim().toLowerCase() + '|' + (selected_tags || []).sort().join(',');
    const cached = getCached(cacheKey);
    if (cached && !liked_games?.length && !disliked_games?.length) return res.json(cached);

    // Rate limit only on cache miss
    if (!checkRateLimit(req)) return res.status(429).json({ error: 'Too many requests. Please try again later.' });

    const tagContext = (selected_tags && selected_tags.length > 0) ? 'User selected tags: ' + selected_tags.join(', ') : '';

    // Build feedback context
    let feedbackContext = '';
    if (liked_games?.length > 0) {
      const likedDesc = liked_games.slice(0, 5).map(g => g.name + '(' + (g.tags || []).join('/') + ')').join(', ');
      feedbackContext += '\nGames the user liked: ' + likedDesc + '. Recommend similar styles.';
    }
    if (disliked_games?.length > 0) {
      const dislikedNames = disliked_games.slice(0, 8).map(g => g.name).join(', ');
      feedbackContext += '\nGames the user disliked: ' + dislikedNames + '. Avoid recommending these or similar ones.';
    }

    // 1. Intent parsing + initial search in parallel
    const parsePrompt = [{
      role: 'system',
      content: `You are a game search intent analyzer. Analyze the user's description and extract search intent.

Output strict JSON:
{
  "must_have": ["core_tag1", "core_tag2"],
  "nice_to_have": ["bonus_tag1", "bonus_tag2"],
  "search_tags": ["search_tag1", "search_tag2"],
  "exclude": ["exclude_tag1"],
  "summary": "One sentence summarizing what the user wants"
}

Rules:
- must_have: Core features the user explicitly wants (1-3 tags)
- nice_to_have: Features mentioned but not required (0-3 tags)
- search_tags: Tags for database search (must_have + nice_to_have + related expansions, 4-8 total)
- exclude: Features the user explicitly doesn't want (0-2 tags)
- Use English tags that match the database

User: "fun indie games with good story"
→ must_have:["indie"], nice_to_have:["story rich"], search_tags:["indie","story rich","narrative","adventure","single player"]

User: "multiplayer co-op shooter"
→ must_have:["multiplayer","shooter"], nice_to_have:["co-op"], search_tags:["multiplayer","co-op","shooter","fps","action"]

Do NOT recommend specific game names, only analyze intent.
${feedbackContext}`
    }, {
      role: 'user',
      content: tagContext ? query.trim() + '\n\n[User Tags]\n' + tagContext : query.trim()
    }];

    // Intent parsing + initial search in parallel (saves 2-3s)
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

    // 2. Multi-field search + scoring (tags+name+desc+genres)
    const expandedAll = expandTags([...(parsed.must_have || []), ...(parsed.nice_to_have || []), ...(parsed.search_tags || [])]);
    const allSearchTags = expandedAll;
    // AND logic only uses must_have (core tags), not search_tags (includes expanded synonyms)
    const strictKeywords = (parsed.must_have || []).map(t => t.toLowerCase().trim()).filter(Boolean);
    const excludeTags = parsed.exclude || [];
    const mustHaveExpanded = expandTags(parsed.must_have || []);

    // Mood tags → hard exclusion (extracted from selected_tags)
    if (selected_tags?.length > 0) {
      for (const tag of selected_tags) {
        if (TAG_EXCLUDES[tag]) {
          for (const ex of TAG_EXCLUDES[tag]) {
            if (!excludeTags.includes(ex)) excludeTags.push(ex);
          }
        }
      }
    }

    const isNicheQuery = /niche|indie|hidden gem|underrated|obscure|pixel/.test(query.toLowerCase());
    const minRatio = isNicheQuery ? SEARCH.GAME_MIN_RATIO_NICHE : SEARCH.GAME_MIN_RATIO;

    const feedback = buildFeedbackMaps({ liked: liked_games, disliked: disliked_games });
    let scored = searchGamesMultiField(allSearchTags, excludeTags, SEARCH.CANDIDATE_LIMIT, mustHaveExpanded);

    // Apply feedback weights + quality floor
    scored = scored
      .map(g => applyFeedback(g, feedback, minRatio, 'positive_ratio'))
      .filter(Boolean)
      .sort((a, b) => b._score - a._score);

    if (scored.length === 0) {
      return res.json({ parsed, games: [] });
    }

    // Normalize scores to 50-95 range
    const maxScore = scored[0]._score || 1;
    for (const g of scored) {
      g._score = Math.round(50 + (g._score / maxScore) * 45);
    }

    // AND logic: require all original keywords matched, progressively relax if not enough
    let searchExpanded = false;
    if (strictKeywords.length > 1) {
      const strict = filterByStrictKeywords(scored, strictKeywords, SEARCH.AND_MIN_RESULTS);
      scored = strict.results;
      searchExpanded = strict.relaxed;
    }

    // 3. Final selection (rich context for LLM, compact candidates to reduce tokens)
    const topN = scored.slice(0, SEARCH.LLM_SELECT_TOP);

    const gamesDesc = topN.map((g, i) => {
      const tags = (g.tags || []).slice(0, 5).join('/');
      const ratio = g.positive_ratio ? `${g.positive_ratio}% positive` : '';
      const desc = (g.short_description || '').slice(0, 60);
      return `${i + 1}. ${g.name} [${tags}] ${ratio} ${desc}`;
    }).join('\n');

    // Structured user context
    const priorityTags = (parsed.must_have || []).join(', ');
    const timeBudget = /hundred hours|long term|endless|marathon/.test(query) ? 'Long sessions (100h+)' :
      /10 min|short|quick|one round/.test(query) ? 'Short sessions (10-30min)' : 'Any';
    const likedSummary = (liked_games || []).slice(0, 3).map(g => g.name + '(' + (g.tags || []).slice(0, 3).join('/') + ')').join(', ');
    const dislikedSummary = (disliked_games || []).slice(0, 3).map(g => g.name).join(', ');
    const hardExcludes = excludeTags.length > 0 ? excludeTags.join(', ') : 'None';

    const userContext = `
[User Profile]
- Top priority: ${priorityTags || parsed.summary || query}
- Play time: ${timeBudget}
- Hard excludes: ${hardExcludes}
${likedSummary ? '- Likes: ' + likedSummary : ''}
${dislikedSummary ? '- Dislikes: ' + dislikedSummary : ''}`;

    const selectPrompt = [{
      role: 'system',
      content: `You are a game recommendation assistant. Select the 8-12 best matches from candidates.

Need: ${parsed.summary} | Original: ${query}
${userContext}
${tagContext ? 'Tags: ' + tagContext : ''}

Candidates (sorted by match score):
${gamesDesc}

Output JSON: { "selected": [{"index":1,"reason":"Specific match reason (under 40 chars)"}] }
- reason must reference specific tags/features, no generic praise
- Find the best fit for core needs, not the most famous
- Never select items matching hard excludes`
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
      // Append non-AI-selected candidates for "load more"
      for (const g of scored) {
        if (selectedIds.has(g.appid)) continue;
        const mk = (g._matchedKws || g._matchedTags || []).filter(Boolean);
        const algoScore = Math.round(g._score || 0);
        games.push({
          ...g,
          ai_selected: false,
          match_reason: 'Related',
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
        match_reason: 'Algorithm pick',
        match_score: Math.round(g._score || 0),
        matched_keywords: (g._matchedKws || g._matchedTags || []).filter(Boolean).length > 0 ? (g._matchedKws || g._matchedTags || []) : searchTags.slice(0, 3),
        match_details: { score: Math.round(g._score || 0), matched_keywords: g._matchedKws || [], positive_ratio: g.positive_ratio || 0, total_reviews: g.total_reviews || 0 },
        steam_url: 'https://store.steampowered.com/app/' + g.appid,
        header_image: g.header_image || ''
      }));
    }

    // Final sort by match score
    games.sort((a, b) => (b.match_score || 0) - (a.match_score || 0));

    const result = { parsed, games, search_expanded: searchExpanded };
    setCache(cacheKey, result);
    res.json(result);

  } catch (e) {
    console.error('[game-search] error:', e);
    res.status(500).json({ error: 'Search failed. Please try again later.' });
  }
});

// ══════════════════════════════════════════
//  Movies
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

// ── Multi-field fuzzy search + scoring (movies) ──
function searchMoviesMultiField(keywords, excludeTags, limit = 50, regionVariants = []) {
  if (!db || !keywords.length) return [];
  const excludes = (excludeTags || []).map(t => t.toLowerCase());
  const kws = keywords.map(k => k.toLowerCase().trim()).filter(Boolean);
  if (!kws.length) return [];
  const hasRegionBoost = regionVariants.length > 0;
  const regionLower = regionVariants.map(v => v.toLowerCase());

  // Match all keywords against tags/name/desc/genres/country, collect candidates
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

  // Scoring
  const scored = candidates.map(m => {
    const tags = (m.tags || []).map(t => t.toLowerCase());
    const name = (m.name || '').toLowerCase();
    const desc = (m.desc || '').toLowerCase();
    const genres = (m.genres || []).map(t => t.toLowerCase());
    const country = (m.country || '').toLowerCase();

    // Exclusion check
    for (const ex of excludes) {
      if (tags.some(t => t.includes(ex) || ex.includes(t))) return null;
    }

    let score = 0;
    const matchedKws = [];

    for (const kw of kws) {
      let kwMatched = false;
      // Tag match +3
      if (tags.some(t => t.includes(kw) || kw.includes(t))) { score += 3; kwMatched = true; }
      // Genre match +2
      if (genres.some(t => t.includes(kw) || kw.includes(t))) { score += 2; kwMatched = true; }
      // Name match +2
      if (name.includes(kw)) { score += 2; kwMatched = true; }
      // Description match +1
      if (desc.includes(kw)) { score += 1; kwMatched = true; }
      // Country match +1
      if (country.includes(kw)) { score += 1; kwMatched = true; }
      if (kwMatched) matchedKws.push(kw);
    }

    if (score === 0) return null;

    // Region boost: only match primary production country (first), avoid co-production noise
    if (hasRegionBoost) {
      const primary = getPrimaryCountry(country);
      if (regionLower.some(v => primary.includes(v))) {
        score += 8;
      }
    }

    // Tag specificity penalty: more tags = lower weight per match, floor 0.50
    const tagCount = tags.length;
    const specificityPenalty = Math.max(0.50, 1 / Math.sqrt(Math.max(tagCount, 1)));
    score = score * specificityPenalty;

    // Quality coefficient (multiplicative, 0.65~1.0, no age decay for movies)
    const rating = m.rating || 0;
    const voteCount = m.vote_count || 0;
    const reviewScore = 1 / (1 + Math.exp(4 - voteCount / 250));
    const qualityBase = Math.min(1.0, 0.65 + 0.35 * (rating / 10) + 0.20 * reviewScore);
    score = score * qualityBase;

    return { ...m, _score: score, _matchedKws: matchedKws };
  }).filter(Boolean).sort((a, b) => b._score - a._score);

  return scored.slice(0, limit);
}

// Search by region (SQL-level country filter, avoid being crowded out by other regions)
function searchMoviesMultiFieldByRegion(keywords, regionVariants, excludeTags, limit = 50) {
  if (!db || !keywords.length || !regionVariants?.length) return [];
  const excludes = (excludeTags || []).map(t => t.toLowerCase());
  const kws = keywords.map(k => k.toLowerCase().trim()).filter(Boolean);
  if (!kws.length) return [];

  // Build region conditions: match primary production country only (country starts with variant)
  const regionConds = regionVariants.map(() => "country LIKE ?").join(' OR ');
  const regionParams = regionVariants.map(v => v + '%');

  // Keyword conditions
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

    // Tag specificity penalty, floor 0.50
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
    if (!rawQuery?.trim()) return res.status(400).json({ error: 'Please enter a description' });
    if (rawQuery.length > 2000) return res.status(400).json({ error: 'Description too long. Please shorten it.' });
    const query = sanitizeInput(rawQuery);

    // Cache key excludes feedback
    const cacheKey = 'm:' + query.trim().toLowerCase() + '|' + (selected_tags || []).sort().join(',');
    const cached = getCached(cacheKey);
    if (cached && !liked_movies?.length && !disliked_movies?.length) return res.json(cached);

    // Rate limit only on cache miss
    if (!checkRateLimit(req)) return res.status(429).json({ error: 'Too many requests. Please try again later.' });

    const tagContext = (selected_tags && selected_tags.length > 0) ? 'User selected tags: ' + selected_tags.join(', ') : '';

    // Build feedback context
    let feedbackContext = '';
    if (liked_movies?.length > 0) {
      const likedDesc = liked_movies.slice(0, 5).map(m => m.name + '(' + (m.tags || []).join('/') + ')').join(', ');
      feedbackContext += '\nMovies the user liked: ' + likedDesc + '. Recommend similar styles.';
    }
    if (disliked_movies?.length > 0) {
      const dislikedNames = disliked_movies.slice(0, 8).map(m => m.name).join(', ');
      feedbackContext += '\nMovies the user disliked: ' + dislikedNames + '. Avoid recommending these or similar ones.';
    }

    // 1. Parse + initial search in parallel
    const parsePrompt = [{
      role: 'system',
      content: `You are a movie/TV search assistant. Analyze the user's description and extract search intent.

Output JSON:
{
  "keywords": ["keyword1", "keyword2", ...],
  "region": "Country/region, empty if none",
  "suggested_titles": ["Title1", ...],
  "summary": "One sentence summarizing what the user wants"
}

Rules:
- keywords: 3-5 tags in English
- region: Extract explicitly mentioned region ("Chinese"→"China", "Japanese"→"Japan", empty if none)
- suggested_titles: 8-10 titles matching the region constraint, covering different eras
${feedbackContext}`
    }, { role: 'user', content: tagContext ? query.trim() + '\n\n[User Tags]\n' + tagContext : query.trim() }];

    const parsed = await callLLM(parsePrompt, 400).then(raw => {
      const p = extractJSON(raw, 'object');
      if (!p) throw new Error('JSON extraction failed');
      return p;
    }).catch(e => {
      console.error('[movie-parse] failed:', e.message);
      return { keywords: [query], suggested_titles: [], summary: query };
    });

    // Rule preprocessing: extract region+genre keywords directly from query (no LLM dependency)
    const REGION_PATTERNS = [
      { pattern: /chinese|china|mainland/i, region: 'China' },
      { pattern: /hong kong|hk/i, region: 'Hong Kong' },
      { pattern: /taiwan|taiwanese/i, region: 'Taiwan' },
      { pattern: /japanese|japan|anime/i, region: 'Japan' },
      { pattern: /korean|korea|kdrama/i, region: 'South Korea' },
      { pattern: /american|hollywood|us\b/i, region: 'United States' },
      { pattern: /british|uk\b|england/i, region: 'United Kingdom' },
      { pattern: /french|france/i, region: 'France' },
      { pattern: /indian|india|bollywood/i, region: 'India' },
      { pattern: /thai|thailand/i, region: 'Thailand' },
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

    // 2. Multi-field search + scoring (tags+name+desc+genres+country)
    // Country/region filtering (from query + parsed.region)
    const REGION_KEYWORDS = {
      'chinese': 'China', 'china': 'China', 'mainland': 'China',
      'hong kong': 'Hong Kong', 'hk': 'Hong Kong',
      'taiwan': 'Taiwan', 'taiwanese': 'Taiwan',
      'japanese': 'Japan', 'japan': 'Japan', 'anime': 'Japan',
      'korean': 'South Korea', 'korea': 'South Korea', 'kdrama': 'South Korea',
      'american': 'United States', 'hollywood': 'United States',
      'british': 'United Kingdom', 'uk': 'United Kingdom', 'england': 'United Kingdom',
      'french': 'France', 'france': 'France',
      'indian': 'India', 'india': 'India', 'bollywood': 'India',
      'thai': 'Thailand', 'thailand': 'Thailand',
      'german': 'Germany', 'spain': 'Spain', 'italian': 'Italy',
      'canadian': 'Canada', 'australian': 'Australia', 'mexican': 'Mexico',
      'brazilian': 'Brazil', 'russian': 'Russia', 'swedish': 'Sweden',
      'danish': 'Denmark', 'norwegian': 'Norway',
    };

    // Strip region words from search keywords (they're not content tags, shouldn't participate in matching)
    const REGION_ONLY_KEYWORDS = new Set(Object.keys(REGION_KEYWORDS));
    const filteredKeywords = (parsed.keywords || []).filter(k => !REGION_ONLY_KEYWORDS.has(k));
    // Prefer rule-extracted genre keywords, then LLM, then hardcoded
    const finalKeywords = ruleTypeKeywords.length > 0
      ? ruleTypeKeywords
      : (filteredKeywords.length > 0 ? filteredKeywords : ['喜剧']);
    const expandedAll = expandTags(finalKeywords);
    const allSearchTags = expandedAll;

    let regionRaw = (parsed.region || '').trim();
    // Prefer regex match from query (more accurate than AI extraction)
    let regionFromQuery = '';
    for (const [kw, region] of Object.entries(REGION_KEYWORDS)) {
      if (query.toLowerCase().includes(kw.toLowerCase())) { regionFromQuery = region; break; }
    }
    // Rule extraction > query match > AI extraction
    regionRaw = ruleRegion || regionFromQuery || regionRaw;
    console.log('[movie-search] region:', regionRaw, '| query:', query.substring(0, 30));
    const COUNTRY_MAP = {
      'China': ['China', 'CN', 'Mainland China'],
      'Hong Kong': ['Hong Kong', 'HK'],
      'Taiwan': ['Taiwan', 'TW'],
      'Japan': ['Japan', 'JP'],
      'South Korea': ['South Korea', 'KR'],
      'United States': ['United States of America', 'US', 'USA'],
      'United Kingdom': ['United Kingdom', 'GB', 'UK'],
      'France': ['France', 'FR'],
      'India': ['India', 'IN'],
      'Thailand': ['Thailand', 'TH'],
      'Germany': ['Germany', 'DE'],
      'Spain': ['Spain', 'ES'],
      'Italy': ['Italy', 'IT'],
      'Canada': ['Canada', 'CA'],
      'Australia': ['Australia', 'AU'],
      'Mexico': ['Mexico', 'MX'],
      'Brazil': ['Brazil', 'BR'],
      'Russia': ['Russia', 'RU'],
      'Sweden': ['Sweden', 'SE'],
      'Denmark': ['Denmark', 'DK'],
      'Norway': ['Norway', 'NO'],
    };
    // Chinese-language = China + Hong Kong + Taiwan
    const regionVariants = regionRaw === 'Chinese'
      ? ['China', 'CN', 'Mainland China', 'Hong Kong', 'HK', 'Taiwan', 'TW']
      : (COUNTRY_MAP[regionRaw] || []);

    const isNicheQuery = /niche|indie|arthouse|cult|hidden gem|underrated/.test(query.toLowerCase());
    const minRating = isNicheQuery ? SEARCH.MOVIE_MIN_RATING_NICHE : SEARCH.MOVIE_MIN_RATING;

    // Mood tags → hard exclusion
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

    // If region specified, search within region first; if too few results, expand to full DB with region boost
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

    // Apply feedback weights + quality floor + country filter
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

    // Apply feedback weights + quality floor (country filtering done at search layer)
    scored = applyFilters(scored, false);

    // Append name search results (also filter by country)
    const nameResults = [];
    for (const name of (parsed.suggested_titles || []).slice(0, 10)) {
      nameResults.push(...searchMoviesByName(name, 3));
    }
    const seen = new Set(scored.map(m => m.name));
    for (const item of nameResults) {
      if (seen.has(item.name)) continue;
      // Country filter (match primary production country only)
      if (regionVariants.length > 0) {
        const primary = getPrimaryCountry(item.country || '');
        if (!regionVariants.some(v => primary.includes(v.toLowerCase()))) continue;
      }
      seen.add(item.name);
      scored.push({ ...item, _score: 0, _matchedKws: [] });
    }

    if (scored.length === 0) return res.json({ parsed, results: [] });

    // Normalize scores to 50-95 range
    const maxScore = scored[0]._score || 1;
    for (const m of scored) {
      m._score = Math.round(50 + (m._score / maxScore) * 45);
    }

    // AND logic: require all original keywords matched, progressively relax if not enough
    // When rule-extracted region exists, only use rule-extracted genre keywords (avoid LLM-expanded words making AND too loose)
    const andSource = ruleRegion ? ruleTypeKeywords : finalKeywords;
    const strictKeywords = andSource.map(t => t.toLowerCase().trim()).filter(Boolean);
    let searchExpanded = false;
    if (strictKeywords.length > 1) {
      const strict = filterByStrictKeywords(scored, strictKeywords, SEARCH.AND_MIN_RESULTS);
      scored = strict.results;
      searchExpanded = strict.relaxed;
    }

    // When user explicitly specifies region, hard-filter primary production country (rule-extracted region has highest priority)
    if (ruleRegion && regionVariants.length > 0) {
      const regionFiltered = scored.filter(m => {
        const primary = getPrimaryCountry(m.country || '');
        return regionVariants.some(v => primary.includes(v.toLowerCase()));
      });
      // Only filter if region has results, otherwise keep all (avoid zero results)
      if (regionFiltered.length >= 3) {
        scored = regionFiltered;
      }
    }

    const candidates = scored;

    // 3. Final selection (rich context for LLM, compact candidates to reduce tokens)
    const topN = candidates.slice(0, SEARCH.LLM_SELECT_TOP);

    const moviesDesc = topN.map((m, i) => {
      const tags = (m.tags || []).slice(0, 4).join('/');
      const rating = m.rating ? `${m.rating}/10` : '';
      return `${i + 1}. ${m.name}(${m.year || '?'}${m.country ? ',' + m.country : ''}) [${tags}] ${rating}`;
    }).join('\n');

    const regionHint = regionVariants.length > 0 ? `\n⚠️ User specified region: ${regionRaw}. Only recommend titles from this region. Exclude all other regions even if high quality.` : '';

    // Structured user context
    const moviePriority = (parsed.keywords || []).slice(0, 3).join(', ');
    const movieLikedSummary = (liked_movies || []).slice(0, 3).map(m => m.name + '(' + (m.tags || []).slice(0, 3).join('/') + ')').join(', ');
    const movieDislikedSummary = (disliked_movies || []).slice(0, 3).map(m => m.name).join(', ');
    const movieHardExcludes = movieExcludes.length > 0 ? movieExcludes.join(', ') : 'None';

    const movieUserContext = `
[User Profile]
- Top priority: ${moviePriority || parsed.summary || query}
- Hard excludes: ${movieHardExcludes}
${movieLikedSummary ? '- Likes: ' + movieLikedSummary : ''}
${movieDislikedSummary ? '- Dislikes: ' + movieDislikedSummary : ''}`;

    const selectPrompt = [{
      role: 'system',
      content: `You are a movie/TV recommendation assistant. Select the 8-12 best matches from candidates.

Need: ${parsed.summary} | Original: ${query}
${regionHint}
${movieUserContext}
${tagContext ? 'Tags: ' + tagContext : ''}

Candidates (sorted by match score):
${moviesDesc}

Output JSON: { "selected": [{"index":1,"reason":"Specific match reason (under 40 chars)"}] }
- reason must reference specific tags/features, no generic praise
- Find the best fit for core needs, not the most famous
- Never select items matching hard excludes
- At least 40% should be lesser-known high-rated titles`
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
      // Append non-AI-selected candidates for "load more"
      for (const m of candidates) {
        if (selectedIds.has(m.tmdb_id)) continue;
        const mk = (m._matchedKws || []).filter(Boolean);
        const algoScore = Math.round(m._score || 0);
        results.push({
          ...m,
          ai_selected: false,
          match_reason: 'Related',
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
        match_reason: 'Algorithm pick',
        match_score: Math.round(m._score || 0),
        matched_keywords: (m._matchedKws || []).filter(Boolean).length > 0 ? m._matchedKws : searchTags.slice(0, 3),
        match_details: { score: Math.round(m._score || 0), matched_keywords: m._matchedKws || [], rating: m.rating || 0, vote_count: m.vote_count || 0 }
      }));
    }

    // Final sort by match score
    results.sort((a, b) => (b.match_score || 0) - (a.match_score || 0));

    const result = { parsed, results, search_expanded: searchExpanded };
    setCache(cacheKey, result);
    res.json(result);

  } catch (e) {
    console.error('[movie-search] error:', e);
    res.status(500).json({ error: 'Search failed. Please try again later.' });
  }
});

// ── Start ──

async function start() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`  ◈ JustRight · http://localhost:${PORT}`);
  });
}

start().catch(e => {
  console.error('Failed to start:', e);
  process.exit(1);
});

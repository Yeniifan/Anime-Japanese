#!/usr/bin/env node
/**
 * add_episode.js
 * 將一集（或多集）的字幕加入資料庫。支援 Netflix CC SRT（JP + EN）格式。
 *
 * 用法：
 *   node scripts/add_episode.js S1E07          # 單集
 *   node scripts/add_episode.js S1E12-24       # 範圍（E12 到 E24）
 *   node scripts/add_episode.js S1E07 S1E08    # 多個 ID
 *   node scripts/add_episode.js subtitles/S1E05.ja.srt subtitles/S1E05.en.srt --title "..."
 *
 * 字幕來源：kitsunekko.net（JP）、Netflix（EN）
 * 自動從 data/episode-titles.json 查標題。輸出：data/epXX.json，並更新 data/episodes.json。
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── 1. 解析命令列 ──────────────────────────────────────────
const rawArgs = process.argv.slice(2);
const flags = {};
const positionals = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i].startsWith('--') && i + 1 < rawArgs.length) {
    flags[rawArgs[i].slice(2)] = rawArgs[++i];
  } else {
    positionals.push(rawArgs[i]);
  }
}
const titleOverride = flags.title || null;

if (!positionals[0]) {
  console.error('Usage: node scripts/add_episode.js <S1E07 | S1E12-24 | jp.srt> [--title "タイトル"]');
  process.exit(1);
}

// ── 1b. 範圍展開 S1E12-24 → ['S1E12','S1E13',...,'S1E24'] ──
function expandEpIds(args) {
  const ids = [];
  for (const arg of args) {
    const range = arg.match(/^(S\.?0*(\d+)[E×x\.]0*(\d+))-0*(\d+)$/i);
    if (range) {
      const season  = parseInt(range[2]);
      const epStart = parseInt(range[3]);
      const epEnd   = parseInt(range[4]);
      for (let e = epStart; e <= epEnd; e++) {
        ids.push(`S${season}E${e.toString().padStart(2, '0')}`);
      }
    } else {
      ids.push(arg);
    }
  }
  return ids;
}

// 複数 ID モード：ID が 2 個以上、または範囲表記のとき
const expandedPositionals = expandEpIds(positionals);
const isMulti = expandedPositionals.length > 1 &&
  expandedPositionals.every(a => /^S\.?0*\d+[E×x\.]0*\d+$/i.test(a));

if (isMulti) {
  let ok = 0, fail = 0;
  for (const epId of expandedPositionals) {
    console.log(`\n${'─'.repeat(40)}\n▶ ${epId}`);
    try {
      execSync(`node "${__filename}" "${epId}"`, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
      ok++;
    } catch {
      console.error(`❌ ${epId} failed`);
      fail++;
    }
  }
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`✅ ${ok} succeeded  ❌ ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

// ── 2. 集數 ID 入力 or ファイルパス入力を判定 ────────────
const rootDir      = path.join(__dirname, '..');
const subtitlesDir = path.join(rootDir, 'subtitles');

function findSubtitleFiles(epInput) {
  const m = epInput.match(/S\.?0*(\d+)[E×x\.]0*(\d+)/i);
  if (!m) return null;
  const season  = parseInt(m[1]);
  const episode = parseInt(m[2]);
  // S01E06 形式にも S1E6 形式にも対応する正規表現
  const idRegex = new RegExp(`S0*${season}[E×x\\.]0*${episode}(?!\\d)`, 'i');

  const files = fs.readdirSync(subtitlesDir);
  const jpFile = files.find(f => idRegex.test(f) && /\.ja[\.\[]/.test(f));
  const enFile = files.find(f => idRegex.test(f) && /\.en\./.test(f));
  return { jpFile, enFile, season, episode };
}

let jpPath, enPath;
const isEpId = /^S\.?0*\d+[E×x\.]0*\d+$/i.test(positionals[0]);

if (isEpId) {
  const result = findSubtitleFiles(positionals[0]);
  if (!result) {
    console.error(`Cannot parse episode ID: ${positionals[0]}`);
    process.exit(1);
  }
  if (!result.jpFile && !result.enFile) {
    console.error(`❌ 資料不存在：subtitles/ に ${positionals[0]} の JP・EN 字幕が見つかりません`);
    process.exit(1);
  }
  if (!result.jpFile) {
    console.error(`❌ 資料不存在：${positionals[0]} の JP 字幕が見つかりません`);
    process.exit(1);
  }
  if (!result.enFile) {
    console.error(`❌ 資料不存在：${positionals[0]} の EN 字幕が見つかりません`);
    process.exit(1);
  }
  jpPath = path.join(subtitlesDir, result.jpFile);
  enPath = path.join(subtitlesDir, result.enFile);
  console.log(`📁 JP: ${result.jpFile}`);
  console.log(`📁 EN: ${result.enFile}`);
} else {
  jpPath = positionals[0];
  enPath = positionals[1] && positionals[1].toLowerCase().endsWith('.srt')
    ? positionals[1] : null;
  if (!fs.existsSync(jpPath)) { console.error(`File not found: ${jpPath}`); process.exit(1); }
  if (enPath && !fs.existsSync(enPath)) { console.error(`EN SRT not found: ${enPath}`); process.exit(1); }
}

const isSrt = jpPath.toLowerCase().endsWith('.srt');

// ── 2. 從檔名解析 Season / Episode ────────────────────────
const basename = path.basename(jpPath);
const seMatch  = basename.match(/S\.?0*(\d+)[E×x\.]0*(\d+)/i);
if (!seMatch) {
  console.error('Cannot parse S/E from filename. Expected "S01E05" or "S.1 E.05" in filename.');
  process.exit(1);
}
const season  = parseInt(seMatch[1], 10);
const episode = parseInt(seMatch[2], 10);
const epId    = `S${season}E${episode.toString().padStart(2, '0')}`;
const epKey   = `ep${episode.toString().padStart(2, '0')}`;
const label   = `S${season} · E${episode.toString().padStart(2, '0')}`;

// ── 3. 標題解析 ────────────────────────────────────────────
// Lookup from data/episode-titles.json
function lookupTitle(epId) {
  const titlesPath = path.join(rootDir, 'data', 'episode-titles.json');
  if (!fs.existsSync(titlesPath)) return null;
  const db = JSON.parse(fs.readFileSync(titlesPath, 'utf8'));
  return db[epId] || null; // { ja, en } or null
}

function parseTitleFromTxt(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').slice(0, 20);
  for (const line of lines) {
    const m = line.match(/^Title:\s*(.+)/i);
    if (m) {
      const raw = m[1].trim();
      const parenMatch = raw.match(/^(.+?)\s*[（(]([^)）]+)[)）]\s*$/);
      if (parenMatch) return { en: parenMatch[1].trim(), ja: parenMatch[2].trim() };
      return { en: raw, ja: '' };
    }
  }
  return { en: '', ja: '' };
}

// SRT ファイル名から日本語タイトルを抽出
// 例: "SPY×FAMILY.S01E05.【MISSION：5】.合否の行方.WEBRip..."
function parseTitleFromSrtName(filePath) {
  const name = path.basename(filePath);
  // 【...】.タイトル.WEBRip パターン
  const m = name.match(/】\.([^.]+)\./);
  if (m) return { ja: m[1].trim(), en: '' };
  return { ja: '', en: '' };
}

let titleEn, titleJa;
if (titleOverride) {
  // --title 指定あり → そのまま使う
  titleJa = titleOverride; titleEn = '';
} else {
  // 1) Try lookup table first
  const looked = lookupTitle(epId);
  if (looked) {
    titleJa = looked.ja; titleEn = looked.en;
  } else if (isSrt) {
    // 2) Try to extract from SRT filename
    ({ ja: titleJa, en: titleEn } = parseTitleFromSrtName(jpPath));
    if (!titleJa) console.warn(`⚠  Cannot extract title from filename. Use --title "タイトル" to set it.`);
  } else {
    ({ en: titleEn, ja: titleJa } = parseTitleFromTxt(jpPath));
  }
}
const titleStr = titleJa && titleEn ? `${titleJa} / ${titleEn}`
               : titleJa || titleEn || epId;

console.log(`📺 ${epId}: ${titleStr}`);

// ── 4. 字幕ファイルを canonical 名で subtitles/ に保存 ────
fs.mkdirSync(subtitlesDir, { recursive: true });

function saveSubtitle(src, dest) {
  if (path.resolve(src) === path.resolve(dest)) return;
  try {
    fs.writeFileSync(dest, fs.readFileSync(src));
    console.log(`📄 Saved → subtitles/${path.basename(dest)}`);
    fs.unlinkSync(src);
    console.log(`🗑  Removed ${path.basename(src)}`);
  } catch (e) {
    if (e.code === 'EACCES') {
      console.warn(`⚠  subtitles/${path.basename(dest)} already exists (skipped)`);
    } else throw e;
  }
}

if (isSrt) {
  saveSubtitle(jpPath, path.join(subtitlesDir, `${epId}.ja.srt`));
  if (enPath) saveSubtitle(enPath, path.join(subtitlesDir, `${epId}.en.srt`));
} else {
  saveSubtitle(jpPath, path.join(subtitlesDir, `${epId}.txt`));
}

// ── 5. 執行 process.js ────────────────────────────────────
const outputPath = path.join(rootDir, 'data', `${epKey}.json`);
const processJs  = path.join(__dirname, 'process.js');

let cmd = `node "${processJs}" "${jpPath}" "${outputPath}" --episode "${epId}" --title "${titleStr}"`;
if (isSrt && enPath) cmd += ` --en-srt "${enPath}"`;

console.log(`⚙️  Running process.js → ${outputPath}`);
try {
  execSync(cmd, { stdio: 'inherit', cwd: rootDir });
} catch (e) {
  console.error('process.js failed');
  process.exit(1);
}

// ── 6. 更新 data/episodes.json ────────────────────────────
const episodesPath = path.join(rootDir, 'data', 'episodes.json');
let episodes = [];
if (fs.existsSync(episodesPath)) {
  episodes = JSON.parse(fs.readFileSync(episodesPath, 'utf8'))
    .filter(e => !Array.isArray(e));  // strip any stray _v array-property
}

const existing = episodes.findIndex(e => e.id === epId);
const entry = { id: epId, key: epKey, label, titleJa, titleEn, file: `data/${epKey}.json` };
if (existing >= 0) {
  episodes[existing] = entry;
  console.log(`🔄 Updated existing entry for ${epId}`);
} else {
  episodes.push(entry);
  episodes.sort((a, b) => a.id.localeCompare(b.id));
  console.log(`✅ Added ${epId} to episodes.json (total: ${episodes.length})`);
}

fs.writeFileSync(episodesPath, JSON.stringify(episodes, null, 2), 'utf8');
console.log(`📋 episodes.json saved.`);

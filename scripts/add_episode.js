#!/usr/bin/env node
/**
 * add_episode.js
 * 將一集的字幕加入資料庫。支援 txt（雙語）和 SRT（JP + EN）格式。
 *
 * 用法：
 *   # 雙語 txt（transcribedanimescripts 格式）
 *   node scripts/add_episode.js subtitles/S1E02.txt
 *
 *   # 雙語 SRT（JP SRT + EN SRT）
 *   node scripts/add_episode.js subtitles/S1E05.ja.srt subtitles/S1E05.en.srt
 *
 *   # 僅 JP SRT（無英語）
 *   node scripts/add_episode.js subtitles/S1E05.ja.srt
 *
 * 自動從檔名解析 S/E 編號。輸出：data/epXX.json，並更新 data/episodes.json。
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── 1. 解析命令列 ──────────────────────────────────────────
// ── フラグ解析 ─────────────────────────────────────────────
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

const jpPath = positionals[0];
const enPath = positionals[1] && positionals[1].toLowerCase().endsWith('.srt')
  ? positionals[1] : null;
const titleOverride = flags.title || null;

if (!jpPath) {
  console.error('Usage: node scripts/add_episode.js <jp.srt|input.txt> [en.srt] [--title "タイトル"]');
  process.exit(1);
}
if (!fs.existsSync(jpPath)) {
  console.error(`File not found: ${jpPath}`);
  process.exit(1);
}
if (enPath && !fs.existsSync(enPath)) {
  console.error(`EN SRT not found: ${enPath}`);
  process.exit(1);
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
} else if (isSrt) {
  ({ ja: titleJa, en: titleEn } = parseTitleFromSrtName(jpPath));
  if (!titleJa) console.warn(`⚠  Cannot extract title from filename. Use --title "タイトル" to set it.`);
} else {
  ({ en: titleEn, ja: titleJa } = parseTitleFromTxt(jpPath));
}
const titleStr = titleJa && titleEn ? `${titleJa} / ${titleEn}`
               : titleJa || titleEn || epId;

console.log(`📺 ${epId}: ${titleStr}`);

// ── 4. 字幕ファイルを canonical 名で subtitles/ に保存 ────
const rootDir      = path.join(__dirname, '..');
const subtitlesDir = path.join(rootDir, 'subtitles');
fs.mkdirSync(subtitlesDir, { recursive: true });

function saveSubtitle(src, dest) {
  if (path.resolve(src) === path.resolve(dest)) return;
  try {
    fs.writeFileSync(dest, fs.readFileSync(src));
    console.log(`📄 Saved → subtitles/${path.basename(dest)}`);
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

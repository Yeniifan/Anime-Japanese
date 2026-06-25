#!/usr/bin/env node
/**
 * add_episode.js
 * 將一集的雙語 txt 字幕加入資料庫。
 *
 * 用法：
 *   node scripts/add_episode.js <input.txt>
 *
 * 範例：
 *   node scripts/add_episode.js "SPY×FAMILY _ S.1 E.02 (JPN _ ENG).txt"
 *
 * 自動從檔名解析 S/E 編號，從 txt 開頭解析標題。
 * 輸出：data/epXX.json，並更新 data/episodes.json。
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── 1. 解析命令列 ──────────────────────────────────────────
const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/add_episode.js <input.txt>');
  process.exit(1);
}
if (!fs.existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

// ── 2. 從檔名解析 Season / Episode ────────────────────────
const basename = path.basename(inputPath);
const seMatch  = basename.match(/S\.?(\d+)\s*E\.?(\d+)/i);
if (!seMatch) {
  console.error('Cannot parse S/E from filename. Expected format: "...S.1 E.02..."');
  process.exit(1);
}
const season  = parseInt(seMatch[1], 10);
const episode = parseInt(seMatch[2], 10);
const epId    = `S${season}E${episode.toString().padStart(2, '0')}`;
const epKey   = `ep${episode.toString().padStart(2, '0')}`;   // ep02
const label   = `S${season} · E${episode.toString().padStart(2, '0')}`;

// ── 3. 從 txt 開頭解析標題 ────────────────────────────────
function parseTitleFromTxt(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').slice(0, 20);
  for (const line of lines) {
    const m = line.match(/^Title:\s*(.+)/i);
    if (m) {
      const raw = m[1].trim();
      // "Secure a Wife (妻役を確保せよ)" → en + ja separate
      const parenMatch = raw.match(/^(.+?)\s*[（(]([^)）]+)[)）]\s*$/);
      if (parenMatch) {
        return { en: parenMatch[1].trim(), ja: parenMatch[2].trim() };
      }
      return { en: raw, ja: '' };
    }
  }
  return { en: '', ja: '' };
}
const { en: titleEn, ja: titleJa } = parseTitleFromTxt(inputPath);
const titleStr = titleJa ? `${titleJa} / ${titleEn}` : titleEn;

console.log(`📺 ${epId}: ${titleStr}`);

// ── 4. 執行 process.js ────────────────────────────────────
const rootDir    = path.join(__dirname, '..');
const outputPath = path.join(rootDir, 'data', `${epKey}.json`);
const processJs  = path.join(__dirname, 'process.js');

console.log(`⚙️  Running process.js → ${outputPath}`);
try {
  execSync(
    `node "${processJs}" "${inputPath}" "${outputPath}" --episode "${epId}" --title "${titleStr}"`,
    { stdio: 'inherit', cwd: rootDir }
  );
} catch (e) {
  console.error('process.js failed');
  process.exit(1);
}

// ── 5. 更新 data/episodes.json ────────────────────────────
const episodesPath = path.join(rootDir, 'data', 'episodes.json');
let episodes = [];
if (fs.existsSync(episodesPath)) {
  episodes = JSON.parse(fs.readFileSync(episodesPath, 'utf8'));
}

// 若同集已存在則更新，否則新增
const existing = episodes.findIndex(e => e.id === epId);
const entry = {
  id:      epId,
  key:     epKey,
  label,
  titleJa,
  titleEn,
  file:    `data/${epKey}.json`
};
if (existing >= 0) {
  episodes[existing] = entry;
  console.log(`🔄 Updated existing entry for ${epId}`);
} else {
  episodes.push(entry);
  // 依 season/episode 排序
  episodes.sort((a, b) => a.id.localeCompare(b.id));
  console.log(`✅ Added ${epId} to episodes.json (total: ${episodes.length})`);
}

fs.writeFileSync(episodesPath, JSON.stringify(episodes, null, 2), 'utf8');
console.log(`📋 episodes.json saved.`);

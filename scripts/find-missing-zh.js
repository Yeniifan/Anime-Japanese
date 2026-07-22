#!/usr/bin/env node
/**
 * find-missing-zh.js
 * 掃描所有 data/epXX.json，找出缺少中文定義（zh: []）的詞彙。
 * 輸出 data/missing-zh.json，按跨集出現頻率排序。
 *
 * 用法：node scripts/find-missing-zh.js
 */

const fs   = require('fs');
const path = require('path');

const dataDir  = path.join(__dirname, '../data');
const outPath  = path.join(dataDir, 'missing-zh.json');

// ── 掃描所有 epXX.json ────────────────────────────────────
const epFiles = fs.readdirSync(dataDir)
  .filter(f => /^ep\d+\.json$/.test(f))
  .sort();

if (!epFiles.length) {
  console.error('❌ data/ 資料夾中找不到 epXX.json');
  process.exit(1);
}

// word → { reading, pos, zh, en, totalCount, episodes }
const wordMap = {};

for (const file of epFiles) {
  const epId = file.replace('.json', '');
  const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
  for (const v of (data.vocabulary || [])) {
    if (v.zh && v.zh.length > 0) continue;   // 已有中文，跳過
    if (!wordMap[v.word]) {
      wordMap[v.word] = {
        word:       v.word,
        reading:    v.reading || '',
        pos:        v.pos || '',
        en:         v.en  || [],
        totalCount: 0,
        episodes:   [],
      };
    }
    wordMap[v.word].totalCount += v.count;
    wordMap[v.word].episodes.push(`${data.episode}(×${v.count})`);
  }
}

// 按總出現次數排序
const missing = Object.values(wordMap)
  .sort((a, b) => b.totalCount - a.totalCount);

fs.writeFileSync(outPath, JSON.stringify(missing, null, 2), 'utf8');

console.log(`✅ 缺少中文定義的詞：${missing.length} 個`);
console.log(`📄 輸出 → data/missing-zh.json`);
console.log('\n前 30 高頻缺失詞：');
missing.slice(0, 30).forEach((w, i) => {
  const en = w.en.length ? `  [${w.en.slice(0,2).join(', ')}]` : '';
  console.log(`  ${String(i+1).padStart(2)}. ${w.word}（${w.reading}）×${w.totalCount}${en}`);
});

#!/usr/bin/env node
/**
 * generate-zh-defs.js
 * 讀取 data/missing-zh.json，批次呼叫 Claude API 生成中文定義，
 * 輸出 / 更新 data/dict-zh-supplement.json。
 *
 * 用法：
 *   ANTHROPIC_API_KEY=sk-... node scripts/generate-zh-defs.js
 *   ANTHROPIC_API_KEY=sk-... node scripts/generate-zh-defs.js --limit 200   # 只處理前 N 個
 *   ANTHROPIC_API_KEY=sk-... node scripts/generate-zh-defs.js --resume      # 跳過已有定義的詞
 *
 * 輸出格式（dict-zh-supplement.json）：
 *   { "言う": { "zh": ["說", "講"] }, ... }
 */

const fs      = require('fs');
const path    = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// ── CLI 參數 ─────────────────────────────────────────────
const args    = process.argv.slice(2);
const limit   = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i+1]) : Infinity; })();
const resume  = args.includes('--resume');
const BATCH   = 30;   // 每次 API 呼叫處理幾個詞

// ── 路徑 ──────────────────────────────────────────────────
const dataDir    = path.join(__dirname, '../data');
const missingPath = path.join(dataDir, 'missing-zh.json');
const suppPath   = path.join(dataDir, 'dict-zh-supplement.json');

if (!fs.existsSync(missingPath)) {
  console.error('❌ data/missing-zh.json 不存在，請先執行 find-missing-zh.js');
  process.exit(1);
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('❌ 請設定環境變數 ANTHROPIC_API_KEY');
  process.exit(1);
}

// ── 載入已有 supplement（resume 模式用）────────────────────
let supplement = {};
if (fs.existsSync(suppPath)) {
  supplement = JSON.parse(fs.readFileSync(suppPath, 'utf8'));
}

// ── 載入缺失詞清單 ────────────────────────────────────────
let missing = JSON.parse(fs.readFileSync(missingPath, 'utf8'));

if (resume) {
  missing = missing.filter(w => !supplement[w.word]);
  console.log(`⏭  resume 模式：跳過已有定義，剩 ${missing.length} 個詞`);
}
if (limit < Infinity) {
  missing = missing.slice(0, limit);
  console.log(`🔢 只處理前 ${limit} 個詞`);
}

console.log(`📋 共 ${missing.length} 個詞，每批 ${BATCH} 個`);

// ── Claude 客戶端 ─────────────────────────────────────────
const client = new Anthropic({ apiKey });

// ── 批次處理 ──────────────────────────────────────────────
const SYSTEM_PROMPT = `你是一個日中辭典編纂助手，專門為台灣/香港中文母語者學習日語設計。
對於每個提供的日語詞彙，給出簡潔的繁體中文定義（1–3個，用「/」分隔）。

規則：
- 用繁體中文
- 每個定義 2–6 字，精準扼要
- 動詞用「～」開頭（例：「說話」不要寫「說話的動作」）
- 不要解釋、不要例句、只給定義
- 擬聲詞/感嘆詞給出意思或描述（例：「嘆氣聲」「驚訝聲」）
- 輸出純 JSON，格式：{"詞1":["定義A","定義B"],"詞2":["定義"]}`;

async function processBatch(batch) {
  const input = batch.map(w => {
    const en = w.en.length ? ` [英：${w.en.slice(0,2).join(', ')}]` : '';
    return `${w.word}（${w.reading}，${w.pos}）${en}`;
  }).join('\n');

  const resp = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: `請為以下日語詞彙提供繁體中文定義：\n\n${input}` }],
    system: SYSTEM_PROMPT,
  });

  const text = resp.content[0].text.trim();
  // 取出 JSON（可能被 markdown 包裹）
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`無法解析回應：${text.slice(0,200)}`);
  return JSON.parse(jsonMatch[0]);
}

// ── 主流程 ────────────────────────────────────────────────
(async () => {
  let done = 0, errors = 0;

  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const batchNum = Math.floor(i / BATCH) + 1;
    const totalBatches = Math.ceil(missing.length / BATCH);
    process.stdout.write(`批次 ${batchNum}/${totalBatches}（${batch[0].word}…）`);

    try {
      const result = await processBatch(batch);

      for (const [word, zh] of Object.entries(result)) {
        if (Array.isArray(zh) && zh.length) {
          supplement[word] = { zh };
          done++;
        }
      }

      // 每批結束後即時寫入，避免中斷遺失
      fs.writeFileSync(suppPath, JSON.stringify(supplement, null, 2), 'utf8');
      console.log(` ✓ +${Object.keys(result).length}`);
    } catch (e) {
      console.log(` ❌ ${e.message}`);
      errors++;
    }

    // 避免 rate limit（Haiku 很快，小睡即可）
    if (i + BATCH < missing.length) await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n✅ 完成：${done} 個詞已定義，${errors} 個批次失敗`);
  console.log(`📄 輸出 → data/dict-zh-supplement.json（共 ${Object.keys(supplement).length} 詞）`);
})();

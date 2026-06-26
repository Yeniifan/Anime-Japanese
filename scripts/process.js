#!/usr/bin/env node
/**
 * process.js
 * Parse a bilingual SPY×FAMILY txt file and annotate with kuromoji furigana.
 * Usage: node process.js <input.txt> [output.json]
 */

const fs = require('fs');
const path = require('path');
const kuromoji = require('kuromoji');

// ─────────────────────────────────────────────────────────────
// 1. Parser
// ─────────────────────────────────────────────────────────────

function containsJapanese(text) {
  return /[぀-鿿＀-￯]/.test(text);
}

function hasKanji(text) {
  return /[一-鿿]/.test(text);
}

// 純假名（平假名 or 片假名）
function isKana(text) {
  return /^[ぁ-ゞァ-ヶーｦ-ﾟ]+$/.test(text);
}

function parseTxt(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  const rawLines = content.split('\n');

  const turns = [];
  let current = { character: null, jp: [], en: [] };
  let headerDone = false;

  for (const rawLine of rawLines) {
    const stripped = rawLine.trim();

    // Skip header section (everything before the ─── separator)
    if (!headerDone) {
      if (/^_{5,}/.test(stripped)) headerDone = true;
      continue;
    }

    if (!stripped) continue;

    // Skip stage directions entirely
    if (stripped.startsWith('[')) continue;

    if (containsJapanese(stripped)) {
      // Japanese dialogue line
      current.jp.push(stripped);
    } else if (rawLine.startsWith('\t') && stripped && !stripped.startsWith('[')) {
      // Tab-indented English = character name → flush and start new turn
      if (current.jp.length > 0 || current.en.length > 0) {
        turns.push({ ...current });
      }
      current = { character: stripped, jp: [], en: [] };
    } else if (stripped && !stripped.startsWith('[')) {
      // Non-indented non-Japanese = English translation
      current.en.push(stripped);
    }
  }

  // Flush last turn
  if (current.jp.length > 0 || current.en.length > 0) {
    turns.push(current);
  }

  // Flatten each turn into individual JP+EN line pairs
  const items = [];
  let id = 0;

  for (const turn of turns) {
    const len = Math.max(turn.jp.length, turn.en.length);
    for (let i = 0; i < len; i++) {
      const jp = (turn.jp[i] || '').trim();
      const en = (turn.en[i] || '').trim();
      if (!jp && !en) continue;
      items.push({ id: id++, character: turn.character || '', jp, en });
    }
  }

  return items;
}

// ─────────────────────────────────────────────────────────────
// 1b. SRT Parser
// ─────────────────────────────────────────────────────────────

function srtTimeToMs(t) {
  // "00:00:01,877" or "00:00:01.877"
  const norm = t.replace(',', '.');
  const [hms, ms] = norm.split('.');
  const [h, m, s] = hms.split(':').map(Number);
  return (h * 3600 + m * 60 + s) * 1000 + Number(ms || 0);
}

function parseSrtBlocks(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const blocks = [];
  for (const chunk of content.split(/\n\n+/)) {
    const lines = chunk.trim().split('\n');
    if (lines.length < 3) continue;
    const timeLine = lines.find(l => l.includes('-->'));
    if (!timeLine) continue;
    const m = timeLine.match(/(\S+)\s*-->\s*(\S+)/);
    if (!m) continue;
    blocks.push({
      startMs: srtTimeToMs(m[1]),
      endMs:   srtTimeToMs(m[2]),
      // Strip bidi / invisible control chars Netflix adds (‎ LRM etc.)
      lines:   lines.slice(lines.indexOf(timeLine) + 1)
                    .map(l => l.replace(/[‎‏‪-‮⁦-⁩]/g, ''))
                    .filter(Boolean),
    });
  }
  return blocks;
}

// キャラ名を正規化（全角ラテン → ASCII、「・フォージャー」省略）
function normalizeCharName(name) {
  return name
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/・フォージャー$/, '')
    .trim();
}

function parseSrt(jpPath, enPath) {
  const jpBlocks = parseSrtBlocks(jpPath);
  const enBlocks = enPath ? parseSrtBlocks(enPath) : [];

  // EN: join multi-line, strip leading dashes
  const enEntries = enBlocks.map(b => ({
    startMs: b.startMs,
    endMs:   b.endMs,
    text:    b.lines.map(l => l.replace(/^-\s*/, '').trim()).join(' '),
  }));

  // タイムスタンプ重複量で JP→EN を紐付け
  function findEnText(jpStart, jpEnd) {
    let best = null, bestOverlap = 0;
    for (const e of enEntries) {
      const overlap = Math.max(0, Math.min(jpEnd, e.endMs) - Math.max(jpStart, e.startMs));
      if (overlap > bestOverlap) { bestOverlap = overlap; best = e; }
    }
    // 重複なければ最近接（5秒以内）
    if (!best) {
      let minDist = Infinity;
      for (const e of enEntries) {
        const dist = Math.abs(e.startMs - jpStart);
        if (dist < minDist && dist < 5000) { minDist = dist; best = e; }
      }
    }
    return best ? best.text : '';
  }

  const items = [];
  let id = 0;

  for (const block of jpBlocks) {
    const en = findEnText(block.startMs, block.endMs);
    const lines = block.lines;

    // 行ごとに処理（1ブロックに複数キャラの場合あり）
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      // 全角括弧のみでキャラ名を判定（内側の半角括弧は無視）
      // 全行が（...）だけ → キャラ名行、次行が台詞
      const soloCharMatch = line.match(/^（([^）]+)）$/);
      if (soloCharMatch) {
        const character = normalizeCharName(soloCharMatch[1]);
        const jp = (lines[i + 1] || '').trim();
        if (jp && containsJapanese(jp)) {
          items.push({ id: id++, character, jp, en });
        }
        i += 2;
        continue;
      }
      // （キャラ）台詞 → 同行
      const inlineCharMatch = line.match(/^（([^）]{1,30})）(.+)$/);
      if (inlineCharMatch) {
        const character = normalizeCharName(inlineCharMatch[1]);
        const jp = inlineCharMatch[2].trim();
        if (jp && containsJapanese(jp)) {
          items.push({ id: id++, character, jp, en });
        }
        i++;
        continue;
      }
      // 効果音行（日本語なし）→ スキップ
      if (!containsJapanese(line)) { i++; continue; }
      // 台詞のみ（キャラ名なし）- 連続する plain 行はひとつに統合
      const plainParts = [line];
      i++;
      while (i < lines.length) {
        const next = lines[i].trim();
        if (/^（/.test(next) || !next) break;
        if (containsJapanese(next)) plainParts.push(next);
        i++;
      }
      items.push({ id: id++, character: '', jp: plainParts.join(''), en });
    }
  }

  return items;
}

// ─────────────────────────────────────────────────────────────
// 2. Annotator
// ─────────────────────────────────────────────────────────────

function katakanaToHiragana(str) {
  return (str || '').replace(/[ァ-ヶ]/g,
    c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// POS tags we treat as "content words" worth learning
// 感動詞（感嘆詞）と状声詞（擬音語）を除く
const VOCAB_POS = new Set(['名詞', '動詞', '形容詞', '副詞']);

// kanjium がホモフォンで誤った読みを返す語の修正（必要に応じて追加）
const READING_FIX = {
  '平和': 'へいわ',  // kanjium は麻雀用語ピンフを返す
};

// 名詞の中で除外するサブカテゴリ
const EXCLUDE_POS_DETAIL = new Set(['数', '接尾', '非自立', '代名詞']);

function shouldAddToVocab(pos, posDetail, base, dict) {
  if (!VOCAB_POS.has(pos)) return false;

  // 名詞サブカテゴリ除外（数・接尾・非自立・代名詞）
  if (pos === '名詞' && EXCLUDE_POS_DETAIL.has(posDetail)) return false;

  // 動詞：補助動詞（非自立）は除外、漢字あり or zh定義ある仮名動詞を含む
  if (pos === '動詞') {
    if (posDetail === '非自立') return false;  // いる・てる・くる・もらう 等の補助動詞除外
    if (hasKanji(base) && base.length > 1) return true;
    if (isKana(base) && base.length >= 2) {
      const entry = dict[base];
      return !!(entry && entry.zh && entry.zh.length > 0);  // できる・やる 等
    }
    return false;
  }

  // 漢字語は常に含む（長さ2以上）
  if (hasKanji(base) && base.length > 1) return true;

  // 純仮名語：zh または kanjium の pitch データがあれば含む
  // → 文法語（ない・そう 等）は pitch/zh なしで自然除外される
  if (isKana(base) && base.length >= 2) {
    const entry = dict[base];
    return !!(entry && ((entry.zh && entry.zh.length > 0) || entry.pitch !== null));
  }

  return false;
}

function annotate(lines, tokenizer, dict) {
  const vocabMap = {};

  const annotatedLines = lines.map(line => {
    if (!line.jp) return { ...line, tokens: [] };

    const rawTokens = tokenizer.tokenize(line.jp);

    const tokens = rawTokens.map(t => {
      const surface   = t.surface_form;
      const reading   = katakanaToHiragana(t.reading || surface);
      // basic_form='*' は kuromoji が未知語と判定した場合。surface を辞書形として使う
      const base      = (t.basic_form && t.basic_form !== '*') ? t.basic_form : surface;
      const pos       = t.pos || '';
      const posDetail = t.pos_detail_1 || '';

      // furigana only on tokens that contain kanji
      const furigana = hasKanji(surface) ? reading : null;

      // Vocabulary index
      if (shouldAddToVocab(pos, posDetail, base, dict)) {
        if (!vocabMap[base]) {
          const dictEntry = dict[base] || {};
          // 讀音：dict 優先（辞書形が正確）、既知ホモフォン誤読のみ上書き
          const kuroReading = katakanaToHiragana(t.reading || '');
          const dictReading = dictEntry.reading || '';
          // 優先順序：手動修正 > dict読み（仮名語はdictと一致でOK） > kuromoji表層読み > 語形自体
          // ※ dictReading !== base の条件は漢字語専用（仮名語では読み＝語形が正常）
          const reading = READING_FIX[base]
            || (dictReading && (dictReading !== base || isKana(base)) ? dictReading : kuroReading)
            || base;
          vocabMap[base] = {
            word:     base,
            reading,
            pos,
            posDetail,
            count:    0,
            lineIds:  [],
            zh:       dictEntry.zh    || [],
            en:       dictEntry.en    || [],
            pitch:    dictEntry.pitch ?? null
          };
        }
        vocabMap[base].count++;
        if (!vocabMap[base].lineIds.includes(line.id)) {
          vocabMap[base].lineIds.push(line.id);
        }
      }

      return { surface, reading, base, pos, posDetail, furigana };
    });

    return { ...line, tokens };
  });

  const vocabulary = Object.values(vocabMap)
    .sort((a, b) => b.count - a.count);

  return { lines: annotatedLines, vocabulary };
}

// ─────────────────────────────────────────────────────────────
// 3. Main
// ─────────────────────────────────────────────────────────────

// Parse args: node process.js <input.txt> [output.json] [--episode S1E02] [--title "タイトル / English"]
const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--') && i + 1 < args.length) {
    flags[args[i].slice(2)] = args[++i];
  } else {
    positional.push(args[i]);
  }
}

const inputPath  = positional[0];
const outputPath = positional[1] || path.join(__dirname, '../data/ep01.json');
const dictPath   = path.join(__dirname, '../data/dict.json');
const episodeId  = flags.episode || 'S1E01';
const episodeTitle = flags.title || 'オペレーション〈梟〉 / Operation Strix';
const enSrtPath  = flags['en-srt'] || null;

if (!inputPath) {
  console.error('Usage: node process.js <input.txt|jp.srt> [output.json] [--episode S1E02] [--title "タイトル / English"] [--en-srt en.srt]');
  process.exit(1);
}

// Load dict (optional: gracefully degrade if missing)
let dict = {};
if (fs.existsSync(dictPath)) {
  dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
  console.log(`📚 Dict loaded: ${Object.keys(dict).length} entries`);
} else {
  console.warn('⚠  data/dict.json not found. Run scripts/build_dict.js first.');
}

console.log(`📖 Parsing: ${inputPath}`);
const isSrt = inputPath.toLowerCase().endsWith('.srt');
const lines = isSrt ? parseSrt(inputPath, enSrtPath) : parseTxt(inputPath);
console.log(`   → ${lines.length} dialogue lines${isSrt && enSrtPath ? ' (JP+EN SRT)' : ''}`);

console.log('⏳ Loading kuromoji tokenizer...');
const dicPath = path.join(__dirname, '../node_modules/kuromoji/dict');
kuromoji.builder({ dicPath }).build((err, tokenizer) => {
  if (err) { console.error('kuromoji error:', err); process.exit(1); }

  console.log('🔤 Annotating with furigana...');
  const { lines: annotated, vocabulary } = annotate(lines, tokenizer, dict);

  const output = {
    episode: episodeId,
    title: episodeTitle,
    lines: annotated,
    vocabulary
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output), 'utf8');

  const withZh    = vocabulary.filter(v => v.zh.length > 0).length;
  const withPitch = vocabulary.filter(v => v.pitch !== null).length;

  console.log(`✅ Done → ${outputPath}`);
  console.log(`   Lines: ${annotated.length}  |  Vocabulary: ${vocabulary.length} words`);
  console.log(`   中文: ${withZh}  音調: ${withPitch}`);
  console.log('   Top 10:');
  vocabulary.slice(0, 10).forEach(v => {
    const zh = v.zh.length ? `  ${v.zh[0]}` : '';
    const p  = v.pitch !== null ? ` [${v.pitch}]` : '';
    console.log(`   ${v.word}（${v.reading}）${p}× ${v.count}${zh}`);
  });
});

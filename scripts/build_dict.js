#!/usr/bin/env node
/**
 * build_dict.js
 * 一次性腳本：下載 JMdict（中文定義）＋ kanjium（音調），合併成 data/dict.json
 *
 * 執行：node scripts/build_dict.js
 *
 * 輸出格式：
 * {
 *   "任務": { "zh": ["任務", "職責"], "reading": "にんむ", "pitch": 2 },
 *   ...
 * }
 */

const http  = require('http');
const https = require('https');
const zlib  = require('zlib');
const fs    = require('fs');
const path  = require('path');

const OUTPUT = path.join(__dirname, '../data/dict.json');

// ── HTTP GET（支援 redirect）───────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        return get(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}  ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── JMdict：解析中文定義（逐行，不需 XML 函式庫）──────────
function parseJMdict(xml) {
  const dict  = {};
  const lines = xml.split('\n');
  let kanji = [], readings = [], zhDefs = [], enDefs = [], inEntry = false;

  for (const raw of lines) {
    const l = raw.trim();

    if (l === '<entry>') {
      inEntry = true; kanji = []; readings = []; zhDefs = []; enDefs = [];
      continue;
    }
    if (l === '</entry>') {
      if (inEntry && (zhDefs.length > 0 || enDefs.length > 0)) {
        const zh = [...new Set(zhDefs)].slice(0, 4);
        const en = [...new Set(enDefs)].slice(0, 4);
        const r  = kata2hira(readings[0] || '');
        for (const k  of kanji)    if (!dict[k])  dict[k]  = { zh, en, reading: r };
        for (const rd of readings) if (!dict[rd]) dict[rd] = { zh, en, reading: kata2hira(rd) };
      }
      inEntry = false;
      continue;
    }

    if (!inEntry) continue;

    let m;
    if ((m = l.match(/^<keb>(.*?)<\/keb>$/)))   { kanji.push(m[1]);    continue; }
    if ((m = l.match(/^<reb>(.*?)<\/reb>$/)))   { readings.push(m[1]); continue; }

    if (l.startsWith('<gloss')) {
      // 英文 gloss：無 xml:lang 屬性（JMdict 預設）または lang="eng"
      const isEn = !l.includes('xml:lang=') || l.includes('="eng"');
      // 中文 gloss
      const isZh = l.includes('="chi"') || l.includes('="zhs"') || l.includes('="zht"')
                || l.includes('"zh"')   || l.includes('"zh-');

      if ((m = l.match(/>([^<]+)<\/gloss>/))) {
        const text = m[1].trim();
        if (isZh && /[一-鿿㐀-䶿]/.test(text)) {
          zhDefs.push(text);
        } else if (isEn && text) {
          enDefs.push(text);
        }
      }
    }
  }

  return dict;
}

// ── kanjium：解析音調（tsv 格式：詞\t讀音(片假名)\t音調數字）──
// 音調數字 = downstep position（0 = 平板型，1 = 頭高型，2+ = 中高/尾高）
function parsePitch(tsv) {
  const pitch = {};
  for (const line of tsv.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [word, reading, accentRaw] = parts;
    if (!word || !accentRaw) continue;
    const n = parseInt(accentRaw.trim().split(',')[0], 10); // 取第一個變體
    if (!isNaN(n)) {
      pitch[word.trim()] = { pitch: n, reading: kata2hira(reading.trim()) };
    }
  }
  return pitch;
}

function kata2hira(s) {
  return s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// ── main ──────────────────────────────────────────────────
(async () => {
  // 1. JMdict（多語言版，含中文）
  console.log('⬇  Downloading JMdict (multilingual)…');
  let dict = {};
  try {
    const gz  = await get('http://ftp.edrdg.org/pub/Nihongo/JMdict.gz');
    console.log(`   ${(gz.length / 1e6).toFixed(1)} MB downloaded`);
    const xml = await new Promise((res, rej) =>
      zlib.gunzip(gz, (e, d) => e ? rej(e) : res(d.toString('utf8'))));
    console.log('🔍 Scanning language codes in JMdict…');
    const langCodes = new Set();
    for (const m of xml.matchAll(/xml:lang="([^"]+)"/g)) langCodes.add(m[1]);
    console.log('   Languages found:', [...langCodes].sort().join(', '));
    console.log('🔍 Parsing Chinese entries…');
    dict = parseJMdict(xml);
    console.log(`   ${Object.keys(dict).length} entries with Chinese`);
  } catch (e) {
    console.warn(`⚠  JMdict download failed (${e.message}). Continuing without Chinese.`);
  }

  // 2. kanjium 音調資料
  console.log('⬇  Downloading kanjium pitch accent data…');
  let pitch = {};
  try {
    const buf = await get(
      'https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/accents.txt'
    );
    pitch = parsePitch(buf.toString('utf8'));
    console.log(`   ${Object.keys(pitch).length} pitch accent entries`);
  } catch (e) {
    console.warn(`⚠  Pitch accent download failed (${e.message}). Continuing without pitch.`);
  }

  // 3. 合併：把音調寫入 dict，並新增僅有音調的項目
  for (const [word, { pitch: p, reading: r }] of Object.entries(pitch)) {
    if (dict[word]) {
      dict[word].pitch   = p;
      if (!dict[word].reading || dict[word].reading === word) {
        dict[word].reading = r;
      }
    } else {
      dict[word] = { zh: [], en: [], reading: r || kata2hira(word), pitch: p };
    }
  }

  // 4. 手動補充：zh と en を両方補充（JMdict 収録が薄い語を対象）
  const ZH_SEED = {
    // format: { zh: [...], en: [...] }
    'スパイ':      { zh:['間諜','特工'],          en:['spy','secret agent'] },
    'ミッション':  { zh:['任務','使命'],            en:['mission','assignment'] },
    'エージェント':{ zh:['特工','代理人'],          en:['agent'] },
    'コードネーム':{ zh:['代號'],                  en:['code name'] },
    'バリケード':  { zh:['路障','壁壘'],            en:['barricade'] },
    'いい':        { zh:['好','良好'],              en:['good','fine','okay'] },
    'かわいい':    { zh:['可愛','可愛的'],          en:['cute','adorable'] },
    'すごい':      { zh:['厲害','了不起'],          en:['amazing','incredible'] },
    'やばい':      { zh:['糟糕','太棒了'],          en:['terrible','awesome','crazy'] },
    'ちゃんと':    { zh:['好好地','確實地'],        en:['properly','correctly'] },
    'ほんとう':    { zh:['真的','真正'],            en:['truth','reality'] },
    'ほんと':      { zh:['真的'],                  en:['really','truly'] },
    'すごく':      { zh:['非常','很'],              en:['very','extremely'] },
    'やっぱり':    { zh:['果然','還是'],            en:['as expected','after all'] },
    'ちょっと':    { zh:['一點','稍微'],            en:['a little','a moment','hey'] },
    'たぶん':      { zh:['大概','也許'],            en:['probably','maybe'] },
    'きっと':      { zh:['一定','肯定'],            en:['surely','certainly'] },
    'もしかして':  { zh:['說不定','也許'],          en:['perhaps','by any chance'] },
    'とにかく':    { zh:['總之','反正'],            en:['anyway','at any rate'] },
    'まさか':      { zh:['不可能','怎麼會'],        en:['no way','surely not'] },
    'なぜ':        { zh:['為什麼'],                en:['why','for what reason'] },
    'どうして':    { zh:['為什麼','怎麼'],          en:['why','how'] },
    'ずっと':      { zh:['一直','始終'],            en:['all along','the whole time'] },
    'もっと':      { zh:['更多','更加'],            en:['more','further'] },
    'やはり':      { zh:['果然','還是'],            en:['as expected','after all'] },
    'かなり':      { zh:['相當','頗'],              en:['considerably','quite'] },
    'どう':        { zh:['如何','怎麼樣'],          en:['how','in what way'] },
    'まあ':        { zh:['嗯','算了'],              en:["well","I guess","hmm"] },
    'よく':        { zh:['常常','好好地'],          en:['often','well','frequently'] },
    'もう':        { zh:['已經','再'],              en:['already','anymore','another'] },
    'まだ':        { zh:['還','仍然'],              en:['still','not yet'] },
    'なんか':      { zh:['什麼','總覺得'],          en:['something','somehow','like'] },
    'なんで':      { zh:['為什麼'],                en:['why','how come'] },
    'なるほど':    { zh:['原來如此'],              en:['I see','I understand'] },
    'ほんとに':    { zh:['真的'],                  en:['really','truly'] },
    'ちょうど':    { zh:['剛好','恰好'],            en:['just','exactly','precisely'] },
    'こんな':      { zh:['這樣的'],                en:['this kind of','such'] },
    'そんな':      { zh:['那樣的','那種'],          en:['that kind of','such'] },
    'どんな':      { zh:['什麼樣的'],              en:['what kind of','any'] },
    'あんな':      { zh:['那樣的'],                en:['that kind of (over there)'] },
    'こいつ':      { zh:['這傢伙'],                en:['this guy','this person'] },
    'あいつ':      { zh:['那傢伙'],                en:['that guy','that person'] },
    'ダメ':        { zh:['不行','沒用'],            en:['no good','useless','forbidden'] },
    'ウソ':        { zh:['謊言','謊話'],            en:['lie','falsehood'] },
    'バカ':        { zh:['笨蛋','傻瓜'],            en:['idiot','fool','stupid'] },
    'ガキ':        { zh:['小鬼','臭小子'],          en:['brat','kid'] },
    'みんな':      { zh:['大家','所有人'],          en:['everyone','all'] },
    'できる':      { zh:['能夠','可以'],            en:['can do','be able to','be capable'] },
    'やる':        { zh:['做','幹'],                en:['to do','to give (casual)'] },
    'つらい':      { zh:['痛苦的','辛苦的'],        en:['painful','tough','hard'] },
    'うれしい':    { zh:['高興的','開心的'],        en:['happy','glad','pleased'] },
    'こわい':      { zh:['可怕的','害怕的'],        en:['scary','frightening'] },
    'かなしい':    { zh:['悲傷的','難過的'],        en:['sad','sorrowful'] },
    'おかしい':    { zh:['奇怪的','搞笑的'],        en:['strange','funny','odd'] },
    'むずかしい':  { zh:['困難的'],                en:['difficult','hard'] },
    'やさしい':    { zh:['溫柔的','容易的'],        en:['gentle','kind','easy'] },
    'あぶない':    { zh:['危險的'],                en:['dangerous','risky'] },
    // 名詞
    '子供':        { zh:['孩子','兒童'],            en:['child','children'] },
    '黄昏':        { zh:['黃昏','傍晚'],            en:['dusk','twilight'] },
    '任務':        { zh:['任務','使命'],            en:['mission','duty','task'] },
    '過去':        { zh:['過去','從前'],            en:['past','the old days'] },
    '世界':        { zh:['世界'],                  en:['world'] },
    '平和':        { zh:['和平','太平'],            en:['peace','harmony'] },
    '戦争':        { zh:['戰爭'],                  en:['war'] },
    '情報':        { zh:['情報','資訊'],            en:['information','intelligence'] },
    '外交官':      { zh:['外交官'],                en:['diplomat','diplomatic official'] },
    '家族':        { zh:['家族','家庭'],            en:['family'] },
    '結婚':        { zh:['結婚'],                  en:['marriage','wedding'] },
    '試験':        { zh:['考試','測驗'],            en:['exam','test'] },
    '学校':        { zh:['學校'],                  en:['school'] },
    '孤独':        { zh:['孤獨'],                  en:['loneliness','solitude'] },
    '大使館':      { zh:['大使館'],                en:['embassy'] },
    '暗殺':        { zh:['暗殺'],                  en:['assassination'] },
    '孤児院':      { zh:['孤兒院'],                en:['orphanage'] },
    '仮面':        { zh:['面具','假面'],            en:['mask','disguise'] },
    '信頼':        { zh:['信任','信賴'],            en:['trust','confidence'] },
    '計画':        { zh:['計劃','計畫'],            en:['plan','scheme'] },
    '絶望':        { zh:['絕望'],                  en:['despair','hopelessness'] },
    '関係':        { zh:['關係'],                  en:['relationship','connection'] },
    '人質':        { zh:['人質'],                  en:['hostage'] },
    '写真':        { zh:['照片','相片'],            en:['photo','photograph'] },
    '証拠':        { zh:['證據'],                  en:['evidence','proof'] },
    '逃走':        { zh:['逃跑','逃走'],            en:['escape','flight'] },
    '受験':        { zh:['應試','考試'],            en:['taking an exam'] },
    '合格':        { zh:['合格','通過'],            en:['passing (a test)','qualification'] },
    '会話':        { zh:['會話','對話'],            en:['conversation','dialogue'] },
    '言葉':        { zh:['話語','言詞'],            en:['words','language','expression'] },
    '英雄':        { zh:['英雄'],                  en:['hero'] },
    '組織':        { zh:['組織'],                  en:['organization','group'] },
    '懇親会':      { zh:['懇親會','聯誼會'],        en:['social gathering','mixer'] },
    '超能力':      { zh:['超能力'],                en:['superpower','psychic ability'] },
    '考え':        { zh:['想法','考量'],            en:['thought','idea','thinking'] },
    '考える':      { zh:['考慮','思考'],            en:['to think','to consider'] },
    '分かる':      { zh:['明白','理解'],            en:['to understand','to know'] },
    '知る':        { zh:['知道','了解'],            en:['to know','to find out'] },
    '見る':        { zh:['看','觀看'],              en:['to see','to look','to watch'] },
    '出る':        { zh:['出去','出現'],            en:['to leave','to appear','to come out'] },
  };
  for (const [word, data] of Object.entries(ZH_SEED)) {
    const zh = data.zh || [];
    const en = data.en || [];
    if (dict[word]) {
      if (!dict[word].zh || dict[word].zh.length === 0) dict[word].zh = zh;
      if (!dict[word].en || dict[word].en.length === 0) dict[word].en = en;
    } else {
      dict[word] = { zh, en, reading: kata2hira(word), pitch: null };
    }
  }
  console.log('✏️  ZH_SEED applied');

  // 5. 合併 dict-zh-supplement.json（補充中文定義）
  const suppPath = path.join(__dirname, '../data/dict-zh-supplement.json');
  if (fs.existsSync(suppPath)) {
    const supp = JSON.parse(fs.readFileSync(suppPath, 'utf8'));
    let patched = 0;
    for (const [word, data] of Object.entries(supp)) {
      if (!data.zh || !data.zh.length) continue;
      if (dict[word]) {
        dict[word].zh = data.zh;
      } else {
        dict[word] = { zh: data.zh, en: [], reading: '', pitch: null };
      }
      patched++;
    }
    console.log(`📦 supplement: ${patched} 詞已合併`);
  } else {
    console.log('ℹ  data/dict-zh-supplement.json 不存在，跳過合併');
  }

  // 6. 輸出
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(dict), 'utf8');

  const total    = Object.keys(dict).length;
  const withZh   = Object.values(dict).filter(v => v.zh.length > 0).length;
  const withPitch= Object.values(dict).filter(v => v.pitch !== null && v.pitch !== undefined).length;
  console.log(`\n✅ dict.json saved → ${OUTPUT}`);
  console.log(`   Total entries : ${total}`);
  console.log(`   With Chinese  : ${withZh}`);
  console.log(`   With pitch    : ${withPitch}`);

  // 範例
  const samples = ['任務', 'スパイ', '子供', '学校', '黄昏'];
  console.log('\n📋 Sample:');
  for (const w of samples) {
    const e = dict[w];
    if (e) console.log(`   ${w}（${e.reading}）[${e.pitch ?? '?'}]  ${e.zh.join('；') || '（無中文）'}`);
  }
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

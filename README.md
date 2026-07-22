# 動漫日本語

透過我最愛的動漫學日語！（目前支援 SPY×FAMILY 第一季全 24 集）

**[→ 開啟網站](https://yeniifan.github.io/Anime-Japanese/)**

---

## 功能
- **集數選擇** — 左上角下拉選單，可切換不同集數
- **台詞閱讀** — 每行台詞顯示振假名（可切換顯示/隱藏）
- **語音朗讀** — 每行台詞附播放按鈕，使用瀏覽器內建 TTS 朗讀日語
- **單字面板** — 點擊任何標色詞彙，可查看讀音、聲調、中英文解釋，以及該集中的例句
- **填空練習** — 依集數順序，在語境中練習回想詞彙
- **單字收藏** — 點擊詞彙可加入書籤，書籤透過 localStorage 跨 session 保存，可匯出為 CSV（相容 Anki）
- **桌面版** — 寬螢幕下，YouTube 影片、單字面板與練習欄位固定顯示於右側，左側為可捲動台詞
- **時間軸同步** — 桌面版搭配影片時，目前台詞會即時高亮；點擊行末的 `→ MM:SS` 可跳轉影片至該時間點

## 資料處理流程

字幕檔在本機處理後 commit 為 `.json`，查看網站不需執行任何 build 步驟。

```
subtitles/S1E07.ja.srt + S1E07.en.srt   ← 來自 kitsunekko.net 的 Netflix CC 字幕
       ↓  node scripts/add_episode.js S1E07
data/ep07.json  +  data/episodes.json
```

所有集數（S1E01–S1E24）使用 SRT 格式，每行台詞包含 `startMs`/`endMs` 時間戳，供影片同步使用。

### 新增集數

1. 從 [kitsunekko.net](https://kitsunekko.net) 下載 JP（`.ja[cc].srt`）與 EN（`.en.srt`）字幕檔，放入 `subtitles/`
2. 執行：

```bash
node scripts/add_episode.js S1E07        # 單集
node scripts/add_episode.js S1E12-24     # 範圍
node scripts/add_episode.js S1E07 S1E09  # 多集
```

腳本會自動依集數 ID 比對字幕檔（支援 `S01E07`、`S1E7` 等檔名變體），並從 `data/episode-titles.json` 查詢集數標題，無需額外參數。如需手動指定標題：

```bash
node scripts/add_episode.js S1E07 --title "カスタムタイトル"
```

腳本執行步驟：
- 在 `subtitles/` 中比對 JP 與 EN 字幕檔
- 從 `data/episode-titles.json` 查詢集數標題（已預填 S1E01–S1E25）
- 依時間戳重疊對齊日英台詞
- 將正規化字幕存回 `subtitles/`
- 生成 `data/ep07.json` 並更新 `data/episodes.json`

### 重建詞典

詞典（`data/dict.json`）的建構流程分為三個階段：

**1. 基底詞典：JMdict + 聲調**

從 [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) 提取英文解釋，並整合 [kanjium](https://github.com/mifunetoshiro/kanjium) 聲調資料。由於檔案過大，`dict.json` 不納入版本控制。

```bash
# 將 JMdict.xml 與 kanjium/data/source_files/accent_dict.tsv 放至專案根目錄
node scripts/build_dict.js
```

**2. 中文補充詞典：supplement**

JMdict 本身不含中文，因此以補充詞典的方式注入繁體中文定義。`data/dict-zh-supplement.json` 包含約 4900 個詞條，覆蓋本作出現的全部詞彙，格式為：

```json
{
  "言う": { "zh": ["說", "講"] },
  "子供": { "zh": ["孩子", "兒童"] }
}
```

`build_dict.js` 在建構完成後自動將 supplement 合併進 `dict.json`，若原詞典已有該詞則直接覆蓋中文欄位，若無則新增詞條。

補充詞典的建立方式（供維護參考）：

```bash
# 找出哪些詞缺少中文定義
node scripts/find-missing-zh.js        # 輸出 data/missing-zh.json（依出現頻率排序）

# 逐批執行補充腳本（已完成，通常不需重跑）
python3 scripts/_gen_supplement.py
python3 scripts/_patch_supplement.py
# ... _patch2 ~ _patch11 依序執行
```

若要透過 Claude API 自動批量翻譯（需設定 `ANTHROPIC_API_KEY`）：

```bash
ANTHROPIC_API_KEY=sk-... node scripts/generate-zh-defs.js
```

## 版權聲明

日文字幕來源：[kitsunekko.net](https://kitsunekko.net) · 英文字幕來源：Netflix

SPY×FAMILY © 遠藤達哉 / 集英社 · WIT STUDIO × CloverWorks。本專案僅供個人學習使用。

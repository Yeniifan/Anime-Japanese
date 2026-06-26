# 動漫日本語

Learn Japanese through anime we love!

This is a personal project for reading SPY×FAMILY dialogue with furigana, vocabulary lookup, and fill-in-the-blank practice — all running as a static site with no backend.

**[→ Open the site](https://yeniifan.github.io/Anime-Japanese/)**

---

## Features

- **Dialogue reader** — every line with furigana (toggle on/off) and optional English translation
- **Vocabulary panel** — click any highlighted word to see reading, pitch accent, Chinese/English definitions, and example sentences from the episode
- **Fill-in-the-blank quiz** — practice recalling vocabulary in context, in episode order
- **Text-to-speech** — play button on each line reads the Japanese aloud (uses browser built-in TTS)
- **Episode selector** — switch between episodes from the top-left dropdown

## Data pipeline

Subtitle files are processed locally and committed as `.json` — no build step needed to view the site.

```
subtitles/S1E07.ja.srt + S1E07.en.srt   ← Netflix CC subtitles from kitsunekko.net
       ↓  node scripts/add_episode.js S1E07
data/ep07.json  +  data/episodes.json
```

### Adding a new episode

1. Download the JP (`.ja[cc].srt`) and EN (`.en.srt`) Netflix subtitle files from [kitsunekko.net](https://kitsunekko.net) into `subtitles/`
2. Run:

```bash
node scripts/add_episode.js S1E07
```

The script auto-finds the matching subtitle files by episode ID (handles filename variations like `S01E07`, `S1E7`, etc.) and looks up the episode title from `data/episode-titles.json` — no extra flags needed. If either subtitle file is missing, a clear error is shown.

To override the title manually:

```bash
node scripts/add_episode.js S1E07 --title "カスタムタイトル"
```

The script:
- Finds JP and EN subtitle files in `subtitles/` by episode ID
- Looks up the episode title from `data/episode-titles.json` (S1E01–S1E25 pre-populated)
- Matches JP and EN lines by timestamp overlap
- Saves canonical subtitle files (`S1E07.ja.srt`, `S1E07.en.srt`) to `subtitles/`
- Generates `data/ep07.json` and updates `data/episodes.json`

### Rebuilding the dictionary

The vocabulary dictionary (`data/dict.json`) is generated from [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) and [kanjium](https://github.com/mifunetoshiro/kanjium) pitch accent data. It is not committed to the repo due to file size.

```bash
# place JMdict.xml and kanjium/data/source_files/accent_dict.tsv in the project root
node scripts/build_dict.js
```

## Credits

Japanese subtitles from [kitsunekko.net](https://kitsunekko.net) · English subtitles from Netflix

SPY×FAMILY © 遠藤達哉 / 集英社 · WIT STUDIO × CloverWorks. This project is for personal educational use only.

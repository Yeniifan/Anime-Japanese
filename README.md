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
subtitles/S1E05.ja.srt + S1E05.en.srt
       ↓  node scripts/add_episode.js
data/ep05.json  +  data/episodes.json
```

### Adding a new episode

Download JP and EN subtitle files from [kitsunekko.net](https://kitsunekko.net) (Netflix CC recommended), then run:

```bash
node scripts/add_episode.js subtitles/S1E05.ja.srt subtitles/S1E05.en.srt --title "合否の行方 / Will They Pass?"
```

The script automatically:
- Parses S/E number from the filename
- Matches JP and EN lines by timestamp overlap
- Saves the canonical subtitle files to `subtitles/`
- Generates `data/ep05.json` and updates `data/episodes.json`

### Rebuilding the dictionary

The vocabulary dictionary (`data/dict.json`) is generated from [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) and [kanjium](https://github.com/mifunetoshiro/kanjium) pitch accent data. It is not committed to the repo due to file size.

```bash
# place JMdict.xml and kanjium/data/source_files/accent_dict.tsv in the project root
node scripts/build_dict.js
```

## Credits

Subtitles from [kitsunekko.net](https://kitsunekko.net) ·

SPY×FAMILY © 遠藤達哉 / 集英社 · WIT STUDIO × CloverWorks. This project is for personal educational use only.

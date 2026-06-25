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

Source subtitle files (`.txt`) are processed locally and committed as `.json` — no build step needed to view the site.

```
subtitles/ep01.txt
       ↓  node scripts/add_episode.js
data/ep01.json  +  data/episodes.json
```

### Adding a new episode

1. Download the bilingual script from [transcribedanimescripts.tumblr.com](https://transcribedanimescripts.tumblr.com)
2. Run:
   ```bash
   node scripts/add_episode.js "SPY×FAMILY _ S.1 E.03 (JPN _ ENG).txt"
   ```
3. Commit `data/ep03.json` and `data/episodes.json`

### Rebuilding the dictionary

The vocabulary dictionary (`data/dict.json`) is generated from [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) and [kanjium](https://github.com/mifunetoshiro/kanjium) pitch accent data. It is not committed to the repo due to file size.

```bash
# place JMdict.xml and kanjium/data/source_files/accent_dict.tsv in the project root
node scripts/build_dict.js
```

## Credits

Scripts transcribed and organized by **Kiriban** at [transcribedanimescripts.tumblr.com](https://transcribedanimescripts.tumblr.com) · Japanese from Netflix subtitles (kitsunekko.net) · English from Gogoanime subtitles.

SPY×FAMILY © 遠藤達哉 / 集英社 · WIT STUDIO × CloverWorks. This project is for personal educational use only.

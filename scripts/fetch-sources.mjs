#!/usr/bin/env node
// Downloads every raw dataset the data pipeline needs into .cache/sources/.
// Files already present are skipped; pass --force to re-download.
//
// All sources are public domain or openly licensed; see docs/DATA_FORMAT.md#credits.
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const DIR = join(process.cwd(), '.cache', 'sources');
const force = process.argv.includes('--force');

const CLEAR = 'https://raw.githubusercontent.com/Clear-Bible/Alignments/main/data';
const STEP = 'https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master';
const OPEN_BIBLES = 'https://raw.githubusercontent.com/seven1m/open-bibles/master';

/** [local file name, url] */
const SOURCES = [
  // Berean Standard Bible tokens + hand-made word alignments (Clear-Bible / Biblica, CC BY 4.0)
  ['nt_BSB.tsv', `${CLEAR}/eng/targets/BSB/nt_BSB.tsv`],
  ['ot_BSB.tsv', `${CLEAR}/eng/targets/BSB/ot_BSB.tsv`],
  ['SBLGNT-BSB-manual.json', `${CLEAR}/eng/alignments/BSB/SBLGNT-BSB-manual.json`],
  ['WLCM-BSB-manual.json', `${CLEAR}/eng/alignments/BSB/WLCM-BSB-manual.json`],
  // Original-language source tokens (SBLGNT CC BY 4.0; WLC public domain via Macula)
  ['SBLGNT.tsv', `${CLEAR}/sources/SBLGNT.tsv`],
  ['WLCM.tsv', `${CLEAR}/sources/WLCM.tsv`],
  // Macula Hebrew: lemma, morphology, transliteration, LXX equivalents (CC BY 4.0, Git LFS)
  ['macula-hebrew.tsv', 'https://media.githubusercontent.com/media/Clear-Bible/macula-hebrew/main/WLC/tsv/macula-hebrew.tsv'],
  // STEPBible brief lexicons (CC BY 4.0)
  ['TBESG.txt', `${STEP}/Lexicons/TBESG%20-%20Translators%20Brief%20lexicon%20of%20Extended%20Strongs%20for%20Greek%20-%20STEPBible.org%20CC%20BY.txt`],
  ['TBESH.txt', `${STEP}/Lexicons/TBESH%20-%20Translators%20Brief%20lexicon%20of%20Extended%20Strongs%20for%20Hebrew%20-%20STEPBible.org%20CC%20BY.txt`],
  // Strong's dictionaries (public domain, OpenScriptures)
  ['strongs-greek.js', 'https://raw.githubusercontent.com/openscriptures/strongs/master/greek/strongs-greek-dictionary.js'],
  ['strongs-hebrew.js', 'https://raw.githubusercontent.com/openscriptures/strongs/master/hebrew/strongs-hebrew-dictionary.js'],
  // Public-domain English texts
  ['bsb.usfx.xml', `${OPEN_BIBLES}/eng-bsb.usfx.xml`], // headings, paragraphs, Psalm titles
  ['web.usfx.xml', `${OPEN_BIBLES}/eng-web.usfx.xml`],
  ['asv.zefania.xml', `${OPEN_BIBLES}/eng-asv.zefania.xml`],
  ['ylt.zefania.xml', `${OPEN_BIBLES}/eng-ylt.zefania.xml`],
  ['kjv.osis.xml', `${OPEN_BIBLES}/eng-kjv.osis.xml`], // red-letter markup (<q who="Jesus">)
  // Cross references: OpenBible.info (CC BY), mirrored by scrollmapper/bible_databases
  ['openbible-cross-references.txt', 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/sources/extras/cross_references.txt'],
  // People and places with family links and coordinates: STEPBible TIPNR (CC BY 4.0)
  ['TIPNR.txt', `${STEP}/Proper%20Nouns/TIPNR%20-%20Translators%20Individualised%20Proper%20Names%20with%20all%20References%20-%20STEPBible.org%20CC%20BY.txt`],
];

async function download(name, url) {
  const dest = join(DIR, name);
  if (!force && existsSync(dest) && statSync(dest).size > 0) {
    console.log(`✓ ${name} (cached)`);
    return;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${name}: HTTP ${res.status} from ${url}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, dest);
  console.log(`↓ ${name} (${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
}

async function main() {
  mkdirSync(DIR, { recursive: true });
  for (const [name, url] of SOURCES) await download(name, url);

  // KJV with Strong's numbers and morphology (CrossWire, public domain) ships as an npm package.
  const kjv = join(DIR, 'kjv-crosswire.tgz');
  if (force || !existsSync(kjv)) {
    const out = execFileSync('npm', ['pack', '@metaxia/scriptures-source-crosswire-kjv@2.0.2', '--silent'], { cwd: DIR })
      .toString()
      .trim()
      .split('\n')
      .pop();
    renameSync(join(DIR, out), kjv);
    console.log('↓ kjv-crosswire.tgz');
  } else {
    console.log('✓ kjv-crosswire.tgz (cached)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

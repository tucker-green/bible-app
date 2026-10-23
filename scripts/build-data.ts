/**
 * Builds everything under public/data/ from the raw sources in .cache/sources/.
 *
 *   npm run data:build              # all stages
 *   npm run data:build -- orig bsb  # only the named stages (in pipeline order)
 *
 * Stage order matters: later stages read earlier outputs (e.g. kjv/bridged read orig + BSB text).
 */
type Stage = { name: string; run: () => Promise<void> | void };

const STAGES: Stage[] = [
  { name: 'orig', run: async () => (await import('./data/orig')).buildOrig() },
  { name: 'bsb', run: async () => (await import('./data/bsb')).buildBsb() },
  // kjv and bridged link through orig + the BSB text (and its translation table).
  { name: 'kjv', run: async () => (await import('./data/kjv')).buildKjv() },
  { name: 'bridged', run: async () => (await import('./data/bridged')).buildBridged() },
  // redletter rewrites every text/ file in place (TextVerse.wj): it needs all five translations + orig,
  // and must run before the stages that read the text files.
  { name: 'redletter', run: async () => void (await import('./data/redletter')).buildRedLetter() },
  // concordance reads orig; lexicon reads conc (verse counts) and the KJV/BSB word links (renderings).
  { name: 'concordance', run: async () => (await import('./data/concordance')).buildConcordance() },
  { name: 'lexicon', run: async () => (await import('./data/lexicon')).buildLexicon() },
  // Study data. xrefs reads the BSB text (English verse counts); names reads orig + BSB/KJV text;
  // wordstudy reads orig + the lexicon chunks (which ids are prefix/suffix morphemes).
  { name: 'xrefs', run: async () => void (await import('./data/xrefs')).buildXrefs() },
  { name: 'names', run: async () => void (await import('./data/names')).buildNames() },
  { name: 'wordstudy', run: async () => void (await import('./data/wordstudy')).buildWordStudy() },
  { name: 'search', run: async () => (await import('./data/search')).buildSearch() },
  // meta lists the translations present and credits for every dataset built above.
  { name: 'meta', run: async () => (await import('./data/meta')).buildMeta() },
  { name: 'validate', run: async () => (await import('./data/validate')).buildValidate() },
];

async function main() {
  const wanted = process.argv.slice(2);
  const unknown = wanted.filter((w) => !STAGES.some((s) => s.name === w));
  if (unknown.length) throw new Error(`Unknown stage(s): ${unknown.join(', ')}`);
  for (const stage of STAGES) {
    if (wanted.length && !wanted.includes(stage.name)) continue;
    const t = performance.now();
    console.log(`\n=== ${stage.name} ===`);
    await stage.run();
    console.log(`=== ${stage.name} done in ${((performance.now() - t) / 1000).toFixed(1)}s ===`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

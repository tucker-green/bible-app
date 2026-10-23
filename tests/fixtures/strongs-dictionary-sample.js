/**
 * Test fixture shaped like OpenScriptures' strongs-greek-dictionary.js: a licence comment, then
 * `var x = {...}; module.exports = x;`. Strings contain braces, quotes and "};" to exercise the
 * string-aware brace matcher. The trailing statements must never run: the parser may only JSON.parse
 * the object literal.
 */

var strongsGreekDictionary = {"G3056":{"derivation":"from G3004 (λέγω);","strongs_def":" something said (including the thought) {word}","kjv_def":"account, cause, \"word\"};","lemma":"λόγος","translit":"lógos"},
"G3004":{"derivation":"a primary verb;","strongs_def":" properly, to \"lay\" forth, i.e. (figuratively) relate","kjv_def":"ask, bid, boast","lemma":"λέγω","translit":"légō"},
"G2127":{"derivation":"from a compound of G2095 (εὖ) and G3056 (λόγος);","strongs_def":" to speak well of","kjv_def":"bless","lemma":"εὐλογέω","translit":"eulogéō"},
"G4533":{"derivation":"of Hebrew origin (H08012);","strongs_def":" Salmon, an Israelite","kjv_def":"Salmon","lemma":"Σαλμών","translit":"Salmṓn","extra":{"nested":"{not a field}"},"n":5},
"X1":{"derivation":"not a Strong's key"}
};
module.exports = strongsGreekDictionary;
globalThis.__strongsFixtureEvaluated = true;
throw new Error('This fixture must never be evaluated');

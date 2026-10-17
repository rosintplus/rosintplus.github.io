/**
 * Behavioural checks for the local political-compass engine.
 *
 * These are *property* tests, not snapshot tests: they assert the invariants
 * the engine promises (bounded, damped, uncertain readings are not extreme,
 * heuristics never invert, deterministic, no double-counting). Run with
 * `npm test`.
 */
import {
  evaluatePoliticalCompass,
  classifyQuadrant,
  detectSarcasm,
} from '../src/compass/analyze.js';
import { balanceEstimate, martinVanbergTransform, scoreText, codeIdentityDeclarations } from '../src/compass/textscore.js';
import { emptyStats, processItem } from '../src/profile/stats.js';
import { estimateFromCommunities } from '../src/compass/community.js';
import { getArchetypeColorClass, getQuadrantArchetype } from '../src/components/profile/archetype.js';

const mk = (id, sub, body) => ({ id, subreddit: sub, body, created_utc: 1700000000 });
const statsFrom = (items) => {
  const subredditCounts = {};
  for (const it of items) subredditCounts[it.subreddit] = (subredditCounts[it.subreddit] || 0) + 1;
  return { subredditCounts, heatmap: [], wordFreqs: { posts: {}, comments: {} }, sampleItems: [] };
};
const ev = (items, extraStats) =>
  evaluatePoliticalCompass({ stats: { ...statsFrom(items), ...extraStats }, posts: [], comments: items });

const pass = [], fail = [];
const check = (ok, label) => { (ok ? pass : fail).push(label); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const rep = (name, r) => {
  console.log(`  ${name.padEnd(28)} signal=${String(r.hasSignal).padEnd(5)} econ=${String(r.econ).padStart(5)} soc=${String(r.soc).padStart(5)} gov=${String(r.gov).padStart(5)} ${(r.quadrant || '-').padEnd(12)} N=${String(r.evidence.totalWeight).padStart(5)} rel=${r.evidence.reliability} se(e/g)=${r.evidence.se.econ}/${r.evidence.se.gov}`);
  return r;
};

// Ids must be unique across every fixture: the engine memoises on content.
let idSeq = 0;
const repeat = (n, sub, body) => Array.from({ length: n }, () => mk(`${sub}${(idSeq += 1)}`, sub, body));

const LEFT_TEXT = 'universal healthcare and medicare for all should be a fundamental right, tax the rich and strong unions for workers';
const RIGHT_TEXT = 'lower taxes, free market capitalism, small government and cut spending, taxation is theft';

const leftUser = [
  ...repeat(30, 'socialism', LEFT_TEXT),
  ...repeat(20, 'socialdemocracy', 'tax the rich, cancel student debt, and strong unions for workers'),
  ...repeat(15, 'ClimateAction', 'climate change is real, we need the green new deal and renewable energy'),
  ...repeat(10, 'progressive', 'pro-choice and reproductive freedom matter, secular government please'),
];
const rightUser = [
  ...repeat(30, 'conservative', RIGHT_TEXT),
  ...repeat(20, 'the_DONALD', 'trump is the best president, maga forever, vote red'),
  ...repeat(15, 'prolife', 'pro-life, ban abortion, sanctity of life'),
  ...repeat(10, 'GunDebates', 'second amendment rights, pro-gun, constitutional carry'),
];

console.log('\n=== A. non-political accounts must produce NO reading ===');
for (const [n, items] of [
  ['gaming only', repeat(60, 'gaming', 'this boss is impossible, any tips?')],
  ['mixed casual', [...repeat(40, 'aww', 'cute dog'), ...repeat(40, 'AskReddit', 'how do I bake bread')]],
  ['unmapped sub, high volume', repeat(50, 'RelationshipAdvice', 'my partner and I had a fight again')],
]) check(!rep(n, ev(items)).hasSignal, `${n} -> no reading`);

console.log('\n=== B. committed users must produce a CLEAR reading ===');
const L = rep('committed left', ev(leftUser));
check(L.hasSignal && L.econ < -2, 'left user reads clearly left on econ');
check(L.quadrant !== 'center', 'left user is not labelled centrist');
const R = rep('committed right', ev(rightUser));
check(R.hasSignal && R.econ > 2, 'right user reads clearly right on econ');
check(L.quadrant !== R.quadrant, 'left and right users land in different quadrants');
check(L.econ * R.econ < 0, 'left and right have opposite econ signs');

console.log('\n=== C. bounded by construction: never slams to +/-10 ===');
const spamL = rep('80x one left stance', ev(repeat(80, 'socialism', 'healthcare is a human right')));
const spamR = rep('80x one right stance', ev(repeat(80, 'conservative', 'taxation is theft')));
check(Math.abs(spamL.econ) < 10 && Math.abs(spamR.econ) < 10, 'repetition never reaches the scale edge');
check(spamL.econ < 0 && spamR.econ > 0, 'repetition keeps the correct sign');

console.log('\n=== D. one outlier must NOT hijack a history ===');
const mixed = rep('60 right + 1 left outlier', ev([...repeat(60, 'conservative', RIGHT_TEXT), mk('outlier1', 'socialism', 'we should nationalise the means of production')]));
check(mixed.econ > 0, 'stayed right-leaning despite a single left outlier');

console.log('\n=== E. heuristics damp, never invert ===');
// Same evidence mass in both fixtures; only the sarcasm markers differ. More
// sarcasm must widen uncertainty and pull the estimate toward the centre —
// never past it, and never flip the sign.
const sincere40 = ev(repeat(40, 'socialism', LEFT_TEXT));
const sarcastic40 = ev(repeat(40, 'socialism', `yeah right, ${LEFT_TEXT} /s`));
console.log(`       sincere econ=${sincere40.econ}  sarcastic econ=${sarcastic40.econ}`);
check(sincere40.econ < 0 && sarcastic40.econ < 0, 'sarcasm does not invert the reading');
check(Math.abs(sarcastic40.econ) <= Math.abs(sincere40.econ) + 0.001, 'sarcasm pulls toward the centre');
check(sarcastic40.evidence.se.econ >= sincere40.evidence.se.econ, 'sarcasm widens reported uncertainty');

const mixedSarc = ev([...repeat(20, 'socialism', LEFT_TEXT), ...repeat(20, 'socialism', `oh sure, ${LEFT_TEXT} /s`)]);
check(mixedSarc.econ < 0, 'a partly-sarcastic history keeps the correct sign');

const sarcOnly = ev(repeat(20, 'socialism', `yeah right, ${LEFT_TEXT} /s`));
rep('sarcastic only', sarcOnly);

console.log('\n=== F. hysteresis damps oscillation ===');
const readings = [];
for (let i = 0; i < 14; i++) {
  const items = [...repeat(20, 'socialism', LEFT_TEXT), ...repeat(i, 'conservative', RIGHT_TEXT)];
  readings.push(evaluatePoliticalCompass({ stats: statsFrom(items), posts: [], comments: items }));
}
let rawRev = 0, hysRev = 0, prevRaw = null, prevHys = null;
const rawQ = [], hysQ = [];
for (const r of readings) {
  const raw = classifyQuadrant(r.econ, r.gov).quadrant;
  const hys = classifyQuadrant(r.econ, r.gov, { prevQuadrant: prevHys }).quadrant;
  rawQ.push(raw); hysQ.push(hys);
  if (prevRaw && prevRaw !== raw) rawRev++;
  if (prevHys && prevHys !== hys) hysRev++;
  prevRaw = raw; prevHys = hys;
}
console.log(`       raw=[${rawQ.join(',')}]`);
console.log(`       hys=[${hysQ.join(',')}]  reversals ${rawRev} -> ${hysRev}`);
check(hysRev <= rawRev, 'hysteresis does not increase quadrant reversals');
check(classifyQuadrant(0, 0).quadrant === 'center', 'a centred reading is centrist');
const released = classifyQuadrant(0, 0, { prevQuadrant: 'lib-left' });
check(released.quadrant === 'center' && released.held === false, 'a clearly-centred reading releases a stale quadrant');
check(classifyQuadrant(-9, -9, { prevQuadrant: 'lib-left' }).held === true, 'borderline reading holds its quadrant');

console.log('\n=== G. determinism ===');
const d1 = evaluatePoliticalCompass({ stats: statsFrom(leftUser), posts: [], comments: leftUser });
const d2 = evaluatePoliticalCompass({ stats: statsFrom(leftUser), posts: [], comments: leftUser });
check(JSON.stringify(d1) === JSON.stringify(d2), 'repeated evaluation is identical');

console.log('\n=== H. estimator properties ===');
const bal = balanceEstimate([
  { pole: -1, category: { weight: 1 } }, { pole: -1, category: { weight: 1 } },
  { pole: -1, category: { weight: 1 } }, { pole: +1, category: { weight: 1 } },
]);
check(Math.abs(bal.score - (-5)) < 0.01, 'balance of 3 con / 1 pro is -5 (i.e. -1 x 10)');
check(bal.n === 4 && bal.se > 0, 'balance reports n and a positive standard error');
const allSame = balanceEstimate([{ pole: -1, category: { weight: 1 } }, { pole: -1, category: { weight: 1 } }]);
check(allSame.score === -10, 'unanimous pro/con reaches the scale edge only at the extreme');
check(Math.abs(martinVanbergTransform(1, 1, 5, -8, 8) - (-8)) < 1e-9, 'MV transform recovers the low reference point');
check(Math.abs(martinVanbergTransform(5, 1, 5, -8, 8) - 8) < 1e-9, 'MV transform recovers the high reference point');
check(Math.abs(martinVanbergTransform(3, 1, 5, -8, 8) - 0) < 1e-9, 'MV transform interpolates the midpoint');

const scoreOne = (body) => scoreText([{ subreddit: 'test', body, title: '', score: 1 }]);
const q = scoreOne('is universal healthcare any good?');
check(q.dimensions.econ.n === 0, 'questions assert no position');
const neg = scoreOne('I do not support universal healthcare at all');
check(neg.dimensions.econ.score >= 0, 'negation flips an avowal rather than counting as support');
const pos = scoreOne('I support universal healthcare and medicare for all');
check(pos.dimensions.econ.score < 0, 'an avowal codes to its own pole');
const breadth = scoreOne(`${LEFT_TEXT}. climate change is real and we need the green new deal. pro-choice and reproductive freedom matter.`);
check(breadth.dimensions.econ.clusters >= 3, 'distinct categories are counted as distinct evidence clusters');
const repeatScore = scoreText(Array.from({ length: 40 }, () => ({ subreddit: 'test', body: 'healthcare is a human right', title: '', score: 1 })));
check(repeatScore.dimensions.econ.se > 2, 'repeating one phrase does not manufacture confidence (wide SE)');

const comm = estimateFromCommunities({ socialism: 10, socialdemocracy: 8, progressive: 6 }, new Map());
check(comm.dimensions.econ.score < 0, 'community ideal point follows the known positions');
check(comm.dimensions.econ.n === 3, 'effective N is the number of communities, not raw items');

console.log('\n=== I. regression: no double-counting across id-less and id-ful copies ===');
const body = 'universal healthcare and medicare for all should be a fundamental right';
const withId = mk('reg1', 'socialism', body);
const withoutId = { subreddit: 'socialism', body, title: '', score: 1 }; // processItem() output: no id
const dup = evaluatePoliticalCompass({
  stats: { ...statsFrom([withId]), sampleItems: [withoutId] }, posts: [], comments: [withId],
});
const single = evaluatePoliticalCompass({
  stats: { ...statsFrom([mk('reg2', 'socialism', body)]), sampleItems: [] },
  posts: [], comments: [mk('reg2', 'socialism', body)],
});
console.log(`       dup units=${dup.evidence.stanceWeight}  single units=${single.evidence.stanceWeight}`);
check(dup.evidence.stanceWeight === single.evidence.stanceWeight, 'same text counted once whether or not the copy carries an id');

console.log('\n=== J. regression: cache key covers sampleItems ===');
const base = statsFrom([mk('ck1', 'socialism', body)]);
const first = evaluatePoliticalCompass({ stats: { ...base, sampleItems: [] }, posts: [], comments: [mk('ck1', 'socialism', body)] });
const second = evaluatePoliticalCompass({
  stats: { ...base, sampleItems: [{ subreddit: 'conservative', body: RIGHT_TEXT, title: '', score: 1 }] },
  posts: [], comments: [mk('ck1', 'socialism', body)],
});
check(JSON.stringify(first) !== JSON.stringify(second), 'changing sampleItems produces a different result (no stale cache hit)');

console.log('\n=== K. sarcasm detector precision ===');
for (const [txt, expect] of [
  ['yeah right, universal healthcare is amazing', 'strong'],
  ['/s obviously the government cares about us', 'strong'],
  ['This is a GENIUS plan', 'none'],
  ['I support universal healthcare and strong unions', 'none'],
  ['to be fair, the capital of France is Paris', 'none'],
  ['my CatBreed is named subreddit', 'none'],
]) {
  const got = detectSarcasm(txt, '').strength;
  check(got === expect, `${JSON.stringify(txt.slice(0, 38))} -> ${got}`);
}

console.log('\n=== L. identity declarations must be the author\'s asserted position ===');
for (const text of ['I am not a socialist.', 'I am never a socialist.', 'He said "I am a socialist".', 'He said “I am a socialist”.', "He said 'I am a socialist'.", '> I am a socialist', 'Am I a socialist?', 'I am a socialist?']) {
  check(codeIdentityDeclarations(text).length === 0, `excluded identity: ${text}`);
}
check(codeIdentityDeclarations("I'm a socialist.").length === 1, 'contractions remain valid self-declarations');
check(codeIdentityDeclarations('I am not a socialist. I am a libertarian.').length === 1, 'denial does not suppress an affirmative identity in another sentence');

console.log('\n=== M. full text and sample identity participate in the cache key ===');
const preface = 'An ordinary introduction without political positions. '.repeat(6);
const longLeft = mk('long-cache', 'test', preface + ' I support universal healthcare.');
const longRight = { ...longLeft, body: preface + ' I support free market healthcare.' };
const cachedLeft = evaluatePoliticalCompass({ comments: [longLeft] });
const changedRight = evaluatePoliticalCompass({ comments: [longRight] });
const freshRight = evaluatePoliticalCompass({ comments: [{ ...longRight, id: 'fresh-cache' }] });
check(cachedLeft !== changedRight, 'text change after character 200 invalidates the cache');
check(JSON.stringify(changedRight) === JSON.stringify(freshRight), 'changed content agrees with a fresh computation');
const sampleLeft = evaluatePoliticalCompass({ stats: { sampleItems: [longLeft] } });
const sampleRight = evaluatePoliticalCompass({ stats: { sampleItems: [longRight] } });
check(sampleLeft !== sampleRight, 'long stats sample changes invalidate the cache too');

console.log('\n=== N. post samples preserve identity and cannot count twice ===');
const post = { id: 'sample-post', subreddit: 'test', title: 'I support universal healthcare.', selftext: 'I support universal healthcare. Here is my longer explanation.' };
const postStats = emptyStats();
processItem(postStats, post, false);
const postOnly = evaluatePoliticalCompass({ posts: [post] });
const postAndSample = evaluatePoliticalCompass({ posts: [post], stats: postStats });
check(postAndSample.evidence.stanceWeight === postOnly.evidence.stanceWeight, 'a post and its body sample count once');
check(postStats.sampleItems[0].id === post.id && postStats.sampleItems[0].kind === 't3', 'stats retain post ID and kind');
const sameTextPosts = [post, { ...post, id: 'distinct-post' }];
check(evaluatePoliticalCompass({ posts: sameTextPosts }).evidence.stanceWeight === 2 * postOnly.evidence.stanceWeight, 'distinct post IDs with identical text remain distinct');
const legacyStats = { sampleItems: [{ subreddit: post.subreddit, title: post.title, body: post.selftext }] };
check(evaluatePoliticalCompass({ posts: [post], stats: legacyStats }).evidence.stanceWeight === postOnly.evidence.stanceWeight, 'legacy samples without IDs still deduplicate');
const sameIdComment = { id: post.id, subreddit: 'test', body: post.selftext };
check(evaluatePoliticalCompass({ posts: [post], comments: [sameIdComment] }).evidence.stanceWeight === 2 * postOnly.evidence.stanceWeight, 'post and comment IDs belong to separate namespaces');
const bodyPost = { ...post, id: 'body-only', title: 'My thoughts' };
check(scoreText([bodyPost]).units > 0, 'post selftext remains evidence when its title is neutral');

console.log('\n=== O. diagonal cross-quadrant (mixed left+right signals) ===');
// A centred reading with corroboration on BOTH econ poles is a genuine
// cross-ideological history, not a blank one. Cross is reachable only here:
// |econ|,|gov| inside ENTER with hasLeft && hasRight (see analyze.js fresh()).
const crossDirect = classifyQuadrant(0, 0, { hasLeftSignals: true, hasRightSignals: true });
check(crossDirect.quadrant === 'cross', 'centred reading with left+right signals is cross');
check(crossDirect.labelKey === 'compassQuadCross', 'cross carries labelKey compassQuadCross');
check(crossDirect.label === 'Cross-Ideological / Mixed Discussion', 'cross label verbatim');
check(classifyQuadrant(0, 0, { hasLeftSignals: true }).quadrant === 'center', 'left-only centred reading stays center (no false cross)');
check(classifyQuadrant(0, 0, { hasRightSignals: true }).quadrant === 'center', 'right-only centred reading stays center (no false cross)');
check(classifyQuadrant(-9, -9, { hasLeftSignals: true, hasRightSignals: true }).quadrant !== 'cross', 'extreme diagonal dominates cross');
const mixedLR = ev([...repeat(20, 'socialism', LEFT_TEXT), ...repeat(20, 'conservative', RIGHT_TEXT)]);
rep('mixed left+right', mixedLR);
check(mixedLR.hasSignal && mixedLR.quadrant === 'cross', 'balanced left+right history reads cross-quadrant');
check(mixedLR.archKey === 'compassQuadCross', 'balanced history archKey is compassQuadCross');

console.log('\n=== P. archetype color + quadrant threshold note ===');
// NOTE: the engine (analyze.js classifyQuadrant) uses hysteresis ENTER 2.8 /
// EXIT 1.6, while the UI helper getQuadrantArchetype uses flat +/-2.2. The
// two disagree on purpose in the [2.2, 2.8) band: the helper is a display
// fallback, the engine label is authoritative. These checks pin both sides
// so a threshold drift in either file fails loudly.
check(getArchetypeColorClass('Authoritarian Left (Auth-Left)').includes('quad-auth-left'), 'auth-left archetype maps to auth-left color');
check(getArchetypeColorClass('Cross-Ideological / Mixed Discussion').includes('--neutral'), 'cross archetype maps to neutral color');
check(getArchetypeColorClass('Undetermined / Non-Political Activity').includes('--text-muted'), 'undetermined archetype maps to muted color');
check(classifyQuadrant(2.5, 0).quadrant === 'center', 'engine ENTER 2.8: 2.5 stays center');
check(classifyQuadrant(3.0, 0).quadrant === 'right-center', 'engine ENTER 2.8: 3.0 enters right-center');
check(classifyQuadrant(2.0, 0, { prevQuadrant: 'right-center' }).held === true, 'engine EXIT 1.6: 2.0 holds right-center');
check(classifyQuadrant(1.0, 0, { prevQuadrant: 'right-center' }).quadrant === 'center', 'engine EXIT 1.6: 1.0 releases to center');
check(getQuadrantArchetype(2.5, 0, '') === 'Center-Right', 'UI helper uses +/-2.2: 2.5 already Center-Right (differs from engine by design)');

console.log('\n' + '='.repeat(52));
console.log(`  ${pass.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.log('  FAILED:');
  for (const f of fail) console.log(`    - ${f}`);
  process.exitCode = 1;
}

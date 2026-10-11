import assert from 'node:assert/strict';
import { evaluateBotLikelihood } from '../src/botDetector.js';

const title = 'A sufficiently long example post title';
const post = (id, overrides = {}) => ({ id, title, url: 'https://i.redd.it/example.jpg', ...overrides });
const check = (posts, comments = []) => evaluateBotLikelihood({ username: 'fixture', posts, comments });

assert.equal(check([post('a'), post('b')]).metrics.duplicateItems, 1, 'Same title and media must not double-count a repeated post');
assert.equal(check([post('a'), post('a')]).metrics.duplicateItems, 0, 'Archive copies of the same item are not repeated publishing');
assert.equal(check([post('a'), post('b', { crosspost_parent: 't3_a' })]).metrics.duplicateItems, 0, 'Native crossposts must be excluded');
const corrected = check([post('a'), post('b', { title: 'An entirely different post title', url: 'https://i.redd.it/different.jpg' })]);
assert.equal(corrected.metrics.duplicateItems, 0, 'Content changes with identical IDs must invalidate previous results');

const body = 'A sufficiently long repeated comment message for this regression check.';
assert.equal(check([post('a'), post('b')], [{ id: 'a', body }, { id: 'b', body }]).metrics.duplicateItems, 2, 'Post and comment IDs belong to separate namespaces');
assert.equal(check([], [{ id: 'a', body: '[deleted]' }, { id: 'b', body: '[deleted]' }]).metrics.duplicateItems, 0);

const history = Array.from({ length: 250 }, (_, index) => post(String(index), { title: `Unique archive post number ${index}`, url: `https://example.com/${index}` }));
history[249].title = history[200].title;
assert.equal(check(history).metrics.duplicateItems, 1, 'Older loaded history must participate in detection');
console.log('PASS duplicate counts, overlapping evidence, refreshed content, crossposts, and older history');

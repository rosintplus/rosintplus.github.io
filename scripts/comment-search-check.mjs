import assert from 'node:assert/strict';
import { parsePostInput } from '../src/utils.js';

const expected = { postId: 'abc123', commentId: 'xyz789', kind: 'comment' };
for (const input of [
  'https://www.reddit.com/r/test/comments/abc123/title/xyz789/',
  'https://old.reddit.com/r/test/comments/abc123/title/xyz789/?context=3',
  'https://www.reddit.com/r/test/comments/abc123/title/xyz789#thread',
  '/r/test/comments/abc123/title/xyz789/',
]) assert.deepEqual(parsePostInput(input), expected);
assert.deepEqual(parsePostInput('t1_XYZ789'), { postId: null, commentId: 'xyz789', kind: 'comment' });
assert.equal(parsePostInput('t3_abc123').kind, 'post');
assert.equal(parsePostInput('https://www.reddit.com/r/test/comments/abc123/title/?context=3').commentId, null);
console.log('PASS comment permalinks, query strings, fragments, and t1 IDs parse correctly');

const calls = [];
globalThis.fetch = async url => {
  calls.push(url);
  const requestedId = new URL(url).searchParams.get('ids');
  const data = requestedId === 'xyz789'
    ? [{ id: 'xyz789', body: 'The requested comment', link_id: 't3_abc123' }]
    : [{ id: 'wrongid', body: 'Unrelated comment' }];
  return { ok: true, status: 200, json: async () => ({ data }) };
};
const { fetchCommentById } = await import('../src/api/endpoints.js');
const found = await fetchCommentById('t1_xyz789');
assert.equal(found.comment.body, 'The requested comment');
assert.equal(found.comment.link_id, 't3_abc123');
assert.deepEqual(found.sources, ['Arctic Shift', 'PullPush']);
assert.ok(calls.every(url => new URL(url).searchParams.get('ids') === 'xyz789'));
console.log('PASS lookup fetches the exact comment and preserves parent-post context');
assert.equal((await fetchCommentById('absent1')).comment, null);
console.log('PASS unrelated API results are never displayed as the requested comment');
const count = calls.length;
assert.equal((await fetchCommentById('bad input')).comment, null);
assert.equal(calls.length, count);
console.log('PASS invalid comment IDs do not start network requests');

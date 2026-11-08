import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trashReviewDate, isTrashReviewDue } from '../src/editor/trashRetention.ts';

test('ゴミ箱の確認目安は削除から30日で、直前・到達・経過を区別する', () => {
  const deletedAt = '2026-01-01T12:00:00.000Z';
  const dueAt = Date.parse('2026-01-31T12:00:00.000Z');
  assert.equal(trashReviewDate(deletedAt), dueAt);
  assert.equal(isTrashReviewDue(deletedAt, dueAt - 1), false);
  assert.equal(isTrashReviewDue(deletedAt, dueAt), true);
  assert.equal(isTrashReviewDue(deletedAt, dueAt + 100 * 86400000), true);
  assert.equal(isTrashReviewDue(null, dueAt), false);
});

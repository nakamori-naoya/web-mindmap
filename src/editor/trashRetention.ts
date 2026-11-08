const REVIEW_DELAY = 30 * 24 * 60 * 60 * 1000;

export function trashReviewDate(deletedAt: string): number {
  return Date.parse(deletedAt) + REVIEW_DELAY;
}
export function isTrashReviewDue(deletedAt: string | null, now: number): boolean {
  return deletedAt !== null && now >= trashReviewDate(deletedAt);
}

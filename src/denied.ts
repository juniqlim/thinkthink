/**
 * 키를 못 받은 이유를 가른다.
 *
 * 로그인은 누구나 된다 — 댓글 서비스와 같은 Supabase 를 쓰기 때문이다.
 * 키는 주인에게만 나온다(api/key.js 의 ALLOWED_EMAIL). 거절은 새로고침으로 풀리지 않으니
 * 일시적인 실패와 다르게 알려야 한다.
 */
export class Denied extends Error {}

export function keyError(status: number): Error {
  return status === 403 ? new Denied('허락되지 않은 계정') : new Error(`키를 받지 못했다 (${status})`)
}

export const isDenied = (e: unknown): boolean => e instanceof Denied

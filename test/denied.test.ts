import { describe, it, expect } from 'vitest'
import { keyError, isDenied } from '../src/denied'

// 로그인은 누구나 된다(댓글 서비스와 같은 Supabase 를 쓴다). 키는 주인에게만 나온다.
describe('키를 못 받은 이유', () => {
  it('403 은 허락받지 않은 사람이다 — 새로고침해도 소용없다', () => {
    expect(isDenied(keyError(403))).toBe(true)
  })

  it('그 밖의 실패는 다시 해볼 만하다', () => {
    expect(isDenied(keyError(500))).toBe(false)
    expect(isDenied(new Error('network'))).toBe(false)
  })
})

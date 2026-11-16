import { describe, it, expect } from 'vitest'
import { neighbor } from '../src/step'

const now = new Date(2026, 10, 16, 14)

describe('neighbor', () => {
  it('하루씩 오간다 — 달을 넘는다', () => {
    expect(neighbor({ kind: 'day', year: 2026, month: 11, day: 1 }, -1, now))
      .toEqual({ kind: 'day', year: 2026, month: 10, day: 31 })
  })

  it('한 주씩 오간다 — 월요일을 지킨다', () => {
    expect(neighbor({ kind: 'week', year: 2026, month: 11, day: 2 }, -1, now))
      .toEqual({ kind: 'week', year: 2026, month: 10, day: 26 })
    expect(neighbor({ kind: 'week', year: 2026, month: 11, day: 2 }, 1, now))
      .toEqual({ kind: 'week', year: 2026, month: 11, day: 9 })
  })

  it('한 달씩 오간다 — 해를 넘는다', () => {
    expect(neighbor({ kind: 'month', year: 2026, month: 1 }, -1, now))
      .toEqual({ kind: 'month', year: 2025, month: 12 })
  })

  it('아직 오지 않은 기간으로는 가지 않는다', () => {
    expect(neighbor({ kind: 'day', year: 2026, month: 11, day: 16 }, 1, now)).toBeNull()
    expect(neighbor({ kind: 'week', year: 2026, month: 11, day: 16 }, 1, now)).toBeNull()
    expect(neighbor({ kind: 'month', year: 2026, month: 11 }, 1, now)).toBeNull()
  })

  it('기간이 아닌 보기에는 이웃이 없다', () => {
    expect(neighbor({ kind: 'tag', tag: '일기' }, 1, now)).toBeNull()
    expect(neighbor({ kind: 'search', q: 'a' }, -1, now)).toBeNull()
    expect(neighbor({ kind: 'trash' }, -1, now)).toBeNull()
  })
})

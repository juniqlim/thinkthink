import { describe, it, expect } from 'vitest'
import { headingText } from '../src/heading'

describe('headingText', () => {
  it('하루를 보고 있으면 요일까지 붙은 날짜다', () => {
    expect(headingText({ kind: 'day', year: 2026, month: 7, day: 25 }, 3, 7))
      .toBe('2026. 07. 25. (토)')
  })

  it('한 달을 보고 있으면 연·월이다', () => {
    expect(headingText({ kind: 'month', year: 2026, month: 7 }, 12, 7))
      .toBe('2026. 07')
  })

  it('한 자리 달도 0을 채운다', () => {
    expect(headingText({ kind: 'month', year: 2026, month: 3 }, 0, 7))
      .toBe('2026. 03')
  })

  it('한 주를 보고 있으면 월요일부터 일요일까지다', () => {
    expect(headingText({ kind: 'week', year: 2026, month: 10, day: 26 }, 5, 7))
      .toBe('2026. 10. 26 ~ 11. 01')
  })

  it('태그 모아보기는 태그 이름만 보인다', () => {
    expect(headingText({ kind: 'tag', tag: '일기' }, 5, 7)).toBe('#일기')
  })

  it('검색은 말과 건수를 함께 보여준다', () => {
    expect(headingText({ kind: 'search', q: '회의' }, 2, 7)).toBe('검색 “회의” · 2건')
  })

  it('휴지통은 보관 기간과 건수를 함께 보여준다', () => {
    expect(headingText({ kind: 'trash' }, 4, 7)).toBe('휴지통 · 최근 7일 · 4건')
  })

  it('비어 있어도 건수를 감추지 않는다', () => {
    expect(headingText({ kind: 'trash' }, 0, 7)).toBe('휴지통 · 최근 7일 · 0건')
  })
})

import { dateOf } from './timeline'

/** 헤더 한가운데 놓일 제목 — 무엇을 보고 있는지 한 줄로 말한다 */
export type HeadingView =
  | { kind: 'month'; year: number; month: number }
  | { kind: 'day'; year: number; month: number; day: number }
  /** year·month·day 는 그 주의 월요일 */
  | { kind: 'week'; year: number; month: number; day: number }
  | { kind: 'tag'; tag: string }
  | { kind: 'search'; q: string }
  | { kind: 'trash' }

const pad = (n: number) => String(n).padStart(2, '0')

export function headingText(view: HeadingView, count: number, trashDays: number): string {
  switch (view.kind) {
    case 'trash':
      return `휴지통 · 최근 ${trashDays}일 · ${count}건`
    case 'search':
      return `검색 “${view.q}” · ${count}건`
    case 'tag':
      return `#${view.tag}`
    case 'day':
      return dateOf(new Date(view.year, view.month - 1, view.day).toISOString())
    case 'week': {
      const sun = new Date(view.year, view.month - 1, view.day + 6)
      return `${view.year}. ${pad(view.month)}. ${pad(view.day)} ~ ${pad(sun.getMonth() + 1)}. ${pad(sun.getDate())}`
    }
    case 'month':
      return `${view.year}. ${pad(view.month)}`
  }
}

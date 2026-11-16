import type { View } from './store'
import { today, mondayOf } from './calendar'

/** 지금 보는 기간의 앞뒤 기간 — 아직 오지 않은 기간과 기간이 아닌 보기는 없다(null) */
export function neighbor(view: View, dir: -1 | 1, now: Date): View | null {
  let start: Date
  if (view.kind === 'day' || view.kind === 'week') {
    start = new Date(view.year, view.month - 1, view.day + dir * (view.kind === 'day' ? 1 : 7))
  } else if (view.kind === 'month') {
    start = new Date(view.year, view.month - 1 + dir, 1)
  } else {
    return null
  }
  if (start > now) return null
  return view.kind === 'month'
    ? { kind: 'month', year: start.getFullYear(), month: start.getMonth() + 1 }
    : { kind: view.kind, ...today(start) }
}

/** 지금이 든 날·주·달 — 한 번에 가는 곳 */
export function presents(now: Date): { label: string; name: string; view: View }[] {
  const t = today(now)
  return [
    { label: 'D', name: '오늘', view: { kind: 'day', ...t } },
    { label: 'W', name: '이번 주', view: { kind: 'week', ...mondayOf(t.year, t.month, t.day) } },
    { label: 'M', name: '이번 달', view: { kind: 'month', year: t.year, month: t.month } },
  ]
}

import type { View } from './store'
import { today } from './calendar'

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

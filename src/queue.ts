/**
 * 아직 못 보낸 글을 줄 세워 둔다.
 *
 * 예전에는 저장이 끝나야 입력창이 비었다. 지하철에서 한 번 실패하면 알림이
 * 뜨고 다음 글을 쓸 수 없었다. 이제 누르는 즉시 큐에 넣고 화면에 얹는다 —
 * 보내는 일은 뒤에서 돌고, 사람은 계속 쓴다.
 *
 * 쓴 시각을 함께 담으므로 늦게 올라가도 제자리에 남는다.
 */

import type { LogEntry } from './timeline'
import type { View } from './store'
import { extractTags } from './tags'
import { weekRange } from './calendar'

export interface Pending {
  /** 앱이 만든다. 서버에 올라간 뒤의 id 와는 다르다 */
  id: string
  body: string
  meta: string | null
  /** 쓴 시각 (ISO) */
  at: string
  /** 마지막 시도가 실패했는가 — 화면에 드러내려고 들고 있다 */
  failed: boolean
  /** 마지막 실패 사유. 폰에는 콘솔이 없어 여기 담아두지 않으면 사라진다 */
  error?: string
}

/** 화면에 얹은 대기 글. 아직 서버에 없으니 고치거나 지울 수 없다 */
export type PendingEntry = LogEntry & { pending: true; failed: boolean; error?: string }

export interface Store {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const KEY = 'thinkthink:queue'

export function enqueue(queue: Pending[], item: Pending): Pending[] {
  return [...queue, item]
}

export function dequeue(queue: Pending[], id: string): Pending[] {
  return queue.filter(i => i.id !== id)
}

/** 실패해도 빼지 않는다 — 빼는 순간 글이 사라진다 */
export function markFailed(queue: Pending[], id: string, error: string): Pending[] {
  return queue.map(i => (i.id === id ? { ...i, failed: true, error } : i))
}

/**
 * 던져진 것이 무엇이든 사람이 읽고 붙여넣을 한 줄로 만든다.
 *
 * 폰에서는 콘솔을 열 수 없다. 여기서 놓친 단서는 다시 볼 길이 없으므로
 * 아는 자리는 모두 훑는다 — Error 든 Supabase 응답이든.
 */
export function reasonOf(e: unknown): string {
  if (e === null || e === undefined) return '알 수 없는 오류'
  if (typeof e === 'string') return e || '알 수 없는 오류'
  if (typeof e !== 'object') return String(e)

  const o = e as Record<string, unknown>
  const said = (v: unknown) => typeof v === 'string' && v !== ''
  const head = [o.name, o.message].filter(said).join(': ')
  const rest = ['code', 'status', 'details', 'hint']
    .filter(k => o[k] !== undefined && o[k] !== null && o[k] !== '')
    .map(k => `${k}=${String(o[k])}`)

  return [head, ...rest].filter(Boolean).join(' ') || '알 수 없는 오류'
}

export function next(queue: Pending[]): Pending | null {
  return queue[0] ?? null
}

function asEntry(item: Pending): PendingEntry {
  return {
    id: item.id,
    body: item.body,
    created_at: item.at,
    updated_at: item.at,
    tags: extractTags(item.body),
    deleted_at: null,
    meta: item.meta,
    pending: true,
    failed: item.failed,
    error: item.error,
  }
}

/** 지금 보고 있는 자리에 이 글이 놓일 자리가 있는가 */
function belongs(item: Pending, view: View): boolean {
  const d = new Date(item.at)
  if (view.kind === 'day') {
    return d.getFullYear() === view.year && d.getMonth() + 1 === view.month && d.getDate() === view.day
  }
  if (view.kind === 'month') {
    return d.getFullYear() === view.year && d.getMonth() + 1 === view.month
  }
  if (view.kind === 'week') {
    const { from, to } = weekRange(view.year, view.month, view.day)
    return d >= new Date(from) && d < new Date(to)
  }
  if (view.kind === 'tag') return extractTags(item.body).includes(view.tag)
  // 휴지통은 지운 것을 보는 자리고, 검색은 올라간 글을 훑는 자리다
  return false
}

/** 올라간 글과 대기 중인 글을 시각순으로 합친다 */
export function withPending(
  rows: LogEntry[],
  queue: Pending[],
  view: View,
): (LogEntry | PendingEntry)[] {
  const waiting = queue.filter(i => belongs(i, view)).map(asEntry)
  if (waiting.length === 0) return rows

  return [...rows, ...waiting].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
}

export function isPending(entry: LogEntry | PendingEntry): entry is PendingEntry {
  return 'pending' in entry
}

/** 저장소가 막혀 있어도(사파리 비공개 모드, 용량 초과) 앱은 계속 돌아야 한다 */
export function save(queue: Pending[], store: Store): void {
  try {
    if (queue.length === 0) store.removeItem(KEY)
    else store.setItem(KEY, JSON.stringify(queue))
  } catch {
    // 못 적어도 이번 세션 동안은 메모리에 남아 있다
  }
}

export function load(store: Store): Pending[] {
  try {
    const raw = store.getItem(KEY)
    const parsed = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as Pending[] : []
  } catch {
    return []
  }
}

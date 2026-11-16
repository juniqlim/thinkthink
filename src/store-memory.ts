import type { LogEntry } from './timeline'
import type { Index, Store, View } from './store'
import { TRASH_DAYS } from './store'
import { extractTags } from './tags'
import { matches } from './search'
import { monthRange, dayRange, weekRange, daysAgo } from './calendar'
import { metaText } from './import'
import type { Exported } from './export'

/**
 * 바깥이 없는 저장소. 배열 하나가 전부다.
 *
 * 로그인도 네트워크도 암호화도 없다 — 그것들은 Supabase 쪽 사정이고,
 * 여기서는 앱이 혼자 뜨는 것이 목적이다. 테스트와 로컬 개발이 이걸 쓴다.
 */
export function memoryStore(clock: () => Date = () => new Date()): Store {
  let rows: LogEntry[] = []
  let signedIn = true
  const watchers = new Set<() => void>()
  const onAuth = new Set<() => void>()

  const now = () => clock().toISOString()
  const tell = () => { for (const fn of watchers) fn() }

  const put = (row: LogEntry) => { rows = [...rows, row]; tell() }
  const change = (id: string, patch: Partial<LogEntry>) => {
    rows = rows.map(e => (e.id === id ? { ...e, ...patch } : e))
    tell()
  }

  const alive = () => rows.filter(e => e.deleted_at === null)
  const between = (list: LogEntry[], from: string, to: string) =>
    list.filter(e => e.created_at >= from && e.created_at < to)

  return {
    async session() {
      return signedIn ? { email: 'dev@localhost' } : null
    },
    onAuth(fn) { onAuth.add(fn) },
    async signInGoogle() {
      signedIn = true
      for (const fn of onAuth) fn()
      return null
    },
    async signInEmail() {
      signedIn = true
      for (const fn of onAuth) fn()
      return null
    },
    async signOut() {
      signedIn = false
      for (const fn of onAuth) fn()
    },

    async index(): Promise<Index> {
      const live = alive()
      const cut = daysAgo(TRASH_DAYS, clock())
      return {
        dates: live.map(e => e.created_at),
        tags: live.map(e => e.tags),
        trashCount: rows.filter(e => e.deleted_at !== null && e.deleted_at >= cut).length,
      }
    },

    async list(view: View): Promise<LogEntry[]> {
      if (view.kind === 'trash') {
        const cut = daysAgo(TRASH_DAYS, clock())
        return rows
          .filter(e => e.deleted_at !== null && e.deleted_at >= cut)
          .sort((a, b) => (a.deleted_at! < b.deleted_at! ? 1 : -1))
      }

      const live = alive().sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
      if (view.kind === 'month') {
        const { from, to } = monthRange(view.year, view.month)
        return between(live, from, to)
      }
      if (view.kind === 'day') {
        const { from, to } = dayRange(view.year, view.month, view.day)
        return between(live, from, to)
      }
      if (view.kind === 'week') {
        const { from, to } = weekRange(view.year, view.month, view.day)
        return between(live, from, to)
      }
      if (view.kind === 'tag') return live.filter(e => e.tags.includes(view.tag))
      return live.filter(e => matches(e.body, view.q))
    },

    async all(): Promise<LogEntry[]> {
      return alive().sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    },

    async add(body: string, meta: string | null, written?: string) {
      const at = written ?? now()
      put({
        id: crypto.randomUUID(),
        body,
        tags: extractTags(body),
        created_at: at,
        updated_at: at,
        deleted_at: null,
        meta,
      })
    },
    async insertMany(items: Exported[]) {
      rows = [...rows, ...items.map(item => ({
        id: crypto.randomUUID(),
        body: item.body,
        tags: item.tags,
        created_at: new Date(item.at).toISOString(),
        updated_at: new Date(item.edited ?? item.at).toISOString(),
        deleted_at: null,
        meta: metaText(item.meta),
      }))]
      tell()
    },

    async edit(id: string, body: string) {
      change(id, { body, tags: extractTags(body), updated_at: now() })
    },
    async setTags(id: string, tags: string[]) { change(id, { tags }) },
    async trash(id: string) { change(id, { deleted_at: now() }) },
    async restore(id: string) { change(id, { deleted_at: null }) },
    async purge(id: string) { rows = rows.filter(e => e.id !== id); tell() },

    watch(fn) {
      watchers.add(fn)
      return () => { watchers.delete(fn) }
    },
  }
}

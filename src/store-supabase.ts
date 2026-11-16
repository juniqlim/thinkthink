import { createClient, type Session } from '@supabase/supabase-js'
import type { LogEntry } from './timeline'
import type { Index, Store, View } from './store'
import { TRASH_DAYS } from './store'
import { extractTags } from './tags'
import { matches } from './search'
import { monthRange, dayRange, daysAgo } from './calendar'
import { importKey, encrypt, decrypt, isEncrypted } from './crypto'
import { metaText } from './import'
import type { Exported } from './export'
import { share } from './share'
import { loadKey, saveKey, clearKey } from './keycache'
import { keyError } from './denied'

const SUPABASE_URL = 'https://zuvifgiiahbypxsvnzvg.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1dmlmZ2lpYWhieXB4c3ZuenZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4NTMwNDQsImV4cCI6MjEwMDQyOTA0NH0.sVexgnQmy0YRcg3bjq0ThHB8sgPLtn1X3SDDyUbeG18'

/**
 * 진짜 저장소. 부르는 쪽은 이 안을 몰라도 된다.
 *
 * 본문 암호화가 여기 있는 이유: 밖에서 평문만 오가야 저장소를 갈아끼울 수 있다.
 * 키는 Supabase 가 아니라 우리 함수(/api/key)가 내준다 — 열쇠를 자물쇠 옆에 두지 않는다.
 */
export function supabaseStore(): Store {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON)
  let key: CryptoKey | null = null
  /** 지금 든 키가 캐시에서 왔는가 — 서버가 키를 갈았으면 낡았을 수 있다 */
  let cached = false
  let channel: ReturnType<typeof sb.channel> | null = null

  const seal = (plain: string) => encrypt(plain, key!)
  const sealMeta = async (meta: unknown) => {
    const text = metaText(meta)
    return text === null ? null : await seal(text)
  }

  /** 한 건이 깨져도 나머지는 보여준다 — 조용히 사라지는 것보다 낫다 */
  const unseal = (rows: LogEntry[]) => Promise.all(rows.map(async e => ({
    ...e,
    body: await open(e.body) ?? '⚠️ 복호화하지 못했습니다',
    meta: e.meta === null ? null : await open(e.meta),
  })))

  /** 밖으로는 평문만 내보낸다 — 정황도 예외가 아니다 */
  async function open(value: string): Promise<string | null> {
    if (!isEncrypted(value)) return value   // 마이그레이션 전 평문
    try {
      return await decrypt(value, key!)
    } catch {
      const fresh = await refetch('dek')
      if (fresh === null) return null
      try {
        return await decrypt(value, fresh)
      } catch {
        return null
      }
    }
  }

  /**
   * 안 열리면 캐시 탓부터 의심한다 — 서버가 키를 갈았으면 담아둔 키는 낡는다.
   * 버리고 새로 받아 한 번 더 연다. 방금 서버에서 받은 키면 다시 받아도 같으니 접는다.
   */
  const refetch = share(async (): Promise<CryptoKey | null> => {
    if (!cached) return null
    await clearKey()
    const { data: { session } } = await sb.auth.getSession()
    if (!session) return null
    key = await fetchKey((session as Session).access_token)
    cached = false
    return key
  })

  /** 부팅 한 번에 로그인 사실이 세 번 온다. 열쇠는 그중 한 번만 받아오면 된다 */
  const fetchKey = share(async (token: string): Promise<CryptoKey> => {
    const res = await fetch('/api/key', { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) throw keyError(res.status)
    const { key: raw } = await res.json() as { key: string }
    const imported = await importKey(raw)
    void saveKey(imported, Date.now())   // 다음 부팅은 이 왕복(폰에서 2.5초)을 건너뛴다
    return imported
  })

  const redirect = () => location.origin + location.pathname

  return {
    async session() {
      const { data: { session } } = await sb.auth.getSession()
      if (!session) { key = null; void clearKey(); return null }

      const token = (session as Session).access_token
      const kept = await loadKey(Date.now())
      cached = kept !== null
      // 키가 없으면 본문을 읽을 수도 쓸 수도 없다
      key = kept ?? await fetchKey(token)
      sb.realtime.setAuth(token)
      return { email: (session as Session).user.email ?? '' }
    },
    onAuth(fn) { sb.auth.onAuthStateChange(() => { fn() }) },

    async signInGoogle() {
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirect() },
      })
      return error?.message ?? null
    },
    async signInEmail(email: string) {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirect() },
      })
      return error?.message ?? null
    },
    async signOut() { await clearKey(); await sb.auth.signOut() },   // 나간 뒤에 열쇠가 남으면 안 된다

    async index(): Promise<Index> {
      // 서로 기다릴 이유가 없는 두 물음이다 — 나란히 보내면 둘 중 느린 만큼만 걸린다
      const [live, trash] = await Promise.all([
        sb.from('entries').select('created_at, tags').is('deleted_at', null),
        sb.from('entries').select('id', { count: 'exact', head: true })
          .gte('deleted_at', daysAgo(TRASH_DAYS, new Date())),
      ])
      if (live.error) throw new Error(live.error.message)

      const rows = live.data ?? []
      return {
        dates: rows.map(r => r.created_at as string),
        tags: rows.map(r => (r.tags ?? []) as string[]),
        trashCount: trash.count ?? 0,
      }
    },

    async list(view: View): Promise<LogEntry[]> {
      if (view.kind === 'trash') {
        const { data, error } = await sb.from('entries')
          .select('*')
          .gte('deleted_at', daysAgo(TRASH_DAYS, new Date()))
          .order('deleted_at', { ascending: false })
        if (error) throw new Error(error.message)
        return unseal((data ?? []) as LogEntry[])
      }

      let q = sb.from('entries').select('*').is('deleted_at', null)
      if (view.kind === 'month') {
        const { from, to } = monthRange(view.year, view.month)
        q = q.gte('created_at', from).lt('created_at', to)
      } else if (view.kind === 'day') {
        const { from, to } = dayRange(view.year, view.month, view.day)
        q = q.gte('created_at', from).lt('created_at', to)
      } else if (view.kind === 'tag') {
        q = q.contains('tags', [view.tag])
      }
      // 검색은 거르지 않고 전량 받는다 — 서버가 보는 건 암호문뿐이라 ILIKE 를 쓸 수 없다

      const { data, error } = await q.order('created_at', { ascending: true })
      if (error) throw new Error(error.message)

      const rows = await unseal((data ?? []) as LogEntry[])
      return view.kind === 'search' ? rows.filter(e => matches(e.body, view.q)) : rows
    },

    async all(): Promise<LogEntry[]> {
      const { data, error } = await sb.from('entries')
        .select('*').is('deleted_at', null)
        .order('created_at', { ascending: true })
      if (error) throw new Error(error.message)
      return unseal((data ?? []) as LogEntry[])
    },

    async add(body: string, meta: string | null, at?: string) {
      // 태그는 평문에서 뽑아 평문으로 저장한다 (서버 태그 필터를 살리기 위해)
      const row: Record<string, unknown> = {
        body: await seal(body),
        tags: extractTags(body),
        meta: meta && await seal(meta),
      }
      // 쓴 시각을 받았으면 그것으로 남긴다. 트리거는 update 에만 걸리므로
      // updated_at 을 같이 적어야 쓰자마자 고친 것처럼 보이지 않는다
      if (at !== undefined) { row.created_at = at; row.updated_at = at }

      const { error } = await sb.from('entries').insert(row)
      if (error) throw new Error(error.message)
    },
    async insertMany(items: Exported[]) {
      const rows = await Promise.all(items.map(async item => ({
        body: await seal(item.body),
        tags: item.tags,
        created_at: new Date(item.at).toISOString(),
        // 트리거는 update 에만 걸린다 — 넣을 때는 우리가 적은 값이 남는다
        updated_at: new Date(item.edited ?? item.at).toISOString(),
        meta: await sealMeta(item.meta),
      })))

      // 한 번에 다 보내면 큰 사본에서 요청이 막힌다
      for (let at = 0; at < rows.length; at += 100) {
        const { error } = await sb.from('entries').insert(rows.slice(at, at + 100))
        if (error) throw new Error(error.message)
      }
    },

    async edit(id: string, body: string) {
      const { error } = await sb.from('entries')
        .update({ body: await seal(body), tags: extractTags(body) }).eq('id', id)
      if (error) throw new Error(error.message)
    },
    async setTags(id: string, tags: string[]) {
      const { error } = await sb.from('entries').update({ tags }).eq('id', id)
      if (error) throw new Error(error.message)
    },
    async trash(id: string) {
      const { error } = await sb.from('entries')
        .update({ deleted_at: new Date().toISOString() }).eq('id', id)
      if (error) throw new Error(error.message)
    },
    async restore(id: string) {
      const { error } = await sb.from('entries').update({ deleted_at: null }).eq('id', id)
      if (error) throw new Error(error.message)
    },
    async purge(id: string) {
      const { error } = await sb.from('entries').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },

    watch(fn) {
      if (!channel) {
        channel = sb.channel('entries-sync')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, () => fn())
          .subscribe()
      }
      return () => {
        if (!channel) return
        sb.removeChannel(channel)
        channel = null
      }
    },
  }
}

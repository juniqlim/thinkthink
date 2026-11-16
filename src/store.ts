import type { LogEntry } from './timeline'
import type { Exported } from './export'

/** 휴지통은 최근 이 기간만 보여준다 (데이터는 지우지 않는다) */
export const TRASH_DAYS = 7

/** 무엇을 보고 있는가 — 달·날·태그·검색·휴지통 */
export type View =
  | { kind: 'month'; year: number; month: number }
  | { kind: 'day'; year: number; month: number; day: number }
  /** year·month·day 는 그 주의 월요일 */
  | { kind: 'week'; year: number; month: number; day: number }
  | { kind: 'tag'; tag: string }
  | { kind: 'search'; q: string }
  | { kind: 'trash' }

/** 사이드바를 그릴 재료 — 본문은 필요 없다 */
export interface Index {
  dates: string[]
  tags: string[][]
  trashCount: number
}

/**
 * 로그를 담아두는 곳.
 *
 * 부르는 쪽은 이 약속만 안다 — 뒤가 Supabase 인지 메모리인지 몰라야 한다.
 * 본문 암호화도 이 안쪽 사정이다. 밖에서는 평문만 오간다.
 */
export interface Store {
  /** 로그인한 사람. 없으면 null */
  session(): Promise<{ email: string } | null>
  /** 로그인 상태가 바뀔 때마다 부른다 */
  onAuth(fn: () => void): void
  signInGoogle(): Promise<string | null>
  signInEmail(email: string): Promise<string | null>
  signOut(): Promise<void>

  index(): Promise<Index>
  list(view: View): Promise<LogEntry[]>
  /** 내보내기용 전량 — 버린 것은 빼고 쓴 순서대로 */
  all(): Promise<LogEntry[]>

  /** at 은 쓴 시각. 주지 않으면 저장이 끝나는 시각으로 남는다 */
  add(body: string, meta: string | null, at?: string): Promise<void>
  /** 내보낸 사본을 되돌린다 — 쓴 시각을 살려 넣는다 */
  insertMany(items: Exported[]): Promise<void>
  edit(id: string, body: string): Promise<void>
  setTags(id: string, tags: string[]): Promise<void>
  trash(id: string): Promise<void>
  restore(id: string): Promise<void>
  purge(id: string): Promise<void>

  /** 다른 기기가 고친 것을 받는다. 그만 받으려면 돌려받은 함수를 부른다 */
  watch(fn: () => void): () => void
}

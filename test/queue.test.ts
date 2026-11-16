import { describe, it, expect } from 'vitest'
import {
  enqueue, dequeue, markFailed, reasonOf, next, withPending, load, save,
  type Pending, type Store,
} from '../src/queue'

const p = (id: string, at: string, body = '글'): Pending =>
  ({ id, body, meta: null, at, failed: false })

const entry = (at: string, body = '이미 올라간 글') => ({
  id: 'server-' + at, body, created_at: at, updated_at: at,
  tags: [], deleted_at: null, meta: null,
})

const day = { kind: 'day', year: 2026, month: 7, day: 25 } as const

function memory(): Store {
  const map = new Map<string, string>()
  return {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v) },
    removeItem: k => { map.delete(k) },
  }
}


describe('큐 — 넣고 빼기', () => {
  it('뒤에 붙는다 — 쓴 차례대로 나간다', () => {
    const q = enqueue(enqueue([], p('a', '2026-07-25T10:00:00Z')), p('b', '2026-07-25T10:01:00Z'))

    expect(q.map(i => i.id)).toEqual(['a', 'b'])
  })

  it('보낸 것은 빠진다', () => {
    const q = enqueue(enqueue([], p('a', '2026-07-25T10:00:00Z')), p('b', '2026-07-25T10:01:00Z'))

    expect(dequeue(q, 'a').map(i => i.id)).toEqual(['b'])
  })

  it('없는 것을 빼도 그대로다 — 두 번 보내도 큐가 망가지지 않는다', () => {
    const q = enqueue([], p('a', '2026-07-25T10:00:00Z'))

    expect(dequeue(q, '없다')).toEqual(q)
  })

  it('맨 앞부터 보낸다', () => {
    const q = enqueue(enqueue([], p('a', '2026-07-25T10:00:00Z')), p('b', '2026-07-25T10:01:00Z'))

    expect(next(q)?.id).toBe('a')
  })

  it('빈 큐는 보낼 것이 없다', () => {
    expect(next([])).toBeNull()
  })

  it('실패해도 큐에 남는다 — 표시만 바뀐다', () => {
    const q = markFailed(enqueue([], p('a', '2026-07-25T10:00:00Z')), 'a', '연결 실패')

    expect(q).toHaveLength(1)
    expect(q[0].failed).toBe(true)
  })

  it('실패한 것도 다시 보낸다 — 맨 앞이면 차례가 온다', () => {
    const q = markFailed(enqueue([], p('a', '2026-07-25T10:00:00Z')), 'a', '연결 실패')

    expect(next(q)?.id).toBe('a')
  })

  it('왜 실패했는지 함께 들고 있는다 — 폰에는 콘솔이 없다', () => {
    const q = markFailed(enqueue([], p('a', '2026-07-25T10:00:00Z')), 'a', 'JWT expired')

    expect(q[0].error).toBe('JWT expired')
  })

  it('다시 실패하면 마지막 사유로 바꾼다', () => {
    const once = markFailed(enqueue([], p('a', '2026-07-25T10:00:00Z')), 'a', '연결 실패')

    expect(markFailed(once, 'a', 'JWT expired')[0].error).toBe('JWT expired')
  })
})

describe('큐 — 사유를 한 줄로', () => {
  it('Error 는 이름과 메시지를 붙인다 — 이름이 곧 실마리다', () => {
    expect(reasonOf(new TypeError('Load failed'))).toBe('TypeError: Load failed')
  })

  it('Supabase 오류는 딸린 단서까지 남긴다', () => {
    const e = { message: 'JWT expired', code: 'PGRST301', details: null, hint: null }

    expect(reasonOf(e)).toBe('JWT expired code=PGRST301')
  })

  it('문자열로 던진 것도 그대로 쓴다', () => {
    expect(reasonOf('그냥 문자열')).toBe('그냥 문자열')
  })

  it('아무것도 없으면 없다고 말한다 — 빈 칸은 더 헷갈린다', () => {
    expect(reasonOf(null)).toBe('알 수 없는 오류')
    expect(reasonOf({})).toBe('알 수 없는 오류')
  })
})


describe('큐 — 화면에 얹기', () => {
  it('아직 못 보낸 글도 제자리에 보인다', () => {
    const rows = [entry('2026-07-25T10:00:00.000Z')]
    const q = [p('a', '2026-07-25T10:05:00.000Z', '방금 쓴 글')]

    const shown = withPending(rows, q, day)

    expect(shown.map(e => e.body)).toEqual(['이미 올라간 글', '방금 쓴 글'])
  })

  it('쓴 시각 자리에 끼워 넣는다 — 늦게 보내도 순서가 지켜진다', () => {
    const rows = [entry('2026-07-25T10:00:00.000Z'), entry('2026-07-25T10:10:00.000Z')]
    const q = [p('a', '2026-07-25T10:05:00.000Z', '사이에 쓴 글')]

    const shown = withPending(rows, q, day)

    expect(shown[1].body).toBe('사이에 쓴 글')
  })

  it('못 보냈다는 표시를 달고 나온다', () => {
    const shown = withPending([], [p('a', '2026-07-25T10:00:00.000Z')], day)

    expect(shown[0].pending).toBe(true)
    expect(shown[0].failed).toBe(false)
  })

  it('실패 사유도 화면까지 들고 나온다 — 여기가 유일하게 보이는 자리다', () => {
    const q = markFailed([p('a', '2026-07-25T10:00:00.000Z')], 'a', 'JWT expired')

    const shown = withPending([], q, day)

    expect(shown[0].error).toBe('JWT expired')
  })

  it('본문에서 태그를 뽑아 보여준다 — 올라간 뒤와 같은 모습이어야 한다', () => {
    const shown = withPending([], [p('a', '2026-07-25T10:00:00.000Z', '오늘 #일기')], day)

    expect(shown[0].tags).toEqual(['일기'])
  })

  it('다른 날을 보고 있으면 얹지 않는다', () => {
    const q = [p('a', '2026-07-25T10:00:00.000Z')]

    const shown = withPending([], q, { kind: 'day', year: 2026, month: 7, day: 24 })

    expect(shown).toEqual([])
  })

  it('휴지통에는 얹지 않는다 — 지운 것을 보는 자리다', () => {
    const q = [p('a', '2026-07-25T10:00:00.000Z')]

    expect(withPending([], q, { kind: 'trash' })).toEqual([])
  })

  it('그 달을 보고 있으면 얹는다', () => {
    const q = [p('a', '2026-07-25T10:00:00.000Z')]

    const shown = withPending([], q, { kind: 'month', year: 2026, month: 7 })

    expect(shown).toHaveLength(1)
  })

  it('그 주를 보고 있으면 얹는다', () => {
    const q = [p('a', new Date(2026, 6, 26, 10).toISOString())]

    expect(withPending([], q, { kind: 'week', year: 2026, month: 7, day: 20 })).toHaveLength(1)
    expect(withPending([], q, { kind: 'week', year: 2026, month: 7, day: 27 })).toEqual([])
  })
})


describe('큐 — 남겨두기', () => {
  it('적어둔 것을 그대로 돌려준다 — 탭이 죽어도 글은 남는다', () => {
    const store = memory()
    const q = enqueue([], p('a', '2026-07-25T10:00:00.000Z', '못 보낸 글'))

    save(q, store)

    expect(load(store)).toEqual(q)
  })

  it('적어둔 적 없으면 빈 큐다', () => {
    expect(load(memory())).toEqual([])
  })

  it('빈 큐를 적으면 지운다 — 다 보내고 나면 흔적을 남기지 않는다', () => {
    const store = memory()
    save(enqueue([], p('a', '2026-07-25T10:00:00.000Z')), store)

    save([], store)

    expect(store.getItem('thinkthink:queue')).toBeNull()
  })

  it('깨진 것이 적혀 있어도 앱은 뜬다', () => {
    const store = memory()
    store.setItem('thinkthink:queue', '{[망가진')

    expect(load(store)).toEqual([])
  })

  it('저장소가 막혀 있어도 글쓰기를 막지 않는다', () => {
    const broken: Store = {
      getItem: () => { throw new Error('접근 불가') },
      setItem: () => { throw new Error('용량 초과') },
      removeItem: () => { throw new Error('접근 불가') },
    }

    expect(() => save([p('a', '2026-07-25T10:00:00.000Z')], broken)).not.toThrow()
    expect(load(broken)).toEqual([])
  })
})

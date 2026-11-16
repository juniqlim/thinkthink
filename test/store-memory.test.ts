import { describe, it, expect } from 'vitest'
import { memoryStore } from '../src/store-memory'

/** 시계를 쥐고 시작한다 — 언제 돌려도 같은 결과여야 한다 */
const at = (iso: string) => new Date(iso)
const make = () => {
  let now = at('2026-07-25T10:00:00Z')
  const store = memoryStore(() => now)
  return { store, set: (iso: string) => { now = at(iso) } }
}

const day = { kind: 'day', year: 2026, month: 7, day: 25 } as const
const month = { kind: 'month', year: 2026, month: 7 } as const

describe('memoryStore — 로그인', () => {
  it('바깥이 없으니 늘 들어와 있다', async () => {
    const { store } = make()
    expect(await store.session()).not.toBeNull()
  })

  it('나가면 로그인 화면으로 돌아간다', async () => {
    const { store } = make()
    await store.signOut()
    expect(await store.session()).toBeNull()
  })

  it('다시 들어올 수 있다', async () => {
    const { store } = make()
    await store.signOut()
    expect(await store.signInEmail('nobody@example.com')).toBeNull()
    expect(await store.session()).not.toBeNull()
  })
})

describe('memoryStore — 쓰고 읽기', () => {
  it('처음에는 비어 있다', async () => {
    const { store } = make()
    expect(await store.list(day)).toEqual([])
  })

  it('쓰면 그날 목록에 나온다', async () => {
    const { store } = make()
    await store.add('첫 줄', null)
    const [e] = await store.list(day)
    expect(e.body).toBe('첫 줄')
    expect(e.created_at).toBe('2026-07-25T10:00:00.000Z')
  })

  it('쓴 시각을 받으면 그것을 남긴다 — 저장이 늦어도 누른 때로 남아야 한다', async () => {
    const { store, set } = make()

    set('2026-07-25T10:00:30Z')                       // 위치를 기다리는 사이 시계가 갔다
    await store.add('첫 줄', null, '2026-07-25T10:00:00.000Z')

    const [e] = await store.list(day)
    expect(e.created_at).toBe('2026-07-25T10:00:00.000Z')
    expect(e.updated_at).toBe('2026-07-25T10:00:00.000Z')   // 쓰자마자는 고친 적이 없다
  })

  it('본문에서 태그를 뽑아 함께 담는다', async () => {
    const { store } = make()
    await store.add('뽀모도로 해볼까 #일기 #할일', null)
    const [e] = await store.list(day)
    expect(e.tags).toEqual(['일기', '할일'])
  })

  it('오래된 순으로 준다 — 화면이 위에서 아래로 흐른다', async () => {
    const { store, set } = make()
    await store.add('먼저', null)
    set('2026-07-25T11:00:00Z')
    await store.add('나중', null)
    expect((await store.list(day)).map(e => e.body)).toEqual(['먼저', '나중'])
  })

  it('다른 날 것은 섞이지 않는다', async () => {
    const { store, set } = make()
    await store.add('25일', null)
    set('2026-07-26T10:00:00Z')
    await store.add('26일', null)
    expect((await store.list(day)).map(e => e.body)).toEqual(['25일'])
    expect((await store.list(month)).map(e => e.body)).toEqual(['25일', '26일'])
  })

  it('한 주는 월요일부터 일요일까지 모아본다', async () => {
    const { store, set } = make()
    await store.add('토', null)
    set('2026-07-26T10:00:00Z')
    await store.add('일', null)
    set('2026-07-27T10:00:00Z')
    await store.add('다음 주 월', null)
    expect((await store.list({ kind: 'week', year: 2026, month: 7, day: 20 })).map(e => e.body))
      .toEqual(['토', '일'])
  })

  it('태그로 모아본다', async () => {
    const { store } = make()
    await store.add('가 #책', null)
    await store.add('나 #영화', null)
    const got = await store.list({ kind: 'tag', tag: '책' })
    expect(got.map(e => e.body)).toEqual(['가 #책'])
  })

  it('검색은 본문을 훑는다', async () => {
    const { store } = make()
    await store.add('타코 먹고싶다', null)
    await store.add('영화 볼까', null)
    const got = await store.list({ kind: 'search', q: '타코' })
    expect(got.map(e => e.body)).toEqual(['타코 먹고싶다'])
  })
})

describe('memoryStore — 고치고 지우기', () => {
  it('고치면 본문과 태그가 함께 바뀐다', async () => {
    const { store } = make()
    await store.add('처음 #가', null)
    const [e] = await store.list(day)
    await store.edit(e.id, '고침 #나')
    const [after] = await store.list(day)
    expect(after.body).toBe('고침 #나')
    expect(after.tags).toEqual(['나'])
  })

  it('고친 시각을 남긴다', async () => {
    const { store, set } = make()
    await store.add('처음', null)
    set('2026-07-25T12:00:00Z')
    const [e] = await store.list(day)
    await store.edit(e.id, '고침')
    const [after] = await store.list(day)
    expect(after.updated_at).toBe('2026-07-25T12:00:00.000Z')
  })

  it('태그만 따로 붙일 수 있다', async () => {
    const { store } = make()
    await store.add('본문 그대로', null)
    const [e] = await store.list(day)
    await store.setTags(e.id, ['나중에'])
    const [after] = await store.list(day)
    expect(after.tags).toEqual(['나중에'])
    expect(after.body).toBe('본문 그대로')
  })

  it('버리면 목록에서 빠지고 휴지통에 담긴다', async () => {
    const { store } = make()
    await store.add('버릴 것', null)
    const [e] = await store.list(day)
    await store.trash(e.id)
    expect(await store.list(day)).toEqual([])
    expect((await store.list({ kind: 'trash' })).map(x => x.body)).toEqual(['버릴 것'])
  })

  it('되살리면 제자리로 돌아온다', async () => {
    const { store } = make()
    await store.add('되살릴 것', null)
    const [e] = await store.list(day)
    await store.trash(e.id)
    await store.restore(e.id)
    expect((await store.list(day)).map(x => x.body)).toEqual(['되살릴 것'])
    expect(await store.list({ kind: 'trash' })).toEqual([])
  })

  it('완전히 지우면 휴지통에도 없다', async () => {
    const { store } = make()
    await store.add('영영 지울 것', null)
    const [e] = await store.list(day)
    await store.trash(e.id)
    await store.purge(e.id)
    expect(await store.list({ kind: 'trash' })).toEqual([])
  })

  it('휴지통은 최근 것만 보여준다 — 오래된 것은 지나간다', async () => {
    const { store, set } = make()
    await store.add('옛날 것', null)
    const [e] = await store.list(day)
    await store.trash(e.id)
    set('2026-08-25T10:00:00Z')
    expect(await store.list({ kind: 'trash' })).toEqual([])
  })
})

describe('memoryStore — 사이드바 재료', () => {
  it('날짜와 태그와 휴지통 개수를 준다', async () => {
    const { store, set } = make()
    await store.add('가 #책', null)
    set('2026-07-26T10:00:00Z')
    await store.add('나 #책 #영화', null)
    await store.add('버릴 것', null)
    const trashed = (await store.list({ kind: 'day', year: 2026, month: 7, day: 26 }))
      .find(e => e.body === '버릴 것')!
    await store.trash(trashed.id)

    const idx = await store.index()
    expect(idx.dates).toEqual(['2026-07-25T10:00:00.000Z', '2026-07-26T10:00:00.000Z'])
    expect(idx.tags).toEqual([['책'], ['책', '영화']])
    expect(idx.trashCount).toBe(1)
  })

  it('버린 것은 날짜에도 태그에도 세지 않는다', async () => {
    const { store } = make()
    await store.add('버릴 것 #책', null)
    const [e] = await store.list(day)
    await store.trash(e.id)
    const idx = await store.index()
    expect(idx.dates).toEqual([])
    expect(idx.tags).toEqual([])
  })
})

describe('memoryStore — 전량', () => {
  it('내보내려면 달을 가리지 않고 전부 준다', async () => {
    const { store, set } = make()
    await store.add('칠월', null)
    set('2026-09-01T10:00:00Z')
    await store.add('구월', null)

    expect((await store.all()).map(e => e.body)).toEqual(['칠월', '구월'])
  })

  it('버린 것은 내보내지 않는다', async () => {
    const { store } = make()
    await store.add('버릴 것', null)
    const [e] = await store.list(day)
    await store.trash(e.id)

    expect(await store.all()).toEqual([])
  })

  it('정황을 함께 준다 — 백업에서 빠지면 안 된다', async () => {
    const { store } = make()
    await store.add('걸었다', '{"dev":"iPhone"}')

    expect((await store.all())[0].meta).toBe('{"dev":"iPhone"}')
  })
})

describe('memoryStore — 되읽기', () => {
  const item = {
    id: '옛것', at: '2026-05-01T03:00:00.000Z', edited: null,
    tags: ['산책'], body: '걸었다', meta: '{"dev":"iPhone"}',
  }

  it('쓴 시각을 살려서 넣는다 — 넣은 시각으로 덮으면 백업이 아니다', async () => {
    const { store } = make()
    await store.insertMany([item])

    const [got] = await store.all()
    expect(got.created_at).toBe('2026-05-01T03:00:00.000Z')
    expect(got.updated_at).toBe('2026-05-01T03:00:00.000Z')
  })

  it('본문·태그·정황을 그대로 옮긴다', async () => {
    const { store } = make()
    await store.insertMany([item])

    const [got] = await store.all()
    expect(got.body).toBe('걸었다')
    expect(got.tags).toEqual(['산책'])
    expect(got.meta).toBe('{"dev":"iPhone"}')
  })

  it('고친 적이 있으면 그 시각도 살린다', async () => {
    const { store } = make()
    await store.insertMany([{ ...item, edited: '2026-05-02T03:00:00.000Z' }])

    expect((await store.all())[0].updated_at).toBe('2026-05-02T03:00:00.000Z')
  })

  it('넣고 나면 지켜보던 쪽이 안다', async () => {
    const { store } = make()
    let told = 0
    store.watch(() => { told++ })
    await store.insertMany([item])
    expect(told).toBe(1)
  })
})

describe('memoryStore — 바뀔 때 알린다', () => {
  it('쓰면 지켜보던 쪽이 안다', async () => {
    const { store } = make()
    let called = 0
    store.watch(() => { called++ })
    await store.add('한 줄', null)
    expect(called).toBe(1)
  })

  it('그만 보겠다면 더 부르지 않는다', async () => {
    const { store } = make()
    let called = 0
    const stop = store.watch(() => { called++ })
    stop()
    await store.add('한 줄', null)
    expect(called).toBe(0)
  })
})

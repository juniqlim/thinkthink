import { describe, it, expect } from 'vitest'
import { isSubmit, isCancel, onLeave, grownHeight, followsKeyboard } from '../src/input'

const key = (key: string, opts: { shiftKey?: boolean; isComposing?: boolean } = {}) =>
  ({ key, shiftKey: opts.shiftKey ?? false, isComposing: opts.isComposing ?? false })


describe('isSubmit', () => {
  it('Enter 면 보낸다', () => {
    expect(isSubmit(key('Enter'))).toBe(true)
  })

  it('Shift+Enter 는 줄바꿈이므로 보내지 않는다', () => {
    expect(isSubmit(key('Enter', { shiftKey: true }))).toBe(false)
  })

  // 조합 중 Enter 는 글자를 확정하려는 것이지 보내려는 게 아니다.
  // 여기서 보내면 확정된 마지막 글자가 빈 입력창에 남아 한 번 더 전송된다.
  it('한글을 조합하는 중이면 보내지 않는다', () => {
    expect(isSubmit(key('Enter', { isComposing: true }))).toBe(false)
  })

  it('다른 키는 보내지 않는다', () => {
    expect(isSubmit(key('a'))).toBe(false)
    expect(isSubmit(key('Escape'))).toBe(false)
  })
})


describe('isCancel', () => {
  it('Escape 면 취소한다', () => {
    expect(isCancel(key('Escape'))).toBe(true)
  })

  it('조합 중 Escape 는 조합을 무르는 것이라 취소하지 않는다', () => {
    expect(isCancel(key('Escape', { isComposing: true }))).toBe(false)
  })

  it('다른 키는 취소하지 않는다', () => {
    expect(isCancel(key('Enter'))).toBe(false)
  })
})


describe('고치다 말고 나올 때', () => {
  it('고친 것이 있으면 남긴다 — 나가느라 잃으면 안 된다', () => {
    expect(onLeave('고친 글', '원래 글')).toBe('save')
  })

  it('그대로면 그냥 닫는다 — 손대지 않은 글을 다시 쓸 이유가 없다', () => {
    expect(onLeave('원래 글', '원래 글')).toBe('close')
  })

  it('다 지웠으면 닫는다 — 빈 글은 남기지 않는다', () => {
    expect(onLeave('', '원래 글')).toBe('close')
  })

  it('공백만 남았어도 빈 글로 본다', () => {
    expect(onLeave('   \n  ', '원래 글')).toBe('close')
  })
})


describe('고치는 칸을 글에 맞춰 재기', () => {
  // scrollHeight 는 안쪽 여백까지만 재고 테두리는 빼놓는다. 잰 값을 그대로
  // 높이로 주면 테두리 두께만큼 모자라 마지막 줄이 잘리고 스크롤이 생긴다.
  it('테두리 두께를 얹는다', () => {
    expect(grownHeight({ scrollHeight: 300, offsetHeight: 162, clientHeight: 160 })).toBe(302)
  })

  it('테두리가 없으면 잰 그대로다', () => {
    expect(grownHeight({ scrollHeight: 300, offsetHeight: 160, clientHeight: 160 })).toBe(300)
  })
})


describe('키보드가 올라올 때 마지막 글을 따라가기', () => {
  // 화면이 줄어드는 만큼 아래가 가려진다. 쓰는 중이면 방금 쓴 글이 보여야 한다
  it('쓰는 중에 화면이 줄면 따라간다', () => {
    expect(followsKeyboard({ before: 800, after: 500, writing: true })).toBe(true)
  })

  it('쓰는 중이 아니면 따라가지 않는다 — 읽던 자리를 옮기면 안 된다', () => {
    expect(followsKeyboard({ before: 800, after: 500, writing: false })).toBe(false)
  })

  it('화면이 늘어난 것은 키보드가 내려간 것이라 따라가지 않는다', () => {
    expect(followsKeyboard({ before: 500, after: 800, writing: true })).toBe(false)
  })
})

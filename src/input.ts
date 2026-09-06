/**
 * 키 입력 판정.
 *
 * 한글처럼 조합해서 쓰는 입력기에서는 Enter 가 두 가지 뜻을 갖는다 —
 * 조합 중이면 "이 글자로 확정", 아니면 "보내기". 이걸 구분하지 않으면
 * 확정된 마지막 글자가 빈 입력창에 남아 한 번 더 전송된다.
 */

export interface KeyPress {
  key: string
  shiftKey: boolean
  isComposing: boolean
}

export function isSubmit(e: KeyPress): boolean {
  return e.key === 'Enter' && !e.shiftKey && !e.isComposing
}

export function isCancel(e: KeyPress): boolean {
  return e.key === 'Escape' && !e.isComposing
}

/**
 * 고치다 말고 수정창을 벗어날 때 — 남길 것인가 닫을 것인가.
 *
 * 나가는 길에 고친 것을 잃으면 안 된다. 그래서 기본은 남기기다.
 * 손대지 않았거나 다 지웠으면 남길 것이 없으니 닫기만 한다.
 * 버리려면 Escape 가 따로 있다 — 그쪽이 버리겠다는 뜻이다.
 */
export function onLeave(current: string, original: string): 'save' | 'close' {
  if (current.trim() === '' || current === original) return 'close'
  return 'save'
}

/**
 * 고치는 칸을 글 길이에 맞춰 재준다.
 *
 * scrollHeight 는 안쪽 여백까지만 재고 테두리는 빼놓는다. 잰 값을 그대로
 * 높이로 주면 테두리 두께만큼 모자라 마지막 줄이 잘리고 스크롤이 생긴다.
 * offsetHeight 와 clientHeight 의 차이가 곧 테두리 두께다.
 */
export function grownHeight(
  box: { scrollHeight: number; offsetHeight: number; clientHeight: number },
): number {
  return box.scrollHeight + box.offsetHeight - box.clientHeight
}

/**
 * 키보드가 올라와 화면이 줄었을 때 마지막 글을 따라갈지 정한다.
 *
 * 줄어든 만큼 아래가 가려져 방금 쓴 글이 키보드 밑으로 들어간다. 쓰는 중에는
 * 그 글이 보여야 한다. 읽는 중에 화면이 바뀐 것까지 옮기면 보던 자리를 잃는다.
 */
export function followsKeyboard(
  view: { before: number; after: number; writing: boolean },
): boolean {
  return view.writing && view.after < view.before
}

import { addTag as withTag, tooLong, BODY_MAX } from './entry'
import {
  timeOf, copyEntryText, copyGroupText, tweetLength, TWEET_LIMIT, groupByDate, tagsOf,
  type LogEntry, type TagCount,
} from './timeline'
import { treeOf, today, type YearNode } from './calendar'
import { headingText } from './heading'
import { parseLines, isTag, bareTag, type Piece } from './tags'
import { isSearchable } from './search'
import { followsKeyboard, isSubmit, isCancel, onLeave, grownHeight } from './input'
import { saveDraft, loadDraft } from './draft'
import { needsHint, hintShown } from './hint'
import { enqueue, dequeue, markFailed, reasonOf, next, withPending, isPending, load, save, type Pending } from './queue'
import { isFresh, fixFrom, buildMeta, deviceOf, type Fix } from './meta'
import { buildBackup, deliver, readBackup } from './backup'
import { plan } from './import'
import { currentTheme, toggle, label, barColor, KEY, type Theme } from './theme'
import { TRASH_DAYS, type Store, type View } from './store'
import { pickStore } from './store-pick'
import { report, type Mark } from './boot'
import { wasSignedIn } from './signedin'
import { insideNative, fixFromNative } from './native'
import { share } from './share'
import { swipeAction, type Point } from './swipe'

/** 뒤가 Supabase 인지 메모리인지 이 파일은 모른다 */
const store: Store = pickStore()

const TABS = [
  { id: 'date', label: '날짜' },
  { id: 'tag', label: '태그' },
  { id: 'search', label: '검색' },
] as const
type TabId = (typeof TABS)[number]['id']

let entries: LogEntry[] = []
let tree: YearNode[] = []
let tags: TagCount[] = []
let view: View | null = null
let tab: TabId = 'date'
let trashCount = 0
let openYears = new Set<number>()
let openMonths = new Set<string>()
let unwatch: (() => void) | null = null

const $ = (id: string) => document.getElementById(id)!

/* ---- 부팅에 걸린 시간 (원인을 찾으면 지운다) ---- */

/** 여기까지 온 것만으로 이미 내려받고 해석하는 시간이 지났다 */
const marks: Mark[] = [{ name: '스크립트', at: performance.now() }]

/** 재로그인이나 탭 복귀로 다시 불려도 첫 부팅의 숫자를 덮지 않는다 */
let booted = false

const mark = (name: string) => { if (!booted) marks.push({ name, at: performance.now() }) }

function showBoot() {
  if (booted) return
  booted = true

  const text = report(marks, performance.getEntriesByType('resource'))
  const btn = $('boot') as HTMLButtonElement
  btn.textContent = `${Math.round(marks[marks.length - 1].at)}ms`
  btn.hidden = false
  btn.onclick = () => { void copyToClipboard(text, btn) }
}

/** 글자는 글자로 넣는다 — 붙이는 값이 HTML 로 해석될 여지를 없앤다 */
function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span')
  if (className) el.className = className
  el.textContent = text
  return el
}

/* ---- 글을 쓴 정황 ---- */

/** 이보다 오래된 좌표는 쓰지 않는다 — 그 사이 움직였을 수 있다 */
const FIX_MAX_AGE = 5 * 60_000

/** 위치를 기다려주는 한도. 지하나 권한 거부에서도 글은 반드시 올라가야 한다 */
const FIX_WAIT = 4_000

let lastFix: Fix | null = null

/**
 * 껍데기가 좌표를 밀어 넣는 자리.
 *
 * 앱이 권한을 한 번 받아 계속 물고 있으므로, 여기로 들어온 좌표는
 * 이미 손에 있는 것이다 — 글을 쓸 때 물어보러 갈 일이 없다.
 */
;(window as unknown as { thinkthinkFix?: (raw: unknown) => void }).thinkthinkFix = raw => {
  const fix = fixFromNative(raw)
  if (fix !== null) lastFix = fix
}

/** 정확도를 낮게 잡아 빠른 셀·와이파이 측위를 쓴다. GPS 를 켜면 실내에서 한참 걸린다 */
function locate(timeout: number): Promise<Fix | null> {
  // 껍데기 안에서는 앱이 대준다. 여기서 물으면 웹뷰 몫의 권한을 따로 묻게 된다
  if (insideNative(window)) return Promise.resolve(lastFix)
  if (!('geolocation' in navigator)) return Promise.resolve(null)

  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      p => {
        lastFix = fixFrom(p)
        resolve(lastFix)
      },
      () => resolve(null),   // 거부했거나 못 받았다. 위치 없이 쓴다
      { enableHighAccuracy: false, timeout, maximumAge: FIX_MAX_AGE },
    )
  })
}

/**
 * 뒤에서 미리 받아둔다 — 대개 이걸로 충분해서 쓸 때 기다릴 일이 없다.
 * 아직 신선하면 그냥 쓴다. 열 때마다 받으면 배터리도 권한 표시도 값이 비싸다.
 *
 * 앱이 다 뜬 뒤에 부른다. iOS 는 위치를 물어보는 동안 페이지를 세워버려서,
 * 뜨는 길목에서 부르면 답할 때까지 앱이 뜨다 만 채로 멈춘다.
 */
const trackLocation = () => {
  if (isFresh(lastFix, Date.now(), FIX_MAX_AGE)) return
  void locate(10_000)
}

/** 네트워크 종류는 크롬 계열만 알려준다. 없으면 그 항목만 빠진다 */
function networkType(): string | null {
  const conn = (navigator as { connection?: { effectiveType?: string; type?: string } }).connection
  return conn?.type ?? conn?.effectiveType ?? null
}

/**
 * 글을 쓴 정황. 잠그는 일은 저장소 몫이라 여기서는 평문으로 넘긴다.
 *
 * 기다리지 않는다 — 남기기를 누른 순간 알고 있는 좌표를 쓴다. 오래됐으면
 * 위치 없이 간다. 나중에 받은 좌표를 붙이면 쓴 자리가 아니라 보낸 자리가 된다.
 */
function currentMeta(): string | null {
  const fix = isFresh(lastFix, Date.now(), FIX_MAX_AGE) ? lastFix : null
  if (fix === null) trackLocation()   // 다음 글에는 대어줄 수 있게

  return buildMeta(
    fix,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    deviceOf(navigator.userAgent),
    networkType(),
  )
}

/* ---- auth ---- */
const showAuth = () => { $('auth').hidden = false; $('app').hidden = true }
const showApp = () => { $('auth').hidden = true; $('app').hidden = false }

function stopWatching() {
  unwatch?.()
  unwatch = null
}

/** 세션과 키가 갖춰졌는가 — 갖춰지기 전에 보내면 잠글 열쇠가 없어 실패로 남는다 */
let ready = false

async function refreshAuth() {
  let who: { email: string } | null
  try {
    who = await store.session()
  } catch (e) {
    // 키가 없으면 본문을 읽을 수도 쓸 수도 없다. 반쯤 열린 앱을 보여주지 않는다
    console.error(e)
    $('authmsg').textContent = '암호화 키를 받지 못했습니다. 새로고침해 보세요.'
    ready = false; stopWatching(); showAuth(); return
  }
  if (!who) { ready = false; stopWatching(); showAuth(); return }
  ready = true
  mark('세션·키')

  showApp(); await refreshOnBoot('boot')
  mark('첫 그리기'); showBoot()
  void flush()   // 지난번에 못 보낸 글부터 치운다
  unwatch ??= store.watch(() => { void refresh() })
  trackLocation()   // 맨 끝에 — 위치를 묻는 동안 다른 일이 밀리지 않게
}
/**
 * 확인을 기다리지 않고 먼저 띄운다 — 쓰려고 연 사람을 세워두지 않는다.
 * 목록은 세션이 오는 대로 채워지고, 그 전에 쓴 글은 큐에서 기다린다.
 */
if (wasSignedIn(localStorage)) showApp()

store.onAuth(() => { void refreshAuth() })

$('google').onclick = async () => {
  const error = await store.signInGoogle()
  if (error) $('authmsg').textContent = '오류: ' + error
}

$('login').onclick = async () => {
  const email = ($('email') as HTMLInputElement).value.trim()
  if (!email) return
  $('authmsg').textContent = '전송 중…'
  const error = await store.signInEmail(email)
  $('authmsg').textContent = error ? '오류: ' + error : '메일함을 확인해 링크를 누르세요.'
}

const signOut = async () => { await store.signOut() }

/* ---- data ---- */
function todayView(): View {
  return { kind: 'day', ...today(new Date()) }
}

const isToday = (v: View) =>
  v.kind === 'day' && JSON.stringify(v) === JSON.stringify(todayView())

/** 사이드바 재료(전체 날짜·태그)를 다시 읽는다 */
async function loadIndex() {
  const idx = await store.index()
  trashCount = idx.trashCount
  tree = treeOf(idx.dates)
  tags = tagsOf(idx.tags.map(t => ({ tags: t })))
  if (!view) view = todayView()
  if (view.kind === 'month' || view.kind === 'day') openYears.add(view.year)
  if (view.kind === 'day') openMonths.add(`${view.year}-${view.month}`)
}

async function refresh() {
  // 볼 자리는 이미 정해져 있다 — 사이드바 재료를 기다리지 않고 함께 읽는다
  const at = view ?? todayView()
  try {
    const [, rows] = await Promise.all([loadIndex(), store.list(at)])
    entries = rows
  } catch (e) {
    console.error(e)
    return
  }
  renderAll()
  scrollToLatest()
}

/**
 * 부팅에서만 쓰는 갈래. 로그인 사실이 한 번에 세 번 오는데 그때 읽을 것은 하나다.
 *
 * 다른 자리의 refresh 는 묶지 않는다 — 거기서는 "달라졌으니 다시 읽어라"가 요점이라,
 * 겹친다고 합쳐 버리면 방금 바뀐 것을 놓친다.
 */
const refreshOnBoot = share(() => refresh())

function scrollToLatest() {
  window.scrollTo({ top: document.body.scrollHeight })
}

let queue: Pending[] = load(localStorage)

/**
 * 큐에 넣는 것으로 끝난다 — 보내는 일은 flush 가 뒤에서 한다.
 *
 * 누른 시각을 여기서 잡는다. 서버에 닿기까지 걸린 시간이 글에 얹히면 안 된다.
 */
/**
 * 너무 길면 알리고 받지 않는다.
 *
 * 조용히 삼키면 쓴 사람은 글이 사라진 줄 안다. 얼마나 넘었는지까지 알려야
 * 어디를 줄일지 가늠한다.
 */
function accepts(body: string): boolean {
  if (!tooLong(body)) return true
  alert(`글이 너무 깁니다. ${BODY_MAX}자까지 쓸 수 있습니다 (지금 ${body.length}자).`)
  return false
}

function submit() {
  const ta = $('input') as HTMLTextAreaElement
  const body = ta.value
  if (body.trim() === '') return
  if (!accepts(body)) return

  queue = enqueue(queue, {
    id: crypto.randomUUID(),
    body,
    meta: currentMeta(),
    at: new Date().toISOString(),
    failed: false,
  })
  save(queue, localStorage)

  ta.value = ''; ta.style.height = '42px'
  saveDraft('', localStorage)
  view = todayView()
  renderAll()          // 대기 중인 채로 곧장 화면에 오른다
  scrollToLatest()

  void flush()
}

let flushing = false

/**
 * 큐를 앞에서부터 비운다.
 *
 * 하나가 실패하면 거기서 멈춘다 — 뒤엣것을 먼저 보내면 순서가 뒤집힌다.
 * 실패한 글은 큐에 남는다. 빼는 순간 사라지기 때문이다.
 */
async function flush() {
  if (flushing) return
  if (!ready) return   // 세션이 오면 refreshAuth 가 부른다. 지금 보내면 실패로만 남는다
  flushing = true
  try {
    for (let item = next(queue); item !== null; item = next(queue)) {
      try {
        await store.add(item.body, item.meta, item.at)
      } catch (e) {
        console.error(e)
        queue = markFailed(queue, item.id, reasonOf(e))
        save(queue, localStorage)
        renderAll()
        return
      }
      queue = dequeue(queue, item.id)
      save(queue, localStorage)
    }
    await refresh()   // 다 비웠다 — 서버에 오른 진짜 글로 바꿔 그린다
  } finally {
    flushing = false
  }
}

async function addTag(entry: LogEntry, tag: string) {
  const tagged = withTag(entry, tag)
  if (tagged.tags.length === entry.tags.length) return
  try {
    await store.setTags(entry.id, tagged.tags)
  } catch (e) { console.error(e); return }
  await refresh()
}

async function saveEdit(entry: LogEntry, body: string) {
  if (body.trim() === '' || body === entry.body) return
  if (!accepts(body)) return
  try {
    await store.edit(entry.id, body)
  } catch (e) {
    // 실패해도 수정창은 그대로 둔다 — 고친 내용을 잃지 않는다
    console.error(e)
    alert(`수정하지 못했습니다. 고친 내용은 그대로 두었습니다.\n\n${(e as Error).message}`)
    return
  }
  await refresh()
}

async function restoreEntry(entry: LogEntry) {
  try {
    await store.restore(entry.id)
  } catch (e) { console.error(e); return }
  await refresh()
}

async function purgeEntry(entry: LogEntry) {
  if (!confirm('완전히 지웁니다. 되돌릴 수 없습니다.')) return
  try {
    await store.purge(entry.id)
  } catch (e) { console.error(e); return }
  await refresh()
}

async function removeEntry(entry: LogEntry) {
  if (!confirm('이 로그를 지울까요? (데이터는 남습니다)')) return
  try {
    await store.trash(entry.id)
  } catch (e) { console.error(e); return }
  await refresh()
}

/** 눌렀는지 잠깐 보여준다 — 클립보드는 눈에 보이지 않는다 */
async function copyToClipboard(text: string, btn: HTMLElement, done = '✓') {
  try {
    await navigator.clipboard.writeText(text)
  } catch (e) {
    console.error(e)
    alert('복사하지 못했습니다')
    return
  }
  const mark = btn.textContent
  btn.textContent = done
  setTimeout(() => { btn.textContent = mark }, 1200)
}

/** 전량을 zip 하나로 묶어 넘긴다. 어디에 둘지는 공유시트에서 사용자가 정한다 */
async function exportAll(btn: HTMLButtonElement) {
  const mark = btn.textContent
  btn.disabled = true
  btn.textContent = '내보내는 중…'
  try {
    const rows = await store.all()
    await deliver(buildBackup(rows, Intl.DateTimeFormat().resolvedOptions().timeZone, new Date()))
  } catch (e) {
    console.error(e)
    alert('내보내지 못했습니다')
  } finally {
    btn.disabled = false
    btn.textContent = mark
  }
}

/* ---- 밝게 · 어둡게 ---- */
const theme = () =>
  currentTheme(localStorage.getItem(KEY), matchMedia('(prefers-color-scheme: dark)').matches)

/**
 * color-scheme 만 넘긴다. 색은 CSS 가 쥐고 있다.
 * 상태 표시줄은 media 로 갈라 적어둔 것을 고른 값으로 덮는다.
 */
function setTheme(next: Theme) {
  localStorage.setItem(KEY, next)
  document.documentElement.dataset.theme = next
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', barColor(next))
  }
}

/** 고른 적이 있으면 그것부터 입고 시작한다 */
if (localStorage.getItem(KEY) !== null) setTheme(theme())

const skin = $('skin')
const markSkin = () => { skin.textContent = label(theme()) }
skin.onclick = () => { setTheme(toggle(theme())); markSkin() }
markSkin()

/** 파일을 고르게 하고, 이미 있는 것은 빼고 넣는다 */
function pickBackup(btn: HTMLButtonElement) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.zip,.json,application/zip,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (file === undefined) return
    await importFrom(file, btn)
  }
  input.click()
}

async function importFrom(file: File, btn: HTMLButtonElement) {
  const mark = btn.textContent
  btn.disabled = true
  btn.textContent = '읽는 중…'
  try {
    const incoming = await readBackup(new Uint8Array(await file.arrayBuffer()))
    const { fresh, skipped } = plan(await store.all(), incoming)

    if (fresh.length === 0) {
      alert(`새로 가져올 것이 없습니다 (${skipped}건은 이미 있습니다)`)
      return
    }
    if (!confirm(`${fresh.length}건을 가져옵니다. (${skipped}건은 이미 있습니다)`)) return

    await store.insertMany(fresh)
    await loadIndex()
    await refresh()
    alert(`${fresh.length}건을 가져왔습니다`)
  } catch (e) {
    console.error(e)
    alert(e instanceof Error ? e.message : '가져오지 못했습니다')
  } finally {
    btn.disabled = false
    btn.textContent = mark
  }
}

const homeTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone
// 글 하나는 트위터 셈으로 몇 자인지 함께 보여준다 — 거기 붙이려고 하나만 복사한다
const copyEntry = (entry: LogEntry, btn: HTMLElement) => {
  const text = copyEntryText(entry)
  return copyToClipboard(text, btn, `${tweetLength(text)}/${TWEET_LIMIT}`)
}
const copyGroup = (list: LogEntry[], btn: HTMLElement) => copyToClipboard(copyGroupText(list, homeTz()), btn)

/* ---- sidebar ---- */
const openSidebar = (on: boolean) => {
  $('sidebar').hidden = !on
  $('backdrop').hidden = !on
}

$('menu').onclick = () => { renderSidebar(); openSidebar(true) }
$('backdrop').onclick = () => openSidebar(false)

let touchStart: Point | null = null
document.addEventListener('touchstart', e => {
  // 손가락 둘이면 확대다. 손짓으로 세지 않는다
  touchStart = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null
}, { passive: true })
document.addEventListener('touchend', e => {
  const start = touchStart
  touchStart = null
  if (!start) return
  const t = e.changedTouches[0]
  const act = swipeAction(start, { x: t.clientX, y: t.clientY }, !$('sidebar').hidden)
  if (act === 'open') { renderSidebar(); openSidebar(true) }
  else if (act === 'close') openSidebar(false)
}, { passive: true })

function pick(next: View) {
  view = next
  openSidebar(false)
  refresh()
}

function renderSidebar() {
  const el = $('sidebar')
  el.innerHTML = ''

  const bar = document.createElement('div')
  bar.className = 'tabs'
  for (const t of TABS) {
    const b = document.createElement('button')
    b.className = 'tab' + (tab === t.id ? ' on' : '')
    b.textContent = t.label
    b.onclick = () => { tab = t.id; renderSidebar() }
    bar.appendChild(b)
  }
  el.appendChild(bar)

  const list = document.createElement('div')
  if (tab === 'date') renderDateTree(list)
  else if (tab === 'tag') renderTagList(list)
  else renderSearchBox(list)
  el.appendChild(list)

  const trash = document.createElement('button')
  trash.className = 'trash' + (view?.kind === 'trash' ? ' on' : '')
  trash.innerHTML = `<span>휴지통</span><span class="cnt">${trashCount}</span>`
  trash.onclick = () => pick({ kind: 'trash' })
  el.appendChild(trash)

  const save = document.createElement('button')
  save.className = 'trash out'
  save.textContent = '내보내기'
  save.onclick = () => exportAll(save)
  el.appendChild(save)

  const load = document.createElement('button')
  load.className = 'trash out'
  load.textContent = '가져오기'
  load.onclick = () => pickBackup(load)
  el.appendChild(load)

  const guide = document.createElement('button')
  guide.className = 'trash out'
  guide.textContent = '설명서'
  guide.onclick = () => { $('guide').hidden = false; openSidebar(false) }
  el.appendChild(guide)

  // 자주 누를 일이 없다. 머리말 자리를 차지하느니 여기 둔다
  const out = document.createElement('button')
  out.className = 'trash out'
  out.textContent = '로그아웃'
  out.onclick = signOut
  el.appendChild(out)
}

function renderSearchBox(box: HTMLElement) {
  const input = document.createElement('input')
  input.className = 'find'
  input.placeholder = '검색어'
  input.value = view?.kind === 'search' ? view.q : ''
  input.onkeydown = e => {
    if (!isSubmit(e)) return
    const q = input.value
    if (isSearchable(q)) pick({ kind: 'search', q })
  }
  box.appendChild(input)

  const hint = document.createElement('div')
  hint.className = 'empty'
  hint.textContent = '전체 기간에서 본문을 찾습니다'
  box.appendChild(hint)
  setTimeout(() => input.focus(), 0)
}

function renderDateTree(box: HTMLElement) {
  if (tree.length === 0) { box.innerHTML = '<div class="empty">아직 로그가 없습니다</div>'; return }

  const pad = (n: number) => String(n).padStart(2, '0')

  for (const node of tree) {
    const yearOpen = openYears.has(node.year)
    const y = document.createElement('button')
    y.className = 'yr'
    y.innerHTML = `<span class="caret">${yearOpen ? '⌄' : '›'}</span><span>${node.year}</span>`
    y.onclick = () => {
      yearOpen ? openYears.delete(node.year) : openYears.add(node.year)
      renderSidebar()
    }
    box.appendChild(y)
    if (!yearOpen) continue

    for (const mn of node.months) {
      const key = `${node.year}-${mn.month}`
      const monthOpen = openMonths.has(key)
      const on = view?.kind === 'month' && view.year === node.year && view.month === mn.month

      const m = document.createElement('div')
      m.className = 'row mo' + (on ? ' on' : '')
      const caret = document.createElement('button')
      caret.className = 'caret btn'
      caret.textContent = monthOpen ? '⌄' : '›'
      caret.onclick = () => {
        monthOpen ? openMonths.delete(key) : openMonths.add(key)
        renderSidebar()
      }
      const label = document.createElement('button')
      label.className = 'label'
      label.textContent = pad(mn.month)
      label.onclick = () => pick({ kind: 'month', year: node.year, month: mn.month })
      m.append(caret, label)
      box.appendChild(m)
      if (!monthOpen) continue

      for (const d of mn.days) {
        const dayOn = view?.kind === 'day'
          && view.year === node.year && view.month === mn.month && view.day === d
        const b = document.createElement('button')
        b.className = 'dy' + (dayOn ? ' on' : '')
        b.textContent = pad(d)
        b.onclick = () => pick({ kind: 'day', year: node.year, month: mn.month, day: d })
        box.appendChild(b)
      }
    }
  }
}

function renderTagList(box: HTMLElement) {
  if (tags.length === 0) { box.innerHTML = '<div class="empty">아직 태그가 없습니다</div>'; return }

  for (const { tag, count } of tags) {
    const on = view?.kind === 'tag' && view.tag === tag
    const b = document.createElement('button')
    b.className = 'yr' + (on ? ' on' : '')
    // 태그는 저장된 값 그대로다 — 글자로만 넣는다. 검증을 지나쳐 들어온 것이 있어도 살아나지 않게
    b.append(
      span('caret', '#'),
      span('', tag),
      span('cnt', String(count)),
    )
    b.onclick = () => pick({ kind: 'tag', tag })
    box.appendChild(b)
  }
}

/** 조각을 DOM으로 — innerHTML을 쓰지 않아 본문이 HTML로 해석될 여지가 없다 */
function pieceNode(piece: Piece): Node {
  if (piece.type === 'text') return document.createTextNode(piece.value)

  if (piece.type === 'link') {
    const a = document.createElement('a')
    a.className = 'link'; a.href = piece.value; a.textContent = piece.value
    a.target = '_blank'; a.rel = 'noopener noreferrer'
    return a
  }

  const tag = { bold: 'strong', italic: 'em', code: 'code', strike: 's', tag: 'span' }[piece.type]
  const el = document.createElement(tag)
  if (piece.type === 'tag') { el.className = 'intag'; el.textContent = '#' + piece.value }
  else el.textContent = piece.value
  return el
}

/** 본문 자리에서 바로 고친다 — Enter 저장, Esc 취소 */
function startEdit(box: HTMLElement, entry: LogEntry, btn: HTMLElement) {
  // 고치는 동안 같은 자리가 저장 단추가 된다 — 폰에서는 누를 곳이 보여야 한다
  btn.textContent = '✓'; btn.title = '저장'

  box.textContent = ''
  const ta = document.createElement('textarea')
  ta.className = 'editing'
  ta.value = entry.body
  box.appendChild(ta)

  const fit = () => { ta.style.height = 'auto'; ta.style.height = grownHeight(ta) + 'px' }
  ta.addEventListener('input', fit)
  fit(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length)

  ta.onkeydown = e => {
    if (isCancel(e)) { e.preventDefault(); endEdit(box, entry, btn) }
    if (isSubmit(e)) { e.preventDefault(); saveEdit(entry, ta.value) }
  }
  // 다른 데를 누르면 수정 상태에서 나온다. 고친 것은 들고 나온다
  ta.onblur = () => leaveEdit(box, entry, ta, btn)
}

/** 고친 것 없이 닫는다. 남길 것이 있으면 leaveEdit 이 부른다 */
function endEdit(box: HTMLElement, entry: LogEntry, btn: HTMLElement) {
  btn.textContent = '✎'; btn.title = '수정'
  box.textContent = ''
  renderBody(box, entry.body)
}

/** 고친 것이 있으면 남기고 나온다. 없으면 닫기만 한다 */
function leaveEdit(box: HTMLElement, entry: LogEntry, ta: HTMLTextAreaElement, btn: HTMLElement) {
  // 남기면 화면을 통째로 다시 그린다 — 단추도 그때 제 모습으로 돌아온다
  if (onLeave(ta.value, entry.body) === 'close') endEdit(box, entry, btn)
  else void saveEdit(entry, ta.value)
}

function renderBody(box: HTMLElement, body: string) {
  for (const line of parseLines(body)) {
    const row = document.createElement('div')
    row.className = 'ln ' + line.kind
    if (line.marker !== '') {
      const mk = document.createElement('span')
      mk.className = 'marker'; mk.textContent = line.marker
      row.appendChild(mk)
    }
    const content = document.createElement('span')
    for (const piece of line.pieces) content.appendChild(pieceNode(piece))
    row.appendChild(content)
    box.appendChild(row)
  }
}

/* ---- timeline ---- */
function renderAll() {
  renderSidebar()
  renderHeading()
  renderTimeline()
}

function renderHeading() {
  const title = $('htitle')
  const act = $('hact')
  act.textContent = ''
  if (!view) { title.textContent = ''; return }

  title.textContent = headingText(view, entries.length, TRASH_DAYS)

  // day 뷰는 목록 머리말을 숨기므로 그날 전체 복사를 여기에 둔다
  if (view.kind === 'day' && entries.length > 0) {
    const all = document.createElement('button')
    all.className = 'act dcopy'; all.title = '이 날 전체 복사'; all.textContent = '⧉'
    all.onclick = ev => copyGroup(entries, ev.currentTarget as HTMLElement)
    act.appendChild(all)
  }

  if (isToday(view)) return
  const back = document.createElement('a')
  back.textContent = '오늘'
  back.onclick = () => pick(todayView())
  act.appendChild(back)
}

function renderTimeline() {
  const tl = $('timeline')
  tl.innerHTML = ''
  // 아직 못 보낸 글도 제자리에 얹는다 — 쓴 사람에게는 이미 남긴 글이다
  const shown = withPending(entries, queue, view ?? todayView())
  if (shown.length === 0) {
    const msg = view?.kind === 'trash' ? '휴지통이 비었습니다'
      : view?.kind === 'search' ? '찾는 로그가 없습니다'
      : view?.kind === 'tag' ? '이 태그의 로그가 없습니다'
      : '이 기간에 로그가 없습니다'
    tl.innerHTML = `<div class="empty">${msg}</div>`
    return
  }

  const inTrash = view?.kind === 'trash'
  // 하루치만 보고 있으면 머리말이 이미 그 날짜다 — 두 번 쓰지 않는다
  const showDates = view?.kind !== 'day'

  for (const group of groupByDate(shown)) {
    if (showDates) {
      const head = document.createElement('div')
      head.className = 'datehead'
      const label = document.createElement('span')
      label.textContent = group.date
      const all = document.createElement('button')
      all.className = 'act dcopy'; all.title = '이 날 전체 복사'; all.textContent = '⧉'
      all.onclick = ev => copyGroup(group.entries, ev.currentTarget as HTMLElement)
      head.append(label, all)
      tl.appendChild(head)
    }

    for (const e of group.entries) {
      const el = document.createElement('div')
      const waiting = isPending(e)
      el.className = waiting ? `entry pending${e.failed ? ' failed' : ''}` : 'entry'
      // 아직 서버에 없는 글은 고치거나 지울 수 없다 — 자리만 지키고 기다린다
      el.innerHTML = `<div class="head">
          <span class="meta"><span class="time">${timeOf(e.created_at)}</span></span>
          <span class="actions">${waiting
            ? `<span class="waiting">${e.failed ? '못 보냄' : '보내는 중'}</span>
               ${e.failed
                 ? `<button class="act retry" title="다시 보내기">↻</button>
                    <button class="act why" title="실패 사유 복사">⧉</button>`
                 : ''}`
            : inTrash
            ? `<button class="act back" title="복원">↩</button>
               <button class="act purge" title="완전 삭제">×</button>`
            : `<button class="act copy" title="복사">⧉</button>
               <button class="act edit" title="수정">✎</button>
               <button class="act tag" title="태그 달기">＃</button>
               <button class="act del" title="삭제">×</button>`}
          </span>
        </div>
        <div class="body"></div>`
      if (waiting) {
        el.querySelector<HTMLElement>('.retry')?.addEventListener('click', () => { void flush() })
        el.querySelector<HTMLElement>('.why')?.addEventListener('click', ev => {
          void copyToClipboard(e.error ?? '알 수 없는 오류', ev.currentTarget as HTMLElement)
        })
      } else if (inTrash) {
        el.querySelector<HTMLElement>('.back')!.onclick = () => restoreEntry(e)
        el.querySelector<HTMLElement>('.purge')!.onclick = () => purgeEntry(e)
      } else {
        el.querySelector<HTMLElement>('.del')!.onclick = () => removeEntry(e)
        el.querySelector<HTMLElement>('.tag')!.onclick = () => {
          const t = prompt('태그')?.trim()
          if (!t) return
          // 본문에서 뽑히는 것과 같은 모양만 받는다. 태그는 잠기지 않고 그대로 그려진다
          if (!isTag(t)) { alert('태그에는 글자·숫자·밑줄만 쓸 수 있습니다.'); return }
          addTag(e, bareTag(t))
        }
        el.querySelector<HTMLElement>('.copy')!.onclick = ev => copyEntry(e, ev.currentTarget as HTMLElement)
      }

      // 태그 칩은 시분초 옆에 (본문 아래 줄을 쓰지 않도록)
      const meta = el.querySelector('.meta')!
      for (const t of e.tags) {
        const chip = document.createElement('span')
        chip.className = 'chip'; chip.textContent = '#' + t
        chip.onclick = () => pick({ kind: 'tag', tag: t })
        meta.appendChild(chip)
      }

      const box = el.querySelector<HTMLElement>('.body')!
      renderBody(box, e.body)
      // 왜 못 갔는지는 여기서만 볼 수 있다 — 폰에는 열어볼 콘솔이 없다
      if (waiting && e.failed) el.appendChild(span('reason', e.error ?? '알 수 없는 오류'))
      if (!waiting && !inTrash) {
        const btn = el.querySelector<HTMLElement>('.edit')!
        // 누르는 순간 수정창이 포커스를 잃으면, 열려 있었는지 알 수 없다
        btn.addEventListener('mousedown', ev => ev.preventDefault())
        btn.onclick = () => {
          const open = box.querySelector('textarea')
          if (open) leaveEdit(box, e, open, btn)   // 이제 저장 단추다 — 남기고 나온다
          else startEdit(box, e, btn)
        }
      }
      tl.appendChild(el)
    }
  }
}

/* ---- input UX ---- */
$('send').onclick = submit
const ta = $('input') as HTMLTextAreaElement
ta.addEventListener('keydown', e => {
  if (isSubmit(e)) { e.preventDefault(); submit() }
})
const fitInput = () => {
  ta.style.height = '42px'
  ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
}
ta.addEventListener('input', () => {
  fitInput()
  saveDraft(ta.value, localStorage)
})

// 키보드가 올라오면 껍데기가 화면을 그만큼 줄인다. 줄어든 만큼 아래가 가려지므로
// 쓰는 중이면 마지막 글이 보이도록 따라간다
let viewHeight = window.innerHeight
window.addEventListener('resize', () => {
  const before = viewHeight
  viewHeight = window.innerHeight
  if (followsKeyboard({ before, after: viewHeight, writing: document.activeElement === ta })) scrollToLatest()
})

// Enter 로 남긴다는 것은 한 번만 알려준다. 닫으면 설명서에서 다시 볼 수 있다
if (needsHint(localStorage)) $('hint').hidden = false
$('hintclose').onclick = () => {
  $('hint').hidden = true
  hintShown(localStorage)
}

const closeGuide = () => { $('guide').hidden = true }
$('guideclose').onclick = closeGuide
// 바깥을 눌러도 닫힌다 — 읽고 나면 빠져나갈 길이 넓어야 한다
$('guide').onclick = e => { if (e.target === $('guide')) closeGuide() }

// 쓰다 만 글은 앱을 껐다 켜도, 며칠 뒤에도 그대로 있다
ta.value = loadDraft(localStorage)
// 비어 있어도 재어 준다 — 재지 않으면 textarea 기본값인 두 줄로 뜬다
fitInput()
document.addEventListener('visibilitychange', () => {
  if (document.hidden || $('app').hidden) return
  refresh()
  trackLocation()   // 다른 데 갔다 온 사이 움직였을 수 있다
  void flush()      // 못 보낸 글이 남아 있을 수 있다
})

// 연결이 돌아오면 기다리지 않고 바로 보낸다
window.addEventListener('online', () => { void flush() })

/** 알림 없이 조용히 다시 시도한다 — 지하철에서 잠깐 끊긴 것뿐일 수 있다 */
setInterval(() => { if (queue.length > 0) void flush() }, 30_000)

// 앱 껍데기를 캐시해 연결이 없어도 뜨게 한다. 개발 중에는 방해만 되므로 걸지 않는다
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(e => console.error('SW 등록 실패', e))
}

refreshAuth()

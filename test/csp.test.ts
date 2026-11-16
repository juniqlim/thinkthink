import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CSP, SECURITY_HEADERS } from '../tools/csp'

describe('CSP', () => {
  it('심어진 스크립트가 실행되지 않는다', () => {
    expect(CSP).toContain(`script-src 'self'`)
    expect(CSP).not.toContain(`script-src 'self' 'unsafe-inline'`)
    expect(CSP).not.toContain(`'unsafe-eval'`)
  })

  it('아는 곳으로만 나간다 — 유출 경로를 좁힌다', () => {
    expect(CSP).toMatch(/connect-src 'self' https:\/\/\S+\.supabase\.co wss:\/\/\S+\.supabase\.co/)
    expect(CSP).not.toContain(`connect-src *`)
  })

  it('index.html 에 인라인 스크립트가 없다 — script-src 가 막는다', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
  })

  it('남의 페이지에 끼워 넣지 못한다', () => {
    expect(CSP).toContain(`frame-ancestors 'none'`)
  })

  it('주소의 밑동을 바꿔치기하지 못한다', () => {
    expect(CSP).toContain(`base-uri 'none'`)
  })
})

describe('배포와 로컬', () => {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  const headers: { key: string; value: string }[] = vercel.headers?.[0]?.headers ?? []
  const find = (key: string) => headers.find(h => h.key.toLowerCase() === key)?.value

  it('모든 경로에 건다', () => {
    expect(vercel.headers?.[0]?.source).toBe('/(.*)')
  })

  it('vercel.json 의 헤더가 tools/csp.ts 와 어긋나지 않는다', () => {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      expect(find(key), `vercel.json 에 ${key} 가 없거나 다르다`).toBe(value)
    }
  })
})

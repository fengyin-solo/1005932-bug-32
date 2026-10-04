import { REVIEW_SEED, SEED_ROWS } from './seed'
import type { EntryRow, ToolReviewRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pv-plant-ops:entries'
const REVIEW_STORAGE_KEY = 'pv-plant-ops:tool-reviews'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

function readReviewStorage(): ToolReviewRow[] {
  const fallback = clone(REVIEW_SEED)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(REVIEW_STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as ToolReviewRow[]
  } catch {
    window.localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let reviewCache: ToolReviewRow[] | null = null

/** 巡视的工器具复核台账：报废结论与送检结论都落在这里。 */
export function reviewLedger(): ToolReviewRow[] {
  if (reviewCache === null) {
    reviewCache = readReviewStorage()
  }
  return reviewCache
}

export function saveReviewLedger(rows: ToolReviewRow[]): void {
  reviewCache = rows
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(rows))
  }
}

export function resetReviewLedger(): ToolReviewRow[] {
  const rows = clone(REVIEW_SEED)
  saveReviewLedger(rows)
  return rows
}

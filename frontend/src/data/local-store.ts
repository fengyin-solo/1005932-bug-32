import { SEED_ROWS } from './seed'
import {
  cycleOf,
  isValidDate,
  nextTestDateFrom,
  STATIONS,
  STATUS_SCRAPPED,
} from './tooling'
import type { EntryRow, ReviewRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pv-plant-ops:entries'
// 结构变更时抬版本号：老缓存做一次就地迁移（修字段/补台账），不动其他模块的数据。
const STORAGE_VERSION = 2
const VERSION_KEY = 'pv-plant-ops:version'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 老示例数据迁移：
 * - 工器具的「所在电站/保管人员/下次试验日」是占位串，补成真实值并按周期重算下次试验日；
 * - 已报废的工器具清掉下次试验日、在册状态置为「已销账」；
 * - 巡视复核台账缺失时补播种。
 */
function migrateToolingRows(rows: EntryRow[]): EntryRow[] {
  return rows.map((row, index) => {
    const next: EntryRow = { ...row }
    if (!STATIONS.includes(String(next['所在电站']))) {
      next['所在电站'] = STATIONS[index % STATIONS.length]
    }
    const keeper = String(next['保管人员'])
    if (!keeper || keeper.includes('样例')) {
      next['保管人员'] = `${String(next['所在电站'])}保管人`
    }
    const testDate = String(next['试验日期'] ?? '')
    if (String(next.status) === STATUS_SCRAPPED) {
      next['下次试验日'] = ''
      next['工器具状态'] = '已销账'
      next.pending = false
    } else if (isValidDate(testDate)) {
      const months = cycleOf(next).months
      const stored = String(next['下次试验日'] ?? '')
      if (!isValidDate(stored)) {
        next['下次试验日'] = nextTestDateFrom(testDate, months)
      }
      next['工器具状态'] = '在册'
    }
    return next
  })
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const version = Number(window.localStorage.getItem(VERSION_KEY) ?? '1')
    // 老缓存：就地修好工器具与复核台账，保留其余模块的用户改动。
    if (version < STORAGE_VERSION) {
      if (Array.isArray(parsed.tooling)) {
        parsed.tooling = migrateToolingRows(parsed.tooling)
      }
      if (!Array.isArray(parsed.patrolReview)) {
        parsed.patrolReview = clone(SEED_ROWS.patrolReview ?? [])
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))
      window.localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION))
    }
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION))
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

export function listReviewRows(): ReviewRow[] {
  return listRows('patrolReview') as ReviewRow[]
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

/**
 * 一次销账：多个台账（工器具台账 + 巡视复核台账）在同一次提交里落库。
 * 全部变更先在内存里算好，最后只做一次持久化写入；任一步校验失败都不写，
 * 由调用方直接返回错误，绝不出「状态变了数字不减」的半截账。
 */
export function commitAll(patches: Record<string, EntryRow[]>): void {
  const next = { ...allRows(), ...patches }
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

/**
 * 安全工器具领域规则：试验周期、在册判定、超期提醒、按电站划开的权限与一致性校验。
 *
 * 状态流转仍然只能由 local-service.ts 发起；这里只提供纯函数，页面和 service 共用，
 * 保证「工器具页看到的在册数」和「巡视复核台账里的在册工器具数」永远用同一把尺子。
 */
import type { ConsistencyIssue, EntryRow, OperatorContext } from '@/data/types'

export const TOOLING_KEY = 'tooling'
export const REVIEW_KEY = 'patrolReview'

export const STATUS_QUALIFIED = '试验合格'
export const STATUS_PENDING_TEST = '待试验'
export const STATUS_OVERDUE = '已超期'
export const STATUS_SCRAPPED = '已报废'

export const LIVE_STATUSES = [STATUS_QUALIFIED, STATUS_PENDING_TEST, STATUS_OVERDUE]

/** 页面上可办理的动作。 */
export const ACTION_SEND_TEST = '送检登记'
export const ACTION_CONFIRM_PASS = '确认合格'
export const ACTION_SCRAP = '办理报废'

/** 工器具状态列展示：已报废即整条销账，在册状态同步变「已销账」。 */
export const REGISTERED_FLAG = '在册'
export const WRITTEN_OFF_FLAG = '已销账'

/** 电站名单：工器具归属按电站划开，保管人只属于其中一座电站。 */
export const STATIONS = ['青山光伏电站', '望海光伏电站', '沙塬光伏电站', '云顶光伏电站']

type CycleRule = { keywords: string[]; months: number; label: string }

/**
 * 试验周期表（现行 2026 版，依据《电力安全工器具预防性试验规程》DL/T 1476 取值）：
 * 按「试验类别」关键词匹配；匹配不到的按 12 个月兜底。
 * 「取哪一版」由这里统一权衡——既有在册记录若带旧版「试验周期(月)」数值字段，
 * 先沿用旧版数值，避免老记录的下次试验日被新表整体改写。
 */
const CYCLE_RULES_2026: CycleRule[] = [
  { keywords: ['绝缘手套'], months: 6, label: '6个月' },
  { keywords: ['绝缘靴', '绝缘鞋'], months: 6, label: '6个月' },
  { keywords: ['验电器', '验电笔'], months: 6, label: '6个月' },
  { keywords: ['核相器', '核相仪'], months: 6, label: '6个月' },
  { keywords: ['绝缘杆', '操作杆', '拉闸杆', '接地杆'], months: 12, label: '12个月' },
  { keywords: ['绝缘隔板', '绝缘罩'], months: 12, label: '12个月' },
  { keywords: ['接地线', '携带型短路接地'], months: 60, label: '60个月' },
  { keywords: ['绝缘夹钳'], months: 12, label: '12个月' },
  { keywords: ['脚扣'], months: 6, label: '6个月' },
  { keywords: ['登高板', '升降板'], months: 6, label: '6个月' },
  { keywords: ['安全帽'], months: 12, label: '12个月' },
  { keywords: ['安全带'], months: 12, label: '12个月' },
  { keywords: ['速差器', '防坠器'], months: 12, label: '12个月' },
  { keywords: ['绝缘绳', '防潮绝缘绳'], months: 6, label: '6个月' },
]

const DEFAULT_CYCLE_MONTHS = 12

export type CycleInfo = { months: number; source: '现行2026版周期表' | '既有记录沿用值' }

/** 试验周期取哪一版：老记录带合法的「试验周期(月)」就沿用，否则查 2026 版周期表。 */
export function cycleOf(row: EntryRow): CycleInfo {
  const legacy = Number(row['试验周期(月)'])
  if (Number.isFinite(legacy) && legacy > 0) {
    return { months: legacy, source: '既有记录沿用值' }
  }
  const category = String(row['试验类别'] ?? '')
  const hit = CYCLE_RULES_2026.find((rule) => rule.keywords.some((word) => category.includes(word)))
  return { months: hit ? hit.months : DEFAULT_CYCLE_MONTHS, source: '现行2026版周期表' }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(value))
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00`)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 下次试验日从试验日期补起：试验日期 + 试验周期（月）。 */
export function nextTestDateFrom(testDate: string, months: number): string {
  const base = toDate(testDate)
  const target = new Date(base)
  const day = base.getDate()
  target.setMonth(base.getMonth() + months)
  // 月末溢出（如 1月31日 + 1 个月）会滚到次月，回拉到当月最后一天。
  if (target.getDate() < day) {
    target.setDate(0)
  }
  return formatDate(target)
}

/** 工器具在册数量：已报废（销账）的不算在册。 */
export function isRegistered(row: EntryRow): boolean {
  return String(row.status) !== STATUS_SCRAPPED
}

/** 工器具状态列：报废后展示「已销账」，其余展示「在册」。 */
export function registeredFlag(row: EntryRow): string {
  return isRegistered(row) ? REGISTERED_FLAG : WRITTEN_OFF_FLAG
}

/**
 * 下次试验日提醒（在册工器具才有）：
 * 已到/已过下次试验日 → 已超期；7 天内到期 → 即将到期；否则返回空串。
 */
export function nextTestReminder(row: EntryRow, today = new Date()): string {
  if (!isRegistered(row)) {
    return ''
  }
  const next = String(row['下次试验日'] ?? '')
  if (!isValidDate(next)) {
    return '缺下次试验日，需补登记试验日期'
  }
  const todayStr = formatDate(today)
  if (next < todayStr) {
    return `已超期（下次试验日 ${next}），须先送检不得直接报废`
  }
  const diffDays = Math.round((toDate(next).getTime() - toDate(todayStr).getTime()) / 86_400_000)
  if (diffDays <= 7) {
    return `即将到期（${diffDays} 天后，${next}）`
  }
  return `下次试验日 ${next}`
}

/** 已报废工具整条只读：任何改动（含状态、归属、试验登记）都不允许。 */
export function isReadOnly(row: EntryRow): boolean {
  return String(row.status) === STATUS_SCRAPPED
}

/** 只有本电站的保管人能改所在电站与保管人员；别的电站只能查看。 */
export function canEdit(row: EntryRow, operator: OperatorContext): boolean {
  return operator.isCustodian && String(row['所在电站'] ?? '') === operator.station
}

/** 越权提交的统一口径。 */
export function permissionDeniedMessage(row: EntryRow, operator: OperatorContext): string {
  if (!operator.isCustodian) {
    return `越权操作被拦截：当前值班「${operator.operator}」不是电站保管人，只有本电站保管人可改动工器具（该件归属${String(
      row['所在电站'] ?? '未知电站',
    )}）`
  }
  return `越权操作被拦截并退回：${String(row['所在电站'] ?? '')} 的工器具只能由本电站保管人改动，当前值班归属${operator.station}，只能查看`
}

/** 已超期的工器具不许直接报废，得先补一次送检。 */
export function scrapGuard(row: EntryRow): string | null {
  const status = String(row.status)
  if (status === STATUS_SCRAPPED) {
    return '该工器具已报废销账，不能重复报废'
  }
  if (status === STATUS_OVERDUE) {
    return `当场拒绝：工器具当前状态为「${STATUS_OVERDUE}」，已超期不得直接报废，请先办理「送检登记」补检，复检合格后再报废`
  }
  const reminder = nextTestReminder(row)
  if (reminder.startsWith('已超期')) {
    return `当场拒绝：下次试验日已过（${String(row['下次试验日'] ?? '')}），工器具事实超期，请先办理「送检登记」补检后再报废`
  }
  return null
}

/**
 * 校验试验周期与在册状态是否一致（巡视复核台账用）：
 * 1. 在册工器具必须有合法的试验日期与下次试验日，且下次试验日 = 试验日期 + 现行/沿用周期；
 * 2. 已报废（不在册）工器具不应还挂着下次试验日；
 * 3. 周期计算与在册状态口径异常的逐条列出。
 */
export function checkConsistency(rows: EntryRow[]): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []
  for (const row of rows) {
    const station = String(row['所在电站'] ?? '')
    const code = String(row['工器具编号'] ?? row.id)
    const registered = isRegistered(row)
    if (registered) {
      const testDate = String(row['试验日期'] ?? '')
      if (!isValidDate(testDate)) {
        issues.push({ 工器具编号: code, 所在电站: station, 在册: true, 问题: '在册但试验日期缺失或无法识别，无法核算试验周期' })
        continue
      }
      const cycle = cycleOf(row)
      const expected = nextTestDateFrom(testDate, cycle.months)
      const next = String(row['下次试验日'] ?? '')
      if (!isValidDate(next)) {
        issues.push({
          工器具编号: code,
          所在电站: station,
          在册: true,
          问题: `在册但下次试验日缺失，应按${cycle.source}从试验日期补起为 ${expected}`,
        })
      } else if (next !== expected) {
        issues.push({
          工器具编号: code,
          所在电站: station,
          在册: true,
          问题: `下次试验日 ${next} 与${cycle.source}（${cycle.months}个月）不符，应为 ${expected}`,
        })
      }
    } else if (isValidDate(row['下次试验日'])) {
      issues.push({
        工器具编号: code,
        所在电站: station,
        在册: false,
        问题: '已报废销账但下次试验日仍在册上挂着，应随报废一并清除',
      })
    }
  }
  return issues
}

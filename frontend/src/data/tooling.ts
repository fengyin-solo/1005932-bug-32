import { listRows, reviewLedger, saveReviewLedger, saveRows } from './local-store'
import type {
  ActionResult,
  EntryRow,
  ToolActionPayload,
  ToolReconcileResult,
  ToolReviewRow,
} from './types'

// 工器具领域规则集中在这里：试验周期取哪一版、在册口径、电站归属与原子销账都不放页面上。

export const TOOLING_KEY = 'tooling'
export const SCRAPPED = '已报废'
export const PENDING_TEST = '待试验'
export const EXPIRED = '已超期'
export const QUALIFIED = '试验合格'

/** 终态：已报废的工器具整条只读，任何改动一律拒绝。 */
const READONLY_STATUSES = new Set([SCRAPPED])

/**
 * 试验周期版本（月）：以最新发布的《电力安全工器具预防性试验规程》口径为准。
 * 绝缘工器具统一按 6 个月；其余金属/登高/防护类按 12 个月。既有在册记录若携带
 * 「试验周期」字段则沿用其值（兼容老数据），类别匹配不到时兜底 12 个月。
 */
const CYCLE_BY_CATEGORY: Array<{ keywords: string[]; months: number }> = [
  { keywords: ['绝缘', '验电', '接地', '绝缘靴', '绝缘手套', '绝缘杆'], months: 6 },
  { keywords: ['安全带', '安全帽', '脚扣', '登高', '围栏', '接地线'], months: 12 },
]
const FALLBACK_CYCLE_MONTHS = 12

/** 待试验提醒窗口：下次试验日前 30 天进入待试验。 */
const REMIND_DAYS = 30

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    return null
  }
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function iso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addMonths(value: string, months: number): string {
  const date = toDate(value)
  if (!date) {
    return ''
  }
  const target = new Date(date)
  const day = target.getDate()
  target.setMonth(target.getMonth() + months)
  // 防止 1/31 + 1 月被进位到 3 月：超出当月天数时落到月末。
  if (target.getDate() < day) {
    target.setDate(0)
  }
  return iso(target)
}

function todayIso(): string {
  return iso(new Date())
}

function diffDays(fromIso: string, toIso: string): number | null {
  const from = toDate(fromIso)
  const to = toDate(toIso)
  if (!from || !to) {
    return null
  }
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

/** 取某条工器具适用的试验周期（月）。老记录自带「试验周期」且能解析时优先沿用。 */
export function cycleMonths(row: EntryRow): number {
  const raw = String((row as EntryRow)['试验周期'] ?? '').trim()
  const fromRecord = raw.match(/(\d+)\s*个?月/)
  if (fromRecord) {
    return Number(fromRecord[1])
  }
  const category = String((row as EntryRow)['试验类别'] ?? '')
  const hit = CYCLE_BY_CATEGORY.find((rule) => rule.keywords.some((k) => category.includes(k)))
  return hit ? hit.months : FALLBACK_CYCLE_MONTHS
}

/** 周期展示文本，复核台账里留痕，方便校验「试验周期与在册状态是否一致」。 */
export function cycleLabel(row: EntryRow): string {
  return `${cycleMonths(row)}个月`
}

/** 下次试验日从试验日期补起：试验日期 + 周期。试验日期无效时返回空串。 */
export function nextTestDate(row: EntryRow, testDate?: string): string {
  const base = testDate ?? String(row['试验日期'] ?? '')
  return addMonths(base, cycleMonths({ ...row, 试验日期: base }))
}

/**
 * 由试验日期/下次试验日推导业务状态。显式「待试验」（送检登记后尚未出结论）保留；
 * 其余在册工器具：下次试验日已过 → 已超期；进入提醒窗口 → 待试验；否则试验合格。
 */
export function deriveStatus(row: EntryRow, today = todayIso()): string {
  const current = String(row.status ?? '')
  if (READONLY_STATUSES.has(current)) {
    return SCRAPPED
  }
  if (current === PENDING_TEST) {
    return PENDING_TEST
  }
  const next = String(row['下次试验日'] ?? '')
  const gap = diffDays(today, next)
  if (gap === null) {
    return current || QUALIFIED
  }
  if (gap < 0) {
    return EXPIRED
  }
  if (gap <= REMIND_DAYS) {
    return PENDING_TEST
  }
  return QUALIFIED
}

/** 是否在册：已报废即销账，不再计入在册数量与下次试验日提醒。 */
export function isActive(row: EntryRow): boolean {
  return String(row.status) !== SCRAPPED
}

/** 已停用（已报废）的工器具整条只读。 */
export function isReadonly(row: EntryRow): boolean {
  return READONLY_STATUSES.has(String(row.status))
}

/** 下一版持久化前，对既有在册记录做一次兼容：补齐下次试验日并刷新派生状态。 */
function normalize(rows: EntryRow[]): EntryRow[] {
  return rows.map((row) => {
    if (!isActive(row)) {
      return row
    }
    const testDate = toDate(row['试验日期'])
    if (!testDate) {
      return row
    }
    const next = toDate(row['下次试验日']) ? String(row['下次试验日']) : nextTestDate(row)
    const patched: EntryRow = { ...row, 下次试验日: next }
    const status = deriveStatus(patched)
    return { ...patched, status, pending: status === PENDING_TEST || status === EXPIRED, abnormal: status === EXPIRED }
  })
}

/** 读工器具台账：返回经过兼容与状态重算的副本，不回写存储（写操作时统一落盘）。 */
export function listTooling(): EntryRow[] {
  return normalize(listRows(TOOLING_KEY))
}

function findTool(rows: EntryRow[], id: number): EntryRow | undefined {
  return rows.find((row) => Number(row.id) === id)
}

/**
 * 归属按电站划开：只有本电站保管人能改所在电站与保管人员。
 * - 记录当前所在电站必须等于提交人的归属电站；
 * - 改派到别的电站（nextStation 不同）同样要求提交人本电站归属，跨站只能查看。
 */
function assertOwnership(row: EntryRow, payload: ToolActionPayload): ActionResult | null {
  const ownerStation = String(row['所在电站'] ?? '')
  const operatorStation = String(payload.station ?? '').trim()
  if (!operatorStation) {
    return { ok: false, message: '未取得当前归属电站，越权提交已拦截，请刷新后重试' }
  }
  if (ownerStation !== operatorStation) {
    return {
      ok: false,
      message: `越权拦截：该工器具归属「${ownerStation}」，您当前归属「${operatorStation}」，只能查看，不能改动所在电站与保管人员`,
    }
  }
  return null
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

/** 往巡视复核台账追加一条销账/送检结论；id 在台账内自增。 */
function appendReview(entry: Omit<ToolReviewRow, 'id'>, ledger: ToolReviewRow[]): ToolReviewRow[] {
  const nextId = ledger.reduce((max, item) => Math.max(max, item.id), 0) + 1
  return [...ledger, { ...entry, id: nextId }]
}

function reviewEntry(
  row: EntryRow,
  patch: { testDate: string; next: string; conclusion: ToolReviewRow['复核结论']; source: ToolReviewRow['来源']; status: ToolReviewRow['在册状态'] },
): Omit<ToolReviewRow, 'id'> {
  return {
    toolId: Number(row.id),
    工器具编号: String(row['工器具编号'] ?? ''),
    名称规格: String(row['名称规格'] ?? ''),
    所在电站: String(row['所在电站'] ?? ''),
    保管人员: String(row['保管人员'] ?? ''),
    试验类别: String(row['试验类别'] ?? ''),
    试验日期: patch.testDate,
    下次试验日: patch.next,
    试验周期: cycleLabel(row),
    在册状态: patch.status,
    复核结论: patch.conclusion,
    复核日期: todayIso(),
    来源: patch.source,
  }
}

// 进行中的动作锁：同一件连点两次只销一次/只送检一次（同步存储也防重入造成重复台账行）。
const inflight = new Set<number>()

/**
 * 工器具动作统一入口，作废做成一次销账：
 * 状态、下次试验日、在册封存在同一份写入里，复核台账同步追加；任一步失败整笔回退，
 * 不允许出现「状态变了数字不减」。
 */
export function runToolingAction(id: number, action: string, payload: ToolActionPayload = {}): ActionResult {
  const rows = normalize(listRows(TOOLING_KEY))
  const target = findTool(rows, id)
  if (!target) {
    return fail(`没有找到编号为 ${id} 的安全工器具`)
  }
  if (inflight.has(id)) {
    return fail('该工器具上一笔操作尚未完成，请勿重复点击，本次已忽略')
  }

  // 已停用（已报废）的工器具整条只读，任何动作当场拒掉并说明当前状态。
  if (isReadonly(target)) {
    return fail(`工器具 ${target['工器具编号']} 当前状态为「${SCRAPPED}」，已整条转只读，不能再改动`)
  }

  // 归属校验：跨电站的提交一律拦截退回。
  const denied = assertOwnership(target, payload)
  if (denied) {
    return denied
  }

  inflight.add(id)
  let ledgerBefore: ToolReviewRow[] | null = null
  let rowsBefore: EntryRow[] | null = null
  try {
    if (action === '送检登记') {
      return commitInspection(rows, target, payload, '待试验')
    }
    if (action === '确认合格') {
      if (String(target.status) !== PENDING_TEST) {
        return fail(`工器具 ${target['工器具编号']} 当前状态为「${target.status}」，需先完成送检登记才能确认合格`)
      }
      return commitInspection(rows, target, payload, '合格')
    }
    if (action === '办理报废') {
      return commitScrap(rows, target, payload)
    }
    if (action === '调整归属') {
      return commitTransfer(rows, target, payload)
    }
    return fail(`安全工器具没有登记「${action}」这个动作`)
  } catch (error) {
    // 整笔回退：恢复工器具台账与复核台账到操作前。
    if (rowsBefore) {
      saveRows(TOOLING_KEY, rowsBefore)
    }
    if (ledgerBefore) {
      saveReviewLedger(ledgerBefore)
    }
    return fail(error instanceof Error ? `操作失败已整笔回退：${error.message}` : '操作失败已整笔回退')
  } finally {
    inflight.delete(id)
  }

  function commitInspection(all: EntryRow[], row: EntryRow, data: ToolActionPayload, kind: '待试验' | '合格'): ActionResult {
    const testDate = data.testDate && toDate(data.testDate) ? data.testDate : ''
    if (!testDate) {
      return fail('请先选择有效的试验日期，下次试验日需从试验日期补起')
    }
    // 超期工器具不许直接报废 —— 但补送检正是解禁路径；这里登记一次送检并把结论落到复核台账。
    rowsBefore = listRows(TOOLING_KEY)
    ledgerBefore = reviewLedger()
    const base: EntryRow = { ...row, 试验日期: testDate }
    const next = nextTestDate(base, testDate)
    if (!next) {
      return fail('试验周期无法解析，未能补算下次试验日，整笔未写入')
    }
    const status = kind === '待试验' ? PENDING_TEST : QUALIFIED
    const updated: EntryRow = {
      ...base,
      下次试验日: next,
      保管人员: data.nextKeeper?.trim() || String(row['保管人员'] ?? ''),
      所在电站: data.nextStation?.trim() || String(row['所在电站'] ?? ''),
      status,
      pending: status === PENDING_TEST,
      abnormal: false,
    }
    const nextRows = all.map((item) => (Number(item.id) === id ? updated : item))
    const nextLedger = appendReview(
      reviewEntry(updated, {
        testDate,
        next,
        conclusion: kind === '待试验' ? '待试验' : '试验合格',
        source: '送检复核',
        status: '在册',
      }),
      ledgerBefore,
    )
    // 一次销账式提交：两份数据都落盘才算成功。
    saveRows(TOOLING_KEY, nextRows)
    saveReviewLedger(nextLedger)
    return {
      ok: true,
      message:
        kind === '待试验'
          ? `已登记送检：试验日期 ${testDate}，按周期 ${cycleLabel(updated)} 补算下次试验日 ${next}，当前状态「${PENDING_TEST}」`
          : `试验合格已确认：下次试验日 ${next}（${cycleLabel(updated)}周期，自试验日期 ${testDate} 补起），结论已落入巡视复核台账`,
    }
  }

  function commitScrap(all: EntryRow[], row: EntryRow, _data: ToolActionPayload): ActionResult {
    const status = String(row.status)
    // 已经超期的工器具不许直接报废，得先补一次送检，越级当场拒掉并说明当前状态。
    if (status === EXPIRED) {
      return fail(
        `工器具 ${row['工器具编号']} 当前状态为「${EXPIRED}」（下次试验日 ${row['下次试验日']} 已过），不许直接报废，请先办理「送检登记」补一次送检后再报废`,
      )
    }
    if (status === SCRAPPED) {
      // 连点两次只销一次。
      return fail(`工器具 ${row['工器具编号']} 已销账报废，不能重复报废`)
    }
    rowsBefore = listRows(TOOLING_KEY)
    ledgerBefore = reviewLedger()
    const scrapped: EntryRow = {
      ...row,
      status: SCRAPPED,
      pending: false,
      abnormal: false,
    }
    const nextRows = all.map((item) => (Number(item.id) === id ? scrapped : item))
    const nextLedger = appendReview(
      reviewEntry(row, {
        testDate: String(row['试验日期'] ?? ''),
        next: String(row['下次试验日'] ?? ''),
        conclusion: '已报废',
        source: '报废销账',
        status: '已销账',
      }),
      ledgerBefore,
    )
    // 原子提交：工器具状态与在册口径、复核台账同生共死。
    saveRows(TOOLING_KEY, nextRows)
    saveReviewLedger(nextLedger)

    // 提交后立刻自校验：状态变了在册数必须同步减一，且两处在册数对得上，否则回退。
    const check = reconcileWith(nextRows, nextLedger)
    const activeAfter = nextRows.filter(isActive).length
    const activeBefore = all.filter(isActive).length
    if (activeAfter !== activeBefore - 1) {
      saveRows(TOOLING_KEY, rowsBefore)
      saveReviewLedger(ledgerBefore)
      return fail('销账校验失败：在册数量未随报废同步核减，已整笔回退')
    }
    if (check.toolingActive !== check.reviewActive) {
      saveRows(TOOLING_KEY, rowsBefore)
      saveReviewLedger(ledgerBefore)
      return fail(
        `销账校验失败：工器具在册 ${check.toolingActive} 件与巡视复核台账在册 ${check.reviewActive} 件对不上，已整笔回退`,
      )
    }
    return {
      ok: true,
      message: `工器具 ${row['工器具编号']} 已一次销账：状态置「${SCRAPPED}」、不再计入在册数量与下次试验日提醒，报废结论已落入巡视复核台账（在册 ${activeBefore} → ${activeAfter} 件）`,
    }
  }

  function commitTransfer(all: EntryRow[], row: EntryRow, data: ToolActionPayload): ActionResult {
    const nextStation = data.nextStation?.trim()
    const nextKeeper = data.nextKeeper?.trim()
    if (!nextStation || !nextKeeper) {
      return fail('调整归属必须同时填写所在电站与保管人员')
    }
    rowsBefore = listRows(TOOLING_KEY)
    ledgerBefore = reviewLedger()
    const updated: EntryRow = { ...row, 所在电站: nextStation, 保管人员: nextKeeper }
    const nextRows = all.map((item) => (Number(item.id) === id ? updated : item))
    const testDate = String(row['试验日期'] ?? '')
    const nextLedger = appendReview(
      reviewEntry(updated, {
        testDate,
        next: String(row['下次试验日'] ?? ''),
        conclusion: deriveStatus(updated) as ToolReviewRow['复核结论'],
        source: '归属调整',
        status: '在册',
      }),
      ledgerBefore,
    )
    saveRows(TOOLING_KEY, nextRows)
    saveReviewLedger(nextLedger)
    return { ok: true, message: `归属已调整：${row['工器具编号']} 改由「${nextStation} / ${nextKeeper}」保管，复核台账已同步` }
  }
}

/** 巡视复核台账全量。 */
export function listReviewLedger(): ToolReviewRow[] {
  return reviewLedger()
}

function countByStation(values: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const value of values) {
    map.set(value, (map.get(value) ?? 0) + 1)
  }
  return map
}

/** 用指定的两份数据做对账（原子提交后立即复算用），不落盘。 */
function reconcileWith(toolingRows: EntryRow[], ledger: ToolReviewRow[]): ToolReconcileResult {
  const activeTools = toolingRows.filter(isActive)
  const toolingActive = activeTools.length
  // 复核台账按工器具取最新一条结论的在册状态，避免历史行造成重复计数。
  const latest = new Map<number, ToolReviewRow>()
  for (const item of ledger) {
    const prev = latest.get(item.toolId)
    if (!prev || item.id > prev.id) {
      latest.set(item.toolId, item)
    }
  }
  const activeReviewTools = [...latest.values()].filter((item) => item.在册状态 === '在册')
  const reviewActive = activeReviewTools.length

  const toolStations = countByStation(activeTools.map((row) => String(row['所在电站'] ?? '未分配')))
  const reviewStations = countByStation(activeReviewTools.map((item) => item.所在电站 || '未分配'))
  const stations = new Set([...toolStations.keys(), ...reviewStations.keys()])
  const byStation = [...stations].sort().map((station) => ({
    station,
    toolingActive: toolStations.get(station) ?? 0,
    reviewActive: reviewStations.get(station) ?? 0,
  }))

  const issues: string[] = []
  for (const item of byStation) {
    if (item.toolingActive !== item.reviewActive) {
      issues.push(`「${item.station}」两处数量不一致：工器具在册 ${item.toolingActive} 件，复核台账在册 ${item.reviewActive} 件`)
    }
  }

  // 校验试验周期与在册状态是否一致：在册工器具应有与类别匹配的周期与有效下次试验日。
  for (const row of activeTools) {
    const code = String(row['工器具编号'] ?? row.id)
    if (!toDate(row['试验日期'])) {
      issues.push(`工器具 ${code} 缺少有效试验日期，无法从试验日期补算下次试验日`)
      continue
    }
    const expectNext = nextTestDate(row)
    if (expectNext && String(row['下次试验日']) !== expectNext) {
      issues.push(
        `工器具 ${code} 下次试验日 ${row['下次试验日']} 与周期 ${cycleLabel(row)}（自 ${row['试验日期']} 补起应为 ${expectNext}）不一致`,
      )
    }
    const derived = deriveStatus(row)
    if (String(row.status) !== derived) {
      issues.push(`工器具 ${code} 在册状态「${row.status}」与试验周期推导结果「${derived}」不一致`)
    }
  }

  const ok = toolingActive === reviewActive && issues.length === 0
  return {
    ok,
    toolingActive,
    reviewActive,
    byStation,
    issues,
    message: ok
      ? `对账一致：两处在册工器具均为 ${toolingActive} 件，试验周期与在册状态校验通过`
      : `对账发现 ${issues.length + (toolingActive === reviewActive ? 0 : 1)} 处问题`,
  }
}

/** 工器具在册数量 × 巡视复核台账对账。 */
export function reconcileTooling(): ToolReconcileResult {
  return reconcileWith(normalize(listRows(TOOLING_KEY)), reviewLedger())
}

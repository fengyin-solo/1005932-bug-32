import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, commitAll, listRows, listReviewRows, resetRows, saveRows } from '@/data/local-store'
import {
  ACTION_CONFIRM_PASS,
  ACTION_SCRAP,
  ACTION_SEND_TEST,
  canEdit,
  checkConsistency,
  cycleOf,
  isReadOnly,
  isRegistered,
  nextTestDateFrom,
  permissionDeniedMessage,
  registeredFlag,
  scrapGuard,
  STATUS_OVERDUE,
  STATUS_PENDING_TEST,
  STATUS_QUALIFIED,
  STATUS_SCRAPPED,
  TOOLING_KEY,
} from '@/data/tooling'
import type {
  ActionResult,
  ConsistencyIssue,
  EntryRow,
  ModuleMeta,
  OperatorContext,
  OverviewResult,
  PageResult,
  ReviewRow,
  ToolingMetrics,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 工器具一次销账的在途锁：同一时刻只允许一笔提交，连点两次第二次直接拦下，台账不会多一行。
let toolingMutationLocked = false

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// ---------------------------------------------------------------------------
// 安全工器具：报废是一次销账，工器具状态 / 下次试验日 / 在册数量写进同一份提交，
// 任一步没通过校验就整笔回退（不发生任何持久化写入）。
// ---------------------------------------------------------------------------

function todayStr(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** 工器具在册数、待试验、已超期、已报废指标；台账与巡视复核台账共用这一口径。 */
export function toolingMetrics(rows: EntryRow[] = listRows(TOOLING_KEY)): ToolingMetrics {
  return {
    registered: rows.filter(isRegistered).length,
    pending: rows.filter((row) => String(row.status) === STATUS_PENDING_TEST).length,
    overdue: rows.filter((row) => String(row.status) === STATUS_OVERDUE).length,
    scrapped: rows.filter((row) => String(row.status) === STATUS_SCRAPPED).length,
  }
}

/** 工器具状态列展示值：报废后整笔为「已销账」，其余为「在册」。 */
export function toolingRegisteredFlag(row: EntryRow): string {
  return registeredFlag(row)
}

export function toolingConsistency(rows: EntryRow[] = listRows(TOOLING_KEY)): ConsistencyIssue[] {
  return checkConsistency(rows)
}

/** 巡视复核台账（报废结论落账处）。 */
export function listReviewEntries(): ReviewRow[] {
  return listReviewRows()
}

/**
 * 工器具状态流转专用入口（送检登记 / 确认合格 / 办理报废）。
 * 与通用 runAction 不同：带电站权限、只读、超期拦截，并在一次提交里联动
 * 下次试验日、在册状态与巡视复核台账。
 */
export function runToolingAction(
  id: number,
  action: string,
  operator: OperatorContext,
): ActionResult {
  if (toolingMutationLocked) {
    return { ok: false, message: '上一笔销账还在处理中，请勿重复点击' }
  }
  const allowed = [ACTION_SEND_TEST, ACTION_CONFIRM_PASS, ACTION_SCRAP]
  if (!allowed.includes(action)) {
    return { ok: false, message: `安全工器具没有登记「${action}」这个动作` }
  }

  const rows = listRows(TOOLING_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的安全工器具` }
  }
  const current = rows[index]

  // 连点两次只销一次：报废幂等校验放在最前面，重复报废一律给明确口径。
  if (action === ACTION_SCRAP) {
    const codeNow = String(current['工器具编号'] ?? '')
    if (
      String(current.status) === STATUS_SCRAPPED ||
      listReviewRows().some((row) => String(row['工器具编号']) === codeNow)
    ) {
      return { ok: false, message: '该工器具已完成报废销账，不能重复报废' }
    }
    // 已经超期的工器具不许直接报废，得先补一次送检；越级当场拒掉并说明当前状态。
    const blocked = scrapGuard(current)
    if (blocked) {
      return { ok: false, message: blocked }
    }
  }

  // 已经停用（已报废）的工器具整条转只读，送检/改归属等其他改动都不能再做。
  if (isReadOnly(current)) {
    return { ok: false, message: '该工器具已报废停用，整条记录为只读，不能再做任何改动' }
  }
  // 归属按电站划开：只有本电站保管人能改，别的电站只能查看；越权一律拦截退回。
  if (!canEdit(current, operator)) {
    return { ok: false, message: permissionDeniedMessage(current, operator) }
  }

  toolingMutationLocked = true
  try {
    const rowsSnapshot = rows.map((row) => ({ ...row }))
    const reviewSnapshot = listReviewRows().map((row) => ({ ...row }))
    const nextRows = rows.map((row) => ({ ...row }))
    const target = { ...nextRows[index] }
    const reviewRows = reviewSnapshot.map((row) => ({ ...row }))

    if (action === ACTION_SEND_TEST) {
      // 补一次送检：进入待试验，试验日期记到今天，下次试验日从试验日期补起。
      const testDate = todayStr()
      const months = cycleOf(target).months
      target['试验日期'] = testDate
      target['下次试验日'] = nextTestDateFrom(testDate, months)
      target.status = STATUS_PENDING_TEST
      target.pending = true
      target.abnormal = true
      target['工器具状态'] = '在册'
    } else if (action === ACTION_CONFIRM_PASS) {
      if (String(target.status) !== STATUS_PENDING_TEST) {
        return {
          ok: false,
          message: `只有「${STATUS_PENDING_TEST}」的工器具能确认合格，当前状态为「${String(
            target.status,
          )}」`,
        }
      }
      const testDate = isValidStoredDate(target['试验日期']) ? String(target['试验日期']) : todayStr()
      const months = cycleOf(target).months
      target['试验日期'] = testDate
      target['下次试验日'] = nextTestDateFrom(testDate, months)
      target.status = STATUS_QUALIFIED
      target.pending = false
      target.abnormal = false
      target['工器具状态'] = '在册'
    } else {
      // 办理报废 = 一次销账：状态、在册标记、下次试验日清除、复核台账落账，同一笔提交。
      // 连点两次只销一次：复核台账已存在该工器具编号的报废结论时直接拒绝。
      const code = String(target['工器具编号'] ?? '')
      const alreadyWrittenOff = reviewRows.some((row) => String(row['工器具编号']) === code)
      if (alreadyWrittenOff || String(target.status) === STATUS_SCRAPPED) {
        return { ok: false, message: '该工器具已完成报废销账，不能重复报废' }
      }
      target.status = STATUS_SCRAPPED
      target.pending = false
      target.abnormal = false
      target['下次试验日'] = ''
      target['工器具状态'] = '已销账'

      const reviewId = reviewRows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
      const review: ReviewRow = {
        id: reviewId,
        status: '已完成',
        pending: false,
        abnormal: false,
        复核单号: `REVW-${String(reviewId).padStart(4, '0')}`,
        工器具编号: code,
        名称规格: String(target['名称规格'] ?? ''),
        试验类别: String(target['试验类别'] ?? ''),
        试验日期: String(target['试验日期'] ?? ''),
        所在电站: String(target['所在电站'] ?? ''),
        报废日期: todayStr(),
        办理人员: operator.operator,
        复核结论: `工器具报废销账：报废前状态「${String(current.status)}」，在册数量同步核减`,
      }
      reviewRows.push(review)
      nextRows[index] = target

      // 一次销账：两份台账合成一次写入；写后立刻对账，对不上就抛错整笔回退。
      commitAll({ [TOOLING_KEY]: nextRows, patrolReview: reviewRows })
      const writtenRows = listRows(TOOLING_KEY)
      const writtenTarget = writtenRows.find((row) => Number(row.id) === Number(target.id))
      const writtenReview = listReviewRows().filter((row) => String(row['工器具编号']) === code)
      const registered = writtenRows.filter(isRegistered).length
      if (
        !writtenTarget ||
        String(writtenTarget.status) !== STATUS_SCRAPPED ||
        String(writtenTarget['下次试验日']) !== '' ||
        String(writtenTarget['工器具状态']) !== '已销账' ||
        writtenReview.length !== 1
      ) {
        // 落账后校验失败：用提交前快照整笔回退，绝不留「状态变了数字不减」的半截账。
        commitAll({ [TOOLING_KEY]: rowsSnapshot, patrolReview: reviewSnapshot })
        throw new Error('报废销账落账后对账失败，已整笔回退')
      }
      return {
        ok: true,
        message: `已完成一次销账：${code} 状态置为「${STATUS_SCRAPPED}」、在册标记转「已销账」、下次试验日清除，复核单号 ${review['复核单号']}；当前在册工器具 ${registered} 件`,
      }
    }

    nextRows[index] = target
    commitAll({ [TOOLING_KEY]: nextRows })
    return {
      ok: true,
      message:
        action === ACTION_SEND_TEST
          ? `${String(target['工器具编号'])} 已送检登记，试验日期 ${target['试验日期']}，下次试验日从试验日期补起为 ${target['下次试验日']}，当前状态「${STATUS_PENDING_TEST}」`
          : `${String(target['工器具编号'])} 复检合格，下次试验日 ${target['下次试验日']}，当前状态「${STATUS_QUALIFIED}」`,
    }
  } finally {
    toolingMutationLocked = false
  }
}

function isValidStoredDate(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

/**
 * 修改归属（所在电站 / 保管人员）：只有本电站保管人能改；
 * 已报废停用的整条只读，越权提交一律拦截退回。
 */
export function updateToolingAssignment(
  id: number,
  patch: { station: string; keeper: string },
  operator: OperatorContext,
): ActionResult {
  const rows = listRows(TOOLING_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的安全工器具` }
  }
  const current = rows[index]
  if (isReadOnly(current)) {
    return { ok: false, message: '该工器具已报废停用，整条记录为只读，归属不能再改动' }
  }
  if (!canEdit(current, operator)) {
    return { ok: false, message: permissionDeniedMessage(current, operator) }
  }
  const station = patch.station.trim()
  const keeper = patch.keeper.trim()
  if (!station || !keeper) {
    return { ok: false, message: '所在电站与保管人员都不能为空，提交已退回' }
  }
  const nextRows = rows.map((row) => ({ ...row }))
  nextRows[index] = { ...nextRows[index], 所在电站: station, 保管人员: keeper }
  commitAll({ [TOOLING_KEY]: nextRows })
  return { ok: true, message: `归属已更新：${String(current['工器具编号'])} → ${station} / ${keeper}` }
}

/** 报废后两处在册工器具数对账：工器具台账 vs 巡视复核台账。 */
export function reconcileReviewLedger(): {
  registeredCount: number
  scrappedInLedger: number
  matched: boolean
  issues: ConsistencyIssue[]
} {
  const rows = listRows(TOOLING_KEY)
  const registeredCount = rows.filter(isRegistered).length
  const scrappedCodes = new Set(
    rows.filter((row) => String(row.status) === STATUS_SCRAPPED).map((row) => String(row['工器具编号'])),
  )
  const reviewCodes = new Set(listReviewRows().map((row) => String(row['工器具编号'])))
  const scrappedInLedger = [...scrappedCodes].filter((code) => reviewCodes.has(code)).length
  // 报废一件，复核台账必须有一行；在册数 = 总数 - 台账已核销件数，两边对得上才算平账。
  const matched =
    scrappedCodes.size === reviewCodes.size &&
    scrappedInLedger === scrappedCodes.size &&
    registeredCount === rows.length - scrappedCodes.size
  return { registeredCount, scrappedInLedger, matched, issues: checkConsistency(rows) }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

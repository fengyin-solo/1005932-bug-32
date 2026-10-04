/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

/** 工器具送检/报废动作的附带参数：报废需选择电站与保管人确认，送检需试验日期。 */
export type ToolActionPayload = {
  /** 试验日期（YYYY-MM-DD），送检登记/确认合格时使用，下次试验日从它补起。 */
  testDate?: string
  /** 提交人当前归属电站，用于越权校验。 */
  station?: string
  /** 提交人（保管人）姓名。 */
  keeper?: string
  /** 新的所在电站（归属转移时用）。 */
  nextStation?: string
  /** 新的保管人员。 */
  nextKeeper?: string
}

/** 巡视复核台账中的一条工器具复核结论。 */
export type ToolReviewRow = {
  id: number
  toolId: number
  工器具编号: string
  名称规格: string
  所在电站: string
  保管人员: string
  试验类别: string
  试验日期: string
  下次试验日: string
  试验周期: string
  在册状态: '在册' | '已销账'
  复核结论: '试验合格' | '待试验' | '已超期' | '已报废'
  复核日期: string
  来源: '送检复核' | '报废销账' | '归属调整'
}

/** 工器具在册数量与巡视复核台账的对账结果。 */
export type ToolReconcileResult = {
  ok: boolean
  /** 工器具台账里的在册数（未报废）。 */
  toolingActive: number
  /** 巡视复核台账里状态仍为在册的数。 */
  reviewActive: number
  /** 每座电站的分项计数。 */
  byStation: { station: string; toolingActive: number; reviewActive: number }[]
  /** 周期与在册状态不一致等问题明细。 */
  issues: string[]
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

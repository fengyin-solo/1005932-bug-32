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

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 巡视复核台账里的一行：工器具报废结论落到这里，工器具页与本台账共用同一份数据。 */
export type ReviewRow = EntryRow & {
  工器具编号: string
  名称规格: string
  所在电站: string
  报废日期: string
  试验日期: string
  试验类别: string
  复核单号: string
  复核结论: string
  办理人员: string
}

/** 试验周期与在册状态一致性的校验结果。 */
export type ConsistencyIssue = {
  工器具编号: string
  所在电站: string
  在册: boolean
  问题: string
}

/** 工器具页顶部四张指标卡。 */
export type ToolingMetrics = {
  registered: number
  pending: number
  overdue: number
  scrapped: number
}

/** 一次操作的会话上下文：按电站划开权限时用。 */
export type OperatorContext = {
  operator: string
  station: string
  isCustodian: boolean
}

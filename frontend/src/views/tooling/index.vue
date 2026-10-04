<template>
  <section class="page" data-module="tooling">
    <header class="page-head">
      <div>
        <h2>安全工器具管理</h2>
        <p class="page-desc">
          围绕工器具编号、名称规格、试验类别、试验日期做登记、筛选与状态流转；报废一次销账，归属按电站划开，结论落入巡视复核台账。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出安全工器具清单</button>
        <button class="btn ghost" type="button" @click="runReconcile">台账对账</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-tip">
      当前归属电站：<strong>{{ store.station }}</strong> · 保管人：<strong>{{ store.operator }}</strong>
      ；仅本电站工器具可改动，其他电站只能查看。
    </p>

    <p v-if="reconcile" class="status-tip" :class="reconcile.ok ? 'ok-text' : 'error-text'">
      {{ reconcile.message }}
      <span v-if="reconcile.ok">（在册 {{ reconcile.toolingActive }} 件）</span>
    </p>
    <ul v-if="reconcile && !reconcile.ok" class="issue-list">
      <li v-for="(issue, index) in reconcile.issues" :key="index" class="error-text">{{ issue }}</li>
    </ul>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>所在电站</span>
        <select v-model="stationFilter">
          <option value="">全部电站</option>
          <option v-for="station in stationOptions" :key="station" :value="station">{{ station }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in pagedRows"
          :key="String(row.id)"
          :class="{ 'row-readonly': readonly(row), 'row-foreign': !canManage(row) }"
        >
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span :class="statusClass(row)">{{ row.status }}</span>
            <small v-if="!active(row)" class="muted">（已销账，不计在册）</small>
            <small v-else-if="isExpiring(row)" class="warn-text">（下次试验日临近）</small>
            <small v-else-if="row.status === '已超期'" class="error-text">（须先补送检）</small>
          </td>
          <td class="row-actions">
            <template v-if="readonly(row)">
              <span class="muted">已停用·只读</span>
            </template>
            <template v-else-if="!canManage(row)">
              <span class="muted">其他电站·仅查看</span>
            </template>
            <template v-else>
              <button class="link" type="button" @click="openInspect(row)">送检登记</button>
              <button
                class="link"
                type="button"
                :disabled="row.status !== '待试验'"
                :title="row.status !== '待试验' ? '只有待试验的工器具能确认合格' : ''"
                @click="openPass(row)"
              >
                确认合格
              </button>
              <button class="link danger" type="button" @click="openScrap(row)">办理报废</button>
              <button class="link" type="button" @click="openTransfer(row)">调整归属</button>
            </template>
            <button class="link" type="button" @click="openDetail(row)">详情</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无安全工器具数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条安全工器具记录，在册 {{ activeTotal }} 件，已销账 {{ total - activeTotal }} 件</span>
      <span v-if="okMessage" class="ok-text">{{ okMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 详情面板：在册数量、下次试验日提醒均只按在册工器具统计 -->
    <div v-if="detail" class="modal-mask" @click.self="closeDetail">
      <div class="modal-card">
        <h3>工器具详情 · {{ detail.row['工器具编号'] }}</h3>
        <dl class="detail-grid">
          <template v-for="field in columns" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ detail.row[field] ?? '—' }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd :class="statusClass(detail.row)">{{ detail.row.status }}</dd>
          <dt>在册口径</dt>
          <dd>{{ active(detail.row) ? '在册（计入在册数量与试验提醒）' : '已销账（不计在册、不再提醒）' }}</dd>
          <dt>试验周期</dt>
          <dd>{{ detail.cycle }}（下次试验日自试验日期补起）</dd>
        </dl>
        <div class="detail-box">
          <p v-if="active(detail.row) && isExpiring(detail.row)" class="warn-text">
            下次试验日 {{ detail.row['下次试验日'] }}，距今 {{ detail.daysToNext }} 天，请尽快安排送检。
          </p>
          <p v-else-if="active(detail.row) && detail.row.status === '已超期'" class="error-text">
            下次试验日 {{ detail.row['下次试验日'] }} 已过期 {{ Math.abs(detail.daysToNext ?? 0) }} 天；已超期工器具须先补一次送检，不能直接报废。
          </p>
          <p v-else-if="active(detail.row)">下次试验日 {{ detail.row['下次试验日'] }}，剩余 {{ detail.daysToNext }} 天。</p>
          <p v-else class="muted">已报废销账：不再出现在册数量与下次试验日提醒中。</p>
          <p class="muted">
            本电站在册 {{ detail.stationActive }} 件；巡视复核台账本电站在册 {{ detail.stationReviewActive }} 件。
          </p>
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeDetail">关闭</button>
        </div>
      </div>
    </div>

    <!-- 送检登记 / 确认合格：超期工器具的解禁路径 -->
    <div v-if="inspect" class="modal-mask" @click.self="closeInspect">
      <div class="modal-card">
        <h3>{{ inspect.kind === '合格' ? '确认试验合格' : '送检登记' }} · {{ inspect.row['工器具编号'] }}</h3>
        <p class="muted">
          归属 {{ inspect.row['所在电站'] }} / {{ inspect.row['保管人员'] }}，试验类别「{{ inspect.row['试验类别']
          }}」，适用周期 {{ inspectCycle }}。
        </p>
        <label class="form-row">
          <span>试验日期</span>
          <input v-model="inspect.testDate" type="date" />
        </label>
        <p class="muted">下次试验日将按「试验日期 + {{ inspectCycle }}」自动补算。</p>
        <p v-if="inspect.row.status === '已超期'" class="warn-text">该工器具已超期，本次补送检后才能办理报废。</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeInspect">取消</button>
          <button class="btn primary" type="button" :disabled="submitting" @click="submitInspect">
            {{ submitting ? '提交中…' : inspect.kind === '合格' ? '确认合格' : '登记送检' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 办理报废：一次销账确认 -->
    <div v-if="scrap" class="modal-mask" @click.self="closeScrap">
      <div class="modal-card">
        <h3>办理报废（一次销账）· {{ scrap['工器具编号'] }}</h3>
        <p>报废后同一份写入将完成：状态置「已报废」、移出在册数量、停止下次试验日提醒，并向巡视复核台账追加报废结论。</p>
        <p v-if="scrap.status === '已超期'" class="error-text">
          当前状态「已超期」，按规定不能直接报废，请先办理送检登记补一次送检。
        </p>
        <p class="muted">任一步失败整笔回退，不会出现状态变了而在册数量不减。</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeScrap">取消</button>
          <button
            class="btn primary danger"
            type="button"
            :disabled="submitting || scrap.status === '已超期'"
            @click="confirmScrap"
          >
            {{ submitting ? '销账中…' : '确认报废销账' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 调整所在电站 / 保管人员：仅本电站保管人可操作 -->
    <div v-if="transfer" class="modal-mask" @click.self="closeTransfer">
      <div class="modal-card">
        <h3>调整归属 · {{ transfer.row['工器具编号'] }}</h3>
        <p class="muted">当前归属 {{ transfer.row['所在电站'] }} / {{ transfer.row['保管人员'] }}。</p>
        <label class="form-row">
          <span>所在电站</span>
          <select v-model="transfer.nextStation">
            <option v-for="station in stationOptions" :key="station" :value="station">{{ station }}</option>
          </select>
        </label>
        <label class="form-row">
          <span>保管人员</span>
          <input v-model="transfer.nextKeeper" placeholder="输入保管人员姓名" />
        </label>
        <p class="muted">仅本电站保管人能改所在电站与保管人员；其他电站账号打开本单只能查看。</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeTransfer">取消</button>
          <button class="btn primary" type="button" :disabled="submitting" @click="submitTransfer">保存归属</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  cycleLabel,
  deriveStatus,
  isActive,
  isReadonly,
  listReviewLedger,
  listTooling,
  reconcileTooling,
  runToolingAction,
} from '@/data/tooling'
import type { EntryRow, ToolReconcileResult } from '@/data/types'
import { STATIONS, useSessionStore } from '@/stores/session'

const meta = moduleMeta('tooling')
const store = useSessionStore()
const columns = ['工器具编号', '名称规格', '试验类别', '试验日期', '下次试验日', '保管人员', '所在电站']
const statuses = ['试验合格', '待试验', '已超期', '已报废']
const stationOptions = [...STATIONS]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const okMessage = ref('')
const filters = ref<Record<string, string>>({})
const stationFilter = ref('')
const filterFields = columns.slice(0, 3)
const submitting = ref(false)
const reconcile = ref<ToolReconcileResult | null>(null)

const active = isActive
const readonly = isReadonly

const activeRows = computed(() => rows.value.filter(isActive))
const activeTotal = computed(() => activeRows.value.length)

const stats = computed(() => [
  { label: '在册工器具', value: activeTotal.value },
  { label: '待试验工器具', value: activeRows.value.filter((row) => deriveStatus(row) === '待试验').length },
  { label: '已超期工器具', value: activeRows.value.filter((row) => deriveStatus(row) === '已超期').length },
])

const pagedRows = computed(() =>
  stationFilter.value ? rows.value.filter((row) => String(row['所在电站']) === stationFilter.value) : rows.value,
)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: pagedRows.value.filter((row) => String(row.status) === status).length,
  })),
)

function daysUntil(row: EntryRow): number | null {
  const next = String(row['下次试验日'] ?? '')
  const match = next.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return null
  }
  const target = new Date(`${next}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

function isExpiring(row: EntryRow): boolean {
  const gap = daysUntil(row)
  return gap !== null && gap >= 0 && gap <= 30 && deriveStatus(row) !== '已超期'
}

function statusClass(row: EntryRow): string {
  if (row.status === '已报废') {
    return 'muted'
  }
  if (row.status === '已超期') {
    return 'error-text'
  }
  if (row.status === '待试验') {
    return 'warn-text'
  }
  return 'ok-text'
}

function canManage(row: EntryRow): boolean {
  return String(row['所在电站']) === store.station
}

function resetFilters() {
  filters.value = {}
  stationFilter.value = ''
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

// 详情面板
type DetailState = {
  row: EntryRow
  cycle: string
  daysToNext: number | null
  stationActive: number
  stationReviewActive: number
}
const detail = ref<DetailState | null>(null)

function openDetail(row: EntryRow) {
  const ledger = listReviewLedger()
  const latest = new Map<number, (typeof ledger)[number]>()
  for (const item of ledger) {
    const prev = latest.get(item.toolId)
    if (!prev || item.id > prev.id) {
      latest.set(item.toolId, item)
    }
  }
  const station = String(row['所在电站'])
  detail.value = {
    row,
    cycle: cycleLabel(row),
    daysToNext: daysUntil(row),
    stationActive: activeRows.value.filter((item) => String(item['所在电站']) === station).length,
    stationReviewActive: [...latest.values()].filter(
      (item) => item.所在电站 === station && item.在册状态 === '在册',
    ).length,
  }
}

function closeDetail() {
  detail.value = null
}

// 送检登记 / 确认合格
type InspectState = { row: EntryRow; kind: '送检' | '合格'; testDate: string }
const inspect = ref<InspectState | null>(null)
const inspectCycle = computed(() => (inspect.value ? cycleLabel(inspect.value.row) : ''))

function openInspect(row: EntryRow) {
  inspect.value = { row, kind: '送检', testDate: new Date().toISOString().slice(0, 10) }
}

function openPass(row: EntryRow) {
  inspect.value = { row, kind: '合格', testDate: new Date().toISOString().slice(0, 10) }
}

function closeInspect() {
  inspect.value = null
}

function submitInspect() {
  if (!inspect.value) {
    return
  }
  execute(
    runToolingAction(Number(inspect.value.row.id), inspect.value.kind === '合格' ? '确认合格' : '送检登记', {
      testDate: inspect.value.testDate,
      station: store.station,
      keeper: store.operator,
    }),
  )
  closeInspect()
}

// 报废
const scrap = ref<EntryRow | null>(null)

function openScrap(row: EntryRow) {
  if (deriveStatus(row) === '已超期') {
    errorMessage.value = `工器具 ${row['工器具编号']} 当前为「已超期」，不许直接报废，请先补一次送检`
    return
  }
  scrap.value = row
}

function closeScrap() {
  scrap.value = null
}

function confirmScrap() {
  if (!scrap.value) {
    return
  }
  execute(runToolingAction(Number(scrap.value.id), '办理报废', { station: store.station, keeper: store.operator }))
  closeScrap()
}

// 调整归属
type TransferState = { row: EntryRow; nextStation: string; nextKeeper: string }
const transfer = ref<TransferState | null>(null)

function openTransfer(row: EntryRow) {
  transfer.value = {
    row,
    nextStation: String(row['所在电站'] ?? ''),
    nextKeeper: String(row['保管人员'] ?? ''),
  }
}

function closeTransfer() {
  transfer.value = null
}

function submitTransfer() {
  if (!transfer.value) {
    return
  }
  execute(runToolingAction(Number(transfer.value.row.id), '调整归属', {
    station: store.station,
    keeper: store.operator,
    nextStation: transfer.value.nextStation,
    nextKeeper: transfer.value.nextKeeper,
  }))
  closeTransfer()
}

function execute(result: { ok: boolean; message: string }) {
  if (!result.ok) {
    okMessage.value = ''
    errorMessage.value = result.message
  } else {
    errorMessage.value = ''
    okMessage.value = result.message
  }
  reload()
}

function runReconcile() {
  reconcile.value = reconcileTooling()
}

function reload() {
  try {
    const payload = listTooling()
    const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
    rows.value = pairs.length
      ? payload.filter((row) => pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())))
      : payload
    total.value = rows.value.length
    reconcile.value = reconcileTooling()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '安全工器具列表读取失败'
  }
}

onMounted(reload)
</script>

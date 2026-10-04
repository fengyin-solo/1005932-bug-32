<template>
  <section class="page" data-module="tooling">
    <header class="page-head">
      <div>
        <h2>安全工器具管理</h2>
        <p class="page-desc">报废即一次销账：状态、在册标记、下次试验日与巡视复核台账同生共死；归属按电站划开，本电站保管人才能改动。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记安全工器具</button>
        <button class="btn" type="button" @click="exportRows">导出安全工器具清单</button>
      </div>
    </header>

    <div class="context-bar">
      <label class="context-item">
        <span>当前值班身份</span>
        <select :value="session.operator" @change="switchOperator(($event.target as HTMLSelectElement).value)">
          <option v-for="preset in operatorPresets" :key="preset.operator" :value="preset.operator">
            {{ preset.operator }}（{{ preset.isCustodian ? '可改本电站' : '全站只读' }}）
          </option>
        </select>
      </label>
      <span class="context-note">
        归属电站：{{ session.station }} · {{ session.isCustodian ? '本电站工器具可办理动作与归属修改' : '非保管人，所有工器具只能查看' }}
      </span>
    </div>

    <div class="stat-row">
      <article v-for="item in metricCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

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
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="tooling-layout">
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
            v-for="row in rows"
            :key="String(row.id)"
            :class="{ 'is-selected': selectedId === Number(row.id), 'row-readonly': rowReadOnly(row) }"
          >
            <td v-for="column in columns" :key="column">
              <button v-if="column === '工器具编号'" class="link" type="button" @click="selectRow(row)">
                {{ row[column] ?? '—' }}
              </button>
              <template v-else>{{ displayCell(row, column) }}</template>
            </td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <template v-if="rowActions(row).length">
                <button
                  v-for="action in rowActions(row)"
                  :key="action"
                  class="link"
                  type="button"
                  :disabled="busyKey === busyKeyOf(row, action)"
                  @click="runAction(action, row)"
                >
                  {{ busyKey === busyKeyOf(row, action) ? '办理中…' : action }}
                </button>
              </template>
              <span v-else class="muted-text">{{ rowReadOnly(row) ? '已停用只读' : '仅可查看' }}</span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无安全工器具数据，可先登记安全工器具</td>
          </tr>
        </tbody>
      </table>

      <aside class="detail-panel">
        <h3>工器具详情</h3>
        <template v-if="selected">
          <dl class="detail-list">
            <template v-for="column in columns" :key="column">
              <dt>{{ column }}</dt>
              <dd>{{ displayCell(selected, column) || '—' }}</dd>
            </template>
            <dt>当前状态</dt>
            <dd>{{ selected.status }}</dd>
          </dl>
          <div class="detail-block">
            <p class="detail-line">
              在册状态：<strong :class="rowReadOnly(selected) ? 'flag-off' : 'flag-on'">{{ registeredFlagText(selected) }}</strong>
            </p>
            <p class="detail-line">在册工器具数（不含已报废）：<strong>{{ metrics.registered }}</strong> 件</p>
            <p class="detail-line" :class="reminderClass(selected)">{{ reminder(selected) }}</p>
            <p v-if="rowReadOnly(selected)" class="detail-line flag-off">该工器具已报废停用，整条记录只读，不能再改动。</p>
            <p v-else-if="!canEditSelected" class="detail-line warn-text">
              本件归属{{ selected['所在电站'] }}，当前值班为{{ session.station }}身份，只能查看，越权提交会被拦截退回。
            </p>
          </div>
          <div class="detail-block">
            <button class="btn" type="button" :disabled="!canEditSelected" @click="openAssign">修改所在电站/保管人员</button>
          </div>
        </template>
        <p v-else class="muted-text">点击工器具编号查看详情。报废后在册数量与下次试验日提醒都会同步销账。</p>
      </aside>
    </div>

    <div v-if="assignOpen" class="modal-mask" @click.self="assignOpen = false">
      <form class="modal-card" @submit.prevent="submitAssign">
        <h3>修改归属（仅本电站保管人）</h3>
        <label class="modal-field">
          <span>所在电站</span>
          <select v-model="assignForm.station">
            <option v-for="station in stations" :key="station" :value="station">{{ station }}</option>
          </select>
        </label>
        <label class="modal-field">
          <span>保管人员</span>
          <input v-model="assignForm.keeper" placeholder="保管人员姓名" />
        </label>
        <p class="modal-tip">越权提交（非本电站保管人 / 已停用工器具）会在服务层当场拦截并退回。</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="assignOpen = false">取消</button>
          <button class="btn primary" type="submit">提交</button>
        </div>
      </form>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条安全工器具记录，其中在册 {{ metrics.registered }} 件、已报废销账 {{ metrics.scrapped }} 件</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runToolingAction,
  toolingMetrics,
  toolingRegisteredFlag,
  updateToolingAssignment,
} from '@/api/local-service'
import {
  ACTION_CONFIRM_PASS,
  ACTION_SCRAP,
  ACTION_SEND_TEST,
  canEdit,
  isReadOnly,
  nextTestReminder,
  STATIONS,
  STATUS_OVERDUE,
  STATUS_PENDING_TEST,
  STATUS_QUALIFIED,
} from '@/data/tooling'
import { OPERATOR_PRESETS, useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('tooling')
const columns = ['工器具编号', '名称规格', '试验类别', '试验日期', '下次试验日', '保管人员', '所在电站', '工器具状态']
const statuses = ['试验合格', '待试验', '已超期', '已报废']
const stations = STATIONS
const operatorPresets = OPERATOR_PRESETS

const session = useSessionStore()
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const selectedId = ref<number | null>(null)
const busyKey = ref('')

const assignOpen = ref(false)
const assignForm = reactive({ station: '', keeper: '' })

const metrics = computed(() => toolingMetrics(rows.value))
const metricCards = computed(() => [
  { label: '在册工器具', value: metrics.value.registered },
  { label: '待试验工器具', value: metrics.value.pending },
  { label: '已超期工器具', value: metrics.value.overdue },
  { label: '已报废销账', value: metrics.value.scrapped },
])
const selected = computed(() => rows.value.find((row) => Number(row.id) === selectedId.value) ?? null)
const canEditSelected = computed(() => (selected.value ? canEdit(selected.value, session.operatorContext) : false))

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function switchOperator(name: string) {
  const preset = OPERATOR_PRESETS.find((item) => item.operator === name)
  if (preset) {
    session.usePreset(preset)
    errorMessage.value = ''
  }
}

function rowReadOnly(row: EntryRow): boolean {
  return isReadOnly(row)
}

function registeredFlagText(row: EntryRow): string {
  return toolingRegisteredFlag(row)
}

function displayCell(row: EntryRow, column: string): string {
  if (column === '工器具状态') {
    return toolingRegisteredFlag(row)
  }
  const value = row[column]
  if (column === '下次试验日' && (value === '' || value === undefined || value === null)) {
    return isReadOnly(row) ? '已随报废清除' : '—'
  }
  return String(value ?? '—')
}

function reminder(row: EntryRow): string {
  return nextTestReminder(row)
}

function reminderClass(row: EntryRow): string {
  const text = reminder(row)
  if (text.startsWith('已超期')) {
    return 'detail-line warn-text'
  }
  if (text.startsWith('即将到期') || text.startsWith('缺下次试验日')) {
    return 'detail-line soon-text'
  }
  return 'detail-line ok-text'
}

/** 按状态给出可办动作；能不能点还要过电站权限与只读两道闸（服务层同样会拦）。 */
function rowActions(row: EntryRow): string[] {
  if (isReadOnly(row) || !canEdit(row, session.operatorContext)) {
    return []
  }
  switch (String(row.status)) {
    case STATUS_QUALIFIED:
      return [ACTION_SCRAP]
    case STATUS_PENDING_TEST:
      return [ACTION_CONFIRM_PASS, ACTION_SCRAP]
    case STATUS_OVERDUE:
      // 已超期：只允许先补送检，报废按钮直接不给，越级办理服务层也会当场拒掉。
      return [ACTION_SEND_TEST]
    default:
      return [ACTION_SEND_TEST, ACTION_CONFIRM_PASS, ACTION_SCRAP]
  }
}

function busyKeyOf(row: EntryRow, action: string): string {
  return `${row.id}:${action}`
}

function selectRow(row: EntryRow) {
  selectedId.value = Number(row.id)
  errorMessage.value = ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '安全工器具登记入口尚未接入审批流'
}

function openAssign() {
  if (!selected.value) {
    return
  }
  assignForm.station = String(selected.value['所在电站'] ?? '')
  assignForm.keeper = String(selected.value['保管人员'] ?? '')
  assignOpen.value = true
}

function submitAssign() {
  if (!selected.value) {
    return
  }
  const result = updateToolingAssignment(
    Number(selected.value.id),
    { station: assignForm.station, keeper: assignForm.keeper },
    session.operatorContext,
  )
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  assignOpen.value = false
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const key = busyKeyOf(row, action)
  if (busyKey.value === key) {
    return
  }
  busyKey.value = key
  // 连点两次只销一次：按钮立即置忙，真正的幂等与一次销账由服务层兜底。
  try {
    const result = runToolingAction(Number(row.id), action, session.operatorContext)
    if (!result.ok) {
      errorMessage.value = result.message
    }
  } finally {
    busyKey.value = ''
    reload()
  }
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    if (selectedId.value !== null && !rows.value.some((row) => Number(row.id) === selectedId.value)) {
      selectedId.value = null
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '安全工器具列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.context-bar {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.context-item span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 2px;
}
.context-note {
  font-size: 12px;
  color: var(--muted);
}
.tooling-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 12px;
  align-items: start;
}
.is-selected td {
  background: #eef5ff;
}
.row-readonly {
  color: var(--muted);
}
.detail-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  position: sticky;
  top: 12px;
}
.detail-panel h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.detail-list {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 4px 8px;
  margin: 0 0 10px;
  font-size: 12px;
}
.detail-list dt {
  color: var(--muted);
}
.detail-list dd {
  margin: 0;
  word-break: break-all;
}
.detail-block {
  border-top: 1px dashed var(--border);
  padding-top: 8px;
  margin-top: 8px;
}
.detail-line {
  margin: 4px 0;
  font-size: 12px;
}
.flag-on {
  color: #15803d;
}
.flag-off {
  color: #b42318;
}
.warn-text {
  color: #b42318;
}
.soon-text {
  color: #b45309;
}
.ok-text {
  color: #15803d;
}
.muted-text {
  color: var(--muted);
  font-size: 12px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 380px;
}
.modal-card h3 {
  margin: 0 0 12px;
  font-size: 15px;
}
.modal-field {
  display: block;
  margin-bottom: 10px;
}
.modal-field span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.modal-field input,
.modal-field select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.modal-tip {
  font-size: 12px;
  color: var(--muted);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

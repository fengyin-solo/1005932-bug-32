<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>巡视检查管理</h2>
        <p class="page-desc">维护巡视记录，围绕巡视单号、巡视路线、巡视人员、巡视日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡视记录</button>
        <button class="btn" type="button" @click="exportRows">导出巡视检查清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
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

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无巡视检查数据，可先登记巡视记录</td>
        </tr>
      </tbody>
    </table>

    <section class="review-section">
      <header class="review-head">
        <div>
          <h3>工器具复核台账</h3>
          <p class="page-desc">工器具送检结论与报废销账结论均落到此处，与安全工器具台账的在册数量对账。</p>
        </div>
        <button class="btn ghost" type="button" @click="runReconcile">重新对账</button>
      </header>

      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">工器具台账在册</span>
          <strong class="stat-value">{{ reconcile?.toolingActive ?? '—' }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">复核台账在册</span>
          <strong class="stat-value" :class="reconcile && !reconcile.ok ? 'error-text' : ''">
            {{ reconcile?.reviewActive ?? '—' }}
          </strong>
        </article>
        <article class="stat-card" v-for="item in reconcile?.byStation ?? []" :key="item.station">
          <span class="stat-label">{{ item.station }}在册（台账/复核）</span>
          <strong class="stat-value" :class="item.toolingActive !== item.reviewActive ? 'error-text' : ''">
            {{ item.toolingActive }} / {{ item.reviewActive }}
          </strong>
        </article>
      </div>

      <p class="status-tip" :class="reconcile?.ok ? 'ok-text' : 'error-text'">
        {{ reconcile?.message ?? '尚未对账' }}
      </p>
      <ul v-if="reconcile && !reconcile.ok" class="issue-list">
        <li v-for="(issue, index) in reconcile.issues" :key="index" class="error-text">{{ issue }}</li>
      </ul>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in reviewColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in reviewRows" :key="item.id" :class="{ 'row-readonly': item.在册状态 === '已销账' }">
            <td v-for="column in reviewColumns" :key="column">{{ item[column] ?? '—' }}</td>
          </tr>
          <tr v-if="!reviewRows.length">
            <td :colspan="reviewColumns.length" class="empty-state">复核台账暂无记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条巡视检查记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listReviewLedger, reconcileTooling } from '@/data/tooling'
import type { EntryRow, ToolReconcileResult, ToolReviewRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ["巡视单号", "巡视路线", "巡视人员", "巡视日期", "检查项数", "异常项数", "巡视时长", "巡视状态"]
const actions = ["开始巡视", "提交复核", "确认完成"]
const statuses = ["待巡视", "巡视中", "待复核", "已完成"]
const stats = [{"label": "今日巡视单", "value": 0}, {"label": "巡视中记录", "value": 0}, {"label": "发现异常项", "value": 0}]

const reviewColumns = [
  "工器具编号",
  "名称规格",
  "所在电站",
  "保管人员",
  "试验类别",
  "试验日期",
  "下次试验日",
  "试验周期",
  "在册状态",
  "复核结论",
  "复核日期",
  "来源",
] as const

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const reviewRows = ref<ToolReviewRow[]>([])
const reconcile = ref<ToolReconcileResult | null>(null)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function runReconcile() {
  reviewRows.value = listReviewLedger().slice().reverse()
  reconcile.value = reconcileTooling()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡视记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    runReconcile()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡视检查列表读取失败'
  }
}

onMounted(reload)
</script>

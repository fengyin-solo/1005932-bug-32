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

    <section class="review-ledger">
      <header class="review-head">
        <div>
          <h3>工器具报废复核台账</h3>
          <p class="page-desc">报废结论落到巡视复核；每次销账在此登记一行，并与工器具台账对账（在册数两边必须一致，同时校验试验周期与在册状态）。</p>
        </div>
        <button class="btn" type="button" @click="refreshReview">重新对账</button>
      </header>

      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">工器具台账在册数</span>
          <strong class="stat-value" :class="reconcile.matched ? 'num-ok' : 'num-bad'">{{ reconcile.registeredCount }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">复核台账已核销件数</span>
          <strong class="stat-value" :class="reconcile.matched ? 'num-ok' : 'num-bad'">{{ reconcile.scrappedInLedger }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">两处在册工器具数</span>
          <strong class="stat-value" :class="reconcile.matched ? 'num-ok' : 'num-bad'">
            {{ reconcile.matched ? '对得上' : '对不上' }}
          </strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">周期/在册状态异常</span>
          <strong class="stat-value" :class="reconcile.issues.length ? 'num-bad' : 'num-ok'">{{ reconcile.issues.length }}</strong>
        </article>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in reviewColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in reviewRows" :key="String(row.id)">
            <td v-for="column in reviewColumns" :key="column">{{ row[column] ?? '—' }}</td>
          </tr>
          <tr v-if="!reviewRows.length">
            <td :colspan="reviewColumns.length" class="empty-state">暂无工器具报废复核记录</td>
          </tr>
        </tbody>
      </table>

      <div class="issue-block">
        <h4>试验周期 × 在册状态校验</h4>
        <p v-if="!reconcile.issues.length" class="issue-ok">在册工器具的下次试验日均与试验周期一致；已报废件均已清除下次试验日，账实相符。</p>
        <ul v-else class="issue-list">
          <li v-for="(issue, idx) in reconcile.issues" :key="`${issue.工器具编号}-${idx}`" class="issue-item">
            [{{ issue.所在电站 }}] {{ issue.工器具编号 }}（{{ issue.在册 ? '在册' : '不在册' }}）：{{ issue.问题 }}
          </li>
        </ul>
      </div>
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
  listReviewEntries,
  moduleMeta,
  reconcileReviewLedger,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, ReviewRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ["巡视单号", "巡视路线", "巡视人员", "巡视日期", "检查项数", "异常项数", "巡视时长", "巡视状态"]
const actions = ["开始巡视", "提交复核", "确认完成"]
const statuses = ["待巡视", "巡视中", "待复核", "已完成"]
const stats = [{"label": "今日巡视单", "value": 0}, {"label": "巡视中记录", "value": 0}, {"label": "发现异常项", "value": 0}]
const reviewColumns = ['复核单号', '工器具编号', '名称规格', '试验类别', '试验日期', '所在电站', '报废日期', '办理人员', '复核结论']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const reviewRows = ref<ReviewRow[]>([])
const reconcileVersion = ref(0)

const reconcile = computed(() => {
  // 依赖 reviewRows 与对账版本号，销账或手动重对时刷新。
  void reviewRows.value
  void reconcileVersion.value
  return reconcileReviewLedger()
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

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

function refreshReview() {
  reviewRows.value = listReviewEntries()
  reconcileVersion.value += 1
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    reviewRows.value = listReviewEntries()
    reconcileVersion.value += 1
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡视检查列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.review-ledger {
  margin-top: 18px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
}
.review-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
}
.review-head h3 {
  margin: 0 0 4px;
  font-size: 15px;
}
.num-ok {
  color: #15803d;
}
.num-bad {
  color: #b42318;
}
.issue-block {
  margin-top: 10px;
}
.issue-block h4 {
  margin: 0 0 6px;
  font-size: 13px;
}
.issue-ok {
  color: #15803d;
  font-size: 12px;
  margin: 0;
}
.issue-list {
  margin: 0;
  padding-left: 18px;
}
.issue-item {
  font-size: 12px;
  color: #b42318;
  margin-bottom: 2px;
}
</style>


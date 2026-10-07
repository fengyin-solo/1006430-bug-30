<template>
  <section class="page" data-module="overhaul">
    <header class="page-head">
      <div>
        <h2>设备检修管理</h2>
        <p class="page-desc">维护检修记录，围绕检修编号、检修设备、检修类别、检修班组做登记、筛选与状态流转。检索以检修编号去重，翻页沿用同一份条件。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记检修记录</button>
        <button class="btn" type="button" @click="exportRows">导出设备检修管理清单</button>
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

    <form class="filter-bar" @submit.prevent="submitSearch">
      <label class="filter-item">
        <span>检修编号</span>
        <input v-model="draft.keyword" placeholder="按检修编号检索" />
      </label>
      <label class="filter-item">
        <span>检修班组</span>
        <select v-model="draft.team">
          <option value="">全部班组</option>
          <option v-for="team in teams" :key="team" :value="team">{{ team }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>检修类别</span>
        <select v-model="draft.category">
          <option value="">全部类别</option>
          <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>检修状态</span>
        <select v-model="draft.status">
          <option value="">全部状态</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn primary" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetSearch">重置条件</button>
    </form>

    <p class="applied-line">
      当前条件：{{ appliedText }}
      <template v-if="pageResult">
        · 命中 {{ pageResult.total }} 条
        <template v-if="pageResult.totalPages > 1">· 第 {{ pageResult.page }} / {{ pageResult.totalPages }} 页</template>
      </template>
    </p>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in pageItems" :key="String(row.id)">
          <td>
            <button class="link" type="button" @click="openDetail(row)">{{ row[columns[0]] ?? '—' }}</button>
          </td>
          <td v-for="column in columns.slice(1)" :key="column">{{ row[column] || '—' }}</td>
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
        <tr v-if="!pageItems.length">
          <td :colspan="columns.length + 2" class="empty-state">{{ emptyHint }}</td>
        </tr>
      </tbody>
    </table>

    <nav v-if="pageResult && pageResult.totalPages > 1" class="pager">
      <button class="btn" type="button" :disabled="pageResult.page <= 1" @click="goPage(pageResult.page - 1)">上一页</button>
      <span>第 {{ pageResult.page }} / {{ pageResult.totalPages }} 页</span>
      <button
        class="btn"
        type="button"
        :disabled="pageResult.page >= pageResult.totalPages"
        @click="goPage(pageResult.page + 1)"
      >
        下一页
      </button>
    </nav>

    <footer class="page-foot">
      <span>共 {{ pageResult?.total ?? 0 }} 条检修记录（每页 {{ pageResult?.size ?? 5 }} 条）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="ledger">
      <header class="ledger-head">
        <h3>检修计划 · 待核对台账</h3>
        <span class="ledger-note">检索命中即落账；计划工期按首次命中时保留，历史记录不因后续改动丢失。</span>
        <div class="ledger-tabs">
          <button
            v-for="tab in ledgerTabs"
            :key="tab.key"
            class="btn"
            :class="{ primary: ledgerScope === tab.key }"
            type="button"
            @click="ledgerScope = tab.key"
          >
            {{ tab.label }}（{{ tab.key === 'pending' ? ledgerCounts.pending : tab.key === 'checked' ? ledgerCounts.checked : ledgerCounts.pending + ledgerCounts.checked }}）
          </button>
        </div>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in ledgerColumns" :key="column">{{ column }}</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in ledgerEntries" :key="entry.code">
            <td>{{ entry.code }}</td>
            <td>{{ entry.team }}</td>
            <td>{{ entry.category }}</td>
            <td>{{ entry.status }}</td>
            <td>{{ entry.planPeriod || '—' }}</td>
            <td>{{ entry.hitCriteria }}</td>
            <td>{{ entry.firstHitAt }}</td>
            <td>{{ entry.checked ? `已核对（${entry.checkedAt}）` : '待核对' }}</td>
            <td>
              <button
                v-if="!entry.checked"
                class="link"
                type="button"
                @click="reconcile(entry.code)"
              >
                核对通过
              </button>
              <span v-else class="ledger-done">已归档</span>
            </td>
          </tr>
          <tr v-if="!ledgerEntries.length">
            <td :colspan="ledgerColumns.length + 1" class="empty-state">{{ ledgerEmptyHint }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="detail" class="modal-mask" @click.self="closeDetail">
      <article class="modal">
        <header class="modal-head">
          <h3>检修记录详情 · {{ detail[columns[0]] }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <p class="applied-line">检索条件：{{ appliedText }} · 命中 {{ detailIndex + 1 }} / {{ detailTotal }} 条</p>
        <dl class="detail-grid">
          <div v-for="column in columns" :key="column" class="detail-cell">
            <dt>{{ column }}</dt>
            <dd>{{ detail[column] || '—' }}</dd>
          </div>
          <div class="detail-cell">
            <dt>当前状态</dt>
            <dd>{{ detail.status }}</dd>
          </div>
        </dl>
        <footer class="modal-foot">
          <button class="btn" type="button" :disabled="detailIndex <= 0" @click="stepDetail(-1)">上一条</button>
          <span>同一份检索结果内移动</span>
          <button class="btn" type="button" :disabled="detailIndex >= detailTotal - 1" @click="stepDetail(1)">下一条</button>
        </footer>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  describeCriteria,
  fetchMatchedOverhaul,
  filterOptions,
  ledgerCount,
  listLedger,
  overhaulMetrics,
  overhaulStatusSummary,
  openOverhaulPage,
  reconcileLedger,
  searchOverhaul,
  turnOverhaulPage,
} from '@/api/overhaul-search'
import { downloadEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('overhaul')
const columns = ['检修编号', '检修设备', '检修类别', '检修班组', '计划工期', '完工日期', '更换备件', '检修状态']
const actions = meta.actions
const statuses = meta.statuses
const ledgerColumns = ['检修编号', '检修班组', '检修类别', '当前状态', '计划工期（命中时）', '命中条件', '首次命中时间', '核对状态']

const options = ref(filterOptions())
const teams = computed(() => options.value.teams)
const categories = computed(() => options.value.categories)

const draft = ref({ keyword: '', team: '', category: '', status: '' })
// pageResult.criteria 是本次检索冻结下来的唯一条件来源；翻页只认它，不读草稿框。
// 初始展示不写台账，只有主动点「查询」命中后才落账。
const pageResult = ref(openOverhaulPage())
const statusSummary = ref(overhaulStatusSummary())

const pageItems = computed(() => pageResult.value?.items ?? [])
const appliedText = computed(() =>
  pageResult.value ? describeCriteria(pageResult.value.criteria) : '全部检修记录',
)
const emptyHint = computed(() => {
  if (!pageResult.value) {
    return '暂无可显示的检修记录'
  }
  return `按条件「${describeCriteria(pageResult.value.criteria)}」未检索到检修记录，请调整检修班组、检修类别或检修状态后重新查询。`
})

const stats = computed(() => {
  const metrics = overhaulMetrics()
  return [
    { label: '待开工检修', value: metrics.waiting },
    { label: '检修中记录', value: metrics.running },
    { label: '本月完工数', value: metrics.finishedThisMonth },
    { label: '台账待核对', value: ledgerCounts.value.pending },
  ]
})

const errorMessage = ref('')

function submitSearch() {
  errorMessage.value = ''
  // 点查询才算一组新条件：条件在这里合并、过滤、落台账一次完成，页码回到第 1 页。
  pageResult.value = searchOverhaul({ ...draft.value }, 1)
  refreshLedger()
}

function resetSearch() {
  draft.value = { keyword: '', team: '', category: '', status: '' }
  errorMessage.value = ''
  pageResult.value = searchOverhaul({}, 1)
  refreshLedger()
}

function goPage(page: number) {
  if (!pageResult.value) {
    return
  }
  // 翻页沿用冻结条件，只改页码。
  pageResult.value = turnOverhaulPage(pageResult.value.criteria, page)
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '检修记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  // 状态流转后按同一份条件重取：已完工的记录换「已完工」条件仍可被检索到。
  pageResult.value = turnOverhaulPage(pageResult.value?.criteria ?? {}, pageResult.value?.page ?? 1)
  statusSummary.value = overhaulStatusSummary()
  refreshLedger()
  if (detail.value && detail.value.id === row.id) {
    detail.value = fetchMatchedOverhaul(pageResult.value.criteria).find((item) => item.id === row.id) ?? detail.value
  }
}

// 待核对台账
const ledgerScope = ref<'pending' | 'checked' | 'all'>('pending')
const ledgerEntries = ref(listLedger('pending'))
const ledgerCounts = ref(ledgerCount())
const ledgerTabs = [
  { key: 'pending' as const, label: '待核对' },
  { key: 'checked' as const, label: '已核对' },
  { key: 'all' as const, label: '全部' },
]

const ledgerEmptyHint = computed(() =>
  ledgerScope.value === 'checked'
    ? '还没有已核对的台账记录'
    : ledgerScope.value === 'all'
      ? '台账暂无记录：执行一次检修检索后，命中的检修记录会落到这里待核对'
      : '暂无待核对记录：执行一次检修检索后，命中的检修记录会落到这里待核对',
)

function refreshLedger() {
  ledgerEntries.value = listLedger(ledgerScope.value)
  ledgerCounts.value = ledgerCount()
}

function reconcile(code: string) {
  reconcileLedger(code)
  refreshLedger()
}

// 详情弹层：与列表同一份检索结果，位置和上一条/下一条都取自已冻结条件的完整去重结果。
const detail = ref<EntryRow | null>(null)
const detailMatched = ref<EntryRow[]>([])

const detailIndex = computed(() =>
  detail.value ? detailMatched.value.findIndex((row) => row.id === detail.value?.id) : -1,
)
const detailTotal = computed(() => detailMatched.value.length)

function openDetail(row: EntryRow) {
  if (!pageResult.value) {
    return
  }
  detailMatched.value = fetchMatchedOverhaul(pageResult.value.criteria)
  detail.value = row
}

function closeDetail() {
  detail.value = null
}

function stepDetail(delta: number) {
  const index = detailIndex.value
  const nextIndex = index + delta
  if (nextIndex >= 0 && nextIndex < detailMatched.value.length) {
    detail.value = detailMatched.value[nextIndex]
  }
}

onMounted(() => {
  refreshLedger()
})
</script>

<style scoped>
.applied-line {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--muted);
}
.filter-item select,
.filter-item input {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 13px;
  min-width: 132px;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
  font-size: 13px;
}
.pager .btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.ledger {
  margin-top: 20px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}
.ledger-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.ledger-head h3 {
  margin: 0;
  font-size: 15px;
}
.ledger-note {
  font-size: 12px;
  color: var(--muted);
}
.ledger-tabs {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.ledger-done {
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
.modal {
  width: 720px;
  max-width: calc(100vw - 40px);
  background: #fff;
  border-radius: 10px;
  padding: 16px 18px;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal-head h3 {
  margin: 0;
  font-size: 16px;
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 18px;
  margin: 12px 0;
}
.detail-cell dt {
  font-size: 12px;
  color: var(--muted);
}
.detail-cell dd {
  margin: 2px 0 0;
  font-size: 13px;
}
.modal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
  font-size: 12px;
  color: var(--muted);
}
.modal-foot .btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>

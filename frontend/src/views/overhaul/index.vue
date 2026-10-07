<template>
  <section class="page" data-module="overhaul">
    <header class="page-head">
      <div>
        <h2>设备检修管理</h2>
        <p class="page-desc">维护检修记录，围绕检修编号、检修设备、检修类别、检修班组做登记、筛选与状态流转。检索以检修编号去重，翻页沿用同一份条件。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记检修记录</button>
        <button class="btn" type="button" @click="exportRows">导出设备检修清单</button>
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

    <form class="filter-bar" @submit.prevent="runQuery">
      <label class="filter-item">
        <span>检修班组</span>
        <input v-model="form.team" placeholder="按检修班组检索，如：锅炉班" />
      </label>
      <label class="filter-item">
        <span>检修类别</span>
        <input v-model="form.category" placeholder="按检修类别检索，如：计划检修" />
      </label>
      <label class="filter-item">
        <span>检修状态</span>
        <select v-model="form.status">
          <option value="">全部状态</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn primary" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p class="criteria-line">
      当前检索条件：{{ criteriaSummary }}　命中 <strong>{{ result.total }}</strong> 条（按检修编号去重后）
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
        <tr v-for="row in result.items" :key="String(row[检修编号字段])">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>
            <span :class="['status-tag', statusClass(String(row.status))]">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(String(row[检修编号字段]))">查看详情</button>
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
        <tr v-if="!result.items.length">
          <td :colspan="columns.length + 2" class="empty-state">{{ result.message }}</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ result.total }} 条检修记录，本页显示 {{ result.items.length }} 条</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <div v-if="result.total > 0" class="pager">
        <button class="btn" type="button" :disabled="result.page <= 1" @click="turnPage(1)">首页</button>
        <button class="btn" type="button" :disabled="result.page <= 1" @click="turnPage(result.page - 1)">上一页</button>
        <span class="pager-info">第 {{ result.page }} / {{ result.pages }} 页</span>
        <button class="btn" type="button" :disabled="result.page >= result.pages" @click="turnPage(result.page + 1)">下一页</button>
        <button class="btn" type="button" :disabled="result.page >= result.pages" @click="turnPage(result.pages)">末页</button>
      </div>
    </footer>

    <section class="ledger-block">
      <header class="ledger-head">
        <div>
          <h3>检修计划 · 待核对台账</h3>
          <p class="page-desc">检索命中的检修记录自动落入台账，同一检修编号只保留一条；计划工期、检修状态按首次命中时保留，历史记录不再改写。</p>
        </div>
        <span class="ledger-count">共 {{ ledger.length }} 条，待核对 {{ pendingLedgerCount }} 条</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>检修编号</th>
            <th>检修设备</th>
            <th>检修类别</th>
            <th>检修班组</th>
            <th>计划工期（历史保留）</th>
            <th>检修状态</th>
            <th>最近命中</th>
            <th>最近检索条件</th>
            <th>核对状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in ledger" :key="entry.code" :class="{ checked: entry.checked }">
            <td>{{ entry.code }}</td>
            <td>{{ entry.equipment }}</td>
            <td>{{ entry.category }}</td>
            <td>{{ entry.team }}</td>
            <td>{{ entry.planPeriod }}</td>
            <td>{{ entry.status }}</td>
            <td>{{ entry.lastHitAt }}</td>
            <td>{{ entry.hitSummary }}</td>
            <td>{{ entry.checked ? `已核对（${entry.checkedAt}）` : '待核对' }}</td>
            <td class="row-actions">
              <button v-if="!entry.checked" class="link" type="button" @click="checkEntry(entry.code)">标记核对</button>
              <span v-else class="muted-text">—</span>
            </td>
          </tr>
          <tr v-if="!ledger.length">
            <td colspan="10" class="empty-state">台账暂无记录，执行一次检索后，命中的检修记录会自动落入待核对台账。</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="detailVisible" class="modal-mask" @click.self="closeDetail">
      <div class="modal-box">
        <header class="modal-head">
          <h3>检修记录详情 · {{ detailCode }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <table v-if="detailRow" class="data-table detail-table">
          <tbody>
            <tr v-for="column in detailColumns" :key="column">
              <th>{{ column }}</th>
              <td>{{ detailRow[column] || '—' }}</td>
            </tr>
            <tr>
              <th>当前状态</th>
              <td>{{ detailRow.status }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty-state">该检修编号不在当前检索条件（{{ criteriaSummary }}）的命中结果中，请调整条件后再查。</p>
        <p class="detail-hint">详情与列表使用同一份检索条件与口径，按检修编号定位，不会出现列表与详情错位。</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, runAction as applyAction } from '@/api/local-service'
import {
  OVERHAUL_CODE_FIELD,
  OVERHAUL_EQUIPMENT_FIELD,
  OVERHAUL_CATEGORY_FIELD,
  OVERHAUL_TEAM_FIELD,
  OVERHAUL_PLAN_FIELD,
  OVERHAUL_FINISH_FIELD,
  OVERHAUL_PARTS_FIELD,
  OVERHAUL_PAGE_SIZE,
  OVERHAUL_STATUSES,
  OVERHAUL_KEY,
  checkOverhaulLedgerEntry,
  describeOverhaulCriteria,
  emptyOverhaulCriteria,
  findOverhaulEntry,
  landOverhaulHits,
  listOverhaulLedger,
  normalizeOverhaulCriteria,
  searchOverhaul,
} from '@/data/overhaul'
import type { EntryRow } from '@/data/types'
import type { LedgerEntry, OverhaulCriteria, OverhaulSearchResult } from '@/data/overhaul'

const columns = [
  OVERHAUL_CODE_FIELD,
  OVERHAUL_EQUIPMENT_FIELD,
  OVERHAUL_CATEGORY_FIELD,
  OVERHAUL_TEAM_FIELD,
  OVERHAUL_PLAN_FIELD,
  OVERHAUL_FINISH_FIELD,
  OVERHAUL_PARTS_FIELD,
]
const detailColumns = columns
const statuses = [...OVERHAUL_STATUSES]
const actions = ['提交开工', '确认完工', '申请延期']
const 检修编号字段 = OVERHAUL_CODE_FIELD

const emptyResult = (): OverhaulSearchResult =>
  searchOverhaul(emptyOverhaulCriteria(), 1, OVERHAUL_PAGE_SIZE)

// form：查询表单；committed：已提交并被翻页/详情共同使用的唯一份条件。
const form = reactive<OverhaulCriteria>(emptyOverhaulCriteria())
const committed = ref<OverhaulCriteria>(emptyOverhaulCriteria())
const page = ref(1)
const result = ref<OverhaulSearchResult>(emptyResult())
const ledger = ref<LedgerEntry[]>([])
const errorMessage = ref('')

const detailVisible = ref(false)
const detailCode = ref('')

const criteriaSummary = computed(() => describeOverhaulCriteria(result.value.criteria))

// 状态统计基于本次检索的全部命中，不只数当前页，条数才对得上。
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: result.value.matched.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => {
  const monthPrefix = new Date().toISOString().slice(0, 7)
  return [
    { label: '待开工检修', value: countByStatus('待开工') },
    { label: '检修中记录', value: countByStatus('检修中') },
    {
      label: '本月完工数',
      value: result.value.matched.filter(
        (row) => String(row.status) === '已完工' && String(row[OVERHAUL_FINISH_FIELD]).startsWith(monthPrefix),
      ).length,
    },
  ]
})

const pendingLedgerCount = computed(() => ledger.value.filter((entry) => !entry.checked).length)

const detailRow = computed<EntryRow | null>(() =>
  detailVisible.value ? findOverhaulEntry(committed.value, detailCode.value) : null,
)

function countByStatus(status: string): number {
  return result.value.matched.filter((row) => String(row.status) === status).length
}

function statusClass(status: string): string {
  if (status === '已完工') return 'tag-done'
  if (status === '已延期') return 'tag-delay'
  if (status === '检修中') return 'tag-doing'
  return 'tag-todo'
}

// 查询：条件在此提交一次，页码归 1；后续翻页只改页码、不换条件。
function runQuery() {
  errorMessage.value = ''
  page.value = 1
  committed.value = normalizeOverhaulCriteria(form)
  reload()
}

function turnPage(target: number) {
  page.value = target
  reload()
}

function resetFilters() {
  Object.assign(form, emptyOverhaulCriteria())
  runQuery()
}

// 同一条检索通道：列表、翻页、状态流转后刷新都在这里取数。
function reload() {
  errorMessage.value = ''
  try {
    const payload = searchOverhaul(committed.value, page.value, OVERHAUL_PAGE_SIZE)
    result.value = payload
    page.value = payload.page
    // 命中结果整体落到检修计划待核对台账（不止当前页）。
    ledger.value = landOverhaulHits(payload.matched, describeOverhaulCriteria(payload.criteria))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '检修记录列表读取失败'
  }
}

function refreshLedger() {
  ledger.value = listOverhaulLedger()
}

function checkEntry(code: string) {
  ledger.value = checkOverhaulLedgerEntry(code)
}

function openDetail(code: string) {
  detailCode.value = code
  detailVisible.value = true
}

function closeDetail() {
  detailVisible.value = false
  detailCode.value = ''
}

function exportRows() {
  downloadEntries(OVERHAUL_KEY)
}

function openCreate() {
  errorMessage.value = '检修记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const outcome = applyAction(OVERHAUL_KEY, Number(row.id), action)
  if (!outcome.ok) {
    errorMessage.value = outcome.message
    return
  }
  reload()
  refreshLedger()
}

onMounted(reload)
</script>

import { moduleMeta } from '@/api/local-service'
import { listRows, readJson, writeJson } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// 设备检修检索专用通路：
// 1. 检索条件（检修班组 + 检修类别 + 检修状态，以及检修编号关键字）合并成一份快照，只过滤一遍；
// 2. 翻页始终用同一份条件往下取，不在各页之间各算各的；
// 3. 结果以「检修编号」去重，同一编号无论换什么条件、翻到第几页都只出现一条；
// 4. 状态以记录权威字段 status 为准（已完工一样能查出来）；
// 5. 命中的记录落到「检修计划待核对台账」，计划工期按命中当时快照保留，后续不再被覆盖。

const MODULE_KEY = 'overhaul'
const CODE_FIELD = '检修编号'
const TEAM_FIELD = '检修班组'
const CATEGORY_FIELD = '检修类别'
const PLAN_FIELD = '计划工期'
const LEDGER_KEY = 'waste-to-energy-plant:overhaul-pending-ledger'
const DEFAULT_PAGE_SIZE = 5

export type OverhaulCriteria = {
  keyword: string
  team: string
  category: string
  status: string
}

export type OverhaulPage = {
  items: EntryRow[]
  total: number
  page: number
  size: number
  totalPages: number
  criteria: OverhaulCriteria
  applied: boolean
}

export type LedgerEntry = {
  code: string
  status: string
  team: string
  category: string
  planPeriod: string
  hitCount: number
  firstHitAt: string
  lastHitAt: string
  hitCriteria: string
  checked: boolean
  checkedAt: string
}

const EMPTY_CRITERIA: OverhaulCriteria = { keyword: '', team: '', category: '', status: '' }

function normalize(input?: Partial<OverhaulCriteria>): OverhaulCriteria {
  return {
    keyword: (input?.keyword ?? '').trim(),
    team: (input?.team ?? '').trim(),
    category: (input?.category ?? '').trim(),
    status: (input?.status ?? '').trim(),
  }
}

function fieldText(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

// 一份条件只过滤这一遍：班组、类别、状态是 AND 组合，编号关键字在编号字段内包含匹配。
// 状态直接取权威的 status 字段，不再读展示用的「检修状态」列，已完工记录不会因此漏掉。
function matchRows(rows: EntryRow[], criteria: OverhaulCriteria): EntryRow[] {
  return rows.filter((row) => {
    if (criteria.keyword && !fieldText(row, CODE_FIELD).includes(criteria.keyword)) {
      return false
    }
    if (criteria.team && fieldText(row, TEAM_FIELD) !== criteria.team) {
      return false
    }
    if (criteria.category && fieldText(row, CATEGORY_FIELD) !== criteria.category) {
      return false
    }
    if (criteria.status && String(row.status) !== criteria.status) {
      return false
    }
    return true
  })
}

// 以检修编号去重：同一编号只保留一条（取编号最小/最早登记的那条），再按登记顺序稳定排序，
// 保证换条件再查、以及页与页之间都不会出现重复编号，total 与实际条数始终对得上。
function deduplicateByCode(rows: EntryRow[]): EntryRow[] {
  const seen = new Set<string>()
  const result: EntryRow[] = []
  for (const row of [...rows].sort((a, b) => Number(a.id) - Number(b.id))) {
    const code = fieldText(row, CODE_FIELD)
    const key = code || `id-${row.id}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(row)
  }
  return result
}

export function describeCriteria(criteria: OverhaulCriteria): string {
  const parts: string[] = []
  if (criteria.keyword) parts.push(`检修编号含「${criteria.keyword}」`)
  if (criteria.team) parts.push(`检修班组「${criteria.team}」`)
  if (criteria.category) parts.push(`检修类别「${criteria.category}」`)
  if (criteria.status) parts.push(`检修状态「${criteria.status}」`)
  return parts.length ? parts.join('，') : '全部检修记录'
}

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function readLedger(): LedgerEntry[] {
  return readJson<LedgerEntry[]>(LEDGER_KEY, [])
}

function saveLedger(entries: LedgerEntry[]): void {
  writeJson(LEDGER_KEY, entries)
}

// 检索命中落入待核对台账：编号为唯一键，已有记录只刷新命中信息，
// 计划工期（planPeriod）只在首次落账时写入，之后永久保留——历史记录按当时的计划工期留存。
function landInLedger(rows: EntryRow[], criteria: OverhaulCriteria): void {
  const entries = readLedger()
  const byCode = new Map(entries.map((entry) => [entry.code, entry]))
  const hitCriteria = describeCriteria(criteria)
  for (const row of rows) {
    const code = fieldText(row, CODE_FIELD)
    const timestamp = nowText()
    const existing = byCode.get(code)
    if (existing) {
      existing.status = String(row.status)
      existing.hitCount += 1
      existing.lastHitAt = timestamp
      existing.hitCriteria = hitCriteria
    } else {
      byCode.set(code, {
        code,
        status: String(row.status),
        team: fieldText(row, TEAM_FIELD),
        category: fieldText(row, CATEGORY_FIELD),
        planPeriod: fieldText(row, PLAN_FIELD),
        hitCount: 1,
        firstHitAt: timestamp,
        lastHitAt: timestamp,
        hitCriteria,
        checked: false,
        checkedAt: '',
      })
    }
  }
  saveLedger([...byCode.values()])
}

// 取一页数据：matched 是在固定条件下算出的完整去重结果，分页只是对它做切片，
// 因此第 N 页永远是第 (N-1)*size 之后的下一段，不会把上一页的记录再带出来。
function buildPage(matched: EntryRow[], criteria: OverhaulCriteria, page: number): OverhaulPage {
  const size = DEFAULT_PAGE_SIZE
  const total = matched.length
  const totalPages = Math.max(1, Math.ceil(total / size))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * size
  return {
    items: matched.slice(start, start + size),
    total,
    page: safePage,
    size,
    totalPages,
    criteria,
    applied: true,
  }
}

// 执行一次新检索：合并条件 → 过滤一遍 → 按编号去重 → 命中落台账 → 返回第一页。
// 翻页不要走这里，走 turnOverhaulPage，确保用的是同一份条件。
export function searchOverhaul(
  rawCriteria?: Partial<OverhaulCriteria>,
  page = 1,
): OverhaulPage {
  const criteria = normalize(rawCriteria)
  const matched = deduplicateByCode(matchRows(listRows(MODULE_KEY), criteria))
  landInLedger(matched, criteria)
  return buildPage(matched, criteria, page)
}

// 翻页：用本次检索冻结下来的同一份条件重新取数（数据可能因状态流转变化，但条件不变），
// 取到的仍是同一份去重结果的下一段，页间不重复、条数对得上。
export function turnOverhaulPage(criteria: Partial<OverhaulCriteria>, page: number): OverhaulPage {
  const normalized = normalize(criteria)
  const matched = deduplicateByCode(matchRows(listRows(MODULE_KEY), normalized))
  return buildPage(matched, normalized, page)
}

// 页面初次进入时的默认展示：等价于无条件检索，但不写台账——
// 只有用户主动点「查询/重置条件」才算一次检索、才把命中结果落到待核对台账。
export function openOverhaulPage(): OverhaulPage {
  const matched = deduplicateByCode(matchRows(listRows(MODULE_KEY), EMPTY_CRITERIA))
  return buildPage(matched, EMPTY_CRITERIA, 1)
}

// 详情与列表对齐：按同一份条件取回完整去重结果（不落台账），
// 详情里的位置、上一条/下一条都基于它，列表与详情就不会各取各的而错位。
export function fetchMatchedOverhaul(criteria: OverhaulCriteria): EntryRow[] {
  return deduplicateByCode(matchRows(listRows(MODULE_KEY), normalize(criteria)))
}

export function listLedger(scope: 'pending' | 'checked' | 'all' = 'pending'): LedgerEntry[] {
  const entries = readLedger().sort((a, b) => b.firstHitAt.localeCompare(a.firstHitAt))
  if (scope === 'all') {
    return entries
  }
  const wantChecked = scope === 'checked'
  return entries.filter((entry) => entry.checked === wantChecked)
}

export function reconcileLedger(code: string): void {
  const entries = readLedger()
  const target = entries.find((entry) => entry.code === code)
  if (target && !target.checked) {
    target.checked = true
    target.checkedAt = nowText()
    saveLedger(entries)
  }
}

export function ledgerCount(): { pending: number; checked: number } {
  const entries = readLedger()
  return {
    pending: entries.filter((entry) => !entry.checked).length,
    checked: entries.filter((entry) => entry.checked).length,
  }
}

export function filterOptions(): { teams: string[]; categories: string[] } {
  const rows = listRows(MODULE_KEY)
  const teams = new Set<string>()
  const categories = new Set<string>()
  for (const row of rows) {
    const team = fieldText(row, TEAM_FIELD)
    const category = fieldText(row, CATEGORY_FIELD)
    if (team) teams.add(team)
    if (category) categories.add(category)
  }
  return { teams: [...teams].sort(), categories: [...categories].sort() }
}

export function overhaulStatusSummary(): { status: string; count: number }[] {
  const statuses = moduleMeta(MODULE_KEY).statuses
  const rows = listRows(MODULE_KEY)
  return statuses.map((status) => ({
    status,
    count: rows.filter((row) => String(row.status) === status).length,
  }))
}

// 卡片指标：待开工、检修中（含已延期）、本月完工（按完工日期所在年月，已完工记录照常统计）。
export function overhaulMetrics(): { waiting: number; running: number; finishedThisMonth: number } {
  const rows = listRows(MODULE_KEY)
  const monthPrefix = new Date().toISOString().slice(0, 7)
  const statusOf = (row: EntryRow) => String(row.status)
  return {
    waiting: rows.filter((row) => statusOf(row) === '待开工').length,
    running: rows.filter((row) => ['检修中', '已延期'].includes(statusOf(row))).length,
    finishedThisMonth: rows.filter(
      (row) => statusOf(row) === '已完工' && fieldText(row, '完工日期').startsWith(monthPrefix),
    ).length,
  }
}

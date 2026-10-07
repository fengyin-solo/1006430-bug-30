import { listRows } from './local-store'
import type { EntryRow } from './types'

// 设备检修管理专用检索通道：
// 列表与详情都走这一条路，条件只归一化一次，翻页复用同一份命中结果。
// 去重以检修编号为准，已完工记录不做任何剔除。

export const OVERHAUL_KEY = 'overhaul'
export const OVERHAUL_CODE_FIELD = '检修编号'
export const OVERHAUL_EQUIPMENT_FIELD = '检修设备'
export const OVERHAUL_CATEGORY_FIELD = '检修类别'
export const OVERHAUL_TEAM_FIELD = '检修班组'
export const OVERHAUL_PLAN_FIELD = '计划工期'
export const OVERHAUL_FINISH_FIELD = '完工日期'
export const OVERHAUL_PARTS_FIELD = '更换备件'
export const OVERHAUL_STATUS_FIELD = '检修状态'

export const OVERHAUL_PAGE_SIZE = 5
export const OVERHAUL_STATUSES = ['待开工', '检修中', '已完工', '已延期'] as const

export type OverhaulCriteria = {
  team: string
  category: string
  status: string
}

export type OverhaulSearchResult = {
  items: EntryRow[]
  matched: EntryRow[]
  total: number
  page: number
  size: number
  pages: number
  criteria: OverhaulCriteria
  message: string
}

export type LedgerEntry = {
  code: string
  equipment: string
  category: string
  team: string
  // 计划工期、状态在首次命中时快照：历史记录按当时的计划工期保留，之后不再改写。
  planPeriod: string
  status: string
  parts: string
  firstHitAt: string
  lastHitAt: string
  hitSummary: string
  checked: boolean
  checkedAt: string
}

const LEDGER_STORAGE_KEY = 'waste-to-energy-plant:overhaul-ledger'

export function emptyOverhaulCriteria(): OverhaulCriteria {
  return { team: '', category: '', status: '' }
}

// 班组、类别、状态组合条件只在这里归一化一遍，查询与翻页拿到的是同一份对象。
export function normalizeOverhaulCriteria(input: Partial<OverhaulCriteria> | undefined): OverhaulCriteria {
  return {
    team: String(input?.team ?? '').trim(),
    category: String(input?.category ?? '').trim(),
    status: String(input?.status ?? '').trim(),
  }
}

export function describeOverhaulCriteria(criteria: OverhaulCriteria): string {
  const parts: string[] = []
  parts.push(criteria.team ? `检修班组：${criteria.team}` : '检修班组：全部')
  parts.push(criteria.category ? `检修类别：${criteria.category}` : '检修类别：全部')
  parts.push(criteria.status ? `检修状态：${criteria.status}` : '检修状态：全部')
  return parts.join('　')
}

function rowText(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

// 检修状态以流程状态字段 row.status 为准（已完工同样参与匹配）；
// 兼容历史数据里可能写过状态的「检修状态」列。
function statusOf(row: EntryRow): string {
  return String(row.status ?? '').trim() || rowText(row, OVERHAUL_STATUS_FIELD)
}

// 组合条件一次算完，不存在翻页、取数各算一遍的分叉。
export function matchOverhaulRows(rows: EntryRow[], criteria: OverhaulCriteria): EntryRow[] {
  return rows.filter((row) => {
    if (criteria.team && !rowText(row, OVERHAUL_TEAM_FIELD).includes(criteria.team)) {
      return false
    }
    if (criteria.category && !rowText(row, OVERHAUL_CATEGORY_FIELD).includes(criteria.category)) {
      return false
    }
    if (criteria.status && statusOf(row) !== criteria.status) {
      return false
    }
    return true
  })
}

// 以检修编号去重：同一编号只保留最早登记的一条，任何条件组合下都不会出现两次。
export function dedupeByOverhaulCode(rows: EntryRow[]): EntryRow[] {
  const seen = new Set<string>()
  const unique: EntryRow[] = []
  for (const row of [...rows].sort((a, b) => Number(a.id) - Number(b.id))) {
    const code = rowText(row, OVERHAUL_CODE_FIELD)
    if (!code || seen.has(code)) {
      continue
    }
    seen.add(code)
    unique.push(row)
  }
  return unique
}

const NO_DATA_MESSAGE = '暂无检修记录，可先登记检修记录后再检索。'
const NO_MATCH_MESSAGE = '没有检索到符合条件的检修记录，请调整检修班组、检修类别或检修状态后重新查询。'

// 唯一的检索入口：先按一份条件过滤，再按检修编号去重，最后在同一份有序结果上切片取页。
export function searchOverhaul(
  rawCriteria: Partial<OverhaulCriteria> | undefined,
  page = 1,
  size = OVERHAUL_PAGE_SIZE,
): OverhaulSearchResult {
  const criteria = normalizeOverhaulCriteria(rawCriteria)
  const source = listRows(OVERHAUL_KEY)
  const matched = dedupeByOverhaulCode(matchOverhaulRows(source, criteria))
  const total = matched.length
  const pages = Math.max(1, Math.ceil(total / size))
  const currentPage = Math.min(Math.max(1, Math.trunc(page) || 1), pages)
  const start = (currentPage - 1) * size
  return {
    items: matched.slice(start, start + size),
    matched,
    total,
    page: currentPage,
    size,
    pages,
    criteria,
    message: total === 0 ? (source.length === 0 ? NO_DATA_MESSAGE : NO_MATCH_MESSAGE) : '',
  }
}

// 详情与列表共用同一检索口径：在同一份命中集合里按检修编号定位，结果不会与列表错位。
export function findOverhaulEntry(
  rawCriteria: Partial<OverhaulCriteria> | undefined,
  code: string,
): EntryRow | null {
  const criteria = normalizeOverhaulCriteria(rawCriteria)
  const target = String(code ?? '').trim()
  if (!target) {
    return null
  }
  const { matched } = searchOverhaul(criteria, 1, Number.MAX_SAFE_INTEGER)
  return matched.find((row) => rowText(row, OVERHAUL_CODE_FIELD) === target) ?? null
}

// ---- 检修计划待核对台账：检索命中即落台账，同一编号只占一条 -----------------------

function nowStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function readLedger(): LedgerEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  try {
    const raw = window.localStorage.getItem(LEDGER_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as LedgerEntry[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLedger(entries: LedgerEntry[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(entries))
  }
}

export function listOverhaulLedger(): LedgerEntry[] {
  return readLedger()
}

function toLedgerEntry(row: EntryRow, hitSummary: string, hitAt: string): LedgerEntry {
  return {
    code: rowText(row, OVERHAUL_CODE_FIELD),
    equipment: rowText(row, OVERHAUL_EQUIPMENT_FIELD),
    category: rowText(row, OVERHAUL_CATEGORY_FIELD),
    team: rowText(row, OVERHAUL_TEAM_FIELD),
    planPeriod: rowText(row, OVERHAUL_PLAN_FIELD),
    status: statusOf(row),
    parts: rowText(row, OVERHAUL_PARTS_FIELD),
    firstHitAt: hitAt,
    lastHitAt: hitAt,
    hitSummary,
    checked: false,
    checkedAt: '',
  }
}

// 把本次检索的全部命中（不止当前页）落到待核对台账。
// 同一检修编号只保留一条：已有记录只刷新最近命中时间与条件，首次命中时的计划工期、状态不动。
export function landOverhaulHits(rows: EntryRow[], hitSummary: string): LedgerEntry[] {
  const entries = readLedger()
  const indexByCode = new Map(entries.map((entry, index) => [entry.code, index]))
  const hitAt = nowStamp()
  for (const row of dedupeByOverhaulCode(rows)) {
    const code = rowText(row, OVERHAUL_CODE_FIELD)
    if (!code) {
      continue
    }
    const index = indexByCode.get(code)
    if (index === undefined) {
      entries.unshift(toLedgerEntry(row, hitSummary, hitAt))
    } else {
      entries[index] = { ...entries[index], lastHitAt: hitAt, hitSummary }
    }
  }
  writeLedger(entries)
  return entries
}

export function checkOverhaulLedgerEntry(code: string): LedgerEntry[] {
  const target = String(code ?? '').trim()
  const entries = readLedger().map((entry) =>
    entry.code === target && !entry.checked
      ? { ...entry, checked: true, checkedAt: nowStamp() }
      : entry,
  )
  writeLedger(entries)
  return entries
}

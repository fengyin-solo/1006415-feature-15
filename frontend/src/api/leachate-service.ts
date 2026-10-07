import { getEntry, runAction } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 渗滤液处理的业务判断都收在这里，页面组件只管渲染和收集输入。
export const LEACHATE_KEY = 'leachate'
export const EMISSION_KEY = 'emission'

// 出水水质限值：《生活垃圾填埋场污染控制标准》GB 16889-2008 表2（焚烧厂渗滤液照此执行）。
export const LIMIT_STANDARD = 'GB 16889-2008 表2'
export const WATER_LIMITS = [
  { field: '出水COD值', limit: 100, unit: 'mg/L' },
  { field: '出水氨氮值', limit: 25, unit: 'mg/L' },
] as const

export type WaterJudge = { abnormal: boolean; basis: string }

export type LeachateInput = {
  处理编号: string
  进水水量: string
  出水水量: string
  出水COD值: string
  出水氨氮值: string
  处理班次: string
  记录时间: string
}

function toNumber(value: string): number | null {
  if (value.trim() === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function nowText(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function todayText(): string {
  return nowText().slice(0, 10)
}

function limitText(): string {
  return WATER_LIMITS.map((item) => `${item.field}≤${item.limit} ${item.unit}`).join('，')
}

// 超限判定：出水COD值、出水氨氮值任一超限即异常，判定依据写清实测值、限值与标准出处。
export function judgeWaterQuality(cod: number, nh3n: number): WaterJudge {
  const values: Record<string, number> = { 出水COD值: cod, 出水氨氮值: nh3n }
  const exceeded = WATER_LIMITS.filter((item) => values[item.field] > item.limit).map(
    (item) => `${item.field} ${values[item.field]} ${item.unit} 超过限值 ${item.limit} ${item.unit}`,
  )
  if (exceeded.length > 0) {
    return {
      abnormal: true,
      basis: `${exceeded.join('；')}（判定依据：${LIMIT_STANDARD}，限值：${limitText()}）`,
    }
  }
  return {
    abnormal: false,
    basis: `出水COD值 ${cod} mg/L、出水氨氮值 ${nh3n} mg/L 均未超限（判定依据：${LIMIT_STANDARD}，限值：${limitText()}）`,
  }
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 给登记表单一个默认编号：在已有编号的最大序号上顺延。
export function nextLeachateCode(): string {
  const max = listRows(LEACHATE_KEY).reduce((acc, row) => {
    const match = /^LEAC-(\d+)$/.exec(String(row['处理编号'] ?? ''))
    return match ? Math.max(acc, Number(match[1])) : acc
  }, 0)
  return `LEAC-${String(max + 1).padStart(4, '0')}`
}

export function findByCode(code: string): EntryRow | undefined {
  return listRows(LEACHATE_KEY).find((row) => String(row['处理编号']) === code)
}

// 登记/重复登记：同一条处理编号只保留最新一版（版本号递增），跨班提交也以最后一版为准。
export function saveLeachateRecord(input: LeachateInput): ActionResult {
  const code = input.处理编号.trim()
  if (!code) {
    return { ok: false, message: '处理编号不能为空' }
  }
  const inflow = toNumber(input.进水水量)
  const outflow = toNumber(input.出水水量)
  const cod = toNumber(input.出水COD值)
  const nh3n = toNumber(input.出水氨氮值)
  if (inflow === null || inflow < 0) {
    return { ok: false, message: '进水水量要填不小于 0 的数字' }
  }
  if (outflow === null || outflow < 0) {
    return { ok: false, message: '出水水量要填不小于 0 的数字' }
  }
  if (cod === null || cod < 0) {
    return { ok: false, message: '出水COD值要填不小于 0 的数字' }
  }
  if (nh3n === null || nh3n < 0) {
    return { ok: false, message: '出水氨氮值要填不小于 0 的数字' }
  }
  if (!input.处理班次.trim()) {
    return { ok: false, message: '处理班次不能为空' }
  }
  if (!input.记录时间.trim()) {
    return { ok: false, message: '记录时间不能为空' }
  }

  const rows = listRows(LEACHATE_KEY)
  const index = rows.findIndex((row) => String(row['处理编号']) === code)
  const existing = index >= 0 ? rows[index] : undefined
  const judge = judgeWaterQuality(cod, nh3n)
  const version = existing ? Number(existing['版本'] ?? 1) + 1 : 1
  const status = judge.abnormal ? '指标异常' : '待处理'
  const record: EntryRow = {
    id: existing ? Number(existing.id) : nextId(rows),
    status,
    pending: true,
    abnormal: judge.abnormal,
    处理编号: code,
    进水水量: inflow,
    出水水量: outflow,
    出水COD值: cod,
    出水氨氮值: nh3n,
    处理班次: input.处理班次.trim(),
    记录时间: input.记录时间.trim(),
    处理状态: status,
    版本: version,
    判定依据: judge.basis,
  }
  const next = [...rows]
  if (index >= 0) {
    next[index] = record
  } else {
    next.push(record)
  }
  if (!saveRows(LEACHATE_KEY, next)) {
    return { ok: false, message: '本地存储写入失败，这一版没有落地，请检查浏览器存储空间' }
  }
  // 这个编号之前同步过达标结论的话，按最新一版刷新实测值，环保监控那边不留旧数。
  refreshEmissionSync(record)
  const message = existing
    ? `处理编号 ${code} 已更新为第 ${version} 版，同一编号只保留这一版`
    : `处理编号 ${code} 已登记${judge.abnormal ? '，水质超限已标为指标异常' : ''}`
  return { ok: true, message }
}

// 确认达标：先按落地的水质数据复核，超限直接驳回；达标结论同步到环保监控待复核清单。
export function confirmLeachate(id: number): ActionResult {
  const row = getEntry(LEACHATE_KEY, id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的渗滤液处理记录` }
  }
  const cod = Number(row['出水COD值'])
  const nh3n = Number(row['出水氨氮值'])
  if (!Number.isFinite(cod) || !Number.isFinite(nh3n)) {
    return { ok: false, message: '出水COD值或出水氨氮值缺失，不能确认达标' }
  }
  const judge = judgeWaterQuality(cod, nh3n)
  if (judge.abnormal) {
    return { ok: false, message: `出水水质超限，不能确认达标：${judge.basis}` }
  }
  const result = runAction(LEACHATE_KEY, id, '确认达标')
  if (!result.ok) {
    return result
  }
  syncEmission(row, `达标（待复核）：${judge.basis}`)
  return { ok: true, message: `${result.message}，达标结论已同步到环保指标监控待复核清单` }
}

// 上报异常：有水质数据就按限值判定给依据，没有就记人工上报。
export function reportLeachateAbnormal(id: number): ActionResult {
  const rows = listRows(LEACHATE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的渗滤液处理记录` }
  }
  const row = rows[index]
  const cod = Number(row['出水COD值'])
  const nh3n = Number(row['出水氨氮值'])
  const judge =
    Number.isFinite(cod) && Number.isFinite(nh3n) ? judgeWaterQuality(cod, nh3n) : null
  const basis = judge && judge.abnormal ? judge.basis : '人工上报异常（值班复核确认）'
  const updated: EntryRow = {
    ...row,
    status: '指标异常',
    pending: true,
    abnormal: true,
    处理状态: '指标异常',
    判定依据: basis,
  }
  const next = [...rows]
  next[index] = updated
  if (!saveRows(LEACHATE_KEY, next)) {
    return { ok: false, message: '本地存储写入失败，异常上报没有落地' }
  }
  return { ok: true, message: `渗滤液处理记录已标为指标异常：${basis}` }
}

function emissionEntry(record: EntryRow, verdict: string, rows: EntryRow[]): EntryRow {
  const monitorCode = `EMIS-${String(record['处理编号'])}`
  const existing = rows.find((row) => String(row['监控编号']) === monitorCode)
  return {
    id: existing ? Number(existing.id) : nextId(rows),
    status: '监控中',
    pending: true,
    abnormal: Boolean(record.abnormal),
    监控编号: monitorCode,
    监控指标: '渗滤液出水水质',
    限值要求: `${limitText()}（${LIMIT_STANDARD}）`,
    实测值: `出水COD值 ${String(record['出水COD值'])} mg/L，出水氨氮值 ${String(record['出水氨氮值'])} mg/L`,
    达标判定: verdict,
    监控日期: todayText(),
    监控人员: '渗滤液处理班',
    监控状态: '待复核',
  }
}

// 达标结论同步到环保监控：按监控编号去重，复核通过前一直挂在待复核清单里。
function syncEmission(record: EntryRow, verdict: string): void {
  const rows = listRows(EMISSION_KEY)
  const entry = emissionEntry(record, verdict, rows)
  const index = rows.findIndex((row) => String(row['监控编号']) === String(entry['监控编号']))
  const next = [...rows]
  if (index >= 0) {
    next[index] = entry
  } else {
    next.push(entry)
  }
  saveRows(EMISSION_KEY, next)
}

// 重新登记后刷新已同步的监控记录：实测值跟着最新一版走，结论退回待复核。
function refreshEmissionSync(record: EntryRow): void {
  const rows = listRows(EMISSION_KEY)
  const monitorCode = `EMIS-${String(record['处理编号'])}`
  if (!rows.some((row) => String(row['监控编号']) === monitorCode)) {
    return
  }
  const verdict = record.abnormal
    ? '已重新登记，水质超限，待复核'
    : '已重新登记，待复核'
  syncEmission(record, verdict)
}

export type LeachateStat = { label: string; value: string | number }

// 统计卡片按当前落地的全量数据现算，不停在旧数上。
export function leachateStats(): LeachateStat[] {
  const rows = listRows(LEACHATE_KEY)
  const sumInflow = (status: string) =>
    rows
      .filter((row) => String(row.status) === status)
      .reduce((sum, row) => sum + (Number(row['进水水量']) || 0), 0)
  return [
    { label: '待处理水量', value: `${sumInflow('待处理')} m³` },
    { label: '处理中水量', value: `${sumInflow('处理中')} m³` },
    { label: '指标异常次数', value: rows.filter((row) => row.abnormal).length },
  ]
}

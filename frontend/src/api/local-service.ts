import { MODULE_BY_KEY } from '@/data/modules'
import { listRows, refreshCache, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 渗滤液出水限值：依据 GB 16889-2008《生活垃圾填埋场污染控制标准》表2，
// 焚烧厂渗滤液出水照此判定，超限即标异常并写明判定依据。
const LEACHATE_LIMIT_BASIS = 'GB 16889-2008 表2'
const LEACHATE_LIMITS: Record<string, { limit: number; unit: string }> = {
  出水COD值: { limit: 100, unit: 'mg/L' },
  出水氨氮值: { limit: 25, unit: 'mg/L' },
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// 每个模块的状态约定：倒数第二个是「办结」，最后一个是「异常终态」。
function doneStatus(meta: ModuleMeta): string {
  return meta.statuses[meta.statuses.length - 2] ?? meta.statuses[0]
}

function abnormalStatus(meta: ModuleMeta): string {
  return meta.statuses[meta.statuses.length - 1]
}

// 末尾的「X状态」字段跟着当前状态走，列表各列和状态不会读出两个数。
function withStatusField(meta: ModuleMeta, row: EntryRow): EntryRow {
  const statusField = meta.fields[meta.fields.length - 1]
  if (statusField && statusField.endsWith('状态')) {
    return { ...row, [statusField]: row.status }
  }
  return row
}

function parseNumber(value: unknown): number | null {
  const num = Number(String(value ?? '').trim())
  return String(value ?? '').trim() !== '' && Number.isFinite(num) ? num : null
}

// 出水COD值、出水氨氮值超限判定：返回异常标记和判定依据，没超限依据为空。
function judgeLeachate(row: EntryRow): { abnormal: boolean; reason: string } {
  const breaches: string[] = []
  for (const [field, { limit, unit }] of Object.entries(LEACHATE_LIMITS)) {
    const value = parseNumber(row[field])
    if (value !== null && value > limit) {
      breaches.push(`${field} ${value}${unit} 超过限值 ${limit}${unit}`)
    }
  }
  if (breaches.length === 0) {
    return { abnormal: false, reason: '' }
  }
  return { abnormal: true, reason: `${breaches.join('；')}（判定依据：${LEACHATE_LIMIT_BASIS}）` }
}

// 达标结论同步到环保指标监控：同一处理编号只留一条，进入待复核清单（监控中、待处理）；
// 记录后来改回未达标或异常时同步修正，复核清单不留旧结论。
function syncLeachateToEmission(leachateRow: EntryRow): void {
  const code = `EMIS-${String(leachateRow['处理编号'] ?? '').trim()}`
  const rows = listRows('emission')
  const index = rows.findIndex((row) => String(row['监控编号']) === code)
  if (leachateRow.status !== '已达标' && index < 0) {
    return
  }
  const meta = moduleMeta('emission')
  const base: EntryRow =
    index >= 0
      ? { ...rows[index] }
      : {
          id: rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1,
          status: meta.statuses[0],
          pending: true,
          abnormal: false,
        }
  const compliant = leachateRow.status === '已达标' && !leachateRow.abnormal
  const synced: EntryRow = {
    ...base,
    监控编号: code,
    监控指标: '渗滤液出水',
    限值要求: `COD≤${LEACHATE_LIMITS['出水COD值'].limit}mg/L，氨氮≤${LEACHATE_LIMITS['出水氨氮值'].limit}mg/L（${LEACHATE_LIMIT_BASIS}）`,
    实测值: `COD ${String(leachateRow['出水COD值'] ?? '—')}mg/L，氨氮 ${String(leachateRow['出水氨氮值'] ?? '—')}mg/L`,
    达标判定: compliant ? '达标' : leachateRow.abnormal ? '未达标' : '待判定',
    监控日期: String(leachateRow['记录时间'] ?? ''),
    监控人员: String(leachateRow['处理班次'] ?? ''),
    status: compliant ? '监控中' : leachateRow.abnormal ? abnormalStatus(meta) : meta.statuses[0],
    abnormal: Boolean(leachateRow.abnormal),
    pending: true,
  }
  synced.pending = synced.status !== doneStatus(meta)
  const next = [...rows]
  if (index >= 0) {
    next[index] = withStatusField(meta, synced)
  } else {
    next.push(withStatusField(meta, synced))
  }
  saveRows('emission', next)
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 别的窗口/班次落了新数据时，先丢掉内存里的旧副本再读，保证两边看到的是同一份。
export function refreshEntries(): void {
  refreshCache()
}

// 详情和列表读的是同一份本地留存，按 id 取，不走第二份数据。
export function getEntry(key: string, id: number): EntryRow | undefined {
  return listRows(key).find((row) => Number(row.id) === id)
}

// 登记/补录：同一处理编号重复登记只保留最新一版（跨班提交以最后提交为准），
// 渗滤液出水超限自动标异常并写清判定依据，达标结论同步环保监控待复核清单。
export function saveEntry(key: string, values: Record<string, string>): ActionResult {
  const meta = moduleMeta(key)
  const codeField = meta.fields[0]
  const code = String(values[codeField] ?? '').trim()
  if (!code) {
    return { ok: false, message: `${codeField}不能为空，没法落地` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => String(row[codeField] ?? '').trim() === code)
  const previous = index >= 0 ? rows[index] : undefined
  let row: EntryRow = {
    id: previous ? Number(previous.id) : rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
    status: previous ? String(previous.status) : meta.statuses[0],
    pending: true,
    abnormal: false,
    ...previous,
    ...Object.fromEntries(meta.fields.map((field) => [field, String(values[field] ?? '').trim()])),
    [codeField]: code,
  }
  if (key === 'leachate') {
    const verdict = judgeLeachate(row)
    row.abnormal = verdict.abnormal
    row['异常说明'] = verdict.reason
    if (verdict.abnormal) {
      row.status = abnormalStatus(meta)
    } else if (String(previous?.status) === abnormalStatus(meta)) {
      // 上一版超限，这版回到限值内：退回待处理重新走流程。
      row.status = meta.statuses[0]
    }
  }
  row.pending = row.status !== doneStatus(meta)
  row = withStatusField(meta, row)
  const next = [...rows]
  if (index >= 0) {
    next[index] = row
  } else {
    next.push(row)
  }
  if (!saveRows(key, next)) {
    return { ok: false, message: '本地存储写不进去，这一版没有落地，列表仍按上一次落地的版本显示' }
  }
  if (key === 'leachate') {
    syncLeachateToEmission(row)
  }
  const parts = [previous ? `${meta.entity} ${code} 已用最新一版覆盖` : `${meta.entity} ${code} 已登记`]
  if (row.abnormal) {
    parts.push(`已标异常：${String(row['异常说明'])}`)
  }
  return { ok: true, message: parts.join('，') }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const next = [...rows]
  if (key === 'leachate') {
    // 水质数据先过限值这道关：超限的记录不能确认达标，异常标记跟着数值走。
    const verdict = judgeLeachate(next[index])
    if (target === doneStatus(meta) && verdict.abnormal) {
      return { ok: false, message: `出水指标超限，不能确认达标：${verdict.reason}` }
    }
    next[index] = { ...next[index], abnormal: verdict.abnormal, 异常说明: verdict.reason }
    if (!verdict.abnormal && target === abnormalStatus(meta)) {
      // 人工上报异常但数值未超限：异常照样标，判定依据写清是人工上报。
      next[index]['异常说明'] = `人工上报异常，出水指标未超限（限值：COD≤${LEACHATE_LIMITS['出水COD值'].limit}mg/L，氨氮≤${LEACHATE_LIMITS['出水氨氮值'].limit}mg/L，${LEACHATE_LIMIT_BASIS}）`
    }
  }
  let updated: EntryRow = {
    ...next[index],
    status: target,
    pending: target !== doneStatus(meta),
    abnormal:
      NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)) ||
      target === abnormalStatus(meta) ||
      (key === 'leachate' && Boolean(next[index].abnormal)),
  }
  updated = withStatusField(meta, updated)
  next[index] = updated
  if (!saveRows(key, next)) {
    return { ok: false, message: '本地存储写不进去，状态没有落地，列表仍按上一次落地的版本显示' }
  }
  if (key === 'leachate') {
    syncLeachateToEmission(updated)
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  // 汇总前强制重读真正落地的数据，待处理水量不停在旧数上。
  const rows = refreshCache()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

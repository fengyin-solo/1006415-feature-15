import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'waste-to-energy-plant:entries'
// 上一次真正落地的版本：主数据读不出来时按它显示，避免直接退回示例数据。
const BACKUP_KEY = 'waste-to-energy-plant:entries:last-good'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isValidPayload(value: unknown): value is Record<string, EntryRow[]> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePayload(raw: string | null): Record<string, EntryRow[]> | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    return isValidPayload(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeKey(key: string, value: Record<string, EntryRow[]>): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    // 主数据从来没写过（或被主动清掉）：按示例数据播种。
    writeKey(STORAGE_KEY, fallback)
    return fallback
  }
  const parsed = parsePayload(raw)
  if (parsed) {
    return { ...fallback, ...parsed }
  }
  // 主数据损坏读不出来：回退到上一次真正落地的版本，并把它写回主数据。
  const backup = parsePayload(window.localStorage.getItem(BACKUP_KEY))
  if (backup) {
    const restored = { ...fallback, ...backup }
    writeKey(STORAGE_KEY, restored)
    return restored
  }
  writeKey(STORAGE_KEY, fallback)
  return fallback
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

// 写成功才更新内存缓存，并留一份「最后落地」快照；写不进存储时返回 false，
// 调用方据此报错，保证列表上看到的和真正落地的始终是同一份。
export function saveRows(key: string, rows: EntryRow[]): boolean {
  const next = { ...allRows(), [key]: rows }
  if (typeof window !== 'undefined' && window.localStorage) {
    if (!writeKey(STORAGE_KEY, next)) {
      return false
    }
    writeKey(BACKUP_KEY, next)
  }
  cache = next
  return true
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

// 强制重新读一遍真正落地的数据，概览等汇总页用它避免停在旧数上。
export function refreshCache(): Record<string, EntryRow[]> {
  cache = readStorage()
  return cache
}

export function storageKey(): string {
  return STORAGE_KEY
}

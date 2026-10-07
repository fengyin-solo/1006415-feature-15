import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'waste-to-energy-plant:entries'
// 上一次真正落地的版本：主存储被清坏、JSON 损坏读不出来时，按这份显示。
const BACKUP_KEY = 'waste-to-energy-plant:entries:last-good'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null
    }
    return window.localStorage
  } catch {
    return null
  }
}

function isValidPayload(value: unknown): value is Record<string, EntryRow[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  return Object.values(value as Record<string, unknown>).every((rows) => Array.isArray(rows))
}

function readKey(store: Storage, key: string): Record<string, EntryRow[]> | null {
  const raw = store.getItem(key)
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

function writeKey(store: Storage, key: string, value: Record<string, EntryRow[]>): boolean {
  try {
    store.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  const store = storage()
  if (!store) {
    return fallback
  }
  const main = readKey(store, STORAGE_KEY)
  if (main) {
    return { ...fallback, ...main }
  }
  // 主存储读不出来：回退到上一次真正落地的版本，并把它扶正回主存储。
  const backup = readKey(store, BACKUP_KEY)
  if (backup) {
    writeKey(store, STORAGE_KEY, backup)
    return { ...fallback, ...backup }
  }
  writeKey(store, STORAGE_KEY, fallback)
  writeKey(store, BACKUP_KEY, fallback)
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

// 返回是否真正落地：主存储写成功才算落地，同时留一份最后落地版本做兜底。
export function saveRows(key: string, rows: EntryRow[]): boolean {
  const next = { ...allRows(), [key]: rows }
  const store = storage()
  if (!store) {
    return false
  }
  if (!writeKey(store, STORAGE_KEY, next)) {
    return false
  }
  cache = next
  writeKey(store, BACKUP_KEY, next)
  return true
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 交接班可能一个在交班机、一个在接班机（或两个标签页）同时开着：
// 另一边落了数，这边缓存立即作废，重新读同一份，两个班看到的数保持一致。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === STORAGE_KEY || event.key === BACKUP_KEY) {
      cache = null
    }
  })
}

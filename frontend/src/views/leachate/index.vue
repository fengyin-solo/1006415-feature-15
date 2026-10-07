<template>
  <section class="page" data-module="leachate">
    <header class="page-head">
      <div>
        <h2>渗滤液处理管理</h2>
        <p class="page-desc">
          维护渗滤液处理记录，围绕处理编号、进水水量、出水水量、出水COD值、出水氨氮值做登记、筛选与状态流转。
          出水COD值≤100mg/L、出水氨氮值≤25mg/L（GB 16889-2008 表2），超限自动标异常并写明判定依据。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记渗滤液处理记录</button>
        <button class="btn" type="button" @click="exportRows">导出渗滤液处理清单</button>
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
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-abnormal': row.abnormal }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="row.abnormal" class="warn-tag" :title="String(row['异常说明'] ?? '')">异常</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button class="link" type="button" @click="openEdit(row)">编辑</button>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无渗滤液处理数据，可先登记渗滤液处理记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条渗滤液处理记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="showForm" class="dialog-mask" @click.self="showForm = false">
      <form class="dialog" @submit.prevent="submitForm">
        <header class="dialog-head">
          <h3>{{ editing ? '重新登记渗滤液处理记录' : '登记渗滤液处理记录' }}</h3>
          <p class="dialog-desc">
            同一处理编号重复登记只保留最新一版，跨班提交以最后登记的一版为准，两个班看到的是同一份数。
          </p>
        </header>
        <div class="form-grid">
          <label class="form-item">
            <span>处理编号</span>
            <input v-model="form['处理编号']" :readonly="editing" required placeholder="如 LEAC-0004" />
          </label>
          <label class="form-item">
            <span>进水水量</span>
            <input v-model="form['进水水量']" type="number" step="any" min="0" placeholder="吨" />
          </label>
          <label class="form-item">
            <span>出水水量</span>
            <input v-model="form['出水水量']" type="number" step="any" min="0" placeholder="吨" />
          </label>
          <label class="form-item">
            <span>出水COD值</span>
            <input v-model="form['出水COD值']" type="number" step="any" min="0" placeholder="mg/L，限值 100" />
          </label>
          <label class="form-item">
            <span>出水氨氮值</span>
            <input v-model="form['出水氨氮值']" type="number" step="any" min="0" placeholder="mg/L，限值 25" />
          </label>
          <label class="form-item">
            <span>处理班次</span>
            <input v-model="form['处理班次']" placeholder="如 白班 08:00-20:00" />
          </label>
          <label class="form-item">
            <span>记录时间</span>
            <input v-model="form['记录时间']" type="datetime-local" />
          </label>
        </div>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <footer class="dialog-actions">
          <button class="btn ghost" type="button" @click="showForm = false">取消</button>
          <button class="btn primary" type="submit">保存</button>
        </footer>
      </form>
    </div>

    <div v-if="detail" class="dialog-mask" @click.self="detail = null">
      <section class="dialog">
        <header class="dialog-head">
          <h3>渗滤液处理记录详情 · {{ detail['处理编号'] }}</h3>
          <p class="dialog-desc">详情与列表读的是同一份本地留存，刷新后仍是这一版。</p>
        </header>
        <dl class="detail-grid">
          <template v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ detail[column] ?? '—' }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detail.status }}</dd>
          <dt>是否异常</dt>
          <dd>{{ detail.abnormal ? '异常' : '正常' }}</dd>
          <template v-if="detail.abnormal">
            <dt>判定依据</dt>
            <dd class="error-text">{{ detail['异常说明'] || '—' }}</dd>
          </template>
        </dl>
        <footer class="dialog-actions">
          <button class="btn" type="button" @click="openEdit(detail)">编辑这条</button>
          <button class="btn primary" type="button" @click="detail = null">关闭</button>
        </footer>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  downloadEntries,
  getEntry,
  listEntries,
  moduleMeta,
  refreshEntries,
  runAction as applyAction,
  saveEntry,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('leachate')
const columns = ["处理编号", "进水水量", "出水水量", "出水COD值", "出水氨氮值", "处理班次", "记录时间", "处理状态"]
const actions = ["提交处理", "确认达标", "上报异常"]
const statuses = ["待处理", "处理中", "已达标", "指标异常"]

const store = useSessionStore()
const rows = ref<EntryRow[]>([])
const allRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const showForm = ref(false)
const editing = ref(false)
const form = ref<Record<string, string>>({})
const formError = ref('')
const detail = ref<EntryRow | null>(null)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: allRows.value.filter((row) => String(row.status) === status).length,
  })),
)

function volumeOf(status: string): number {
  return allRows.value
    .filter((row) => String(row.status) === status)
    .reduce((sum, row) => sum + (Number(row['进水水量']) || 0), 0)
}

const stats = computed(() => [
  { label: '待处理水量', value: volumeOf('待处理') },
  { label: '处理中水量', value: volumeOf('处理中') },
  { label: '指标异常次数', value: allRows.value.filter((row) => row.abnormal).length },
])

function nowLocal(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function blankForm(): Record<string, string> {
  return {
    处理编号: '',
    进水水量: '',
    出水水量: '',
    出水COD值: '',
    出水氨氮值: '',
    处理班次: store.shiftLabel,
    记录时间: nowLocal(),
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  editing.value = false
  form.value = blankForm()
  formError.value = ''
  showForm.value = true
}

function openEdit(row: EntryRow) {
  const current = getEntry(meta.key, Number(row.id))
  if (!current) {
    errorMessage.value = '这条渗滤液处理记录读不出来，请刷新后重试'
    return
  }
  editing.value = true
  detail.value = null
  form.value = { ...blankForm(), ...Object.fromEntries(columns.map((column) => [column, String(current[column] ?? '')])) }
  formError.value = ''
  showForm.value = true
}

function openDetail(row: EntryRow) {
  const current = getEntry(meta.key, Number(row.id))
  if (!current) {
    errorMessage.value = '这条渗滤液处理记录读不出来，请刷新后重试'
    return
  }
  detail.value = current
}

function submitForm() {
  formError.value = ''
  const result = saveEntry(meta.key, form.value)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  showForm.value = false
  noticeMessage.value = result.message
  errorMessage.value = ''
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    allRows.value = listEntries(meta.key).items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '渗滤液处理列表读取失败'
  }
}

function onStorage(event: StorageEvent) {
  if (event.key && event.key.startsWith('waste-to-energy-plant')) {
    refreshEntries()
    reload()
  }
}

onMounted(() => {
  reload()
  window.addEventListener('storage', onStorage)
})

onUnmounted(() => {
  window.removeEventListener('storage', onStorage)
})
</script>

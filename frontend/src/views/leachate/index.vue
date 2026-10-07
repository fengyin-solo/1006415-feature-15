<template>
  <section class="page" data-module="leachate">
    <header class="page-head">
      <div>
        <h2>渗滤液处理管理</h2>
        <p class="page-desc">维护渗滤液处理记录，围绕处理编号、进水水量、出水水量、出水COD值做登记、筛选与状态流转。</p>
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
          <td v-for="column in columns" :key="column">
            <template v-if="column === '处理编号'">
              {{ row[column] ?? '—' }}
              <span v-if="Number(row['版本']) > 1" class="version-tag">v{{ row['版本'] }}</span>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>
            <span
              :class="{ 'status-abnormal': row.abnormal }"
              :title="row.abnormal ? String(row['判定依据'] ?? '') : ''"
            >
              {{ row.abnormal ? '⚠ ' : '' }}{{ row.status }}
            </span>
          </td>
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
            <button class="link" type="button" @click="openDetail(row)">详情</button>
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

    <div v-if="formVisible" class="modal-mask" @click.self="closeForm">
      <div class="modal-card">
        <h3 class="modal-title">登记渗滤液处理记录</h3>
        <form @submit.prevent="submitForm">
          <div class="form-grid">
            <label class="form-item">
              <span>处理编号</span>
              <input v-model="form.处理编号" placeholder="如 LEAC-0004" required />
            </label>
            <label class="form-item">
              <span>处理班次</span>
              <select v-model="form.处理班次">
                <option v-for="shift in shiftOptions" :key="shift" :value="shift">{{ shift }}</option>
              </select>
            </label>
            <label class="form-item">
              <span>进水水量（m³）</span>
              <input v-model="form.进水水量" type="number" min="0" step="0.1" required />
            </label>
            <label class="form-item">
              <span>出水水量（m³）</span>
              <input v-model="form.出水水量" type="number" min="0" step="0.1" required />
            </label>
            <label class="form-item">
              <span>出水COD值（mg/L）</span>
              <input v-model="form.出水COD值" type="number" min="0" step="0.1" required />
            </label>
            <label class="form-item">
              <span>出水氨氮值（mg/L）</span>
              <input v-model="form.出水氨氮值" type="number" min="0" step="0.1" required />
            </label>
            <label class="form-item">
              <span>记录时间</span>
              <input v-model="form.记录时间" type="datetime-local" required />
            </label>
          </div>
          <p v-if="existingVersion" class="form-hint">
            处理编号 {{ form.处理编号 }} 已登记过（当前第 {{ existingVersion }} 版），保存后只保留最新一版，交接两个班看到的都是这一版。
          </p>
          <p v-if="judgePreview" class="judge-preview" :class="{ abnormal: judgePreview.abnormal }">
            {{ judgePreview.abnormal ? '保存后将标为指标异常：' : '水质判定：' }}{{ judgePreview.basis }}
          </p>
          <p v-if="formError" class="error-text">{{ formError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="closeForm">取消</button>
            <button class="btn primary" type="submit">保存登记</button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="detailRow" class="modal-mask" @click.self="closeDetail">
      <div class="modal-card">
        <h3 class="modal-title">渗滤液处理记录详情 · {{ detailRow['处理编号'] }}</h3>
        <dl class="detail-list">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd :class="{ 'status-abnormal': field === '判定依据' && detailRow.abnormal }">
              {{ detailRow[field] ?? '—' }}
            </dd>
          </template>
        </dl>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
          <button class="btn" type="button" @click="reRegister">按此编号重新登记</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  getEntry,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  confirmLeachate,
  judgeWaterQuality,
  leachateStats,
  nextLeachateCode,
  nowText,
  reportLeachateAbnormal,
  saveLeachateRecord,
  findByCode,
} from '@/api/leachate-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('leachate')
const columns = ["处理编号", "进水水量", "出水水量", "出水COD值", "出水氨氮值", "处理班次", "记录时间", "处理状态"]
const actions = ["提交处理", "确认达标", "上报异常"]
const statuses = ["待处理", "处理中", "已达标", "指标异常"]
const detailFields = [...columns, '版本', '判定依据']

const store = useSessionStore()
const shiftOptions = ['白班 08:00-20:00', '夜班 20:00-08:00']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const stats = ref(leachateStats())
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const formVisible = ref(false)
const formError = ref('')
const emptyForm = () => ({
  处理编号: nextLeachateCode(),
  进水水量: '',
  出水水量: '',
  出水COD值: '',
  出水氨氮值: '',
  处理班次: shiftOptions.includes(store.shiftLabel) ? store.shiftLabel : shiftOptions[0],
  记录时间: nowText().replace(' ', 'T'),
})
const form = ref(emptyForm())

// 同一个处理编号已登记过时给出提示：保存后只保留最新一版。
const existingVersion = computed(() => {
  const code = form.value.处理编号.trim()
  if (!code) {
    return 0
  }
  const existing = findByCode(code)
  return existing ? Number(existing['版本'] ?? 1) : 0
})

// 录入水质数据时实时给出判定依据，超限在保存前就能看见。
const judgePreview = computed(() => {
  const cod = Number(form.value.出水COD值)
  const nh3n = Number(form.value.出水氨氮值)
  if (form.value.出水COD值 === '' || form.value.出水氨氮值 === '') {
    return null
  }
  if (!Number.isFinite(cod) || !Number.isFinite(nh3n)) {
    return null
  }
  return judgeWaterQuality(cod, nh3n)
})

const detailRow = ref<EntryRow | null>(null)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  form.value = emptyForm()
  formError.value = ''
  formVisible.value = true
}

function closeForm() {
  formVisible.value = false
}

function submitForm() {
  formError.value = ''
  const result = saveLeachateRecord({
    ...form.value,
    记录时间: form.value.记录时间.replace('T', ' '),
  })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  formVisible.value = false
  noticeMessage.value = result.message
  reload()
}

// 详情与列表读同一份落地数据：打开时按 id 重新取，不用列表里的旧快照。
function openDetail(row: EntryRow) {
  detailRow.value = getEntry(meta.key, Number(row.id)) ?? row
}

function closeDetail() {
  detailRow.value = null
}

function reRegister() {
  const row = detailRow.value
  if (!row) {
    return
  }
  form.value = {
    处理编号: String(row['处理编号'] ?? ''),
    进水水量: String(row['进水水量'] ?? ''),
    出水水量: String(row['出水水量'] ?? ''),
    出水COD值: String(row['出水COD值'] ?? ''),
    出水氨氮值: String(row['出水氨氮值'] ?? ''),
    处理班次: shiftOptions.includes(store.shiftLabel) ? store.shiftLabel : shiftOptions[0],
    记录时间: nowText().replace(' ', 'T'),
  }
  formError.value = ''
  detailRow.value = null
  formVisible.value = true
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  let result
  if (action === '确认达标') {
    result = confirmLeachate(Number(row.id))
  } else if (action === '上报异常') {
    result = reportLeachateAbnormal(Number(row.id))
  } else {
    result = applyAction(meta.key, Number(row.id), action)
  }
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
    stats.value = leachateStats()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '渗滤液处理列表读取失败'
  }
}

onMounted(reload)
</script>

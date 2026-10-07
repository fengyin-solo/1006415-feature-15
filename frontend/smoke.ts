// 冒烟测试：用真实 local-service + local-store 跑一遍渗滤液留存的关键场景。
// 运行：npx esbuild smoke.ts --bundle --alias:@=./src --format=esm --outfile=/tmp/smoke.mjs && node /tmp/smoke.mjs

// --- localStorage / window  shim（要在 import 数据层之前装好） ---
const store = new Map<string, string>()
let failWrites = false
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (failWrites) throw new Error('QuotaExceededError')
      store.set(k, String(v))
    },
    removeItem: (k: string) => void store.delete(k),
  },
}

const svc = await import('./src/api/local-service')
const store_ = await import('./src/data/local-store')

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`ok   ${name}`)
  } else {
    failures++
    console.log(`FAIL ${name}`, extra ?? '')
  }
}

const KEY = 'waste-to-energy-plant:entries'
const BACKUP = 'waste-to-energy-plant:entries:last-good'

// 1. 登记后重新读取（模拟刷新）数据还在
let r = svc.saveEntry('leachate', {
  处理编号: 'LEAC-1001', 进水水量: '120', 出水水量: '110', 出水COD值: '58', 出水氨氮值: '12',
  处理班次: '白班', 记录时间: '2026-10-07T08:30',
})
check('登记成功', r.ok, r)
store_.refreshCache() // 模拟刷新后重读
let row = svc.listEntries('leachate').items.find((x) => x['处理编号'] === 'LEAC-1001')
check('刷新后进水/出水/COD/氨氮还在', !!row && row['进水水量'] === '120' && row['出水水量'] === '110' && row['出水COD值'] === '58' && row['出水氨氮值'] === '12', row)
check('详情与列表同一份', svc.getEntry('leachate', Number(row!.id)) === svc.listEntries('leachate').items.find((x) => x['处理编号'] === 'LEAC-1001'))

// 2. 同一处理编号重复登记（跨班）只留最新一版
r = svc.saveEntry('leachate', {
  处理编号: 'LEAC-1001', 进水水量: '150', 出水水量: '140', 出水COD值: '62', 出水氨氮值: '15',
  处理班次: '夜班', 记录时间: '2026-10-07T20:30',
})
check('跨班重复登记返回覆盖提示', r.ok && r.message.includes('覆盖'), r)
const same = svc.listEntries('leachate').items.filter((x) => x['处理编号'] === 'LEAC-1001')
check('同一处理编号只有一条', same.length === 1, same)
check('留下的是夜班最后一版', same[0]['进水水量'] === '150' && same[0]['处理班次'] === '夜班', same[0])

// 3. 超限自动标异常并写判定依据
r = svc.saveEntry('leachate', {
  处理编号: 'LEAC-1002', 进水水量: '80', 出水水量: '75', 出水COD值: '132', 出水氨氮值: '31',
  处理班次: '白班', 记录时间: '2026-10-07T09:00',
})
row = svc.listEntries('leachate').items.find((x) => x['处理编号'] === 'LEAC-1002')
check('超限记录标成异常', r.ok && row!.abnormal === true && row!.status === '指标异常', row)
check('判定依据写明限值与标准', String(row!['异常说明']).includes('GB 16889-2008') && String(row!['异常说明']).includes('132'), row!['异常说明'])

// 4. 超限记录不能确认达标
r = svc.runAction('leachate', Number(row!.id), '确认达标')
check('超限禁止确认达标', !r.ok && r.message.includes('超限'), r)

// 5. 改回限值内 → 异常解除、状态退回待处理；再走流程确认达标
svc.saveEntry('leachate', {
  处理编号: 'LEAC-1002', 进水水量: '80', 出水水量: '75', 出水COD值: '88', 出水氨氮值: '20',
  处理班次: '夜班', 记录时间: '2026-10-07T21:00',
})
row = svc.listEntries('leachate').items.find((x) => x['处理编号'] === 'LEAC-1002')
check('回到限值内异常解除', row!.abnormal === false && row!.status === '待处理', row)
svc.runAction('leachate', Number(row!.id), '提交处理')
r = svc.runAction('leachate', Number(row!.id), '确认达标')
row = svc.listEntries('leachate').items.find((x) => x['处理编号'] === 'LEAC-1002')
check('确认达标后不再是待处理', r.ok && row!.status === '已达标' && row!.pending === false, row)

// 6. 达标结论同步到环保监控待复核清单
const emis = svc.listEntries('emission').items.find((x) => x['监控编号'] === 'EMIS-LEAC-1002')
check('环保监控出现待复核记录', !!emis && emis.status === '监控中' && emis.pending === true && emis['达标判定'] === '达标', emis)
check('同步的实测值与落地数据一致', String(emis!['实测值']).includes('88') && String(emis!['实测值']).includes('20'), emis!['实测值'])

// 7. 记录改回异常，复核清单同步修正不留旧结论
svc.saveEntry('leachate', {
  处理编号: 'LEAC-1002', 进水水量: '80', 出水水量: '75', 出水COD值: '140', 出水氨氮值: '20',
  处理班次: '白班', 记录时间: '2026-10-08T08:00',
})
const emis2 = svc.listEntries('emission').items.filter((x) => x['监控编号'] === 'EMIS-LEAC-1002')
check('复核清单仍只有一条且改判未达标', emis2.length === 1 && emis2[0]['达标判定'] === '未达标' && emis2[0].abnormal === true, emis2)

// 8. 概览待处理数跟着落地数据走，不停在旧数
const before = svc.loadOverview().modules.find((m) => m.name === '渗滤液处理')!
svc.saveEntry('leachate', {
  处理编号: 'LEAC-1003', 进水水量: '60', 出水水量: '55', 出水COD值: '50', 出水氨氮值: '10',
  处理班次: '白班', 记录时间: '2026-10-08T09:00',
})
const after = svc.loadOverview().modules.find((m) => m.name === '渗滤液处理')!
check('概览待处理数新增后立刻变化', after.pending === before.pending + 1, { before, after })

// 9. 主数据损坏 → 按上一次真正落地的版本显示
const good = JSON.parse(store.get(KEY)!)
store.set(KEY, '{corrupted-json')
store_.refreshCache()
const restored = svc.listEntries('leachate').items.find((x) => x['处理编号'] === 'LEAC-1003')
check('损坏后回退到最后落地版本', !!restored && restored['进水水量'] === '60', restored)
check('主数据被修复为最后落地版本', JSON.stringify(JSON.parse(store.get(KEY)!)) === JSON.stringify(good))

// 10. 备份也坏了 → 回示例数据，不白屏
store.set(BACKUP, 'not-json')
store.set(KEY, '{still-broken')
store_.refreshCache()
check('两份都读不出时回示例数据', svc.listEntries('leachate').items.some((x) => x['处理编号'] === 'LEAC-0001'))

// 11. 存储写不进去 → 报错且列表仍按上一次落地的版本显示
failWrites = true
r = svc.saveEntry('leachate', {
  处理编号: 'LEAC-1999', 进水水量: '10', 出水水量: '9', 出水COD值: '10', 出水氨氮值: '1',
  处理班次: '白班', 记录时间: '2026-10-08T10:00',
})
check('写失败明确报错', !r.ok && r.message.includes('没有落地'), r)
check('写失败后列表不出现没落地的记录', !svc.listEntries('leachate').items.some((x) => x['处理编号'] === 'LEAC-1999'))
failWrites = false

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)

// 报废销账业务流程的端到端校验：在 Node 里模拟浏览器 localStorage。
import { mkdirSync, writeFileSync } from 'node:fs'

const store = {}
globalThis.window = {
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v)
    },
    removeItem: (k) => delete store[k],
  },
}

const { build } = await import('vite')
mkdirSync('/tmp/tooling-test', { recursive: true })
await build({
  configFile: '/workspace/frontend/vite.config.ts',
  logLevel: 'silent',
  build: {
    ssr: true,
    rollupOptions: {
      input: '/workspace/frontend/src/api/local-service.ts',
      output: { dir: '/tmp/tooling-test', format: 'es', entryFileNames: 'svc.mjs' },
    },
  },
})
const {
  listEntries,
  runToolingAction,
  updateToolingAssignment,
  reconcileReviewLedger,
  toolingMetrics,
  toolingConsistency,
  listReviewEntries,
} = await import('/tmp/tooling-test/svc.mjs')

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.error(`  ✗ ${name} ${extra}`)
  }
}

const qingshan = { operator: '青山光伏电站保管人', station: '青山光伏电站', isCustodian: true }
const wanghai = { operator: '望海光伏电站保管人', station: '望海光伏电站', isCustodian: true }
const readonlyOp = { operator: '巡检员（只读）', station: '青山光伏电站', isCustodian: false }

function rows() {
  return listEntries('tooling').items
}
function byCode(code) {
  return rows().find((r) => r['工器具编号'] === code)
}

console.log('# 初始播种与迁移')
const m0 = toolingMetrics()
check('初始在册 4 件（已报废 TOOL-0005 不计）', m0.registered === 4, JSON.stringify(m0))
check('初始已报废 1 件', m0.scrapped === 1)
check('已报废件下次试验日已清空', byCode('TOOL-0005')['下次试验日'] === '')
check('已报废件在册标记=已销账', byCode('TOOL-0005')['工器具状态'] === '已销账')
check(
  '在册件下次试验日均为合法日期',
  rows().filter((r) => r.status !== '已报废').every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r['下次试验日'])),
)

console.log('# 超期件不许直接报废，必须先补送检')
const overdue = byCode('TOOL-0003')
check('TOOL-0003 当前为已超期', overdue.status === '已超期')
let r = runToolingAction(overdue.id, '办理报废', wanghai)
check('直接报废被当场拒绝', !r.ok && r.message.includes('当场拒绝'), r.message)
check('拒绝时状态未变', byCode('TOOL-0003').status === '已超期')
check('拒绝时在册数未减', toolingMetrics().registered === 4)
r = runToolingAction(overdue.id, '送检登记', wanghai)
check('补送检成功', r.ok, r.message)
const afterSend = byCode('TOOL-0003')
check('送检后状态=待试验', afterSend.status === '待试验')
check('送检后仍在册', afterSend['工器具状态'] === '在册')
check(
  '接地线周期60个月：2026-10-04 送检 → 下次试验日 2031-10-04',
  afterSend['下次试验日'] === '2031-10-04',
  afterSend['下次试验日'],
)

console.log('# 越权：别的电站与非保管人')
const t1 = byCode('TOOL-0001') // 青山
r = runToolingAction(t1.id, '办理报废', wanghai)
check('望海保管人报废青山件被拦截退回', !r.ok && r.message.includes('越权'), r.message)
check('拦截后状态不变', byCode('TOOL-0001').status === '试验合格')
r = runToolingAction(t1.id, '办理报废', readonlyOp)
check('非保管人被拦截', !r.ok && r.message.includes('越权'), r.message)
r = updateToolingAssignment(t1.id, { station: '望海光伏电站', keeper: '某人' }, wanghai)
check('跨电站改归属被拦截', !r.ok && r.message.includes('越权'), r.message)

console.log('# 一次销账：状态/在册/下次试验日/复核台账同一笔')
const beforeCount = listReviewEntries().length
r = runToolingAction(t1.id, '办理报废', qingshan)
check('本电站保管人报废成功', r.ok, r.message)
const scrapped = byCode('TOOL-0001')
check('状态=已报废', scrapped.status === '已报废')
check('在册标记=已销账', scrapped['工器具状态'] === '已销账')
check('下次试验日已清除', scrapped['下次试验日'] === '')
check('在册数量核减为 3', toolingMetrics().registered === 3, JSON.stringify(toolingMetrics()))
const reviews = listReviewEntries()
check('复核台账新增一行', reviews.length === beforeCount + 1)
const rev = reviews.find((x) => x['工器具编号'] === 'TOOL-0001')
check('复核行带复核单号与结论', !!rev && /^REVW-\d{4}$/.test(rev['复核单号']) && rev['复核结论'].includes('报废'))

console.log('# 连点两次只销一次')
r = runToolingAction(t1.id, '办理报废', qingshan)
check('第二次报废被幂等拒绝', !r.ok && r.message.includes('不能重复报废'), r.message)
check('台账仍然只有一条该件复核行', reviews.filter((x) => x['工器具编号'] === 'TOOL-0001').length === 1)
r = runToolingAction(t1.id, '送检登记', qingshan)
check('已报废件送检也被只读拦截', !r.ok && r.message.includes('只读'), r.message)
r = updateToolingAssignment(t1.id, { station: '青山光伏电站', keeper: '张三' }, qingshan)
check('已报废件改归属被只读拦截', !r.ok && r.message.includes('只读'), r.message)

console.log('# 两处在册数对账 + 周期一致性')
const rec = reconcileReviewLedger()
check('工器具台账在册数=3', rec.registeredCount === 3, String(rec.registeredCount))
check('复核台账已核销=2（含播种的0005）', rec.scrappedInLedger === 2, String(rec.scrappedInLedger))
check('两处在册工器具数对得上', rec.matched, JSON.stringify(rec))
check('周期/在册状态无异常', rec.issues.length === 0, JSON.stringify(rec.issues))

console.log('# 制造一个周期不一致，校验能抓出来')
const db = JSON.parse(store['pv-plant-ops:entries'])
const t4 = db.tooling.find((x) => x['工器具编号'] === 'TOOL-0004')
t4['下次试验日'] = '2030-01-01'
const issues = toolingConsistency(db.tooling)
const hit = issues.find((i) => i['工器具编号'] === 'TOOL-0004')
check('抓出下次试验日与周期不符（绝缘杆12个月）', !!hit && hit['问题'].includes('不符'), JSON.stringify(hit))

console.log('# 待试验件确认合格：下次试验日从试验日期补起')
const t2 = byCode('TOOL-0002') // 青山、待试验、绝缘手套 2026-04-01
r = runToolingAction(t2.id, '确认合格', qingshan)
check('确认合格成功', r.ok, r.message)
check(
  '合格后下次试验日 = 2026-04-01 + 6个月 = 2026-10-01',
  byCode('TOOL-0002')['下次试验日'] === '2026-10-01',
  byCode('TOOL-0002')['下次试验日'],
)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
writeFileSync('/tmp/tooling-test/result.txt', `${pass} ${fail}`)
process.exit(fail ? 1 : 0)

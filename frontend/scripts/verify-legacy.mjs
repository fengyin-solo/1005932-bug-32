// 校验：老版本 localStorage（占位串 + 已报废仍挂下次试验日）迁移后自动修复。
const store = {}
globalThis.window = { localStorage: {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => delete store[k],
} }

// 老数据：v1（无版本号），工器具字段是占位串，还有一条已报废但仍挂着下次试验日
store['pv-plant-ops:entries'] = JSON.stringify({
  tooling: [
    { id: 1, status: '试验合格', pending: true, abnormal: false, '工器具编号': 'TOOL-0001',
      '名称规格': '绝缘手套', '试验类别': '绝缘手套', '试验日期': '2026-05-01',
      '下次试验日': '安全工器具样例1', '保管人员': '安全工器具样例1', '所在电站': '安全工器具样例1', '工器具状态': '安全工器具样例1' },
    { id: 2, status: '已报废', pending: false, abnormal: false, '工器具编号': 'TOOL-0009',
      '名称规格': '老验电器', '试验类别': '验电器', '试验日期': '2025-01-01',
      '下次试验日': '2025-07-01', '保管人员': '张三', '所在电站': '老电站X', '工器具状态': '在册' },
    // 老记录自带旧版周期 18 个月：兼容既有在册记录，应沿用 18 而非新版周期表
    { id: 3, status: '试验合格', pending: false, abnormal: false, '工器具编号': 'TOOL-0010',
      '名称规格': '特殊绝缘杆', '试验类别': '绝缘操作杆', '试验日期': '2026-01-01',
      '下次试验日': '占位', '保管人员': '李四', '所在电站': '青山光伏电站', '工器具状态': '在册', '试验周期(月)': 18 },
  ],
})

const { build } = await import('vite')
await build({ configFile: '/workspace/frontend/vite.config.ts', logLevel: 'silent', build: { ssr: true,
  rollupOptions: { input: '/workspace/frontend/src/api/local-service.ts', output: { dir: '/tmp/tooling-test2', format: 'es', entryFileNames: 'svc.mjs' } } } })

const { toolingConsistency, toolingMetrics, listEntries } = await import('/tmp/tooling-test2/svc.mjs')
const items = listEntries('tooling').items
let ok = true
const assert = (name, cond, extra='') => { console.log((cond?'  ✓ ':'  ✗ ')+name+(cond?'':' '+extra)); if(!cond) ok=false }

assert('迁移后在 v1→v2 自动补电站', ['青山光伏电站','望海光伏电站'].includes(items[0]['所在电站']), items[0]['所在电站'])
assert('迁移后绝缘手套按6个月从2026-05-01补起 → 2026-11-01', items[0]['下次试验日']==='2026-11-01', items[0]['下次试验日'])
assert('迁移后已报废件下次试验日清空', items[1]['下次试验日']==='')
assert('迁移后已报废件在册标记=已销账', items[1]['工器具状态']==='已销账')
assert('迁移后老记录沿用旧版周期18个月 → 2027-07-01', items[2]['下次试验日']==='2027-07-01', items[2]['下次试验日'])
assert('迁移后在册数=2（已报废不计）', toolingMetrics().registered===2)
const issues = toolingConsistency()
assert('迁移后周期/在册一致性校验无异常', issues.length===0, JSON.stringify(issues))
process.exit(ok?0:1)

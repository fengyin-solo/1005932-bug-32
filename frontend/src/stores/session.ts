import { defineStore } from 'pinia'

import { STATIONS } from '@/data/tooling'
import type { OperatorContext } from '@/data/types'

// 演示用的值班身份：切换电站/保管人身份，用来验证「归属按电站划开」的拦截。
export const OPERATOR_PRESETS: { operator: string; station: string; isCustodian: boolean }[] = [
  { operator: '青山光伏电站保管人', station: STATIONS[0], isCustodian: true },
  { operator: '望海光伏电站保管人', station: STATIONS[1], isCustodian: true },
  { operator: '沙塬光伏电站保管人', station: STATIONS[2], isCustodian: true },
  { operator: '云顶光伏电站保管人', station: STATIONS[3], isCustodian: true },
  { operator: '巡检员（只读）', station: STATIONS[0], isCustodian: false },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: OPERATOR_PRESETS[0].operator,
    shiftLabel: '白班 08:00-20:00',
    scope: '光伏电站运行维护管理平台',
    station: OPERATOR_PRESETS[0].station,
    isCustodian: OPERATOR_PRESETS[0].isCustodian,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    operatorContext(state): OperatorContext {
      return { operator: state.operator, station: state.station, isCustodian: state.isCustodian }
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    usePreset(preset: { operator: string; station: string; isCustodian: boolean }) {
      this.operator = preset.operator
      this.station = preset.station
      this.isCustodian = preset.isCustodian
    },
  },
})

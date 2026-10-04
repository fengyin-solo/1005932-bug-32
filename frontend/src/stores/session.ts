import { defineStore } from 'pinia'

// 演示用的电站目录：归属按电站划开，切换电站即可验证跨站只读与越权拦截。
export const STATIONS = ['青山光伏电站', '白云光伏电站'] as const

export const KEEPERS_BY_STATION: Record<string, string[]> = {
  青山光伏电站: ['王建国', '李淑芬'],
  白云光伏电站: ['赵海涛', '周敏'],
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '王建国',
    // 当前保管人归属的电站；只有本电站的保管人能改本电站工器具的所在电站与保管人员。
    station: '青山光伏电站' as string,
    shiftLabel: '白班 08:00-20:00',
    scope: '光伏电站运行维护管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    keepers: (state) => KEEPERS_BY_STATION[state.station] ?? [],
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    /** 切换当前归属电站，并把操作人切到该电站的首位保管人。 */
    setStation(station: string) {
      this.station = station
      const keepers = KEEPERS_BY_STATION[station]
      if (keepers && !keepers.includes(this.operator)) {
        this.operator = keepers[0]
      }
    },
    setOperator(operator: string) {
      this.operator = operator
    },
  },
})

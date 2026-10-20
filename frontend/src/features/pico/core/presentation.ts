import type { PicoMeta } from './types'

export const AREA_NAMES: Record<string, string> = {
  factory: '工厂',
  tools: '工具',
  admin: '管理',
  about: '关于',
}

/** 顶部只显示一次位置：工厂 / 空压机 A。 */
export function buildContextTitle(area: string, deviceName?: string): string {
  const name = AREA_NAMES[area] ?? '工作台'
  return deviceName ? `${name} / ${deviceName}` : name
}

/** 用户距离底部足够近时才跟随新消息，不打断回看历史。 */
export function isNearBottom(
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = 48,
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold
}

/** 元数据只放在折叠详情里，不再是每条消息的彩色标签墙。 */
export function metaDetails(meta?: PicoMeta): Array<{ label: string; value: string }> {
  if (!meta) return []
  const data =
    meta.data_status === 'current'
      ? '当前'
      : meta.data_status === 'stale'
        ? '已过期'
        : '缺失'
  const source =
    meta.source_kind === 'real'
      ? '真实数据'
      : meta.source_kind === 'simulated'
        ? '设备仿真'
        : meta.source_kind === 'offline'
          ? '离线实验'
          : '来源未确认'
  const model =
    meta.llm === 'live'
      ? '真实模型'
      : meta.llm === 'unconfigured'
        ? '内置模板（AI 服务未配置）'
        : '内置模板（模型暂不可用）'
  const rows = [
    { label: '数据时效', value: data },
    { label: '数据来源', value: source },
    { label: '回答方式', value: model },
  ]
  if (meta.degraded) rows.push({ label: '质量提示', value: '部分证据不足，需人工复核' })
  return rows
}

export function shouldAutoRead(
  autoRead: boolean,
  responseType: 'answer' | 'error',
  speechAvailable: boolean,
): boolean {
  return autoRead && speechAvailable && responseType === 'answer'
}

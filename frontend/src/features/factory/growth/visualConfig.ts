import type { ModelKind } from './modelTypes'

export const ICON_KEYS = ['compressor', 'pump', 'motor', 'machine'] as const
export type IconKey = typeof ICON_KEYS[number]
export interface VisualChoice { displayAlias?: string; iconKey: IconKey; accentColor: string }
export type VisualChoices = Record<string, VisualChoice>
export const ACCENTS = ['#B8424E', '#4D7E8A', '#73836A', '#A47D46', '#686996', '#68777E'] as const

export function modelKindForType(type: string): ModelKind {
  return type === 'compressor' || type === 'pump' || type === 'motor' ? type : 'generic'
}
export function defaultVisual(type: string): VisualChoice {
  const kind = modelKindForType(type)
  return { iconKey: kind === 'generic' ? 'machine' : kind,
    accentColor: kind === 'pump' ? ACCENTS[1] : kind === 'motor' ? ACCENTS[2] : ACCENTS[0] }
}
export function validateVisual(value: unknown): VisualChoice {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('外观设置格式无效')
  const item = value as Record<string, unknown>
  if (Object.keys(item).some(key => !['displayAlias', 'iconKey', 'accentColor'].includes(key))) throw new Error('包含不支持的外观字段')
  if (!ICON_KEYS.includes(item.iconKey as IconKey)) throw new Error('请选择列表中的图标')
  if (typeof item.accentColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.accentColor)) throw new Error('识别色须为 #RRGGBB')
  if (item.displayAlias != null && typeof item.displayAlias !== 'string') throw new Error('展示别名格式无效')
  const alias = (item.displayAlias as string | undefined)?.normalize('NFC').trim()
  if (alias && (Array.from(alias).length < 2 || Array.from(alias).length > 24 || /[\p{Cc}\p{Cf}]/u.test(alias))) {
    throw new Error('别名须为 2–24 个字符，不能包含控制或隐藏格式字符')
  }
  return { ...(alias ? { displayAlias: alias } : {}), iconKey: item.iconKey as IconKey, accentColor: item.accentColor.toUpperCase() }
}
export function appearanceKey(userId: number, origin: string) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('需要有效账户')
  return `factory:visual:v1:${encodeURIComponent(origin)}:${userId}`
}

import { icons } from 'lucide-react'

/**
 * 根据 icon 名称解析 lucide 图标组件
 * fallback 为 name 前两个字母大写
 */
export function resolveIcon(iconName?: string, size = 16, fallbackName?: string) {
  if (iconName) {
    const IconComponent = icons[iconName as keyof typeof icons]
    if (IconComponent) return <IconComponent size={size} />
  }
  // fallback: 取 name 前两个字母
  const letters = (fallbackName || '??').slice(0, 2).toUpperCase()
  return <span style={{ fontSize: size * 0.7, fontWeight: 600, lineHeight: 1 }}>{letters}</span>
}

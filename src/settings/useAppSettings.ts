import { useEffect, useState } from 'react'
import { defaultSettings, readSettings, SETTINGS_KEY } from './appSettings'

export function useAppSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      return readSettings(window.localStorage)
    } catch {
      return defaultSettings()
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // 浏览器禁用存储时，设置仍在当前页面生效。
    }
  }, [settings])

  return [settings, setSettings] as const
}

import { definePlugin } from '@hiven/plugin'
import { SystemSettingsSurface } from '../../components/SystemSettingsSurface'

export default definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'System Settings',
        titleI18n: { zh: '系统设置', en: 'System Settings' },
        icon: '⚙',
        aliases: ['settings', 'preferences', '设置', '偏好设置', 'plugins', '插件', '插件管理'],
        component: SystemSettingsSurface,
        entry: {
          launcher: true,
          shortcutBindable: true,
          recommendedShortcut: 'CmdOrCtrl+,',
        },
        shell: {
          defaultWidth: 800,
          defaultHeight: 600,
          minWidth: 640,
          minHeight: 480,
          closeOnBlur: false,
          resizable: true,
          breadcrumbTitle: 'System Settings',
          breadcrumbTitleI18n: { zh: '系统设置', en: 'System Settings' },
        },
      },
    ],
  },
})

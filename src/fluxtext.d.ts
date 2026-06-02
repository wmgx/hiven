// fluxtext 模块类型声明，供 builtin-scripts 中的脚本使用
declare module 'fluxtext' {
  export interface ActionContext {
    input: { text: string }
    params: Record<string, any>
    readClipboard: () => Promise<string>
    /** 从 URL 加载远程模块，带本地持久缓存 */
    loadCDN: (url: string) => Promise<any>
    /** @deps 声明的依赖，系统自动加载后注入 */
    deps: Record<string, any>
  }
  export function defineAction(def: {
    name: string
    title: string
    icon?: string
    optionalParams?: boolean
    [key: string]: any
  }): any
}

import type { PluginToolContribution } from './types'

export function assertLearnableToolSaveableContract(tool: PluginToolContribution): void {
  if (tool.policy?.learnable !== true) return
  for (const param of tool.params ?? []) {
    if (typeof param.saveable !== 'boolean') {
      throw new Error(`Learnable tool "${tool.id}" param "${param.key}" must declare saveable: true | false`)
    }
    if (
      param.type === 'text' &&
      param.saveable &&
      (!Number.isInteger(param.saveableMaxLength) || param.saveableMaxLength! < 1 || param.saveableMaxLength! > 256)
    ) {
      throw new Error(`Learnable tool "${tool.id}" param "${param.key}" must declare saveableMaxLength in 1..256`)
    }
  }
}

import type { JsonOperation } from './jsonCore'

export const operationRoutes: { id: JsonOperation; titleKey: string; descriptionKey: string; aliases: string[] }[] = [
  { id: 'typescript', titleKey: 'route.typescript', descriptionKey: 'route.typescript.description', aliases: ['json to typescript', 'json types', 'json to ts', 'json转类型', 'json 转 TypeScript'] },
  { id: 'format', titleKey: 'json.prettify.title', descriptionKey: 'json.prettify.description', aliases: ['json format', 'format json', 'json格式化', '格式化', 'fmt'] },
  { id: 'compact', titleKey: 'json.compact.title', descriptionKey: 'json.compact.description', aliases: ['json compact', 'json minify', 'json compress', 'json压缩', 'json 压缩', '压缩'] },
  { id: 'expression', titleKey: 'route.expression', descriptionKey: 'route.expression.description', aliases: ['json expression', 'json filter', 'js filter', 'jq', 'expression', '表达式', 'json表达式', 'json 表达式'] },
  { id: 'yaml-to-json', titleKey: 'yaml.toJson.title', descriptionKey: 'yaml.toJson.description', aliases: ['yaml', 'yml', 'yaml to json', 'yml to json', 'yaml2json', 'yaml转json', 'yaml 转 json'] },
  { id: 'json-to-yaml', titleKey: 'yaml.fromJson.title', descriptionKey: 'yaml.fromJson.description', aliases: ['json to yaml', 'json to yml', 'json2yaml', 'json转yaml', 'json 转 yaml'] },
  { id: 'query-to-json', titleKey: 'queryString.toJson.title', descriptionKey: 'queryString.toJson.description', aliases: ['query to json', 'query string to json', 'query string', '查询参数', 'qs2json', 'query转json'] },
  { id: 'json-to-query', titleKey: 'queryString.fromJson.title', descriptionKey: 'queryString.fromJson.description', aliases: ['json to query', 'json to query string', 'json2qs', 'json转query'] },
  { id: 'escape', titleKey: 'json.escape.title', descriptionKey: 'json.escape.description', aliases: ['json escape', 'json转义', 'json 转义', '转义'] },
  { id: 'unescape', titleKey: 'json.unescape.title', descriptionKey: 'json.unescape.description', aliases: ['json unescape', 'json反转义', 'json 反转义', '反转义'] },
]

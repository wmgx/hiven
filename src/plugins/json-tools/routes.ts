import type { JsonOperation } from './jsonCore'

export const operationRoutes: { id: JsonOperation; titleKey: string; aliases: string[] }[] = [
  { id: 'format', titleKey: 'json.prettify.title', aliases: ['json format', 'format json', '格式化 JSON', 'json pretty', 'pretty json', 'pretty-json', 'json-format', 'json格式化', 'json 格式化', '格式化', 'fmt'] },
  { id: 'compact', titleKey: 'json.compact.title', aliases: ['json compact', 'json minify', 'json compress', 'json压缩', 'json 压缩', '压缩'] },
  { id: 'sort', titleKey: 'sortJson.title', aliases: ['json sort', 'sort json keys', 'json排序', 'json 排序', '排序'] },
  { id: 'expression', titleKey: 'route.expression', aliases: ['json expression', 'json filter', 'js filter', 'jq', 'expression', '表达式', 'json表达式', 'json 表达式'] },
  { id: 'yaml-to-json', titleKey: 'yaml.toJson.title', aliases: ['yaml', 'yml', 'yaml to json', 'yml to json', 'yaml2json', 'yaml转json', 'yaml 转 json'] },
  { id: 'json-to-yaml', titleKey: 'yaml.fromJson.title', aliases: ['json to yaml', 'json to yml', 'json2yaml', 'json转yaml', 'json 转 yaml'] },
  { id: 'query-to-json', titleKey: 'queryString.toJson.title', aliases: ['query to json', 'query string to json', 'query string', '查询参数', 'qs2json', 'query转json'] },
  { id: 'json-to-query', titleKey: 'queryString.fromJson.title', aliases: ['json to query', 'json to query string', 'json2qs', 'json转query'] },
  { id: 'escape', titleKey: 'json.escape.title', aliases: ['json escape', 'json转义', 'json 转义', '转义'] },
  { id: 'unescape', titleKey: 'json.unescape.title', aliases: ['json unescape', 'json反转义', 'json 反转义', '反转义'] },
]

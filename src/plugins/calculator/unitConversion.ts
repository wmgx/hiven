import BigNumber from 'bignumber.js'

// Local, bounded conversions only. Factors are exact decimal definitions;
// data uses bits as its base and never lowercases symbols (B ≠ b).
const Decimal = BigNumber.clone({ DECIMAL_PLACES: 100, ROUNDING_MODE: BigNumber.ROUND_HALF_UP })
type Dimension = 'length' | 'mass' | 'data'
type Unit = { symbol: string; dimension: Dimension; factor: string }
const units = new Map<string, Unit>()

function add(dimension: Dimension, symbol: string, factor: string, aliases: string[] = []) {
  const unit = { dimension, symbol, factor }
  for (const alias of [symbol, ...aliases]) units.set(alias, unit)
}

add('length', 'mm', '0.001', ['millimeter', 'millimeters', 'millimetre', 'millimetres', '毫米'])
add('length', 'cm', '0.01', ['centimeter', 'centimeters', 'centimetre', 'centimetres', '厘米'])
add('length', 'm', '1', ['meter', 'meters', 'metre', 'metres', '米'])
add('length', 'km', '1000', ['kilometer', 'kilometers', 'kilometre', 'kilometres', '千米', '公里'])
add('length', 'in', '0.0254', ['inch', 'inches', '英寸'])
add('length', 'ft', '0.3048', ['foot', 'feet', '英尺'])
add('length', 'yd', '0.9144', ['yard', 'yards', '码'])
add('length', 'mi', '1609.344', ['mile', 'miles', '英里'])
add('mass', 'mg', '0.000001', ['milligram', 'milligrams', '毫克'])
add('mass', 'g', '0.001', ['gram', 'grams', '克'])
add('mass', 'kg', '1', ['kilogram', 'kilograms', '千克', '公斤'])
add('mass', 't', '1000', ['tonne', 'tonnes', '吨'])
add('mass', 'oz', '0.028349523125', ['ounce', 'ounces', '盎司'])
add('mass', 'lb', '0.45359237', ['lbs', 'pound', 'pounds', '磅'])
add('data', 'b', '1', ['bit', 'bits', '比特'])
add('data', 'B', '8', ['byte', 'bytes', '字节'])
for (const [prefix, power] of [['K', 1], ['M', 2], ['G', 3], ['T', 4]] as const) {
  const si = new Decimal(1000).pow(power)
  const iec = new Decimal(1024).pow(power)
  add('data', `${prefix}B`, si.times(8).toFixed(), prefix === 'K' ? ['kB'] : [])
  add('data', `${prefix}b`, si.toFixed(), prefix === 'K' ? ['kb'] : [])
  add('data', `${prefix}iB`, iec.times(8).toFixed())
  add('data', `${prefix}ib`, iec.toFixed())
}

export type UnitConversion =
  | { ok: true; value: string; unit: string; text: string; approximate: boolean; dimension: Dimension }
  | { ok: false; error: 'dimension' | 'unit' | 'range' }

/** Explicit conversion syntax, never arbitrary arithmetic, network or currency. */
export function convertUnitQuery(query: string): UnitConversion | null {
  if (query.length > 180) return null
  const match = query.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z\u4e00-\u9fff]+?)\s*(?:\s+(?:to|in)\s+|->|→|换算为|转为|转|到)\s*([A-Za-z\u4e00-\u9fff]+)$/)
  if (!match) return null
  const source = units.get(match[2])
  const target = units.get(match[3])
  // Do not claim unrelated natural-language or currency queries.
  if (!source && !target) return null
  if (!source || !target) return { ok: false, error: 'unit' }
  if (source.dimension !== target.dimension) return { ok: false, error: 'dimension' }
  const input = new Decimal(match[1])
  if (!input.isFinite() || (!input.isZero() && Math.abs(input.e ?? 0) > 30)) return { ok: false, error: 'range' }
  const numerator = input.times(source.factor)
  const converted = numerator.div(target.factor)
  const rounded = converted.precision(12, BigNumber.ROUND_HALF_UP)
  const value = rounded.isZero() ? '0' : rounded.toString()
  // Compare against the exact ratio, so recurring fractions are marked too.
  const approximate = !rounded.times(target.factor).eq(numerator)
  return { ok: true, value, unit: target.symbol, text: `${value} ${target.symbol}`, approximate, dimension: source.dimension }
}

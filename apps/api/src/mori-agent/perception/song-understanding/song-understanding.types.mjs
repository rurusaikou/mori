/** Song Understanding 感知层的稳定输出契约；每一层必须显式声明可用性与证据。 */
export const SONG_INSIGHT_SCHEMA = {
  type: 'object',
  properties: {
    sound: layerSchema({ observations: { type: 'array', items: { type: 'string' } } }),
    lyrics: layerSchema({ themes: stringArray(), perspective: { type: 'string' }, imagery: stringArray(), emotionalArc: { type: 'string' } }),
    creation: layerSchema({ lyricists: stringArray(), composers: stringArray(), relationships: stringArray(), background: { type: 'string' } }),
    reception: layerSchema({ listenerTags: stringArray(), commonInterpretations: stringArray(), disagreements: stringArray(), culturalContext: { type: 'string' } }),
    integratedInsight: { type: 'string' },
    missingLayers: { type: 'array', items: { type: 'string', enum: ['sound', 'lyrics', 'creation', 'reception'] } },
  },
  required: ['sound', 'lyrics', 'creation', 'reception', 'integratedInsight', 'missingLayers'],
  additionalProperties: false,
}

export function validateSongInsight(value) {
  if (!value || typeof value !== 'object') throw new Error('Song Insight 必须是对象')
  for (const name of ['sound', 'lyrics', 'creation', 'reception']) validateLayer(value[name], name)
  if (typeof value.integratedInsight !== 'string') throw new Error('integratedInsight 无效')
  if (!Array.isArray(value.missingLayers) || value.missingLayers.some((name) => !['sound', 'lyrics', 'creation', 'reception'].includes(name))) throw new Error('missingLayers 无效')
  for (const name of ['sound', 'lyrics', 'creation', 'reception']) {
    // available 与 missingLayers 必须互为反面；否则 Conversation Agent 可能误用缺证据层。
    if (value[name].available === value.missingLayers.includes(name)) throw new Error(`${name} availability 与 missingLayers 矛盾`)
  }
  return value
}

function layerSchema(extra) {
  return {
    type: 'object',
    properties: { available: { type: 'boolean' }, summary: { type: 'string' }, confidence: { type: 'number' }, sources: { type: 'array', items: sourceSchema() }, ...extra },
    required: ['available', 'summary', 'confidence', 'sources', ...Object.keys(extra)],
    additionalProperties: false,
  }
}
function sourceSchema() { return { type: 'object', properties: { provider: { type: 'string' }, label: { type: 'string' }, url: { type: 'string' } }, required: ['provider', 'label', 'url'], additionalProperties: false } }
function stringArray() { return { type: 'array', items: { type: 'string' } } }
function validateLayer(layer, name) {
  if (!layer || typeof layer !== 'object' || typeof layer.available !== 'boolean' || typeof layer.summary !== 'string') throw new Error(`${name} layer 无效`)
  if (!Number.isFinite(layer.confidence) || layer.confidence < 0 || layer.confidence > 1) throw new Error(`${name}.confidence 无效`)
  if (!Array.isArray(layer.sources) || layer.sources.some((source) => !source || typeof source.provider !== 'string' || typeof source.label !== 'string' || typeof source.url !== 'string')) throw new Error(`${name}.sources 无效`)
}

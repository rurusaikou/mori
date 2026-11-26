export function evaluateConversationCase(testCase, result) {
  const response = String(result?.finalResponse ?? '')
  const issues = []
  if (!result?.success) issues.push(`run failed: ${result?.error ?? 'unknown error'}`)
  if (!response.trim()) issues.push('empty response')
  if (testCase.expectedAny?.length && !testCase.expectedAny.some((phrase) => response.includes(phrase))) issues.push(`missing expected topic cue: ${testCase.expectedAny.join(' / ')}`)
  for (const phrase of testCase.forbidden ?? []) if (response.includes(phrase)) issues.push(`unsupported claim: ${phrase}`)
  evaluateAction(testCase.expectedAction, result?.action ?? null, issues)
  if (testCase.responseMode === 'planned' && result?.action && !result?.meta?.runId) issues.push('planned action is missing run identity')
  return { id: testCase.id, category: testCase.category, severity: testCase.severity, passed: issues.length === 0, issues, response, action: result?.action ?? null, latencyMs: result?.meta?.latency ?? null }
}

function evaluateAction(expected, actual, issues) {
  if (expected === null) { if (actual) issues.push(`unexpected action: ${actual.type}`); return }
  if (!actual) { issues.push(`missing expected action: ${expected.type}`); return }
  for (const key of ['type', 'intent', 'command']) if (expected[key] !== undefined && actual[key] !== expected[key]) issues.push(`action ${key}: expected ${expected[key]}, got ${actual[key] ?? 'null'}`)
  for (const phrase of expected.queryIncludes ?? []) if (!String(actual.query ?? '').includes(phrase)) issues.push(`action query is missing: ${phrase}`)
  if (expected.excludeCurrentUri && !(actual.excludeUris ?? []).includes(expected.excludeCurrentUri)) issues.push(`action exclusion is missing: ${expected.excludeCurrentUri}`)
}

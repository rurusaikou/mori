export function evaluateConversationCase(testCase, result) {
  const response = String(result?.finalResponse ?? '')
  const issues = []
  if (!result?.success) issues.push(`run failed: ${result?.error ?? 'unknown error'}`)
  if (!response.trim()) issues.push('empty response')
  if (!testCase.expectedAny.some((phrase) => response.includes(phrase))) issues.push(`missing expected topic cue: ${testCase.expectedAny.join(' / ')}`)
  for (const phrase of testCase.forbidden) if (response.includes(phrase)) issues.push(`unsupported claim: ${phrase}`)
  if (result?.action) issues.push(`unexpected action: ${result.action.type}`)
  return { id: testCase.id, passed: issues.length === 0, issues, response }
}
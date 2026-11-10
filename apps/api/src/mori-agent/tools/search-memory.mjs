/** Tool：根据 query 查询本次 Playground 提供的 Mock Memory，不访问真实 Memory DB。 */
export function createSearchMemoryTool(repository) {
  return { name: 'search_memory', description: '搜索与当前话题相关的用户记忆', async execute(args) { const query = requiredQuery(args); return { query, matches: repository.search(query) } } }
}
function requiredQuery(args) { if (typeof args?.query !== 'string' || !args.query.trim()) throw new Error('search_memory.query 必须是非空字符串'); return args.query.trim() }

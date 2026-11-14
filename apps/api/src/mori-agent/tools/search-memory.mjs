/** Tool：通过注入的 Repository 搜索记忆；正式环境与 Playground 共用契约，不共用数据源。 */
export function createSearchMemoryTool(repository, { userId } = {}) {
  return {
    name: 'search_memory',
    description: '搜索与当前话题相关的用户记忆',
    async execute(args) {
      const query = requiredQuery(args)
      // 正式仓储必须显式传入认证后的 userId，避免 Tool 从模型参数中接受用户身份。
      const matches = userId ? await repository.search({ userId, query, limit: 5 }) : await repository.search(query)
      return { query, matches }
    },
  }
}
function requiredQuery(args) { if (typeof args?.query !== 'string' || !args.query.trim()) throw new Error('search_memory.query 必须是非空字符串'); return args.query.trim() }

/**
 * 作用：为 search_memory 提供每次 Run 隔离的 Mock Memory 查询，不读写真实数据库。
 * 输入：Playground 提交的 fakeMemory 和搜索 query。
 * 输出：按简单词项重合度排序的最多五条 Memory；不会创建或修改 Memory。
 */
export function createMockMemoryRepository(memories = []) {
  return {
    search(query) {
      const terms = tokenize(query)
      return memories
        .map((memory) => ({ ...memory, score: score(memory, terms) }))
        .filter((memory) => memory.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
    },
  }
}

function tokenize(value) { return [...new Set(String(value).toLowerCase().split(/[\s，。！？、,.!?]+/).filter(Boolean))] }
function score(memory, terms) { const haystack = `${memory.content} ${memory.context ?? ''}`.toLowerCase(); return terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0) }

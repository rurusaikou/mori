/**
 * 作用：声明构建工具提供的非标准模块类型。
 * 输入：TypeScript 对带 ?inline 资源导入的类型解析请求。
 * 输出：将内联资源声明为 string 的编译期类型；无运行时输出。
 */
declare module '*?inline' {
  const content: string
  export default content
}

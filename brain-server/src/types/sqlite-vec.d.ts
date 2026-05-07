/**
 * sqlite-vec 类型声明
 * https://github.com/asg017/sqlite-vec
 */
declare module 'sqlite-vec' {
  /**
   * 将 sqlite-vec 扩展加载到 SQLite 数据库连接
   * 兼容 node-sqlite3, better-sqlite3, node:sqlite 等
   */
  export function load(db: any): void;
}

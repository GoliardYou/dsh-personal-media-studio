declare module 'node:sqlite' {
  interface StatementSync {
    run(...anonymousParameters: any[]): any
    get(...anonymousParameters: any[]): any
    all(...anonymousParameters: any[]): any[]
  }
}

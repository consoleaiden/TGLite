/**
 * 全局类型补充声明。
 *
 * 运行时 `Buffer` 由 src/polyfills.js 从 npm 的 `buffer` 包注入到 global，
 * 但 TS 不认识它。这里只声明用得到的部分，
 * 刻意不引入 @types/node —— 那会把整个 Node 全局（fs/process/path…）
 * 都暴露给 TS，而 RN 里这些并不存在，反而会掩盖真实错误。
 */

declare global {
  interface Buffer extends Uint8Array {
    toString(encoding?: string, start?: number, end?: number): string;
    length: number;
  }

  const Buffer: {
    new (input: ArrayBuffer | Uint8Array | number[] | string, encoding?: string): Buffer;
    from(
      input: ArrayBuffer | Uint8Array | number[] | string,
      encoding?: string,
    ): Buffer;
    isBuffer(value: unknown): value is Buffer;
    concat(list: Uint8Array[], totalLength?: number): Buffer;
    alloc(size: number): Buffer;
  };

  interface ArrayBuffer {
    /** RN/Hermes 上 arrayBuffer() 的返回类型标注差异，补一个宽松入口 */
    slice?(begin?: number, end?: number): ArrayBuffer;
  }
}

export {};

/**
 * 让测试里用到的 Node 内置类型可用。
 *
 * 背景：RN 的 tsconfig 把 DOM 的 `Buffer`/`Uint8Array` 带进来，
 * 与 `@types/node` 的 `Buffer` 定义打架，于是
 *   - `buf.equals(...)` / `buf.copy(...)` / `buf.readUInt32BE(...)`
 *     报 "Property does not exist"
 *   - `Buffer.toString('hex')` 报 "Expected 0 arguments, but got 1"
 *
 * fake-TLS 的测试必须真的按字节比对（这正是它的价值所在），
 * 所以这里把用到的 Node Buffer 成员补上类型。
 * 只在 tsc 阶段生效，运行时用的仍是真实 Node Buffer。
 */
declare global {
  interface Buffer {
    equals(otherBuffer: Uint8Array): boolean;
    copy(target: Uint8Array, targetStart?: number, sourceStart?: number, sourceEnd?: number): number;
    readUInt32BE(offset?: number): number;
    writeUInt16BE(value: number, offset?: number): number;
    writeUInt32BE(value: number, offset?: number): number;
    toString(encoding?: string, start?: number, end?: number): string;
    subarray(start?: number, end?: number): Buffer;
    fill(value: number | string, start?: number, end?: number, encoding?: string): this;
  }

  interface BufferConstructor {
    alloc(size: number, fill?: number | string, encoding?: string): Buffer;
    from(data: Uint8Array | string | number[], encoding?: string): Buffer;
    concat(list: Uint8Array[], totalLength?: number): Buffer;
  }
}

export {};

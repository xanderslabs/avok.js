import { describe, expect, it } from "vitest";
import { randomNonceAllocator, createSequentialNonceAllocator } from "../../src/nonce.js";
import { memoryStorage } from "../../src/storage.js";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;

describe("nonce allocators", () => {
  it("random: 256-bit and effectively unique", async () => {
    const a = randomNonceAllocator();
    const seen = new Set<bigint>();
    for (let i = 0; i < 100; i++) {
      const n = await a.next(WALLET);
      expect(n).toBeLessThan(1n << 256n);
      seen.add(n);
    }
    expect(seen.size).toBe(100); // no collisions
  });

  it("sequential: hands out 0,1,2,… so nonces CLUSTER into the contract's bitmap words", async () => {
    const a = createSequentialNonceAllocator(memoryStorage());
    const nonces: bigint[] = [];
    for (let i = 0; i < 260; i++) nonces.push(await a.next(WALLET));
    // Sequential from 0 — the property that makes them share bitmap words (word = nonce >> 8).
    expect(nonces.slice(0, 5)).toEqual([0n, 1n, 2n, 3n, 4n]);
    expect(nonces.every((n, i) => n === BigInt(i))).toBe(true);
    // 0..255 live in word 0, 256..259 in word 1 — proving the 256-per-word packing intent.
    expect(nonces.slice(0, 256).every((n) => n >> 8n === 0n)).toBe(true);
    expect(nonces.slice(256).every((n) => n >> 8n === 1n)).toBe(true);
  });

  it("sequential: keeps a separate counter per wallet", async () => {
    const a = createSequentialNonceAllocator(memoryStorage());
    expect(await a.next(WALLET)).toBe(0n);
    expect(await a.next(OTHER)).toBe(0n); // independent counter
    expect(await a.next(WALLET)).toBe(1n);
    expect(await a.next(OTHER)).toBe(1n);
  });

  it("sequential: persists across allocator instances (survives reload) — never re-issues a nonce", async () => {
    const storage = memoryStorage();
    const first = createSequentialNonceAllocator(storage);
    expect(await first.next(WALLET)).toBe(0n);
    expect(await first.next(WALLET)).toBe(1n);
    // Fresh allocator (new session) reading the same storage resumes where it left off.
    const second = createSequentialNonceAllocator(storage);
    expect(await second.next(WALLET)).toBe(2n);
  });

  it("sequential: concurrent next() calls never collide (serialized allocation)", async () => {
    const a = createSequentialNonceAllocator(memoryStorage());
    const results = await Promise.all(Array.from({ length: 50 }, () => a.next(WALLET)));
    expect(new Set(results).size).toBe(50); // all distinct despite firing concurrently
    expect([...results].sort((x, y) => Number(x - y))).toEqual(Array.from({ length: 50 }, (_, i) => BigInt(i)));
  });
});

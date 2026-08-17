import type { Address } from "viem";
import type { StorageAdapter } from "./storage.js";

/**
 * Allocates the single-use 256-bit intent nonce for each SponsoredBatch / ExecuteBatch. The contract
 * stores consumed nonces in a Permit2-style bitmap where nonce = (word << 8) | bit, so the choice of
 * allocator decides storage density: random nonces scatter across words (one cold SSTORE each),
 * sequential nonces cluster 256-per-word (one cold SSTORE, then 255 warm ~4× cheaper writes).
 */
export interface NonceAllocator {
  next(walletAddress: Address): Promise<bigint>;
}

/**
 * Default allocator: a fresh random 256-bit nonce per tx. Stateless, coordination-free, and
 * unbounded-parallel — the right choice on cheap-storage L2s (Base/OP/Arb/BSC), where the per-nonce
 * cold SSTORE is a fraction of a cent and clustering buys nothing.
 */
export function randomNonceAllocator(): NonceAllocator {
  return {
    async next() {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      let n = 0n;
      for (const b of bytes) n = (n << 8n) | BigInt(b);
      return n;
    },
  };
}

/**
 * Sequential allocator: hands out nonces 0, 1, 2, … per wallet, persisted via `storage`. Because the
 * contract's nonce bitmap packs 256 consecutive nonces into one storage word, sequential nonces
 * CLUSTER — the first write to a word is a cold SSTORE (~22k), the next 255 are warm (~5k) — cutting
 * repeat-nonce gas ~4× and keeping storage 256× denser. Opt in on L1 / expensive-storage deployments
 * where the per-nonce cold SSTORE is a real cost (see the A8 analysis); keep the random default on L2.
 *
 * Trade-offs (the price of the L1 saving): it adds per-wallet client state, and it gives up the
 * stateless parallelism of random nonces — two concurrent `next()` calls must not race the counter,
 * so allocation is serialized in-process and the counter is persisted BEFORE the nonce is returned
 * (so a crash/reload never re-hands a consumed nonce). A cross-device race (same wallet allocating on
 * two devices against one shared chain) can still collide; the loser simply reverts NonceUsed and
 * retries — a safe failure, never a fund risk.
 */
export function createSequentialNonceAllocator(storage: StorageAdapter): NonceAllocator {
  const keyFor = (addr: Address) => `avok:nonce-seq:${addr.toLowerCase()}`;
  const counters = new Map<string, bigint>();
  // Serialize all allocations through one chain so concurrent callers can't read the same counter.
  let tail: Promise<unknown> = Promise.resolve();

  return {
    next(walletAddress: Address): Promise<bigint> {
      const key = keyFor(walletAddress);
      const run = tail.then(async () => {
        let current = counters.get(key);
        if (current === undefined) {
          const stored = await storage.get(key);
          current = stored != null ? BigInt(stored) : 0n;
        }
        // Persist the NEXT value before returning `current`, so a reload can never re-issue it.
        counters.set(key, current + 1n);
        await storage.set(key, (current + 1n).toString());
        return current;
      });
      tail = run.catch(() => undefined); // keep the chain alive past a failed allocation
      return run;
    },
  };
}

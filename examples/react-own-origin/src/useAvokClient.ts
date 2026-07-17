import { useMemo } from "react";
import { createAvokClient, createOwnOriginConnection } from "@avokjs/react";
import type { FullAvokClient } from "@avokjs/react";
import { config } from "./config.js";

/** Memoized OWN-ORIGIN client (WebAuthn passkey in-browser). Reads src/config.ts only. */
export function useAvokClient(): FullAvokClient {
  return useMemo(() => {
    const connection = createOwnOriginConnection({ rpId: config.rpId, operatorName: config.operatorName, anchorChainId: config.anchorChainId });
    return createAvokClient({
      connection,
      rpcUrls: config.rpcUrls,
      paymasterUrl: config.paymasterUrl,
      bundlerUrl: config.bundlerUrl,
      koraUrl: config.koraUrl,
      subnameRegistrar: config.subname.registrar,
      subnameParent: config.subname.parent,
      snsParent: config.sns.parent,
      snsRegistrar: config.sns.registrar,
    }) as FullAvokClient;
  }, []);
}

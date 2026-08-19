import type { Hex } from "viem";

/** Full ABI of the canonical AvokCalibur contract (compiled from src/AvokCalibur.sol): Calibur
 *  (Uniswap's audited base) plus the guardian shims and the recovery promotion hook. */
export const AvokCaliburABI = [
  {
    type: "constructor",
    inputs: [
      {
        name: "guardianLogic",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "fallback",
    stateMutability: "payable",
  },
  {
    type: "receive",
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "CUSTOM_STORAGE_ROOT",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ENTRY_POINT",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ERC20ETH",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "GUARDIAN_LOGIC",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approveNative",
    inputs: [
      {
        name: "spender",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "approveRecovery",
    inputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
      {
        name: "",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "approveRecoveryBySig",
    inputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
      {
        name: "",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "",
        type: "address",
        internalType: "address",
      },
      {
        name: "",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "domainBytes",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "domainSeparator",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "eip712Domain",
    inputs: [],
    outputs: [
      {
        name: "fields",
        type: "bytes1",
        internalType: "bytes1",
      },
      {
        name: "name",
        type: "string",
        internalType: "string",
      },
      {
        name: "version",
        type: "string",
        internalType: "string",
      },
      {
        name: "chainId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "verifyingContract",
        type: "address",
        internalType: "address",
      },
      {
        name: "salt",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "extensions",
        type: "uint256[]",
        internalType: "uint256[]",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "execute",
    inputs: [
      {
        name: "batchedCall",
        type: "tuple",
        internalType: "struct BatchedCall",
        components: [
          {
            name: "calls",
            type: "tuple[]",
            internalType: "struct Call[]",
            components: [
              {
                name: "to",
                type: "address",
                internalType: "address",
              },
              {
                name: "value",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "data",
                type: "bytes",
                internalType: "bytes",
              },
            ],
          },
          {
            name: "revertOnFailure",
            type: "bool",
            internalType: "bool",
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "execute",
    inputs: [
      {
        name: "signedBatchedCall",
        type: "tuple",
        internalType: "struct SignedBatchedCall",
        components: [
          {
            name: "batchedCall",
            type: "tuple",
            internalType: "struct BatchedCall",
            components: [
              {
                name: "calls",
                type: "tuple[]",
                internalType: "struct Call[]",
                components: [
                  {
                    name: "to",
                    type: "address",
                    internalType: "address",
                  },
                  {
                    name: "value",
                    type: "uint256",
                    internalType: "uint256",
                  },
                  {
                    name: "data",
                    type: "bytes",
                    internalType: "bytes",
                  },
                ],
              },
              {
                name: "revertOnFailure",
                type: "bool",
                internalType: "bool",
              },
            ],
          },
          {
            name: "nonce",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "keyHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "executor",
            type: "address",
            internalType: "address",
          },
          {
            name: "deadline",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
      {
        name: "wrappedSignature",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "execute",
    inputs: [
      {
        name: "mode",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "executionData",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "executeGuardianOp",
    inputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct IGuardianLogic.GuardianOp",
        components: [
          {
            name: "kind",
            type: "uint8",
            internalType: "enum IGuardianLogic.OpKind",
          },
          {
            name: "guardian",
            type: "address",
            internalType: "address",
          },
          {
            name: "newThreshold",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "nonce",
            type: "uint64",
            internalType: "uint64",
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeRecovery",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeUserOp",
    inputs: [
      {
        name: "userOp",
        type: "tuple",
        internalType: "struct PackedUserOperation",
        components: [
          {
            name: "sender",
            type: "address",
            internalType: "address",
          },
          {
            name: "nonce",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "initCode",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "callData",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "accountGasLimits",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "preVerificationGas",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "gasFees",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "paymasterAndData",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "signature",
            type: "bytes",
            internalType: "bytes",
          },
        ],
      },
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getGuardianConfig",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address[]",
        internalType: "address[]",
      },
      {
        name: "",
        type: "uint8",
        internalType: "uint8",
      },
      {
        name: "",
        type: "uint40",
        internalType: "uint40",
      },
      {
        name: "",
        type: "uint40",
        internalType: "uint40",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getKey",
    inputs: [
      {
        name: "keyHash",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct Key",
        components: [
          {
            name: "keyType",
            type: "uint8",
            internalType: "enum KeyType",
          },
          {
            name: "publicKey",
            type: "bytes",
            internalType: "bytes",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getKeySettings",
    inputs: [
      {
        name: "keyHash",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "Settings",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getPendingGuardianOp",
    inputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint40",
        internalType: "uint40",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getPendingRecovery",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
      {
        name: "",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "",
        type: "uint8",
        internalType: "uint8",
      },
      {
        name: "",
        type: "uint40",
        internalType: "uint40",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getSeq",
    inputs: [
      {
        name: "key",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "seq",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hashTypedData",
    inputs: [
      {
        name: "hash",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "invalidateNonce",
    inputs: [
      {
        name: "newNonce",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "isRegistered",
    inputs: [
      {
        name: "keyHash",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isValidSignature",
    inputs: [
      {
        name: "digest",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "wrappedSignature",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes4",
        internalType: "bytes4",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "keyAt",
    inputs: [
      {
        name: "i",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct Key",
        components: [
          {
            name: "keyType",
            type: "uint8",
            internalType: "enum KeyType",
          },
          {
            name: "publicKey",
            type: "bytes",
            internalType: "bytes",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "keyCount",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "keyHashes",
    inputs: [],
    outputs: [
      {
        name: "_spacer",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "namespaceAndVersion",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "string",
        internalType: "string",
      },
    ],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "nativeAllowance",
    inputs: [
      {
        name: "spender",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nonceSequenceNumber",
    inputs: [
      {
        name: "key",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "seq",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proposeGuardianOp",
    inputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct IGuardianLogic.GuardianOp",
        components: [
          {
            name: "kind",
            type: "uint8",
            internalType: "enum IGuardianLogic.OpKind",
          },
          {
            name: "guardian",
            type: "address",
            internalType: "address",
          },
          {
            name: "newThreshold",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "nonce",
            type: "uint64",
            internalType: "uint64",
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "recoveryApprovalDigest",
    inputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
      {
        name: "",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "register",
    inputs: [
      {
        name: "key",
        type: "tuple",
        internalType: "struct Key",
        components: [
          {
            name: "keyType",
            type: "uint8",
            internalType: "enum KeyType",
          },
          {
            name: "publicKey",
            type: "bytes",
            internalType: "bytes",
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "registerRecoveredKey",
    inputs: [
      {
        name: "promoteKey",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revoke",
    inputs: [
      {
        name: "keyHash",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setupGuardians",
    inputs: [
      {
        name: "",
        type: "address[]",
        internalType: "address[]",
      },
      {
        name: "",
        type: "uint8",
        internalType: "uint8",
      },
      {
        name: "",
        type: "uint40",
        internalType: "uint40",
      },
      {
        name: "",
        type: "uint40",
        internalType: "uint40",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "supportsExecutionMode",
    inputs: [
      {
        name: "mode",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "result",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "transferFromNative",
    inputs: [
      {
        name: "from",
        type: "address",
        internalType: "address",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "update",
    inputs: [
      {
        name: "keyHash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "settings",
        type: "uint256",
        internalType: "Settings",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "updateEntryPoint",
    inputs: [
      {
        name: "entryPoint",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "updateSalt",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "validateUserOp",
    inputs: [
      {
        name: "userOp",
        type: "tuple",
        internalType: "struct PackedUserOperation",
        components: [
          {
            name: "sender",
            type: "address",
            internalType: "address",
          },
          {
            name: "nonce",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "initCode",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "callData",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "accountGasLimits",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "preVerificationGas",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "gasFees",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "paymasterAndData",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "signature",
            type: "bytes",
            internalType: "bytes",
          },
        ],
      },
      {
        name: "userOpHash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "missingAccountFunds",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "validationData",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "vetoGuardianOp",
    inputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "vetoRecovery",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "ApproveNative",
    inputs: [
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "spender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "value",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "EIP712DomainChanged",
    inputs: [],
    anonymous: false,
  },
  {
    type: "event",
    name: "EntryPointUpdated",
    inputs: [
      {
        name: "newEntryPoint",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "KeySettingsUpdated",
    inputs: [
      {
        name: "keyHash",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "settings",
        type: "uint256",
        indexed: false,
        internalType: "Settings",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "NativeAllowanceUpdated",
    inputs: [
      {
        name: "spender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "value",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "NonceInvalidated",
    inputs: [
      {
        name: "nonce",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      {
        name: "keyHash",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "key",
        type: "tuple",
        indexed: false,
        internalType: "struct Key",
        components: [
          {
            name: "keyType",
            type: "uint8",
            internalType: "enum KeyType",
          },
          {
            name: "publicKey",
            type: "bytes",
            internalType: "bytes",
          },
        ],
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Revoked",
    inputs: [
      {
        name: "keyHash",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "TransferFromNative",
    inputs: [
      {
        name: "from",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "to",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "value",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AllowanceExceeded",
    inputs: [],
  },
  {
    type: "error",
    name: "CallFailed",
    inputs: [
      {
        name: "reason",
        type: "bytes",
        internalType: "bytes",
      },
    ],
  },
  {
    type: "error",
    name: "CannotRegisterKey",
    inputs: [
      {
        name: "key",
        type: "tuple",
        internalType: "struct Key",
        components: [
          {
            name: "keyType",
            type: "uint8",
            internalType: "enum KeyType",
          },
          {
            name: "publicKey",
            type: "bytes",
            internalType: "bytes",
          },
        ],
      },
    ],
  },
  {
    type: "error",
    name: "CannotRegisterRootKey",
    inputs: [],
  },
  {
    type: "error",
    name: "CannotUpdateRootKey",
    inputs: [],
  },
  {
    type: "error",
    name: "ExcessiveInvalidation",
    inputs: [],
  },
  {
    type: "error",
    name: "FnSelectorNotRecognized",
    inputs: [],
  },
  {
    type: "error",
    name: "IncorrectSender",
    inputs: [],
  },
  {
    type: "error",
    name: "IndexOutOfBounds",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidHook",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidHookResponse",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidKey",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidNonce",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidSettings",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidSignature",
    inputs: [],
  },
  {
    type: "error",
    name: "KeyDoesNotExist",
    inputs: [],
  },
  {
    type: "error",
    name: "KeyExpired",
    inputs: [
      {
        name: "expiration",
        type: "uint40",
        internalType: "uint40",
      },
    ],
  },
  {
    type: "error",
    name: "NotEntryPoint",
    inputs: [],
  },
  {
    type: "error",
    name: "NotSelf",
    inputs: [],
  },
  {
    type: "error",
    name: "OnlyAdminCanCallEntryPoint",
    inputs: [],
  },
  {
    type: "error",
    name: "OnlyAdminCanSelfCall",
    inputs: [],
  },
  {
    type: "error",
    name: "SignatureExpired",
    inputs: [],
  },
  {
    type: "error",
    name: "TransferNativeFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedExecutionMode",
    inputs: [],
  },
] as const;

/** Full ABI of GuardianLogic (compiled from src/GuardianLogic.sol): the stateless rulebook
 *  AvokCalibur delegatecalls guardian operations into. */
export const GuardianLogicABI = [
  {
    type: "function",
    name: "STORE_SLOT",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approveRecovery",
    inputs: [
      {
        name: "promoteKey",
        type: "address",
        internalType: "address",
      },
      {
        name: "nonce",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "approveRecoveryBySig",
    inputs: [
      {
        name: "promoteKey",
        type: "address",
        internalType: "address",
      },
      {
        name: "nonce",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "guardian",
        type: "address",
        internalType: "address",
      },
      {
        name: "sig",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeGuardianOp",
    inputs: [
      {
        name: "op",
        type: "tuple",
        internalType: "struct IGuardianLogic.GuardianOp",
        components: [
          {
            name: "kind",
            type: "uint8",
            internalType: "enum IGuardianLogic.OpKind",
          },
          {
            name: "guardian",
            type: "address",
            internalType: "address",
          },
          {
            name: "newThreshold",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "nonce",
            type: "uint64",
            internalType: "uint64",
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeRecovery",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getGuardianConfig",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address[]",
        internalType: "address[]",
      },
      {
        name: "",
        type: "uint8",
        internalType: "uint8",
      },
      {
        name: "",
        type: "uint40",
        internalType: "uint40",
      },
      {
        name: "",
        type: "uint40",
        internalType: "uint40",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getPendingGuardianOp",
    inputs: [
      {
        name: "opHash",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "readyAt",
        type: "uint40",
        internalType: "uint40",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getPendingRecovery",
    inputs: [],
    outputs: [
      {
        name: "promoteKey",
        type: "address",
        internalType: "address",
      },
      {
        name: "nonce",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "approvals",
        type: "uint8",
        internalType: "uint8",
      },
      {
        name: "readyAt",
        type: "uint40",
        internalType: "uint40",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proposeGuardianOp",
    inputs: [
      {
        name: "op",
        type: "tuple",
        internalType: "struct IGuardianLogic.GuardianOp",
        components: [
          {
            name: "kind",
            type: "uint8",
            internalType: "enum IGuardianLogic.OpKind",
          },
          {
            name: "guardian",
            type: "address",
            internalType: "address",
          },
          {
            name: "newThreshold",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "nonce",
            type: "uint64",
            internalType: "uint64",
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "recoveryApprovalDigest",
    inputs: [
      {
        name: "promoteKey",
        type: "address",
        internalType: "address",
      },
      {
        name: "nonce",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setupGuardians",
    inputs: [
      {
        name: "guardians",
        type: "address[]",
        internalType: "address[]",
      },
      {
        name: "threshold",
        type: "uint8",
        internalType: "uint8",
      },
      {
        name: "recoveryDelay",
        type: "uint40",
        internalType: "uint40",
      },
      {
        name: "guardianOpDelay",
        type: "uint40",
        internalType: "uint40",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "vetoGuardianOp",
    inputs: [
      {
        name: "opHash",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "vetoRecovery",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "GuardianOpExecuted",
    inputs: [
      {
        name: "opHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GuardianOpProposed",
    inputs: [
      {
        name: "opHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "op",
        type: "tuple",
        indexed: false,
        internalType: "struct IGuardianLogic.GuardianOp",
        components: [
          {
            name: "kind",
            type: "uint8",
            internalType: "enum IGuardianLogic.OpKind",
          },
          {
            name: "guardian",
            type: "address",
            internalType: "address",
          },
          {
            name: "newThreshold",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "nonce",
            type: "uint64",
            internalType: "uint64",
          },
        ],
      },
      {
        name: "readyAt",
        type: "uint40",
        indexed: false,
        internalType: "uint40",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GuardianOpVetoed",
    inputs: [
      {
        name: "opHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GuardiansSetup",
    inputs: [
      {
        name: "guardians",
        type: "address[]",
        indexed: false,
        internalType: "address[]",
      },
      {
        name: "threshold",
        type: "uint8",
        indexed: false,
        internalType: "uint8",
      },
      {
        name: "recoveryDelay",
        type: "uint40",
        indexed: false,
        internalType: "uint40",
      },
      {
        name: "guardianOpDelay",
        type: "uint40",
        indexed: false,
        internalType: "uint40",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RecoveryApproved",
    inputs: [
      {
        name: "guardian",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "promoteKey",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "nonce",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RecoveryExecuted",
    inputs: [
      {
        name: "promoteKey",
        type: "address",
        indexed: false,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RecoveryStarted",
    inputs: [
      {
        name: "promoteKey",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "readyAt",
        type: "uint40",
        indexed: false,
        internalType: "uint40",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RecoveryVetoed",
    inputs: [
      {
        name: "promoteKey",
        type: "address",
        indexed: false,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AlreadyApproved",
    inputs: [],
  },
  {
    type: "error",
    name: "AlreadySetup",
    inputs: [],
  },
  {
    type: "error",
    name: "BadSignature",
    inputs: [],
  },
  {
    type: "error",
    name: "BadThreshold",
    inputs: [],
  },
  {
    type: "error",
    name: "DelayOutOfBounds",
    inputs: [],
  },
  {
    type: "error",
    name: "DuplicateGuardian",
    inputs: [],
  },
  {
    type: "error",
    name: "NoRecovery",
    inputs: [],
  },
  {
    type: "error",
    name: "NonceUsed",
    inputs: [],
  },
  {
    type: "error",
    name: "NotGuardian",
    inputs: [],
  },
  {
    type: "error",
    name: "NotSelf",
    inputs: [],
  },
  {
    type: "error",
    name: "NotSetup",
    inputs: [],
  },
  {
    type: "error",
    name: "OpNotPending",
    inputs: [],
  },
  {
    type: "error",
    name: "OpNotReady",
    inputs: [],
  },
  {
    type: "error",
    name: "RecoveryMismatch",
    inputs: [],
  },
  {
    type: "error",
    name: "RecoveryNotReady",
    inputs: [],
  },
  {
    type: "error",
    name: "UnknownGuardian",
    inputs: [],
  },
  {
    type: "error",
    name: "ZeroKey",
    inputs: [],
  },
] as const;

/** ERC-7821 mode constant (inherited from Calibur; unchanged from the retired wallet). */
export const MODE_BATCH: Hex = "0x0100000000000000000000000000000000000000000000000000000000000000";

/** Sliced ABI: ERC-7821 batch execution (`execute` + `supportsExecutionMode`), inherited from Calibur. */
export const executeAbi = AvokCaliburABI.filter(
  (f) => f.type === "function" && ["execute", "supportsExecutionMode"].includes(f.name),
) as unknown as typeof AvokCaliburABI;

export type {
  ChainKind,
  ChainId,
  ChainCapabilities,
  EvmTokenProfile,
  TokenProfile,
  EvmChainProfile,
  ChainProfile,
} from "./registry.js";
export {
  CHAIN_PROFILES,
  getChainProfile,
  getTokenProfile,
  getChainProfileById,
  listChains,
  listFeeTokens,
  CHAIN_NAME_TO_ID,
  resolveChainByName,
  chainIdNumberByName,
  DEFAULT_ANCHOR_CHAIN_ID,
  resolveAnchorChain,
} from "./registry.js";
export type { RpcOverrides } from "./rpc.js";
export { evmRpcUrl, evmRpcUrls, isPublicDefaultRpc } from "./rpc.js";

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @dev Test stand-in for AvokCalibur: forwards unknown calls to GuardianLogic by
///      delegatecall (as the real shims will), and records register/update self-calls
///      the way Calibur's roster would receive them.
contract GuardianHost {
    address public immutable LOGIC;
    bytes[] public registered;   // abi-encoded Key structs received
    bytes32[] public updatedKeyHashes;
    uint256[] public updatedSettings;
    address[] public promoted;

    constructor(address logic) { LOGIC = logic; }

    // IGuardianPromotion: the promotion hook GuardianLogic.executeRecovery reaches through.
    function registerRecoveredKey(address k) external {
        require(msg.sender == address(this), "onlyThis");
        promoted.push(k);
    }

    // Calibur roster stand-ins (onlyThis semantics preserved)
    function register(bytes calldata keyEncoded) external {
        require(msg.sender == address(this), "onlyThis");
        registered.push(keyEncoded);
    }
    function update(bytes32 keyHash, uint256 settings) external {
        require(msg.sender == address(this), "onlyThis");
        updatedKeyHashes.push(keyHash);
        updatedSettings.push(settings);
    }
    function registeredCount() external view returns (uint256) { return registered.length; }

    // The shim pattern under test
    fallback() external payable {
        (bool ok, bytes memory ret) = LOGIC.delegatecall(msg.data);
        if (!ok) assembly { revert(add(ret, 32), mload(ret)) }
        assembly { return(add(ret, 32), mload(ret)) }
    }
    receive() external payable {}

    // Lets tests drive "self-call" paths: the wallet calling itself, as execute() would.
    function selfCall(bytes calldata data) external {
        (bool ok, bytes memory ret) = address(this).call(data);
        if (!ok) assembly { revert(add(ret, 32), mload(ret)) }
    }
}

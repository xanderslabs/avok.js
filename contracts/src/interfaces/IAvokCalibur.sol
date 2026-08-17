// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @notice The promotion hook GuardianLogic.executeRecovery reaches through on a completed,
///         unvetoed recovery.
/// @dev Deliberately one function. This entry point is the whole of the authority a completed
///      recovery has over the account, and it can only ever register the promoted key as admin.
///      Reachable only as a self-call (see AvokCalibur.registerRecoveredKey): the only writer is
///      GuardianLogic.executeRecovery, which deletes the pending recovery before calling, so a
///      completed recovery cannot be replayed.
interface IAvokCalibur {
    function registerRecoveredKey(address promoteKey) external;
}

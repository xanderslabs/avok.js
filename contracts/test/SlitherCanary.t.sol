// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";

/// @notice Proves the analyzer-boundary claim in contracts/README.md and the contract
///         architecture doc (section 4): Slither cannot build IR for Calibur's
///         ERC7739._isValidTypedDataSig, so every contract inheriting Calibur — AvokCalibur
///         included — is dropped from analysis entirely. Plants the identical bug (an unprotected
///         `selfdestruct`) in test/fixtures/CanaryVulnerablePlain.sol (no Calibur) and
///         test/fixtures/CanaryVulnerableCalibur.sol (inherits Calibur): Slither must catch it in
///         the first and is proven here to miss it in the second. If a future Slither release
///         fixes the upstream IR bug, this test starts failing — that failure IS the signal the
///         blind spot closed, and the README's analyzer-boundary section should be revisited.
/// @dev Skips itself (rather than failing) when slither isn't on PATH, so it never blocks an
///      environment without the analyzer installed.
contract SlitherCanaryTest is Test {
    function test_slither_missesThePlantedBugOnlyInsideACaliburFixture() public {
        if (!_slitherAvailable()) {
            vm.skip(true, "slither not found on PATH");
            return;
        }

        assertTrue(
            _hasFindings("test/fixtures/CanaryVulnerablePlain.sol"),
            "the plain fixture's planted selfdestruct must be flagged"
        );
        assertFalse(
            _hasFindings("test/fixtures/CanaryVulnerableCalibur.sol"),
            "the Calibur fixture's identical bug must be MISSED (the analyzer blind spot)"
        );
    }

    function _slitherAvailable() internal returns (bool) {
        string[] memory cmd = new string[](3);
        cmd[0] = "bash";
        cmd[1] = "-c";
        cmd[2] = "command -v slither >/dev/null 2>&1 && echo yes || echo no";
        bytes memory out = vm.ffi(cmd);
        return keccak256(out) == keccak256(bytes("yes"));
    }

    function _hasFindings(string memory path) internal returns (bool) {
        string[] memory cmd = new string[](3);
        cmd[0] = "bash";
        cmd[1] = "-c";
        cmd[2] = string.concat(
            "OUT=$(mktemp -u); slither ",
            path,
            ' --filter-paths "lib|node_modules" --json "$OUT" >/dev/null 2>&1; cat "$OUT"; rm -f "$OUT"'
        );
        string memory json = string(vm.ffi(cmd));
        return vm.keyExistsJson(json, ".results.detectors");
    }
}

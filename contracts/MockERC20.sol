// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TEST ONLY — Do NOT deploy to mainnet. Anyone can mint unlimited tokens.
contract MockERC20 is ERC20 {
    constructor() ERC20("MockToken", "MCK") {}

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}

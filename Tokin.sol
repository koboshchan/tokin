// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
/// Fixed supply. No owner, mint function, taxes, blacklist, or upgradeability.
contract Tokin is ERC20 {
    string public logoURI;
    constructor(string memory tokenName, string memory ticker, uint256 supply, string memory logo) ERC20(tokenName, ticker) {
        require(bytes(tokenName).length > 0 && bytes(tokenName).length <= 128, 'Invalid name');
        require(bytes(ticker).length > 0 && bytes(ticker).length <= 16, 'Invalid ticker');
        require(supply > 0, 'Supply must be positive');
        require(bytes(logo).length <= 8192, 'Logo too large');
        logoURI = logo;
        _mint(msg.sender, supply);
    }
}

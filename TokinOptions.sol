// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {ERC20Burnable} from '@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol';
import {ERC20Capped} from '@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol';
import {ERC20Pausable} from '@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
/// Feature flags are immutable. No taxes, blacklist, proxy, or editable logo.
contract TokinOptions is ERC20Burnable, ERC20Capped, ERC20Pausable, Ownable {
    string public logoURI;
    bool public immutable mintable;
    bool public immutable burnable;
    bool public immutable pausable;
    uint256 public immutable supplyCap;
    constructor(string memory tokenName, string memory ticker, uint256 initialSupply, string memory logo, bool canMint, bool canBurn, bool canPause, uint256 maxSupply)
        ERC20(tokenName,ticker) ERC20Capped(maxSupply == 0 ? type(uint256).max : maxSupply) Ownable(msg.sender) {
        require(bytes(tokenName).length>0 && bytes(tokenName).length<=128,'Invalid name');
        require(bytes(ticker).length>0 && bytes(ticker).length<=16,'Invalid ticker');
        require(initialSupply>0,'Supply must be positive');
        require(bytes(logo).length<=8192,'Logo too large');
        require(maxSupply==0 || canMint,'Cap requires mintable');
        mintable=canMint; burnable=canBurn; pausable=canPause; supplyCap=maxSupply; logoURI=logo;
        _mint(msg.sender,initialSupply);
        if(!canMint && !canPause) _transferOwnership(address(0));
    }
    function mint(address to,uint256 amount) external onlyOwner { require(mintable,'Mint disabled'); _mint(to,amount); }
    function burn(uint256 amount) public override { require(burnable,'Burn disabled'); super.burn(amount); }
    function burnFrom(address account,uint256 amount) public override { require(burnable,'Burn disabled'); super.burnFrom(account,amount); }
    function pause() external onlyOwner { require(pausable,'Pause disabled'); _pause(); }
    function unpause() external onlyOwner { require(pausable,'Pause disabled'); _unpause(); }
    function renounceOwnership() public override onlyOwner { require(!paused(),'Unpause before renouncing'); super.renounceOwnership(); }
    function _update(address from,address to,uint256 value) internal override(ERC20,ERC20Capped,ERC20Pausable) { super._update(from,to,value); }
}

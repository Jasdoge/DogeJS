DogeJS
=======

A nodejs fork of coinb.in made specifically for dogecoin. I'm a beginner with this stuff, so it only supports basic wallets. It also only uses the blockchair API.

Simple usage:

```
const d = require('DogeJS');
const DogeJS = new d();

(async () => {


	const credentials = DogeJS.generateWallet();
	const walletAddress = credentials.address;
	const wifKey = credentials.wif;

	console.log(
		"Generated a new wallet: "+walletAddress
	);
	console.log(
		"Wallet wifKey (keep this secure, this is what lets you spend your doge): "+wifKey
	);

	console.log(
		"Wallet address generated from wifKey: " + DogeJS.wif2address(wifKey).address
	);

	// Get balance
	try{
		console.log("Balance", await DogeJS.addressBalance(walletAddress));
	}catch(err){
		console.log("Unable to fetch balance:", err);
	}

	// Get unspent inputs for address
	try{
		console.log("Unspent inputs", await DogeJS.listUnspent(walletAddress));
	}catch( err ){
		console.log("Unable to get unspent inputs:", err);
	}
	
	// Attempt a transaction (will fail because 
	try{

		console.log(await DogeJS.simpleTransferCoins( 
			wifKey, 												// WIF key of address you want to send from
			'recipientDogeWallet', 									// Target address
			10, 													// Coins to send.
			1, 														// Fee. Todo: Try to calculate a better one?
			false,													// Change address. Defaults to sender address. I recommend you generate a new change address and put here unless you're sweeping the entire wallet.
			false 													// Dry run. 
		));
		
	}catch( err ){

		console.error("Unable to create transfer:", err);

	}
	
})();
```

### Common methods

| method | args | returns | description |
|---|---|---|---|
|generateWallet|n/a| `{privkey:private_key, pubkey:public_key, address:wallet_address, wif:wif_key, compressed:is_compressed}` | Generates a new wallet. The only thing you really need to save is the wif-key. It can be used to generate the other keys. |
|addressBalance|address|balance value|Gets a wallet balance|
|simpleTransferCoins|wifKey, recipientAddress, amountInDoge, feeInDoge, changeAddress, dryRun|transaction ID|Shortcut function that fetches all unspent inputs, calculates how much you have, handles fee/change, creates, signs, and publishes the transaction. amountInDoge is in doge and can use decimals. If changeAddress is left empty, it sends the change back to the sending address (not recommended, but can be left out if you're sending ALL doge in the wallet). Fee is added to the total amount. If the amount you send + fee is more than you have, an error is thrown.|
|wif2address|wifKey|`{address:dogeAddress, compressed:isCompressed}`|Gets your wallet address from your wifKey|


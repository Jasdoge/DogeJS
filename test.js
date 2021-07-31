const d = require('./DogeJS');
const DogeJS = new d();

(async () => {

	// Generates a new wallet
	const credentials = DogeJS.generateWallet();

	// Wallet address is where you send the coins
	const walletAddress = credentials.address;

	// wifKey is what you need to store in order to access your coins.
	const wifKey = credentials.wif;

	console.log(
		"Generated a new wallet: "+walletAddress
	);
	console.log(
		"Wallet wifKey (keep this secure, this is what lets you spend your doge): "+wifKey
	);

	// You can always get the private key and wallet address from the wifKey
	console.log(
		"Wallet address generated from wifKey: " + DogeJS.wif2address(wifKey).address
	);

	// Get wallet balance
	try{
		console.log("Balance", await DogeJS.addressBalance(walletAddress));
	}catch(err){
		console.log("Unable to fetch balance:", err);
	}

	// Get unspent inputs for address (advanced)
	try{
		console.log("Unspent inputs", await DogeJS.listUnspent(walletAddress));
	}catch( err ){
		console.log("Unable to get unspent inputs:", err);
	}
	
	// Attempt a transaction (will fail because you don't have enough money)
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






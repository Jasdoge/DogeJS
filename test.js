const d = require('./DogeJS.js');
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






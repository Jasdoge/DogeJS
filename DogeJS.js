/*
	Based on
	Coinjs 0.01 beta by OutCast3k{at}gmail.com
	A bitcoin framework.

	http://github.com/OutCast3k/coinjs or http://coinb.in/coinjs

	Rewrite for node by Jasdoge
*/
const fetch = require('node-fetch');
const Crypto = require('./lib/crypto');
const BigInteger = require('./lib/jsbn').BigInteger;
const EllipticCurve = require('./lib/ellipticcurve');
const ripemd160 = require('./lib/ripemd160');
const NodeCrypto = require('crypto');

class DogeLib{

	/* public vars */
	pub = 0x1E;			// 0x00 for bitcoin, 0x1E for dogecoin?
	priv = 0x9E;		// 0x80 for bitcoin, 0x9E for dogecoin?
	compressed = false;

	constructor(){}

	// API commands
	/* retrieve unspent data from chainso */
	async listUnspent( address ){

		const decode = this.addressDecode(address);
		if( decode.version == this.priv ) // wif key
			address = this.wif2address(address).address;
		

		const url = "https://api.blockchair.com/dogecoin/dashboards/address/"+address;
		
		const data = await Req.json(url);

		const outputs = [];
		const all_info = data.data[address];
		for( const o of all_info.utxo ){

			// I'm not sure what the purpose of this is
			let tx = ((""+o.transaction_hash).match(/.{1,2}/g).reverse()).join("")+'';
			if(tx.match(/^[a-f0-9]+$/)){

				// But it swaps back here
				tx = ((tx).match(/.{1,2}/g).reverse()).join("")+'';
				outputs.push({
					tx : tx,
					n : o.index,
					hex : all_info.address.script_hex,
					amount : ((o.value.toString()*1)/100000000).toFixed(8)
				});

			}

		}

		return outputs;

	}

	/* Creates a transaction object and returns it */
	/*
		from : WIF key
		to : Wallet address
		amount : amount in doge (with decimal)
		fee : amount to pay as fee, as of writing I think the lowered fees are in place?

		Todo: Use proper decimals here instead of floats. But since doge is cheap enough that exact decimal precision shouldn't matter, I think it's fine for now.
	*/
	async createTransaction(from, to, amount, fee = 0.1, change_addr = false ){

		amount = +amount;
		const decode = this.addressDecode(from);
		if( decode.version == this.priv ) // wif key
			from = this.wif2address(from).address;
		
		if( amount <= 0 || fee < 0 )
			throw 'Invalid amount.'

		const unspent = await this.listUnspent(from);

		const transaction = this.transaction();
		const seq = 0xffffffff-2; // TXRBF, otherwise 0xffffffff-1
		// This allows you to override this transaction while unconfirmed?
				
		let total = 0;
		// Add the inputs
		for( let val of unspent ){

			transaction.addinput(val.tx, String(val.n), val.hex, seq);
			total += +val.amount;

		}

		if( amount+fee > total )
			throw 'Invalid amount (tried '+amount+', max '+total+')';
		
		
		
		// Add output
		const outputs = [
			{address:to, amount:amount},
		];

		// Change address
		if( amount+fee < total )
			outputs.push({
				address:(change_addr ? change_addr : from), 
				amount:total-(amount+fee)
			});
		
		for( let op of outputs ){

			const a = op.address;
			const amt = op.amount;

			let ad = this.addressDecode(a);
			if(a != "" && ad.version == this.pub ) // address
				transaction.addoutput(a, String(amt));
			else
				throw 'Invalid address?'
			
		}

		return transaction;

	}

	signTransaction( wifkey, transaction ){

		if( !transaction )
			return false;

		if( !this.addressDecode(wifkey) )
			throw 'Invalid key';

		return transaction.sign(wifkey, 1);
		

	}
	
	// Broadcasts the signed transaction and on success returns the transaction hash
	async broadcastSignedTransaction( signedTransaction ){


		const url = "https://api.blockchair.com/dogecoin/push/transaction/";
		const data = await Req.json(url, 'data='+signedTransaction);
		return data.data.transaction_hash;

	}

	async simpleTransferCoins( wifkey, to, amount, fee = 0, change_addr = false, dry_run = false ){

		const transaction = await this.createTransaction(wifkey, to, amount, fee, change_addr);
		const signed = this.signTransaction(wifkey, transaction);

		if( dry_run ){
			console.log("Dry run transaction: ", transaction);
			console.log("Dry run signed: ", signed);
			return true;
		}
		return await this.broadcastSignedTransaction(signed);

	}

	/* retreive the balance from a given address */
	async addressBalance( address ){

		const req = await Req.json('https://api.blockchair.com/dogecoin/addresses/balances?addresses='+address);
		if( req && req.data ){

			if( req.data[address] )
				return (req.data[address]/100000000).toFixed(8);
			return 0;

		}

		throw 'Unable to fetch balance';

	}






	/* start of address functions */

	/* Generates:
		privkey : private key (hex)
		pubkey : public key
		address : dogecoin address
		wif : wif key (save this)
		compressed : whether it's compressed
	*/
	generateWallet(input){

		const privkey = (input) ? Crypto.SHA256(input) : this.newPrivkey();
		const pubkey = this.newPubkey(privkey);
		return {
			'privkey': privkey,
			'pubkey': pubkey,
			'address': this.pubkey2address(pubkey),
			'wif': this.privkey2wif(privkey),
			'compressed': this.compressed
		};

	}

	

	// Tools
	/* decode or validate an address and return the hash */
	addressDecode( addr ){

		let bytes = this.base58decode(addr);
		let front = bytes.slice(0, bytes.length-4);
		let back = bytes.slice(bytes.length-4);

		let checksum = Crypto.SHA256(Crypto.SHA256(front, {asBytes: true}), {asBytes: true}).slice(0, 4);

		if( String(checksum) === String(back) ){

			let o = {};
			o.bytes = front.slice(1);
			o.version = front[0];

			if( o.version === this.pub ) // standard address
				o.type = 'standard';
			else if( o.version === this.multisig ) // multisig address
				o.type = 'multisig';
			else if( o.version === this.priv ) // wifkey
				o.type = 'wifkey';
			else
				o.type = 'other'; // address is still valid but unknown version
			return o;

		} 
		else
			throw "Invalid checksum";

	}

	/* convert a wif key back to a private key */
	wif2privkey(wif){

		let compressed = false;
		let decode = this.base58decode(wif);
		let key = decode.slice(0, decode.length-4);
		key = key.slice(1, key.length);
		if(key.length>=33 && key[key.length-1]==0x01){
			key = key.slice(0, key.length-1);
			compressed = true;
		}
		return {'privkey': Crypto.util.bytesToHex(key), 'compressed':compressed};
		
	}

	/* provide a privkey and return an WIF  */
	privkey2wif( h ){

		let r = Crypto.util.hexToBytes(h);

		if( this.compressed )
			r.push(0x01);

		r.unshift(this.priv);
		let hash = Crypto.SHA256(Crypto.SHA256(r, {asBytes: true}), {asBytes: true});
		let checksum = hash.slice(0, 4);

		return this.base58encode(r.concat(checksum));

	}

	/* convert a wif to a pubkey */
	wif2pubkey( wif ){

		let compressed = this.compressed;
		let r = this.wif2privkey(wif);
		this.compressed = r['compressed'];
		let pubkey = this.newPubkey(r['privkey']);
		this.compressed = compressed;
		return {'pubkey':pubkey,'compressed':r['compressed']};

	}

	/* convert a wif to a address */
	wif2address( wif ){

		let r = this.wif2pubkey(wif);
		return {'address':this.pubkey2address(r['pubkey']), 'compressed':r['compressed']};

	}

	/* generate a public key from a private key */
	newPubkey( hash ){

		const privateKeyBigInt = BigInteger.fromByteArrayUnsigned(Crypto.util.hexToBytes(hash));
		const curve = EllipticCurve.getSECCurveByName("secp256k1");

		const curvePt = curve.getG().multiply(privateKeyBigInt);
		const x = curvePt.getX().toBigInteger();
		const y = curvePt.getY().toBigInteger();

		let publicKeyBytes = EllipticCurve.integerToBytes(x, 32);
		publicKeyBytes = publicKeyBytes.concat(EllipticCurve.integerToBytes(y,32));
		publicKeyBytes.unshift(0x04);

		if( this.compressed ){

			const publicKeyBytesCompressed = EllipticCurve.integerToBytes(x,32)
			if( y.isEven() )
				publicKeyBytesCompressed.unshift(0x02)
			else
				publicKeyBytesCompressed.unshift(0x03)
			
			return Crypto.util.bytesToHex(publicKeyBytesCompressed);

		}
		
		return Crypto.util.bytesToHex(publicKeyBytes);

	}

	/* provide a public key and return address */
	pubkey2address( h, byte ){

		let r = ripemd160(Crypto.SHA256(Crypto.util.hexToBytes(h), {asBytes: true}));
		r.unshift(byte || this.pub);
		let hash = Crypto.SHA256(Crypto.SHA256(r, {asBytes: true}), {asBytes: true});
		let checksum = hash.slice(0, 4);
		return this.base58encode(r.concat(checksum));

	}
	

	/* generate a new random private key */
	newPrivkey(){

		/*
		let x = window.location;
		x += (window.screen.height * window.screen.width * window.screen.colorDepth);
		x += this.random(64);
		x += (window.screen.availHeight * window.screen.availWidth * window.screen.pixelDepth);
		x += navigator.language;
		x += window.history.length;
		x += this.random(64);
		x += navigator.userAgent;
		x += 'coinb.in';
		x += (Crypto.util.randomBytes(64)).join("");
		x += x.length;
		const dateObj = new Date();
		x += dateObj.getTimezoneOffset();
		x += this.random(64);
		x += (document.getElementById("entropybucket")) ? document.getElementById("entropybucket").innerHTML : '';
		x += x+''+x;
		let r = x;
		for( let i=0; i < (x).length/25; ++i ){
			r = Crypto.SHA256(r.concat(x));
		}
		const checkrBigInt = new BigInteger(r);
		const orderBigInt = new BigInteger("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
		while( 
			checkrBigInt.compareTo(orderBigInt) >= 0 || 
			checkrBigInt.equals(BigInteger.ZERO) || 
			checkrBigInt.equals(BigInteger.ONE) 
		){
			r = Crypto.SHA256(r.concat(x));
			checkrBigInt = new BigInteger(r);
		}
		*/
		return Crypto.SHA256(NodeCrypto.randomBytes(20).toString('hex'));

	}

	/* create a new transaction object */
	transaction() {

		let r = {};
		r.version = 1;
		r.lock_time = 0;
		r.ins = [];
		r.outs = [];
		r.witness = false;
		r.timestamp = null;
		r.block = null;

		const parent = this;

		/* add an input to a transaction */
		r.addinput = function(txid, index, script, sequence){
			let o = {};
			o.outpoint = {'hash':txid, 'index':index};
			o.script = parent.script(script||[]);
			o.sequence = sequence || ((r.lock_time==0) ? 4294967295 : 0);
			return this.ins.push(o);
		}

		/* add an output to a transaction */
		r.addoutput = function(address, value){
			let o = {};
			o.value = new BigInteger('' + Math.round((value*1) * 1e8), 10);
			let s = parent.script();
			o.script = s.spendToScript(address);

			return this.outs.push(o);
		}

		/* add data to a transaction */
		r.adddata = function(data){
			let r = false;
			if(((data.match(/^[a-f0-9]+$/gi)) && data.length<160) && (data.length%2)==0) {
				let s = parent.script();
				s.writeOp(106); // OP_RETURN
				s.writeBytes(Crypto.util.hexToBytes(data));
				o = {};
				o.value = 0;
				o.script = s;
				return this.outs.push(o);
			}
			return r;
		}

		/* generate the transaction hash to sign from a transaction input */
		r.transactionHash = function(index, sigHashType) {

			let clone = parent.clone(this);
			let shType = sigHashType || 1;

			/* black out all other ins, except this one */
			for (let i = 0; i < clone.ins.length; i++) {
				if(index!=i){
					clone.ins[i].script = parent.script();
				}
			}

			let extract = this.extractScriptKey(index);
			clone.ins[index].script = parent.script(extract['script']);

			if((clone.ins) && clone.ins[index]){

				/* SIGHASH : For more info on sig hashs see https://en.bitcoin.it/wiki/OP_CHECKSIG
					and https://bitcoin.org/en/developer-guide#signature-hash-type */

				if(shType == 1){
					//SIGHASH_ALL 0x01

				} else if(shType == 2){
					//SIGHASH_NONE 0x02
					clone.outs = [];
					for (let i = 0; i < clone.ins.length; i++) {
						if(index!=i){
							clone.ins[i].sequence = 0;
						}
					}

				} else if(shType == 3){

					//SIGHASH_SINGLE 0x03
					clone.outs.length = index + 1;

					for(let i = 0; i < index; i++){
						clone.outs[i].value = -1;
						clone.outs[i].script.buffer = [];
					}

					for (let i = 0; i < clone.ins.length; i++) {
						if(index!=i){
							clone.ins[i].sequence = 0;
						}
					}

				} else if (shType >= 128){
					//SIGHASH_ANYONECANPAY 0x80
					clone.ins = [clone.ins[index]];

					if(shType==129){
						// SIGHASH_ALL + SIGHASH_ANYONECANPAY

					} else if(shType==130){
						// SIGHASH_NONE + SIGHASH_ANYONECANPAY
						clone.outs = [];

					} else if(shType==131){
                                                // SIGHASH_SINGLE + SIGHASH_ANYONECANPAY
						clone.outs.length = index + 1;
						for(let i = 0; i < index; i++){
							clone.outs[i].value = -1;
							clone.outs[i].script.buffer = [];
						}
					}
				}

				let buffer = Crypto.util.hexToBytes(clone.serialize());
				buffer = buffer.concat(parent.numToBytes(parseInt(shType), 4));
				let hash = Crypto.SHA256(buffer, {asBytes: true});
				let r = Crypto.util.bytesToHex(Crypto.SHA256(hash, {asBytes: true}));
				return r;
			} else {
				return false;
			}
		}

		/* extract the scriptSig, used in the transactionHash() function */
		r.extractScriptKey = function(index) {
			if(this.ins[index]){
				if((this.ins[index].script.chunks.length==5) && this.ins[index].script.chunks[4]==172 && Array.isArray(this.ins[index].script.chunks[2])){ //OP_CHECKSIG
					// regular scriptPubkey (not signed)
					return {'type':'scriptpubkey', 'signed':'false', 'signatures':0, 'script': Crypto.util.bytesToHex(this.ins[index].script.buffer)};
				} else if((this.ins[index].script.chunks.length==2) && this.ins[index].script.chunks[0][0]==48 && this.ins[index].script.chunks[1].length == 5 && this.ins[index].script.chunks[1][1]==177){//OP_CHECKLOCKTIMEVERIFY
					// hodl script (signed)
					return {'type':'hodl', 'signed':'true', 'signatures':1, 'script': Crypto.util.bytesToHex(this.ins[index].script.buffer)};
				} else if((this.ins[index].script.chunks.length==2) && this.ins[index].script.chunks[0][0]==48){ 
					// regular scriptPubkey (probably signed)
					return {'type':'scriptpubkey', 'signed':'true', 'signatures':1, 'script': Crypto.util.bytesToHex(this.ins[index].script.buffer)};
				} else if(this.ins[index].script.chunks.length == 5 && this.ins[index].script.chunks[1] == 177){//OP_CHECKLOCKTIMEVERIFY
					// hodl script (not signed)
					return {'type':'hodl', 'signed':'false', 'signatures': 0, 'script': Crypto.util.bytesToHex(this.ins[index].script.buffer)};
				} else if((this.ins[index].script.chunks.length <= 3 && this.ins[index].script.chunks.length > 0) && ((this.ins[index].script.chunks[0].length == 22 && this.ins[index].script.chunks[0][0] == 0) || (this.ins[index].script.chunks[0].length == 20 && this.ins[index].script.chunks[1] == 0))){
					let signed = ((this.witness[index]) && this.witness[index].length==2) ? 'true' : 'false';
					let sigs = (signed == 'true') ? 1 : 0;
					let value = -1; // no value found
					if((this.ins[index].script.chunks[2]) && this.ins[index].script.chunks[2].length==8){
						value = parent.bytesToNum(this.ins[index].script.chunks[2]);  // value found encoded in transaction (THIS IS NON STANDARD)
					}
					return {'type':'segwit', 'signed':signed, 'signatures': sigs, 'script': Crypto.util.bytesToHex(this.ins[index].script.chunks[0]), 'value': value};
				} else if (this.ins[index].script.chunks[0]==0 && this.ins[index].script.chunks[this.ins[index].script.chunks.length-1][this.ins[index].script.chunks[this.ins[index].script.chunks.length-1].length-1]==174) { // OP_CHECKMULTISIG
					// multisig script, with signature(s) included
					sigcount = 0;
					for(i=1; i<this.ins[index].script.chunks.length-1;i++){
						if(this.ins[index].script.chunks[i]!=0){
							sigcount++;
						}
					}

					return {'type':'multisig', 'signed':'true', 'signatures':sigcount, 'script': Crypto.util.bytesToHex(this.ins[index].script.chunks[this.ins[index].script.chunks.length-1])};
				} else if (this.ins[index].script.chunks[0]>=80 && this.ins[index].script.chunks[this.ins[index].script.chunks.length-1]==174) { // OP_CHECKMULTISIG
					// multisig script, without signature!
					return {'type':'multisig', 'signed':'false', 'signatures':0, 'script': Crypto.util.bytesToHex(this.ins[index].script.buffer)};
				} else if (this.ins[index].script.chunks.length==0) {
					// empty
					return {'type':'empty', 'signed':'false', 'signatures':0, 'script': ''};
				} else {
					// something else
					return {'type':'unknown', 'signed':'false', 'signatures':0, 'script':Crypto.util.bytesToHex(this.ins[index].script.buffer)};
				}
			} else {
				return false;
			}
		}

		/* generate a signature from a transaction hash */
		r.transactionSig = function(index, wif, sigHashType, txhash){

			function serializeSig(r, s) {
				let rBa = r.toByteArraySigned();
				let sBa = s.toByteArraySigned();

				let sequence = [];
				sequence.push(0x02); // INTEGER
				sequence.push(rBa.length);
				sequence = sequence.concat(rBa);

				sequence.push(0x02); // INTEGER
				sequence.push(sBa.length);
				sequence = sequence.concat(sBa);

				sequence.unshift(sequence.length);
				sequence.unshift(0x30); // SEQUENCE

				return sequence;
			}

			let shType = sigHashType || 1;
			let hash = txhash || Crypto.util.hexToBytes(this.transactionHash(index, shType));

			if(hash){

				let curve = EllipticCurve.getSECCurveByName("secp256k1");
				let key = parent.wif2privkey(wif);
				let priv = BigInteger.fromByteArrayUnsigned(Crypto.util.hexToBytes(key['privkey']));
				let n = curve.getN();
				let e = BigInteger.fromByteArrayUnsigned(hash);
				let badrs = 0
				let r, s;
				do {
					let k = this.deterministicK(wif, hash, badrs);
					let G = curve.getG();
					let Q = G.multiply(k);
					r = Q.getX().toBigInteger().mod(n);
					s = k.modInverse(n).multiply(e.add(priv.multiply(r))).mod(n);
					badrs++
				} while (r.compareTo(BigInteger.ZERO) <= 0 || s.compareTo(BigInteger.ZERO) <= 0);

				// Force lower s values per BIP62
				let halfn = n.shiftRight(1);
				if (s.compareTo(halfn) > 0) {
					s = n.subtract(s);
				};

				let sig = serializeSig(r, s);
				sig.push(parseInt(shType, 10));

				return Crypto.util.bytesToHex(sig);

			} else {
				return false;
			}
		}

		// https://tools.ietf.org/html/rfc6979#section-3.2
		r.deterministicK = function(wif, hash, badrs) {
			// if r or s were invalid when this function was used in signing,
			// we do not want to actually compute r, s here for efficiency, so,
			// we can increment badrs. explained at end of RFC 6979 section 3.2

			// wif is b58check encoded wif privkey.
			// hash is byte array of transaction digest.
			// badrs is used only if the k resulted in bad r or s.

			// some necessary things out of the way for clarity.
			badrs = badrs || 0;
			let key = parent.wif2privkey(wif);
			let x = Crypto.util.hexToBytes(key['privkey'])
			let curve = EllipticCurve.getSECCurveByName("secp256k1");
			let N = curve.getN();

			// Step: a
			// hash is a byteArray of the message digest. so h1 == hash in our case

			// Step: b
			let v = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

			// Step: c
			let k = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

			// Step: d
			k = Crypto.HMAC(Crypto.SHA256, v.concat([0]).concat(x).concat(hash), k, { asBytes: true });

			// Step: e
			v = Crypto.HMAC(Crypto.SHA256, v, k, { asBytes: true });

			// Step: f
			k = Crypto.HMAC(Crypto.SHA256, v.concat([1]).concat(x).concat(hash), k, { asBytes: true });

			// Step: g
			v = Crypto.HMAC(Crypto.SHA256, v, k, { asBytes: true });

			// Step: h1
			let T = [];

			// Step: h2 (since we know tlen = qlen, just copy v to T.)
			v = Crypto.HMAC(Crypto.SHA256, v, k, { asBytes: true });
			T = v;

			// Step: h3
			let KBigInt = BigInteger.fromByteArrayUnsigned(T);

			// loop if KBigInt is not in the range of [1, N-1] or if badrs needs incrementing.
			let i = 0
			while (KBigInt.compareTo(N) >= 0 || KBigInt.compareTo(BigInteger.ZERO) <= 0 || i < badrs) {
				k = Crypto.HMAC(Crypto.SHA256, v.concat([0]), k, { asBytes: true });
				v = Crypto.HMAC(Crypto.SHA256, v, k, { asBytes: true });
				v = Crypto.HMAC(Crypto.SHA256, v, k, { asBytes: true });
				T = v;
				KBigInt = BigInteger.fromByteArrayUnsigned(T);
				i++
			};

			return KBigInt;
		};

		/* sign a "standard" input */
		r.signinput = function(index, wif, sigHashType){
			let key = parent.wif2pubkey(wif);
			let shType = sigHashType || 1;
			let signature = this.transactionSig(index, wif, shType);
			let s = parent.script();
			s.writeBytes(Crypto.util.hexToBytes(signature));
			s.writeBytes(Crypto.util.hexToBytes(key['pubkey']));
			this.ins[index].script = s;
			return true;
		}

		/* signs a time locked / hodl input */
		r.signhodl = function(index, wif, sigHashType){
			let shType = sigHashType || 1;
			let signature = this.transactionSig(index, wif, shType);
			let redeemScript = this.ins[index].script.buffer
			let s = parent.script();
			s.writeBytes(Crypto.util.hexToBytes(signature));
			s.writeBytes(redeemScript);
			this.ins[index].script = s;
			return true;
		}
		/* sign inputs */
		r.sign = function(wif, sigHashType){
			let shType = sigHashType || 1;
			for (let i = 0; i < this.ins.length; i++) {
				let d = this.extractScriptKey(i);

				let w2a = parent.wif2address(wif);
				let script = parent.script();
				let pubkeyHash = script.pubkeyHash(w2a['address']);

				if(((d['type'] == 'scriptpubkey' && d['script']==Crypto.util.bytesToHex(pubkeyHash.buffer)) || d['type'] == 'empty') && d['signed'] == "false"){
					this.signinput(i, wif, shType);

				} else if (d['type'] == 'hodl' && d['signed'] == "false") {
					this.signhodl(i, wif, shType);

				} else if (d['type'] == 'multisig') {
					this.signmultisig(i, wif, shType);

				} else if (d['type'] == 'segwit') {
					this.signsegwit(i, wif, shType);

				} else {
					// could not sign
				}
			}
			return this.serialize();
		}

		/* serialize a transaction */
		r.serialize = function(){
			let buffer = [];
			buffer = buffer.concat(parent.numToBytes(parseInt(this.version),4));

			if( Array.isArray(this.witness) ){
				buffer = buffer.concat([0x00, 0x01]);
			}

			buffer = buffer.concat(parent.numToVarInt(this.ins.length));
			for (let i = 0; i < this.ins.length; i++) {
				let txin = this.ins[i];
				buffer = buffer.concat(Crypto.util.hexToBytes(txin.outpoint.hash).reverse());
				buffer = buffer.concat(parent.numToBytes(parseInt(txin.outpoint.index),4));
				let scriptBytes = txin.script.buffer;
				buffer = buffer.concat(parent.numToVarInt(scriptBytes.length));
				buffer = buffer.concat(scriptBytes);
				buffer = buffer.concat(parent.numToBytes(parseInt(txin.sequence),4));
			}
			buffer = buffer.concat(parent.numToVarInt(this.outs.length));

			for (let i = 0; i < this.outs.length; i++) {
				let txout = this.outs[i];
 				buffer = buffer.concat(parent.numToBytes(txout.value,8));
				let scriptBytes = txout.script.buffer;
				buffer = buffer.concat(parent.numToVarInt(scriptBytes.length));
				buffer = buffer.concat(scriptBytes);
			}

			if(( Array.isArray(this.witness)) && this.witness.length>=1){
				for(let i = 0; i < this.witness.length; i++){
	 				buffer = buffer.concat(parent.numToVarInt(this.witness[i].length));
					for(let x = 0; x < this.witness[i].length; x++){
		 				buffer = buffer.concat(parent.numToVarInt(Crypto.util.hexToBytes(this.witness[i][x]).length));
						buffer = buffer.concat(Crypto.util.hexToBytes(this.witness[i][x]));
					}
				}
			}

			buffer = buffer.concat(parent.numToBytes(parseInt(this.lock_time),4));
			return Crypto.util.bytesToHex(buffer);
		}

		/* deserialize a transaction */
		r.deserialize = function(buffer){
			if (typeof buffer == "string") {
				buffer = Crypto.util.hexToBytes(buffer)
			}

			let pos = 0;
			let witness = false;

			let readAsInt = function(bytes) {
				if (bytes == 0) return 0;
				pos++;
				return buffer[pos-1] + readAsInt(bytes-1) * 256;
			}

			let readVarInt = function() {
				pos++;
				if (buffer[pos-1] < 253) {
					return buffer[pos-1];
				}
				return readAsInt(buffer[pos-1] - 251);
			}

			let readBytes = function(bytes) {
				pos += bytes;
				return buffer.slice(pos - bytes, pos);
			}

			let readVarString = function() {
				let size = readVarInt();
				return readBytes(size);
			}

			let obj = parent.transaction();
			obj.version = readAsInt(4);

			if(buffer[pos] == 0x00 && buffer[pos+1] == 0x01){
				// segwit transaction
				witness = true;
				obj.witness = [];
				pos += 2;
			}

			let ins = readVarInt();
			for (let i = 0; i < ins; i++) {
				obj.ins.push({
					outpoint: {
						hash: Crypto.util.bytesToHex(readBytes(32).reverse()),
 						index: readAsInt(4)
					},
					script: parent.script(readVarString()),
					sequence: readAsInt(4)
				});
			}

			let outs = readVarInt();
			for (let i = 0; i < outs; i++) {
				obj.outs.push({
					value: parent.bytesToNum(readBytes(8)),
					script: parent.script(readVarString())
				});
			}

			if(witness == true){
				for (i = 0; i < ins; ++i) {
					let count = readVarInt();
					let vector = [];
					for(let y = 0; y < count; y++){
						let slice = readVarInt();
						pos += slice;
						if(!Array.isArray(obj.witness[i])){
							obj.witness[i] = [];
						}
						obj.witness[i].push(Crypto.util.bytesToHex(buffer.slice(pos - slice, pos)));
					}
				}
			}

 			obj.lock_time = readAsInt(4);
			return obj;
		}

		r.size = function(){
			return ((this.serialize()).length/2).toFixed(0);
		}

		return r;
	}

	/* clone an object */
	clone(obj) {
		if(obj == null || typeof(obj) != 'object') return obj;
		let temp = new obj.constructor();

		for(let key in obj) {
			if(obj.hasOwnProperty(key)) {
				temp[key] = this.clone(obj[key]);
			}
		}
 		return temp;
	}

	numToBytes(num,bytes) {
		if (typeof bytes === "undefined") bytes = 8;
		if (bytes == 0) { 
			return [];
		} else if (num == -1){
			return Crypto.util.hexToBytes("ffffffffffffffff");
		} else {
			return [num % 256].concat(this.numToBytes(Math.floor(num / 256),bytes-1));
		}
	}

	numToVarInt(num) {
		if (num < 253) {
			return [num];
		} else if (num < 65536) {
			return [253].concat(this.numToBytes(num,2));
		} else if (num < 4294967296) {
			return [254].concat(this.numToBytes(num,4));
		} else {
			return [255].concat(this.numToBytes(num,8));
		}
	}

	/* start of script functions */
	script(data) {
		let r = {};
		const parent = this;

		if(!data){
			r.buffer = [];
		} else if ("string" == typeof data) {
			r.buffer = Crypto.util.hexToBytes(data);
		} else if (Array.isArray(data)) {
			r.buffer = data;
		} else if (data instanceof this.script) {
			r.buffer = data.buffer;
		} else {
			r.buffer = data;
		}

		/* parse buffer array */
		r.parse  = function() {

			let self = this;
			r.chunks = [];
			let i = 0;

			function readChunk(n) {
				self.chunks.push(self.buffer.slice(i, i + n));
				i += n;
			};

			while (i < this.buffer.length) {
				let opcode = this.buffer[i++];
				if (opcode >= 0xF0) {
 					opcode = (opcode << 8) | this.buffer[i++];
				}

				let len;
				if (opcode > 0 && opcode < 76) { //OP_PUSHDATA1
					readChunk(opcode);
				} else if (opcode == 76) { //OP_PUSHDATA1
					len = this.buffer[i++];
					readChunk(len);
				} else if (opcode == 77) { //OP_PUSHDATA2
 					len = (this.buffer[i++] << 8) | this.buffer[i++];
					readChunk(len);
				} else if (opcode == 78) { //OP_PUSHDATA4
					len = (this.buffer[i++] << 24) | (this.buffer[i++] << 16) | (this.buffer[i++] << 8) | this.buffer[i++];
					readChunk(len);
				} else {
					this.chunks.push(opcode);
				}

				if(i<0x00){
					break;
				}
			}

			return true;
		};

		/* decode the redeemscript of a multisignature transaction */
		r.decodeRedeemScript = function(script){
			let r = false;
			try {
				let s = this.script(Crypto.util.hexToBytes(script));
				if((s.chunks.length>=3) && s.chunks[s.chunks.length-1] == 174){//OP_CHECKMULTISIG
					r = {};
					r.signaturesRequired = s.chunks[0]-80;
					let pubkeys = [];
					for(let i=1;i<s.chunks.length-2;i++){
						pubkeys.push(Crypto.util.bytesToHex(s.chunks[i]));
					}
					r.pubkeys = pubkeys;
					let multi = this.pubkeys2MultisigAddress(pubkeys, r.signaturesRequired);
					r.address = multi['address'];
					r.type = 'multisig__'; // using __ for now to differentiat from the other object .type == "multisig"
					let rs = Crypto.util.bytesToHex(s.buffer);
					r.redeemscript = rs;

				} else if((s.chunks.length==2) && (s.buffer[0] == 0 && s.buffer[1] == 20)){ // SEGWIT
					r = {};
					r.type = "segwit__";
					let rs = Crypto.util.bytesToHex(s.buffer);
					r.address = this.pubkey2address(rs, this.multisig);
					r.redeemscript = rs;

				} else if(s.chunks.length == 5 && s.chunks[1] == 177 && s.chunks[2] == 117 && s.chunks[4] == 172){
					// ^ <unlocktime> OP_CHECKLOCKTIMEVERIFY OP_DROP <pubkey> OP_CHECKSIG ^
					r = {}
					r.pubkey = Crypto.util.bytesToHex(s.chunks[3]);
					r.checklocktimeverify = this.bytesToNum(s.chunks[0].slice());
					r.address = this.simpleHodlAddress(r.pubkey, r.checklocktimeverify).address;
					let rs = Crypto.util.bytesToHex(s.buffer);
					r.redeemscript = rs;
					r.type = "hodl__";
				}
			} catch(e) {
				// console.log(e);
				r = false;
			}
			return r;
		}

		/* create output script to spend */
		r.spendToScript = function(address){
			let addr = parent.addressDecode(address);
			let s = parent.script();
			if(addr.type == "bech32"){
				s.writeOp(0);
				s.writeBytes(Crypto.util.hexToBytes(addr.redeemscript));
			} else if(addr.version==parent.multisig){ // multisig address
				s.writeOp(169); //OP_HASH160
				s.writeBytes(addr.bytes);
				s.writeOp(135); //OP_EQUAL
			} else { // regular address
				s.writeOp(118); //OP_DUP
				s.writeOp(169); //OP_HASH160
				s.writeBytes(addr.bytes);
				s.writeOp(136); //OP_EQUALVERIFY
				s.writeOp(172); //OP_CHECKSIG
			}
			return s;
		}

		/* geneate a (script) pubkey hash of the address - used for when signing */
		r.pubkeyHash = function(address) {
			let addr = parent.addressDecode(address);
			let s = parent.script();
			s.writeOp(118);//OP_DUP
			s.writeOp(169);//OP_HASH160
			s.writeBytes(addr.bytes);
			s.writeOp(136);//OP_EQUALVERIFY
			s.writeOp(172);//OP_CHECKSIG
			return s;
		}

		/* write to buffer */
		r.writeOp = function(op){
			this.buffer.push(op);
			this.chunks.push(op);
			return true;
		}

		/* write bytes to buffer */
		r.writeBytes = function(data){
			if (data.length < 76) {	//OP_PUSHDATA1
				this.buffer.push(data.length);
			} else if (data.length <= 0xff) {
				this.buffer.push(76); //OP_PUSHDATA1
				this.buffer.push(data.length);
			} else if (data.length <= 0xffff) {
				this.buffer.push(77); //OP_PUSHDATA2
				this.buffer.push(data.length & 0xff);
				this.buffer.push((data.length >>> 8) & 0xff);
			} else {
				this.buffer.push(78); //OP_PUSHDATA4
				this.buffer.push(data.length & 0xff);
				this.buffer.push((data.length >>> 8) & 0xff);
				this.buffer.push((data.length >>> 16) & 0xff);
				this.buffer.push((data.length >>> 24) & 0xff);
			}
			this.buffer = this.buffer.concat(data);
			this.chunks.push(data);
			return true;
		}

		r.parse();
		return r;
	}



	// Generic helpers
	/* base58 decode function */
	base58decode( buffer ){

		const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
		let base = BigInteger.valueOf(58);

		let bi = BigInteger.valueOf(0);
		let leadingZerosNum = 0;
		for( let i = buffer.length - 1; i >= 0; i-- ){

			let alphaIndex = alphabet.indexOf(buffer[i]);
			if( alphaIndex < 0 )
				throw "Invalid character";
			
			bi = bi.add(BigInteger.valueOf(alphaIndex).multiply(base.pow(buffer.length - 1 - i)));

			if( buffer[i] == "1" )
				++leadingZerosNum;
			else 
				leadingZerosNum = 0;

		}

		let bytes = bi.toByteArrayUnsigned();
		while( leadingZerosNum-- > 0 )
			bytes.unshift(0);
		return bytes;

	}

	/* base58 encode function */
	base58encode( buffer ){

		let alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
		let base = BigInteger.valueOf(58);

		let bi = BigInteger.fromByteArrayUnsigned(buffer);
		let chars = [];

		while( bi.compareTo(base) >= 0 ){

			let mod = bi.mod(base);
			chars.unshift(alphabet[mod.intValue()]);
			bi = bi.subtract(mod).divide(base);

		}

		chars.unshift(alphabet[bi.intValue()]);
		for( let i = 0; i < buffer.length; ++i ){
			if( buffer[i] == 0x00 )
				chars.unshift(alphabet[0]);
			else 
				break;
		}
		return chars.join('');

	}


};


class Req{

	// postData expects urlencoded form data
	constructor( url, postData ){

		this.url = url;
		this.postData = postData;
		this.request = undefined;
		this.response = undefined;

	}

	async exec(){

		const reqConf = {
			method : 'GET',
			mode : 'cors',
			cache: 'no-cache',
			credentials: 'same-origin',
			redirect : 'follow',
		};

		if( this.postData ){

			reqConf.headers = {
				'Content-Type' : 'application/x-www-form-urlencoded'
			};
			reqConf.method = 'POST';
			reqConf.body = this.postData;

		}

		this.request = await fetch(this.url, reqConf);
		this.response = await this.request.json();

		if( this.response && this.response.context && this.response.data && parseInt(this.response.context.code) === 200)
			return this.response;

		throw "Invalid response from blockchair";

	}

	static async json( url, postData ){

		const out = new this( url, postData );
		try{

			await out.exec();
			return out.response;

		}catch(err){
			console.error("Fetch error in request ", out, err);
		}
		return false;

	}

}


module.exports = DogeLib;

const nacl = require('tweetnacl')
const jwt = require("jsonwebtoken")
const {Connection, clusterApiUrl, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction, Keypair, PublicKey} = require('@solana/web3.js');
const bs58 = require('bs58')
const RPSGAMEUSERModel = require("../models/rpsgame_user.model")
const RPSGAMEMYSTERYPLAYERModel = require("../models/rpsgame_mysteryplayer.model")
const RPSGAMEROOMModel = require('../models/rpsgame_room.model')
const RPSGAMELOGModel = require('../models/rpsgame_log.model')

const AMOUNT = [250000000, 500000000, 1000000000, 1250000000, 1500000000, 2000000000]
// let conn = new Connection(clusterApiUrl("devnet"))
const secretWallet = Keypair.fromSecretKey(Uint8Array.from([
	75,106,60,106,194,169,148,20,49,235,93,194,166,171,107,107,
	181,75,161,103,82,251,9,31,173,201,65,138,179,124,91,176,12,
	249,150,66,39,61,77,97,39,48,98,137,53,11,167,61,56,91,156,
	196,111,252,75,203,205,226,153,101,69,99,204,24]))
let conn = new Connection("https://wandering-frosty-surf.solana-mainnet.quiknode.pro/cd3964d6c120b94460e242604421ed8931bee8f3/")

const confirmOption = {commitment : 'finalized',preflightCommitment : 'finalized',skipPreflight : false}

class RPSGAMEService{
	constructor(){
	}

	static async getLog(){
		try{
			let result = await RPSGAMELOGModel.getRecent(10)
			return {response : true, data : result}
		}catch(err){
			return {response : false, status : 0}
		}
	}

	static async getNonce(rawData){
		try{
			let result = await RPSGAMEUSERModel.find({wallet : rawData.wallet})
			if(result.error) throw new Error("Find Error")
			let userData;
			if(result.length === 0){
				await RPSGAMEUSERModel.create(rawData.wallet)
				userData=await RPSGAMEUSERModel.findOne({wallet : rawData.wallet})
			}else{
				userData = result[0]
			}
			let nonce = Math.floor(Math.random() * (2**32))
			let updateResult = await RPSGAMEUSERModel.update({nonce : nonce},rawData.wallet)
			if(updateResult.error) throw new Error("Update Error")
			return {response : true, message : "success", nonce : nonce}
		}catch(err){
			console.log(err)
			return {response : false, message : 'nonce error'}
		}
	}

	static async signIn(rawData){
		try{
			let result = await RPSGAMEUSERModel.find({wallet : rawData.wallet})
			if(result.error || result.length===0) throw new Error("Find Error")
			let userData = result[0]
			let message = `Sign this message from authentication with your wallet. Nonce : ${userData.nonce}`
			const data = new TextEncoder().encode(message)
			let isSigned = nacl.sign.detached.verify(data, bs58.decode(rawData.signature), bs58.decode(rawData.wallet))
			if(!isSigned) throw new Error("Sign signature Error")
			const token=jwt.sign({wallet : rawData.wallet, nonce : userData.nonce}, process.env.SECRET_JWT,{expiresIn:"24h"})
			userData.token = token;
			return {response : true, message : "signin success", data : userData}
		}catch(err){
			console.log(err)
			return {response : false, message : 'signin error'}
		}
	}
	
	static async getWallet(rawData){
		try{
			let result = await RPSGAMEUSERModel.find({wallet : rawData.wallet})
			if(result.error || result.length==0) throw new Error("Find Error")
			return {response : true, message : 'success', data : {amount : result[0].amount}}
		}catch(err){
			return {response : false, message : 'find error', data : {amount : 0}}
		}
	}

	static async getStatus(rawData){
		try{
			let result = await RPSGAMEMYSTERYPLAYERModel.find({wallet : rawData.wallet})
			if(result.error || result.length==0) return {response : true, status : 0}
			if(result[0].status === 0) return {response : true, status : 1}
			if(result[0].status === 1) return {response : true, status : 2, roomID : result[0].roomID}
			if(result[0].status === 3) return {response : true, status : 3}
		}catch(err){
			return {response : false, status : 0}
		}
	}

	static async getAvailable(){
		try{
			let result = [0,0,0,0,0,0]
			for(let i=0; i<6; i++){
				result[i] = await RPSGAMEMYSTERYPLAYERModel.getAvailable(AMOUNT[i])
			}
			return {response : true, data : result}
		}catch(err){
			return {response : false}
		}
	}

	static async getInvitation(rawData){
		try{
			let inviter = await RPSGAMEMYSTERYPLAYERModel.find({id : rawData.inviteId})
			if(inviter.error || inviter.length===0) throw new Error("Invite Error")
			if(inviter[0].status !== 3) throw new Error("Invite status error")
			return {response : true, data : inviter[0]}
		}catch(err){
			return {response : false}
		}
	}

	static async deposit(rawData){
		try{
			if(!rawData.wallet) throw Error("No Wallet")
			let result = await RPSGAMEUSERModel.find({wallet : rawData.wallet})
			if(result.error || result.length===0) throw new Error("Find Error")
			let userData = result[0]
			let hash = await conn.sendRawTransaction(rawData.transaction)
			await conn.confirmTransaction(hash)
			let verify=null;
			while(verify==null){
				try{
					verify=await conn.getTransaction(hash, {commitment : "finalized"})
				}catch(err){

				}
			}
			if(verify.transaction.message.accountKeys[0].toBase58() != rawData.wallet)
				throw new Error("Sender Error")
			if(verify.transaction.message.accountKeys[1].toBase58() != secretWallet.publicKey.toBase58())
				throw new Error("Receiver Error")
			if(verify.meta.postBalances[1]-verify.meta.preBalances[1] !== rawData.amount)
				throw new Error("Invalid Transaction")
			
			userData.amount += rawData.amount
			let updateResult = await RPSGAMEUSERModel.update(userData, rawData.wallet)
			if(updateResult.error) throw new Error("Update Error")
			return {response : true, message : "success"}
		}catch(err){
			console.log(err)
			return {response : false, message : "deposit error"}
		}
	}

	static async preWithdraw(rawData){
		try{
			if(!rawData.wallet) throw Error("No Wallet")
			let result = await RPSGAMEUSERModel.find({wallet : rawData.wallet})
			if(result.error || result.length===0) throw new Error("Find Error")
			if(result[0].prewithdraw !== 0) throw new Error("Status Error")
			let nonce = Math.floor(Math.random() * (2**32))
			let updateResult = await RPSGAMEUSERModel.update({withdraw_nonce : nonce, prewithdraw : 1},rawData.wallet)
			if(updateResult.error) throw new Error("Update Error")
			return {response : true, message : "success", nonce : nonce}
		}catch(err){
			console.log(err)
			return {response : false, message : 'nonce error'}
		}
	}

	static async withdraw(rawData){
		try{
			let result = await RPSGAMEUSERModel.find({wallet : rawData.wallet})
			if(result.error || result.length==0) throw new Error("Find Error")
			let userData = result[0]
			if(userData.prewithdraw === 0) throw new Error("Not found prewithdraw")
			let message = `Withdraw Request : ${userData.withdraw_nonce}`
			const data = new TextEncoder().encode(message)
			let isSigned = nacl.sign.detached.verify(data, bs58.decode(rawData.signature), bs58.decode(rawData.wallet))
			console.log(isSigned)
			if(!isSigned) throw new Error("Sign signature Error")
			if(userData.amount < rawData.amount) throw new Error("Amount Error")
			let transaction = new Transaction()
			let lamports = Number(rawData.amount)
			if(lamports == 0) throw new Error("Amount Error")
			transaction.add(SystemProgram.transfer({
				fromPubkey : secretWallet.publicKey,
				toPubkey : new PublicKey(rawData.wallet),
				lamports : lamports
			}))
			let hash = await sendAndConfirmTransaction(conn, transaction, [secretWallet], confirmOption)
			console.log(hash)
			let verify = null;
			while(verify==null){
				try{
					verify=await conn.getTransaction(hash, {commitment : "finalized"})
				}catch(err){

				}
			}
			if(verify.meta.postBalances[1]-verify.meta.preBalances[1] !== rawData.amount)
				throw new Error("Invalid Transaction")

			userData.amount -= lamports
			userData.prewithdraw = 0
			let failed = true
			while(failed){
				let updateResult = await RPSGAMEUSERModel.update(userData, rawData.wallet)
				if(!updateResult.error) failed=false 
			}
			return {response : true, message : "success"}
		}catch(err){
			console.log(err)
			let failed = true
			while(failed){
				let updateResult = await RPSGAMEUSERModel.update({preWithdraw : 0}, rawData.wallet)
				if(!updateResult.error) failed=false 
			}
			return {response : false, message: "withdraw error"}
		}
	}

	static async startMystery(rawData){
		try{
			if(rawData.amount > 4*LAMPORTS_PER_SOL) throw new Error("Invalid Amount")
			let result = await RPSGAMEMYSTERYPLAYERModel.find({wallet : rawData.wallet})
			if(result.error || result.length!=0) throw new Error("Find Error")
			let userResult = await RPSGAMEUSERModel.find({wallet : rawData.wallet})
			if(userResult.error || userResult.length==0) throw new Error("Find Error")
			if(userResult[0].amount < rawData.amount) throw new Error("Amount Error")
			
			if(rawData.name==="") throw new Error("Invalid Name")
			if(rawData.name.length > 20) throw new Error("Name is too long")
			let name = rawData.name.replace(/[^\w ]/g, '')
			
			await RPSGAMEMYSTERYPLAYERModel.create(rawData.wallet)
			await RPSGAMEMYSTERYPLAYERModel.update({wallet : rawData.wallet, amount : rawData.amount, name : name, status : 0, roomID : 0}, rawData.wallet)
			await RPSGAMEUSERModel.update({amount : userResult[0].amount - rawData.amount}, rawData.wallet)
			return {response : true, message : "please wait"}
		}catch(err){
			console.log(err)
			return {response : false, message:"start error"}
		}
	}

	static async startInvite(rawData){
		try{
			if(rawData.amount > 4*LAMPORTS_PER_SOL) throw new Error("Invalid Amount")
			let result = await RPSGAMEMYSTERYPLAYERModel.find({wallet : rawData.wallet})
			if(result.error || result.length!=0) throw new Error("Find Error")
			let userResult = await RPSGAMEUSERModel.find({wallet : rawData.wallet})
			if(userResult.error || userResult.length==0) throw new Error("Find Error")
			if(userResult[0].amount < rawData.amount) throw new Error("Amount Error")

			if(rawData.name==="") throw new Error("Invalid Name")
			if(rawData.name.length > 20) throw new Error("Name is too long")
			let name = rawData.name.replace(/[^\w ]/g, '')

			let waitingRoom = await RPSGAMEMYSTERYPLAYERModel.create(rawData.wallet)
			await RPSGAMEMYSTERYPLAYERModel.update({wallet : rawData.wallet, amount : rawData.amount, name : name, status : 3, roomID : 0}, rawData.wallet)
			await RPSGAMEUSERModel.update({amount : userResult[0].amount - rawData.amount}, rawData.wallet)
			return {response : true, message : "please wait", data : {id : waitingRoom.insertId}}
		}catch(err){
			console.log(err)
			return {response : false, message : "invite error"}
		}
	}

	static async acceptInvite(rawData){
		try{
			if(rawData.name==="") throw new Error("Invalid Name")
			if(rawData.name.length > 20) throw new Error("Name is too long")
			let name = rawData.name.replace(/[^\w ]/g, '')


			let result = await RPSGAMEMYSTERYPLAYERModel.find({wallet : rawData.wallet})
			if(result.error || result.length!==0) throw new Error("Find Error")
			let inviter = await RPSGAMEMYSTERYPLAYERModel.find({id : rawData.inviteId})
			if(inviter.error || inviter.length===0) throw new Error("Invite Error")
			if(inviter[0].status !== 3) throw new Error("Invite status error")
			let userResult = await RPSGAMEUSERModel.find({wallet : rawData.wallet})
			if(userResult.error || userResult.length==0) throw new Error("Find Error")
			if(userResult[0].amount < inviter[0].amount) throw new Error("Amount Error")
			let newRoom = await RPSGAMEROOMModel.create({
				wallet1 : inviter[0].wallet, name1 : inviter[0].name, wallet2 : rawData.wallet, name2 : name, amount : inviter[0].amount
			})
			await RPSGAMEMYSTERYPLAYERModel.update({status : 1, roomID : newRoom.insertId}, inviter[0].wallet)
			await RPSGAMEMYSTERYPLAYERModel.create(rawData.wallet)
			await RPSGAMEMYSTERYPLAYERModel.update({amount : inviter[0].amount, name : name, status : 1, roomID : newRoom.insertId},rawData.wallet)
			await RPSGAMEUSERModel.update({amount : userResult[0].amount - inviter[0].amount}, rawData.wallet)
			return {response : true, message : "create room"}
		}catch(err){
			console.log(err)
			return {response : false, message : "accept invitation error"}
		}
	}

	static async cancelMystery(rawData){
		try{
			let result = await RPSGAMEMYSTERYPLAYERModel.find({wallet : rawData.wallet})
			if(result.error || result.length==0) throw new Error("Find Error")
			let userResult = await RPSGAMEUSERModel.find({wallet : rawData.wallet})
			if(userResult.error || userResult.length==0) throw new Error("Find Error")
			if(result[0].status===1){
				throw new Error("You have already started")
			}
			await RPSGAMEUSERModel.update({amount : userResult[0].amount + result[0].amount},rawData.wallet)
			await RPSGAMEMYSTERYPLAYERModel.delete({wallet : rawData.wallet})
			return {response : true, message : "cancel success"}
		}catch(err){
			console.log(err)
			return {response : false, message : "cancel error"}
		}
	}

	static async findMatch(rawData){
		try{
			let result1 = await RPSGAMEMYSTERYPLAYERModel.find({wallet : rawData.wallet})
			if(result1.error || result1.length==0) throw new Error("Find Error")
			if(result1[0].status!=0){
				return {response : true, message : "room created", data : {roomID : result1[0].roomID}}
			}
			let result2 = await RPSGAMEMYSTERYPLAYERModel.findMatch(rawData.wallet, result1[0].amount)
			if(result2.error || result2.length<=1) throw new Error("Find Error")
			const others = result2.filter((item)=>{return item.wallet != rawData.wallet})
			let result = await RPSGAMEROOMModel.create({
				wallet1 : result1[0].wallet, name1 : result1[0].name,
				wallet2 : others[0].wallet, name2 : others[0].name,
				amount : result1[0].amount
			})
			if(result.error) throw new Error("Create Room Error")
			await RPSGAMEMYSTERYPLAYERModel.update({...result1[0], status : 1, roomID : result.insertId}, result1[0].wallet)
			await RPSGAMEMYSTERYPLAYERModel.update({...others[0], status : 1, roomID : result.insertId}, others[0].wallet)
			return {response : true, message : "room created", data : {roomID : result.insertId}}
		}catch(err){
			return {response : false, message : "not found"}
		}
	}

	static async getGameState(rawData){
		try{
			let result = await RPSGAMEROOMModel.find({id : rawData.roomId})
			if(result.error || result.length==0) throw new Error("Find Error")
			let gameState = result[0]
			let data = {};
			let currentTurn, mySelect, opSelect, myName, opName;
			if(gameState.wallet1 == rawData.wallet){
				return {response : true, message : "success", data:{
					myName : gameState.name1, myWinCount : gameState.win_count1, myLastSelect : gameState.last_select1, mySel : gameState.current_select1,
					opName : gameState.name2, opWinCount : gameState.win_count2, opLastSelect : gameState.last_select2, opSel : 0,
					ended : gameState.ended, amount : gameState.amount
				}}
			}else if(gameState.wallet2 == rawData.wallet){
				return {response : true, message : "success", data:{
					myName : gameState.name2, myWinCount : gameState.win_count2, myLastSelect : gameState.last_select2, mySel : gameState.current_select2,
					opName : gameState.name1, opWinCount : gameState.win_count1, opLastSelect : gameState.last_select1, opSel : 0,
					ended : gameState.ended, amount : gameState.amount
				}}
			}else{
				throw new Error("invalid wallet")
			}
		}catch(err){
			console.log(err)
			return {response : false, message : "not found"}
		}
	}

	static getGameResult(mySel, opSel){
		if(mySel===0 || opSel===0) return 0
		if(mySel===opSel) return 0
		if((mySel===1 && opSel===3) || (mySel===2 && opSel===1) || (mySel===3 && opSel===2)) return 1
		return 2
	}

	static async transferFee(gameState){
		let treasuryWallet_1 = process.env.TREASURY_WALLET_1
		let treasuryWallet_2 = process.env.TREASURY_WALLET_2
		let treasuryWallet_3 = process.env.TREASURY_WALLET_3
		let treasuryWallet_4 = process.env.TREASURY_WALLET_4
		let fee_1 = gameState.amount * process.env.FEE_AMOUNT_1 * 2
		let fee_2 = gameState.amount * process.env.FEE_AMOUNT_2 * 2
		let fee_3 = gameState.amount * process.env.FEE_AMOUNT_3 * 2
		let fee_4 = gameState.amount * process.env.FEE_AMOUNT_4 * 2
		try{
			let transaction = new Transaction()
			transaction.add(SystemProgram.transfer({
				fromPubkey : secretWallet.publicKey,
				toPubkey : new PublicKey(treasuryWallet_1),
				lamports : fee_1
			}))
			transaction.add(SystemProgram.transfer({
				fromPubkey : secretWallet.publicKey,
				toPubkey : new PublicKey(treasuryWallet_2),
				lamports : fee_2
			}))
			transaction.add(SystemProgram.transfer({
				fromPubkey : secretWallet.publicKey,
				toPubkey : new PublicKey(treasuryWallet_3),
				lamports : fee_3
			}))
			transaction.add(SystemProgram.transfer({
				fromPubkey : secretWallet.publicKey,
				toPubkey : new PublicKey(treasuryWallet_4),
				lamports : fee_4
			}))
			let hash = await sendAndConfirmTransaction(conn, transaction, [secretWallet], confirmOption)
			console.log("transferFee success!   ", hash)
		} catch(err) {
			console.log("failed")
			try{
				let feeReceiver_1;
				let feeReceiverResult_1 = await RPSGAMEUSERModel.find({wallet : treasuryWallet_1})
				if(feeReceiverResult_1.length===0 || feeReceiverResult_1.error){
					await RPSGAMEUSERModel.create(treasuryWallet_1)
					feeReceiver_1 = await RPSGAMEUSERModel.findOne({wallet : treasuryWallet_1})
				}else{
					feeReceiver_1 = feeReceiverResult_1[0]
				}

				let feeReceiver_2;
				let feeReceiverResult_2 = await RPSGAMEUSERModel.find({wallet : treasuryWallet_2})
				if(feeReceiverResult_2.length===0 || feeReceiverResult_2.error){
					await RPSGAMEUSERModel.create(treasuryWallet_2)
					feeReceiver_2 = await RPSGAMEUSERModel.findOne({wallet : treasuryWallet_2})
				}else{
					feeReceiver_2 = feeReceiverResult_2[0]
				}

				let feeReceiver_3;
				let feeReceiverResult_3 = await RPSGAMEUSERModel.find({wallet : treasuryWallet_3})
				if(feeReceiverResult_3.length===0 || feeReceiverResult_3.error){
					await RPSGAMEUSERModel.create(treasuryWallet_3)
					feeReceiver_3 = await RPSGAMEUSERModel.findOne({wallet : treasuryWallet_3})
				}else{
					feeReceiver_3 = feeReceiverResult_3[0]
				}

				let feeReceiver_4;
				let feeReceiverResult_4 = await RPSGAMEUSERModel.find({wallet : treasuryWallet_4})
				if(feeReceiverResult_4.length===0 || feeReceiverResult_4.error){
					await RPSGAMEUSERModel.create(treasuryWallet_4)
					feeReceiver_4 = await RPSGAMEUSERModel.findOne({wallet : treasuryWallet_4})
				}else{
					feeReceiver_4 = feeReceiverResult_4[0]
				}
				await RPSGAMEUSERModel.update({amount : feeReceiver_1.amount + fee_1}, treasuryWallet_1)
				await RPSGAMEUSERModel.update({amount : feeReceiver_2.amount + fee_2}, treasuryWallet_2)
				await RPSGAMEUSERModel.update({amount : feeReceiver_3.amount + fee_3}, treasuryWallet_3)
				await RPSGAMEUSERModel.update({amount : feeReceiver_4.amount + fee_4}, treasuryWallet_4)
			}catch(err){
				console.log("site deposit error after transfer failed")
			}
		}
	}

	static async submitRps(rawData){
		try{
			if(rawData.item!=1 && rawData.item!=2 && rawData.item!=3) throw new Error("Item Invalid")
			let result = await RPSGAMEROOMModel.find({id : rawData.roomId})
			let currentTurn;
			if(result.error || result.length==0) throw new Error("Find Error")
			let gameState = result[0]
			if(gameState.ended===1) throw new Error("game ended")
			if(gameState.wallet1 == rawData.wallet){
				if(gameState.current_select1 != 0) throw new Error("already submitted")
				gameState.current_select1 = rawData.item
			}else if(gameState.wallet2 == rawData.wallet){
				gameState.current_select2 = rawData.item
			}else throw new Error("invalid wallet")
			if(gameState.current_select1 !=0 && gameState.current_select2 !=0){
				let gameResult = this.getGameResult(gameState.current_select1, gameState.current_select2)
				if(gameResult==1){
					gameState.win_count1++;
				}else if(gameResult==2){
					gameState.win_count2++;
				}
				gameState.last_select1 = gameState.current_select1
				gameState.current_select1 = 0
				gameState.last_select2 = gameState.current_select2
				gameState.current_select2 = 0
				if(gameState.win_count1==2 || gameState.win_count2==2){
					gameState.ended = 1
					await RPSGAMEROOMModel.update({...gameState}, rawData.roomId)
					let user1 = (await RPSGAMEUSERModel.find({wallet : gameState.wallet1}))[0]
					let user2 = (await RPSGAMEUSERModel.find({wallet : gameState.wallet2}))[0]

					let fee = gameState.amount * 0.042

					
					if(gameState.win_count1==2){
						await RPSGAMEUSERModel.update({amount : user1.amount + gameState.amount*2 - fee*2}, gameState.wallet1)
						await RPSGAMELOGModel.create({roomId : gameState.id, result : 1,winnerWallet : gameState.wallet1, winnerName : gameState.name1, loserWallet : gameState.wallet2, loserName : gameState.name2, amount : gameState.amount})
					}else{
						await RPSGAMEUSERModel.update({amount : user2.amount + gameState.amount*2 - fee*2}, gameState.wallet2)
						await RPSGAMELOGModel.create({roomId : gameState.id, result : 1,winnerWallet : gameState.wallet2, winnerName : gameState.name2, loserWallet : gameState.wallet1, loserName : gameState.name1, amount : gameState.amount})
					}
					this.transferFee(gameState)
					await RPSGAMEMYSTERYPLAYERModel.delete({wallet : gameState.wallet1})
					await RPSGAMEMYSTERYPLAYERModel.delete({wallet : gameState.wallet2})

				}else{
					await RPSGAMEROOMModel.update({...gameState}, rawData.roomId)
				}
			}else{
				await RPSGAMEROOMModel.update({current_select1 : gameState.current_select1, current_select2 : gameState.current_select2}, rawData.roomId)
			}
			return {response : true, message : "submit success"}
		}catch(err){
			console.log(err)
			return {response : false, message : "submit failed"}
		}
	}
}

module.exports = RPSGAMEService
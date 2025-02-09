import { AptosAccount, AptosClient, HexString } from "aptos";
import dotenv from 'dotenv';

dotenv.config();

const NODE_URL = "https://fullnode.testnet.aptoslabs.com";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

interface AptosError {
    message?: string;
}

interface BetSession {
    roundId: number;
    betAmount: string;
    targetMultiplier: string;
    initialBalance: number;
}

function getRandomBetAmount(): string {
    const min = 1000000;   // 0.01 APT
    const max = 10000000;  // 0.1 APT
    const amount = Math.floor(Math.random() * (max - min + 1)) + min;
    return amount.toString();
}

function getRandomMultiplier(): string {
    return (Math.random() * 0.9 + 1.1).toFixed(2); // Random between 1.1 and 2.0
}

async function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getBalance(client: AptosClient, address: string): Promise<number> {
    const resource = await client.getAccountResource(
        address,
        "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>"
    );
    return Number((resource.data as any).coin.value);
}

async function cashout(client: AptosClient, account: AptosAccount) {
    const payload = {
        type: "entry_function_payload",
        function: `${CONTRACT_ADDRESS}::crash::cashout`,
        type_arguments: [],
        arguments: []
    };

    try {
        const txnRequest = await client.generateTransaction(account.address(), payload);
        const signedTxn = await client.signTransaction(account, txnRequest);
        const txnResult = await client.submitTransaction(signedTxn);
        console.log("Cashout submitted:", txnResult.hash);
        await client.waitForTransaction(txnResult.hash);
        return true;
    } catch (error: unknown) {
        const aptosError = error as AptosError;
        console.log("Failed to cashout:", aptosError.message || "Unknown error");
        return false;
    }
}

async function placeBet(client: AptosClient, account: AptosAccount, amount: string): Promise<boolean> {
    try {
        const payload = {
            type: "entry_function_payload",
            function: `${CONTRACT_ADDRESS}::crash::place_bet`,
            type_arguments: [],
            arguments: [amount]
        };

        const txnRequest = await client.generateTransaction(account.address(), payload);
        const signedTxn = await client.signTransaction(account, txnRequest);
        const txnResult = await client.submitTransaction(signedTxn);
        await client.waitForTransaction(txnResult.hash);
        console.log("Bet placed successfully! Hash:", txnResult.hash);
        return true;
    } catch (error: unknown) {
        const aptosError = error as AptosError;
        console.log("Failed to place bet:", aptosError.message || "Unknown error");
        return false;
    }
}

async function main() {
    const privateKey = process.env.APTOS_PRIVATE_KEY_2;
    if (!privateKey) throw new Error("APTOS_PRIVATE_KEY_2 not found in .env");
    
    const account = new AptosAccount(new HexString(privateKey).toUint8Array());
    const client = new AptosClient(NODE_URL);

    console.log("Account address:", account.address().hex());
    console.log("\n🎮 Starting auto-bet session...");

    let currentSession: BetSession | null = null;
    let roundsPlayed = 0;
    let roundsWon = 0;
    let roundsLost = 0;
    let totalProfit = 0;

    while (true) {
        try {
            const currentRoundId = Number((await client.view({
                function: `${CONTRACT_ADDRESS}::crash::get_current_round_id`,
                type_arguments: [],
                arguments: []
            }))[0]);

            const roundData = await client.view({
                function: `${CONTRACT_ADDRESS}::crash::get_round_data`,
                type_arguments: [],
                arguments: [currentRoundId.toString()]
            });
            const [id, startTime, crashPoint, crashed] = roundData;
            const currentTime = Math.floor(Date.now() / 1000);

            // No active bet, look for betting window
            if (!currentSession && !crashed && currentTime < Number(startTime)) {
                const betAmount = getRandomBetAmount();
                const targetMultiplier = getRandomMultiplier();
                const currentBalance = await getBalance(client, account.address().hex());

                console.log("\n🎲 New betting round:");
                console.log(`Round ID: ${currentRoundId}`);
                console.log(`Bet Amount: ${Number(betAmount)/100000000} APT`);
                console.log(`Target Multiplier: ${targetMultiplier}x`);
                console.log(`Current Balance: ${currentBalance/100000000} APT`);

                if (await placeBet(client, account, betAmount)) {
                    currentSession = {
                        roundId: currentRoundId,
                        betAmount,
                        targetMultiplier,
                        initialBalance: currentBalance
                    };
                    roundsPlayed++;
                }
            } 
            // Have active bet, monitor for cashout
            else if (currentSession && !crashed && currentTime >= Number(startTime)) {
                const timeElapsed = currentTime - Number(startTime);
                const currentMultiplier = 1 + (timeElapsed * 0.1);
                
                if (currentMultiplier >= Number(currentSession.targetMultiplier)) {
                    console.log(`\n💰 Target multiplier ${currentSession.targetMultiplier}x reached!`);
                    if (await cashout(client, account)) {
                        const finalBalance = await getBalance(client, account.address().hex());
                        const profit = (finalBalance - currentSession.initialBalance) / 100000000;
                        totalProfit += profit;
                        roundsWon++;
                        
                        console.log("✅ Round Won!");
                        console.log(`Profit: ${profit.toFixed(6)} APT`);
                        currentSession = null;
                    }
                }
            }
            // Round crashed
            else if (crashed && currentSession && currentSession.roundId === currentRoundId) {
                console.log(`\n❌ Round ${currentRoundId} Lost!`);
                console.log(`Lost bet: ${Number(currentSession.betAmount)/100000000} APT`);
                totalProfit -= Number(currentSession.betAmount)/100000000;
                roundsLost++;
                currentSession = null;

                // Print session stats
                console.log("\n📊 Session Stats:");
                console.log(`Rounds Played: ${roundsPlayed}`);
                console.log(`Wins: ${roundsWon}`);
                console.log(`Losses: ${roundsLost}`);
                console.log(`Total Profit/Loss: ${totalProfit.toFixed(6)} APT`);
            }

            await wait(100);
        } catch (error: unknown) {
            const aptosError = error as AptosError;
            console.error("Error:", aptosError.message || "Unknown error");
            await wait(500);
        }
    }
}

main().catch(console.error);
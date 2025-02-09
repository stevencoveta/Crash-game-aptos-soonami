import { AptosAccount, AptosClient, HexString } from "aptos";
import dotenv from 'dotenv';

dotenv.config();

const NODE_URL = "https://fullnode.testnet.aptoslabs.com";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const BET_AMOUNT = "10000000"; // 0.01 APT

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

async function main() {
    const privateKey = process.env.APTOS_PRIVATE_KEY_2;
    if (!privateKey) throw new Error("APTOS_PRIVATE_KEY_2 not found in .env");
    
    const account = new AptosAccount(new HexString(privateKey).toUint8Array());
    const client = new AptosClient(NODE_URL);

    console.log("Account address:", account.address().hex());
    console.log("Waiting for next round...");

    while (true) {
        try {
            const currentRoundId = Number((await client.view({
                function: `${CONTRACT_ADDRESS}::crash::get_current_round_id`,
                type_arguments: [],
                arguments: []
            }))[0]);

            // Get current round data
            const roundData = await client.view({
                function: `${CONTRACT_ADDRESS}::crash::get_round_data`,
                type_arguments: [],
                arguments: [currentRoundId.toString()]
            });
            const [id, startTime, crashPoint, crashed] = roundData;
            const currentTime = Math.floor(Date.now() / 1000);

            console.log(`\nCurrent round ${currentRoundId}:`, {
                startTime: Number(startTime),
                currentTime,
                crashed
            });

            if (!crashed && currentTime < Number(startTime)) {
                console.log("Found active betting window!");
                const balanceBefore = await getBalance(client, account.address().hex());
                console.log(`Balance before: ${balanceBefore/100000000} APT`);

                const payload = {
                    type: "entry_function_payload",
                    function: `${CONTRACT_ADDRESS}::crash::place_bet`,
                    type_arguments: [],
                    arguments: [BET_AMOUNT]
                };

                const txnRequest = await client.generateTransaction(account.address(), payload);
                const signedTxn = await client.signTransaction(account, txnRequest);
                const txnResult = await client.submitTransaction(signedTxn);
                
                await client.waitForTransaction(txnResult.hash);
                await wait(2000);

                const balanceAfter = await getBalance(client, account.address().hex());
                const change = (balanceBefore - balanceAfter)/100000000;

                if (change >= 1.0) {
                    console.log("✅ Bet placed successfully!");
                    console.log(`Balance change: -${change} APT`);
                    console.log(`Transaction: ${txnResult.hash}`);
                    break;
                }
            }
            await wait(200);
        } catch (error: any) {
            console.error("Error:", error.message || error);
            await wait(500);
        }
    }
}

main().catch(console.error);
import { AptosClient, AptosAccount, HexString, Types } from "aptos";
import dotenv from "dotenv";

dotenv.config();

const NODE_URL = process.env.NODE_URL || "https://fullnode.testnet.aptoslabs.com/v1";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const BETTING_WINDOW = 10; // 10 seconds for betting
const COOLDOWN_PERIOD = 5; // 5 seconds cooldown

async function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getRoundData(client: AptosClient, roundId: any) {
    try {
        const roundData = await client.view({
            function: `${CONTRACT_ADDRESS}::crash::get_round_data`,
            type_arguments: [],
            arguments: [roundId.toString()]
        });
        return roundData;
    } catch (error) {
        console.error("Error getting round data:", error);
        throw error;
    }
}

async function processRound(client: AptosClient, account: AptosAccount) {
    try {
        const payload: Types.TransactionPayload = {
            type: "entry_function_payload",
            function: `${CONTRACT_ADDRESS}::crash::process_round`,
            type_arguments: [],
            arguments: []
        };

        const rawTxn = await client.generateTransaction(account.address(), payload);
        const bcsTxn = await client.signTransaction(account, rawTxn);
        const pendingTxn = await client.submitTransaction(bcsTxn);
        console.log("Process round transaction submitted:", pendingTxn.hash);
        
        await client.waitForTransaction(pendingTxn.hash, { timeoutSecs: 20 });
        console.log("Process round transaction confirmed");
        return pendingTxn.hash;
    } catch (error) {
        console.error("Error processing round:", error);
        throw error;
    }
}

async function getCurrentRoundId(client: AptosClient): Promise<number> {
    const result = await client.view({
        function: `${CONTRACT_ADDRESS}::crash::get_current_round_id`,
        type_arguments: [],
        arguments: []
    });
    return Number(result[0]);
}

async function main() {
    if (!process.env.APTOS_PRIVATE_KEY) {
        throw new Error("Missing APTOS_PRIVATE_KEY in .env file");
    }

    while (true) {
        try {
            console.log("\nStarting crash game state monitor...");

            const client = new AptosClient(NODE_URL);
            const account = new AptosAccount(
                HexString.ensure(process.env.APTOS_PRIVATE_KEY as string).toUint8Array()
            );

            console.log("Monitor running with address:", account.address().hex());

            while (true) {
                console.log("\n=== ROUND START ===");

                // Get current round ID
                const currentRoundId = await getCurrentRoundId(client);
                console.log(`Round ID: ${currentRoundId}`);

                // Get initial round data
                const roundData = await getRoundData(client, currentRoundId);
                const [id, startTime, crashPoint, crashed] = roundData as [any, any, any, boolean];
                
                if (crashed) {
                    console.log("Previous round crash point:", Number(crashPoint) / 100, "x");
                    console.log("Round already crashed, processing and moving to next round...");
                    await processRound(client, account);
                    
                    // Show cooldown timer and wait for next round
                    console.log("\n=== COOLDOWN PERIOD ===");
                    let timerStart = Math.floor(Date.now() / 1000);
                    while (true) {
                        try {
                            const newRoundId = await getCurrentRoundId(client);
                            if (newRoundId > currentRoundId) {
                                console.log("\nNew round starting...");
                                break;
                            }
                            
                            const elapsedTime = Math.floor(Date.now() / 1000) - timerStart;
                            process.stdout.write(`\rCooldown: ${elapsedTime}s elapsed`);
                            await wait(1000);
                        } catch (error) {
                            console.error("Error during cooldown:", error);
                            await wait(1000);
                        }
                    }
                    continue;
                }

                let monitoring = true;
                let lastMultiplier = 0;
                let roundStartTime = Number(startTime);
                
                // Show betting window timer
                const currentTime = Math.floor(Date.now() / 1000);
                const bettingEndTime = roundStartTime;
                
                if (currentTime < bettingEndTime) {
                    console.log("\n=== BETTING PERIOD ===");
                    while (Math.floor(Date.now() / 1000) < bettingEndTime) {
                        const timeRemaining = bettingEndTime - Math.floor(Date.now() / 1000);
                        process.stdout.write(`\rBetting window: ${timeRemaining}s remaining`);
                        await wait(1000);
                    }
                    console.log("\nBetting period ended");
                }
                
                while (monitoring) {
                    try {
                        // Get latest round data to check for crash
                        const updatedRoundData = await getRoundData(client, currentRoundId);
                        const [_, __, ___, isCrashed] = updatedRoundData as [any, any, any, boolean];

                        if (isCrashed) {
                            const finalRoundData = await getRoundData(client, currentRoundId);
                            const finalCrashPoint = Number(finalRoundData[2]) / 100;
                            const duration = (Date.now() / 1000 - roundStartTime).toFixed(1);
                            console.log(`\n\n💥 CRASHED at ${finalCrashPoint.toFixed(2)}x after ${duration}s`);
                            
                            console.log("Processing round end...");
                            const txHash = await processRound(client, account);
                            console.log("Transaction hash:", txHash);
                            
                            console.log("\n⏱️  Waiting for round transition...");
                            let retryCount = 0;
                            let roundTransitioned = false;
                            
                            while (!roundTransitioned && retryCount < 5) {
                                await wait(3000);
                                const newRoundId = await getCurrentRoundId(client);
                                
                                if (newRoundId > currentRoundId) {
                                    console.log(`✨ Successfully transitioned to round ${newRoundId}`);
                                    roundTransitioned = true;
                                    monitoring = false;
                                } else {
                                    console.log(`⏳ Waiting for round transition (attempt ${retryCount + 1}/5)...`);
                                    retryCount++;
                                    
                                    if (retryCount === 5) {
                                        console.log("⚠️ Round transition failed after 5 attempts");
                                        monitoring = false;
                                    }
                                }
                            }
                            break;
                        }

                        const currentTime = Math.floor(Date.now() / 1000);
                        if (currentTime < roundStartTime) {
                            await wait(1000);
                            continue;
                        }

                        const timeElapsed = currentTime - roundStartTime;
                        let baseIncrement = 1;
                        const scaleFactor = 1 + Math.floor(timeElapsed / 10);
                        let currentMultiplier = 100;

                        for (let i = 0; i < timeElapsed; i++) {
                            baseIncrement = baseIncrement + Math.floor(currentMultiplier / 1000);
                            currentMultiplier = currentMultiplier + (baseIncrement * scaleFactor);
                        }

                        const multiplierValue = currentMultiplier / 100;

                        if (multiplierValue > lastMultiplier) {
                            process.stdout.write(`\rMultiplier: ${multiplierValue.toFixed(2)}x`);
                            lastMultiplier = multiplierValue;
                        }

                        await wait(100);
                    } catch (error) {
                        console.error("\nMonitoring error:", error);
                        await wait(1000);
                    }
                }
            }
        } catch (error) {
            console.error("\nMain loop error:", error);
            await wait(5000);
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
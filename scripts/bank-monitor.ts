import { AptosClient } from "aptos";
import dotenv from 'dotenv';

dotenv.config();

const NODE_URL = "https://fullnode.testnet.aptoslabs.com";
const CONTRACT_ADDRESS = "0xf065c95b117243e8d8cc91562bb1db8184914e00f0cd35781cb31f43d302a8f2";

interface RoundStats {
    roundId: number;
    totalBets: number;
    totalPayouts: number;
    profit: number;
    betCount: number;
    cashoutCount: number;
    participants: Set<string>;
    crashPoint?: number;
}

async function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCurrentRoundStats(client: AptosClient, roundId: number): Promise<RoundStats> {
    const stats: RoundStats = {
        roundId,
        totalBets: 0,
        totalPayouts: 0,
        profit: 0,
        betCount: 0,
        cashoutCount: 0,
        participants: new Set()
    };

    // Get bets for current round
    const betEvents = await client.getEventsByEventHandle(
        CONTRACT_ADDRESS,
        `${CONTRACT_ADDRESS}::crash::CrashGameState`,
        "bet_events",
        { limit: 50 }
    );

    // Get cashouts for current round
    const cashoutEvents = await client.getEventsByEventHandle(
        CONTRACT_ADDRESS,
        `${CONTRACT_ADDRESS}::crash::CrashGameState`,
        "cashout_events",
        { limit: 50 }
    );

    // Process bets
    for (const event of betEvents) {
        if (Number(event.data.round_id) === roundId) {
            const amount = Number(event.data.amount) / 100000000;
            stats.totalBets += amount;
            stats.betCount += 1;
            stats.participants.add(event.data.player);
        }
    }

    // Process cashouts
    for (const event of cashoutEvents) {
        if (Number(event.data.round_id) === roundId) {
            const amount = Number(event.data.win_amount) / 100000000;
            stats.totalPayouts += amount;
            stats.cashoutCount += 1;
        }
    }

    // Get round data
    const roundData = await client.view({
        function: `${CONTRACT_ADDRESS}::crash::get_round_data`,
        type_arguments: [],
        arguments: [roundId.toString()]
    });

    stats.crashPoint = Number(roundData[2]) / 100;
    stats.profit = stats.totalBets - stats.totalPayouts;

    return stats;
}

async function main() {
    const client = new AptosClient(NODE_URL);
    let lastRoundId = 0;
    let lastRoundStats: RoundStats | null = null;

    console.log("Starting bank monitor...");

    while (true) {
        try {
            // Get current round ID
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

            const crashed = roundData[3];
            const stats = await getCurrentRoundStats(client, currentRoundId);

            console.clear();
            console.log(`=== Round ${currentRoundId} ===`);
            console.log(`Time: ${new Date().toLocaleTimeString()}\n`);

            if (crashed) {
                // Show previous round summary during cooldown
                console.log("⏳ Cooldown Period - Previous Round Summary:");
                console.log(`Crash Point: ${stats.crashPoint}x`);
                console.log(`Total Bets: ${stats.totalBets.toFixed(4)} APT`);
                console.log(`Number of Bets: ${stats.betCount}`);
                console.log(`Unique Players: ${stats.participants.size}`);
                console.log(`Total Payouts: ${stats.totalPayouts.toFixed(4)} APT`);
                console.log(`Number of Cashouts: ${stats.cashoutCount}`);
                console.log(`Round Profit: ${stats.profit.toFixed(4)} APT`);
                lastRoundStats = stats;
            } else {
                // Show active round stats
                console.log("🎮 Active Round Stats:");
                console.log(`Total Bets: ${stats.totalBets.toFixed(4)} APT`);
                console.log(`Number of Bets: ${stats.betCount}`);
                console.log(`Active Players: ${stats.participants.size}`);
                if (stats.cashoutCount > 0) {
                    console.log(`Total Payouts: ${stats.totalPayouts.toFixed(4)} APT`);
                    console.log(`Number of Cashouts: ${stats.cashoutCount}`);
                }
            }

            await wait(1000);
        } catch (error) {
            console.error("Error fetching data:", error);
            await wait(2000);
        }
    }
}

main().catch(console.error);
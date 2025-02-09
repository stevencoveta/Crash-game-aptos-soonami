import { AptosClient } from "aptos";
import dotenv from 'dotenv';

dotenv.config();

const NODE_URL = "https://fullnode.testnet.aptoslabs.com";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

interface BetHistory {
    roundId: number;
    betAmount: number;
    cashoutMultiplier?: number;
    winAmount?: number;
    status: 'Won' | 'Lost' | 'Active';
    timestamp: string;
}

// Define a custom type for the event data
interface CrashGameEvent {
    type: string;
    data: {
        player: string;
        round_id: string;
        amount?: string;
        multiplier?: string;
        win_amount?: string;
        crash_point?: string;
    };
    ledger_timestamp?: string;
}

async function getWalletHistory(client: AptosClient, walletAddress: string) {
    const history = new Map<number, BetHistory>();

    // Fetch events and manually map to CrashGameEvent
    const betEvents = (await client.getEventsByEventHandle(
        CONTRACT_ADDRESS!,
        `${CONTRACT_ADDRESS}::crash::CrashGameState`,
        "bet_events",
        { limit: 100 }
    )).map(event => ({
        ...event,
        ledger_timestamp: (event as any).ledger_timestamp
    })) as CrashGameEvent[];

    const cashoutEvents = (await client.getEventsByEventHandle(
        CONTRACT_ADDRESS!,
        `${CONTRACT_ADDRESS}::crash::CrashGameState`,
        "cashout_events",
        { limit: 100 }
    )).map(event => ({
        ...event,
        ledger_timestamp: (event as any).ledger_timestamp
    })) as CrashGameEvent[];

    const roundEvents = (await client.getEventsByEventHandle(
        CONTRACT_ADDRESS!,
        `${CONTRACT_ADDRESS}::crash::CrashGameState`,
        "round_events",
        { limit: 100 }
    )).map(event => ({
        ...event,
        ledger_timestamp: (event as any).ledger_timestamp
    })) as CrashGameEvent[];

    // Process bets
    for (const event of betEvents) {
        if (event.data.player === walletAddress) {
            const timestamp = event.ledger_timestamp 
                ? new Date(Number(event.ledger_timestamp) / 1000).toLocaleString()
                : 'Unknown timestamp';

            history.set(Number(event.data.round_id), {
                roundId: Number(event.data.round_id),
                betAmount: Number(event.data.amount || 0) / 100000000, // Convert to APT
                status: 'Active',
                timestamp: timestamp
            });
        }
    }

    // Process cashouts
    for (const event of cashoutEvents) {
        if (event.data.player === walletAddress) {
            const bet = history.get(Number(event.data.round_id));
            if (bet) {
                bet.cashoutMultiplier = Number(event.data.multiplier || 0) / 100;
                bet.winAmount = Number(event.data.win_amount || 0) / 100000000;
                bet.status = 'Won';
            }
        }
    }

    // Process round ends to mark losses
    const crashPoints = new Map<number, number>();
    for (const event of roundEvents) {
        if (Number(event.data.crash_point || 0) > 0) {
            crashPoints.set(Number(event.data.round_id), Number(event.data.crash_point));
        }
    }

    // Mark losses
    for (const [roundId, bet] of history) {
        if (bet.status === 'Active' && crashPoints.has(roundId)) {
            bet.status = 'Lost';
        }
    }

    return Array.from(history.values()).sort((a, b) => b.roundId - a.roundId);
}

async function main() {
    if (!process.env.WALLET_ADDRESS) {
        throw new Error("Please set WALLET_ADDRESS in .env");
    }

    const client = new AptosClient(NODE_URL);
    console.log(`Fetching betting history for ${process.env.WALLET_ADDRESS}...\n`);

    const history = await getWalletHistory(client, process.env.WALLET_ADDRESS);

    let totalBets = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let profit = 0;

    console.log("=== Betting History ===");
    for (const bet of history) {
        console.log(`\nRound ${bet.roundId}:`);
        console.log(`Time: ${bet.timestamp}`);
        console.log(`Bet Amount: ${bet.betAmount.toFixed(6)} APT`);
        
        if (bet.status === 'Won') {
            console.log(`Cashout Multiplier: ${bet.cashoutMultiplier}x`);
            console.log(`Win Amount: ${bet.winAmount?.toFixed(6)} APT`);
            console.log(`Profit: ${((bet.winAmount || 0) - bet.betAmount).toFixed(6)} APT`);
            console.log("Status: ✅ Won");
            totalWins++;
            profit += (bet.winAmount || 0) - bet.betAmount;
        } else if (bet.status === 'Lost') {
            console.log("Status: ❌ Lost");
            totalLosses++;
            profit -= bet.betAmount;
        } else {
            console.log("Status: 🔄 Active");
        }
        totalBets++;
    }

    console.log("\n=== Summary ===");
    console.log(`Total Rounds: ${totalBets}`);
    console.log(`Wins: ${totalWins}`);
    console.log(`Losses: ${totalLosses}`);
    console.log(`Win Rate: ${((totalWins / totalBets) * 100).toFixed(1)}%`);
    console.log(`Total Profit/Loss: ${profit.toFixed(6)} APT`);
}

main().catch(console.error);
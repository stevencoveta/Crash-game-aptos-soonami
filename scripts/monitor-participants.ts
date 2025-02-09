import { AptosClient } from "aptos";
import dotenv from 'dotenv';

dotenv.config();

const NODE_URL = process.env.NODE_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

async function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

interface RoundInfo {
    participants: {
        address: string;
        betAmount: number;
        cashoutMultiplier?: number;
        claimed: boolean;
    }[];
}

async function monitorRound(client: AptosClient, roundId: number) {
    try {
        // Get participants from event history
        const betEvents = await client.getEventsByEventHandle(
            CONTRACT_ADDRESS,
            `${CONTRACT_ADDRESS}::crash::CrashGameState`,
            "bet_events",
            { limit: 100 }
        );

        const cashoutEvents = await client.getEventsByEventHandle(
            CONTRACT_ADDRESS,
            `${CONTRACT_ADDRESS}::crash::CrashGameState`,
            "cashout_events",
            { limit: 100 }
        );

        const roundParticipants: RoundInfo = {
            participants: []
        };

        // Process bet events
        for (const event of betEvents) {
            if (event.data.round_id === roundId.toString()) {
                roundParticipants.participants.push({
                    address: event.data.player,
                    betAmount: Number(event.data.amount) / 100000000, // Convert to APT
                    claimed: false
                });
            }
        }

        // Process cashout events
        for (const event of cashoutEvents) {
            if (event.data.round_id === roundId.toString()) {
                const participant = roundParticipants.participants.find(
                    p => p.address === event.data.player
                );
                if (participant) {
                    participant.cashoutMultiplier = Number(event.data.multiplier) / 100;
                    participant.claimed = true;
                }
            }
        }

        // Print round information
        console.log(`\nRound ${roundId} Participants:`);
        console.table(roundParticipants.participants.map(p => ({
            Address: p.address,
            'Bet (APT)': p.betAmount,
            'Cashout Multiplier': p.cashoutMultiplier || 'Not cashed out',
            Status: p.claimed ? 'Cashed out' : 'Active'
        })));

        return roundParticipants;
    } catch (error) {
        console.error('Error monitoring round:', error);
        return null;
    }
}

async function main() {
    const client = new AptosClient(NODE_URL);

    while (true) {
        try {
            // Get current round ID
            const currentRoundId = Number((await client.view({
                function: `${CONTRACT_ADDRESS}::crash::get_current_round_id`,
                type_arguments: [],
                arguments: []
            }))[0]);

            await monitorRound(client, currentRoundId);

            // Wait before next update
            await wait(2000);
        } catch (error) {
            console.error('Error:', error);
            await wait(5000);
        }
    }
}

main().catch(console.error);
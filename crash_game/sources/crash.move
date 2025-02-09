module crash_game::crash {
    use std::signer;
    use std::vector;
    use aptos_framework::coin::{Self, Coin};
    use aptos_framework::timestamp;
    use aptos_framework::block;
    use aptos_framework::aptos_coin::AptosCoin;
    use aptos_std::table::{Self, Table};
    use aptos_framework::account;
    use aptos_framework::event::{Self, EventHandle};
    use std::hash;
    use std::bcs;

    // Error codes
    const ERR_INSUFFICIENT_BALANCE: u64 = 1;
    const ERR_ROUND_NOT_ACTIVE: u64 = 2;
    const ERR_BET_TOO_LOW: u64 = 3;
    const ERR_ALREADY_CRASHED: u64 = 4;
    const ERR_NO_BET_PLACED: u64 = 5;
    const ERR_ALREADY_CLAIMED: u64 = 6;
    const ERR_INVALID_MULTIPLIER: u64 = 7;
    const ERR_NOT_OWNER: u64 = 8;
    const ERR_ALREADY_BETTED: u64 = 9;

    // Game constants
    const MIN_BET: u64 = 100000; // 0.001 APT
    const BETTING_WINDOW: u64 = 15;  // 15 seconds for betting window
    
    struct BetPlacedEvent has drop, store {
        player: address,
        round_id: u64,
        amount: u64
    }

    struct PlayerCashoutEvent has drop, store {
        player: address,
        round_id: u64,
        multiplier: u64,
        win_amount: u64
    }

    struct RoundEvent has drop, store {
        round_id: u64,
        crash_point: u64,  // Will be 0 for new rounds, actual value when crashed
        timestamp: u64
    }

    struct RandomnessState has store {
        last_seed: vector<u8>,
        current_block_height: u64,
        player_actions: vector<u8>
    }

    struct PlayerBet has store {
        amount: u64
    }

    struct RoundBets has key {
        bets: Table<address, PlayerBet>,
        cashout_multipliers: Table<address, u64>,
        has_claimed: Table<address, bool>,
        participants: vector<address>
    }

    struct Round has store {
        id: u64,
        start_time: u64,
        betting_end_time: u64,
        crash_point: u64,
        crashed: bool
    }

    struct CrashGameState has key {
        owner: address,
        current_round_id: u64,
        randomness_state: RandomnessState,
        rounds: Table<u64, Round>,
        house_bank: Coin<AptosCoin>,
        bet_events: EventHandle<BetPlacedEvent>,
        cashout_events: EventHandle<PlayerCashoutEvent>,
        round_events: EventHandle<RoundEvent>
    }

    fun generate_crash_point(randomness_state: &mut RandomnessState): u64 {
        let current_height = block::get_current_block_height();
        let current_time = timestamp::now_microseconds();
        
        randomness_state.current_block_height = current_height;
        
        let entropy = vector::empty<u8>();
        vector::append(&mut entropy, randomness_state.last_seed);
        vector::append(&mut entropy, bcs::to_bytes(&current_height));
        vector::append(&mut entropy, bcs::to_bytes(&current_time));
        vector::append(&mut entropy, randomness_state.player_actions);
        
        let new_seed = hash::sha3_256(entropy);
        randomness_state.last_seed = new_seed;
        
        let mut_result = 0u64;
        let i = 0u64;
        while (i < 8) {
            let byte_val = (*vector::borrow(&new_seed, i) as u64);
            mut_result = mut_result << 8;
            mut_result = mut_result | byte_val;
            i = i + 1;
        };
        
        let random_number = mut_result % 10000;
        
        if (random_number < 500) { // 5% instant crash
            100 // 1.00x
        } else if (random_number < 5250) { // 47.5% low multiplier
            100 + (random_number % 50) // 1.00x - 1.50x
        } else if (random_number < 8750) { // 35% medium multiplier
            150 + (random_number % 150) // 1.50x - 3.00x
        } else { // 12.5% high multiplier
            300 + (random_number % 700) // 3.00x - 10.00x
        }
    }

    public entry fun initialize(account: &signer) acquires CrashGameState {
        let addr = signer::address_of(account);
        
        let randomness_state = RandomnessState {
            last_seed: vector::empty(),
            current_block_height: 0,
            player_actions: vector::empty()
        };
        
        let state = CrashGameState {
            owner: addr,
            current_round_id: 0,
            randomness_state,
            rounds: table::new(),
            house_bank: coin::zero<AptosCoin>(),
            bet_events: account::new_event_handle<BetPlacedEvent>(account),
            cashout_events: account::new_event_handle<PlayerCashoutEvent>(account),
            round_events: account::new_event_handle<RoundEvent>(account)
        };

        let round_bets = RoundBets {
            bets: table::new(),
            cashout_multipliers: table::new(),
            has_claimed: table::new(),
            participants: vector::empty()
        };

        move_to(account, state);
        move_to(account, round_bets);
        
        // Initialize first round
        let state = borrow_global_mut<CrashGameState>(@crash_game);
        state.current_round_id = 1;
        
        let current_time = timestamp::now_seconds();
        let betting_ends = current_time + BETTING_WINDOW;
        let round_starts = betting_ends;

        let new_round = Round {
            id: 1,
            start_time: round_starts,
            betting_end_time: betting_ends,
            crash_point: generate_crash_point(&mut state.randomness_state),
            crashed: false
        };
        
        table::add(&mut state.rounds, 1, new_round);
        
        event::emit_event(&mut state.round_events, RoundEvent {
            round_id: 1,
            crash_point: 0, // Don't reveal initial crash point
            timestamp: current_time
        });
    }

    public entry fun deposit_house_bank(account: &signer) acquires CrashGameState {
        let state = borrow_global_mut<CrashGameState>(@crash_game);
        assert!(signer::address_of(account) == state.owner, ERR_NOT_OWNER);
        let coin_in = coin::withdraw<AptosCoin>(account, 100000000); // 1 APT
        coin::merge(&mut state.house_bank, coin_in);
    }

    public entry fun place_bet(account: &signer, amount: u64) acquires CrashGameState, RoundBets {
        let addr = signer::address_of(account);
        let state = borrow_global_mut<CrashGameState>(@crash_game);
        let current_round_id = state.current_round_id;
        
        assert!(amount >= MIN_BET, ERR_BET_TOO_LOW);
        
        let current_time = timestamp::now_seconds();
        let current_round = table::borrow(&state.rounds, current_round_id);
        let round_bets = borrow_global_mut<RoundBets>(@crash_game);

        if (current_time >= current_round.start_time || current_round.crashed) {
            // Betting for next round
            assert!(table::contains(&state.rounds, current_round_id + 1), ERR_ROUND_NOT_ACTIVE);
            let next_round = table::borrow(&state.rounds, current_round_id + 1);
            assert!(current_time < next_round.betting_end_time, ERR_ROUND_NOT_ACTIVE);
            assert!(!next_round.crashed, ERR_ALREADY_CRASHED);
            assert!(!table::contains(&round_bets.bets, addr), ERR_ALREADY_BETTED);

            // Place bet
            let bet_coin = coin::withdraw<AptosCoin>(account, amount);
            coin::merge(&mut state.house_bank, bet_coin);
            
            vector::push_back(&mut round_bets.participants, addr);
            let player_bet = PlayerBet { amount };
            table::add(&mut round_bets.bets, addr, player_bet);
            
            event::emit_event(&mut state.bet_events, BetPlacedEvent {
                player: addr,
                round_id: current_round_id + 1,
                amount
            });
        } else {
            // Betting for current round
            assert!(current_time < current_round.betting_end_time, ERR_ROUND_NOT_ACTIVE);
            assert!(!current_round.crashed, ERR_ALREADY_CRASHED);
            assert!(!table::contains(&round_bets.bets, addr), ERR_ALREADY_BETTED);

            // Place bet
            let bet_coin = coin::withdraw<AptosCoin>(account, amount);
            coin::merge(&mut state.house_bank, bet_coin);
            
            vector::push_back(&mut round_bets.participants, addr);
            let player_bet = PlayerBet { amount };
            table::add(&mut round_bets.bets, addr, player_bet);
            
            event::emit_event(&mut state.bet_events, BetPlacedEvent {
                player: addr,
                round_id: current_round_id,
                amount
            });
        };
    }

    public entry fun process_round(_account: &signer) acquires CrashGameState, RoundBets {
        let state = borrow_global_mut<CrashGameState>(@crash_game);
        let current_round_id = state.current_round_id;
        let current_time = timestamp::now_seconds();

        let (can_crash, crash_point) = {
            let round = table::borrow(&state.rounds, current_round_id);
            assert!(!round.crashed, ERR_ALREADY_CRASHED);
            assert!(current_time >= round.betting_end_time, ERR_ROUND_NOT_ACTIVE);
            (true, round.crash_point)
        };

        if (can_crash) {
            let round = table::borrow_mut(&mut state.rounds, current_round_id);
            round.crashed = true;

            // Process unclaimed bets and clear tables for next round
            let round_bets = borrow_global_mut<RoundBets>(@crash_game);
            let i = 0;
            let len = vector::length(&round_bets.participants);
            
            // Process all participants
            while (i < len) {
                let participant = *vector::borrow(&round_bets.participants, i);
                
                // Handle bets table first
                if (table::contains(&round_bets.bets, participant)) {
                    if (!table::contains(&round_bets.has_claimed, participant)) {
                        // If not claimed, record it
                        table::add(&mut round_bets.has_claimed, participant, true);
                    };
                    // Remove bet amount record
                    let PlayerBet { amount: _ } = table::remove(&mut round_bets.bets, participant);
                };
                
                // Clean up other tables
                if (table::contains(&round_bets.cashout_multipliers, participant)) {
                    table::remove(&mut round_bets.cashout_multipliers, participant);
                };
                if (table::contains(&round_bets.has_claimed, participant)) {
                    table::remove(&mut round_bets.has_claimed, participant);
                };
                
                i = i + 1;
            };

            // Clear participants vector
            round_bets.participants = vector::empty();
        };

        let next_round_id = current_round_id + 1;
        let betting_ends = current_time + BETTING_WINDOW;
        let round_starts = betting_ends;

        let new_round = Round {
            id: next_round_id,
            start_time: round_starts,
            betting_end_time: betting_ends,
            crash_point: generate_crash_point(&mut state.randomness_state),
            crashed: false
        };
        
        table::add(&mut state.rounds, next_round_id, new_round);
        state.current_round_id = next_round_id;
        
        event::emit_event(&mut state.round_events, RoundEvent {
            round_id: current_round_id,
            crash_point, // Reveal crash point for finished round
            timestamp: current_time
        });

        event::emit_event(&mut state.round_events, RoundEvent {
            round_id: next_round_id,
            crash_point: 0, // Don't reveal new round's crash point
            timestamp: current_time
        });
    }

    public entry fun cashout(account: &signer) acquires CrashGameState, RoundBets {
        let addr = signer::address_of(account);
        let state = borrow_global_mut<CrashGameState>(@crash_game);
        let current_round_id = state.current_round_id;
        let round = table::borrow(&state.rounds, current_round_id);
        let round_bets = borrow_global_mut<RoundBets>(@crash_game);

        assert!(table::contains(&round_bets.bets, addr), ERR_NO_BET_PLACED);
        assert!(!round.crashed, ERR_ALREADY_CRASHED);
        assert!(!table::contains(&round_bets.has_claimed, addr), ERR_ALREADY_CLAIMED);
        
        let current_time = timestamp::now_seconds();
        assert!(current_time >= round.start_time, ERR_ROUND_NOT_ACTIVE);

        // Get player's bet amount
        let player_bet = table::borrow(&round_bets.bets, addr);
        let bet_amount = player_bet.amount;
        
        // Calculate multiplier
        let time_elapsed = current_time - round.start_time;
        let mut_multiplier = 100; // Start at 1x
        let base_increment = 1;
        let scale_factor = 1 + (time_elapsed / 10);
        
        let j = 0u64;
        while (j < time_elapsed) {
            let increment = base_increment + (mut_multiplier / 1000);
            mut_multiplier = mut_multiplier + increment * scale_factor;
            
            if (mut_multiplier >= round.crash_point) {
                mut_multiplier = round.crash_point;
                break
            };
            j = j + 1;
        };

        assert!(mut_multiplier > 0, ERR_INVALID_MULTIPLIER);
        assert!(mut_multiplier <= round.crash_point, ERR_ALREADY_CRASHED);

        // Calculate winnings
        let win_amount = (bet_amount as u128) * (mut_multiplier as u128) / 100;
        let win_amount_u64 = (win_amount as u64);

        // Mark bet as claimed
        table::add(&mut round_bets.cashout_multipliers, addr, mut_multiplier);
        table::add(&mut round_bets.has_claimed, addr, true);

        // Pay out from house bank
        let payout = coin::extract(&mut state.house_bank, win_amount_u64);
        coin::deposit(addr, payout);

        event::emit_event(&mut state.cashout_events, PlayerCashoutEvent {
            player: addr,
            round_id: current_round_id,
            multiplier: mut_multiplier,
            win_amount: win_amount_u64
        });
    }

    #[view]
    public fun get_round_data(round_id: u64): (u64, u64, u64, bool) acquires CrashGameState {
        let state = borrow_global<CrashGameState>(@crash_game);
        let round = table::borrow(&state.rounds, round_id);
        (
            round.id,
            round.start_time,
            if (round.crashed) { round.crash_point } else { 0 }, // Only reveal after crash
            round.crashed
        )
    }

    #[view]
    public fun get_round_status(round_id: u64): (u64, u64, u64, u64, u64, bool) acquires CrashGameState {
        let state = borrow_global<CrashGameState>(@crash_game);
        let round = table::borrow(&state.rounds, round_id);
        let current_time = timestamp::now_seconds();
        (
            round.id,
            round.start_time,
            round.betting_end_time,
            if (round.crashed) { round.crash_point } else { 0 }, // Only reveal after crash
            current_time,
            current_time < round.betting_end_time && !round.crashed
        )
    }

    #[view]
    public fun get_current_round_id(): u64 acquires CrashGameState {
        borrow_global<CrashGameState>(@crash_game).current_round_id
    }
}
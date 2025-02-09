# Crashtos.xyz

**Live Demo:** Visit https://play.crashtos.xyz/ to play! Connect your **Petra Wallet** and ensure you have some **testnet funds** to try betting.

Crashtos.xyz is a **crash game** built on the **Aptos blockchain**.

## 🛠 Installation & Setup

### 1️⃣ Clone the Repository
```sh
git clone https://github.com/your-repo/crashtos.xyz.git
cd crashtos.xyz
```

### 2️⃣ Create an `.env` File
Create a `.env` file in the root directory with the following environment variables:

```sh
APTOS_PRIVATE_KEY=deployer_address
APTOS_PRIVATE_KEY_2=testing_account
CONTRACT_ADDRESS=smart_contract_address
NODE_URL=https://fullnode.testnet.aptoslabs.com/v1
FAUCET_URL=https://faucet.testnet.aptoslabs.com
WALLET_ADDRESS=smart_contract_address
```

### 3️⃣ Configure `Move.toml`
In `Move.toml`, update the `[addresses]` section with the deployed contract address.

## Deploying the Smart Contract

### 1️⃣ Compile the Contract
```sh
aptos move compile --save-metadata --skip-fetch-latest-git-deps
Compiling, may take a little while to download git dependencies...
INCLUDING DEPENDENCY AptosFramework
INCLUDING DEPENDENCY AptosStdlib
INCLUDING DEPENDENCY MoveStdlib
BUILDING crash_game
{
  "Result": [
    "c31632383a843d657cd0da87a73408df77771e208b4ab2cb007a0ae4987f98a8::crash"
  ]
}
```

### 2️⃣ Deploy the Contract
```sh
ts-node scripts/deploy.ts
Compiling contract...
Compiling, may take a little while to download git dependencies...
INCLUDING DEPENDENCY AptosFramework
INCLUDING DEPENDENCY AptosStdlib
INCLUDING DEPENDENCY MoveStdlib
BUILDING crash_game
{
  "Result": [
    "c31632383a843d657cd0da87a73408df77771e208b4ab2cb007a0ae4987f98a8::crash"
  ]
}
Account address: 0xc31632383a843d657cd0da87a73408df77771e208b4ab2cb007a0ae4987f98a8
Account balance: 93617300
Deploying contract...
Waiting for deployment confirmation...
Contract deployed! Hash: 0x6bd27e510570cec62bed3e58c9cce084fa68a2283f824bdf3e862a10f7b638d8
Waiting for module to be available...
Initializing contract...
Contract initialized successfully!
New contract address: 0xc31632383a843d657cd0da87a73408df77771e208b4ab2cb007a0ae4987f98a8
```
If successful, the smart contract is deployed.

## Monitoring the Smart Contract
To interact with the smart contract, ensure that the monitoring process is running.

### 1️⃣ Monitor Rounds
```sh
ts-node scripts/monitor-rounds.ts
```
Example output:
```sh
Waiting for round transition...
✨ Successfully transitioned to round 1030

=== ROUND START ===
Round ID: 1030
Debug - Round Data: [ '1030', '1739113690', '146', false ]
Round crash point: 1.46x

=== BETTING PERIOD ===
Betting window: 1s remaining
Betting period ended
Multiplier: 1.26x.
```

### 2️⃣ Place a Bet and Cashout
```sh
ts-node scripts/bet.ts
🎮 Starting auto-bet session...

🎲 New betting round:
Round ID: 1040
Bet Amount: 0.02040664 APT
Target Multiplier: 1.56x
Current Balance: 4.92422001 APT
Bet placed successfully! Hash: 0x36afc0371e2ca7989672d20170e06023a1f7961a0a48949aa45673219be9fbaf

💰 Target multiplier 1.56x reached!
Cashout submitted: 0x6f1961f9ded8acc2d6bb6ab364b027bdc35c832e4d66ff9f59efaace773893d1
✅ Round Won!
Profit: 0.000083 APT
```

### 3️⃣ Monitor Participants Live
```sh
ts-node scripts/monitor-participants.ts

Round 1055 Participants:
┌─────────┐
│ (index) │
├─────────┤
└─────────┘
```

### 4️⃣ Monitor the Bank (Smart Contract as Participant)
```sh
ts-node scripts/bank-monitor.ts
=== Round 1054 ===
Time: 16:41:23

🎮 Active Round Stats:
Total Bets: 0.0000 APT
Number of Bets: 0
Active Players: 0
```

### 5️⃣ Check Address Interaction & Stats
```sh
ts-node scripts/history.ts
```

## 📌 Notes
- Ensure you have **Node.js** and **TypeScript** installed.
- Use an **Aptos wallet** to interact with the game.
- Always monitor smart contract transactions before betting.

## 📜 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing
Contributions are welcome! Feel free to submit a pull request or open an issue.

## 📬 Contact
For any inquiries, reach out via [GitHub Issues](https://github.com/your-repo/crashtos.xyz/issues).

---

Enjoy the game! 













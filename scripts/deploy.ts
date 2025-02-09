import { AptosClient, AptosAccount, FaucetClient, HexString, Types } from "aptos";
import { readFileSync } from "fs";
import * as path from "path";
import dotenv from "dotenv";
import { execSync } from "child_process";

dotenv.config();

const NODE_URL = process.env.NODE_URL || "https://fullnode.testnet.aptoslabs.com/v1";
const FAUCET_URL = process.env.FAUCET_URL || "https://faucet.testnet.aptoslabs.com";

async function waitForModule(client: AptosClient, address: string, attempts = 10): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
        try {
            await client.getAccountModule(address, "crash");
            return true;
        } catch (e) {
            console.log(`Waiting for module to be available (attempt ${i + 1}/${attempts})...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    return false;
}

async function main() {
    try {
        console.log("Compiling contract...");
        execSync("aptos move compile --save-metadata --skip-fetch-latest-git-deps", { stdio: 'inherit' });
        await new Promise(resolve => setTimeout(resolve, 2000));

        const client = new AptosClient(NODE_URL);
        const faucetClient = new FaucetClient(NODE_URL, FAUCET_URL);
        const account = new AptosAccount(
            HexString.ensure(process.env.APTOS_PRIVATE_KEY as string).toUint8Array()
        );
        
        console.log("Account address:", account.address().hex());
        
        const resources = await client.getAccountResources(account.address());
        const accountResource = resources.find((r) => r.type === "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>");
        console.log("Account balance:", (accountResource?.data as any)?.coin?.value);

        const buildPath = path.join(process.cwd(), "build", "crash_game");
        const packageMetadataPath = path.join(buildPath, "package-metadata.bcs");
        const moduleDataPath = path.join(buildPath, "bytecode_modules", "crash.mv");
        
        if (!require('fs').existsSync(packageMetadataPath)) {
            throw new Error(`Package metadata not found at ${packageMetadataPath}`);
        }
        if (!require('fs').existsSync(moduleDataPath)) {
            throw new Error(`Module data not found at ${moduleDataPath}`);
        }

        const packageMetadata = readFileSync(packageMetadataPath);
        const moduleData = readFileSync(moduleDataPath);

        const payload: Types.TransactionPayload = {
            type: "entry_function_payload",
            function: "0x1::code::publish_package_txn",
            type_arguments: [],
            arguments: [
                Array.from(packageMetadata),
                [Array.from(moduleData)],
            ],
        };

        console.log("Deploying contract...");
        const rawTxn = await client.generateTransaction(account.address(), payload);
        const bcsTxn = await client.signTransaction(account, rawTxn);
        const pendingTxn = await client.submitTransaction(bcsTxn);
        
        console.log("Waiting for deployment confirmation...");
        await client.waitForTransaction(pendingTxn.hash, { timeoutSecs: 60 });
        console.log("Contract deployed! Hash:", pendingTxn.hash);

        console.log("Waiting for module to be available...");
        const moduleAvailable = await waitForModule(client, account.address().hex());
        if (!moduleAvailable) {
            throw new Error("Module not available after maximum attempts");
        }

        console.log("Initializing contract...");
        const initPayload: Types.TransactionPayload = {
            type: "entry_function_payload",
            function: `${account.address().hex()}::crash::initialize`,
            type_arguments: [],
            arguments: [],
        };

        const rawInitTxn = await client.generateTransaction(account.address(), initPayload);
        const bcsInitTxn = await client.signTransaction(account, rawInitTxn);
        const pendingInit = await client.submitTransaction(bcsInitTxn);
        await client.waitForTransaction(pendingInit.hash, { timeoutSecs: 60 });
        
        console.log("Contract initialized successfully!");
        console.log("New contract address:", account.address().hex());
        
    } catch (error) {
        console.error("Deployment failed:", error);
        process.exit(1);
    }
}

main().catch(console.error);
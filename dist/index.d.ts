import { ICacheManager, IAgentRuntime, Provider, Memory, State, HandlerCallback, Action, Plugin } from '@elizaos/core';
import { Address, Hash, Log, Chain, PublicClient, HttpTransport, Account, WalletClient, PrivateKeyAccount, TestClient } from 'viem';
import { Token, Route } from '@lifi/types';
import * as viemChains from 'viem/chains';

declare const _SupportedChainList: Array<keyof typeof viemChains>;
type SupportedChain = (typeof _SupportedChainList)[number];
interface Transaction {
    hash: Hash;
    from: Address;
    to: Address;
    value: bigint;
    data?: `0x${string}`;
    chainId?: number;
    logs?: Log[];
}
interface TokenWithBalance {
    token: Token;
    balance: bigint;
    formattedBalance: string;
    priceUSD: string;
    valueUSD: string;
}
interface WalletBalance {
    chain: SupportedChain;
    address: Address;
    totalValueUSD: string;
    tokens: TokenWithBalance[];
}
interface ChainMetadata {
    chainId: number;
    name: string;
    chain: Chain;
    rpcUrl: string;
    nativeCurrency: {
        name: string;
        symbol: string;
        decimals: number;
    };
    blockExplorerUrl: string;
}
interface ChainConfig {
    chain: Chain;
    publicClient: PublicClient<HttpTransport, Chain, Account | undefined>;
    walletClient?: WalletClient;
}
interface TransferParams {
    fromChain: SupportedChain;
    toAddress: Address;
    amount: string;
    data?: `0x${string}`;
}
interface SwapParams {
    chain: SupportedChain;
    fromToken: Address;
    toToken: Address;
    amount: string;
    slippage?: number;
}
interface BebopRoute {
    data: string;
    approvalTarget: Address;
    sellAmount: string;
    from: Address;
    to: Address;
    value: string;
    gas: string;
    gasPrice: string;
}
interface SwapQuote {
    aggregator: "lifi" | "bebop";
    minOutputAmount: string;
    swapData: Route | BebopRoute;
}
interface BridgeParams {
    fromChain: SupportedChain;
    toChain: SupportedChain;
    fromToken: Address;
    toToken: Address;
    amount: string;
    toAddress?: Address;
}
interface EvmPluginConfig {
    rpcUrl?: {
        ethereum?: string;
        abstract?: string;
        base?: string;
        sepolia?: string;
        bsc?: string;
        arbitrum?: string;
        avalanche?: string;
        polygon?: string;
        optimism?: string;
        cronos?: string;
        gnosis?: string;
        fantom?: string;
        fraxtal?: string;
        klaytn?: string;
        celo?: string;
        moonbeam?: string;
        aurora?: string;
        harmonyOne?: string;
        moonriver?: string;
        arbitrumNova?: string;
        mantle?: string;
        linea?: string;
        scroll?: string;
        filecoin?: string;
        taiko?: string;
        zksync?: string;
        canto?: string;
        alienx?: string;
        gravity?: string;
    };
    secrets?: {
        EVM_PRIVATE_KEY: string;
    };
    testMode?: boolean;
    multicall?: {
        batchSize?: number;
        wait?: number;
    };
}
type LiFiStatus = {
    status: "PENDING" | "DONE" | "FAILED";
    substatus?: string;
    error?: Error;
};
type LiFiRoute = {
    transactionHash: Hash;
    transactionData: `0x${string}`;
    toAddress: Address;
    status: LiFiStatus;
};
interface TokenData extends Token {
    symbol: string;
    decimals: number;
    address: Address;
    name: string;
    logoURI?: string;
    chainId: number;
}
interface TokenPriceResponse {
    priceUSD: string;
    token: TokenData;
}
interface TokenListResponse {
    tokens: TokenData[];
}
interface ProviderError extends Error {
    code?: number;
    data?: unknown;
}
declare enum VoteType {
    AGAINST = 0,
    FOR = 1,
    ABSTAIN = 2
}
interface Proposal {
    targets: Address[];
    values: bigint[];
    calldatas: `0x${string}`[];
    description: string;
}
interface VoteParams {
    chain: SupportedChain;
    governor: Address;
    proposalId: string;
    support: VoteType;
}
interface QueueProposalParams extends Proposal {
    chain: SupportedChain;
    governor: Address;
}
interface ExecuteProposalParams extends Proposal {
    chain: SupportedChain;
    governor: Address;
    proposalId: string;
}
interface ProposeProposalParams extends Proposal {
    chain: SupportedChain;
    governor: Address;
}

declare class WalletProvider {
    private cacheManager;
    private cache;
    private cacheKey;
    private currentChain;
    private CACHE_EXPIRY_SEC;
    chains: Record<string, Chain>;
    account: PrivateKeyAccount;
    constructor(accountOrPrivateKey: PrivateKeyAccount | `0x${string}`, cacheManager: ICacheManager, chains?: Record<string, Chain>);
    getAddress(): Address;
    getCurrentChain(): Chain;
    getPublicClient(chainName: SupportedChain): PublicClient<HttpTransport, Chain, Account | undefined>;
    getWalletClient(chainName: SupportedChain): WalletClient;
    getTestClient(): TestClient;
    getChainConfigs(chainName: SupportedChain): Chain;
    getWalletBalance(): Promise<string | null>;
    getWalletBalanceForChain(chainName: SupportedChain): Promise<string | null>;
    addChain(chain: Record<string, Chain>): void;
    switchChain(chainName: SupportedChain, customRpcUrl?: string): void;
    private readFromCache;
    private writeToCache;
    private getCachedData;
    private setCachedData;
    private setAccount;
    private setChains;
    private setCurrentChain;
    private createHttpTransport;
    static genChainFromName(chainName: string, customRpcUrl?: string | null): Chain;
}
declare const initWalletProvider: (runtime: IAgentRuntime) => Promise<WalletProvider>;
declare const evmWalletProvider: Provider;

declare const bridgeTemplate = "Given the recent messages and wallet information below:\n\n{{recentMessages}}\n\n{{walletInfo}}\n\nExtract the following information about the requested token bridge:\n- Token symbol or address to bridge\n- Source chain\n- Destination chain\n- Amount to bridge: Must be a string representing the amount in ether (only number without coin symbol, e.g., \"0.1\")\n- Destination address (if specified)\n\nRespond with a JSON markdown block containing only the extracted values:\n\n```json\n{\n    \"token\": string | null,\n    \"fromChain\": \"ethereum\" | \"abstract\" | \"base\" | \"sepolia\" | \"bsc\" | \"arbitrum\" | \"avalanche\" | \"polygon\" | \"optimism\" | \"cronos\" | \"gnosis\" | \"fantom\" | \"fraxtal\" | \"klaytn\" | \"celo\" | \"moonbeam\" | \"aurora\" | \"harmonyOne\" | \"moonriver\" | \"arbitrumNova\" | \"mantle\" | \"linea\" | \"scroll\" | \"filecoin\" | \"taiko\" | \"zksync\" | \"canto\" | \"alienx\" | \"gravity\" | null,\n    \"toChain\": \"ethereum\" | \"abstract\" | \"base\" | \"sepolia\" | \"bsc\" | \"arbitrum\" | \"avalanche\" | \"polygon\" | \"optimism\" | \"cronos\" | \"gnosis\" | \"fantom\" | \"fraxtal\" | \"klaytn\" | \"celo\" | \"moonbeam\" | \"aurora\" | \"harmonyOne\" | \"moonriver\" | \"arbitrumNova\" | \"mantle\" | \"linea\" | \"scroll\" | \"filecoin\" | \"taiko\" | \"zksync\" | \"canto\" | \"alienx\" | \"gravity\" |  null,\n    \"amount\": string | null,\n    \"toAddress\": string | null\n}\n```\n";
declare const swapTemplate = "Given the recent messages and wallet information below:\n\n{{recentMessages}}\n\n{{walletInfo}}\n\nExtract the following information about the requested token swap:\n- Input token symbol or address (the token being sold)\n- Output token symbol or address (the token being bought)\n- Amount to swap: Must be a string representing the amount in ether (only number without coin symbol, e.g., \"0.1\")\n- Chain to execute on\n\nRespond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined:\n\n```json\n{\n    \"inputToken\": string | null,\n    \"outputToken\": string | null,\n    \"amount\": string | null,\n    \"chain\": \"ethereum\" | \"abstract\" | \"base\" | \"sepolia\" | \"bsc\" | \"arbitrum\" | \"avalanche\" | \"polygon\" | \"optimism\" | \"cronos\" | \"gnosis\" | \"fantom\" | \"klaytn\" | \"celo\" | \"moonbeam\" | \"aurora\" | \"harmonyOne\" | \"moonriver\" | \"arbitrumNova\" | \"mantle\" | \"linea\" | \"scroll\" | \"filecoin\" | \"taiko\" | \"zksync\" | \"canto\" | \"alienx\" | null,\n    \"slippage\": number | null\n}\n```\n";

declare class BridgeAction {
    private walletProvider;
    private config;
    constructor(walletProvider: WalletProvider);
    bridge(params: BridgeParams): Promise<Transaction>;
}
declare const bridgeAction: {
    name: string;
    description: string;
    handler: (runtime: IAgentRuntime, _message: Memory, state: State, _options: Record<string, unknown>, callback?: HandlerCallback) => Promise<boolean>;
    template: string;
    validate: (runtime: IAgentRuntime) => Promise<boolean>;
    examples: {
        user: string;
        content: {
            text: string;
            action: string;
        };
    }[][];
    similes: string[];
};

declare class SwapAction {
    private walletProvider;
    private lifiConfig;
    private bebopChainsMap;
    constructor(walletProvider: WalletProvider);
    swap(params: SwapParams): Promise<Transaction>;
    private getSortedQuotes;
    private getLifiQuote;
    private getBebopQuote;
    private executeLifiQuote;
    private executeBebopQuote;
}
declare const swapAction: {
    name: string;
    description: string;
    handler: (runtime: IAgentRuntime, _message: Memory, state: State, _options: any, callback?: any) => Promise<boolean>;
    template: string;
    validate: (runtime: IAgentRuntime) => Promise<boolean>;
    examples: {
        user: string;
        content: {
            text: string;
            action: string;
        };
    }[][];
    similes: string[];
};

declare class TransferAction {
    private walletProvider;
    constructor(walletProvider: WalletProvider);
    transfer(params: TransferParams): Promise<Transaction>;
}
declare const transferAction: Action;

declare const evmPlugin: Plugin;

export { type BebopRoute, BridgeAction, type BridgeParams, type ChainConfig, type ChainMetadata, type EvmPluginConfig, type ExecuteProposalParams, type LiFiRoute, type LiFiStatus, type Proposal, type ProposeProposalParams, type ProviderError, type QueueProposalParams, type SupportedChain, SwapAction, type SwapParams, type SwapQuote, type TokenData, type TokenListResponse, type TokenPriceResponse, type TokenWithBalance, type Transaction, TransferAction, type TransferParams, type VoteParams, VoteType, type WalletBalance, WalletProvider, bridgeAction, bridgeTemplate, evmPlugin as default, evmPlugin, evmWalletProvider, initWalletProvider, swapAction, swapTemplate, transferAction };

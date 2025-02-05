// src/actions/bridge.ts
import {
  composeContext,
  generateObjectDeprecated,
  ModelClass
} from "@elizaos/core";
import {
  createConfig,
  executeRoute,
  getRoutes
} from "@lifi/sdk";

// src/providers/wallet.ts
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  formatUnits,
  http,
  publicActions,
  walletActions
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  elizaLogger
} from "@elizaos/core";
import * as viemChains from "viem/chains";
import { DeriveKeyProvider, TEEMode } from "@elizaos/plugin-tee";
import NodeCache from "node-cache";
import * as path from "node:path";
var WalletProvider = class _WalletProvider {
  constructor(accountOrPrivateKey, cacheManager, chains) {
    this.cacheManager = cacheManager;
    this.setAccount(accountOrPrivateKey);
    this.setChains(chains);
    if (chains && Object.keys(chains).length > 0) {
      this.setCurrentChain(Object.keys(chains)[0]);
    }
    this.cache = new NodeCache({ stdTTL: this.CACHE_EXPIRY_SEC });
  }
  cache;
  cacheKey = "evm/wallet";
  currentChain = "mainnet";
  CACHE_EXPIRY_SEC = 5;
  chains = { ...viemChains };
  account;
  getAddress() {
    return this.account.address;
  }
  getCurrentChain() {
    return this.chains[this.currentChain];
  }
  getPublicClient(chainName) {
    const transport = this.createHttpTransport(chainName);
    const publicClient = createPublicClient({
      chain: this.chains[chainName],
      transport
    });
    return publicClient;
  }
  getWalletClient(chainName) {
    const transport = this.createHttpTransport(chainName);
    const walletClient = createWalletClient({
      chain: this.chains[chainName],
      transport,
      account: this.account
    });
    return walletClient;
  }
  getTestClient() {
    return createTestClient({
      chain: viemChains.hardhat,
      mode: "hardhat",
      transport: http()
    }).extend(publicActions).extend(walletActions);
  }
  getChainConfigs(chainName) {
    const chain = viemChains[chainName];
    if (!chain?.id) {
      throw new Error("Invalid chain name");
    }
    return chain;
  }
  async getWalletBalance() {
    const cacheKey = `walletBalance_${this.currentChain}`;
    const cachedData = await this.getCachedData(cacheKey);
    if (cachedData) {
      elizaLogger.log(
        `Returning cached wallet balance for chain: ${this.currentChain}`
      );
      return cachedData;
    }
    try {
      const client = this.getPublicClient(this.currentChain);
      const balance = await client.getBalance({
        address: this.account.address
      });
      const balanceFormatted = formatUnits(balance, 18);
      this.setCachedData(cacheKey, balanceFormatted);
      elizaLogger.log(
        "Wallet balance cached for chain: ",
        this.currentChain
      );
      return balanceFormatted;
    } catch (error) {
      console.error("Error getting wallet balance:", error);
      return null;
    }
  }
  async getWalletBalanceForChain(chainName) {
    try {
      const client = this.getPublicClient(chainName);
      const balance = await client.getBalance({
        address: this.account.address
      });
      return formatUnits(balance, 18);
    } catch (error) {
      console.error("Error getting wallet balance:", error);
      return null;
    }
  }
  addChain(chain) {
    this.setChains(chain);
  }
  switchChain(chainName, customRpcUrl) {
    if (!this.chains[chainName]) {
      const chain = _WalletProvider.genChainFromName(
        chainName,
        customRpcUrl
      );
      this.addChain({ [chainName]: chain });
    }
    this.setCurrentChain(chainName);
  }
  async readFromCache(key) {
    const cached = await this.cacheManager.get(
      path.join(this.cacheKey, key)
    );
    return cached;
  }
  async writeToCache(key, data) {
    await this.cacheManager.set(path.join(this.cacheKey, key), data, {
      expires: Date.now() + this.CACHE_EXPIRY_SEC * 1e3
    });
  }
  async getCachedData(key) {
    const cachedData = this.cache.get(key);
    if (cachedData) {
      return cachedData;
    }
    const fileCachedData = await this.readFromCache(key);
    if (fileCachedData) {
      this.cache.set(key, fileCachedData);
      return fileCachedData;
    }
    return null;
  }
  async setCachedData(cacheKey, data) {
    this.cache.set(cacheKey, data);
    await this.writeToCache(cacheKey, data);
  }
  setAccount = (accountOrPrivateKey) => {
    if (typeof accountOrPrivateKey === "string") {
      this.account = privateKeyToAccount(accountOrPrivateKey);
    } else {
      this.account = accountOrPrivateKey;
    }
  };
  setChains = (chains) => {
    if (!chains) {
      return;
    }
    for (const chain of Object.keys(chains)) {
      this.chains[chain] = chains[chain];
    }
  };
  setCurrentChain = (chain) => {
    this.currentChain = chain;
  };
  createHttpTransport = (chainName) => {
    const chain = this.chains[chainName];
    if (chain.rpcUrls.custom) {
      return http(chain.rpcUrls.custom.http[0]);
    }
    return http(chain.rpcUrls.default.http[0]);
  };
  static genChainFromName(chainName, customRpcUrl) {
    const baseChain = viemChains[chainName];
    if (!baseChain?.id) {
      throw new Error("Invalid chain name");
    }
    const viemChain = customRpcUrl ? {
      ...baseChain,
      rpcUrls: {
        ...baseChain.rpcUrls,
        custom: {
          http: [customRpcUrl]
        }
      }
    } : baseChain;
    return viemChain;
  }
};
var genChainsFromRuntime = (runtime) => {
  const chainNames = runtime.character.settings.chains?.evm || [];
  const chains = {};
  for (const chainName of chainNames) {
    const rpcUrl = runtime.getSetting(
      `ETHEREUM_PROVIDER_${chainName.toUpperCase()}`
    );
    const chain = WalletProvider.genChainFromName(chainName, rpcUrl);
    chains[chainName] = chain;
  }
  const mainnet_rpcurl = runtime.getSetting("EVM_PROVIDER_URL");
  if (mainnet_rpcurl) {
    const chain = WalletProvider.genChainFromName(
      "mainnet",
      mainnet_rpcurl
    );
    chains["mainnet"] = chain;
  }
  return chains;
};
var initWalletProvider = async (runtime) => {
  const teeMode = runtime.getSetting("TEE_MODE") || TEEMode.OFF;
  const chains = genChainsFromRuntime(runtime);
  if (teeMode !== TEEMode.OFF) {
    const walletSecretSalt = runtime.getSetting("WALLET_SECRET_SALT");
    if (!walletSecretSalt) {
      throw new Error(
        "WALLET_SECRET_SALT required when TEE_MODE is enabled"
      );
    }
    const deriveKeyProvider = new DeriveKeyProvider(teeMode);
    const deriveKeyResult = await deriveKeyProvider.deriveEcdsaKeypair(
      walletSecretSalt,
      "evm",
      runtime.agentId
    );
    return new WalletProvider(
      deriveKeyResult.keypair,
      runtime.cacheManager,
      chains
    );
  } else {
    const privateKey = runtime.getSetting(
      "EVM_PRIVATE_KEY"
    );
    if (!privateKey) {
      throw new Error("EVM_PRIVATE_KEY is missing");
    }
    return new WalletProvider(privateKey, runtime.cacheManager, chains);
  }
};
var evmWalletProvider = {
  async get(runtime, _message, state) {
    try {
      const walletProvider = await initWalletProvider(runtime);
      const address = walletProvider.getAddress();
      const balance = await walletProvider.getWalletBalance();
      const chain = walletProvider.getCurrentChain();
      const agentName = state?.agentName || "The agent";
      return `${agentName}'s EVM Wallet Address: ${address}
Balance: ${balance} ${chain.nativeCurrency.symbol}
Chain ID: ${chain.id}, Name: ${chain.name}`;
    } catch (error) {
      console.error("Error in EVM wallet provider:", error);
      return null;
    }
  }
};

// src/templates/index.ts
var transferTemplate = `You are an AI assistant specialized in processing cryptocurrency transfer requests. Your task is to extract specific information from user messages and format it into a structured JSON response.

First, review the recent messages from the conversation:

<recent_messages>
{{recentMessages}}
</recent_messages>

Here's a list of supported chains:
<supported_chains>
{{supportedChains}}
</supported_chains>

Your goal is to extract the following information about the requested transfer:
1. Chain to execute on (must be one of the supported chains)
2. Amount to transfer (in ETH, without the coin symbol)
3. Recipient address (must be a valid Ethereum address)
4. Token symbol or address (if not a native token transfer)

Before providing the final JSON output, show your reasoning process inside <analysis> tags. Follow these steps:

1. Identify the relevant information from the user's message:
   - Quote the part of the message mentioning the chain.
   - Quote the part mentioning the amount.
   - Quote the part mentioning the recipient address.
   - Quote the part mentioning the token (if any).

2. Validate each piece of information:
   - Chain: List all supported chains and check if the mentioned chain is in the list.
   - Amount: Attempt to convert the amount to a number to verify it's valid.
   - Address: Check that it starts with "0x" and count the number of characters (should be 42).
   - Token: Note whether it's a native transfer or if a specific token is mentioned.

3. If any information is missing or invalid, prepare an appropriate error message.

4. If all information is valid, summarize your findings.

5. Prepare the JSON structure based on your analysis.

After your analysis, provide the final output in a JSON markdown block. All fields except 'token' are required. The JSON should have this structure:

\`\`\`json
{
    "fromChain": string,
    "amount": string,
    "toAddress": string,
    "token": string | null
}
\`\`\`

Remember:
- The chain name must be a string and must exactly match one of the supported chains.
- The amount should be a string representing the number without any currency symbol.
- The recipient address must be a valid Ethereum address starting with "0x".
- If no specific token is mentioned (i.e., it's a native token transfer), set the "token" field to null.

Now, process the user's request and provide your response.
`;
var bridgeTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested token bridge:
- Token symbol or address to bridge
- Source chain
- Destination chain
- Amount to bridge: Must be a string representing the amount in ether (only number without coin symbol, e.g., "0.1")
- Destination address (if specified)

Respond with a JSON markdown block containing only the extracted values:

\`\`\`json
{
    "token": string | null,
    "fromChain": "ethereum" | "abstract" | "base" | "sepolia" | "bsc" | "arbitrum" | "avalanche" | "polygon" | "optimism" | "cronos" | "gnosis" | "fantom" | "fraxtal" | "klaytn" | "celo" | "moonbeam" | "aurora" | "harmonyOne" | "moonriver" | "arbitrumNova" | "mantle" | "linea" | "scroll" | "filecoin" | "taiko" | "zksync" | "canto" | "alienx" | "gravity" | null,
    "toChain": "ethereum" | "abstract" | "base" | "sepolia" | "bsc" | "arbitrum" | "avalanche" | "polygon" | "optimism" | "cronos" | "gnosis" | "fantom" | "fraxtal" | "klaytn" | "celo" | "moonbeam" | "aurora" | "harmonyOne" | "moonriver" | "arbitrumNova" | "mantle" | "linea" | "scroll" | "filecoin" | "taiko" | "zksync" | "canto" | "alienx" | "gravity" |  null,
    "amount": string | null,
    "toAddress": string | null
}
\`\`\`
`;
var swapTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested token swap:
- Input token symbol or address (the token being sold)
- Output token symbol or address (the token being bought)
- Amount to swap: Must be a string representing the amount in ether (only number without coin symbol, e.g., "0.1")
- Chain to execute on

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined:

\`\`\`json
{
    "inputToken": string | null,
    "outputToken": string | null,
    "amount": string | null,
    "chain": "ethereum" | "abstract" | "base" | "sepolia" | "bsc" | "arbitrum" | "avalanche" | "polygon" | "optimism" | "cronos" | "gnosis" | "fantom" | "klaytn" | "celo" | "moonbeam" | "aurora" | "harmonyOne" | "moonriver" | "arbitrumNova" | "mantle" | "linea" | "scroll" | "filecoin" | "taiko" | "zksync" | "canto" | "alienx" | null,
    "slippage": number | null
}
\`\`\`
`;

// src/actions/bridge.ts
import { parseEther } from "viem";
var BridgeAction = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
    this.config = createConfig({
      integrator: "eliza",
      chains: Object.values(this.walletProvider.chains).map((config) => ({
        id: config.id,
        name: config.name,
        key: config.name.toLowerCase(),
        chainType: "EVM",
        nativeToken: {
          ...config.nativeCurrency,
          chainId: config.id,
          address: "0x0000000000000000000000000000000000000000",
          coinKey: config.nativeCurrency.symbol
        },
        metamask: {
          chainId: `0x${config.id.toString(16)}`,
          chainName: config.name,
          nativeCurrency: config.nativeCurrency,
          rpcUrls: [config.rpcUrls.default.http[0]],
          blockExplorerUrls: [config.blockExplorers.default.url]
        },
        diamondAddress: "0x0000000000000000000000000000000000000000",
        coin: config.nativeCurrency.symbol,
        mainnet: true
      }))
    });
  }
  config;
  async bridge(params) {
    const walletClient = this.walletProvider.getWalletClient(
      params.fromChain
    );
    const [fromAddress] = await walletClient.getAddresses();
    const routes = await getRoutes({
      fromChainId: this.walletProvider.getChainConfigs(params.fromChain).id,
      toChainId: this.walletProvider.getChainConfigs(params.toChain).id,
      fromTokenAddress: params.fromToken,
      toTokenAddress: params.toToken,
      fromAmount: parseEther(params.amount).toString(),
      fromAddress,
      toAddress: params.toAddress || fromAddress
    });
    if (!routes.routes.length) throw new Error("No routes found");
    const execution = await executeRoute(routes.routes[0], this.config);
    const process = execution.steps[0]?.execution?.process[0];
    if (!process?.status || process.status === "FAILED") {
      throw new Error("Transaction failed");
    }
    return {
      hash: process.txHash,
      from: fromAddress,
      to: routes.routes[0].steps[0].estimate.approvalAddress,
      value: BigInt(params.amount),
      chainId: this.walletProvider.getChainConfigs(params.fromChain).id
    };
  }
};
var bridgeAction = {
  name: "bridge",
  description: "Bridge tokens between different chains",
  handler: async (runtime, _message, state, _options, callback) => {
    console.log("Bridge action handler called");
    const walletProvider = await initWalletProvider(runtime);
    const action = new BridgeAction(walletProvider);
    const bridgeContext = composeContext({
      state,
      template: bridgeTemplate
    });
    const content = await generateObjectDeprecated({
      runtime,
      context: bridgeContext,
      modelClass: ModelClass.LARGE
    });
    const bridgeOptions = {
      fromChain: content.fromChain,
      toChain: content.toChain,
      fromToken: content.token,
      toToken: content.token,
      toAddress: content.toAddress,
      amount: content.amount
    };
    try {
      const bridgeResp = await action.bridge(bridgeOptions);
      if (callback) {
        callback({
          text: `Successfully bridge ${bridgeOptions.amount} ${bridgeOptions.fromToken} tokens from ${bridgeOptions.fromChain} to ${bridgeOptions.toChain}
Transaction Hash: ${bridgeResp.hash}`,
          content: {
            success: true,
            hash: bridgeResp.hash,
            recipient: bridgeResp.to,
            chain: bridgeOptions.fromChain
          }
        });
      }
      return true;
    } catch (error) {
      console.error("Error in bridge handler:", error.message);
      if (callback) {
        callback({ text: `Error: ${error.message}` });
      }
      return false;
    }
  },
  template: bridgeTemplate,
  validate: async (runtime) => {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    return typeof privateKey === "string" && privateKey.startsWith("0x");
  },
  examples: [
    [
      {
        user: "user",
        content: {
          text: "Bridge 1 ETH from Ethereum to Base",
          action: "CROSS_CHAIN_TRANSFER"
        }
      }
    ]
  ],
  similes: ["CROSS_CHAIN_TRANSFER", "CHAIN_BRIDGE", "MOVE_CROSS_CHAIN"]
};

// src/actions/swap.ts
import {
  composeContext as composeContext2,
  generateObjectDeprecated as generateObjectDeprecated2,
  ModelClass as ModelClass2,
  elizaLogger as elizaLogger2
} from "@elizaos/core";
import {
  createConfig as createConfig2,
  executeRoute as executeRoute2,
  getRoutes as getRoutes2
} from "@lifi/sdk";
import {
  encodeFunctionData,
  parseAbi,
  parseUnits
} from "viem";
var SwapAction = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
    this.walletProvider = walletProvider;
    const lifiChains = [];
    for (const config of Object.values(this.walletProvider.chains)) {
      try {
        lifiChains.push({
          id: config.id,
          name: config.name,
          key: config.name.toLowerCase(),
          chainType: "EVM",
          nativeToken: {
            ...config.nativeCurrency,
            chainId: config.id,
            address: "0x0000000000000000000000000000000000000000",
            coinKey: config.nativeCurrency.symbol,
            priceUSD: "0",
            logoURI: "",
            symbol: config.nativeCurrency.symbol,
            decimals: config.nativeCurrency.decimals,
            name: config.nativeCurrency.name
          },
          rpcUrls: {
            public: { http: [config.rpcUrls.default.http[0]] }
          },
          blockExplorerUrls: [config.blockExplorers.default.url],
          metamask: {
            chainId: `0x${config.id.toString(16)}`,
            chainName: config.name,
            nativeCurrency: config.nativeCurrency,
            rpcUrls: [config.rpcUrls.default.http[0]],
            blockExplorerUrls: [config.blockExplorers.default.url]
          },
          coin: config.nativeCurrency.symbol,
          mainnet: true,
          diamondAddress: "0x0000000000000000000000000000000000000000"
        });
      } catch {
      }
    }
    this.lifiConfig = createConfig2({
      integrator: "eliza",
      chains: lifiChains
    });
    this.bebopChainsMap = {
      mainnet: "ethereum"
    };
  }
  lifiConfig;
  bebopChainsMap;
  async swap(params) {
    const walletClient = this.walletProvider.getWalletClient(params.chain);
    const [fromAddress] = await walletClient.getAddresses();
    const sortedQuotes = await this.getSortedQuotes(
      fromAddress,
      params
    );
    for (const quote of sortedQuotes) {
      let res;
      switch (quote.aggregator) {
        case "lifi":
          res = await this.executeLifiQuote(quote);
          break;
        case "bebop":
          res = await this.executeBebopQuote(quote, params);
          break;
        default:
          throw new Error("No aggregator found");
      }
      if (res !== void 0) return res;
    }
    throw new Error("Execution failed");
  }
  async getSortedQuotes(fromAddress, params) {
    const decimalsAbi = parseAbi([
      "function decimals() view returns (uint8)"
    ]);
    const decimals = await this.walletProvider.getPublicClient(params.chain).readContract({
      address: params.fromToken,
      abi: decimalsAbi,
      functionName: "decimals"
    });
    const quotes = await Promise.all([
      this.getLifiQuote(fromAddress, params, decimals),
      this.getBebopQuote(fromAddress, params, decimals)
    ]);
    const sortedQuotes = quotes.filter(
      (quote) => quote !== void 0
    );
    sortedQuotes.sort(
      (a, b) => BigInt(a.minOutputAmount) > BigInt(b.minOutputAmount) ? -1 : 1
    );
    if (sortedQuotes.length === 0) throw new Error("No routes found");
    return sortedQuotes;
  }
  async getLifiQuote(fromAddress, params, fromTokenDecimals) {
    try {
      const routes = await getRoutes2({
        fromChainId: this.walletProvider.getChainConfigs(params.chain).id,
        toChainId: this.walletProvider.getChainConfigs(params.chain).id,
        fromTokenAddress: params.fromToken,
        toTokenAddress: params.toToken,
        fromAmount: parseUnits(
          params.amount,
          fromTokenDecimals
        ).toString(),
        fromAddress,
        options: {
          slippage: params.slippage / 100 || 5e-3,
          order: "RECOMMENDED"
        }
      });
      if (!routes.routes.length) throw new Error("No routes found");
      return {
        aggregator: "lifi",
        minOutputAmount: routes.routes[0].steps[0].estimate.toAmountMin,
        swapData: routes.routes[0]
      };
    } catch (error) {
      elizaLogger2.error("Error in getLifiQuote:", error.message);
      return void 0;
    }
  }
  async getBebopQuote(fromAddress, params, fromTokenDecimals) {
    try {
      const url = `https://api.bebop.xyz/router/${this.bebopChainsMap[params.chain] ?? params.chain}/v1/quote`;
      const reqParams = new URLSearchParams({
        sell_tokens: params.fromToken,
        buy_tokens: params.toToken,
        sell_amounts: parseUnits(
          params.amount,
          fromTokenDecimals
        ).toString(),
        taker_address: fromAddress,
        approval_type: "Standard",
        skip_validation: "true",
        gasless: "false",
        source: "eliza"
      });
      const response = await fetch(`${url}?${reqParams.toString()}`, {
        method: "GET",
        headers: { accept: "application/json" }
      });
      if (!response.ok) {
        throw Error(response.statusText);
      }
      const data = await response.json();
      const route = {
        data: data.routes[0].quote.tx.data,
        sellAmount: parseUnits(
          params.amount,
          fromTokenDecimals
        ).toString(),
        approvalTarget: data.routes[0].quote.approvalTarget,
        from: data.routes[0].quote.tx.from,
        value: data.routes[0].quote.tx.value.toString(),
        to: data.routes[0].quote.tx.to,
        gas: data.routes[0].quote.tx.gas.toString(),
        gasPrice: data.routes[0].quote.tx.gasPrice.toString()
      };
      return {
        aggregator: "bebop",
        minOutputAmount: data.routes[0].quote.buyTokens[params.toToken].minimumAmount.toString(),
        swapData: route
      };
    } catch (error) {
      elizaLogger2.error("Error in getBebopQuote:", error.message);
      return void 0;
    }
  }
  async executeLifiQuote(quote) {
    try {
      const route = quote.swapData;
      const execution = await executeRoute2(
        quote.swapData,
        this.lifiConfig
      );
      const process = execution.steps[0]?.execution?.process[0];
      if (!process?.status || process.status === "FAILED") {
        throw new Error("Transaction failed");
      }
      return {
        hash: process.txHash,
        from: route.fromAddress,
        to: route.steps[0].estimate.approvalAddress,
        value: 0n,
        data: process.data,
        chainId: route.fromChainId
      };
    } catch (error) {
      elizaLogger2.error(`Failed to execute lifi quote: ${error}`);
      return void 0;
    }
  }
  async executeBebopQuote(quote, params) {
    try {
      const bebopRoute = quote.swapData;
      const allowanceAbi = parseAbi([
        "function allowance(address,address) view returns (uint256)"
      ]);
      const allowance = await this.walletProvider.getPublicClient(params.chain).readContract({
        address: params.fromToken,
        abi: allowanceAbi,
        functionName: "allowance",
        args: [bebopRoute.from, bebopRoute.approvalTarget]
      });
      if (allowance < BigInt(bebopRoute.sellAmount)) {
        const approvalData = encodeFunctionData({
          abi: parseAbi(["function approve(address,uint256)"]),
          functionName: "approve",
          args: [
            bebopRoute.approvalTarget,
            BigInt(bebopRoute.sellAmount)
          ]
        });
        await this.walletProvider.getWalletClient(params.chain).sendTransaction({
          account: this.walletProvider.getWalletClient(
            params.chain
          ).account,
          to: params.fromToken,
          value: 0n,
          data: approvalData,
          kzg: {
            blobToKzgCommitment: (_) => {
              throw new Error("Function not implemented.");
            },
            computeBlobKzgProof: (_blob, _commitment) => {
              throw new Error("Function not implemented.");
            }
          },
          chain: void 0
        });
      }
      const hash = await this.walletProvider.getWalletClient(params.chain).sendTransaction({
        account: this.walletProvider.getWalletClient(params.chain).account,
        to: bebopRoute.to,
        value: BigInt(bebopRoute.value),
        data: bebopRoute.data,
        kzg: {
          blobToKzgCommitment: (_) => {
            throw new Error("Function not implemented.");
          },
          computeBlobKzgProof: (_blob, _commitment) => {
            throw new Error("Function not implemented.");
          }
        },
        chain: void 0
      });
      return {
        hash,
        from: this.walletProvider.getWalletClient(params.chain).account.address,
        to: bebopRoute.to,
        value: BigInt(bebopRoute.value),
        data: bebopRoute.data
      };
    } catch (error) {
      elizaLogger2.error(`Failed to execute bebop quote: ${error}`);
      return void 0;
    }
  }
};
var swapAction = {
  name: "swap",
  description: "Swap tokens on the same chain",
  handler: async (runtime, _message, state, _options, callback) => {
    elizaLogger2.log("Swap action handler called");
    const walletProvider = await initWalletProvider(runtime);
    const action = new SwapAction(walletProvider);
    const swapContext = composeContext2({
      state,
      template: swapTemplate
    });
    const content = await generateObjectDeprecated2({
      runtime,
      context: swapContext,
      modelClass: ModelClass2.LARGE
    });
    const swapOptions = {
      chain: content.chain,
      fromToken: content.inputToken,
      toToken: content.outputToken,
      amount: content.amount,
      slippage: content.slippage
    };
    try {
      const swapResp = await action.swap(swapOptions);
      if (callback) {
        callback({
          text: `Successfully swap ${swapOptions.amount} ${swapOptions.fromToken} tokens to ${swapOptions.toToken}
Transaction Hash: ${swapResp.hash}`,
          content: {
            success: true,
            hash: swapResp.hash,
            recipient: swapResp.to,
            chain: content.chain
          }
        });
      }
      return true;
    } catch (error) {
      elizaLogger2.error("Error in swap handler:", error.message);
      if (callback) {
        callback({ text: `Error: ${error.message}` });
      }
      return false;
    }
  },
  template: swapTemplate,
  validate: async (runtime) => {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    return typeof privateKey === "string" && privateKey.startsWith("0x");
  },
  examples: [
    [
      {
        user: "user",
        content: {
          text: "Swap 1 ETH for USDC on Base",
          action: "TOKEN_SWAP"
        }
      }
    ]
  ],
  similes: ["TOKEN_SWAP", "EXCHANGE_TOKENS", "TRADE_TOKENS"]
};

// src/actions/transfer.ts
import { formatEther, parseEther as parseEther2 } from "viem";
import {
  composeContext as composeContext3,
  generateObjectDeprecated as generateObjectDeprecated3,
  ModelClass as ModelClass3
} from "@elizaos/core";
var TransferAction = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
  }
  async transfer(params) {
    console.log(
      `Transferring: ${params.amount} tokens to (${params.toAddress} on ${params.fromChain})`
    );
    if (!params.data) {
      params.data = "0x";
    }
    this.walletProvider.switchChain(params.fromChain);
    const walletClient = this.walletProvider.getWalletClient(
      params.fromChain
    );
    try {
      const hash = await walletClient.sendTransaction({
        account: walletClient.account,
        to: params.toAddress,
        value: parseEther2(params.amount),
        data: params.data,
        kzg: {
          blobToKzgCommitment: (_) => {
            throw new Error("Function not implemented.");
          },
          computeBlobKzgProof: (_blob, _commitment) => {
            throw new Error("Function not implemented.");
          }
        },
        chain: void 0
      });
      return {
        hash,
        from: walletClient.account.address,
        to: params.toAddress,
        value: parseEther2(params.amount),
        data: params.data
      };
    } catch (error) {
      throw new Error(`Transfer failed: ${error.message}`);
    }
  }
};
var buildTransferDetails = async (state, runtime, wp) => {
  const chains = Object.keys(wp.chains);
  state.supportedChains = chains.map((item) => `"${item}"`).join("|");
  const context = composeContext3({
    state,
    template: transferTemplate
  });
  const transferDetails = await generateObjectDeprecated3({
    runtime,
    context,
    modelClass: ModelClass3.SMALL
  });
  const existingChain = wp.chains[transferDetails.fromChain];
  if (!existingChain) {
    throw new Error(
      "The chain " + transferDetails.fromChain + " not configured yet. Add the chain or choose one from configured: " + chains.toString()
    );
  }
  return transferDetails;
};
var transferAction = {
  name: "transfer",
  description: "Transfer tokens between addresses on the same chain",
  handler: async (runtime, message, state, _options, callback) => {
    if (!state) {
      state = await runtime.composeState(message);
    } else {
      state = await runtime.updateRecentMessageState(state);
    }
    console.log("Transfer action handler called");
    const walletProvider = await initWalletProvider(runtime);
    const action = new TransferAction(walletProvider);
    const paramOptions = await buildTransferDetails(
      state,
      runtime,
      walletProvider
    );
    try {
      const transferResp = await action.transfer(paramOptions);
      if (callback) {
        callback({
          text: `Successfully transferred ${paramOptions.amount} tokens to ${paramOptions.toAddress}
Transaction Hash: ${transferResp.hash}`,
          content: {
            success: true,
            hash: transferResp.hash,
            amount: formatEther(transferResp.value),
            recipient: transferResp.to,
            chain: paramOptions.fromChain
          }
        });
      }
      return true;
    } catch (error) {
      console.error("Error during token transfer:", error);
      if (callback) {
        callback({
          text: `Error transferring tokens: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  },
  validate: async (runtime) => {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    return typeof privateKey === "string" && privateKey.startsWith("0x");
  },
  examples: [
    [
      {
        user: "assistant",
        content: {
          text: "I'll help you transfer 1 ETH to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
          action: "SEND_TOKENS"
        }
      },
      {
        user: "user",
        content: {
          text: "Transfer 1 ETH to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
          action: "SEND_TOKENS"
        }
      }
    ]
  ],
  similes: ["SEND_TOKENS", "TOKEN_TRANSFER", "MOVE_TOKENS"]
};

// src/types/index.ts
import * as viemChains2 from "viem/chains";
var _SupportedChainList = Object.keys(viemChains2);
var VoteType = /* @__PURE__ */ ((VoteType2) => {
  VoteType2[VoteType2["AGAINST"] = 0] = "AGAINST";
  VoteType2[VoteType2["FOR"] = 1] = "FOR";
  VoteType2[VoteType2["ABSTAIN"] = 2] = "ABSTAIN";
  return VoteType2;
})(VoteType || {});

// src/index.ts
var evmPlugin = {
  name: "evm",
  description: "EVM blockchain integration plugin",
  providers: [evmWalletProvider],
  evaluators: [],
  services: [],
  actions: [transferAction, bridgeAction, swapAction]
};
var index_default = evmPlugin;
export {
  BridgeAction,
  SwapAction,
  TransferAction,
  VoteType,
  WalletProvider,
  bridgeAction,
  bridgeTemplate,
  index_default as default,
  evmPlugin,
  evmWalletProvider,
  initWalletProvider,
  swapAction,
  swapTemplate,
  transferAction
};
//# sourceMappingURL=index.js.map
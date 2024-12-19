import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import { EntryPoint, EntryPoint__factory, SimpleAccount, SimpleAccountFactory, SimpleAccountFactory__factory, SimpleAccount__factory } from '../typechain'
import { ethers } from 'hardhat'
import { ERC4337EthersProvider, SimpleAccountAPI } from '@account-abstraction/sdk'
import { HttpRpcClient } from '@account-abstraction/sdk/dist/src/HttpRpcClient'
import { BigNumber, providers, Signer, Wallet } from 'ethers'
import { createBundlerClient, entryPoint06Address } from "viem/account-abstraction"
import { sepolia } from "viem/chains"
import { createSmartAccountClient } from 'permissionless'
import { createPublicClient, Hex, http, parseEther, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { toSimpleSmartAccount } from 'permissionless/accounts'
import { createPimlicoClient } from "permissionless/clients/pimlico"

interface DeploymentCache {
  accountOwnerPrivateKey: string;
  simpleAccountAddress: string;
  simpleAccountFactoryAddress: string;
}

const CACHE_FILE = path.join(__dirname, '../.deployment-cache.json');

// Cache management functions
function loadCache(): DeploymentCache | null {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (error) {
    console.log('Error reading cache:', error);
  }
  return null;
}

function saveCache(cache: DeploymentCache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    console.log('Deployment cache saved');
  } catch (error) {
    console.log('Error saving cache:', error);
  }
}

// Contract deployment functions
async function getOrDeployEntryPoint(signer: Signer): Promise<EntryPoint> {
  if (process.env.DEPLOY_ENTRYPOINT === "true") {
    console.log("Deploying EntryPoint v6")
    return await new EntryPoint__factory(signer).deploy()
  }
  console.log("Using existing EntryPoint v6")
  return EntryPoint__factory.connect(entryPoint06Address, signer)
}

async function getOrDeploySimpleAccountFactory(
  signer: Signer,
  entryPointAddress: string,
  cache: DeploymentCache | null
): Promise<SimpleAccountFactory> {
  if (cache?.simpleAccountFactoryAddress) {
    const factory = SimpleAccountFactory__factory.connect(cache.simpleAccountFactoryAddress, signer)
    console.log(`Using cached SimpleAccountFactory at ${factory.address}`)
    return factory
  }
  
  if (process.env.SIMPLE_ACCOUNT_FACTORY_ADDRESS) {
    const factory = SimpleAccountFactory__factory.connect(process.env.SIMPLE_ACCOUNT_FACTORY_ADDRESS, signer)
    console.log(`Using existing SimpleAccountFactory at ${factory.address}`)
    return factory
  }
  
  console.log(`Deploying new SimpleAccountFactory`)
  const factory = await new SimpleAccountFactory__factory(signer).deploy(entryPointAddress)
  console.log('SimpleAccountFactory deployed to:', factory.address)
  return factory
}

async function getOrCreateAccountOwner(
  provider: providers.Provider,
  cache: DeploymentCache | null
): Promise<Wallet> {
  if (cache?.accountOwnerPrivateKey) {
    const wallet = new ethers.Wallet(cache.accountOwnerPrivateKey, provider);
    console.log('Using cached account owner wallet');
    return wallet;
  }
  
  const wallet = ethers.Wallet.createRandom().connect(provider);
  console.log('Created new account owner wallet');
  return wallet;
}

async function getOrDeploySimpleAccount(
  signer: Signer,
  factory: SimpleAccountFactory,
  accountOwner: Wallet,
  cache: DeploymentCache | null
): Promise<SimpleAccount> {
  if (cache?.simpleAccountAddress) {
    const account = SimpleAccount__factory.connect(cache.simpleAccountAddress, accountOwner);
    console.log(`Using cached SimpleAccount at ${account.address}`);
    return account;
  }

  const createAccountTx = await factory.connect(signer).createAccount(accountOwner.address, 0);
  await createAccountTx.wait();
  const accountAddr = await factory.getAddress(accountOwner.address, 0);
  const account = SimpleAccount__factory.connect(accountAddr, accountOwner);
  console.log(`SimpleAccount deployed to: ${account.address}`);
  return account;
}

// Add this after the other helper functions
async function logBalances(
  provider: providers.Provider,
  ethersSigner: Signer,
  accountOwner: Wallet,
  simpleAccount: SimpleAccount
) {
  const signerAddress = await ethersSigner.getAddress()
  const signerBalance = await provider.getBalance(signerAddress)
  const accountOwnerBalance = await provider.getBalance(accountOwner.address)
  const simpleAccountBalance = await provider.getBalance(simpleAccount.address)

  console.log('\nAccount Balances:')
  console.log(`Signer (${signerAddress}): ${ethers.utils.formatEther(signerBalance)} ETH`)
  console.log(`Account Owner (${accountOwner.address}): ${ethers.utils.formatEther(accountOwnerBalance)} ETH`)
  console.log(`Simple Account (${simpleAccount.address}): ${ethers.utils.formatEther(simpleAccountBalance)} ETH\n`)
}

// Add this new helper function
async function fundSimpleAccount(
  signer: Signer,
  simpleAccount: SimpleAccount,
  amount: BigNumber
) {
  console.log(`\nFunding Simple Account with ${ethers.utils.formatEther(amount)} ETH`)
  const fundTx = await signer.sendTransaction({
    to: simpleAccount.address,
    value: amount
  })
  await fundTx.wait()
  console.log('Funding transaction confirmed')
}

// Add this helper function
async function depositToEntryPoint(
  signer: Signer,
  simpleAccount: SimpleAccount,
  amount: BigNumber
) {
  console.log(`\nDepositing ${ethers.utils.formatEther(amount)} ETH to EntryPoint for SimpleAccount`)
  
  const entryPoint = EntryPoint__factory.connect(entryPoint06Address, signer)
  
  const depositTx = await entryPoint.depositTo(simpleAccount.address, {
    value: amount
  })
  await depositTx.wait()
  
  // Verify deposit
  const depositInfo = await entryPoint.deposits(simpleAccount.address)
  console.log(`Deposit successful. Balance at EntryPoint: ${ethers.utils.formatEther(depositInfo.deposit)} ETH`)
}

(async () => {
  dotenv.config()
  const provider = ethers.provider
  const ethersSigner = provider.getSigner()
  const cache = loadCache()

  const entryPoint = await getOrDeployEntryPoint(ethersSigner)
  const simpleAccountFactory = await getOrDeploySimpleAccountFactory(ethersSigner, entryPoint.address, cache)
  const accountOwner = await getOrCreateAccountOwner(provider, cache)
  const simpleAccount = await getOrDeploySimpleAccount(ethersSigner, simpleAccountFactory, accountOwner, cache)

  // Log initial balances
  await logBalances(provider, ethersSigner, accountOwner, simpleAccount)

  // Save deployment information if new deployment
  if (!cache) {
    saveCache({
      accountOwnerPrivateKey: accountOwner.privateKey,
      simpleAccountAddress: simpleAccount.address,
      simpleAccountFactoryAddress: simpleAccountFactory.address,
    })
  }


  console.log('\nFunding Account Owner...')
  const fundOwnerTx = await ethersSigner.sendTransaction({
    to: accountOwner.address,
    value: ethers.utils.parseEther("0.0005") 
  })
  await fundOwnerTx.wait()

  await fundSimpleAccount(
    ethersSigner, 
    simpleAccount, 
    ethers.utils.parseEther("0.1")
  )

  await depositToEntryPoint(
    ethersSigner,
    simpleAccount,
    ethers.utils.parseEther("0.001") 
  )

  await logBalances(provider, ethersSigner, accountOwner, simpleAccount)

  const publicClient = createPublicClient({
    transport: http(`https://sepolia.infura.io/v3/${process.env.INFURA_ID}`),
    chain: sepolia,
  })
   
  const paymasterClient = createPimlicoClient({
    entryPoint: {
      address: entryPoint06Address,
      version: "0.6",
    },
    transport: http("https://api.pimlico.io/v2/sepolia/rpc?apikey=" + process.env.PIMLICO_API_KEY),
  })

  const viemSimpleAccount = await toSimpleSmartAccount({
    client: publicClient,
    address: simpleAccount.address as Hex, // use the address of the simple account we deployed
    owner: privateKeyToAccount(accountOwner.privateKey as Hex),
    entryPoint: {
      address: entryPoint06Address,
      version: "0.6",
    },
  })

  const smartAccountClient = createSmartAccountClient({
    account: viemSimpleAccount,
    chain: sepolia,
    paymaster: paymasterClient,
    bundlerTransport: http("https://api.pimlico.io/v2/sepolia/rpc?apikey=" + process.env.PIMLICO_API_KEY),
    userOperation: {
      estimateFeesPerGas: async () => (await paymasterClient.getUserOperationGasPrice()).fast,
    },
  })

  const txHash = await smartAccountClient.sendTransaction({
    to: zeroAddress,
    value: parseEther("0.00001"),
  })
  console.log(`UserOperation hash: ${txHash}`)

})()
// Account Balances:
// Signer (0xD06A2Db5Ed0C51c2eCCcc9f200C5b08E83218F56): 0.000507901282741307 ETH
// Account Owner (0x53249d0d48cA51E6924BbA648335cD1757618d2e): 0.0005 ETH
// Simple Account (0x2e50C3B85d867b765C30d9A8C71a59e475A1c5D7): 0.0029 ETH

// /Users/samdevo/Desktop/stable-project/node_modules/viem/account-abstraction/utils/errors/getUserOperationError.ts:68
//   return new UserOperationExecutionError(cause, {
//          ^
// UserOperationExecutionError: The `validateUserOp` function on the Smart Account reverted.

// Request Arguments:
//   callData:              0xb61d27f60000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000009184e72a00000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000
//   callGasLimit:          0
//   initCode:              0x
//   maxFeePerGas:          8.891133505 gwei
//   maxPriorityFeePerGas:  0.035503358 gwei
//   nonce:                 31998672606740085526295063035904
//   paymasterAndData:      0x00000000000000fB866DaAA79352cC568a005D9600000000000000000000000000cd91f19f0f19ce862d7bec7b7d9b95457145afc6f639c28fd0360f488937bfa41e6eedcd3a46054fd95fcd0e3ef6b0bc0a615c4d975eef55c8a3517257904d5b1c
//   preVerificationGas:    0
//   sender:                0x2e50C3B85d867b765C30d9A8C71a59e475A1c5D7
//   signature:             0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c
//   verificationGasLimit:  0

// Details: UserOperation reverted during simulation with reason: AA23 reverted (or OOG)
// Version: viem@2.21.55
//     at getUserOperationError (/Users/samdevo/Desktop/stable-project/node_modules/viem/account-abstraction/utils/errors/getUserOperationError.ts:68:10)
//     at estimateUserOperationGas (/Users/samdevo/Desktop/stable-project/node_modules/viem/account-abstraction/actions/bundler/estimateUserOperationGas.ts:198:32)
//     ... 4 lines matching cause stack trace ...
//     at async /Users/samdevo/Desktop/stable-project/src/deploySimpleAccount.ts:285:18 {
//   cause: SmartAccountFunctionRevertedError: The `validateUserOp` function on the Smart Account reverted.
  
//   Details: UserOperation reverted during simulation with reason: AA23 reverted (or OOG)
//   Version: viem@2.21.55
//       at getBundlerError (/Users/samdevo/Desktop/stable-project/node_modules/viem/account-abstraction/utils/errors/getBundlerError.ts:219:12)
//       at /Users/samdevo/Desktop/stable-project/node_modules/viem/account-abstraction/utils/errors/getUserOperationError.ts:54:34
//       at getUserOperationError (/Users/samdevo/Desktop/stable-project/node_modules/viem/account-abstraction/utils/errors/getUserOperationError.ts:67:5)
//       at estimateUserOperationGas (/Users/samdevo/Desktop/stable-project/node_modules/viem/account-abstraction/actions/bundler/estimateUserOperationGas.ts:198:32)
//       at processTicksAndRejections (node:internal/process/task_queues:105:5)
//       at async prepareUserOperation (/Users/samdevo/Desktop/stable-project/node_modules/viem/account-abstraction/actions/bundler/prepareUserOperation.ts:579:19)
//       at async sendUserOperation (/Users/samdevo/Desktop/stable-project/node_modules/viem/account-abstraction/actions/bundler/sendUserOperation.ts:132:7)
//       at async sendTransaction (/Users/samdevo/Desktop/stable-project/node_modules/permissionless/actions/smartAccount/sendTransaction.ts:98:22)
//       at async /Users/samdevo/Desktop/stable-project/src/deploySimpleAccount.ts:285:18 {
//     details: 'UserOperation reverted during simulation with reason: AA23 reverted (or OOG)',
//     docsPath: undefined,
//     metaMessages: undefined,
//     shortMessage: 'The `validateUserOp` function on the Smart Account reverted.',
//     version: '2.21.55',
//     [cause]: RpcRequestError: RPC Request failed.
    
//     URL: https://api.pimlico.io/v2/sepolia/rpc?apikey=pim_8HYvBEqXYmH852C1ZhfspL
//     Request body: {"method":"eth_estimateUserOperationGas","params":[{"callData":"0xb61d27f60000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000009184e72a00000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000","callGasLimit":"0x0","initCode":"0x","maxFeePerGas":"0x211f3ee41","maxPriorityFeePerGas":"0x21dbcfe","nonce":"0x193e1499b940000000000000000","paymasterAndData":"0x00000000000000fB866DaAA79352cC568a005D9600000000000000000000000000cd91f19f0f19ce862d7bec7b7d9b95457145afc6f639c28fd0360f488937bfa41e6eedcd3a46054fd95fcd0e3ef6b0bc0a615c4d975eef55c8a3517257904d5b1c","preVerificationGas":"0x0","sender":"0x2e50C3B85d867b765C30d9A8C71a59e475A1c5D7","signature":"0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c","verificationGasLimit":"0x0"},"0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"]}
    
//     Details: UserOperation reverted during simulation with reason: AA23 reverted (or OOG)
//     Version: viem@2.21.55
//         at request (/Users/samdevo/Desktop/stable-project/node_modules/viem/clients/transports/http.ts:132:19)
//         at processTicksAndRejections (node:internal/process/task_queues:105:5)
//         at async delay.count.count (/Users/samdevo/Desktop/stable-project/node_modules/viem/utils/buildRequest.ts:118:22)
//         at async attemptRetry (/Users/samdevo/Desktop/stable-project/node_modules/viem/utils/promise/withRetry.ts:44:22) {
//       details: 'UserOperation reverted during simulation with reason: AA23 reverted (or OOG)',
//       docsPath: undefined,
//       metaMessages: [Array],
//       shortMessage: 'RPC Request failed.',
//       version: '2.21.55',
//       code: -32521,
//       [cause]: [Object]
//     }
//   },
//   details: 'UserOperation reverted during simulation with reason: AA23 reverted (or OOG)',
//   docsPath: undefined,
//   metaMessages: [
//     'Request Arguments:',
//     '  callData:              0xb61d27f60000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000009184e72a00000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000\n' +
//       '  callGasLimit:          0\n' +
//       '  initCode:              0x\n' +
//       '  maxFeePerGas:          8.891133505 gwei\n' +
//       '  maxPriorityFeePerGas:  0.035503358 gwei\n' +
//       '  nonce:                 31998672606740085526295063035904\n' +
//       '  paymasterAndData:      0x00000000000000fB866DaAA79352cC568a005D9600000000000000000000000000cd91f19f0f19ce862d7bec7b7d9b95457145afc6f639c28fd0360f488937bfa41e6eedcd3a46054fd95fcd0e3ef6b0bc0a615c4d975eef55c8a3517257904d5b1c\n' +
//       '  preVerificationGas:    0\n' +
//       '  sender:                0x2e50C3B85d867b765C30d9A8C71a59e475A1c5D7\n' +
//       '  signature:             0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c\n' +
//       '  verificationGasLimit:  0'
//   ],
//   shortMessage: 'The `validateUserOp` function on the Smart Account reverted.',
//   version: '2.21.55'
// }


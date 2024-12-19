import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import { EntryPoint, EntryPoint__factory, SimpleAccount, SimpleAccountFactory, SimpleAccountFactory__factory, SimpleAccount__factory } from '../typechain'
import { ethers } from 'hardhat'
import { ERC4337EthersProvider, SimpleAccountAPI } from '@account-abstraction/sdk'
import { HttpRpcClient } from '@account-abstraction/sdk/dist/src/HttpRpcClient'
import { BigNumber, providers, Signer, Wallet } from 'ethers'
import { entryPoint06Address } from "viem/account-abstraction"
import { sepolia } from "viem/chains"

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

// Main execution
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

  const bundler = new HttpRpcClient(
    "https://api.pimlico.io/v2/11155111/rpc?apikey=" + process.env.PIMLICO_API_KEY,
    entryPoint06Address,
    sepolia.id
  )

  const accountAPI = new SimpleAccountAPI({
    provider,
    entryPointAddress: entryPoint06Address,
    owner: accountOwner,
    factoryAddress: simpleAccountFactory.address
  })

  await accountAPI.init()

  // Fund the Simple Account with 0.01 ETH (adjust amount as needed)
  
  // await fundSimpleAccount(
  //   ethersSigner, 
  //   simpleAccount, 
  //   ethers.utils.parseEther("0.0001")
  // )

  // Create AA provider properly
  const aaProvider = await new ERC4337EthersProvider(
    sepolia.id,
    {
      entryPointAddress: entryPoint06Address,
      bundlerUrl: "https://api.pimlico.io/v2/11155111/rpc?apikey=" + process.env.PIMLICO_API_KEY
    },
    accountOwner,
    provider,
    bundler,
    entryPoint,
    accountAPI
  ).init()

  // Get the AA signer
  const aaSigner = aaProvider.getSigner()

  // Replace the transaction creation and sending code with:
  const tx = {
    target: "0x0000000000000000000000000000000000000000",
    value: ethers.utils.parseEther("0.0001"),
    data: "0x"
  }

  // Create unsigned UserOp
  const userOp = await accountAPI.createUnsignedUserOp({
    ...tx,
    maxFeePerGas: await provider.getGasPrice(),
    maxPriorityFeePerGas: await provider.getGasPrice()
  })

  // Get gas estimate from bundler first
  const gasEstimate = await bundler.estimateUserOpGas(userOp)

  // Use the bundler's estimates and add our overhead
  userOp.callGasLimit = (BigInt(gasEstimate.callGasLimit) + BigInt(50000)).toString()
  userOp.preVerificationGas = (BigInt(gasEstimate.preVerificationGas) + BigInt(50000)).toString()
  userOp.verificationGasLimit = (BigInt(gasEstimate.verificationGas) + BigInt(50000)).toString()

  // Sign the UserOp
  const signedUserOp = await accountAPI.signUserOp(userOp)

  // Send the UserOp through the bundler
  const userOpHash = await bundler.sendUserOpToBundler(signedUserOp)
  console.log(`UserOperation hash: ${userOpHash}`)

  // Wait for the transaction
  const receipt = await accountAPI.getUserOpReceipt(userOpHash)
  console.log(`Transaction confirmed in block ${receipt}`)

  // Log balances after transaction
  console.log('\nBalances after transaction:')
  await logBalances(provider, ethersSigner, accountOwner, simpleAccount)
})()

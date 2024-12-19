import * as dotenv from 'dotenv'
import { EntryPoint, EntryPoint__factory, SimpleAccount, SimpleAccountFactory, SimpleAccountFactory__factory, SimpleAccount__factory } from '../typechain'

import { create } from 'domain'
import { ethers } from 'hardhat'

import { createSmartAccountClient } from "permissionless"
import { toSimpleSmartAccount } from "permissionless/accounts"
import { createPimlicoClient } from "permissionless/clients/pimlico"
import { createPublicClient, getContract, Hex, http, parseEther, zeroAddress } from "viem"
import { entryPoint06Address } from "viem/account-abstraction"
import { privateKeyToAccount } from "viem/accounts"
import { sepolia } from "viem/chains"
import { UserOperation } from 'viem/account-abstraction'

import { ERC4337EthersProvider, SimpleAccountAPI } from '@account-abstraction/sdk'
import { HttpRpcClient } from '@account-abstraction/sdk/dist/src/HttpRpcClient'
import { DefaultGasOverheads, PaymasterAPI } from '@account-abstraction/sdk'


(async () => {
  dotenv.config()
  const provider = ethers.provider
  const ethersSigner = provider.getSigner()
  // console.log(await provider.getNetwork())
  const signerBalance = await provider.getBalance(ethersSigner.getAddress())
  console.log(`Signer balance: ${signerBalance.toString()}. ETH: ${ethers.utils.formatEther(signerBalance)}`)

  let entryPointAddress: string
  let entryPoint: EntryPoint
  if (process.env.DEPLOY_ENTRYPOINT == "true") {
    console.log("Deploying EntryPoint v6")
    entryPoint = await new EntryPoint__factory(ethersSigner).deploy()
    entryPointAddress = entryPoint.address
  }
  else {
    console.log("Using existing EntryPoint v6")
    entryPoint = EntryPoint__factory.connect(entryPoint06Address, ethersSigner)
    entryPointAddress = entryPoint06Address
  }

  // Deploy SimpleAccountFactory if necessary
  let simpleAccountFactory: SimpleAccountFactory
  if (process.env.SIMPLE_ACCOUNT_FACTORY_ADDRESS == null) {
    console.log(`SIMPLE_ACCOUNT_ADDRESS is not set, deploying SimpleAccount`)
    simpleAccountFactory = await new SimpleAccountFactory__factory(ethersSigner).deploy(entryPoint.address)
    console.log('SimpleAccountFactory deployed to:', simpleAccountFactory.address)
  } else {
    simpleAccountFactory = SimpleAccountFactory__factory.connect(process.env.SIMPLE_ACCOUNT_FACTORY_ADDRESS!, ethersSigner)
    console.log(`Using existing SimpleAccountFactory at ${simpleAccountFactory.address}`)
  }

  // create a random wallet as our "EOA"
  const accountOwner = ethers.Wallet.createRandom().connect(provider)

  // static call to get the deterministic address of the new SimpleAccount
  const simpleAccountAddr = await simpleAccountFactory.callStatic.createAccount(accountOwner.address, 0)

  const createAccountTx = await simpleAccountFactory.createAccount(accountOwner.address, 0)
  const simpleAccount = SimpleAccount__factory.connect(simpleAccountAddr, accountOwner)
  console.log(`SimpleAccount deployed to: ${simpleAccount.address}`)
  
  // const publicClient = createPublicClient({
  //   transport: http(`https://sepolia.infura.io/v3/${process.env.INFURA_ID}`),
  // })

  // const viemOwner = await privateKeyToAccount(accountOwner.privateKey as Hex)

  // const simpleSmartAccount = await toSimpleSmartAccount({
  //   owner: viemOwner,
  //   address: simpleAccountAddr as Hex,
  //   client: publicClient,
  //   entryPoint: {
  //     address: entryPoint06Address,
  //     version: "0.7"
  //   }
  // })

  if (process.env.PIMLICO_API_KEY == null) {
    console.log("PIMLICO_API_KEY is not set, skipping transaction")
    return
  }

  console.log(`Pimlico API key: ${process.env.PIMLICO_API_KEY}`)

  const accountAPI = new SimpleAccountAPI({
    provider,
    entryPointAddress: entryPoint06Address,
    owner: accountOwner,
    factoryAddress: simpleAccountFactory.address
  })

  const bundler = new HttpRpcClient(
    "https://api.pimlico.io/v2/11155111/rpc?apikey=" + process.env.PIMLICO_API_KEY, // or any other AA bundler endpoint
    entryPoint06Address,
    sepolia.id
  )

  await accountAPI.init()

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

  // Create RPC client for the bundler

  const aaSigner = aaProvider.getSigner()


  const tx = {
    to: "0x0000000000000000000000000000000000000000",
    value: ethers.utils.parseEther("0.0001"),
    data: "0x"
  }

  // Send the transaction using the AA signer
  const txResponse = await aaSigner.sendTransaction(tx)
  console.log(`Transaction hash: ${txResponse.hash}`)

  // Wait for the transaction
  const receipt = await txResponse.wait()
  console.log(`Transaction confirmed in block ${receipt.blockNumber}`)

  // const smartAccountClient = createSmartAccountClient({
  //   account: simpleSmartAccount,
  //   chain: sepolia,
  //   bundlerTransport: http("https://api.pimlico.io/v2/11155111/rpc?apikey=" + process.env.PIMLICO_API_KEY)
  // })

  // // const txHash = await smartAccountClient.sendTransaction({
  // //   account: smartAccountClient.account,
  // //   to: zeroAddress,
  // //   data: '0x',
  // //   value: BigInt(0),
  // // });

  // const txHash = await smartAccountClient.sendTransaction({
  //   to: zeroAddress,
  //   value: parseEther("0.001"),
  // })

  // console.log(`Transaction hash: ${txHash}`)

})()
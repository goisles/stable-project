import * as dotenv from 'dotenv'
import { EntryPoint, EntryPoint__factory, SimpleAccount, SimpleAccountFactory, SimpleAccountFactory__factory, SimpleAccount__factory } from '../typechain'

import { create } from 'domain'
import { ethers } from 'hardhat'

import { createSmartAccountClient } from "permissionless"
import { toSimpleSmartAccount } from "permissionless/accounts"
import { createPimlicoClient } from "permissionless/clients/pimlico"
import { createPublicClient, getContract, Hex, http, parseEther, zeroAddress } from "viem"
import { entryPoint07Address } from "viem/account-abstraction"
import { privateKeyToAccount } from "viem/accounts"
import { sepolia } from "viem/chains"
import { UserOperation } from 'viem/account-abstraction'


(async () => {
  dotenv.config()
  const provider = ethers.provider
  const ethersSigner = provider.getSigner()
  // console.log(await provider.getNetwork())
  const signerBalance = await provider.getBalance(ethersSigner.getAddress())
  console.log(`Signer balance: ${signerBalance.toString()}. ETH: ${ethers.utils.formatEther(signerBalance)}`)

  const entryPoint = EntryPoint__factory.connect(entryPoint07Address, ethersSigner)

  // Deploy SimpleAccountFactory if necessary
  let simpleAccountFactory: SimpleAccountFactory
  if (process.env.SIMPLE_ACCOUNT_FACTORY_ADDRESS == null) {
    console.log(`SIMPLE_ACCOUNT_ADDRESS is not set, deploying SimpleAccount`)
    simpleAccountFactory = await new SimpleAccountFactory__factory(ethersSigner).deploy(entryPoint.address)
    console.log('SimpleAccount deployed to:', simpleAccountFactory.address)
  } else {
    simpleAccountFactory = SimpleAccountFactory__factory.connect(process.env.SIMPLE_ACCOUNT_FACTORY_ADDRESS!, ethersSigner)
    console.log(`Using existing SimpleAccountFactory at ${simpleAccountFactory.address}`)
  }

  // create a random wallet as our "EOA"
  const accountOwner = ethers.Wallet.createRandom().connect(provider)

  // static call to get the deterministic address of the new SimpleAccount
  const simpleAccountAddr = await simpleAccountFactory.callStatic.createAccount(accountOwner.address, 0)

  const tx = await simpleAccountFactory.createAccount(accountOwner.address, 0)
  const simpleAccount = SimpleAccount__factory.connect(simpleAccountAddr, accountOwner)
  console.log(`SimpleAccount deployed to: ${simpleAccount.address}`)
  
  const publicClient = createPublicClient({
    transport: http(`https://sepolia.infura.io/v3/${process.env.INFURA_ID}`),
  })

  const viemOwner = await privateKeyToAccount(accountOwner.privateKey as Hex)

  const simpleSmartAccount = await toSimpleSmartAccount({
    owner: viemOwner,
    address: simpleAccountAddr as Hex,
    client: publicClient,
    entryPoint: {
      address: entryPoint07Address,
      version: "0.7"
    }
  })

  if (process.env.PIMLICO_API_KEY == null) {
    console.log("PIMLICO_API_KEY is not set, skipping transaction")
    return
  }

  console.log(`Pimlico API key: ${process.env.PIMLICO_API_KEY}`)

  const smartAccountClient = createSmartAccountClient({
    account: simpleSmartAccount,
    chain: sepolia,
    bundlerTransport: http("https://api.pimlico.io/v2/11155111/rpc?apikey=" + process.env.PIMLICO_API_KEY)
  })

  // const txHash = await smartAccountClient.sendTransaction({
  //   account: smartAccountClient.account,
  //   to: zeroAddress,
  //   data: '0x',
  //   value: BigInt(0),
  // });

  const txHash = await smartAccountClient.sendTransaction({
    to: zeroAddress,
    value: parseEther("0.001"),
  })

  console.log(`Transaction hash: ${txHash}`)

})()
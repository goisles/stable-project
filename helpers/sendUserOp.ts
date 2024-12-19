import { UserOperation } from "viem/_types/account-abstraction"
import { TransactionResponse } from '@ethersproject/abstract-provider'
import { TransactionReceipt } from '@ethersproject/abstract-provider/src.ts/index'
import { ethers } from 'ethers'
import { hexValue } from 'ethers/lib/utils'

export type SendUserOp = (userOp: UserOperation) => Promise<TransactionResponse | undefined>


/**
 * send a request using rpc.
 *
 * @param provider - rpc provider that supports "eth_sendUserOperation"
 */
export function rpcUserOpSender (provider: ethers.providers.JsonRpcProvider, entryPointAddress: string): SendUserOp {
    let chainId: number
  
    return async function (userOp) {
      if (chainId === undefined) {
        chainId = await provider.getNetwork().then(net => net.chainId)
      }
  
      const cleanUserOp = Object.keys(userOp).map(key => {
        let val = (userOp as any)[key]
        if (typeof val !== 'string' || !val.startsWith('0x')) {
          val = hexValue(val)
        }
        return [key, val]
      })
        .reduce((set, [k, v]) => ({ ...set, [k]: v }), {})
      await provider.send('eth_sendUserOperation', [cleanUserOp, entryPointAddress]).catch(e => {
        throw e.error ?? e
      })
      return undefined
    }
  }
import * as anchor from "@project-serum/anchor"
import { Program } from "@project-serum/anchor"
import { TransferReproducer } from "../target/types/transfer_reproducer"
import { SystemProgram, PublicKey, Transaction } from "@solana/web3.js"
import BN from "bn.js"
import { expect } from "chai"

describe("transfer-reproducer", () => {
  const anchorOpts = anchor.AnchorProvider.defaultOptions()
  anchorOpts.commitment = "confirmed"
  anchorOpts.preflightCommitment = "confirmed"
  anchor.setProvider(anchor.AnchorProvider.local(undefined, anchorOpts))
  const provider = anchor.getProvider() as anchor.AnchorProvider

  const program = anchor.workspace
    .TransferReproducer as Program<TransferReproducer>

  async function getLamports(address?: PublicKey): Promise<BN> {
    address = address || provider.wallet.publicKey
    const num = await provider.connection.getBalance(address)
    return new BN(num.toString())
  }

  it.only("strange transfer stuff", async () => {
    const beforeLamports = await getLamports()

    // number of lamports for rent exception of 0 bytes
    // https://docs.rs/solana-program/latest/src/solana_program/rent.rs.html#31
    const lamportTransfer = 890880

    const somePubkey = PublicKey.unique()
    const ix = SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: somePubkey,
      lamports: lamportTransfer,
    })
    const recentBlockhash = await provider.connection.getLatestBlockhash()
    const tx = new Transaction({
      blockhash: recentBlockhash.blockhash,
      lastValidBlockHeight: recentBlockhash.lastValidBlockHeight,
    }).add(ix)
    const signature = await provider.sendAndConfirm(tx)

    const afterLamports = await getLamports()
    const somePubkeyLamports = await getLamports(somePubkey)
    expect(somePubkeyLamports.toNumber()).eq(lamportTransfer)

    const txData = await provider.connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    })
    const txFee = txData.meta.fee
    expect(txData.meta.preBalances.length).eq(3) // from; to; system_program
    const preBalanceWallet = new BN(txData.meta.preBalances[0].toString())
    const postBalanceWallet = new BN(txData.meta.postBalances[0].toString())
    const preBalanceSomePubkey = txData.meta.preBalances[1]
    const postBalanceSomePubkey = txData.meta.postBalances[1]
    expect(postBalanceSomePubkey - preBalanceSomePubkey).eq(lamportTransfer)
    expect(
      preBalanceWallet
        .sub(postBalanceWallet)
        .eq(beforeLamports.sub(afterLamports))
    )
    expect(
      beforeLamports
        .sub(afterLamports)
        .eq(new BN(txFee).add(new BN(lamportTransfer)))
    )
    const feeCalculated = beforeLamports
      .sub(afterLamports)
      .sub(new BN(lamportTransfer))
    expect(feeCalculated.eq(new BN(txFee)))

    console.log(
      "feeCalculated",
      feeCalculated.toString(),
      "txFee",
      txFee,
      "diff",
      beforeLamports
        .sub(afterLamports)
        .sub(new BN(lamportTransfer))
        .sub(new BN(txFee))
        .toString()
    )
  })
})

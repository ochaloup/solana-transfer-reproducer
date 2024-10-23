import * as anchor from "@project-serum/anchor"
import { Program } from "@project-serum/anchor"
import { TransferReproducer } from "../target/types/transfer_reproducer"
import {
  SystemProgram,
  PublicKey,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js"
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

  const testAccount = PublicKey.unique()

  async function getLamports(address?: PublicKey): Promise<BN> {
    address = address || provider.wallet.publicKey
    const num = await provider.connection.getBalance(address)
    return new BN(num.toString())
  }

  async function testTransfer(lamportTransfer: number) {
    const beforeLamports = await getLamports()
    const testAccountBeforeLamports = await getLamports(testAccount)

    const ix = SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: testAccount,
      lamports: lamportTransfer,
    })
    const recentBlockhash = await provider.connection.getLatestBlockhash()
    const tx = new Transaction({
      blockhash: recentBlockhash.blockhash,
      lastValidBlockHeight: recentBlockhash.lastValidBlockHeight,
    }).add(ix)
    const signature = await provider.sendAndConfirm(tx)

    const afterLamports = await getLamports()
    const testAccountAfterLamports = await getLamports(testAccount)
    expect(testAccountAfterLamports.toString())
      .eq(testAccountBeforeLamports.add(new BN(lamportTransfer)).toString())

    const txData = await provider.connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    })
    const txFee = txData.meta.fee
    expect(txData.meta.preBalances.length).eq(3) // from; to; system_program
    const preBalanceWallet = new BN(txData.meta.preBalances[0].toString())
    const postBalanceWallet = new BN(txData.meta.postBalances[0].toString())
    const preBalanceSomePubkey = txData.meta.preBalances[1]
    const postBalanceSomePubkey = txData.meta.postBalances[1]
    const feeCalculated = beforeLamports
      .sub(afterLamports)
      .sub(new BN(lamportTransfer))

    console.log(
      "test account", testAccount.toBase58(),
      "balance", testAccountAfterLamports.toString()
    )
    console.log(
      "feeCalculated", feeCalculated.toString(),
      "txFee", txFee,
      "diff",
      beforeLamports
        .sub(afterLamports)
        .sub(new BN(lamportTransfer))
        .subn(txFee)
        .toString()
    )

    expect(postBalanceSomePubkey - preBalanceSomePubkey).eq(lamportTransfer)
    expect(preBalanceWallet.sub(postBalanceWallet).toString()).eq(
      beforeLamports.sub(afterLamports).toString()
    )
    expect(feeCalculated.toString()).eq(new BN(txFee).toString())
    expect(beforeLamports.sub(afterLamports).toString()).eq(
      new BN(txFee).add(new BN(lamportTransfer)).toString()
    )
  }

  it("transfer sol", async () => {
    await testTransfer(LAMPORTS_PER_SOL)
  })

  it("strange transfer stuff", async () => {
    // number of lamports for rent exception of 0 bytes
    // https://docs.rs/solana-program/latest/src/solana_program/rent.rs.html#31
    // const lamportTransfer = LAMPORTS_PER_SOL
    const lamportTransfer = await provider.connection.getMinimumBalanceForRentExemption(0)
    console.log("lamportTransfer for rent exempt 0 data", lamportTransfer)
    await testTransfer(lamportTransfer)
  })
})

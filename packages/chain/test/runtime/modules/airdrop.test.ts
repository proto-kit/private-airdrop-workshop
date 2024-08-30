import "reflect-metadata";
import { TestingAppChain } from "@proto-kit/sdk";
import {
  Airdrop,
  AirdropProof,
  AirdropPublicOutput,
  canClaim,
  message,
  airdrop as airdropProgram,
} from "../../../src/runtime/modules/airdrop";
import {
  PrivateKey,
  Nullifier,
  MerkleMap,
  Poseidon,
  Bool,
  setNumberOfWorkers,
} from "o1js";
import { Balances } from "../../../src/runtime/modules/balances";
import { Balance, BalancesKey, TokenId } from "@proto-kit/library";

describe("Airdrop", () => {
  let appChain = TestingAppChain.fromRuntime({
    Airdrop: Airdrop,
    Balances: Balances,
  });
  let airdrop: Airdrop;
  let airdropProof: AirdropProof;

  const aliceKey = PrivateKey.random();
  const alice = aliceKey.toPublicKey();

  const map = new MerkleMap();
  const key = Poseidon.hash(alice.toFields());
  map.set(key, Bool(true).toField());

  const witness = map.getWitness(key);

  const nullifier = Nullifier.fromJSON(
    Nullifier.createTestNullifier(message, aliceKey)
  );

  async function mockProof(
    publicOutput: AirdropPublicOutput
  ): Promise<AirdropProof> {
    console.log("generating mock proof");
    console.time("mockProof");
    const proof = await AirdropProof.dummy(undefined, publicOutput, 0);
    console.timeEnd("mockProof");
    return proof;
  }

  async function realProof(
    publicOutput: AirdropPublicOutput
  ): Promise<AirdropProof> {
    console.log("compiling airdrop program");
    console.time("compile");
    await airdropProgram.compile();
    console.timeEnd("compile");

    console.log("generating airdrop proof");
    console.time("proof");
    const proof = await airdropProgram.canClaim(witness, nullifier);
    console.timeEnd("proof");
    return proof;
  }

  beforeAll(async () => {
    appChain = TestingAppChain.fromRuntime({
      Airdrop: Airdrop,
      Balances: Balances,
    });

    appChain.configurePartial({
      Runtime: {
        Airdrop: {},
        Balances: {
          totalSupply: Balance.from(10000),
        },
      },
    });

    await appChain.start();

    appChain.setSigner(aliceKey);

    airdrop = appChain.runtime.resolve("Airdrop");

    // we can also set the number of worker threads to prevent efficiency cores
    // from being used on apple silicon
    // setNumberOfWorkers(7);

    // either use the dummy proof here, or generate a real proof like below
    // M1 macs seem to have issues generating the mock proofs,
    // so i've used a real proof instead
    airdropProof = await mockProof(await canClaim(witness, nullifier));
    // airdropProof = await realProof(await canClaim(witness, nullifier));
  }, 1_000_000);

  it("should setup the airdrop commitment", async () => {
    const tx = await appChain.transaction(alice, async () => {
      await airdrop.setCommitment(map.getRoot());
    });

    await tx.sign();
    await tx.send();

    await appChain.produceBlock();

    const commitment = await appChain.query.runtime.Airdrop.commitment.get();

    expect(commitment?.toBigInt()).toBe(map.getRoot().toBigInt());
  });

  it("should allow claiming if a valid proof is provided", async () => {
    const tx = await appChain.transaction(alice, async () => {
      await airdrop.claim(airdropProof);
    });

    await tx.sign();
    await tx.send();

    const block = await appChain.produceBlock();

    const storedNullifier = await appChain.query.runtime.Airdrop.nullifiers.get(
      airdropProof.publicOutput.nullifier
    );
    const balance = await appChain.query.runtime.Balances.balances.get(
      new BalancesKey({ tokenId: TokenId.from(0), address: alice })
    );

    expect(block?.transactions[0].status.toBoolean()).toBe(true);
    expect(storedNullifier?.toBoolean()).toBe(true);
    expect(balance?.toBigInt()).toBe(1000n);
  });

  it("should not allow claiming if a spent nullifier is used", async () => {
    const tx = await appChain.transaction(alice, async () => {
      await airdrop.claim(airdropProof);
    });

    await tx.sign();
    await tx.send();

    const block = await appChain.produceBlock();

    const storedNullifier = await appChain.query.runtime.Airdrop.nullifiers.get(
      airdropProof.publicOutput.nullifier
    );
    const balance = await appChain.query.runtime.Balances.balances.get(
      new BalancesKey({ tokenId: TokenId.from(0), address: alice })
    );

    expect(block?.transactions[0].status.toBoolean()).toBe(false);
    expect(block?.transactions[0].statusMessage).toMatch(
      /Nullifier has already been used/
    );
    expect(storedNullifier?.toBoolean()).toBe(true);
    expect(balance?.toBigInt()).toBe(1000n);
  });
});

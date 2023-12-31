import "reflect-metadata";
import { TestingAppChain } from "@proto-kit/sdk";
import {
  Airdrop,
  AirdropProof,
  AirdropPublicOutput,
  canClaim,
  message,
} from "./Airdrop";
import {
  Field,
  PrivateKey,
  Nullifier,
  MerkleMap,
  Poseidon,
  Bool,
  UInt64,
} from "o1js";
import { Balances } from "./Balances";
import { Pickles } from "o1js/dist/node/snarky";
import { dummyBase64Proof } from "o1js/dist/node/lib/proof_system";

describe("Airdrop", () => {
  let appChain: TestingAppChain<{
    Airdrop: typeof Airdrop;
    Balances: typeof Balances;
  }>;
  let airdrop: Airdrop;
  let balances: Balances;

  const aliceKey = PrivateKey.random();
  const alice = aliceKey.toPublicKey();

  const map = new MerkleMap();
  const key = Poseidon.hash(alice.toFields());
  map.set(key, Bool(true).toField());

  const witness = map.getWitness(key);

  async function mockProof(
    publicOutput: AirdropPublicOutput
  ): Promise<AirdropProof> {
    const [, proof] = Pickles.proofOfBase64(await dummyBase64Proof(), 2);
    return new AirdropProof({
      proof: proof,
      maxProofsVerified: 2,
      publicInput: undefined,
      publicOutput,
    });
  }

  beforeAll(async () => {
    appChain = TestingAppChain.fromRuntime({
      modules: {
        Airdrop: Airdrop,
        Balances: Balances,
      },
      config: {
        Airdrop: {},
        Balances: {},
      },
    });

    appChain.setSigner(aliceKey);

    await appChain.start();

    airdrop = appChain.runtime.resolve("Airdrop");
    balances = appChain.runtime.resolve("Balances");
  });

  it("should setup the airdrop commitment", async () => {
    const tx = appChain.transaction(alice, () => {
      airdrop.setCommitment(map.getRoot());
    });

    await tx.sign();
    await tx.send();

    await appChain.produceBlock();

    const commitment = await appChain.query.runtime.Airdrop.commitment.get();

    expect(commitment?.toBigInt()).toBe(map.getRoot().toBigInt());
  });

  it("should allow claiming if a valid proof is provided", async () => {
    const nullifier = Nullifier.fromJSON(
      Nullifier.createTestNullifier(message, aliceKey)
    );

    const airdropProof = await mockProof(canClaim(witness, nullifier));

    const tx = appChain.transaction(alice, () => {
      airdrop.claim(airdropProof);
    });

    await tx.sign();
    await tx.send();

    const block = await appChain.produceBlock();

    const storedNullifier = await appChain.query.runtime.Airdrop.nullifiers.get(
      airdropProof.publicOutput.nullifier
    );
    const balance = await appChain.query.runtime.Balances.balances.get(alice);

    expect(block?.txs[0].status).toBe(true);
    expect(storedNullifier?.toBoolean()).toBe(true);
    expect(balance?.toBigInt()).toBe(1000n);
  });

  it("should not allow claiming if a spent nullifier is used", async () => {
    const nullifier = Nullifier.fromJSON(
      Nullifier.createTestNullifier([Field(0)], aliceKey)
    );

    const airdropProof = await mockProof(canClaim(witness, nullifier));

    const tx = appChain.transaction(alice, () => {
      airdrop.claim(airdropProof);
    });

    await tx.sign();
    await tx.send();

    const block = await appChain.produceBlock();

    const storedNullifier = await appChain.query.runtime.Airdrop.nullifiers.get(
      airdropProof.publicOutput.nullifier
    );
    const balance = await appChain.query.runtime.Balances.balances.get(alice);

    expect(block?.txs[0].status).toBe(false);
    expect(block?.txs[0].statusMessage).toMatch(
      /Nullifier has already been used/
    );
    expect(storedNullifier?.toBoolean()).toBe(true);
    expect(balance?.toBigInt()).toBe(1000n);
  });
});

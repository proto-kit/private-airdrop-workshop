import {
  RuntimeModule,
  runtimeMethod,
  state,
  runtimeModule,
} from "@proto-kit/module";
import { State, StateMap, assert } from "@proto-kit/protocol";
import {
  Bool,
  Experimental,
  Field,
  MerkleMapWitness,
  Nullifier,
  Poseidon,
  Struct,
  UInt64,
} from "o1js";
import { inject } from "tsyringe";
import { Balances } from "./Balances";

export class AirdropPublicOutput extends Struct({
  root: Field,
  nullifier: Field,
}) {}

export const message: Field[] = [Field(0)];

export function canClaim(
  witness: MerkleMapWitness,
  nullifier: Nullifier
): AirdropPublicOutput {
  const key = Poseidon.hash(nullifier.getPublicKey().toFields());
  const [computedRoot, computedKey] = witness.computeRootAndKey(
    Bool(true).toField()
  );
  computedKey.assertEquals(key);

  nullifier.verify(message);

  return new AirdropPublicOutput({
    root: computedRoot,
    nullifier: nullifier.key(),
  });
}

export const airdrop = Experimental.ZkProgram({
  publicOutput: AirdropPublicOutput,
  methods: {
    canClaim: {
      privateInputs: [MerkleMapWitness, Nullifier],
      method: canClaim,
    },
  },
});

export class AirdropProof extends Experimental.ZkProgram.Proof(airdrop) {}

type AirdropConfig = Record<string, never>;

@runtimeModule()
export class Airdrop extends RuntimeModule<AirdropConfig> {
  @state() public commitment = State.from<Field>(Field);
  @state() public nullifiers = StateMap.from<Field, Bool>(Field, Bool);

  public constructor(@inject("Balances") public balances: Balances) {
    super();
  }

  @runtimeMethod()
  public setCommitment(commitment: Field) {
    this.commitment.set(commitment);
  }

  @runtimeMethod()
  public claim(airdropProof: AirdropProof) {
    airdropProof.verify();
    const commitment = this.commitment.get();

    assert(
      airdropProof.publicOutput.root.equals(commitment.value),
      "Airdrop proof does not contain the correct commitment"
    );

    const isNullifierUsed = this.nullifiers.get(
      airdropProof.publicOutput.nullifier
    );

    assert(isNullifierUsed.value.not(), "Nullifier has already been used");

    this.nullifiers.set(airdropProof.publicOutput.nullifier, Bool(true));

    this.balances.mint(this.transaction.sender, UInt64.from(1000));
  }
}

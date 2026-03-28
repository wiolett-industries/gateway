// Web Crypto API types used by @peculiar/x509 but not included in ES2022 lib
declare interface EcdsaParams extends Algorithm {
  hash: HashAlgorithmIdentifier;
}

declare interface RsaHashedKeyAlgorithm extends RsaKeyAlgorithm {
  hash: KeyAlgorithm;
}

declare interface RsaKeyAlgorithm extends KeyAlgorithm {
  modulusLength: number;
  publicExponent: BigInteger;
}

declare interface Algorithm {
  name: string;
}

declare interface KeyAlgorithm {
  name: string;
}

declare type HashAlgorithmIdentifier = AlgorithmIdentifier;
declare type AlgorithmIdentifier = Algorithm | string;
declare type BigInteger = Uint8Array;

declare interface CryptoKey {
  readonly algorithm: KeyAlgorithm;
  readonly extractable: boolean;
  readonly type: KeyType;
  readonly usages: KeyUsage[];
}

declare type KeyType = "private" | "public" | "secret";
declare type KeyUsage = "decrypt" | "deriveBits" | "deriveKey" | "encrypt" | "sign" | "unwrapKey" | "verify" | "wrapKey";

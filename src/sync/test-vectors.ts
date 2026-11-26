/**
 * Frozen known-answer vectors for supporter sync. NEVER CHANGE THESE.
 *
 * They pin the key derivation (SY-2), request signing (SY-6) and the record
 * format (SY-15, SY-16). If a change to src/sync/ makes a test against these
 * fail, the change is wrong: people's existing codes would open a different
 * account, or their synced menus would stop decrypting.
 *
 * - The secrets are BIP-39 test vectors (all zeros, and "hamster diagram …"),
 *   public on purpose. A real code is never one of them.
 * - Signatures are deterministic in Node (RFC 8032). Some browsers add
 *   randomness to Ed25519 signatures, which is equally valid, so app code must
 *   never compare signatures, only verify them.
 * - When this file was made, the values were checked independently with
 *   Node's crypto module (hkdfSync, createPrivateKey, createDecipheriv) from
 *   the layouts in server/README.md.
 *
 * Pure data with no imports: server/test/client-vectors.test.ts loads it too,
 * and checks every SIGN_VECTORS header with the server's authenticate().
 */

/** secret (hex) → words, Ed25519 public key (base64url), account id. */
export const KEY_VECTORS = [
  {
    secret: "0000000000000000000000000000000000000000000000000000000000000000",
    words: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
    publicKey: "KudKzU_Rui30RP-CJ30T3AWeVe-Nh0ONyo58qWWgcm8",
    accountId: "irGW6uf_WXpCGwX1NtAvbw",
  },
  {
    secret: "68a79eaca2324873eacc50cb9c6eca8cc68ea5d936f98787c60c7ebc74e6ce7c",
    words: "hamster diagram private dutch cause delay private meat slide toddler razor book happy fancy gospel tennis maple dilemma loan word shrug inflict delay length",
    publicKey: "25AtC7SEtLJbGyrRXMaQjn2lrTzIoQJMSQeHv_MJxsk",
    accountId: "7fP_C-0PG5rKGUUdWtsZjg",
  },
] as const;

/** All signing and record vectors use the second secret ("hamster diagram …"). */
export const VECTOR_ACCOUNT = KEY_VECTORS[1];

/** A live menu, version 3, as encryptRecord() wrote it (1052 bytes). */
const LIVE_RECORD =
  "OkVACy_--XVQCQEnx7jGhVqYrdFY46YYh566b2RVz-5RIfZVfkwK5kzDz5bZEOgwLpkhMxO1lpIzXgj1dQlwqsZlwG_hoDb-v-3Zsbzk0o1wAibslaNi_x5UND4a-gUTOZnBWD3m52BAtrQZXdhKZ_ykW0xTVTXt7UIq4ktohHbQe_i4HAQQti3qg1fxD87wQuwJFyRCPUQ-FSqCtFFeysjKS6eFSjxlYHG7HasYK3ypi1uz8SzxbG3A77YDxRt0J3Vt6imBEYl4z6uh7ogalBixgMuuk_8f9VjTkEMGkSRE0IOg90lpGSUk0m7bzArvkerFpNDpoHkZbX4PqusvBd7Kzys7o-I6zaG5JKKH-1aI_0o8SSugF-1MVTGMqk80_H8uA7LSQX9Ogoz5NMwLCxs6r6TmRodJ7mG7Ly_TRpmQT9pw22jRLxYtjmOfADXF-qKz601EPg1KCV-6ujle2Ts2pZzVPamlb0KDGbUuiY8cr9K0-boVT5IOyOQB3gs6yYzJQ3RhMWhY_ltg9Xgh222F7TbmqRCpaFfeq6mi5c6ScfRDfdCHT9IAq0o3rlVVx0HLmCAEWMr35dxWxPdKT49OTfKzHC-srfj84gg-26NH8Elw8d3HqlboHxIqYfbUt4vY560eVLcN76FM-sP7jlE9LaBC0vUh-aZLdCOqgzvhDdcMyLGwiD9imgMSz0h2h3xzd3xXUbyBYPFUj-2v5crS91gAKetPXb14E9-1MzYCIYVekfr3wDefwunXwoSxi-9Nd5F6Cw7y4oUcanb9n8se2XU-_aWMgj85iBlwWM2Z9MQhYvGBm0O3q6vyk0L-hZQj-970TaqcGLAjkf_CHbI84JieviyYEEN8a1h9HpLsW-Sf6x4nl5qANhPXpIxqPFDzJ5os4aMLPyNNNPyhYxvKaCaq7QzpRTN2X9IMxtqL6O0w3VkGbWvtAEkE7VwwaMIBJPdE_KoZvJKM0NpXUCG0-NEHU4Qjdful3W8xei61Nja4iYhp-m-gz-irFH4zEl_ZDNRvOoz8F1mLKIbo_pa6-Svgkr3WfJMUyvRi-wNZ2YnEJaPNuzqamj-SLe1YNLN2qZcl7C0qjqJ6-sehn5PhuylAmNHW8_Tz9Sj_CxCQZQ0ziQafUbljLP_eXej4lSiK88DHXZ-18061AxMTxJrxGQwQq-KgehDUah-XZaHkt5785vZjdg5F1cBcGfiQ4lSRK0CHzW3RXuHpdhOII-FGgN7JO_3IhgmNbfgqCuab-k6O-NKE-5WpaZDWQZLwMRNuofPhlWOQCmeubNlhSkZ59pFzaVW1QBaTRtM5plY_9ssudgvTVce7v4y0QdiG_hffdUzYusdTvmJPzOtjLGZsCtG8UPKmRugU9ZvTpiYC7483B76bcenk4kg";

/** A tombstone for the same menu, version 4 (1052 bytes). */
const TOMBSTONE_RECORD =
  "j2JyZ9r0zSaVAJUMlqHmCxYPsEMQ0xlOWDHs9D-orJaCyfnfUKMXNlRC4gPA_WiYMflS96sXE7IvJ71PsrYMRVccb8jR_DoOFzMq-UMr1aV3eAAu06iXCCmmPlxfsRYjlHK2wM9nbYwSuCJsAwIfC1I_LVTKGJqu-ZSp3sHDqjNNSRNcwVNoMYhHuR8wnzrDvhVl7fNm8GxZcsnJbhYeMWnTkD45avobVrjDh0oZC6270qopyt9v5AoqgsRXV8ThrYxWAHj8fgQ7T-Kc4QWu2jp4XQYRWW_X-qX7J5ioPDt2XEGquTwgtecEofAp6C232aBbbxJcut8Ln0zJamWyEzA2lhO7tca3gnv0NNk203NhgRtTR9mzfuH8jJbdDUQilv8yQRihPGv4G3Vbz0I2Ucqosa6KcvOrlOV-tYBD37idxyWxsXEzPWgJrHDBUQbzPrWMmJLEIXzKGRGQDTfF9UywqrX0ILWf1xUHCaULdkD35h5XEWnVDd2YOA6VJXYiDDSwNFabRzwmuow7qvivXBIOmTHvmO_Kzz7-WiZrd4YUXHHPPOknc5rRGBv0dNEBPt2uEcBdFoMcwnH3S27DzncT053MJh3F5cSZU3RS-3dPqV1HpYfMyVEq1TFBH-Mpig08h-goYDeDtu02PI7pC71wcRE2DOqTjyVjYsXYkwxgw62_qffHyf46-Dltdjpz1SPTrFDcCY5ZqIz8updvInPa8r_Ul46B9Q-93fPSYPP7iJb7F2rPFt6aHWEepZPOuCJVD9VouwFimaLxo9rC6Wtx9CTp886hRZSJUkyHiT_X_E7owq6Sz5Dr7CSPE8H4Z4QCYemcMqHAaV516BmgrOffWyGVb0I09Fek0C033aAu0D9-oBkhIMfe-rg0dMGlJIk5zzwubx8CA0RrC_gGtEORtRiCE6869Lik-n2GmZzwAtUi13QOmxYmYe3_-HUasDEod1A9VZhCmlDt6twyOucJmdd2lZtJx4V5mCYSguTIYV2fIcj0aEDcpXTGwND7uA25EsAY31i9mEkHg8RXY1gJt-TNhphgL6dnNKdrePFb7aPcPgpbl1jHugmMLZUfdpv-QhGRq2KCDQnUexafo2fl0Fv1cjet1qP1_URLcFUCX_9jDLkJ3J0jAnhqOQXKV-dYEOW3ni3E2tZ6E1Z7LWKtN9sZ6dUAk6dbR0EP8BHeaEepCO0QVtiYycGTPkuXQ6avBW9Dfllf3w94sVyw5DT7h4B5jyClikibmUesoeVEs3oyRKdF_k4WHA8GIpUzZ6oj-7bmvrU3jkqEEffj-xAMC8ZfccF65lJ9noOqh7Ouzc_7txCoxqY2lanQEsRprX0cVFGGnrhuuR-_ItGeNsvpYnCkemKfp1pQgtl9trl7jUeoYSgaplk-pzg";

/** Records under VECTOR_ACCOUNT: decrypting `ciphertext` as (id, version, deleted) gives `record`. */
export const RECORD_VECTORS = [
  {
    version: 3,
    deleted: false,
    record: {
      id: "AAECAwQFBgcICQoLDA0ODw",
      title: "Frozen vector menu",
      encoded: "eJyrVkrOT0lVslJKzEvMTVWqBQApRQUN",
      person: {
        name: "Alex",
        pronouns: "they/them"
      },
      createdAt: 1795564800000,
      updatedAt: 1795568400000,
      editId: "ZWRpdC1pZC12ZWN0b3IwMQ"
    },
    ciphertext: LIVE_RECORD,
  },
  {
    version: 4,
    deleted: true,
    record: {
      id: "AAECAwQFBgcICQoLDA0ODw",
      title: "",
      encoded: "",
      updatedAt: 1795572000000,
      editId: "ZWRpdC1pZC12ZWN0b3IwMg",
      deleted: true
    },
    ciphertext: TOMBSTONE_RECORD,
  },
] as const;

/**
 * Requests signed by VECTOR_ACCOUNT. `body` is base64url ("" for none) and `ts`
 * is Unix seconds (25 November 2026, 00:00 UTC).
 */
export const SIGN_VECTORS = [
  {
    method: "GET",
    pathAndQuery: "/v1/account",
    body: "",
    ts: 1795564800,
    header:
      "MenuSync v1 account=7fP_C-0PG5rKGUUdWtsZjg, key=25AtC7SEtLJbGyrRXMaQjn2lrTzIoQJMSQeHv_MJxsk, ts=1795564800, sig=lE180uQA3BNtLfDgNk1qiLVn87qaCR4K6uO9NmjadaFwTYwZM7NXeMloZT8MG9_pLMEwV4i1NPe-vzLCi4d9AA",
  },
  {
    method: "GET",
    pathAndQuery: "/v1/menus?since=42",
    body: "",
    ts: 1795564800,
    header:
      "MenuSync v1 account=7fP_C-0PG5rKGUUdWtsZjg, key=25AtC7SEtLJbGyrRXMaQjn2lrTzIoQJMSQeHv_MJxsk, ts=1795564800, sig=8FwARiXs_fqfiITfgXA-0igr5ZIXc5nDXGRirJOd_LdBKpu-UFkJ-apMydckXVr26c5FGw9jCHcR1ZGlYoyMAg",
  },
  {
    method: "PUT",
    pathAndQuery: "/v1/menus/AAECAwQFBgcICQoLDA0ODw",
    body: LIVE_RECORD,
    ts: 1795564800,
    header:
      "MenuSync v1 account=7fP_C-0PG5rKGUUdWtsZjg, key=25AtC7SEtLJbGyrRXMaQjn2lrTzIoQJMSQeHv_MJxsk, ts=1795564800, sig=2ns4UOgLdkBLFWjjhJjV-wrFPtPb69g6BEmM5S60vTKQsSmS2oe6azCLVcvX_lX6tbd5UwdHqp2_5Wzgi3XeAw",
  },
  {
    method: "POST",
    pathAndQuery: "/v1/pair",
    body: "eyJpZCI6IlptRnJaUzF3WVdseWFXNW5MV2xrTUEiLCJibG9iIjoiYm05MElHRWdjbVZoYkNCd1lXbHlhVzVuSUdKc2IySSJ9",
    ts: 1795564800,
    header:
      "MenuSync v1 account=7fP_C-0PG5rKGUUdWtsZjg, key=25AtC7SEtLJbGyrRXMaQjn2lrTzIoQJMSQeHv_MJxsk, ts=1795564800, sig=m3G812OBw9OGNK9ktMn7W-55eZsZagRYxybOva0TUkWA-SjU0aFETMP6QTjM6wY74NjyxXIpSQ2zjiwXp3pgCA",
  },
] as const;

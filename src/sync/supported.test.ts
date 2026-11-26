import { SELF_TEST_ACCOUNT_ID, syncSupported } from "./supported";
import { KEY_VECTORS } from "./test-vectors";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const failFor = (name: string) => (algorithm: AlgorithmIdentifier | { name: string }) =>
  (typeof algorithm === "string" ? algorithm : algorithm.name) === name;

describe("SY-14: detecting whether this browser can sync", () => {
  test("WebCrypto here (Node 22) has everything sync needs", async () => {
    expect(await syncSupported()).toBe(true);
  });

  test("the self-test expects the frozen account id for the all-zero secret", () => {
    expect(KEY_VECTORS[0].secret).toBe("0".repeat(64));
    expect(SELF_TEST_ACCOUNT_ID).toBe(KEY_VECTORS[0].accountId);
  });

  test("no WebCrypto at all (for example, not a secure context)", async () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", undefined);
    expect(await syncSupported()).toBe(false);
    vi.stubGlobal("crypto", { getRandomValues });
    expect(await syncSupported()).toBe(false);
  });

  test("no Ed25519", async () => {
    const importKey = crypto.subtle.importKey.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "importKey").mockImplementation(((format: KeyFormat, data: never, algorithm: never, ...rest: never[]) =>
      failFor("Ed25519")(algorithm)
        ? Promise.reject(new DOMException("Unrecognized algorithm name", "NotSupportedError"))
        : (importKey as (...args: unknown[]) => Promise<CryptoKey>)(format, data, algorithm, ...rest)) as typeof crypto.subtle.importKey);
    expect(await syncSupported()).toBe(false);
  });

  test("no AES-GCM", async () => {
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "encrypt").mockImplementation(((algorithm: never, ...rest: never[]) =>
      failFor("AES-GCM")(algorithm)
        ? Promise.reject(new DOMException("Unrecognized algorithm name", "NotSupportedError"))
        : (encrypt as (...args: unknown[]) => Promise<ArrayBuffer>)(algorithm, ...rest)) as typeof crypto.subtle.encrypt);
    expect(await syncSupported()).toBe(false);
  });

  test("an Ed25519 key without a public half in its JWK", async () => {
    vi.spyOn(crypto.subtle, "exportKey").mockResolvedValue({ kty: "OKP", crv: "Ed25519" } as never);
    expect(await syncSupported()).toBe(false);
  });

  test("a browser that would derive a different account from the same code", async () => {
    vi.spyOn(crypto.subtle, "exportKey").mockResolvedValue({ kty: "OKP", crv: "Ed25519", x: KEY_VECTORS[1].publicKey } as never);
    expect(await syncSupported()).toBe(false);
  });

  test("signatures that don't verify", async () => {
    vi.spyOn(crypto.subtle, "verify").mockResolvedValue(false);
    expect(await syncSupported()).toBe(false);
  });
});

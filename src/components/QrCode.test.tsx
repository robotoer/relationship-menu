import { render, screen } from "@testing-library/react";
import { QrCode } from "./QrCode";
import { QrErrorCorrection, encodeQr } from "./qr-encoder";

/**
 * Symbols made by an independent encoder, node-qrcode 1.5.4 (MIT), in byte mode
 * with the same error correction and mask: `QRCode.create([{ data: text, mode:
 * "byte" }], { errorCorrectionLevel, maskPattern })`. Modules are row by row,
 * 1 for dark, four to a hex digit. They cover one and several blocks, short
 * and long blocks together, version information (7+), the 16-bit length (10+)
 * and UTF-8. Before freezing them, 445 symbols across versions 1–40 and all
 * four levels matched module for module, and jsQR 1.4.0 decoded 244 of ours
 * with the mask chosen here. Never regenerate these from this encoder.
 */
const REFERENCE: { text: string; ecc: QrErrorCorrection; mask: number; version: number; modules: string }[] = [
  {
    text: "hello",
    ecc: "H",
    mask: 2,
    version: 1,
    modules:
      "febbfc16106ebcbb7485dba2aec16907faafe016003ad73cec037c91dda278c223508074a7f81ad042febaba95d66a2e" +
      "a0490471cfe0090",
  },
  {
    text: "https://wantsandwonts.com/pair#Zm9vYmFyYmF6cXV4cXV1eGZvb2JhcmJhenF1eHF1dXg",
    ecc: "M",
    mask: 4,
    version: 5,
    modules:
      "fee4dd7bfc13cd92106e873942bb75af56d5dbaaf491aec168693107faaaaaafe01b2190008baa8b17c86ad1af4592f3" +
      "4c5e593a6fb9546938c0e865dc6043bc6f7d151f478108eec7351a632a8e6c6d66c19ea9ab33df315384fd52e0fcd578" +
      "767ca4f89cc3d9eca4c78592f2d5777eb19dc6feae2319f604c859fe980017cb0d7ee7c8e8fa004354cc4bfb1d1f2a50" +
      "42fe811fba81368ffdd094ab386e9d29ca8104309a0d6fee7d71158",
  },
  {
    text: "Wants & Won'ts: a relationship menu. Answer privately, then compare.",
    ecc: "Q",
    mask: 5,
    version: 6,
    modules:
      "fec44a663fc1793745106e9f57ce4bb74646b595dba5ee329aec13d59a6507faaaaaaafe00c0f2520043cc00ccc19edb" +
      "0a4b2f008c1cec979c11a1354f81ab93c19b50ccb3c67de48da1e0893180f09d61bfdbab7064d31c95a3bcdf6dcfece6" +
      "f72a8e7dd94b9db9932b4870e4cdafb8ff287b6b51318041be0358d60b24b0f4d27e10ef9c62b7fe1e8d071fe8562bd3" +
      "a6788f49252008730df3ef9d93e5bb6b61ca751896454fcdfb0047d1d9c5bfaebb266b904c8b44318ba1facfbf9dd16f" +
      "1db0b2e891a851e905d1605485fe7ed0f7320",
  },
  {
    text: "The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. ✓ é ü",
    ecc: "M",
    mask: 7,
    version: 10,
    modules:
      "fe3751eee3e33fc12239990ef2906e910f80805bcbb746ef98188825dba08dbff1be52ec17709513e57107faaaaaaaaa" +
      "aafe0002dbc7fe9a0096cb957f7e8d5048b8aa08a4c624f2a37c297266b4ecb7ca06e8f6d484fa0e3d5b3ff39a23b498" +
      "81ea92fb7bb36b400f26acbbb8babb937ab85ea6ca34981c307a5cdc8c8d8098818ea2ae740171e4112ffa97f7480bf0" +
      "6712a6b175984a9a00ec9ce2870c230a9ebf6d0b8b16b4f99b087af779471ab99838082c292c928ead53ecd72f83a7ff" +
      "551144ec55fe91a2af8626abf41a99c47d011534cc79ffc06ffca623f7a354071d0a9d737f9725c65bf5e5b260dd6b40" +
      "90f272a30e0cfb0abecc202ef4491229b420d8c5fd9be40d2d9d52ffc0dff43fe0ceee2d0514e3a120ad7a39d2a28160" +
      "7aca482d9c63362043ac112dd4d975f1c33af4035604c9891522f884f118dd30470f12c23cccfaae9b0632519076cff3" +
      "b30b42bd2a090381b73ffba8fe006c5d11b20d447f80384ad8d12a5053793c5279d1aba4c55beb04ef8dd45a325c5d6a" +
      "eee99ebeea5526ab04555e31f21a90fef97c4d29d7a50",
  },
  {
    text: "0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz",
    ecc: "L",
    mask: 3,
    version: 11,
    modules:
      "fee5456484205bfc12780d6d651cd06ea229f33a4abebb7533f2307c4755dba8d7f5fc38472ec138f8e4699e5107faaa" +
      "aaaaaaaaafe009fc4f19da1400f2d063cf83a634eaacd11ef2efa6179af71e80584bc0f46adfa5ebfa3779cebd4ed5df" +
      "931996e2a81f0eaf6af895280b09504f81c9cd984a1e4453cb936f9c5069e10e6bb448abb12fa678ed7cbc7d62cde59f" +
      "7e990776e271e94ca36764fdbb5c2304a440097a44f84baafd914727979f4f4caf286fbfc171943bf1a57028568c2461" +
      "08b14cb84fac48f3ce1ed5fd3d99293230ee215aef15fb9c4ffe61a6fb746870b478cf8c4c6aa20d6bf95aabed158b55" +
      "137afd1a7fed8c1fb5d36f86858a2b6047462a30f5da6adb5ef41841190bd41c5f24fe6fff90d9c109abc27cbfae6786" +
      "52c7afb5ed371cf4901697b23aee7fa8ba7fd0b8a0175e6666a0aca89dc6586178a7ed5f2a968f9bd83c987f5781b78a" +
      "35f1e8c36a56a832a4abdc06986139d94bc7c294ec13982f9af2d5a192cf5a9f7dce9c01f9f562bf6ada54e72ecffb8b" +
      "d232e84f0dd3adc9eec332920f24694bfa73b6fe0067d21c54676c5ff9ded3ab2a4feab049134315109d13ba0413afe7" +
      "c37fd5d5d3dc542766566ea4d0762c0de07d0591920b3a3f4acfee2a8411f55fdf8",
  },
];

const toHex = (modules: Uint8Array): string => {
  let hex = "";
  for (let i = 0; i < modules.length; i += 4) {
    hex += (((modules[i] ?? 0) << 3) | ((modules[i + 1] ?? 0) << 2) | ((modules[i + 2] ?? 0) << 1) | (modules[i + 3] ?? 0)).toString(16);
  }
  return hex;
};

describe("SY-10: the QR code encoder", () => {
  test.each(REFERENCE)("matches an independent encoder: version $version-$ecc, mask $mask", ({ text, ecc, mask, version, modules }) => {
    const qr = encodeQr(text, { ecc, mask });
    expect(qr.version).toBe(version);
    expect(qr.size).toBe(version * 4 + 17);
    expect(toHex(qr.modules)).toBe(modules);
  });

  test("a pairing link fits version 5 at M: 37 modules across", () => {
    const link = `https://wantsandwonts.com/pair#${"A".repeat(43)}`;
    expect(encodeQr(link)).toMatchObject({ version: 5, size: 37 });
  });

  test("uses the smallest version that fits, up to version 40", () => {
    expect(encodeQr("a".repeat(84)).version).toBe(5);
    expect(encodeQr("a".repeat(85)).version).toBe(6);
    expect(encodeQr("a".repeat(2331)).version).toBe(40);
    expect(() => encodeQr("a".repeat(2332))).toThrow(RangeError);
  });

  test("the chosen mask is one of the eight, and gives the same symbol as asking for it", () => {
    for (const text of ["hello", "https://example.test/pair#key", "x".repeat(200)]) {
      const auto = encodeQr(text);
      expect(auto.mask).toBeGreaterThanOrEqual(0);
      expect(auto.mask).toBeLessThanOrEqual(7);
      expect(toHex(encodeQr(text, { mask: auto.mask }).modules)).toBe(toHex(auto.modules));
    }
    expect(() => encodeQr("hello", { mask: 8 })).toThrow(RangeError);
  });

  test("errors never quote the text", () => {
    const secret = "secret-key-".repeat(300);
    expect(() => encodeQr(secret)).toThrow(expect.objectContaining({ message: expect.not.stringContaining("secret") }));
  });
});

describe("SY-10: the QR code on the page", () => {
  test("is an image with a label, drawn with a quiet zone", () => {
    render(<QrCode value="https://example.test/pair#key" label="QR code for adding a device" />);
    const image = screen.getByRole("img", { name: "QR code for adding a device" });
    const { size } = encodeQr("https://example.test/pair#key");
    expect(image).toHaveAttribute("viewBox", `0 0 ${size + 8} ${size + 8}`);
  });

  test("draws exactly the encoder's dark modules", () => {
    const value = `https://wantsandwonts.com/pair#${"Zm9vYmFy".repeat(5)}abc`;
    const { container } = render(<QrCode value={value} label="QR code" />);
    const { size, modules } = encodeQr(value);
    const drawn = new Uint8Array(size * size);
    const d = container.querySelector("path")!.getAttribute("d")!;
    for (const [, x, y, run] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
      for (let i = 0; i < Number(run); i++) drawn[(Number(y) - 4) * size + Number(x) - 4 + i]! += 1;
    }
    expect(d.replace(/M\d+ \d+h(\d+)v1h-\1z/g, "")).toBe("");
    expect(Array.from(drawn)).toEqual(Array.from(modules));
  });

  test("puts the value only into the drawing, never into text or attributes", () => {
    const key = "Zm9vYmFyYmF6cXV4cXV1eGZvb2JhcmJhenF1eHF1dXg";
    const { container } = render(<QrCode value={`https://example.test/pair#${key}`} label="QR code" />);
    expect(container.innerHTML).not.toContain(key);
    expect(container.innerHTML).not.toContain("example.test");
  });
});

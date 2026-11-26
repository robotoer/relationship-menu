/**
 * The app's member signatures (src/live/box-crypto.ts) checked by the server's own
 * authenticateMember (server/src/auth.ts), so the two can't drift apart (§7a).
 */
import { memberAuthorization, newBoxSecrets, newDeviceKey } from "./box-crypto";

// Loaded at run time, so the app's type check doesn't type the Worker's code.
const SERVER_AUTH = "../../server/src/auth";
type ServerAuth = {
  authenticateMember: (request: Request, body: Uint8Array, boxId: string) => Promise<{ memberId: string }>;
  memberIdForKey: (key: Uint8Array) => Promise<string>;
};
const { authenticateMember, memberIdForKey } = (await import(/* @vite-ignore */ SERVER_AUTH)) as ServerAuth;

const request = async (method: string, path: string, body: Uint8Array, boxId: string, device: Awaited<ReturnType<typeof newDeviceKey>>, ts: number) =>
  new Request(`https://app.test${path}`, {
    method,
    headers: { authorization: await memberAuthorization(boxId, device, method, path, body, ts) },
    body: body.length ? (new Uint8Array(body) as BodyInit) : undefined,
  });

describe("member signatures, app → server (§7a)", () => {
  it("the server accepts the app's signed requests and agrees on the member id", async () => {
    const { boxId } = newBoxSecrets();
    const device = await newDeviceKey();
    const ts = Math.floor(Date.now() / 1000);
    const body = new Uint8Array([1, 2, 3, 4]);
    const put = await request("PUT", `/v1/boxes/${boxId}/copies/${device.memberId}`, body, boxId, device, ts);
    const caller = await authenticateMember(put, body, boxId);
    expect(caller.memberId).toBe(device.memberId);
    expect(await memberIdForKey(device.publicKey)).toBe(device.memberId);
    const get = await request("GET", `/v1/boxes/${boxId}/copies?since=12`, new Uint8Array(), boxId, device, ts);
    await expect(authenticateMember(get, new Uint8Array(), boxId)).resolves.toMatchObject({ memberId: device.memberId });
  });

  it("the server rejects them for another box, a changed body, or an old timestamp", async () => {
    const { boxId } = newBoxSecrets();
    const other = newBoxSecrets().boxId;
    const device = await newDeviceKey();
    const ts = Math.floor(Date.now() / 1000);
    const body = new Uint8Array([1, 2, 3]);
    const put = await request("PUT", `/v1/boxes/${boxId}/copies/${device.memberId}`, body, boxId, device, ts);
    await expect(authenticateMember(put, new Uint8Array([9]), boxId)).rejects.toMatchObject({ status: 401 });
    await expect(authenticateMember(put, body, other)).rejects.toMatchObject({ status: 401 });
    const old = await request("GET", `/v1/boxes/${boxId}/copies?since=0`, new Uint8Array(), boxId, device, ts - 600);
    await expect(authenticateMember(old, new Uint8Array(), boxId)).rejects.toMatchObject({ code: "clock_skew" });
  });
});

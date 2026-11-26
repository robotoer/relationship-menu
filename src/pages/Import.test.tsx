import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { encodeData } from "../data-encoder";
import { encodeHandoffRequest } from "../handoff/format";
import { captureImportFragment } from "../handoff/receive";
import { StorageProvider } from "../providers/Storage";
import type { Storage } from "../storage";
import { createLocalStorage } from "../storage";
import { ImportPage } from "./Import";

/** /import (spec HO-4, HO-5): saves what arrived, then goes back to the old address. */

const ID = "AAAAAAAAAAAAAAAAAAAAAA";
const arrive = (fragment: string) =>
  captureImportFragment({ pathname: "/import", search: "", hash: `#${fragment}` }, { state: null, replaceState: () => {} });

const renderImport = (storage: Storage, onLeave: (url: string) => void) =>
  render(
    <StorageProvider storage={storage}>
      <MemoryRouter initialEntries={["/import"]}>
        <Routes>
          <Route path="/import" element={<ImportPage onLeave={onLeave} />} />
          <Route path="/library" element={<p>Library page</p>} />
        </Routes>
      </MemoryRouter>
    </StorageProvider>
  );

beforeEach(() => localStorage.clear());

describe("Import page", () => {
  it("HO-4: saves the menus, then replies to the old address", async () => {
    arrive(encodeHandoffRequest({ id: ID, menus: [{ title: "Us", encoded: encodeData({ G: [{ item: "Walks" }] }) }] }));
    const storage = createLocalStorage();
    const onLeave = vi.fn();
    renderImport(storage, onLeave);
    expect(screen.getByRole("status")).toHaveTextContent("Bringing your menus over");
    await waitFor(() => expect(onLeave).toHaveBeenCalledOnce());
    expect(onLeave.mock.calls[0]![0]).toMatch(/\/#handoff-reply=AAAAAAAAAAAAAAAAAAAAAA&ok=1$/);
    expect(Object.values(await storage.getDocuments()).map((d) => d.title)).toEqual(["Us"]);
  });

  it("HO-5: says so when the menus can't be saved, and continues without them on request", async () => {
    arrive(encodeHandoffRequest({ id: ID, menus: [{ title: "Us", encoded: encodeData({ G: [{ item: "Walks" }] }) }] }));
    const full: Storage = { getDocuments: async () => ({}), saveDocuments: async () => [], deleteDocument: async () => {} };
    const onLeave = vi.fn();
    renderImport(full, onLeave);
    expect(await screen.findByRole("heading", { name: "Your menus couldn't be brought over" })).toBeInTheDocument();
    expect(onLeave).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Continue without them" }));
    expect(onLeave).toHaveBeenCalledWith(expect.stringMatching(/#handoff-reply=AAAAAAAAAAAAAAAAAAAAAA&ok=0$/));
  });

  it("opened without a hand-off, goes to the Library", async () => {
    arrive("not-a-handoff");
    const onLeave = vi.fn();
    renderImport(createLocalStorage(), onLeave);
    expect(await screen.findByText("Library page")).toBeInTheDocument();
    expect(onLeave).not.toHaveBeenCalled();
  });
});

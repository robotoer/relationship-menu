import { createLocalStorage } from "./storage";
import { RelationshipMenuDocument } from "./model/menu";

describe("LocalStorage", () => { 
  let storage: ReturnType<typeof createLocalStorage>;

  beforeEach(() => {
    localStorage.clear();
    storage = createLocalStorage();
  });

  test("should save and retrieve documents", async () => {
    const doc: RelationshipMenuDocument = {
      title: "Test Document",
      encoded: "encoded-content",
    };

    await storage.saveDocuments(doc);
    const documents = await storage.getDocuments();

    expect(documents["Test Document"]).toEqual(doc);
  });

  test("should clear all documents", async () => {
    const doc: RelationshipMenuDocument = {
      title: "Test Document",
      encoded: "encoded-content",
    };

    await storage.saveDocuments(doc);
    await storage.clear();
    const documents = await storage.getDocuments();

    expect(Object.keys(documents).length).toBe(0);
  });

  test("should retrieve documents by id", async () => {
    const doc1: RelationshipMenuDocument = {
      title: "Doc1",
      encoded: "encoded-content-1",
    };
    const doc2: RelationshipMenuDocument = {
      title: "Doc2",
      encoded: "encoded-content-2",
    };

    await storage.saveDocuments(doc1, doc2);
    const documents = await storage.getDocuments();

    expect(documents["Doc1"]).toEqual(doc1);
    expect(documents["Doc2"]).toEqual(doc2);
  });

  test("should read IPFS-format JSON entries from localStorage", async () => {
    // Simulate IPFS storage saving a document with a CID key and JSON value
    const doc: RelationshipMenuDocument = {
      title: "IPFS Menu",
      encoded: "ipfs-encoded-content",
    };
    localStorage.setItem(
      "menu:bafyreigdmqpykrgxyaxtlafqpqhzrusn5nugbkjf3iy2grdiqbpnb2jcri",
      JSON.stringify(doc)
    );

    const documents = await storage.getDocuments();

    expect(documents["IPFS Menu"]).toEqual(doc);
  });

  test("should read both raw and JSON format entries", async () => {
    // Raw format (localStorage save)
    localStorage.setItem("menu:Raw Menu", "raw-encoded-content");
    // JSON format (IPFS save)
    localStorage.setItem(
      "menu:bafyreigdmqpykrgxyaxtlafqpqhzrusn5nugbkjf3iy2grdiqbpnb2jcri",
      JSON.stringify({ title: "IPFS Menu", encoded: "ipfs-encoded-content" })
    );

    const documents = await storage.getDocuments();

    expect(documents["Raw Menu"]).toEqual({
      title: "Raw Menu",
      encoded: "raw-encoded-content",
    });
    expect(documents["IPFS Menu"]).toEqual({
      title: "IPFS Menu",
      encoded: "ipfs-encoded-content",
    });
  });

  test("should ignore non-menu localStorage entries", async () => {
    localStorage.setItem("other-key", "other-value");
    localStorage.setItem("menu:My Menu", "encoded-data");

    const documents = await storage.getDocuments();

    expect(Object.keys(documents)).toEqual(["My Menu"]);
  });

  test("should delete a single document by title (raw format)", async () => {
    const doc1: RelationshipMenuDocument = {
      title: "Doc1",
      encoded: "encoded-content-1",
    };
    const doc2: RelationshipMenuDocument = {
      title: "Doc2",
      encoded: "encoded-content-2",
    };

    await storage.saveDocuments(doc1, doc2);
    await storage.deleteDocument("Doc1");
    const documents = await storage.getDocuments();

    expect(documents["Doc1"]).toBeUndefined();
    expect(documents["Doc2"]).toEqual(doc2);
  });

  test("should delete a single document by title (JSON format)", async () => {
    localStorage.setItem(
      "menu:bafyreigdmqpykrgxyaxtlafqpqhzrusn5nugbkjf3iy2grdiqbpnb2jcri",
      JSON.stringify({ title: "IPFS Menu", encoded: "ipfs-encoded-content" })
    );
    localStorage.setItem("menu:Other Menu", "other-encoded-content");

    await storage.deleteDocument("IPFS Menu");
    const documents = await storage.getDocuments();

    expect(documents["IPFS Menu"]).toBeUndefined();
    expect(documents["Other Menu"]).toEqual({
      title: "Other Menu",
      encoded: "other-encoded-content",
    });
  });

  test("should not delete a CID-keyed JSON entry whose title differs from the requested title", async () => {
    // Simulate: a CID-keyed IPFS entry at menu:someCID belongs to a different menu.
    const cidKey = "menu:someCID";
    localStorage.setItem(
      cidKey,
      JSON.stringify({ title: "Actual IPFS Menu", encoded: "ipfs-data" })
    );
    // Also add a raw entry with a different title
    localStorage.setItem("menu:rawTitle", "raw-data");

    await storage.deleteDocument("someCID");
    const documents = await storage.getDocuments();

    // The CID-keyed JSON entry should NOT have been deleted (its title is different)
    expect(documents["Actual IPFS Menu"]).toEqual({
      title: "Actual IPFS Menu",
      encoded: "ipfs-data",
    });
    // The raw entry should still exist (title doesn't match)
    expect(documents["rawTitle"]).toEqual({
      title: "rawTitle",
      encoded: "raw-data",
    });
    // "someCID" should not appear as a document (no raw entry with that title existed)
    expect(documents["someCID"]).toBeUndefined();
  });

  test("should delete raw entry when CID-keyed JSON entry has a different title at the same key", async () => {
    // A CID-keyed JSON entry at menu:someCID belongs to "Actual IPFS Menu"
    localStorage.setItem(
      "menu:someCID",
      JSON.stringify({ title: "Actual IPFS Menu", encoded: "ipfs-data" })
    );
    // A raw entry for "MyMenu" that should be deletable
    localStorage.setItem("menu:MyMenu", "my-encoded-data");

    await storage.deleteDocument("MyMenu");
    const documents = await storage.getDocuments();

    // The raw entry should be deleted
    expect(documents["MyMenu"]).toBeUndefined();
    // The CID-keyed JSON entry should remain
    expect(documents["Actual IPFS Menu"]).toEqual({
      title: "Actual IPFS Menu",
      encoded: "ipfs-data",
    });
  });
});

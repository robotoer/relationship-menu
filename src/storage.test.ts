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
});

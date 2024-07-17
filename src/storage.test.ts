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
      image: "https://via.placeholder.com/150",
      encoded: "encoded-content",
    };

    await storage.saveDocuments(doc);
    const documents = await storage.getDocuments();

    expect(documents["Test Document"]).toEqual(doc);
  });

  test("should clear all documents", async () => {
    const doc: RelationshipMenuDocument = {
      title: "Test Document",
      image: "https://via.placeholder.com/150",
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
      image: "https://via.placeholder.com/150",
      encoded: "encoded-content-1",
    };
    const doc2: RelationshipMenuDocument = {
      title: "Doc2",
      image: "https://via.placeholder.com/150",
      encoded: "encoded-content-2",
    };

    await storage.saveDocuments(doc1, doc2);
    const documents = await storage.getDocuments();

    expect(documents["Doc1"]).toEqual(doc1);
    expect(documents["Doc2"]).toEqual(doc2);
  });
});

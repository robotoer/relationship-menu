import { act, renderHook } from "@testing-library/react";
import { AUTOSAVE_DELAY_MS, useAutosave } from "./autosave";
import { RelationshipMenuDocument } from "./model/menu";

const doc = (title: string, encoded = "e"): RelationshipMenuDocument => ({
  title,
  encoded,
});

describe("useAutosave", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const flushPromises = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it("saves once after edits stop, with the latest document", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const { rerender, result } = renderHook(
      ({ d }) => useAutosave(d, save),
      { initialProps: { d: doc("M") as RelationshipMenuDocument | null } }
    );
    rerender({ d: doc("Me") });
    rerender({ d: doc("Menu") });
    expect(save).not.toHaveBeenCalled();
    expect(result.current).toBe("pending");

    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(doc("Menu"));
    expect(result.current).toBe("saved");
  });

  it("saves title-only changes (the menu title is part of the document)", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ d }) => useAutosave(d, save), {
      initialProps: { d: doc("Old", "same") },
    });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    rerender({ d: doc("New", "same") });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(save).toHaveBeenLastCalledWith(doc("New", "same"));
  });

  it("runs saves one at a time, in order", async () => {
    const order: string[] = [];
    let release!: () => void;
    const save = jest.fn((d: RelationshipMenuDocument) => {
      order.push(`start ${d.title}`);
      return d.title === "A"
        ? new Promise<void>((r) => {
            release = () => {
              order.push("end A");
              r();
            };
          })
        : Promise.resolve().then(() => {
            order.push(`end ${d.title}`);
          });
    });
    const { rerender } = renderHook(({ d }) => useAutosave(d, save), {
      initialProps: { d: doc("A") },
    });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    rerender({ d: doc("B") });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(order).toEqual(["start A"]);
    await act(async () => {
      release();
      await flushPromises();
    });
    expect(order).toEqual(["start A", "end A", "start B", "end B"]);
  });

  it("does not save when the document is null", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    renderHook(() => useAutosave(null, save));
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
      await flushPromises();
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("flushes a pending save on unmount", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useAutosave(doc("Draft"), save));
    await act(async () => {
      unmount();
      await flushPromises();
    });
    expect(save).toHaveBeenCalledWith(doc("Draft"));
  });

  it("reverting an edit before it saves keeps the reverted version (undo)", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ d }) => useAutosave(d, save), {
      initialProps: { d: doc("A") },
    });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(save).toHaveBeenCalledTimes(1);
    rerender({ d: doc("B") });
    rerender({ d: doc("A") }); // undo within the debounce window
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalledWith(doc("B"));
  });

  it("reports an error and keeps going when a save fails", async () => {
    const save = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { rerender, result } = renderHook(({ d }) => useAutosave(d, save), {
      initialProps: { d: doc("A") },
    });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(result.current).toBe("error");
    rerender({ d: doc("B") });
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(result.current).toBe("saved");
    errorSpy.mockRestore();
  });
});

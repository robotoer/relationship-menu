import { debounce } from "lodash";

// Tests demonstrating the use of debounce
describe("debounce", () => {
  it("should call the function after the delay", async () => {
    const func = jest.fn();
    const debounced = debounce(func, 100);
    debounced();
    expect(func).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(func).toHaveBeenCalled();
  });
  it("should call the function immediately if leading is true", async () => {
    const func = jest.fn();
    const debounced = debounce(func, 100, { leading: true });
    debounced();
    expect(func).toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(func).toHaveBeenCalledTimes(1);
  });
});

import { debounce } from "lodash";

// Tests demonstrating the use of debounce
describe("debounce", () => {
  it("should call the function after the delay", async () => {
    const func = jest.fn();
    const debounced = debounce(func, 100);
    debounced();
    expect(func).not.toBeCalled();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(func).toBeCalled();
  });
  it("should call the function immediately if leading is true", async () => {
    const func = jest.fn();
    const debounced = debounce(func, 100, { leading: true });
    debounced();
    expect(func).toBeCalled();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(func).toBeCalledTimes(1);
  });
});

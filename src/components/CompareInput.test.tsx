import { render, screen, fireEvent } from "@testing-library/react";
import { CompareInput } from "./CompareInput";

describe("CompareInput", () => {
  it("should render the label", () => {
    render(<CompareInput label="Menu 1" onChange={jest.fn()} />);
    expect(screen.getByText("Menu 1")).toBeInTheDocument();
  });

  it("should render with the provided value", () => {
    render(
      <CompareInput label="Menu 1" value="test-value" onChange={jest.fn()} />
    );
    expect(screen.getByDisplayValue("test-value")).toBeInTheDocument();
  });

  it("should render an empty input when value is undefined", () => {
    render(<CompareInput label="Menu 1" onChange={jest.fn()} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("");
  });

  it("should call onChange when input value changes", () => {
    const onChange = jest.fn();
    render(<CompareInput label="Menu 1" onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "new-value" } });
    expect(onChange).toHaveBeenCalledWith("new-value");
  });
});

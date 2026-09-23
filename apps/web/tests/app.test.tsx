import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App, DetectionMethod } from "../src/app/App";

describe("SpriteFlow app shell", () => {
  it("renders the local-only upload state", () => {
    render(<App />);
    expect(screen.getByText("把透明精灵表变成引擎素材")).toBeTruthy();
    expect(screen.getByText(/文件只在你的浏览器中处理/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "选择图片" })).toBeTruthy();
  });

  it("switches visible copy without resetting the upload surface", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText("语言"), "en");
    expect(
      screen.getByText("Turn transparent sprite sheets into engine-ready assets"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose image" })).toBeTruthy();
  });

  it("opens the shortcut reference from the permanent header", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "快捷键" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "快捷键" })).toBeTruthy();
  });

  it("maps the pipeline strategy to its detection-method copy", () => {
    const { rerender } = render(<DetectionMethod locale="zh" strategy="components" />);
    expect(screen.getByText("区域")).toBeTruthy();

    rerender(<DetectionMethod locale="zh" strategy="grid" />);
    expect(screen.getByText("网格")).toBeTruthy();

    rerender(<DetectionMethod locale="en" strategy="manual-grid" />);
    expect(screen.getByText("Manual")).toBeTruthy();
  });
});

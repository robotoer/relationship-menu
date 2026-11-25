import type { Meta, StoryObj } from "@storybook/react-webpack5";
import { HashRouter } from "react-router-dom";
import { LandingPage } from "./Landing";

const meta = {
  title: "Pages/Landing",
  component: LandingPage,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <HashRouter>{Story()}</HashRouter>],
} satisfies Meta<typeof LandingPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstVisit: Story = { args: { savedCount: 0 } };
export const ReturningVisitor: Story = { args: { savedCount: 3 } };

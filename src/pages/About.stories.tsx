import type { Meta, StoryObj } from "@storybook/react";

import { AboutPage } from "./About";

const meta = {
  title: "Pages/About",
  component: AboutPage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AboutPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

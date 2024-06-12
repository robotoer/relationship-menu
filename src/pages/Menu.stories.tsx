import type { Meta, StoryObj } from "@storybook/react";

import { MenuPage } from "./Menu";

const meta = {
  title: "Pages/Menu",
  component: MenuPage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof MenuPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    menu: {
      "Commitment": [
        {
          item: "Marriage",
        },
        {
          item: "Marriage with another partner",
          value: "maybe",
        },
        {
          item: "Partner getting married to someone else",
          value: "off-limits",
        },
      ],
      "Children": [
        {
          item: "Children",
        },
        {
          item: "Children with another partner",
          value: "maybe",
        },
        {
          item: "Partner having children with someone else",
          value: "off-limits",
        },
      ],
    },
    onChange: () => {},
  },
};

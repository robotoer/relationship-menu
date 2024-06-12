import type { Meta, StoryObj } from "@storybook/react";

import { ComparePage } from "./Compare";

const meta = {
  title: "Pages/Compare",
  component: ComparePage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ComparePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    titles: ["Person 1", "Person 2", "Person 3", "Person 4"],
    comparison: {
      Commitment: [
        {
          item: "Marriage",
          values: ["maybe", "maybe", "maybe", undefined],
        },
        {
          item: "Marriage with another partner",
          values: ["maybe", "off-limits", "off-limits", "maybe"],
        },
        {
          item: "Partner getting married to someone else",
          values: ["off-limits", "maybe", "maybe", "off-limits"],
        },
      ],
      Children: [
        {
          item: "Children",
          values: ["maybe", "maybe", "maybe", undefined],
        },
        {
          item: "Children with another partner",
          values: ["maybe", "off-limits", "off-limits", "maybe"],
        },
        {
          item: "Partner having children with someone else",
          values: ["off-limits", "maybe", "maybe", "off-limits"],
        },
      ],
    },
  },
};

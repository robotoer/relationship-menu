import type { Meta, StoryObj } from "@storybook/react";

import { LibraryPage } from "./Library";
import { encodeData } from "../data-encoder";
import { RelationshipMenu } from "../model/menu";
import { HashRouter } from "react-router-dom";

const meta = {
  title: "Pages/Library",
  component: LibraryPage,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    // HashRouter is required for the Link component to work in Storybook
    (Story) => <HashRouter>{Story()}</HashRouter>,
  ],
} satisfies Meta<typeof LibraryPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    menus: [
      {
        title: "Partner 1",
        image: "https://via.placeholder.com/150",
        encoded: encodeData({
          Commitment: [
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
          Children: [
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
        } as RelationshipMenu),
      },
      {
        title: "Partner 2",
        image: "https://via.placeholder.com/150",
        encoded: encodeData({
          Commitment: [
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
          Children: [
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
        } as RelationshipMenu),
      },
    ],
  },
};

export const Empty: Story = {
  args: {
    menus: [],
  },
};

import type { Meta, StoryObj } from "@storybook/react";

import { MenuPage } from "./Menu";
import { encodeData } from "../data-encoder";
import { RelationshipMenu } from "../model/menu";

const meta = {
  title: "Pages/Menu",
  component: MenuPage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof MenuPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const exampleMenu: RelationshipMenu = {
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
};
const exampleTemplate: RelationshipMenu = {
  "Commitment": [
    {
      item: "Marriage",
    },
    {
      item: "Marriage with another partner",
    },
    {
      item: "Partner getting married to someone else",
    },
  ],
  "Children": [
    {
      item: "Children",
    },
    {
      item: "Children with another partner",
    },
    {
      item: "Partner having children with someone else",
    },
  ],
};
const exampleMenuEncoded = encodeData(exampleMenu);
const exampleTemplateEncoded = encodeData(exampleTemplate);

export const Default: Story = {
  args: {
    title: "Relationship Menu Example",
    menu: exampleMenu,
    menuEncoded: exampleMenuEncoded,
    templateEncoded: exampleTemplateEncoded,
    onChange: () => {},
    onChangeTitle: () => {},
  },
};

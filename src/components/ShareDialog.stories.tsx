import type { Meta, StoryObj } from "@storybook/react-webpack5";
import { MemoryRouter } from "react-router-dom";
import { ShareDialog } from "./ShareDialog";

const meta = {
  title: "Components/ShareDialog",
  component: ShareDialog,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <MemoryRouter>{Story()}</MemoryRouter>],
} satisfies Meta<typeof ShareDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Our relationship menu",
    personName: "Sam",
    menuUrl: "https://relationship-menu.vercel.app/menu?encoded=eJxT...:eJyr...",
    menuEncoded: "eJxT...:eJyr...",
    templateUrl: "https://relationship-menu.vercel.app/menu?encoded=eJxT...:eJyq...",
    templateEncoded: "eJxT...:eJyq...",
    onClose: () => {},
  },
};

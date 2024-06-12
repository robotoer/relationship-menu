import type { Meta, StoryObj } from '@storybook/react';
import { Navbar } from './Navbar';
import { HashRouter } from 'react-router-dom';

const meta = {
  title: 'Components/Navbar',
  component: Navbar,
  tags: ['autodocs'],
} satisfies Meta<typeof Navbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Non-Escalator Relationship Menu',
    links: [
      { to: '/', text: 'Library' },
      { to: '/compare', text: 'Compare' },
      { to: '/about', text: 'About' },
    ],
  },
  decorators: [
    (Story) => (
      <HashRouter>
        <Story />
      </HashRouter>
    ),
  ],
};

import { RelationshipMenuItemValue } from "./menu";

export type ComparedMenuItem = {
  item: string;
  values: (RelationshipMenuItemValue | undefined)[];
};

export type ComparedMenuGroup = ComparedMenuItem[];

export type MenuComparison = {
  [key: string]: ComparedMenuGroup;
};

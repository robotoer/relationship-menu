export type RelationshipMenuItemValue =
  | "must-have"
  | "like-to-have"
  | "maybe"
  | "off-limits";

export type RelationshipMenuItem = {
  item: string;
  value?: RelationshipMenuItemValue;
};

export type RelationshipMenuGroup = RelationshipMenuItem[];

export type RelationshipMenu = {
  [key: string]: RelationshipMenuGroup;
};

export type RelationshipMenuDocument = {
  title: string;
  image: string;
  encoded: string;
};

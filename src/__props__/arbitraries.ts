/** Shared fast-check generators for property tests (spec §11). */
import fc from "fast-check";
import { RelationshipMenu, RelationshipMenuItemValue } from "../model/menu";

export const answerArb: fc.Arbitrary<RelationshipMenuItemValue> = fc.constantFrom(
  "must-have",
  "like-to-have",
  "maybe",
  "off-limits"
);

/** Short texts that collide often (case, spacing) plus awkward JS names. */
export const textArb = fc.oneof(
  fc.constantFrom("Kissing", "kissing", " Kissing ", "KISSING", "Trust", "trust  ", "a  b", "a b", "__proto__", "constructor", "toString", ""),
  fc.string({ maxLength: 6 })
);

export const itemArb = fc.record(
  { item: textArb, value: answerArb },
  { requiredKeys: ["item"] }
);

/** A menu as the app stores it: an ordered object of groups (built prototype-free). */
export const menuArb: fc.Arbitrary<RelationshipMenu> = fc
  .array(fc.tuple(textArb, fc.array(itemArb, { maxLength: 5 })), { maxLength: 5 })
  .map((pairs) => {
    const menu: RelationshipMenu = Object.create(null);
    for (const [name, items] of pairs) {
      if (!Object.prototype.hasOwnProperty.call(menu, name)) {
        Object.defineProperty(menu, name, { value: items, enumerable: true, writable: true, configurable: true });
      }
    }
    return menu;
  });

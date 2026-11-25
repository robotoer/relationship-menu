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

/** Notes: usually short, sometimes blank or over the 280-character cap. */
export const noteArb = fc.oneof(
  fc.constantFrom("only on weekends", "  ask first  ", "", "   "),
  fc.string({ maxLength: 8 }),
  fc.string({ minLength: 279, maxLength: 300 })
);

export const itemArb = fc.record(
  { item: textArb, value: answerArb, note: noteArb },
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

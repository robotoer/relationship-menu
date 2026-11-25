/**
 * Landing page: explains what a relationship menu is, why to use one, how the app
 * works and what its links are for.
 */

import { Link } from "react-router-dom";
import "./Landing.css";
import { MENU_TEMPLATES } from "../templates";
import { LandingButton, track } from "../analytics";

/** Analytics: which landing page button was used. */
const clicked = (button_id: LandingButton) => () => track("landing_button_clicked", { button_id });

const ANSWERS: { className: string; label: string; meaning: string }[] = [
  { className: "must-have", label: "Must have", meaning: "I need this to be happy." },
  { className: "like-to-have", label: "Like to have", meaning: "I'd enjoy this." },
  { className: "maybe", label: "Maybe", meaning: "Open to talking about it." },
  { className: "off-limits", label: "Off limits", meaning: "Not for me." },
];

/** A row of colored blocks, like a comparison row, used as decoration. */
const PixelRow = ({ cells, label }: { cells: string[]; label: string }) => (
  <div className="landing-demo-row">
    {cells.map((cell, i) => (
      <span key={i} className={`landing-swatch ${cell}`} aria-hidden="true" />
    ))}
    <span className="landing-demo-label">{label}</span>
  </div>
);

export const LandingPage = ({ savedCount = 0 }: { savedCount?: number }) => {
  return (
    <div className="landing">
      <section className="landing-hero">
        <p className="landing-kicker">A conversation starter for two (or more)</p>
        <h1 className="landing-title">
          Relationship
          <br />
          Menu
        </h1>
        <p className="landing-lead">
          Every relationship comes with expectations. Most of them never get said out
          loud. A relationship menu lists the things a relationship <em>could</em>{" "}
          include, so you can each say what you actually want, then see where you match.
        </p>
        <div className="landing-actions">
          <Link className="button button-primary" to="/menu" onClick={clicked("hero_start")}>
            ▶ Start a menu
          </Link>
          <Link className="button" to="/compare" onClick={clicked("hero_compare")}>
            Compare menus
          </Link>
          {savedCount > 0 && (
            <Link className="button" to="/library" onClick={clicked("hero_library")}>
              My menus ({savedCount})
            </Link>
          )}
        </div>
        <div className="landing-demo" aria-label="Example comparison of two people's answers">
          <div className="landing-demo-header">
            <span>YOU</span>
            <span>THEM</span>
          </div>
          <PixelRow cells={["must-have", "must-have"]} label="Date nights" />
          <PixelRow cells={["like-to-have", "maybe"]} label="Moving in" />
          <PixelRow cells={["off-limits", "like-to-have"]} label="Dating others" />
          <p className="landing-demo-caption">
            Same color? You agree. Different colors? That's your next conversation.
          </p>
        </div>
      </section>

      <section className="landing-section" aria-labelledby="why">
        <h2 id="why">Why use one?</h2>
        <div className="landing-cards">
          <article className="landing-card">
            <h3>Skip the guessing</h3>
            <p>
              People often assume a relationship should go through the same steps as
              everyone else's: dating, moving in, marriage, kids. A menu asks each
              question separately, so nothing is taken for granted.
            </p>
          </article>
          <article className="landing-card">
            <h3>Answer on your own</h3>
            <p>
              Each person fills in their own copy privately, without being swayed by
              the other's answers. It's easier to be honest that way.
            </p>
          </article>
          <article className="landing-card">
            <h3>See it side by side</h3>
            <p>
              The compare view lines your answers up item by item, so you can spot the
              easy yeses and the topics worth talking through.
            </p>
          </article>
        </div>
      </section>

      <section className="landing-section" aria-labelledby="how-it-works">
        <h2 id="how-it-works">How it works</h2>
        <ol className="landing-steps">
          <li>
            <h3>Build your menu</h3>
            <p>
              A menu is a list of groups (like "Commitment") with items in each (like
              "Moving in together"). Start from a template or a blank page, then add,
              rename, reorder or delete anything.
            </p>
            <p className="landing-templates">
              Templates: {MENU_TEMPLATES.map((t) => t.name).join(" · ")}.
            </p>
          </li>
          <li>
            <h3>Answer each item</h3>
            <ul className="landing-answers">
              {ANSWERS.map(({ className, label, meaning }) => (
                <li key={className}>
                  <span className={`landing-swatch ${className}`} aria-hidden="true" />
                  <strong>{label}</strong>
                  <span>{meaning}</span>
                </li>
              ))}
            </ul>
          </li>
          <li>
            <h3>Share it</h3>
            <p>
              Send your partner the <strong>template link</strong>. It has your items
              but none of your answers, so they fill it in fresh. When you're both
              done, swap <strong>menu links</strong>.
            </p>
          </li>
          <li>
            <h3>Compare</h3>
            <p>
              Open <strong>Compare</strong>, paste in each menu link, and press
              Compare. Items are matched by name, so it works even if your menus
              aren't identical.
            </p>
          </li>
        </ol>
      </section>

      <section className="landing-section" aria-labelledby="links">
        <h2 id="links">What are all these links?</h2>
        <p>
          Every menu page shows four things you can copy. They all carry the menu
          inside them, compressed into the address, so nothing needs to be uploaded
          anywhere first.
        </p>
        <dl className="landing-links">
          <div>
            <dt>Menu link</dt>
            <dd>
              Your menu <em>with your answers</em>. Opening it shows exactly what you
              filled in. Share it with the people you're comparing with.
            </dd>
          </div>
          <div>
            <dt>Menu slug</dt>
            <dd>
              The same thing without the website address: just the data. Paste a slug
              (or a link) into Compare.
            </dd>
          </div>
          <div>
            <dt>Template link</dt>
            <dd>
              Your groups and items with <em>all answers removed</em>. Send this so
              someone can answer the same questions without seeing yours.
            </dd>
          </div>
          <div>
            <dt>Template slug</dt>
            <dd>The template without the website address.</dd>
          </div>
        </dl>
      </section>

      <section className="landing-section" aria-labelledby="privacy">
        <h2 id="privacy">Where does my menu go?</h2>
        <ul className="landing-list">
          <li>
            There's no account and no server database. Your menus are saved in this
            browser, on this device, and show up under <Link to="/library">Library</Link>.
          </li>
          <li>
            A link contains the whole menu, so <strong>anyone with a menu link can read
            your answers</strong>. Share menu links only with people you want to see
            them.
          </li>
          <li>
            Opening someone's link saves a copy in your Library. If you already have a
            menu with that name, the copy gets a new name instead of replacing yours.
          </li>
          <li>Clearing your browser's site data deletes your saved menus.</li>
        </ul>
      </section>

      <section className="landing-section" aria-labelledby="credits">
        <h2 id="credits">Where the templates come from</h2>
        <p>
          The templates are written for this app. Their topics follow those covered by
          well-known relationship menus, especially the Relationship Anarchy
          Smorgasbord by Lyrica Lawrence and Heather Orr, and Amy Gahran's{" "}
          <em>Stepping Off the Relationship Escalator</em>. Items are kept non-explicit;
          add your own for anything more specific.
        </p>
      </section>

      <section className="landing-section landing-keys" aria-labelledby="keys">
        <h2 id="keys">Keyboard friendly</h2>
        <p>
          In the editor, use <kbd>↑</kbd> <kbd>↓</kbd> or <kbd>j</kbd> <kbd>k</kbd> to
          move, <kbd>1</kbd>–<kbd>4</kbd> to answer, <kbd>Enter</kbd> to type and{" "}
          <kbd>u</kbd> to undo. Press <kbd>?</kbd> for the full list.
        </p>
      </section>

      <section className="landing-section" aria-labelledby="support">
        <h2 id="support">Free, private, and kept that way by supporters</h2>
        <p>
          No ads and no accounts, and your menus never leave your browser unless you
          share them. If Relationship Menu helps you, you can{" "}
          <Link to="/support" state={{ supportFrom: "landing" }}>
            support the project
          </Link>
          . Supporters will get encrypted sync between devices as thanks.
        </p>
      </section>

      <section className="landing-cta">
        <h2>Ready, player one?</h2>
        <div className="landing-actions">
          <Link className="button button-primary" to="/menu" onClick={clicked("footer_start")}>
            ▶ Start
          </Link>
          <Link className="button" to="/compare" onClick={clicked("footer_compare")}>
            Compare menus
          </Link>
        </div>
      </section>
    </div>
  );
};

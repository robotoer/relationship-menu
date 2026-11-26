/**
 * ▲▼ buttons for moving an item or a group (spec ED-7, ED-23). A missing callback
 * means "already at that end": the button stays, disabled, so the row doesn't jump.
 */
export type MoveControls = { up?: () => void; down?: () => void };

export const MoveButtons = ({ name, controls }: { name: string; controls: MoveControls }) => (
  <span className="move-buttons" role="group" aria-label={`Move ${name}`}>
    <button
      type="button"
      className="icon-button move-up"
      data-move="up"
      onClick={controls.up}
      disabled={!controls.up}
      aria-label={`Move ${name} up`}
      title="Move up (Shift+K)"
    >
      ▲
    </button>
    <button
      type="button"
      className="icon-button move-down"
      data-move="down"
      onClick={controls.down}
      disabled={!controls.down}
      aria-label={`Move ${name} down`}
      title="Move down (Shift+J)"
    >
      ▼
    </button>
  </span>
);

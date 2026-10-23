import { useCallback, useState } from "react";
import { useDisclosureMenu } from "../util/useDisclosureMenu";
import { Icon, type IconName } from "./icons";

export interface MenuItem {
  label: string;
  icon?: IconName;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
}

/** The "more" button: secondary actions collapsed into a popup menu when the panel is narrow. */
export function OverflowMenu({ items, label = "More actions" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { containerRef, triggerRef, onListKeyDown } = useDisclosureMenu(open, close);
  if (items.length === 0) return null;
  return (
    <div className="wf-menu" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="wf-btn wf-btn-icon"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="overflow-menu"
        onClick={() => setOpen(!open)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <ul className="wf-menu-list" role="menu" onKeyDown={onListKeyDown}>
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className="wf-menu-item"
                data-danger={item.danger || undefined}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon && <Icon name={item.icon} />}
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

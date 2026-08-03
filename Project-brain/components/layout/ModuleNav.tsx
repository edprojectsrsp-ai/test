"use client";

/**
 * ModuleNav — primary tabs + grouped overflow menus.
 * Keeps multi-view modules scannable (≤ ~5 chrome items) without losing destinations.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export type ModuleNavBadgeTone = "danger" | "warn" | "mute";

export type ModuleNavItem = {
  id: string;
  label: string;
  hint?: string;
  badge?: number | null;
  badgeTone?: ModuleNavBadgeTone;
  icon?: ReactNode;
};

/** A top-level tab (one destination). */
export type ModuleNavTab = ModuleNavItem & { kind?: "tab" };

/** A dropdown group of destinations. */
export type ModuleNavGroup = {
  kind: "group";
  id: string;
  label: string;
  items: ModuleNavItem[];
  /** Optional badge rolled up onto the group button */
  badge?: number | null;
  badgeTone?: ModuleNavBadgeTone;
};

export type ModuleNavEntry = ModuleNavTab | ModuleNavGroup;

function isGroup(e: ModuleNavEntry): e is ModuleNavGroup {
  return (e as ModuleNavGroup).kind === "group";
}

function Badge({ n, tone = "mute" }: { n?: number | null; tone?: ModuleNavBadgeTone }) {
  if (n == null || n <= 0) return null;
  return (
    <span className={`mshell-badge mshell-badge--${tone}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

function Chevron() {
  return (
    <svg className="mshell-chevron" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M2.5 4.5 L6 8 L9.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type ModuleNavProps = {
  entries: ModuleNavEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  /** aria-label for the tablist */
  label?: string;
  className?: string;
  /** Map keyboard 1–N to top-level entries (groups open first child) */
  enableKeys?: boolean;
};

export default function ModuleNav({
  entries,
  activeId,
  onSelect,
  label = "Module sections",
  className = "",
  enableKeys = true,
}: ModuleNavProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const baseId = useId();

  const close = useCallback(() => setOpenGroup(null), []);

  useEffect(() => {
    if (!openGroup) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [openGroup, close]);

  useEffect(() => {
    if (!enableKeys) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n < 1 || n > entries.length) return;
      e.preventDefault();
      const entry = entries[n - 1];
      if (!entry) return;
      if (isGroup(entry)) {
        const child = entry.items.find((i) => i.id === activeId) || entry.items[0];
        if (child) onSelect(child.id);
        setOpenGroup(entry.id);
      } else {
        onSelect(entry.id);
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enableKeys, entries, activeId, onSelect, close]);

  const groupContainsActive = (g: ModuleNavGroup) =>
    g.items.some((i) => i.id === activeId);

  const onGroupKeyDown = (e: KeyboardEvent, g: ModuleNavGroup) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpenGroup((cur) => (cur === g.id ? null : g.id));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpenGroup(g.id);
    }
  };

  return (
    <nav
      ref={rootRef}
      className={`mshell-nav ${className}`.trim()}
      role="tablist"
      aria-label={label}
    >
      {entries.map((entry, idx) => {
        if (isGroup(entry)) {
          const active = groupContainsActive(entry);
          const open = openGroup === entry.id;
          const menuId = `${baseId}-menu-${entry.id}`;
          return (
            <div
              key={entry.id}
              className={`mshell-group${active ? " mshell-group--active" : ""}${open ? " mshell-group--open" : ""}`}
            >
              <button
                type="button"
                className="mshell-group__btn"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={menuId}
                title={`${entry.label} · shortcut ${idx + 1}`}
                onClick={() => setOpenGroup((cur) => (cur === entry.id ? null : entry.id))}
                onKeyDown={(e) => onGroupKeyDown(e, entry)}
              >
                {entry.label}
                <Badge n={entry.badge} tone={entry.badgeTone} />
                <Chevron />
              </button>
              {open ? (
                <div className="mshell-menu" role="menu" id={menuId}>
                  {entry.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      className="mshell-menu__item"
                      aria-selected={item.id === activeId}
                      onClick={() => {
                        onSelect(item.id);
                        close();
                      }}
                    >
                      <span className="mshell-menu__item-label">
                        {item.icon}
                        {item.label}
                        <Badge n={item.badge} tone={item.badgeTone} />
                      </span>
                      {item.hint ? (
                        <span className="mshell-menu__item-hint">{item.hint}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }

        const tab = entry as ModuleNavTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeId === tab.id}
            className="mshell-tab"
            title={`${tab.hint || tab.label} · shortcut ${idx + 1}`}
            onClick={() => {
              onSelect(tab.id);
              close();
            }}
          >
            {tab.icon}
            {tab.label}
            <Badge n={tab.badge} tone={tab.badgeTone} />
          </button>
        );
      })}
    </nav>
  );
}

/** Flatten entries for resolving active label/hint. */
export function flattenModuleNav(entries: ModuleNavEntry[]): ModuleNavItem[] {
  const out: ModuleNavItem[] = [];
  for (const e of entries) {
    if (isGroup(e)) out.push(...e.items);
    else out.push(e);
  }
  return out;
}

"use client";
import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";
import { cn } from "@/lib/utils";

type SelectContextValue = {
  value: string;
  setValue: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  label?: string;
  setLabel: (label: string) => void;
};

const SelectContext = createContext<SelectContextValue | null>(null);

function useSelectContext() {
  const context = useContext(SelectContext);
  if (!context) {
    throw new Error("Select components must be used inside Select");
  }
  return context;
}

export function Select({
  children,
  onValueChange,
  defaultValue = "",
}: {
  children: ReactNode;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
}) {
  const [value, setLocalValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState<string>();

  const setValue = (nextValue: string) => {
    setLocalValue(nextValue);
    onValueChange?.(nextValue);
  };

  return (
    <SelectContext.Provider value={{ value, setValue, open, setOpen, label, setLabel }}>
      <div className="relative">{children}</div>
    </SelectContext.Provider>
  );
}

export function SelectTrigger({ children, className }: { children: ReactNode; className?: string }) {
  const { open, setOpen } = useSelectContext();

  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className={cn(
        "flex h-12 w-full items-center justify-between rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-left text-sm text-white transition-colors hover:bg-zinc-900",
        className
      )}
    >
      {children}
      <span className="text-zinc-500">⌄</span>
    </button>
  );
}

export function SelectValue({ placeholder }: { placeholder?: string }) {
  const { value, label } = useSelectContext();

  return <span>{value ? label || value : placeholder}</span>;
}

export function SelectContent({ children, className }: { children: ReactNode; className?: string }) {
  const { open } = useSelectContext();

  if (!open) return null;

  return (
    <div
      className={cn(
        "absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SelectItem({ children, value }: { children: ReactNode; value: string }) {
  const { setValue, setOpen, setLabel } = useSelectContext();

  return (
    <button
      type="button"
      onClick={() => {
        setValue(value);
        setLabel(String(children));
        setOpen(false);
      }}
      className="block w-full px-4 py-3 text-left text-sm text-zinc-100 hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "secondary" | "destructive" | "outline";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

const variants: Record<ButtonVariant, string> = {
  default: "bg-cyan-600 text-white hover:bg-cyan-700",
  secondary: "bg-zinc-800 text-white hover:bg-zinc-700",
  destructive: "bg-rose-600 text-white hover:bg-rose-700",
  outline: "border border-zinc-700 bg-transparent text-zinc-100 hover:bg-zinc-800",
};

export function Button({
  className,
  type = "button",
  variant = "default",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-xl px-4 py-2 font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

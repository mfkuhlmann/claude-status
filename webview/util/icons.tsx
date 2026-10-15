// Small line icons drawn here: the webview loads nothing from outside (no
// codicon font), and currentColor makes them follow every theme.

import type { JSX } from "preact";

export type IconName = "refresh" | "add" | "stop" | "close" | "share" | "chevron" | "server" | "eye" | "external";

const shapes: Record<IconName, JSX.Element> = {
  refresh: (
    <>
      <path d="M13.4 8.6A5.5 5.5 0 1 1 11.6 3.9" />
      <path d="M12.4 1.4v3.2H9.2" />
    </>
  ),
  add: <path d="M8 2.75v10.5M2.75 8h10.5" />,
  stop: <rect x="3.75" y="3.75" width="8.5" height="8.5" rx="1.5" fill="currentColor" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  share: (
    <>
      <circle cx="11.75" cy="3.75" r="1.75" />
      <circle cx="4.25" cy="8" r="1.75" />
      <circle cx="11.75" cy="12.25" r="1.75" />
      <path d="M5.8 7.1l4.4-2.5M5.8 8.9l4.4 2.5" />
    </>
  ),
  chevron: <path d="M6 3.5L10.5 8 6 12.5" />,
  server: (
    <>
      <rect x="2.25" y="2.25" width="11.5" height="5" rx="1.25" />
      <rect x="2.25" y="8.75" width="11.5" height="5" rx="1.25" />
      <path d="M4.75 4.75h.01M4.75 11.25h.01" stroke-width="1.8" />
    </>
  ),
  eye: (
    <>
      <path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  external: (
    <>
      <path d="M9.5 2.5h4v4M13.5 2.5L8 8" />
      <path d="M12 9.5v2.75c0 .7-.55 1.25-1.25 1.25h-7c-.7 0-1.25-.55-1.25-1.25v-7C2.5 4.55 3.05 4 3.75 4H6.5" />
    </>
  ),
};

export function Icon({ name, class: cls }: { name: IconName; class?: string }) {
  return (
    <svg
      class={"icon" + (cls ? " " + cls : "")}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shapes[name]}
    </svg>
  );
}

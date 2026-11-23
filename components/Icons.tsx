import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const CheckIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3.5 8.5l3 3 6-7" />
  </Base>
);

export const CrossIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </Base>
);

export const SendIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
  </Base>
);

export const MicIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="5.75" y="1.75" width="4.5" height="8" rx="2.25" />
    <path d="M3.25 7.5a4.75 4.75 0 009.5 0M8 12.25v2" />
  </Base>
);

export const StopIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
  </Base>
);

export const PanelIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
    <path d="M10 2.75v10.5" />
  </Base>
);

export const ResetIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M2.75 8a5.25 5.25 0 109-3.7M11.75 1.75v2.75H9" />
  </Base>
);

export const ArrowIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Base>
);

export const AlertIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M8 1.75l6.5 11.5h-13L8 1.75z" />
    <path d="M8 6.25v3M8 11.25v.01" />
  </Base>
);

export const ChevronIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4.5 6.5L8 10l3.5-3.5" />
  </Base>
);

export const CopyIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.75" />
    <path d="M10.75 5.25V3.5a1.25 1.25 0 00-1.25-1.25h-6A1.25 1.25 0 002.25 3.5v6a1.25 1.25 0 001.25 1.25h1.75" />
  </Base>
);

export const CloseIcon = CrossIcon;

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M14 8a6 6 0 00-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

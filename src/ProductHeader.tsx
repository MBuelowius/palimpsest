import type { ReactNode, Ref } from "react";

export function SkillIcon({ name, large }: { name: string; large?: boolean }) {
  const initials = name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return (
    <span
      className={large ? "store-icon store-icon-large" : "store-icon"}
      aria-hidden="true"
    >
      {initials || "S"}
    </span>
  );
}

export function ProductHeader({
  name,
  description,
  source,
  facts,
  headingRef,
  headingId,
  action,
}: {
  name: string;
  description: string;
  source: ReactNode;
  facts: [string, ReactNode][];
  headingRef: Ref<HTMLHeadingElement>;
  headingId?: string;
  action?: ReactNode;
}) {
  return (
    <header className="product-header">
      <SkillIcon name={name} large />
      <div className="product-title">
        <h1 id={headingId} ref={headingRef} tabIndex={-1}>
          {name}
        </h1>
        <p className="muted">{source}</p>
        <p className="product-description">
          {description || "No description yet."}
        </p>
        {action}
      </div>
      <dl className="product-facts">
        {facts
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
    </header>
  );
}

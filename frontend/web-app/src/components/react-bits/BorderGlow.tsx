import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import './BorderGlow.css';

interface BorderGlowProps {
  children?: ReactNode;
  className?: string;
  articleProps: ComponentPropsWithoutRef<'article'>;
}

export function BorderGlowEdge() {
  return <span className="edge-light" aria-hidden="true" />;
}

export default function BorderGlow({ children, className = '', articleProps }: BorderGlowProps) {
  return (
    <article {...articleProps} className={`border-glow-card border-glow-card--record ${className}`}>
      <BorderGlowEdge />
      {children}
    </article>
  );
}

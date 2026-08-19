import React from 'react'

interface HighlightTextProps {
  text: string | number | null | undefined
  query?: string | null
}

export function HighlightText({ text, query }: HighlightTextProps) {
  if (text === null || text === undefined) return null;
  const strText = String(text);
  
  if (!query || query.trim() === '') return <>{strText}</>;
  
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = strText.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-primary/20 text-foreground rounded-sm px-0.5 font-medium">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

"use client";

import { useState, type KeyboardEvent } from "react";

interface TagFilterInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

export function TagFilterInput({ tags, onChange }: TagFilterInputProps) {
  const [input, setInput] = useState("");

  function commit() {
    const value = input.trim();
    if (value && !tags.includes(value)) {
      onChange([...tags, value]);
    }
    setInput("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-300 px-2 py-1.5 focus-within:border-zinc-500 focus-within:ring-1 focus-within:ring-zinc-500">
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            aria-label={`Remove tag ${tag}`}
            className="text-zinc-400 hover:text-zinc-700"
          >
            ✕
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder={tags.length === 0 ? "Filter by tag…" : ""}
        className="min-w-[6rem] flex-1 bg-transparent text-sm text-zinc-900 focus:outline-none"
      />
    </div>
  );
}

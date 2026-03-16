import { useCallback, useEffect, useRef, useState } from "react";

interface DirInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

function getBaseUrl(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:5182";
  return window.location.origin;
}

async function fetchDirs(path: string): Promise<{ path: string; dirs: string[] }> {
  const res = await fetch(`${getBaseUrl()}/api/fs/dirs?path=${encodeURIComponent(path || "~")}`);
  if (!res.ok) return { path, dirs: [] };
  return res.json();
}

/** Returns the parent directory of a path string (keeps trailing slash). */
function parentOf(p: string): string {
  const trimmed = p.endsWith("/") ? p.slice(0, -1) : p;
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx + 1);
}

export function DirInput({ value, onChange, placeholder, disabled, onConfirm, onCancel }: DirInputProps) {
  const [dirs, setDirs] = useState<string[]>([]);
  const [basePath, setBasePath] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadDirs = useCallback(async (queryPath: string) => {
    const result = await fetchDirs(queryPath);
    setBasePath(result.path);
    setDirs(result.dirs);
    setHighlighted(0);
    setOpen(result.dirs.length > 0);
  }, []);

  // Debounced load when value changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Determine what path to query: if value ends with "/", list that dir; otherwise list parent
      const queryPath = value === "" ? "~" : value.endsWith("/") ? value : parentOf(value);
      loadDirs(queryPath);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, loadDirs]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectDir = useCallback((dir: string) => {
    const newPath = basePath.endsWith("/") ? basePath + dir + "/" : basePath + "/" + dir + "/";
    onChange(newPath);
    // Load subdirs of selected dir immediately
    loadDirs(newPath);
  }, [basePath, onChange, loadDirs]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open && dirs.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, dirs.length - 1));
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
        return;
      } else if (e.key === "Tab" || (e.key === "Enter" && dirs[highlighted])) {
        e.preventDefault();
        selectDir(dirs[highlighted]);
        return;
      } else if (e.key === "Escape") {
        setOpen(false);
        return;
      }
    }
    if (e.key === "Enter") {
      onConfirm?.();
    } else if (e.key === "Escape") {
      onCancel?.();
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <input
          autoFocus
          type="text"
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            if (dirs.length > 0) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="w-full bg-muted/40 border border-border/60 rounded px-2.5 py-1.5 pr-7 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50"
        />
        {dirs.length > 0 && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen((o) => !o);
            }}
            className="absolute right-1.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
            >
              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>
      {open && dirs.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 top-full mt-0.5 max-h-48 overflow-y-auto rounded border border-border bg-popover shadow-lg">
          {dirs.map((dir, i) => (
            <li
              key={dir}
              className={`px-2.5 py-1 text-[11px] font-mono cursor-pointer ${
                i === highlighted
                  ? "bg-primary/15 text-primary"
                  : "text-foreground hover:bg-muted/60"
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectDir(dir);
              }}
              onMouseEnter={() => setHighlighted(i)}
            >
              {dir}/
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

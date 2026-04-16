"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { StockSearchSuggestion } from "@/lib/types";

type SuggestionApiResponse = {
  suggestions: StockSearchSuggestion[];
  error?: string;
};

type StockSearchBoxProps = {
  initialQuery: string;
  localSuggestions: StockSearchSuggestion[];
};

function normalizeQuery(value: string) {
  return value.trim().toUpperCase().replace(/\.NS$/i, "");
}

function matchesSuggestion(suggestion: StockSearchSuggestion, query: string) {
  const normalized = normalizeQuery(query);

  if (!normalized) {
    return false;
  }

  return [suggestion.symbol, suggestion.companyName, suggestion.sector, suggestion.industry ?? ""]
    .map((value) => value.toUpperCase())
    .some((value) => value.includes(normalized));
}

function dedupeSuggestions(items: StockSearchSuggestion[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.symbol)) {
      return false;
    }

    seen.add(item.symbol);
    return true;
  });
}

export function StockSearchBox({ initialQuery, localSuggestions }: StockSearchBoxProps) {
  const router = useRouter();
  const pathname = usePathname();
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [remoteSuggestions, setRemoteSuggestions] = useState<StockSearchSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    setQuery(initialQuery);
    setIsOpen(false);
    setActiveIndex(-1);
  }, [initialQuery]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const localMatches = useMemo(() => {
    const normalized = normalizeQuery(query);

    if (!normalized) {
      return [];
    }

    return localSuggestions.filter((suggestion) => matchesSuggestion(suggestion, normalized)).slice(0, 5);
  }, [localSuggestions, query]);

  const suggestions = useMemo(() => {
    const normalized = normalizeQuery(query);

    if (!normalized) {
      return [];
    }

    return dedupeSuggestions([...localMatches, ...remoteSuggestions]).slice(0, 8);
  }, [localMatches, query, remoteSuggestions]);

  useEffect(() => {
    const normalized = normalizeQuery(query);

    setActiveIndex(-1);
    setErrorMessage(null);

    if (!normalized) {
      setRemoteSuggestions([]);
      setIsLoading(false);
      setIsOpen(false);
      return;
    }

    if (normalized.length < 2) {
      setRemoteSuggestions([]);
      setIsLoading(false);
      setIsOpen(localMatches.length > 0);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search-suggestions?q=${encodeURIComponent(normalized)}`, {
          cache: "no-store"
        });
        const payload = (await response.json()) as SuggestionApiResponse;

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setRemoteSuggestions([]);
          setErrorMessage(payload.error ?? "Live suggestions are unavailable right now.");
        } else {
          setRemoteSuggestions(payload.suggestions ?? []);
        }
      } catch {
        if (cancelled) {
          return;
        }

        setRemoteSuggestions([]);
        setErrorMessage("Live suggestions are unavailable right now.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsOpen(true);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [localMatches.length, query]);

  const activeSuggestion = activeIndex >= 0 ? suggestions[activeIndex] : null;

  function clearBlurTimeout() {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  }

  function analyzeSelection(value: string) {
    const normalized = normalizeQuery(value);

    if (!normalized) {
      return;
    }

    setQuery(normalized);
    setIsOpen(false);
    router.push(`${pathname}?symbol=${encodeURIComponent(normalized)}`);
  }

  return (
    <form
      className="search-form"
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        analyzeSelection(isOpen && activeSuggestion ? activeSuggestion.symbol : query);
      }}
    >
      <div className="search-autocomplete">
        <input
          aria-activedescendant={
            activeSuggestion ? `stock-search-option-${activeSuggestion.symbol}` : undefined
          }
          aria-autocomplete="list"
          aria-controls="stock-search-suggestions"
          aria-expanded={isOpen}
          aria-label="Search NSE stock"
          autoComplete="off"
          className="search-input"
          name="symbol"
          onBlur={() => {
            clearBlurTimeout();
            blurTimeoutRef.current = setTimeout(() => setIsOpen(false), 120);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!isOpen && event.target.value.trim()) {
              setIsOpen(true);
            }
          }}
          onFocus={() => {
            clearBlurTimeout();

            if (normalizeQuery(query)) {
              setIsOpen(true);
            }
          }}
          onKeyDown={(event) => {
            if (!suggestions.length) {
              if (event.key === "Escape") {
                setIsOpen(false);
              }

              return;
            }

            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) => Math.min(current + 1, suggestions.length - 1));
              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) => (current <= 0 ? 0 : current - 1));
              return;
            }

            if (event.key === "Enter" && isOpen && activeSuggestion) {
              event.preventDefault();
              analyzeSelection(activeSuggestion.symbol);
              return;
            }

            if (event.key === "Escape") {
              setIsOpen(false);
            }
          }}
          placeholder="Search symbol, e.g. RELIANCE, INFY, ASIANPAINT"
          type="text"
          value={query}
        />

        {isOpen && normalizeQuery(query) ? (
          <div className="search-suggestions" id="stock-search-suggestions" role="listbox">
            <div className="search-suggestions-header" role="presentation">
              Matching NSE symbols
            </div>
            {suggestions.map((suggestion, index) => (
              <button
                aria-selected={index === activeIndex}
                className={`search-suggestion${index === activeIndex ? " active" : ""}`}
                id={`stock-search-option-${suggestion.symbol}`}
                key={`${suggestion.symbol}-${suggestion.companyName}`}
                onClick={() => analyzeSelection(suggestion.symbol)}
                onMouseDown={(event) => {
                  clearBlurTimeout();
                  event.preventDefault();
                }}
                role="option"
                type="button"
              >
                <span className="search-suggestion-primary">
                  <strong className="search-suggestion-symbol">{suggestion.symbol}</strong>
                  <span className="search-suggestion-name">{suggestion.companyName}</span>
                </span>
                <span className="search-suggestion-meta">
                  {suggestion.sector}
                  {suggestion.industry ? ` · ${suggestion.industry}` : ""}
                </span>
              </button>
            ))}

            {!suggestions.length && !isLoading && !errorMessage ? (
              <div className="search-suggestion-status">No matching NSE stocks found.</div>
            ) : null}

            {isLoading ? (
              <div className="search-suggestion-status">Loading live suggestions...</div>
            ) : null}

            {errorMessage ? (
              <div className="search-suggestion-status error">{errorMessage}</div>
            ) : null}
          </div>
        ) : null}
      </div>

      <button className="search-button" type="submit">
        Analyze stock
      </button>
      {initialQuery ? (
        <a className="search-clear" href="/">
          Clear
        </a>
      ) : null}
    </form>
  );
}

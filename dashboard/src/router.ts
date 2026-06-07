// A tiny hash router — keeps deps minimal (no react-router). Hash routing is
// chosen over path routing because the dashboard is a static bundle that may be
// served from a subpath / IPFS gateway / inside a host iframe, where deep-link
// path rewrites aren't guaranteed. Two routes only:
//   #/                  → home
//   #/game/<0xaddress>  → detail page for that contract
//
// Keyed by contract address (SPEC §7.3). The Play button is a separate external
// anchor and does NOT use this router.

import { useEffect, useState } from "react";
import type { Address } from "./types";

export type Route =
  | { name: "home" }
  | { name: "game"; address: Address };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, "");
  const m = /^\/game\/(0x[0-9a-fA-F]{40})\/?$/i.exec(h);
  if (m) return { name: "game", address: m[1].toLowerCase() as Address };
  return { name: "home" };
}

export function gameHref(address: Address): string {
  return `#/game/${address}`;
}

export function homeHref(): string {
  return "#/";
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    parseHash(typeof window === "undefined" ? "" : window.location.hash),
  );
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

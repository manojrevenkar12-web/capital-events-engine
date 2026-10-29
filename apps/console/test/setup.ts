import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// jsdom has no layout; the router restores scroll positions
window.scrollTo = () => undefined;

/**
 * Known CSS Properties
 *
 * Set of all known CSS properties for validation.
 */
import allProperties from "./data/all.json";

export const knownCSSProperties = new Set<string>(allProperties.properties);

export type KnownCSSProperties = typeof knownCSSProperties;

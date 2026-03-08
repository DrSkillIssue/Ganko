/**
 * No AI Slop Comments Rule
 *
 * Detects and flags comments containing forbidden words/phrases.
 * Helps maintain code quality by identifying low-value AI-generated comments.
 */

import { toLowerString } from "@ganko/shared";
import { getSourceCode } from "../../queries/get";
import type { Fix } from "../../../diagnostic"
import { createDiagnosticFromComment } from "../../../diagnostic"
import { defineSolidRule } from "../../rule";

interface TrieNode {
  children: Map<string, TrieNode>;
  word: string | null;
}

/**
 * Creates an empty trie node.
 *
 * @returns A new node with empty children map and null word marker
 */
function createTrieNode(): TrieNode {
  return { children: new Map(), word: null };
}

class Trie {
  private readonly root = createTrieNode();
  private readonly caseSensitive: boolean;

  /**
   * @param caseSensitive - Whether matching should be case-sensitive
   */
  constructor(caseSensitive = false) {
    this.caseSensitive = caseSensitive;
  }

  /**
   * Inserts a word into the trie.
   *
   * @param word - The word to insert
   */
  insert(word: string): void {
    const key = this.caseSensitive ? word : toLowerString(word);
    let node = this.root;

    for (let i = 0; i < key.length; i++) {
      const char = key[i];
      if (!char) return;
      let child = node.children.get(char);
      if (!child) {
        child = createTrieNode();
        if (!char) return;
        node.children.set(char, child);
      }
      node = child;
    }
    node.word = word;
  }

  /**
   * Checks if text contains any word in the trie.
   *
   * @param text - The text to search
   * @returns True if any trie word is found in text
   */
  hasMatch(text: string): boolean {
    const normalized = this.caseSensitive ? text : toLowerString(text);
    const len = normalized.length;

    for (let i = 0; i < len; i++) {
      let node = this.root;
      for (let j = i; j < len; j++) {
        const ch = normalized[j];
        if (!ch) break;
        const child = node.children.get(ch);
        if (!child) break;
        node = child;
        if (node.word !== null) return true;
      }
    }
    return false;
  }

  /**
   * Finds all trie words present in the text.
   *
   * @param text - The text to search
   * @returns Set of all matched words
   */
  findMatches(text: string): Set<string> {
    const normalized = this.caseSensitive ? text : toLowerString(text);
    const len = normalized.length;
    const matches = new Set<string>();

    for (let i = 0; i < len; i++) {
      let node = this.root;
      for (let j = i; j < len; j++) {
        const ch = normalized[j];
        if (!ch) break;
        const child = node.children.get(ch);
        if (!child) break;
        node = child;
        if (node.word !== null) matches.add(node.word);
      }
    }
    return matches;
  }
}

const messages = {
  forbiddenWord: "Comment contains forbidden word '{{word}}'.",
} as const;

const options: { words: string[]; caseSensitive: boolean } = { words: [], caseSensitive: false };

export const noAiSlopComments = defineSolidRule({
  id: "no-ai-slop-comments",
  severity: "error",
  messages,
  meta: {
    description:
      "Disallow comments containing specified forbidden words or phrases. Useful for enforcing comment style guidelines and detecting AI-generated boilerplate.",
    fixable: true,
    category: "correctness",
  },
  options,
  check(graph, emit) {
    if (options.words.length === 0) return;

    const trie = new Trie(options.caseSensitive);
    for (const word of options.words) trie.insert(word);

    const comments = getSourceCode(graph).getAllComments();
    if (comments.length === 0) return;

    for (const comment of comments) {
      const text = comment.value;
      if (!trie.hasMatch(text)) continue;

      for (const word of trie.findMatches(text)) {
        const message = messages.forbiddenWord.replace("{{word}}", word);

        const fix: Fix = [{
          range: [comment.range[0], comment.range[1]],
          text: "",
        }];

        emit(
          createDiagnosticFromComment(
            graph.file,
            comment,
            "no-ai-slop-comments",
            "forbiddenWord",
            message,
            "error",
            fix,
          ),
        );
      }
    }
  },
});

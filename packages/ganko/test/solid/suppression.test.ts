/**
 * Inline Suppression Comment Tests
 *
 * Verifies that ganko-disable-next-line, ganko-disable-line,
 * and ganko-disable directives suppress diagnostics correctly.
 */

import { describe, it, expect } from "vitest"
import { checkAll } from "./test-utils"

describe("inline suppression comments", () => {
  describe("ganko-disable-next-line", () => {
    it("suppresses a specific rule on the next line", () => {
      const { diagnostics } = checkAll(`
        function App() {
          // ganko-disable-next-line no-innerhtml
          return <div innerHTML={"<b>bold</b>"} />
        }
      `)
      const innerhtml = diagnostics.filter(d => d.rule === "no-innerhtml")
      expect(innerhtml).toHaveLength(0)
    })

    it("does not suppress unrelated rules", () => {
      const { diagnostics } = checkAll(`
        function App(props: { html: string }) {
          // ganko-disable-next-line some-other-rule
          return <div innerHTML={props.html} />
        }
      `)
      const innerhtml = diagnostics.filter(d => d.rule === "no-innerhtml")
      expect(innerhtml).toHaveLength(1)
    })

    it("suppresses all rules when no rule ID given", () => {
      const { diagnostics } = checkAll(`
        function App() {
          // ganko-disable-next-line
          return <div innerHTML={"<b>bold</b>"} />
        }
      `)
      const innerhtml = diagnostics.filter(d => d.rule === "no-innerhtml")
      expect(innerhtml).toHaveLength(0)
    })

    it("suppresses multiple rules on same line", () => {
      const { diagnostics } = checkAll(`
        function App() {
          // ganko-disable-next-line no-innerhtml some-other-rule
          return <div innerHTML={"<b>bold</b>"} />
        }
      `)
      const innerhtml = diagnostics.filter(d => d.rule === "no-innerhtml")
      expect(innerhtml).toHaveLength(0)
    })
  })

  describe("ganko-disable-line", () => {
    it("suppresses a specific rule on the same line", () => {
      const { diagnostics } = checkAll(`
        function App() {
          return <div innerHTML={"<b>bold</b>"} /> // ganko-disable-line no-innerhtml
        }
      `)
      const innerhtml = diagnostics.filter(d => d.rule === "no-innerhtml")
      expect(innerhtml).toHaveLength(0)
    })
  })

  describe("ganko-disable (file-level)", () => {
    it("suppresses a rule across the entire file", () => {
      const { diagnostics } = checkAll(`
        // ganko-disable no-innerhtml
        function App() {
          return <div innerHTML={"<b>bold</b>"} />
        }
        function Other() {
          return <div innerHTML={"<i>italic</i>"} />
        }
      `)
      const innerhtml = diagnostics.filter(d => d.rule === "no-innerhtml")
      expect(innerhtml).toHaveLength(0)
    })

    it("does not suppress unrelated rules", () => {
      const { diagnostics } = checkAll(`
        // ganko-disable some-other-rule
        function App() {
          return <div innerHTML={"<b>bold</b>"} />
        }
      `)
      const innerhtml = diagnostics.filter(d => d.rule === "no-innerhtml")
      expect(innerhtml).toHaveLength(1)
    })
  })

  describe("block comments", () => {
    it("supports block comment syntax", () => {
      const { diagnostics } = checkAll(`
        function App() {
          /* ganko-disable-next-line no-innerhtml */
          return <div innerHTML={"<b>bold</b>"} />
        }
      `)
      const innerhtml = diagnostics.filter(d => d.rule === "no-innerhtml")
      expect(innerhtml).toHaveLength(0)
    })
  })
})

import { describe, it, expect } from "vitest"
import { checkAll } from "./test-utils"

describe("inline suppression comments", () => {
  it("ganko-disable-next-line suppresses specific and all rules", () => {
    const specific = checkAll(`
      function App() {
        // ganko-disable-next-line no-innerhtml
        return <div innerHTML={"<b>bold</b>"} />
      }
    `)
    expect(specific.diagnostics.filter(d => d.rule === "no-innerhtml")).toHaveLength(0)

    const unrelated = checkAll(`
      function App(props: { html: string }) {
        // ganko-disable-next-line some-other-rule
        return <div innerHTML={props.html} />
      }
    `)
    expect(unrelated.diagnostics.filter(d => d.rule === "no-innerhtml")).toHaveLength(1)

    const all = checkAll(`
      function App() {
        // ganko-disable-next-line
        return <div innerHTML={"<b>bold</b>"} />
      }
    `)
    expect(all.diagnostics.filter(d => d.rule === "no-innerhtml")).toHaveLength(0)

    const multi = checkAll(`
      function App() {
        // ganko-disable-next-line no-innerhtml some-other-rule
        return <div innerHTML={"<b>bold</b>"} />
      }
    `)
    expect(multi.diagnostics.filter(d => d.rule === "no-innerhtml")).toHaveLength(0)
  })

  it("ganko-disable-line suppresses on the same line", () => {
    const result = checkAll(`
      function App() {
        return <div innerHTML={"<b>bold</b>"} /> // ganko-disable-line no-innerhtml
      }
    `)
    expect(result.diagnostics.filter(d => d.rule === "no-innerhtml")).toHaveLength(0)
  })

  it("ganko-disable suppresses across the entire file", () => {
    const suppressed = checkAll(`
      // ganko-disable no-innerhtml
      function App() {
        return <div innerHTML={"<b>bold</b>"} />
      }
      function Other() {
        return <div innerHTML={"<i>italic</i>"} />
      }
    `)
    expect(suppressed.diagnostics.filter(d => d.rule === "no-innerhtml")).toHaveLength(0)

    const unrelated = checkAll(`
      // ganko-disable some-other-rule
      function App() {
        return <div innerHTML={"<b>bold</b>"} />
      }
    `)
    expect(unrelated.diagnostics.filter(d => d.rule === "no-innerhtml")).toHaveLength(1)
  })

  it("supports block comment syntax", () => {
    const result = checkAll(`
      function App() {
        /* ganko-disable-next-line no-innerhtml */
        return <div innerHTML={"<b>bold</b>"} />
      }
    `)
    expect(result.diagnostics.filter(d => d.rule === "no-innerhtml")).toHaveLength(0)
  })
})

import { defineConfig } from "vitepress"

export default defineConfig({
  title: "mdspec",
  description: "Write tests in markdown. Run them as code.",
  base: "/mdspec/",
  sitemap: { hostname: "https://beorn.codes/mdspec" },
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/mdspec/favicon.svg" }],
    [
      "script",
      {
        defer: "",
        src: "https://static.cloudflareinsights.com/beacon.min.js",
        "data-cf-beacon": '{"token": "d9b13df1eca0424c884faea71f34e09f"}',
      },
    ],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "mdtest" }],
    ["meta", { name: "twitter:card", content: "summary" }],
    [
      "script",
      { type: "application/ld+json" },
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "mdtest",
        url: "https://beorn.codes/mdspec",
        description: "Markdown-driven test runner",
      }),
    ],
  ],
  transformPageData(pageData) {
    const cleanPath = pageData.relativePath
      .replace(/\.md$/, ".html")
      .replace(/index\.html$/, "")
    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.push(
      ["link", { rel: "canonical", href: `https://beorn.codes/mdspec/${cleanPath}` }],
      ["meta", { property: "og:title", content: pageData.title || "mdtest" }],
      [
        "meta",
        {
          property: "og:description",
          content: pageData.description || "Markdown-driven test runner",
        },
      ],
      ["meta", { property: "og:url", content: `https://beorn.codes/mdspec/${cleanPath}` }],
    )
  },
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/reference/cli" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Pattern Matching", link: "/guide/pattern-matching" },
          { text: "Persistent Context", link: "/guide/persistent-context" },
          { text: "Plugins", link: "/guide/plugins" },
          { text: "Custom Commands", link: "/guide/custom-commands" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "API", link: "/reference/api" },
          { text: "Block Options", link: "/reference/block-options" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/beorn/mdspec" }],
    footer: {
      message: 'Used by <a href="https://silvery.dev">Silvery</a> and <a href="https://termless.dev">Termless</a> for executable documentation',
      copyright: 'Built by <a href="https://beorn.codes">Bjørn Stabell</a>'
    },
    search: { provider: "local" },
  },
})
